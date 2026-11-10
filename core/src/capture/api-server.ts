import type { CaptureConfig } from './types';
export {};

/**
 * 抓包服务进程内 API（只保留嵌入模式）
 *
 * 搬运自 qq-farm-bot-origin 的 capture/api-server.js，按决策 D1 删除了
 * Express 独立监听层（apiHost/apiPort/apiToken 与 Bearer 校验），只保留
 * `handleApiRequest`：bot 的 admin 路由在进程内直接调用，不走网络与端口。
 *
 * 调用契约与 controllers/admin/capture-routes.ts 一致：
 *
 * - POST   /api/sessions                   创建抓包会话
 * - POST   /api/capture/start              启动 MITM 代理（按会话）
 * - POST   /api/capture/stop               停止 MITM 代理（按会话）
 * - GET    /api/sessions                   列出会话
 * - GET    /api/sessions/:id/state         查询抓包状态（code/好友/代理信息）
 * - DELETE /api/sessions/:id               停止并删除会话
 * - GET    /api/info                       服务信息与公布地址
 * - GET    /api/health                     健康检查
 *
 * 根 CA 证书（DER/.cer）不再走 HTTP 路由，由 admin 路由通过 getCaCertDer() 取字节后下发。
 */

const { resolveAdvertiseAddresses } = require('./ip-utils');

export interface ApiRequestContext {
    sessionId?: string;
}

export interface ApiResponse {
    status: number;
    body?: any;
    buffer?: Buffer;
}

function createCaptureApi({ config, ca, sessionStore, proxyManager, log = () => {} }: {
    config?: CaptureConfig;
    ca?: any;
    sessionStore?: any;
    proxyManager?: any;
    log?: any;
} = {}) {
    const startedAt = Date.now();

    /** 从路径中提取会话 ID（/api/sessions/<id>/state、/api/sessions/<id>） */
    function extractSessionIdFromPath(method: string, path: string): string {
        const segments = String(path || '').split('/').filter(Boolean);
        // /api/sessions/:id[/state]
        if (segments[0] === 'api' && segments[1] === 'sessions' && segments[2]) {
            return decodeURIComponent(segments[2]);
        }
        return '';
    }

    /**
     * 进程内 API 调用（与 HTTP JSON 响应同构）
     * method - GET/POST/DELETE
     * path - 如 /api/capture/start
     * context - { sessionId }
     */
    async function handleApiRequest(method: string, path: string, body: any = {}, context: ApiRequestContext = {}): Promise<ApiResponse> {
        const sessionId = String((context && context.sessionId) || body.sessionId || '')
            || extractSessionIdFromPath(method, path);

        const key = `${String(method || 'GET').toUpperCase()} ${String(path || '').replace(/\/+$/, '')}`;

        try {
            if (key === 'GET /api/health') {
                return {
                    status: 200,
                    body: {
                        ok: true,
                        data: {
                            uptime: Math.floor((Date.now() - startedAt) / 1000),
                            sessions: sessionStore.listSessions().length,
                            portPool: [config.proxyPortFrom],
                        },
                    },
                };
            }

            if (key === 'POST /api/sessions') {
                if (!sessionId) {
                    return { status: 400, body: { ok: false, error: '缺少会话 ID' } };
                }
                const platform = String(body.platform || 'qq');
                const session = sessionStore.createSession(sessionId, platform);
                log('info', `创建抓包会话: ${sessionId}`, { sessionId, platform });
                return { status: 200, body: { ok: true, data: sessionStore.buildSnapshot(session) } };
            }

            if (key === 'POST /api/capture/start') {
                const session = sessionStore.getSession(sessionId);
                if (!session) return { status: 404, body: { ok: false, error: '会话不存在' } };

                const bypassHosts = Array.isArray(body.bypassHosts) ? body.bypassHosts : [];
                const advertise = resolveAdvertiseAddresses(config);
                const requestedHost = String(body.advertiseHost || '').trim().toLowerCase();
                if (requestedHost && requestedHost.length <= 253 && !/[\s/?#@]/.test(requestedHost)) {
                    const existing = advertise.addresses.find((item: any) => item.address === requestedHost);
                    advertise.host = requestedHost;
                    advertise.addresses = [
                        existing || { address: requestedHost, kind: 'panel' },
                        ...advertise.addresses.filter((item: any) => item.address !== requestedHost),
                    ];
                }

                const started = await proxyManager.startForSession(session, { bypassHosts });
                sessionStore.setProxyInfo(session, {
                    port: started.port,
                    startedAt: started.startedAt,
                    host: advertise.host,
                    addresses: advertise.addresses,
                    certUrl: '/cert/mitmproxy-ca-cert.cer',
                    autoStopSec: config.autoStopSec,
                    bypassHosts: started.bypassHosts,
                    running: true,
                    status: 'running',
                });
                return { status: 200, body: { ok: true, data: sessionStore.buildSnapshot(session) } };
            }

            if (key === 'POST /api/capture/stop') {
                const session = sessionStore.getSession(sessionId);
                if (session) await proxyManager.stopForSession(session);
                return { status: 200, body: { ok: true, data: {} } };
            }

            if (key === 'GET /api/sessions') {
                return { status: 200, body: { ok: true, data: { sessions: sessionStore.listSessions() } } };
            }

            if (key.startsWith('GET /api/sessions/') && key.endsWith('/state')) {
                const session = sessionStore.getSession(sessionId);
                if (!session) return { status: 404, body: { ok: false, error: '会话不存在' } };
                return { status: 200, body: { ok: true, data: sessionStore.buildSnapshot(session) } };
            }

            if (key.startsWith('DELETE /api/sessions/')) {
                const session = sessionStore.getSession(sessionId);
                if (session) {
                    await proxyManager.stopForSession(session);
                    sessionStore.deleteSession(session.id);
                }
                return { status: 200, body: { ok: true, data: {} } };
            }

            if (key === 'GET /api/info') {
                return {
                    status: 200,
                    body: {
                        ok: true,
                        data: {
                            name: 'qq-farm-capture',
                            embedded: true,
                            addresses: resolveAdvertiseAddresses(config),
                            config: {
                                proxyPortFrom: config.proxyPortFrom,
                                proxyPortTo: config.proxyPortTo,
                                autoStopSec: config.autoStopSec,
                            },
                        },
                    },
                };
            }

            return { status: 404, body: { ok: false, error: '未找到接口' } };
        } catch (error: any) {
            return {
                status: 502,
                body: { ok: false, error: String((error && error.message) || error || '内部错误') },
            };
        }
    }

    /** 根 CA 证书 DER（.cer 下载用） */
    function getCaCertDer(): Buffer {
        return ca.getCaCertDer();
    }

    return { handleApiRequest, getCaCertDer };
}

module.exports = { createCaptureApi };
