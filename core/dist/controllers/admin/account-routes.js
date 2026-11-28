"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Account CRUD routes, account-logs, logs, and settings routes.
 */
const store = require('../../models/store');
const { addOrUpdateAccount, deleteAccount } = store;
const { findAccountByRef } = require('../../services/account-resolver');
const { updateRuntimeConfig, getRuntimeConfig, getDefaultSystemConfig, getDevicePresets, getTimeZoneOptions } = require('../../config/config');
const wxLoginAdapter = require('../../services/wx-login/adapter');
const { getAccId, getAccountIds, handleApiError, getAccountList, resolveAccId, } = require('./middleware');
/** 账号列表对外投影：只下发「能否免扫码续期」的判定结果与续期账本，不下发凭证明文。 */
function toPublicAccountsPayload(data, canPreflight, stats, canRecover) {
    const PRIVATE_CREDENTIAL_KEYS = ['refreshtoken', 'accesstoken', 'loginBuffer'];
    const emptyPublicStats = () => ({ date: '', lastSuccessAt: 0, lastFailureAt: 0, successesToday: 0, failuresToday: 0 });
    const accounts = Array.isArray(data && data.accounts) ? data.accounts : [];
    return {
        ...(data || {}),
        accounts: accounts.map((account) => {
            const safe = { ...(account || {}) };
            for (const key of PRIVATE_CREDENTIAL_KEYS)
                delete safe[key];
            safe.wxPreflightSupported = typeof canPreflight === 'function' ? !!canPreflight(account) : false;
            // QQ 账号不走微信续期机制，不下发这个字段，避免面板误渲染。
            if (String(safe.platform || '') === 'wx') {
                // 「能不能滚 token」和「掉线后能不能免扫码自愈」不是同一件事：只有
                // loginBuffer 的账号滚不了 token（wxPreflightSupported=false），但换 Code
                // 完全没问题，掉线重登照样会成功并写进自动续期账本。两个标记分开下发，
                // 面板才不会把「有账本但滚不了 token」的账号整段隐藏。
                safe.wxCanRecover = typeof canRecover === 'function' ? !!canRecover(account) : false;
                const recorded = stats && stats[String(safe.id ?? '')];
                safe.wxPreflightStats = recorded && typeof recorded === 'object'
                    ? { ...emptyPublicStats(), ...recorded }
                    : emptyPublicStats();
            }
            return safe;
        }),
    };
}
/** 账号 Code 自动监听：聚合微信凭证到期与 QQ 掉线日志，给出每账号的补 Code 状态。 */
function buildProviderCodeHealth(ctx) {
    const { buildCodeHealthSnapshot } = require('../../services/code-watch');
    const accounts = store.getAccounts().accounts || [];
    const rawLogs = ctx.provider.getAccountLogs ? ctx.provider.getAccountLogs(200) : [];
    return buildCodeHealthSnapshot(accounts, {
        accountLogs: Array.isArray(rawLogs) ? rawLogs : [],
        isAccountRunning: (id) => ctx.provider.getAccountRuntime?.(id)?.online
            ?? !!ctx.provider.isAccountRunning?.(id),
    });
}
function mountAccountRoutes(app, ctx) {
    // API: 账号管理
    app.get('/api/accounts', (req, res) => {
        try {
            const data = ctx.provider.getAccounts();
            // 只把「能不能免扫码恢复」的判定结果发给浏览器，不下发长效凭证明文。
            // 两个口径都要发：wxPreflightSupported = 能滚 token（wxid + refreshtoken），
            // wxCanRecover = 掉线后能免扫码换 Code（再加上只有 loginBuffer 的情况），
            // 后者与 wx-keepalive 的 canRecoverAccount 完全同一个函数。
            // 同时附带自动续期账本快照（仅时间戳与次数），供卡片显示无人值守结果。
            const { hasWxCredential } = require('../../services/wx-credential');
            const { canRecoverAccount } = require('../../services/wx-keepalive');
            const { getPreflightStatsSnapshot } = require('../../services/preflight-stats');
            res.json({
                ok: true,
                data: toPublicAccountsPayload(data, hasWxCredential, getPreflightStatsSnapshot(), canRecoverAccount),
            });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    // API: Code 自动监听快照（账号管理页 10 秒轮询；路由必须在 :id 之前注册）
    app.get('/api/accounts/code-health', (_req, res) => {
        try {
            res.json({ ok: true, data: buildProviderCodeHealth(ctx) });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    // API: 手动续期（全链路：滚 token -> 换 loginBuffer -> 换游戏 Code）
    app.post('/api/accounts/:id/renew', async (req, res) => {
        try {
            const { refreshAndMaybeRestart } = require('../../services/wx-keepalive');
            const accountId = resolveAccId(ctx, req.params.id) || String(req.params.id || '');
            const ok = await refreshAndMaybeRestart(accountId, 'manual');
            res.json({ ok, data: { accountId, renewed: !!ok } });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    // API: 刷新 Code（只换 Code，不滚 token 不重启连接）
    app.post('/api/accounts/:id/refresh-code', async (req, res) => {
        try {
            const { ensureFreshGameCode } = require('../../services/wx-credential');
            const accountId = resolveAccId(ctx, req.params.id) || String(req.params.id || '');
            const result = await ensureFreshGameCode(accountId);
            res.json({ ok: !!result, data: result });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    // API: 自动补 Code（微信免扫码换码 / QQ 尽力重签），失败则引导重新扫码或手填 Code
    app.post('/api/accounts/:id/auto-fix-code', async (req, res) => {
        try {
            const { autoFixAccountCode } = require('../../services/code-watch');
            const { ensureFreshGameCode } = require('../../services/wx-credential');
            const { tryRefreshQqGameCode } = require('../../services/qq-credential');
            const accountId = resolveAccId(ctx, req.params.id) || String(req.params.id || '');
            const accounts = ctx.provider.getAccounts().accounts || [];
            const health = buildProviderCodeHealth(ctx);
            const target = (health.items || []).find((entry) => String(entry.accountId) === accountId);
            const result = await autoFixAccountCode(accountId, {
                getAccount: (id) => accounts.find((account) => String(account.id) === id) || null,
                latestLogAction: String(target && target.latestLogAction || ''),
                ensureFreshGameCode,
                tryRefreshQqGameCode,
                isAccountRunning: (id) => !!(ctx.provider.isAccountRunning && ctx.provider.isAccountRunning(id)),
                restartAccount: (id) => ctx.provider.restartAccount(id),
                addAccountLog: (...args) => {
                    if (ctx.provider.addAccountLog)
                        ctx.provider.addAccountLog(...args);
                },
            });
            res.json({ ok: result.ok, ...(result.ok ? {} : { error: result.error }), data: result });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    // API: 续期微信授权（批量）。返回每个账号的结果，前端据此提示成功/失败数量。
    // 与启动前换码一致：优先用长效 loginBuffer 直接换 Code，只有失效时才滚动
    // refreshtoken，避免每次点按钮都消耗一次性滚动凭证导致失败。
    async function refreshWxCredentials(req, res) {
        try {
            const { hasRenewableCredential, ensureFreshGameCode } = require('../../services/wx-credential');
            const accounts = (ctx.provider.getAccounts().accounts || []);
            const wxAccounts = accounts.filter((account) => String(account.platform || '') === 'wx');
            const targetAccounts = wxAccounts.filter((account) => hasRenewableCredential(account));
            if (targetAccounts.length === 0) {
                return res.json({
                    ok: false,
                    error: wxAccounts.length === 0 ? '当前没有微信账号' : '没有可续期的微信账号，请重新扫码登录',
                    data: { total: 0, success: 0, failed: 0, skipped: wxAccounts.length },
                });
            }
            const results = [];
            for (const account of targetAccounts) {
                const result = await ensureFreshGameCode(account.id);
                results.push({
                    accountId: String(account.id),
                    name: result.accountName,
                    ok: result.ok,
                    error: result.ok ? '' : (result.error || '续期失败'),
                });
            }
            const success = results.filter(item => item.ok).length;
            const failed = results.length - success;
            if (ctx.provider.addAccountLog) {
                const detail = results.map(item => `${item.name}${item.ok ? '✓' : '✗'}`).join('、');
                ctx.provider.addAccountLog(failed === 0 ? 'refresh_wx_credentials' : 'refresh_wx_credentials_failed', `续期微信授权：成功 ${success} 个，失败 ${failed} 个（${detail}）`, '', '');
            }
            res.json({
                ok: failed === 0,
                ...(failed > 0 ? { error: `${failed} 个账号续期失败` } : {}),
                data: {
                    total: results.length,
                    success,
                    failed,
                    skipped: wxAccounts.length - targetAccounts.length,
                    results,
                },
            });
        }
        catch (e) {
            handleApiError(res, e);
        }
    }
    app.post('/api/accounts/refresh-wx-credentials', refreshWxCredentials);
    app.post('/api/accounts/refresh-wx-codes', refreshWxCredentials);
    // API: 更新账号备注（兼容旧接口）
    app.post('/api/account/remark', (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const rawRef = body.id || body.accountId || body.uin || req.headers['x-account-id'];
            const accountList = getAccountList(ctx);
            const target = findAccountByRef(accountList, rawRef);
            if (!target || !target.id) {
                return res.status(404).json({ ok: false, error: 'Account not found' });
            }
            const remark = String(body.remark !== undefined ? body.remark : body.name || '').trim();
            if (!remark) {
                return res.status(400).json({ ok: false, error: 'Missing remark' });
            }
            const accountId = String(target.id);
            const data = addOrUpdateAccount({ id: accountId, name: remark });
            if (ctx.provider && typeof ctx.provider.setRuntimeAccountName === 'function') {
                ctx.provider.setRuntimeAccountName(accountId, remark);
            }
            if (ctx.provider && ctx.provider.addAccountLog) {
                ctx.provider.addAccountLog('update', `更新账号备注: ${remark}`, accountId, remark);
            }
            res.json({ ok: true, data: store.maskWxCredentialsForClient(data) });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    app.post('/api/accounts', async (req, res) => {
        try {
            const rawBody = (req.body && typeof req.body === 'object') ? req.body : {};
            const requestedName = typeof rawBody.name === 'string' ? rawBody.name.trim() : '';
            // 微信凭证只能由服务端写入，客户端提交的同名字段先整体丢弃。
            const clientBody = store.stripProtectedWxCredentials(rawBody);
            const body = typeof clientBody.name === 'string' ? { ...clientBody, name: requestedName } : clientBody;
            if (!requestedName) {
                return res.status(400).json({ ok: false, error: '账号备注不能为空' });
            }
            const visibleAccounts = getAccountList(ctx);
            const remarkMatchedAccount = !body.id && requestedName
                ? visibleAccounts.find((account) => String(account.name || '').trim() === requestedName)
                : null;
            const isRemarkRelogin = !!remarkMatchedAccount;
            const updateRef = body.id || (remarkMatchedAccount && remarkMatchedAccount.id) || '';
            const isUpdate = !!updateRef;
            const resolvedUpdateId = isUpdate ? resolveAccId(ctx, updateRef) : '';
            const payload = isUpdate ? { ...body, id: resolvedUpdateId || String(updateRef) } : { ...body };
            // wxSessionId 只是本次扫码的一次性凭据，不是账号字段，不能落盘。
            const wxSessionId = String(payload.wxSessionId || '').trim();
            delete payload.wxSessionId;
            let wasRunning = false;
            if (isUpdate && ctx.provider.isAccountRunning) {
                wasRunning = ctx.provider.isAccountRunning(payload.id);
            }
            const oldAccount = isUpdate
                ? (ctx.provider.getAccounts().accounts || []).find((a) => a.id === String(payload.id))
                : null;
            // 只有携带尚未消费的待绑定扫码会话时才能写入凭证。
            let boundWxInfo = null;
            if (wxSessionId) {
                if (isUpdate && !oldAccount) {
                    return res.status(404).json({ ok: false, error: '待重新登录的账号不存在' });
                }
                boundWxInfo = wxLoginAdapter.peekPendingWxInfo(wxSessionId, String(payload.wxid || ''), oldAccount?.id);
                if (!boundWxInfo) {
                    return res.status(400).json({ ok: false, error: '扫码会话已失效或与当前账号不匹配，请重新扫码后保存' });
                }
                payload.loginBuffer = boundWxInfo.loginBuffer;
                payload.refreshtoken = boundWxInfo.refreshtoken;
                payload.accesstoken = boundWxInfo.accesstoken;
                payload.expires_in = boundWxInfo.expiresIn ?? 0;
                payload.expires_at = boundWxInfo.expiresAt ?? 0;
                payload.wxCredentialRefreshedAt = Date.now();
                payload.wxCredentialLastAttemptAt = payload.wxCredentialRefreshedAt;
                payload.wxCredentialRefreshError = '';
                payload.wxCredentialNeedsRescan = false;
            }
            else if (isUpdate && payload.wxid !== undefined && String(oldAccount?.wxid || '') !== String(payload.wxid || '')) {
                // 换绑微信号却没带新会话时，必须清掉旧凭证，否则会用上一个微信号的登录凭据操作该账号。
                payload.loginBuffer = '';
                payload.refreshtoken = '';
                payload.accesstoken = '';
            }
            // 检查是否仅修改了备注信息
            let onlyRemarkChanged = false;
            if (isUpdate && oldAccount) {
                // 检查 payload 中是否只包含 id 和 name 字段
                const payloadKeys = Object.keys(payload);
                const onlyIdAndName = payloadKeys.length === 2 && payloadKeys.includes('id') && payloadKeys.includes('name');
                if (onlyIdAndName) {
                    onlyRemarkChanged = true;
                }
            }
            function persistAccount() {
                const data = addOrUpdateAccount(payload);
                if (boundWxInfo) {
                    wxLoginAdapter.consumePendingWxInfo(wxSessionId, boundWxInfo.wxid, oldAccount?.id);
                }
                return data;
            }
            let data;
            if (boundWxInfo && oldAccount) {
                const { withAccountCredentialLock } = require('../../services/wx-credential');
                data = await withAccountCredentialLock(oldAccount.id, () => {
                    const exists = (store.getAccounts().accounts || []).some((a) => a.id === oldAccount.id);
                    const pending = wxLoginAdapter.peekPendingWxInfo(wxSessionId, boundWxInfo.wxid, oldAccount.id);
                    return exists && pending ? persistAccount() : null;
                });
                if (!data) {
                    return res.status(400).json({ ok: false, error: '账号或扫码会话已失效，请刷新后重新扫码' });
                }
            }
            else {
                data = persistAccount();
            }
            if (ctx.provider.addAccountLog) {
                const accountId = isUpdate ? String(payload.id) : String((data.accounts.at(-1) || {}).id || '');
                const accountName = payload.name || '';
                ctx.provider.addAccountLog(isUpdate ? 'update' : 'add', isRemarkRelogin
                    ? `通过备注重新登录账号: ${accountName || accountId}`
                    : isUpdate ? `更新账号: ${accountName || accountId}` : `添加账号: ${accountName || accountId}`, accountId, accountName);
            }
            // 如果是新增，自动启动
            if (!isUpdate) {
                const newAcc = data.accounts.at(-1);
                if (newAcc) {
                    // startAccount 可能是异步取码流程，这里保持原有的不阻塞响应语义，仅记录失败
                    void Promise.resolve(ctx.provider.startAccount(newAcc.id)).catch((error) => {
                        if (ctx.provider.addAccountLog) {
                            ctx.provider.addAccountLog('start_error', `账号启动失败: ${error?.message || error}`, String(newAcc.id), newAcc.name || '');
                        }
                    });
                }
            }
            else if (isRemarkRelogin || boundWxInfo) {
                // 扫码重登也适用于已停止的账号，编辑时用账号 ID 定向更新。
                await ctx.provider.restartAccount(payload.id);
            }
            else if (wasRunning && !onlyRemarkChanged) {
                // 如果是更新，且之前在运行，且不是仅修改备注，则重启
                await ctx.provider.restartAccount(payload.id);
            }
            res.json({ ok: true, data: store.maskWxCredentialsForClient(data) });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    app.delete('/api/accounts/:id', async (req, res) => {
        try {
            const resolvedId = resolveAccId(ctx, req.params.id) || String(req.params.id || '');
            const before = ctx.provider.getAccounts();
            const target = findAccountByRef(before.accounts || [], req.params.id);
            // 账号要被删掉，任何一条「等待重登」的定时器都必须先撤掉，
            // 否则到点它会用一个已经不存在的账号去换 Code 并把进程拉起来。
            try {
                const { cancelPendingRelogin } = require('../../services/wx-keepalive');
                cancelPendingRelogin(resolvedId);
            }
            catch { /* 保活模块不可用时不影响删除 */ }
            await ctx.provider.stopAccount(resolvedId);
            // 先拆调度再删账号：一旦记录没了，就再也没人能根据 id 找到这个账号的任务了。
            if (ctx.provider && typeof ctx.provider.unscheduleAutoCodeRefresh === 'function') {
                ctx.provider.unscheduleAutoCodeRefresh(resolvedId);
            }
            const data = deleteAccount(resolvedId);
            if (ctx.provider.addAccountLog) {
                ctx.provider.addAccountLog('delete', `删除账号: ${(target && target.name) || req.params.id}`, resolvedId, target ? target.name : '');
            }
            res.json({ ok: true, data: store.maskWxCredentialsForClient(data) });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    // API: 账号日志
    app.get('/api/account-logs', (req, res) => {
        try {
            const limit = Number.parseInt(req.query.limit) || 100;
            let list = ctx.provider.getAccountLogs ? ctx.provider.getAccountLogs(limit) : [];
            if (!Array.isArray(list))
                list = [];
            // 与当前 web 前端保持一致：直接返回数组
            res.json(list);
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    // API: 日志
    app.get('/api/logs', (req, res) => {
        const queryAccountIdRaw = (req.query.accountId || '').toString().trim();
        const id = queryAccountIdRaw ? (queryAccountIdRaw === 'all' ? '' : resolveAccId(ctx, queryAccountIdRaw)) : getAccId(ctx, req);
        // 如果没有指定账号ID，获取所有账号的日志
        if (!id) {
            const accountIds = getAccountIds(ctx);
            const allLogs = [];
            const options = {
                limit: Number.parseInt(req.query.limit) || 100,
                tag: req.query.tag || '',
                module: req.query.module || '',
                event: req.query.event || '',
                keyword: req.query.keyword || '',
                isWarn: req.query.isWarn,
                timeFrom: req.query.timeFrom || '',
                timeTo: req.query.timeTo || '',
            };
            for (const accId of accountIds) {
                const logs = ctx.provider.getLogs(accId, options);
                if (Array.isArray(logs)) {
                    allLogs.push(...logs);
                }
            }
            // 按时间排序并限制数量
            allLogs.sort((a, b) => (b.time || 0) - (a.time || 0));
            const limitedLogs = allLogs.slice(0, options.limit);
            return res.json({ ok: true, data: limitedLogs });
        }
        // 指定了账号ID且通过权限检查，返回该账号的日志
        const options = {
            limit: Number.parseInt(req.query.limit) || 100,
            tag: req.query.tag || '',
            module: req.query.module || '',
            event: req.query.event || '',
            keyword: req.query.keyword || '',
            isWarn: req.query.isWarn,
            timeFrom: req.query.timeFrom || '',
            timeTo: req.query.timeTo || '',
        };
        const list = ctx.provider.getLogs(id, options);
        res.json({ ok: true, data: list });
    });
    // API: 清空当前账号运行日志
    app.delete('/api/logs', (req, res) => {
        const id = getAccId(ctx, req);
        if (!id)
            return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        try {
            const data = ctx.provider.clearLogs(id);
            if (ctx.io && ctx.provider && typeof ctx.provider.getLogs === 'function') {
                const accountLogs = ctx.provider.getLogs(id, { limit: 100 });
                ctx.io.to(`account:${id}`).emit('logs:snapshot', {
                    accountId: id,
                    logs: Array.isArray(accountLogs) ? accountLogs : [],
                });
                const allLogs = ctx.provider.getLogs('', { limit: 100 });
                ctx.io.to('account:all').emit('logs:snapshot', {
                    accountId: 'all',
                    logs: Array.isArray(allLogs) ? allLogs : [],
                });
            }
            res.json({ ok: true, data });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    // API: 设置页统一保存（单次写入；运行中账号等待 worker revision ACK）
    app.post('/api/settings/save', async (req, res) => {
        const id = getAccId(ctx, req);
        if (!id) {
            return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        }
        try {
            const data = await ctx.provider.saveSettings(id, req.body || {});
            const unconfirmed = data && data.status === 'unconfirmed';
            res.status(unconfirmed ? 202 : 200).json({
                ok: !unconfirmed,
                saved: !!(data && data.saved),
                stopped: !!(data && data.status === 'stopped'),
                confirmed: !!(data && data.confirmed),
                unconfirmed: !!unconfirmed,
                status: data?.status,
                code: unconfirmed ? data.confirmationError?.code : undefined,
                error: unconfirmed ? (data.confirmationError?.message || '配置已保存，但 worker 尚未确认应用') : undefined,
                data: data || {},
            });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    // API: 设置面板主题
    app.post('/api/settings/theme', async (req, res) => {
        try {
            const theme = String((req.body || {}).theme || '');
            const data = await ctx.provider.setUITheme(theme);
            res.json({ ok: true, data: data || {} });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    // API: 获取通知默认设置
    app.get('/api/settings/offline-reminder/default', (_req, res) => {
        try {
            const def = typeof store.getOfflineReminderDefault === 'function' ? store.getOfflineReminderDefault() : null;
            res.json({ ok: true, data: { exists: !!def, config: def || null } });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    // API: 保存通知默认设置
    app.put('/api/settings/offline-reminder/default', async (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const cfg = (body.config && typeof body.config === 'object') ? body.config : body;
            const data = typeof store.setOfflineReminderDefault === 'function' ? store.setOfflineReminderDefault(cfg) : null;
            res.json({ ok: true, data: { exists: !!data, config: data || null } });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    // API: 将通知默认设置应用到当前账号
    app.post('/api/settings/offline-reminder/default/apply', async (req, res) => {
        try {
            const accountId = getAccId(ctx, req);
            if (!accountId) {
                return res.status(400).json({ ok: false, error: '请先选择账号' });
            }
            const data = typeof store.applyOfflineReminderDefault === 'function' ? store.applyOfflineReminderDefault(accountId) : null;
            if (!data) {
                return res.status(400).json({ ok: false, error: '尚未保存通知默认设置' });
            }
            ctx.provider.broadcastConfig?.(accountId);
            res.json({ ok: true, data });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    // API: 保存下线提醒配置（按账号）
    app.post('/api/settings/offline-reminder', async (req, res) => {
        try {
            const accountId = getAccId(ctx, req);
            if (!accountId) {
                return res.status(400).json({ ok: false, error: '请先选择账号' });
            }
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const data = store.setOfflineReminder ? store.setOfflineReminder(body, accountId) : {};
            ctx.provider.broadcastConfig?.(accountId);
            res.json({ ok: true, data: data || {} });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    // API: 测试下线提醒推送（不落盘）
    app.post('/api/settings/offline-reminder/test', async (req, res) => {
        try {
            const accountId = getAccId(ctx, req);
            const saved = (accountId && store.getOfflineReminder) ? store.getOfflineReminder(accountId) : {};
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const cfg = { ...(saved || {}), ...body };
            const channel = String(cfg.channel || '').trim().toLowerCase();
            const endpoint = String(cfg.endpoint || '').trim();
            const secret = String(cfg.secret || '').trim();
            const credentials = (cfg.channelCredentials && typeof cfg.channelCredentials === 'object') ? cfg.channelCredentials : {};
            const entry = credentials[channel] || {};
            const token = String(entry.token || cfg.token || '').trim();
            const wxPusherUid = String(entry.wxPusherUid || cfg.wxPusherUid || '').trim();
            // 与真实下线推送保持一致：标题取账号备注，不再单独配置。
            const account = (ctx.provider.getAccounts().accounts || []).find((a) => String(a?.id) === String(accountId));
            const accountName = String(account?.name || '').trim();
            const accountNick = String(account?.nick || '').trim() || accountName;
            const titleBase = String(cfg.title || '').trim() || accountName || '农场下线';
            const msgBase = String(cfg.msg || '').trim();
            if (!channel) {
                return res.status(400).json({ ok: false, error: '推送渠道不能为空' });
            }
            if (channel === 'webhook' && !endpoint) {
                return res.status(400).json({ ok: false, error: 'Webhook 渠道需要填写接口地址' });
            }
            if (channel === 'dingtalk' && !endpoint && !token) {
                return res.status(400).json({ ok: false, error: '钉钉渠道需要填写 Webhook 地址' });
            }
            if (channel !== 'webhook' && channel !== 'dingtalk' && !token) {
                return res.status(400).json({ ok: false, error: '当前推送渠道需要填写 Token' });
            }
            if (channel === 'wxpusher_wechat' && !wxPusherUid) {
                return res.status(400).json({ ok: false, error: 'WxPusher 渠道需要填写接收者 UID' });
            }
            const now = new Date();
            const ts = now.toISOString().replace('T', ' ').slice(0, 19);
            const { sendNotification } = require('../../services/push');
            const notifications = [
                { type: 'offline', label: '账号下线', content: msgBase },
                { type: 'mysteryArrival', label: '神秘商店到访', content: String(cfg.mysteryMessages?.mysteryArrival || '').trim() },
                { type: 'mysteryPurchase', label: '神秘商店购买', content: String(cfg.mysteryMessages?.mysteryPurchase || '').trim() },
                { type: 'farmActivity', label: '农牧场动态', content: '' },
            ];
            const results = [];
            for (const notification of notifications) {
                try {
                    const payload = {
                        channel, endpoint, token, secret, wxPusherUid,
                        title: notification.type === 'farmActivity'
                            ? accountNick || notification.label
                            : [`${titleBase}（${notification.label}测试）`, notification.content].filter(Boolean).join(' '),
                        content: `这是一条${notification.label}测试消息。\n时间: ${ts}`,
                    };
                    const ret = await sendNotification(payload);
                    results.push({
                        type: notification.type,
                        label: notification.label,
                        ok: ret?.ok === true,
                        error: ret?.ok ? undefined : String(ret?.msg || '推送失败：无返回结果'),
                    });
                }
                catch (error) {
                    results.push({ type: notification.type, label: notification.label, ok: false, error: String(error?.message || '推送失败') });
                }
            }
            const failures = results.filter(result => !result.ok);
            if (failures.length) {
                return res.status(400).json({
                    ok: false,
                    error: `测试完成，${results.length - failures.length}/${results.length} 条成功；${failures.map(result => `${result.label}：${result.error}`).join('；')}`,
                    data: results,
                });
            }
            return res.json({ ok: true, data: results, message: '全部测试通知已发送' });
        }
        catch (e) {
            return handleApiError(res, e);
        }
    });
    // API: 获取配置
    app.get('/api/settings', async (req, res) => {
        try {
            const id = getAccId(ctx, req);
            // 直接从主进程的 store 读取，确保即使账号未运行也能获取配置
            const intervals = id ? store.getIntervals(id) : {};
            const strategy = id ? store.getPlantingStrategy(id) : null;
            const preferredSeed = id ? store.getPreferredSeed(id) : null;
            const friendQuietHours = id ? store.getFriendQuietHours(id) : null;
            const automation = id ? store.getSavedAutomation(id) : {};
            const stealDelaySeconds = id && (typeof store.getStealDelaySeconds === 'function') ? store.getStealDelaySeconds(id) : 0;
            const plantDelaySeconds = id && (typeof store.getPlantDelaySeconds === 'function') ? store.getPlantDelaySeconds(id) : 0;
            const fertilizerBuyOrganicCount = id && (typeof store.getFertilizerBuyOrganicCount === 'function') ? store.getFertilizerBuyOrganicCount(id) : 0;
            const fertilizerBuyOrganicThresholdHours = id && (typeof store.getFertilizerBuyOrganicThresholdHours === 'function') ? store.getFertilizerBuyOrganicThresholdHours(id) : 10;
            const fertilizerBuyNormalCount = id && (typeof store.getFertilizerBuyNormalCount === 'function') ? store.getFertilizerBuyNormalCount(id) : 0;
            const fertilizerBuyNormalThresholdHours = id && (typeof store.getFertilizerBuyNormalThresholdHours === 'function') ? store.getFertilizerBuyNormalThresholdHours(id) : 10;
            const fertilizerBuyCheckIntervalMinutes = id && (typeof store.getFertilizerBuyCheckIntervalMinutes === 'function') ? store.getFertilizerBuyCheckIntervalMinutes(id) : 30;
            const fertilizerBuyNormalCheckIntervalMinutes = id && typeof store.getFertilizerBuyNormalCheckIntervalMinutes === 'function'
                ? store.getFertilizerBuyNormalCheckIntervalMinutes(id) : fertilizerBuyCheckIntervalMinutes;
            const bagSeedPriority = id && (typeof store.getBagSeedPriority === 'function') ? store.getBagSeedPriority(id) : [];
            const bagSeedMultiLandReservationEnabled = id && (typeof store.getBagSeedMultiLandReservationEnabled === 'function') ? store.getBagSeedMultiLandReservationEnabled(id) : false;
            const bagSeedLandTypes = id && (typeof store.getBagSeedLandTypes === 'function') ? store.getBagSeedLandTypes(id) : {};
            const bagSeedFallbackStrategy = id && (typeof store.getBagSeedFallbackStrategy === 'function') ? store.getBagSeedFallbackStrategy(id) : 'level';
            const rankedSeedFallbackStrategy = id ? store.getRankedSeedFallbackStrategy(id) : '';
            const autoAcceptFriendMinLevel = id && (typeof store.getAutoAcceptFriendMinLevel === 'function') ? store.getAutoAcceptFriendMinLevel(id) : 0;
            const autoAcceptRequireOwnLevel = id && (typeof store.getAutoAcceptRequireOwnLevel === 'function') ? store.getAutoAcceptRequireOwnLevel(id) : false;
            const ui = store.getUI();
            const offlineReminder = (id && store.getOfflineReminder)
                ? store.getOfflineReminder(id)
                : (store.getOfflineReminderDefault ? store.getOfflineReminderDefault() : null)
                    || { channel: 'wxpusher', endpoint: '', token: '', secret: '', wxPusherUid: '', channelCredentials: {}, title: '', msg: '农场下线' };
            res.json({ ok: true, data: { intervals, strategy, preferredSeed, friendQuietHours, automation, stealDelaySeconds, plantDelaySeconds, fertilizerBuyOrganicCount, fertilizerBuyOrganicThresholdHours, fertilizerBuyNormalCount, fertilizerBuyNormalThresholdHours, fertilizerBuyCheckIntervalMinutes, fertilizerBuyNormalCheckIntervalMinutes, bagSeedPriority, bagSeedMultiLandReservationEnabled, bagSeedLandTypes, bagSeedFallbackStrategy, rankedSeedFallbackStrategy, autoAcceptFriendMinLevel, autoAcceptRequireOwnLevel, ui, offlineReminder } });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    app.get('/api/settings/default', (_req, res) => {
        try {
            const defaultConfig = store.getDefaultAccountConfig ? store.getDefaultAccountConfig() : null;
            if (!defaultConfig) {
                return res.status(500).json({ ok: false, error: '无法获取默认配置' });
            }
            res.json({ ok: true, data: defaultConfig });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    // API: 默认方案（单用户全局一份，跨账号复用策略/自动化）
    app.get('/api/settings/default-plan', (_req, res) => {
        try {
            res.json({ ok: true, data: store.getDefaultPlan() });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    app.put('/api/settings/default-plan', (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const data = store.setDefaultPlan(body.config || {}, { enabled: body.enabled !== false });
            res.json({ ok: true, data });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    // 将指定账号的当前配置设为默认方案
    app.post('/api/settings/default-plan/import', (req, res) => {
        const id = getAccId(ctx, req);
        if (!id) {
            return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        }
        try {
            const data = store.importDefaultPlanFromAccount(id);
            res.json({ ok: true, data });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    // 将默认方案应用到指定账号，并同步到运行中的 worker
    app.post('/api/settings/default-plan/apply', async (req, res) => {
        const id = getAccId(ctx, req);
        if (!id) {
            return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        }
        try {
            const data = store.applyDefaultPlan(id);
            if (ctx.provider && typeof ctx.provider.broadcastConfig === 'function') {
                ctx.provider.broadcastConfig(id);
            }
            res.json({ ok: true, data });
        }
        catch (e) {
            const status = e?.message === '尚未保存默认方案' ? 400 : 500;
            res.status(status).json({ ok: false, error: e?.message || '应用默认方案失败' });
        }
    });
    // 将默认方案重置为出厂默认配置
    app.post('/api/settings/default-plan/reset', (_req, res) => {
        try {
            const data = store.resetDefaultPlan();
            res.json({ ok: true, data });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    // API: 微信 code 定时刷新与自动重登设置（全局，对所有账号生效）
    app.get('/api/settings/auto-code-refresh', (_req, res) => {
        try {
            res.json({ ok: true, data: store.getAutoCodeRefresh() });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    app.post('/api/settings/auto-code-refresh', async (req, res) => {
        try {
            const result = await ctx.provider.saveAutoCodeRefresh(req.body || {});
            const data = result && result.autoCodeRefresh ? result.autoCodeRefresh : result;
            res.json({ ok: true, data: data || {} });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    app.post('/api/settings/auto-code-refresh/run', async (req, res) => {
        const id = getAccId(ctx, req);
        if (!id)
            return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        try {
            const data = await ctx.provider.refreshAccountCode(id);
            res.json({ ok: true, data: data || {} });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    app.get('/api/settings/device-presets', (_req, res) => {
        try {
            res.json({ ok: true, data: getDevicePresets() });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    app.get('/api/settings/system-config', (_req, res) => {
        try {
            res.json({
                ok: true,
                data: {
                    saved: store.getSystemConfig(),
                    default: getDefaultSystemConfig(),
                    current: getRuntimeConfig(),
                    timeZones: getTimeZoneOptions(),
                    loginSettings: store.getLoginSettings
                        ? store.getLoginSettings()
                        : { wechatQrLogin: true, qqQrLogin: false, napCatEndpoint: '', napCatSignature: '' },
                },
            });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    app.get('/api/settings/login-config', (_req, res) => {
        try {
            const loginSettings = store.getLoginSettings
                ? store.getLoginSettings()
                : { wechatQrLogin: true, qqQrLogin: false, napCatEndpoint: '', napCatSignature: '' };
            res.json({ ok: true, data: loginSettings });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    app.post('/api/settings/login-config', (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const loginSettings = store.setLoginSettings
                ? store.setLoginSettings({
                    wechatQrLogin: body.wechatQrLogin,
                    qqQrLogin: body.qqQrLogin,
                    napCatEndpoint: body.napCatEndpoint,
                    napCatSignature: body.napCatSignature,
                })
                : { wechatQrLogin: true, qqQrLogin: false, napCatEndpoint: '', napCatSignature: '' };
            res.json({ ok: true, data: loginSettings });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    app.post('/api/settings/system-config', (req, res) => {
        try {
            const { serverUrl, clientVersion, wxClientVersion, platform, os, timeZone, deviceInfo, autoCodeRefresh, autoStartAccounts } = req.body || {};
            const saved = store.setSystemConfig({ serverUrl, clientVersion, wxClientVersion, platform, os, timeZone, deviceInfo, autoCodeRefresh, autoStartAccounts });
            updateRuntimeConfig(saved);
            // 掉线重登策略改了要让保活模块重新读一次配置并写进系统日志；
            // ctx.provider 是 data-provider 的产物，没有这个方法，直接调保活模块。
            if (autoCodeRefresh !== undefined) {
                try {
                    const { applyWxKeepAliveConfig } = require('../../services/wx-keepalive');
                    applyWxKeepAliveConfig();
                }
                catch { /* 保活模块不可用时不影响配置保存 */ }
            }
            if (ctx.provider && typeof ctx.provider.broadcastConfig === 'function') {
                ctx.provider.broadcastConfig('');
            }
            // Keep live sessions intact. A new login must use a fresh one-time Code.
            res.json({ ok: true, data: { saved, current: getRuntimeConfig() } });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
    app.post('/api/settings/system-config/reset', (_req, res) => {
        try {
            const saved = getDefaultSystemConfig();
            store.setSystemConfig(saved);
            updateRuntimeConfig(saved);
            if (ctx.provider && typeof ctx.provider.broadcastConfig === 'function') {
                ctx.provider.broadcastConfig('');
            }
            // Keep live sessions intact. A new login must use a fresh one-time Code.
            res.json({ ok: true, data: { saved, current: getRuntimeConfig() } });
        }
        catch (e) {
            handleApiError(res, e);
        }
    });
}
module.exports = { mountAccountRoutes };
//# sourceMappingURL=account-routes.js.map