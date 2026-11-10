import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 抓包登录 admin 路由（嵌入模式，搬运并适配自 qq-farm-bot-origin 的 admin-capture-routes.js）
 *
 * 与 B 的差异（按 P0 定版决策）：
 * - D1：只保留嵌入模式，抓包核心通过进程内 handleApiRequest 调用，不再走 HTTP/apiBase/apiToken。
 * - D2：抓包登录默认开启（store.getCaptureSettings().enabled）。
 * - D5：抓到的 clientVersion 不回写系统配置。
 * - 单用户：删除 owner / 配额 / canAccessAccount / requireAdminRole / requireDangerConfirmation。
 * - 账号字段对齐 A 的 addOrUpdateAccount 白名单（仅 id/name/code/platform/uin/qq/avatar/nick），
 *   不写 loginType/gid/openId/username；重复检测改为 code + platform 比对。
 *
 * 端点（8 组）：
 * - GET  /api/settings/capture-config              读取配置与运行状态
 * - POST /api/settings/capture-config              保存配置（关闭时释放代理并清空会话）
 * - POST /api/settings/capture-config/test         连通性自检（进程内 /api/health）
 * - GET  /api/capture/config                       给前端的轻量开关查询
 * - POST /api/capture/sessions                     创建抓包会话并启动 MITM 代理
 * - GET  /api/capture/sessions/:flowId             刷新并返回会话状态
 * - POST /api/capture/sessions/:flowId/complete    完成抓包（写入账号 + 好友 GID 导入 + 启动账号）
 * - DELETE /api/capture/sessions/:flowId           取消并释放会话
 * - GET  /capture-certificate/:flowId/:token       下载根 CA 证书（放在 /api 之外，用 flowId+token 保护）
 */

const crypto = require('node:crypto');
const store = require('../../models/store');
const { createModuleLogger } = require('../../services/logger');
const { createCaptureCore } = require('../../capture');
const { resolveAccId, getAccountList } = require('./middleware');

const captureLogger = createModuleLogger('capture');

const CAPTURE_FLOW_TTL_MS = 15 * 60 * 1000;
const QQ_FRIEND_COLLECTION_MAX_MS = 15_000;
const QQ_FRIEND_COLLECTION_POLL_MS = 1500;
const CAPTURE_ACCOUNT_START_DELAY_MS = 1500;
const COMPLETE_QQ_FRIEND_SOURCES = new Set<string>([
    'gamepb.friendpb.FriendService.GetAll',
    'gamepb.friendpb.FriendService.SyncAll',
]);

interface CaptureFlow {
    id: string;
    remoteSessionId: string;
    certificateToken: string;
    accountId: string;
    accountCreatedAt: number;
    platform: string;
    code: string;
    accountGid: string;
    openId: string;
    clientVersion: string;
    friendGids: Set<number>;
    friendSource: string;
    friendListComplete: boolean;
    publicInfo: any;
    proxy: any;
    captureStatus: string;
    completed: boolean;
    completing: boolean;
    cancelled: boolean;
    friendCollectionScheduled: boolean;
    result: any;
    createdAt: number;
    updatedAt: number;
}

const captureFlows = new Map<string, CaptureFlow>();

// ===== 懒单例：首次用到才创建抓包核心，避免开机即落盘 CA 私钥 =====
let captureCorePromise: Promise<any> | null = null;

function captureLog(level: string, message: string, extra?: any): void {
    const meta = extra && typeof extra === 'object' ? extra : {};
    const sink = (captureLogger as any)[level] || captureLogger.info;
    sink.call(captureLogger, message, meta);
}

function getCaptureCore(): Promise<any> {
    if (!captureCorePromise) {
        captureCorePromise = Promise.resolve().then(() => createCaptureCore({ log: captureLog }));
    }
    return captureCorePromise;
}

function isCaptureCoreActive(): boolean {
    return captureCorePromise !== null;
}

/** 停止抓包核心，释放全部 MITM 代理端口并清空会话表 */
async function stopCaptureCore(): Promise<void> {
    if (!captureCorePromise) return;
    const core = await captureCorePromise;
    captureCorePromise = null;
    captureFlows.clear();
    try {
        await core.stop();
    } catch (error: any) {
        captureLog('warn', '抓包核心停止失败', { error: error.message });
    }
}

