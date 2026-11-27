export {};
/**
 * 账号在线保障。
 *
 * 模型整体换成 YYB-Go-Enhanced 的 keepalive：**后台只滚令牌，不换 buffer、不重启**。
 *
 * 为什么要这么改：原来到期前 45 分钟就去打 `pcyyb_refresh_token_auth`，
 * 拿到新 token 后顺手再取一次 loginBuffer、换一次 Code、把账号连接重启一遍。
 * 三个后果叠在一起：
 *   - 提前 45 分钟续期，远早于官方约 4 分钟的续期窗口，属于「窗口外空打」；
 *   - 每 2 小时重启一次连接，面板上看起来就像「频繁掉线」；
 *   - 每次续期多打一次 login_buffer 接口，而决定授权存活的是 OAuth 层调用次数。
 *
 * 现在的分工：
 *   - 到期前 5 分钟（对齐官方 4 分钟窗口，留 1 分钟余量）只滚 token，连接不动；
 *   - Code 在真正需要时按需换：掉线重登先拿 loginBuffer 直接换（零 OAuth 调用），
 *     只有 buffer 被拒才滚一次 token；
 *   - 失败按剩余寿命动态退避（30 秒 ~ 5 分钟，已过期为 15 分钟），
 *     凭证被明确吊销则立刻停止自动重试并提示重新扫码；
 *   - 微信掉线后每隔 5 分钟尝试恢复，遇到明确的凭据失效则等待重新扫码。
 */

const store = require('../models/store');
const { normalizeAutoCodeRefresh, DEFAULT_AUTO_CODE_REFRESH, OFFLINE_RECONNECT_INTERVAL_SECONDS } = require('../config/config');
const { refreshAccountCredential, renewOAuthToken, ensureFreshGameCode, hasWxCredential } = require('./wx-credential');
const { tryRefreshQqGameCode, isQqCodeRefreshConfigured } = require('./qq-credential');
const { inspectAccountCodeHealth } = require('./code-watch');
const { classifyProtocolError, computeRefreshBackoff, REFRESH_BACKOFF_MS } = require('./wx-login/recovery-policy');
// 掉线重登是唯一的「账号不在跑但会自己回来」的窗口，面板要显示倒计时，
// 所以等待期必须写进账号状态账本，而不是只在内部定时器里。
const { setAccountRuntimeState } = require('./account-runtime-state');

/** 60 秒巡检一次；配合 5 分钟窗口，从到期前 5 分钟起最多有 5 次机会命中。 */
const TICK_MS = 60_000;
/**
 * 到期前多久滚 token。
 *
 * 官方续期窗口约 4 分钟（YYB-Go-Enhanced 的注释：「A five-minute delay would skip
 * the entire official four-minute window」）。提前 45 分钟属于窗口外空打，
 * 有延时失效的记录；这里取 5 分钟，比官方窗口多 1 分钟余量。
 */
const RENEW_AHEAD_MS = 5 * 60_000;
/** 兼容旧名：预警窗口与续期窗口现在是同一个值。 */
const PREFLIGHT_WINDOW_MS = RENEW_AHEAD_MS;
/** 兼容旧名：失败后的默认退避（对应 Go 的 keepAliveRetryBackoff）。 */
const PREFLIGHT_RETRY_MS = REFRESH_BACKOFF_MS;
/** 同一账号两次续期之间的最小间隔，避免一次 tick 内重复触发。 */
const PREFLIGHT_MIN_INTERVAL_MS = TICK_MS;
/** 按 UTC+8 自然日限制单账号「失败」次数（成功不占额度）。 */
const MAX_DAILY_PREFLIGHT_FAILURES = 8;
/** 连续失败熔断。 */
const MAX_CONSECUTIVE_FAILURES = 3;

interface KeepAliveDeps {
    restartWorker?: (account: any) => boolean | void | Promise<boolean | void>;
    isAccountRunning?: (accountId: string) => boolean;
    log?: (tag: string, msg: string, extra?: any) => void;
    addAccountLog?: (action: string, msg: string, accountId?: string, accountName?: string, extra?: any) => void;
    /** 持久化「自动续期结果」账本，供账号卡片展示；由 runtime-engine 注入，测试可留空。 */
    recordPreflightResult?: (accountId: string, ok: boolean, now: number) => void;
}

