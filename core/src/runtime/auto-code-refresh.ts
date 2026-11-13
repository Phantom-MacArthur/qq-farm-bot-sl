export {};

const { createScheduler } = require('../services/scheduler');
const wxLoginAdapter = require('../services/wx-login/adapter');

interface AutoCodeRefreshDeps {
    store: any;
    getAccounts: () => any;
    addOrUpdateAccount: (account: any) => any;
    resolveWorkerControls: () => { restartWorker?: (account: any) => void };
    log: (tag: string, msg: string, extra?: any) => void;
    addAccountLog: (action: string, msg: string, accountId?: string, accountName?: string, extra?: any) => void;
}

interface NormalizedConfig {
    enabled: boolean;
    intervalMinutes: number;
    maxRetries: number;
}

// 只有这些失败原因才说明是登录态问题，需要占用当天的自动重登额度。
const RECOVERY_REASON_PREFIXES = ['ws_400', 'kickout:', 'ws_reconnect_failed:', 'refresh_failed', 'disconnect:'];
// 显式的人工/启动路径不受“手动停止”门禁限制；其余（定时、掉线恢复）一律让路。
const EXPLICIT_REFRESH_REASONS = new Set(['manual', 'manual_start', 'startup']);

function createAutoCodeRefreshService(deps: AutoCodeRefreshDeps) {
    const {
        store,
        getAccounts,
        addOrUpdateAccount,
        resolveWorkerControls,
        log,
        addAccountLog,
    } = deps;

    const scheduler = createScheduler('auto_code_refresh');
    const recoveryState = new Map<string, { date: string; attempts: number }>();
    /**
     * 已手动停止的账号。定时器不得把用户明确停掉的账号重新拉起，
     * 因此这份名单只屏蔽取码轮询和掉线重登，不影响不会启动账号的凭证保活。
     */
    const pollingPaused = new Set<string>();

    function isPollingPaused(accountId: string | number): boolean {
        return pollingPaused.has(String(accountId || ''));
    }

    /** 手动停止：退出轮询，并撤销已排队的刷新/重登；凭证保活继续，否则下次启动只能重新扫码。 */
    function pausePolling(accountId: string): void {
        const key = String(accountId || '');
        if (!key) return;
        pollingPaused.add(key);
        scheduler.clear(`refresh_${key}`);
        scheduler.clear(`relogin_${key}`);
    }

    /** 启动/重启账号：重新接受定时刷新。 */
    function resumePolling(accountId: string): void {
        const key = String(accountId || '');
        if (key) pollingPaused.delete(key);
    }

    function findAccount(accountId: string): any {
        const data = getAccounts();
        const accounts = Array.isArray(data && data.accounts) ? data.accounts : [];
        return accounts.find((acc: any) => String(acc.id) === String(accountId));
    }

    /** 重试额度按自然日重置，跨天后旧计数直接作废。 */
    function getRecoveryState(accountId: string) {
        const date = new Date().toISOString().slice(0, 10);
        const key = String(accountId);
        const current = recoveryState.get(key);
        if (!current || current.date !== date) {
            const fresh = { date, attempts: 0 };
            recoveryState.set(key, fresh);
            return fresh;
        }
        return current;
    }

    function isRecoveryReason(reason: string): boolean {
        const text = String(reason || '');
        return RECOVERY_REASON_PREFIXES.some(prefix => text.includes(prefix));
    }

    function normalizeConfig(): NormalizedConfig {
        const cfg = store.getAutoCodeRefresh ? store.getAutoCodeRefresh() : null;
        return {
            enabled: cfg && cfg.enabled === true,
            intervalMinutes: Math.max(1, Math.min(1440, Number(cfg && cfg.intervalMinutes) || 2)),
            maxRetries: Math.max(1, Math.min(100, Number(cfg && cfg.maxRetries) || 8)),
        };
    }

    async function requestFarmCode(account: any): Promise<string> {
        const wxid = String(account && account.wxid || '').trim();
        if (!wxid) throw new Error('账号缺少 wxid，无法自动刷新 Code');
        if (!account.loginBuffer) throw new Error('账号缺少应用宝登录凭据，请重新扫码登录');

        // 主动续期后再取码：等到 loginBuffer 失效才刷新时，refreshtoken 往往已经过期。
        if (account.refreshtoken) {
            const keepalive = await wxLoginAdapter.keepWxCredentialAlive(account);
            if (!keepalive.Success) throw new Error(keepalive.Message || '微信凭证续期失败');
        }
        const local = await wxLoginAdapter.getFarmCode(wxid, { accountId: account.id });
        if (local.Success && local.Data && local.Data.code) return String(local.Data.code);
        throw new Error(local.Message || '进程内获取 Code 失败');
    }

    async function refreshAccountCode(accountId: string, reason = 'timer'): Promise<boolean> {
        const account = findAccount(accountId);
        if (!account) return false;

        // 停止命令与 ws_400 等消息可能交错：已手动停止的账号不再做定时/恢复取码。
        if (isPollingPaused(accountId) && !EXPLICIT_REFRESH_REASONS.has(String(reason || ''))) {
            log('系统', `自动刷新 Code 已跳过: ${account.name} 已手动停止`, {
                accountId: String(account.id),
                accountName: account.name,
                reason,
            });
            return false;
        }

        const recovery = isRecoveryReason(reason) ? getRecoveryState(accountId) : null;
        const config = normalizeConfig();
        if (recovery && recovery.attempts >= config.maxRetries) {
            addAccountLog('auto_relogin_blocked', '已达到每日自动重试次数上限，请检查网络或重新扫码',
                account.id, account.name, { reason, ...recovery });
            return false;
        }
        if (recovery) recovery.attempts += 1;

        try {
            const code = await requestFarmCode(account);
            const nextAccount = { ...account, code };
            addOrUpdateAccount(nextAccount);

            const controls = typeof resolveWorkerControls === 'function' ? (resolveWorkerControls() || {}) : {};
            if (typeof controls.restartWorker === 'function') controls.restartWorker(nextAccount);

            addAccountLog('auto_code_refresh', `自动刷新 Code 成功，已重启账号: ${account.name}`,
                account.id, account.name, { reason });
            log('系统', `自动刷新 Code 成功: ${account.name}`, {
                accountId: String(account.id),
                accountName: account.name,
            });
            return true;
        } catch (err: any) {
            addAccountLog('auto_code_refresh_failed', `自动刷新 Code 失败: ${err.message}`,
                account.id, account.name, { reason });
            log('错误', `自动刷新 Code 失败: ${account.name} - ${err.message}`, {
                accountId: String(account.id),
                accountName: account.name,
            });
            return false;
        }
    }

    function scheduleAccount(accountId: string): void {
        const cfg = normalizeConfig();
        const taskName = `refresh_${String(accountId || '')}`;
        const keepaliveTaskName = `wx_keepalive_${String(accountId || '')}`;
        scheduler.clear(taskName);
        scheduler.clear(keepaliveTaskName);

        const account = findAccount(accountId);
        // 定时取码与凭证保活只适用于微信扫码账号；rescheduleAll() 会遍历全部账号，
        // QQ 账号必须静默返回，否则会留下无意义的任务名。
        if (!account || account.platform !== 'wx') return;

        if (!String(account.wxid || '').trim()) {
            log('系统', '自动刷新 Code 未启动: 账号缺少 wxid', {
                accountId: String(accountId),
                accountName: account.name || '',
            });
            return;
        }

        if (account.loginBuffer && account.refreshtoken) {
            scheduler.setIntervalTask(keepaliveTaskName, wxLoginAdapter.CREDENTIAL_KEEPALIVE_INTERVAL_MS, async () => {
                const latest = findAccount(accountId);
                if (!latest) return;
                const result = await wxLoginAdapter.keepWxCredentialAlive(latest);
                if (!result.Success) {
                    log('错误', `微信凭证保活失败: ${latest.name} - ${result.Message || '未知错误'}`, {
                        accountId: String(accountId),
                        accountName: latest.name,
                    });
                }
            }, { preventOverlap: true });
        }

        if (!cfg.enabled) return;

        if (isPollingPaused(accountId)) {
            log('系统', `自动刷新 Code 未启动: ${account.name} 已手动停止`, {
                accountId: String(accountId),
                accountName: account.name,
            });
            return;
        }

        scheduler.setIntervalTask(taskName, cfg.intervalMinutes * 60000, () => {
            void refreshAccountCode(accountId, 'timer');
        }, { preventOverlap: true });

        log('系统', `自动刷新 Code 已启用: ${account.name}，间隔 ${cfg.intervalMinutes} 分钟`, {
            accountId: String(accountId),
            accountName: account.name,
        });
    }

    function rescheduleAll(): void {
        scheduler.clearAll();
        const data = getAccounts();
        const accounts = Array.isArray(data && data.accounts) ? data.accounts : [];
        for (const account of accounts) {
            scheduleAccount(account.id);
        }
    }

    function stopAccount(accountId: string): void {
        pollingPaused.delete(String(accountId || ''));
        scheduler.clear(`refresh_${String(accountId || '')}`);
        scheduler.clear(`wx_keepalive_${String(accountId || '')}`);
        scheduler.clear(`relogin_${String(accountId || '')}`);
    }

    /** 掉线后的延迟重登：复用定时刷新间隔，账号级只保留一个待执行任务。 */
    function scheduleRelogin(accountId: string, reason = 'offline'): boolean {
        // 手动停止优先于一切恢复理由，否则“停掉”会被上一句掉线事件推翻。
        if (isPollingPaused(accountId)) return false;
        const cfg = normalizeConfig();
        if (!cfg.enabled) return false;
        const account = findAccount(accountId);
        if (!account || !account.loginBuffer) return false;
        const recovery = getRecoveryState(accountId);
        if (recovery.attempts >= cfg.maxRetries) {
            addAccountLog('auto_relogin_blocked', '已达到每日自动重试次数上限，请检查网络或重新扫码',
                account.id, account.name, { reason, ...recovery });
            return false;
        }
        const taskName = `relogin_${String(accountId || '')}`;
        scheduler.clear(taskName);
        scheduler.setTimeoutTask(taskName, cfg.intervalMinutes * 60000, () => {
            void refreshAccountCode(accountId, reason);
        });
        log('系统', `账号 ${account.name} 将在 ${cfg.intervalMinutes} 分钟后自动刷新凭证并重登`, {
            accountId: String(accountId),
            accountName: account.name,
            reason,
        });
        return true;
    }

    return {
        refreshAccountCode,
        scheduleAccount,
        rescheduleAll,
        stopAccount,
        pausePolling,
        resumePolling,
        isPollingPaused,
        scheduleRelogin,
    };
}

module.exports = {
    createAutoCodeRefreshService,
};