/** 进程内调用抓包核心，返回 {ok,data} 信封；status>=400 或 ok===false 抛错 */
async function captureRequest(path: string, options: { method?: string; body?: any; sessionId?: string } = {}): Promise<any> {
    const core = await getCaptureCore();
    const result = await core.handleApiRequest(
        options.method || 'GET',
        path,
        options.body,
        { sessionId: options.sessionId },
    );
    const payload = (result && result.body) || {};
    if ((result && result.status >= 400) || payload.ok === false) {
        const error: any = new Error(payload.error || `抓包服务请求失败（${(result && result.status) || 500}）`);
        error.captureStatus = result && result.status;
        throw error;
    }
    return payload;
}

// ===== 请求解析辅助 =====

function getCaptureBypassHosts(req: Request): string[] {
    const values = [
        (req as any).hostname,
        req.headers?.['x-forwarded-host'],
        req.headers?.host,
        req.headers?.origin,
        req.headers?.referer,
    ];
    const hosts: string[] = [];
    for (const value of values) {
        const raw = String(value || '').split(',')[0].trim();
        if (!raw) continue;
        try {
            const host = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).hostname
                .replace(/^\[|\]$/g, '')
                .toLowerCase();
            if (host && !hosts.includes(host)) hosts.push(host);
        } catch { /* 忽略非法地址 */ }
    }
    return hosts.slice(0, 8);
}

// 嵌入 Docker 时网卡自动探测只能看到容器 IP；此时使用浏览器访问面板的地址。
function getCaptureAdvertiseHost(req: Request): string {
    const values = [
        req.headers?.['x-forwarded-host'],
        req.headers?.host,
        req.headers?.origin,
        req.headers?.referer,
        (req as any).hostname,
    ];
    for (const value of values) {
        const raw = String(value || '').split(',')[0].trim();
        if (!raw) continue;
        try {
            const host = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).hostname
                .replace(/^\[|\]$/g, '')
                .toLowerCase();
            if (host && host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return host;
        } catch { /* 忽略非法地址 */ }
    }
    return '';
}

// ===== 会话数据抽取与序列化 =====

function mergeKnownFriendGids(existingGids: any, capturedGids: Iterable<number>, accountGid: any): number[] {
    const ownGid = Number(accountGid);
    return [...new Set([
        ...(Array.isArray(existingGids) ? existingGids : []).map(Number),
        ...capturedGids,
    ])].filter((gid: number) => Number.isSafeInteger(gid) && gid > 0 && gid !== ownGid);
}

function isCompleteQqFriendSource(source: any): boolean {
    return COMPLETE_QQ_FRIEND_SOURCES.has(String(source || '').trim());
}

function isSameAccountInstance(ctx: AdminContext, accountId: string, accountCreatedAt: any): boolean {
    const account = getAccountList(ctx).find((item: any) => String(item.id) === String(accountId));
    return !!account && String(account.createdAt || '') === String(accountCreatedAt || '');
}

// A 不持久化 gid，重复检测仅比对 code + platform。
function findDuplicateCapturedAccount(accounts: any[], flow: CaptureFlow, excludedAccountId = ''): any {
    const code = String(flow?.code || '').trim();
    const platform = flow?.platform === 'wx' ? 'wx' : 'qq';
    if (!code) return null;
    return (Array.isArray(accounts) ? accounts : []).find((account: any) => {
        if (String(account?.id || '') === String(excludedAccountId || '')) return false;
        if ((account?.platform === 'wx' ? 'wx' : 'qq') !== platform) return false;
        return String(account?.code || '').trim() === code;
    }) || null;
}