let deps: KeepAliveDeps = {};
let timer: any = null;
let running = false;
const inFlight = new Set<string>();
interface OfflineRecovery {
    handle?: ReturnType<typeof setTimeout>;
    reloginAt: number;
    needsRescan?: boolean;
}
const offlineRecoveries = new Map<string, OfflineRecovery>();
const OFFLINE_RECONNECT_INTERVAL_MS = OFFLINE_RECONNECT_INTERVAL_SECONDS * 1000;

function log(tag: string, msg: string, extra: any = {}): void {
    if (typeof deps.log === 'function') deps.log(tag, msg, extra);
}

function addAccountLog(action: string, msg: string, accountId: string, accountName: string, extra: any = {}): void {
    if (typeof deps.addAccountLog === 'function') deps.addAccountLog(action, msg, accountId, accountName, extra);
}

function getConfig(): any {
    return normalizeAutoCodeRefresh(store.getSystemConfig?.()?.autoCodeRefresh ?? store.getAutoCodeRefresh?.() ?? DEFAULT_AUTO_CODE_REFRESH);
}

interface PreflightState {
    date: string;
    /** 当日累计失败次数；成功不占额度。 */
    failuresToday: number;
    /** 连续失败次数，成功一次即清零。 */
    failures: number;
    /** 上次尝试时间：两次续期之间至少间隔一个 tick。 */
    lastAttemptAt: number;
    /** 退避截止时间：由剩余寿命动态算出，未到点不重试。 */
    retryAt: number;
}

/**
 * 到期前续期的限速 / 熔断状态机。
 *
 * 与旧实现的关键差别是退避不再固定 5 分钟，而是按 token 剩余寿命算：
 * `min(5 分钟, max(30 秒, 剩余 / 2))`。理由很直接——官方续期窗口只有约 4 分钟，
 * 固定等 5 分钟会整窗错过；而剩余寿命还长时，早点退避能省掉无意义的请求。
 * 凭证被明确吊销时不退避，直接把当日额度用满，等同「今天不再自动重试」。
 */
function createPreflightGovernor(nowFn: () => number = Date.now) {
    const states = new Map<string, PreflightState>();
    function stateOf(id: string, now: number): PreflightState {
        const date = new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
        const existing = states.get(id);
        if (existing && existing.date === date) return existing;
        const fresh: PreflightState = { date, failuresToday: 0, failures: 0, lastAttemptAt: 0, retryAt: 0 };
        states.set(id, fresh);
        return fresh;
    }
    return {
        canAttempt(id: string, now: number = nowFn()): boolean {
            const state = stateOf(id, now);
            if (state.failuresToday >= MAX_DAILY_PREFLIGHT_FAILURES || state.failures >= MAX_CONSECUTIVE_FAILURES) return false;
            if (state.retryAt > now) return false;
            return !state.lastAttemptAt || now - state.lastAttemptAt >= PREFLIGHT_MIN_INTERVAL_MS;
        },
        /** 标记「开始一次尝试」：只记时间做最短间隔防抖，不占用日额度。 */
        recordAttempt(id: string, now: number = nowFn()): void {
            stateOf(id, now).lastAttemptAt = now;
        },
        /** 成功只清「连续失败」与退避；日额度与上次尝试时间都不动。 */
        recordSuccess(id: string, now: number = nowFn()): void {
            const state = stateOf(id, now);
            state.failures = 0;
            state.retryAt = 0;
        },
        /**
         * 记一次失败。
         * @param id 账号 id。
         * @param error 失败原因（用于分类，决定是否直接熔断）。
         * @param now 当前时间。
         * @param remainingMs token 剩余寿命；undefined 表示未知，0 表示已过期。
         */
        recordFailure(id: string, error: unknown, now: number = nowFn(), remainingMs?: number): void {
            const state = stateOf(id, now);
            const info = classifyProtocolError(error);
            state.failuresToday += 1; // 日额度只统计失败
            state.failures += 1;
            state.lastAttemptAt = now;
            if (info.definitive) {
                // 凭证已吊销：继续重试只会反复被拒，直接熔断到当天结束。
                state.failures = MAX_CONSECUTIVE_FAILURES;
                state.retryAt = now + 15 * 60_000;
                return;
            }
            // 剩余寿命未知的传输错误用默认退避，不要套「已过期」的 15 分钟。
            state.retryAt = now + (remainingMs === undefined
                ? REFRESH_BACKOFF_MS
                : computeRefreshBackoff(remainingMs, info));
        },
        snapshot(id: string, now: number = nowFn()): PreflightState {
            return { ...stateOf(id, now) };
        },
        reset(): void { states.clear(); },
    };
}

