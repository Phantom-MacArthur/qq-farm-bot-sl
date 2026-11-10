import type { CaptureConfig } from './types';
export {};

/**
 * 抓包服务入口（只保留嵌入模式）
 *
 * createCaptureCore() 在 bot 进程内运行，REST API 由 controllers/admin/capture-routes.ts
 * 进程内直接调用（handleApiRequest），不占用独立端口。
 *
 * 搬运自 qq-farm-bot-origin 的 capture/index.js，按决策 D1 删除了独立服务模式
 * （startCaptureServer + Express 监听 8450）。
 *
 * 核心链路：CA → 会话存储 → MITM 代理 → 好友提取器。
 */

const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const {
    getCaCertDer,
    getSecureContextForHost,
    loadOrCreateRootCa,
} = require('./ca');
const { createSessionStore } = require('./session-store');
const { createMitmProxyManager } = require('./mitm-proxy');
const { createCaptureApi } = require('./api-server');
const { createFriendExtractor } = require('./friend-extractor');

/** 组合并导出 CA 模块接口（供代理管理器使用） */
function buildCaModule(ca: any) {
    return {
        getSecureContextForHost: (host: string) => getSecureContextForHost(ca, host),
        getCaCertDer: () => getCaCertDer(ca),
    };
}

export interface CaptureCoreOptions {
    /** 数据目录（配置与 CA 存放），默认沿用 bot 的 data 目录 */
    dataDir?: string;
    /** 日志函数 (level, message, extra)，默认控制台 */
    log?: (level: string, message: string, extra?: any) => void;
}

/**
 * 创建抓包服务核心（不监听任何端口，可嵌入 bot 进程）。
 *
 * 同步创建并立即返回，内部异步初始化（proto 加载、代理管理器就绪），
 * 通过 `core.ready` 等待；handleApiRequest 内部会自动等待 ready。
 */
function createCaptureCore(options: CaptureCoreOptions = {}) {
    const { config, dataDir } = loadConfig(options);
    const log = options.log || createLogger((config as CaptureConfig).logLevel);

    const rootCa = loadOrCreateRootCa(dataDir);
    const ca = buildCaModule(rootCa);
    const sessionStore = createSessionStore({ config });

    let proxyManager: any = null;
    let cleanupTimer: any = null;
    let stopRequested = false;

    const ready = (async () => {
        const friendExtractor = await createFriendExtractor();
        proxyManager = createMitmProxyManager({ config, ca, friendExtractor, sessionStore, log });
        log('info', '好友 GID 提取器就绪（proto 加载完成）');
    })();
    ready.catch((error: any) => {
        log('error', `抓包服务初始化失败: ${error.message}`);
    });

    const api = createCaptureApi({
        config,
        ca,
        sessionStore,
        proxyManager: {
            startForSession: (...args: any[]) => ready.then(() => proxyManager.startForSession(...args)),
            stopForSession: (...args: any[]) => ready.then(() => proxyManager.stopForSession(...args)),
        },
        log,
    });

    cleanupTimer = setInterval(() => {
        sessionStore.cleanupExpired();
    }, 60_000);
    if (cleanupTimer.unref) cleanupTimer.unref();

    async function stop() {
        if (stopRequested) return;
        stopRequested = true;
        if (cleanupTimer) clearInterval(cleanupTimer);
        await ready;
        for (const id of sessionStore.listSessions()) {
            const session = sessionStore.getSession(id);
            if (session) await proxyManager.stopForSession(session);
        }
        log('info', '抓包服务核心已停止');
    }

    return {
        config,
        dataDir,
        log,
        ready,
        ca,
        sessionStore,
        api,
        handleApiRequest: async (method: string, path: string, body?: any, context?: any) => {
            await ready;
            return api.handleApiRequest(method, path, body, context);
        },
        getCaCertDer: () => api.getCaCertDer(),
        stop,
    };
}

module.exports = {
    buildCaModule,
    createCaptureCore,
};