function addCapturedValues(flow: CaptureFlow, envelope: any): void {
    const data = envelope?.data || envelope?.state || envelope;
    if (!data || typeof data !== 'object') return;
    const channel = data.channels?.[flow.platform];
    const entries = Array.isArray(channel?.codes) ? channel.codes : [];
    const codeEntry = entries.find((item: any) => String(item?.code || '').trim());
    const gidEntry = entries.find((item: any) => String(item?.gid || '').trim());
    const openIdEntry = entries.find((item: any) => String(item?.openid || item?.open_id || '').trim());
    if (!flow.code && codeEntry) flow.code = String(codeEntry.code).trim();
    const versionEntry = entries.find((item: any) => String(item?.code || '').trim() === flow.code
        && /^\d+(?:\.\d+){2,4}_\d{8}$/.test(String(item?.clientVersion || '')));
    if (versionEntry) flow.clientVersion = versionEntry.clientVersion;
    if (!flow.accountGid && gidEntry) flow.accountGid = String(gidEntry.gid).trim();
    if (!flow.openId && openIdEntry) {
        flow.openId = String(openIdEntry.openid || openIdEntry.open_id).trim();
    }

    const friends = Array.isArray(data.friends?.items) ? data.friends.items : [];
    for (const friend of friends) {
        const gid = Number(friend?.gid);
        if (Number.isSafeInteger(gid) && gid > 0) flow.friendGids.add(gid);
    }
    const friendSource = String(data.friends?.source || '').trim();
    if (friendSource) flow.friendSource = friendSource;
    if (data.friends?.complete === true || isCompleteQqFriendSource(friendSource)) flow.friendListComplete = true;

    flow.publicInfo = data.publicInfo || flow.publicInfo;
    flow.proxy = data.proxy || flow.proxy;
    flow.captureStatus = channel?.status || flow.captureStatus;
    flow.updatedAt = Date.now();
}

async function refreshFlow(flow: CaptureFlow): Promise<CaptureFlow> {
    const snapshot = await captureRequest(
        `/api/sessions/${encodeURIComponent(flow.remoteSessionId)}/state`,
        { sessionId: flow.remoteSessionId },
    );
    addCapturedValues(flow, snapshot);
    return flow;
}

function serializeFlow(flow: CaptureFlow): any {
    const autoStopSec = Number(flow.publicInfo?.mitmProxyAutoStopSec) || 0;
    const startedAt = Date.parse(flow.proxy?.startedAt || '');
    const elapsedSec = Number.isFinite(startedAt) ? Math.floor((Date.now() - startedAt) / 1000) : 0;
    return {
        id: flow.id,
        platform: flow.platform,
        codeCaptured: !!flow.code,
        accountGid: flow.accountGid,
        friendCount: flow.friendGids.size,
        friendListComplete: flow.friendListComplete === true,
        captureStatus: flow.captureStatus,
        proxy: {
            running: flow.proxy?.running === true,
            status: String(flow.proxy?.status || ''),
            error: String(flow.proxy?.error || ''),
        },
        publicInfo: {
            host: String(flow.publicInfo?.host || ''),
            addresses: Array.isArray(flow.publicInfo?.addresses) ? flow.publicInfo.addresses : [],
            mitmPort: Number(flow.publicInfo?.mitmPort) || 0,
            mitmProxyAutoStopSec: autoStopSec,
            remainingSec: autoStopSec ? Math.max(0, autoStopSec - elapsedSec) : 0,
            certificateUrl: `/capture-certificate/${encodeURIComponent(flow.id)}/${encodeURIComponent(flow.certificateToken)}`,
        },
        completed: flow.completed === true,
        result: flow.result || null,
    };
}

function isCertificateTokenValid(flow: CaptureFlow | undefined, token: any): boolean {
    const expected = Buffer.from(String(flow?.certificateToken || ''), 'utf8');
    const supplied = Buffer.from(String(token || ''), 'utf8');
    return expected.length > 0
        && expected.length === supplied.length
        && crypto.timingSafeEqual(expected, supplied);
}

// ===== 释放代理 / 好友后台同步 / 账号启动 =====

function waitForNextCollectionPoll(delayMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delayMs);
        if (typeof timer.unref === 'function') timer.unref();
    });
}

async function stopRemoteFlow(flow: CaptureFlow): Promise<boolean> {
    let lastError: any = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            await captureRequest(
                `/api/sessions/${encodeURIComponent(flow.remoteSessionId)}`,
                { method: 'DELETE', sessionId: flow.remoteSessionId },
            );
            return true;
        } catch (error: any) {
            lastError = error;
        }

        try {
            await captureRequest('/api/capture/stop', { method: 'POST', sessionId: flow.remoteSessionId, body: {} });
            return true;
        } catch (error: any) {
            lastError = error;
        }

        if (attempt < 3) await waitForNextCollectionPoll(attempt * 500);
    }
    throw lastError || new Error('抓包服务代理释放失败');
}