const preflight = createPreflightGovernor();

/**
 * 与 code-watch 共用同一套到期判定（秒/毫秒兼容、以最近一次成功时间补算），
 * 避免两处逻辑分叉。remainingMs 为 0 表示已过期或暂无到期信息，都值得尝试一次。
 */
function isCredentialDue(account: any, now: number = Date.now()): boolean {
    return inspectAccountCodeHealth(account, { now }).remainingMs <= PREFLIGHT_WINDOW_MS;
}

function credentialRemainingMs(account: any, now: number = Date.now()): number {
    return inspectAccountCodeHealth(account, { now }).remainingMs;
}

function listWxAccounts(): any[] {
    return (store.getAccounts().accounts || []).filter((account: any) => String(account.platform || '') === 'wx');
}

function findAccount(accountId: unknown): any {
    return (store.getAccounts().accounts || []).find((account: any) => String(account.id) === String(accountId)) || null;
}

/**
 * 把一次「后端自动发起」的续期结果写进持久化账本。
 * 只记 preflight（到期前滚令牌，常开）和 offline（掉线重登）；用户在面板上
 * 手动点「续期全部微信授权」不算无人值守，不进账。账本异常不影响续期结果。
 */
function recordAutomaticResult(accountId: string, reason: 'offline' | 'manual' | 'preflight', ok: boolean, now: number): void {
    if (reason === 'manual' || typeof deps.recordPreflightResult !== 'function') return;
    try {
        deps.recordPreflightResult(accountId, ok, now);
    }
    catch {
        // 账本只用于面板展示，写失败不阻断账号续期与重启。
    }
}

function isRunning(accountId: unknown): boolean {
    if (typeof deps.isAccountRunning !== 'function') return false;
    try {
        return !!deps.isAccountRunning(String(accountId));
    } catch {
        return false;
    }
}

function platformOf(account: any): 'wx' | 'qq' {
    return String(account && account.platform || '') === 'wx' ? 'wx' : 'qq';
}

function nameOf(account: any, key: string): string {
    return String((account && (account.name || account.nick)) || key || '');
}

/**
 * 掉线后能不能免扫码自愈。
 *
 * 微信要有可换 Code 的长效凭证（loginBuffer 或 refreshtoken 任一即可 ——
 * 只有 loginBuffer 也能直接换 Code，不必非得能滚 token）；QQ 没有长效凭证，
 * 只能靠 NapCat 用当前已登录会话重签，所以要求 NapCat 接口已配置。
 */
function canRecoverAccount(account: any): boolean {
    if (!account) return false;
    if (platformOf(account) === 'wx') return hasWxCredential(account) || !!String(account.loginBuffer || '').trim();
    return isQqCodeRefreshConfigured();
}

/**
 * 分级续期：不同原因走完全不同的链路，这是本次改造的核心。
 *
 *   preflight —— 只滚 OAuth token。不取 loginBuffer、不换 Code、不重启连接。
 *   manual    —— token + loginBuffer + Code 全链路（用户点了按钮，期望立刻能用）。
 *   offline   —— 先拿 loginBuffer 直接换 Code（零 OAuth 调用）；被拒才滚一次 token。
 */
