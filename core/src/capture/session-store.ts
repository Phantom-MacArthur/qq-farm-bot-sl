import type { CaptureConfig, CapturePlatform } from './types';
export {};

/**
 * 抓包会话管理
 *
 * 每个会话对应一次 iPhone 抓包登录流程：
 * - 独立 MITM 代理端口
 * - 抓到的 code/openid
 * - 好友 GID 集合与来源
 * - 对外公布的代理地址（多 IP：局域网 / Tailscale）
 */

interface CapturedCode {
    code: string;
    gid: string;
    openid: string;
    clientVersion?: string;
}

interface ProxyInfo {
    running?: boolean;
    status?: string;
    error?: string;
    port?: number;
    startedAt?: string;
    stop?: (() => void) | null;
    host?: string;
    addresses?: string[];
    autoStopSec?: number;
    certUrl?: string;
    bypassHosts?: string[];
}

interface PublicInfo {
    host: string;
    addresses: string[];
    mitmPort: number;
    mitmProxyAutoStopSec: number;
    certUrl: string;
}

export interface CaptureSession {
    id: string;
    platform: CapturePlatform;
    createdAt: number;
    updatedAt: number;
    cancelled: boolean;
    completed: boolean;
    code: string;
    openId: string;
    clientVersion?: string;
    friendGids: Set<number>;
    friendSource: string;
    friendListComplete: boolean;
    proxy: any;
    publicInfo: PublicInfo;
    bypassHosts: string[];
}

function createSessionStore({ config }: { config: CaptureConfig } = {} as any) {
    const sessions = new Map<string, CaptureSession>();

    function createSession(id: string, platform: string = 'qq'): CaptureSession {
        const session: CaptureSession = {
            id,
            platform: platform === 'wx' ? 'wx' : 'qq',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            cancelled: false,
            completed: false,
            code: '',
            openId: '',
            friendGids: new Set<number>(),
            friendSource: '',
            friendListComplete: false,
            proxy: {
                running: false,
                status: 'idle',
                error: '',
                port: 0,
                startedAt: '',
            },
            publicInfo: {
                host: '',
                addresses: [],
                mitmPort: 0,
                mitmProxyAutoStopSec: config.autoStopSec || 900,
                certUrl: '/cert/mitmproxy-ca-cert.cer',
            },
            bypassHosts: [],
        };
        sessions.set(id, session);
        return session;
    }

    function getSession(id: any): CaptureSession | null {
        return sessions.get(String(id || '')) || null;
    }

    function hasSession(id: any): boolean {
        return sessions.has(String(id || ''));
    }

    function deleteSession(id: any) {
        const key = String(id || '');
        const session = sessions.get(key);
        if (session && session.proxy && typeof session.proxy.stop === 'function') {
            try {
                session.proxy.stop();
            } catch { /* 忽略 */ }
        }
        sessions.delete(key);
    }

    function markUpdated(session: CaptureSession) {
        session.updatedAt = Date.now();
    }

    /** 启动代理后记录代理信息 */
    function setProxyInfo(session: CaptureSession, proxyInfo: ProxyInfo) {
        session.proxy = {
            running: proxyInfo.running === true,
            status: proxyInfo.status || 'running',
            error: proxyInfo.error || '',
            port: Number(proxyInfo.port) || 0,
            startedAt: proxyInfo.startedAt || new Date().toISOString(),
            stop: proxyInfo.stop || null,
        };
        session.publicInfo = {
            host: proxyInfo.host || '',
            addresses: Array.isArray(proxyInfo.addresses) ? proxyInfo.addresses : [],
            mitmPort: Number(proxyInfo.port) || 0,
            mitmProxyAutoStopSec: proxyInfo.autoStopSec || config.autoStopSec || 900,
            certUrl: proxyInfo.certUrl || '/cert/mitmproxy-ca-cert.cer',
        };
        if (Array.isArray(proxyInfo.bypassHosts)) session.bypassHosts = proxyInfo.bypassHosts;
        markUpdated(session);
    }

    function setProxyError(session: CaptureSession, error: any) {
        if (!session.proxy) session.proxy = {};
        session.proxy.error = String(error || '');
        session.proxy.status = 'error';
        session.proxy.running = false;
        markUpdated(session);
    }

    /** 记录抓到的登录 code / openid */
    function addCode(session: CaptureSession, { code = '', openId = '', clientVersion = '' }: { code?: string; openId?: string; clientVersion?: string } = {}) {
        let changed = false;
        const cleanCode = String(code || '').trim();
        const cleanOpenId = String(openId || '').trim();
        if (cleanCode && !session.code) {
            session.code = cleanCode;
            changed = true;
        }
        if (cleanOpenId && !session.openId) {
            session.openId = cleanOpenId;
            changed = true;
        }
        if (code === session.code && /^\d+(?:\.\d+){2,4}_\d{8}$/.test(clientVersion) && !session.clientVersion) {
            session.clientVersion = clientVersion;
            changed = true;
        }
        if (changed) markUpdated(session);
        return changed;
    }

    /** 记录好友 GID（去重） */
    function addFriendGids(session: CaptureSession, { gids = [], source = '', complete = false }: { gids?: any[]; source?: string; complete?: boolean } = {}) {
        let changed = false;
        for (const gid of Array.isArray(gids) ? gids : []) {
            const num = Number(gid);
            if (Number.isSafeInteger(num) && num > 0 && !session.friendGids.has(num)) {
                session.friendGids.add(num);
                changed = true;
            }
        }
        if (source) session.friendSource = source;
        if (complete) session.friendListComplete = true;
        if (changed || source || complete) markUpdated(session);
        return changed;
    }

    function getCodesArray(session: CaptureSession): CapturedCode[] {
        if (!session.code && !session.openId) return [];
        return [{ code: session.code, gid: '', openid: session.openId, ...(session.clientVersion ? { clientVersion: session.clientVersion } : {}) }];
    }

    function buildSnapshot(session: CaptureSession) {
        return {
            channels: {
                [session.platform]: {
                    status: session.code ? 'captured' : (session.proxy.running ? 'running' : 'idle'),
                    codes: getCodesArray(session),
                },
            },
            friends: {
                source: session.friendSource,
                items: [...session.friendGids].sort((a, b) => a - b).map(gid => ({ gid: String(gid) })),
                complete: session.friendListComplete === true,
            },
            publicInfo: { ...session.publicInfo },
            proxy: {
                running: session.proxy.running === true,
                status: session.proxy.status || 'idle',
                error: session.proxy.error || '',
                startedAt: session.proxy.startedAt || '',
            },
            captured: !!session.code,
        };
    }

    function listSessions(): string[] {
        return [...sessions.keys()];
    }

    /** 清理过期会话 */
    function cleanupExpired() {
        const cutoff = Date.now() - (config.sessionTtlMs || 60 * 60 * 1000);
        for (const [id, session] of sessions) {
            if (session.updatedAt < cutoff && !session.completed) {
                deleteSession(id);
            }
        }
    }

    return {
        addCode,
        addFriendGids,
        buildSnapshot,
        cleanupExpired,
        createSession,
        deleteSession,
        getCodesArray,
        getSession,
        hasSession,
        listSessions,
        markUpdated,
        setProxyError,
        setProxyInfo,
    };
}

module.exports = { createSessionStore };