function scheduleRemoteStop(flow: CaptureFlow, delayMs = 5000): void {
    const timer = setTimeout(() => {
        void stopRemoteFlow(flow).catch((error: any) => {
            captureLog('warn', '抓包服务代理释放失败', { remoteSessionId: flow.remoteSessionId, error: error.message });
        });
    }, delayMs);
    if (typeof timer.unref === 'function') timer.unref();
}

async function collectQqFriendGids(ctx: AdminContext, options: {
    flow: CaptureFlow;
    accountId: string;
    accountCreatedAt: any;
    afterStop?: () => void;
}): Promise<number> {
    const { flow, accountId, accountCreatedAt, afterStop } = options;
    const deadline = Date.now() + QQ_FRIEND_COLLECTION_MAX_MS;
    let lastRefreshError: any = null;

    try {
        while (!flow.cancelled && Date.now() < deadline) {
            if (!isSameAccountInstance(ctx, accountId, accountCreatedAt)) {
                flow.cancelled = true;
                captureLog('info', '账号已删除或替换，停止旧的好友 GID 后台同步', { accountId });
                return 0;
            }
            if (flow.friendListComplete) break;

            try {
                await refreshFlow(flow);
                lastRefreshError = null;
            } catch (error: any) {
                lastRefreshError = error;
            }
            if (flow.friendListComplete) break;

            const remainingMs = deadline - Date.now();
            if (remainingMs > 0) await waitForNextCollectionPoll(Math.min(QQ_FRIEND_COLLECTION_POLL_MS, remainingMs));
        }

        if (flow.cancelled || !isSameAccountInstance(ctx, accountId, accountCreatedAt)) return 0;
        const knownGids = store.getKnownFriendGids(accountId);
        const gids = mergeKnownFriendGids(knownGids, flow.friendGids, flow.accountGid);
        const previousGids = new Set((knownGids || []).map(Number));
        const importedFriendCount = gids.filter((gid: number) => !previousGids.has(gid)).length;
        if (importedFriendCount > 0) {
            store.setKnownFriendGids(accountId, gids);
            if (ctx.provider && typeof ctx.provider.broadcastConfig === 'function') {
                ctx.provider.broadcastConfig(accountId);
            }
        }
        if (flow.result) flow.result.importedFriendCount = importedFriendCount;
        captureLog('info', '抓包登录好友 GID 后台同步完成', {
            accountId,
            capturedFriendCount: flow.friendGids.size,
            importedFriendCount,
            friendSource: flow.friendSource || '',
            completeFriendList: flow.friendListComplete === true,
            refreshError: lastRefreshError?.message || '',
        });
        return importedFriendCount;
    } finally {
        await stopRemoteFlow(flow);
        if (captureFlows.get(flow.id) === flow) captureFlows.delete(flow.id);
        if (
            typeof afterStop === 'function'
            && !flow.cancelled
            && isSameAccountInstance(ctx, accountId, accountCreatedAt)
        ) {
            afterStop();
        }
    }
}

function scheduleQqFriendCollection(ctx: AdminContext, options: {
    flow: CaptureFlow;
    accountId: string;
    accountCreatedAt: any;
    afterStop?: () => void;
}): void {
    const { flow } = options;
    if (flow.friendCollectionScheduled) return;
    flow.friendCollectionScheduled = true;
    void collectQqFriendGids(ctx, options).catch((error: any) => {
        captureLog('warn', '抓包登录账号已添加，但好友 GID 后台同步失败', { accountId: options.accountId, error: error.message });
    });
}