async function renewFor(account: any, key: string, reason: 'offline' | 'manual' | 'preflight'): Promise<any> {
    const accountName = nameOf(account, key);
    if (platformOf(account) === 'qq') {
        const result = await tryRefreshQqGameCode(key);
        return { ok: !!result?.ok, accountName, error: result?.error, codeIssued: !!result?.ok, needsRescan: result?.needsRescan || result?.skipped };
    }
    if (reason === 'preflight') {
        const result = await renewOAuthToken(key);
        return { ...result, accountName: result?.accountName || accountName, codeIssued: false };
    }
    if (reason === 'manual') {
        const result = await refreshAccountCredential(key);
        return { ...result, accountName: result?.accountName || accountName };
    }
    // offline：buffer 优先，只有被服务端拒绝时才动用 refresh token。
    const result = await ensureFreshGameCode(key);
    return { ...result, accountName: result?.accountName || accountName };
}

/**
 * 续期 + 按需重启。同一账号同时只允许一个续期任务，避免滚动 token 互相覆盖。
 * 只有掉线重登在成功后才重启连接；到期前滚令牌与手动续期都不动连接。
 */
async function refreshAndMaybeRestart(accountId: unknown, reason: 'offline' | 'manual' | 'preflight', now: number = Date.now(), recovery?: OfflineRecovery): Promise<boolean> {
    const key = String(accountId);
    if (inFlight.has(key)) return false;
    const account = findAccount(key);
    if (!account) return false;
    if (reason === 'offline' && !canRecoverAccount(account)) return false;
    if (reason !== 'offline' && platformOf(account) === 'wx' && !hasWxCredential(account)) return false;
    inFlight.add(key);
    const isPreflight = reason === 'preflight';
    try {
        const result = await renewFor(account, key, reason);
        const accountName = String(result?.accountName || nameOf(account, key));
        if (!result?.ok) {
            const message = `账号 ${accountName} 续期失败：${result?.error || '未知错误'}`;
            const needsRescan = !!result?.needsRescan;
            if (recovery && needsRescan) recovery.needsRescan = true;
            if (isPreflight) preflight.recordFailure(key, result?.error, now, credentialRemainingMs(account, now));
            recordAutomaticResult(key, reason, false, now);
            if (needsRescan) {
                // 凭证已被吊销，但当前会话可能还活着：Go 的做法是降级成 session_only
                // 继续跑，而不是立刻把账号判死。这里用告警而不是错误来表达这件事。
                if (platformOf(account) === 'qq') {
                    log('系统', `账号 ${accountName} 没有可用的 NapCat 会话，请重新扫码`, { accountId: key, accountName, reason });
                } else if (isRunning(key)) {
                    log('系统', `账号 ${accountName} 授权已被服务端吊销，但当前连接仍在线（仅会话模式）；已暂停自动续期，建议尽快重新扫码`, {
                        accountId: key,
                        accountName,
                        reason,
                    });
                }
                else {
                    log('错误', `账号 ${accountName} 授权已被服务端吊销，自动续期已停止，需要重新扫码`, { accountId: key, accountName, reason });
                }
            }
            else {
                log('错误', message, { accountId: key, accountName, reason });
            }
            addAccountLog(isPreflight ? 'auto_code_preflight_failed' : 'auto_code_refresh_failed', message, key, accountName, { reason, needsRescan });
            return false;
        }

        const message = platformOf(account) === 'qq'
            ? `账号 ${accountName} QQ 登录 Code 已重签`
            : (isPreflight
                ? `账号 ${accountName} 微信授权已续期（仅滚动令牌，连接保持不变）`
                : `账号 ${accountName} 微信授权已续期`);
        log('系统', message, { accountId: key, accountName, reason });
        if (isPreflight) preflight.recordSuccess(key, now);
        recordAutomaticResult(key, reason, true, now);
        addAccountLog(isPreflight ? 'auto_code_preflight' : 'auto_code_refresh', message, key, accountName, { reason });

        if (reason === 'offline' && typeof deps.restartWorker === 'function') {
            if (recovery && (offlineRecoveries.get(key) !== recovery || !getConfig().offlineEnabled || isRunning(key))) return false;
            const latest = findAccount(key);
            if (!latest || latest.wxCredentialNeedsRescan) return false;
            if (await deps.restartWorker(latest) === false) return false;
        }
        return true;
    }
    catch (error: any) {
        // renewFor 的各条分支内部已经做过 try/catch，走到这里说明出现了预期外的异常
        // （账号文件写入失败、状态机 bug、上游返回了奇怪结构等）。必须在这里收口：
        //   - 记一次失败，让退避状态前进，否则下一个 tick 会立刻重试，变成看不见的
        //     循环，把日志和 OAuth 额度一起刷掉；
        //   - 绝不能让异常冒到调用方：掉线重登那条路径是裸 `void` 调用，冒出去就是
        //     未处理拒绝，Node 20 默认按致命错误处理，主进程直接退出（全部账号掉线）。
        const accountName = nameOf(account, key);
        const message = String((error && error.message) || error || '未知错误');
        if (isPreflight) preflight.recordFailure(key, error, now, credentialRemainingMs(account, now));
        recordAutomaticResult(key, reason, false, now);
        log('错误', `账号 ${accountName} 续期异常：${message}`, { accountId: key, accountName, reason });
        addAccountLog(
            isPreflight ? 'auto_code_preflight_failed' : 'auto_code_refresh_failed',
            `账号 ${accountName} 续期异常：${message}`,
            key,
            accountName,
            { reason },
        );
        return false;
    }
    finally {
        inFlight.delete(key);
    }
}