function scheduleCapturedAccountStart(ctx: AdminContext, flow: CaptureFlow, account: any, isUpdate: boolean, wasRunning: boolean): void {
    const timer = setTimeout(() => {
        try {
            if (isUpdate) {
                if (wasRunning) ctx.provider.restartAccount(account.id);
            } else {
                ctx.provider.startAccount(account.id);
            }
        } catch (error: any) {
            const startError = error.message || '账号启动失败';
            if (flow.result) flow.result.startError = startError;
            captureLog('warn', '抓包登录账号已添加，但延迟启动失败', { accountId: account.id, error: startError });
        }
    }, CAPTURE_ACCOUNT_START_DELAY_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();
}

async function stopCaptureBeforeAccountStart(flow: CaptureFlow, start: () => void): Promise<void> {
    await stopRemoteFlow(flow);
    if (captureFlows.get(flow.id) === flow) captureFlows.delete(flow.id);
    start();
}

// 单用户：创建新会话前，清理所有未完成的旧会话。
async function removeIncompleteFlows(): Promise<void> {
    const existing = [...captureFlows.values()].filter((flow) => !flow.completed);
    for (const flow of existing) {
        try {
            await stopRemoteFlow(flow);
        } catch (error: any) {
            captureLog('warn', '清理旧抓包会话失败', { flowId: flow.id, error: error.message });
        }
        captureFlows.delete(flow.id);
    }
}

async function cleanupExpiredFlows(): Promise<void> {
    const cutoff = Date.now() - CAPTURE_FLOW_TTL_MS;
    const expired = [...captureFlows.values()].filter((flow) => flow.updatedAt < cutoff);
    for (const flow of expired) {
        if (!flow.completed) {
            try {
                await stopRemoteFlow(flow);
            } catch { /* 清理路径忽略单次失败 */ }
        }
        captureFlows.delete(flow.id);
    }
}

// ===== 路由挂载 =====

function mountCaptureRoutes(app: Application, ctx: AdminContext): void {
    const cleanupTimer = setInterval(() => {
        void cleanupExpiredFlows().catch((error: any) => {
            captureLog('warn', '过期抓包任务清理失败', { error: error.message });
        });
    }, 60_000);
    if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

    // GET /api/settings/capture-config —— 读取配置与运行状态
    app.get('/api/settings/capture-config', (_req: Request, res: Response) => {
        try {
            const config = store.getCaptureSettings();
            res.json({
                ok: true,
                data: {
                    enabled: config.enabled === true,
                    embedded: true,
                    running: isCaptureCoreActive(),
                    autoImportQqGids: config.autoImportQqGids !== false,
                },
            });
        } catch (error: any) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    // POST /api/settings/capture-config —— 保存配置；关闭时释放代理并清空会话
    app.post('/api/settings/capture-config', async (req: Request, res: Response) => {
        try {
            const input = req.body || {};
            const saved = store.setCaptureSettings({
                ...(input.enabled !== undefined ? { enabled: input.enabled === true } : {}),
                ...(input.autoImportQqGids !== undefined ? { autoImportQqGids: input.autoImportQqGids === true } : {}),
            });
            if (saved.enabled !== true) {
                await stopCaptureCore();
            }
            captureLog('warn', '更新抓包登录配置', {
                enabled: saved.enabled === true,
                autoImportQqGids: saved.autoImportQqGids !== false,
            });
            res.json({
                ok: true,
                data: {
                    enabled: saved.enabled === true,
                    embedded: true,
                    running: isCaptureCoreActive(),
                    autoImportQqGids: saved.autoImportQqGids !== false,
                },
            });
        } catch (error: any) {
            res.status(400).json({ ok: false, error: error.message });
        }
    });

    // POST /api/settings/capture-config/test —— 进程内连通性自检
    app.post('/api/settings/capture-config/test', async (_req: Request, res: Response) => {
        try {
            const health = await captureRequest('/api/health');
            const data = health?.data || {};
            const portPool = Array.isArray(data.portPool) ? data.portPool : [];
            res.json({
                ok: true,
                data: {
                    uptime: Number(data.uptime) || 0,
                    sessions: Number(data.sessions) || 0,
                    portPoolSize: portPool.length,
                    proxyPort: portPool.length ? Number(portPool[0]) || 18000 : 18000,
                },
            });
        } catch (error: any) {
            res.status(502).json({ ok: false, error: error.message });
        }
    });

    // GET /api/capture/config —— 前端轻量开关查询
    app.get('/api/capture/config', (_req: Request, res: Response) => {
        const config = store.getCaptureSettings();
        res.json({
            ok: true,
            data: { enabled: config.enabled === true },
        });
    });

    // POST /api/capture/sessions —— 创建会话并启动 MITM 代理
    app.post('/api/capture/sessions', async (req: Request, res: Response) => {
        const platform = req.body?.platform === 'wx' ? 'wx' : 'qq';
        try {
            const config = store.getCaptureSettings();
            if (config.enabled !== true) {
                return res.status(403).json({ ok: false, error: '抓包登录添加账号未启用' });
            }
            const accountRef = String(req.body?.accountId || '').trim();
            const accountId = accountRef ? (resolveAccId(ctx, accountRef) || accountRef) : '';
            if (accountId) {
                const existing = getAccountList(ctx).find((account: any) => String(account.id) === accountId);
                if (!existing) {
                    return res.status(404).json({ ok: false, error: '目标账号不存在' });
                }
            }

            await removeIncompleteFlows();

            const flowId = crypto.randomBytes(18).toString('base64url');
            const remoteSessionId = crypto.randomBytes(18).toString('base64url');
            const session = await captureRequest('/api/sessions', {
                method: 'POST',
                sessionId: remoteSessionId,
                body: { sessionId: remoteSessionId, platform },
            });
            const flow: CaptureFlow = {
                id: flowId,
                remoteSessionId,
                certificateToken: crypto.randomBytes(24).toString('base64url'),
                accountId,
                accountCreatedAt: 0,
                platform,
                code: '',
                accountGid: '',
                openId: '',
                clientVersion: '',
                friendGids: new Set<number>(),
                friendSource: '',
                friendListComplete: false,
                publicInfo: {},
                proxy: {},
                captureStatus: 'idle',
                completed: false,
                completing: false,
                cancelled: false,
                friendCollectionScheduled: false,
                result: null,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            addCapturedValues(flow, session);
            captureFlows.set(flowId, flow);
            try {
                const started = await captureRequest('/api/capture/start', {
                    method: 'POST',
                    sessionId: remoteSessionId,
                    body: {
                        mode: platform,
                        bypassHosts: getCaptureBypassHosts(req),
                        advertiseHost: getCaptureAdvertiseHost(req),
                    },
                });
                addCapturedValues(flow, started);
            } catch (error: any) {
                captureFlows.delete(flowId);
                await stopRemoteFlow(flow).catch(() => { /* 回滚释放失败忽略 */ });
                throw error;
            }
            res.json({ ok: true, data: serializeFlow(flow) });
        } catch (error: any) {
            captureLog('warn', '启动抓包登录失败', { platform, error: error.message });
            res.status(502).json({ ok: false, error: error.message });
        }
    });

    // GET /api/capture/sessions/:flowId —— 刷新并返回会话状态
    app.get('/api/capture/sessions/:flowId', async (req: Request, res: Response) => {
        const flow = captureFlows.get(String(req.params.flowId || ''));
        if (!flow) return res.status(404).json({ ok: false, error: '抓取任务不存在或已过期' });
        try {
            if (!flow.completed) await refreshFlow(flow);
            res.json({ ok: true, data: serializeFlow(flow) });
        } catch (error: any) {
            res.status(502).json({ ok: false, error: error.message, data: serializeFlow(flow) });
        }
    });

    // GET /capture-certificate/:flowId/:token —— 下载根 CA 证书（/api 之外，用 token 保护）
    app.get('/capture-certificate/:flowId/:token', async (req: Request, res: Response) => {
        const flow = captureFlows.get(String(req.params.flowId || ''));
        if (!flow || !isCertificateTokenValid(flow, req.params.token)) {
            return res.status(404).json({ ok: false, error: '证书链接不存在或已过期' });
        }
        try {
            const core = await getCaptureCore();
            const der = core.getCaCertDer();
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Content-Type', 'application/x-x509-ca-cert');
            res.setHeader('Content-Disposition', 'inline; filename="mitmproxy-ca-cert.cer"');
            res.send(der);
        } catch (error: any) {
            res.status(502).json({ ok: false, error: error.message });
        }
    });

    // POST /api/capture/sessions/:flowId/complete —— 完成抓包（写账号 + 好友导入 + 启动）
    app.post('/api/capture/sessions/:flowId/complete', async (req: Request, res: Response) => {
        const flow = captureFlows.get(String(req.params.flowId || ''));
        if (!flow) return res.status(404).json({ ok: false, error: '抓取任务不存在或已过期' });
        if (flow.completed) return res.json({ ok: true, data: flow.result });
        if (flow.completing) return res.status(409).json({ ok: false, error: '账号正在添加中' });
        flow.completing = true;
        try {
            if (!flow.code) await refreshFlow(flow);
            if (!flow.code) return res.status(400).json({ ok: false, error: '尚未获取到 Code' });

            const isUpdate = !!flow.accountId;
            const allAccounts = getAccountList(ctx);
            const duplicate = findDuplicateCapturedAccount(allAccounts, flow, flow.accountId);
            if (duplicate) {
                flow.cancelled = true;
                captureFlows.delete(flow.id);
                captureLog('warn', '抓包登录检测到重复账号，已停止本次添加', {
                    platform: flow.platform,
                    duplicateAccountId: duplicate.id,
                });
                res.status(409).json({
                    ok: false,
                    code: 'DUPLICATE_CAPTURE_ACCOUNT',
                    error: '检测到当前仍是已添加的账号，请先切换到目标 QQ，再重新开始抓取',
                });
                scheduleRemoteStop(flow, 0);
                return;
            }

            const name = String(req.body?.name || '').trim();
            const existing = isUpdate ? allAccounts.find((account: any) => String(account.id) === flow.accountId) : null;
            if (isUpdate && !existing) throw new Error('目标账号不存在');
            if (!isUpdate && !name) {
                return res.status(400).json({ ok: false, error: '账号备注不能为空' });
            }
            const wasRunning = isUpdate && ctx.provider.isAccountRunning
                ? ctx.provider.isAccountRunning(flow.accountId)
                : false;

            // 仅提交 A 白名单字段（id/name/code/platform），不写 loginType/gid/openId/username。
            const accountPayload: any = {
                name: name || existing?.name || '',
                code: flow.code,
                platform: flow.platform,
            };
            if (isUpdate) accountPayload.id = flow.accountId;

            const accounts = store.addOrUpdateAccount(accountPayload);
            const created = isUpdate
                ? accounts.accounts.find((account: any) => String(account.id) === flow.accountId)
                : accounts.accounts.at(-1);
            if (!created) throw new Error('账号保存失败');

            // D5：抓到的 clientVersion 不回写系统配置（syncGatewayClientVersion 略过）。
            flow.accountCreatedAt = created.createdAt;
            flow.completed = true;
            flow.result = {
                accountId: created.id,
                name: created.name,
                platform: flow.platform,
                importedFriendCount: 0,
                startError: '',
                updated: isUpdate,
            };
            flow.updatedAt = Date.now();

            try {
                if (ctx.provider.addAccountLog) {
                    ctx.provider.addAccountLog(
                        isUpdate ? 'update' : 'add',
                        `抓包登录${isUpdate ? '更新' : '添加'}账号: ${created.name || created.id}`,
                        String(created.id),
                        created.name || '',
                        { platform: flow.platform, importedFriendCount: 0 },
                    );
                }
            } catch { /* 日志失败不影响主流程 */ }

            res.json({ ok: true, data: flow.result });

            const startAccount = () => scheduleCapturedAccountStart(ctx, flow, created, isUpdate, wasRunning);
            const config = store.getCaptureSettings();
            if (flow.platform === 'qq' && config.autoImportQqGids !== false) {
                scheduleQqFriendCollection(ctx, {
                    flow,
                    accountId: created.id,
                    accountCreatedAt: created.createdAt,
                    afterStop: startAccount,
                });
            } else {
                void stopCaptureBeforeAccountStart(flow, startAccount).catch((error: any) => {
                    captureLog('warn', '抓包服务代理释放失败，账号未启动', {
                        accountId: created.id,
                        remoteSessionId: flow.remoteSessionId,
                        error: error.message,
                    });
                });
            }
        } catch (error: any) {
            captureLog('warn', '抓包登录添加账号失败', { platform: flow.platform, error: error.message });
            res.status(500).json({ ok: false, error: error.message });
        } finally {
            flow.completing = false;
        }
    });

    // DELETE /api/capture/sessions/:flowId —— 取消并释放会话
    app.delete('/api/capture/sessions/:flowId', async (req: Request, res: Response) => {
        const flow = captureFlows.get(String(req.params.flowId || ''));
        if (!flow) return res.json({ ok: true });
        flow.cancelled = true;
        captureFlows.delete(flow.id);
        res.json({ ok: true });
        scheduleRemoteStop(flow, 0);
    });
}

module.exports = {
    mountCaptureRoutes,
    stopCaptureCore,
    // 导出纯函数供单测复用
    addCapturedValues,
    findDuplicateCapturedAccount,
    getCaptureBypassHosts,
    getCaptureAdvertiseHost,
    isCertificateTokenValid,
    isCompleteQqFriendSource,
    mergeKnownFriendGids,
    serializeFlow,
};