/**
 * 常开的到期前续期通道。返回被触发的账号 id，便于回归测试断言。
 * 只滚 token，不换 Code、不重启；与掉线重登共享 inFlight 去重和账号串行锁。
 */
function runCodePreflight(now: number = Date.now()): Promise<string[]> {
    const triggered: string[] = [];
    const tasks: Promise<boolean>[] = [];
    for (const account of listWxAccounts()) {
        const key = String(account.id);
        // 只处理「正在运行」且能滚 token 的账号：用户手动停止的账号不能被自动拉起，
        // 只有 loginBuffer 的账号没有 refresh token，滚不了令牌。
        if (!hasWxCredential(account) || !isRunning(key)) continue;
        // 已经被判定需要重新扫码的账号不再按节奏空转，等用户处理。
        if (account.wxCredentialNeedsRescan) continue;
        if (inFlight.has(key) || !isCredentialDue(account, now)) continue;
        if (!preflight.canAttempt(key, now)) continue;
        preflight.recordAttempt(key, now);
        triggered.push(key);
        tasks.push(refreshAndMaybeRestart(key, 'preflight', now));
    }
    return Promise.all(tasks).then(() => triggered);
}

function tick(): void {
    if (running) return;
    running = true;
    // runCodePreflight 是异步的，必须等它真正结束才释放 running。旧写法是
    // `void runCodePreflight(...)` 之后立刻在 finally 里置回 false，互斥形同虚设：
    // 上一轮还在等上游，下一个 tick 照样进来。以前只靠 inFlight 与退避闸门兜着，
    // 一旦某次续期卡在网络超时上，就会叠出多条并发续期。
    runCodePreflight(Date.now())
        .catch((error: any) => {
            log('错误', `账号在线保障巡检失败：${String((error && error.message) || error)}`);
        })
        .finally(() => {
            running = false;
        });
}

/** 账号掉线后安排重登；重复事件共用同一个等待或执行中的任务。 */
function notifyAccountOffline(accountId: unknown, reason = 'offline', reloginAt = Date.now() + OFFLINE_RECONNECT_INTERVAL_MS): void {
    const key = String(accountId);
    const pending = offlineRecoveries.get(key);
    if (pending) {
        if (pending.handle) setAccountRuntimeState(key, 'relogin_waiting', { reloginAt: pending.reloginAt });
        return;
    }
    const account = findAccount(key);
    if (!account) return;
    const { offlineEnabled } = getConfig();
    if (!offlineEnabled || account.wxCredentialNeedsRescan || !canRecoverAccount(account)) {
        setAccountRuntimeState(key, 'offline');
        if (offlineEnabled) {
            log('系统', `账号 ${nameOf(account, key)} 无可用的免扫码凭据，请重新扫码`, { accountId: key, reason });
        }
        return;
    }

    const recovery: OfflineRecovery = { reloginAt };
    offlineRecoveries.set(key, recovery);
    setAccountRuntimeState(key, 'relogin_waiting', { reloginAt: recovery.reloginAt });
    recovery.handle = setTimeout(async () => {
        if (offlineRecoveries.get(key) !== recovery) return;
        recovery.handle = undefined;
        if (isRunning(key)) {
            offlineRecoveries.delete(key);
            return;
        }
        let ok = false;
        const attemptedAt = Date.now();
        try {
            if (getConfig().offlineEnabled) {
                const latest = findAccount(key);
                if (latest && !latest.wxCredentialNeedsRescan && canRecoverAccount(latest)) {
                    addAccountLog('auto_reconnect', `账号 ${nameOf(latest, key)} 掉线后尝试自动重登`, key, nameOf(latest, key), { reason });
                    ok = await refreshAndMaybeRestart(key, 'offline', attemptedAt, recovery);
                }
            }
        } catch (error: any) {
            log('错误', `账号自动重登异常：${String((error && error.message) || error)}`, { accountId: key, reason });
        }
        // 手动启停、删除账号或关闭重登开关可以撤销等待和执行中的重登。
        if (offlineRecoveries.get(key) !== recovery) return;
        offlineRecoveries.delete(key);
        if (ok) return;
        if (recovery.needsRescan || !findAccount(key)) {
            setAccountRuntimeState(key, 'offline');
            return;
        }
        notifyAccountOffline(key, reason, Math.max(Date.now(), attemptedAt + OFFLINE_RECONNECT_INTERVAL_MS));
    }, Math.max(0, reloginAt - Date.now()));
    if (typeof recovery.handle.unref === 'function') recovery.handle.unref();
}

function startWxKeepAlive(options: KeepAliveDeps = {}): void {
    deps = { ...deps, ...options };
    if (timer) return;
    timer = setInterval(tick, TICK_MS);
    if (typeof timer.unref === 'function') timer.unref();
    const config = getConfig();
    log('系统', `账号在线保障已启动：微信授权到期前自动续期。掉线重登${config.offlineEnabled ? `等待 ${config.offlineDelaySeconds} 秒（微信续期或通过 NapCat 获取新 QQ Code）` : '关闭'}`);
}

function stopWxKeepAlive(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    for (const key of offlineRecoveries.keys()) cancelPendingRelogin(key);
    preflight.reset();
}

/** 掉线重登配置变更后重新读取一次，把当前生效策略写进系统日志。 */
function applyWxKeepAliveConfig(): void {
    const config = getConfig();
    if (!config.offlineEnabled) {
        for (const key of offlineRecoveries.keys()) {
            cancelPendingRelogin(key);
            setAccountRuntimeState(key, 'offline', { onlyFrom: ['relogin_waiting'] });
        }
    }
    log('系统', `账号在线保障配置已更新：掉线重登${config.offlineEnabled ? `等待 ${config.offlineDelaySeconds} 秒` : '关闭'}，到期前 ${Math.round(RENEW_AHEAD_MS / 60000)} 分钟只滚动授权令牌`);
}

/**
 * 撤掉某个账号「等待重登」的定时器。用户手动点停止时必须调用，否则定时器到点
 * 会把他刚停掉的账号又拉起来 —— 从用户视角就是「点了停止却自己启动了」。
 * 返回是否真的撤掉了一个待执行的定时器。
 */
function cancelPendingRelogin(accountId: unknown): boolean {
    const key = String(accountId);
    const recovery = offlineRecoveries.get(key);
    if (!recovery) return false;
    if (recovery.handle) clearTimeout(recovery.handle);
    offlineRecoveries.delete(key);
    return true;
}

module.exports = {
    startWxKeepAlive,
    stopWxKeepAlive,
    applyWxKeepAliveConfig,
    notifyAccountOffline,
    cancelPendingRelogin,
    refreshAndMaybeRestart,
    runCodePreflight,
    isCredentialDue,
    createPreflightGovernor,
    canRecoverAccount,
    getConfig,
    RENEW_AHEAD_MS,
    PREFLIGHT_WINDOW_MS,
    PREFLIGHT_RETRY_MS,
    PREFLIGHT_MIN_INTERVAL_MS,
    MAX_DAILY_PREFLIGHT_FAILURES,
    MAX_CONSECUTIVE_FAILURES,
    OFFLINE_RECONNECT_INTERVAL_MS,
};
