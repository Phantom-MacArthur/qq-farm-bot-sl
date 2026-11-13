import { WxLoginService } from './service';
import type { WxCredentialRotatedError } from './service';

export {};

const { createModuleLogger } = require('../logger');
const { getAccounts, addOrUpdateAccount } = require('../../models/store');

const logger = createModuleLogger('wx-login-adapter');

/** 农场小游戏 appid（与 ACE 反作弊 tsdk MINI_PROGRAM_APP_ID 一致） */
const TARGET_APP_ID = 'wx5306c5978fdb76e4';
// 待绑定窗口必须比扫码任务本身长：用户在弹窗里补备注可能超过任务 TTL。
const PENDING_WX_INFO_TTL_MS = 15 * 60 * 1000;
/** 凭证保活周期。loginBuffer 有效期 > 2h，而 refreshtoken 约 2h 就过期，必须主动滚动续期。 */
const CREDENTIAL_KEEPALIVE_INTERVAL_MS = 30 * 60 * 1000;

const wxLogin = new WxLoginService();

export interface PendingWxInfo {
    sessionId: string;
    wxid: string;
    loginBuffer: string;
    refreshtoken: string;
    accesstoken: string;
    nickname: string;
}

interface PendingWxEntry extends PendingWxInfo {
    createdAt: number;
}

// sessionId -> 扫码确认后的凭证快照，等待账号持久化时消费
const pendingWxInfos = new Map<string, PendingWxEntry>();
const farmCodeRequests = new Map<string, Promise<AdapterResult>>();
const credentialOperations = new Map<string, Promise<any>>();

interface AdapterResult {
    Success: boolean;
    Message?: string;
    Data?: Record<string, any>;
}

function asRecord(value: unknown): Record<string, any> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : {};
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** 刷新接口可能已滚动 token 后才失败，凭证必须能顺着 error 回传给调用方落盘。 */
function asRotatedCredentialError(error: unknown): WxCredentialRotatedError {
    return error instanceof Error ? error : new Error(String(error));
}

function findAccountByWxid(wxid: string, accountId = ''): any {
    if (!wxid) return null;
    const data = getAccounts();
    const accounts = Array.isArray(data && data.accounts) ? data.accounts : [];
    if (accountId) {
        return accounts.find((account: any) => account
            && String(account.id) === String(accountId)
            && String(account.wxid || '') === String(wxid)) || null;
    }
    return accounts.find((account: any) => account && String(account.wxid || '') === String(wxid)) || null;
}

function cleanupExpiredPending(): void {
    const now = Date.now();
    for (const [sessionId, entry] of pendingWxInfos) {
        if (now - entry.createdAt > PENDING_WX_INFO_TTL_MS) pendingWxInfos.delete(sessionId);
    }
}

/** 扫码确认后登记凭证快照，供账号保存接口在持久化前读取。 */
function registerPendingWxInfo(sessionId: string, info: Omit<PendingWxInfo, 'sessionId' | 'wxid'> & { wxid: string }): void {
    const id = String(sessionId || '');
    const wxid = String(info.wxid || '').trim();
    if (!id || !wxid || !info.loginBuffer) return;
    pendingWxInfos.set(id, { ...info, wxid, sessionId: id, createdAt: Date.now() });
}

/**
 * 读取待绑定凭证，不消费。
 *
 * 必须按会话声明的微信号取凭证，否则任何人都能拿别人的 sessionId
 * 把凭证绑进任意账号；账号持久化成功后才消费，失败时保留以便重试。
 */
function peekPendingWxInfo(sessionId: string, wxid: string): PendingWxInfo | null {
    cleanupExpiredPending();
    const id = String(sessionId || '');
    const targetWxid = String(wxid || '').trim();
    const entry = pendingWxInfos.get(id);
    if (!id || !targetWxid || !entry) return null;
    if (String(entry.wxid || '') !== targetWxid) return null;
    if (!String(entry.loginBuffer || '')) return null;
    const { createdAt, ...info } = entry;
    void createdAt;
    return info;
}

function consumePendingWxInfo(sessionId: string, wxid: string): boolean {
    const id = String(sessionId || '');
    const entry = pendingWxInfos.get(id);
    if (!entry || String(entry.wxid || '') !== String(wxid || '').trim()) return false;
    pendingWxInfos.delete(id);
    return true;
}

/** 换绑或绑定失败时释放会话快照，避免过期凭证长期驻留内存。 */
function releasePendingWxInfo(sessionId: string): void {
    pendingWxInfos.delete(String(sessionId || ''));
}

/**
 * 同一账号的凭证读写必须串行：并发刷新会让后一次的滚动 token 覆盖前一次，
 * 结果两边都失效。accountId 是稳定身份，换绑 wxid 时也共用同一把锁。
 */
async function withAccountCredentialLock(accountId: string | number, operation: () => any): Promise<any> {
    const key = `account:${String(accountId || '')}`;
    const previous = credentialOperations.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    credentialOperations.set(key, current);
    try {
        return await current;
    } finally {
        if (credentialOperations.get(key) === current) credentialOperations.delete(key);
    }
}

/** MMTLS 握手失败错误 → 可读指引（区分凭证失效与网络波动）。 */
function humanizeWxCodeError(raw: unknown): string {
    const s = String(raw || '').replace(/(\btoken\s+)[^\s,;]+/gi, '$1[REDACTED]');
    if (s.includes('ManualAuth rejected')) {
        return '微信登录凭证已失效，请在面板重新扫码登录';
    }
    if (s.includes('socket read timeout') || s.includes('Unable to establish') || s.includes('invalid HTTP response')) {
        return '无法连接微信服务器（网络波动），请稍后重试；若持续失败请重新扫码登录';
    }
    return s;
}

/**
 * 用账号持久化的 loginBuffer 换农场 Code。
 * loginBuffer 失效（ManualAuth rejected）时先用 refreshtoken 续期再重试一次。
 */
async function issueFarmCode(wxid: string, options: { accountId?: string | number } = {}): Promise<AdapterResult> {
    const targetWxid = String(wxid || '').trim();
    if (!targetWxid) return { Success: false, Message: '缺少 wxid' };
    try {
        const account = findAccountByWxid(targetWxid, String(options.accountId || ''));
        if (!account) return { Success: false, Message: '未找到对应的微信扫码账号' };
        let loginBuffer = String(account.loginBuffer || '');
        let refreshtoken = String(account.refreshtoken || '');
        let accesstoken = String(account.accesstoken || '');
        if (!loginBuffer) {
            return { Success: false, Message: '缺少登录凭证（loginBuffer），请重新扫码登录' };
        }

        let code = '';
        try {
            code = await wxLogin.issueCode({ loginBuffer }, TARGET_APP_ID);
        } catch (issueError) {
            const msg = errorMessage(issueError);
            if (!refreshtoken || !msg.includes('ManualAuth rejected')) {
                return { Success: false, Message: `获取 Code 失败: ${humanizeWxCodeError(msg)}` };
            }
            try {
                // 续期请求不依赖 OAuth 回调 cookie，Ual-Access 头负责鉴权。
                const refreshed = await wxLogin.refreshLoginBuffer({ openid: targetWxid, refreshtoken, accesstoken, cookies: new Map() });
                loginBuffer = refreshed.loginBuffer;
                refreshtoken = refreshed.refreshtoken;
                accesstoken = refreshed.accesstoken || accesstoken;
                code = await wxLogin.issueCode({ loginBuffer }, TARGET_APP_ID);
            } catch (refreshError) {
                const rotatedError = asRotatedCredentialError(refreshError);
                // token 刷新已经成功，即使换 loginBuffer 失败也必须先把新 token 落盘。
                persistCredentialFields(account.id, {
                    refreshtoken: rotatedError.refreshtoken,
                    accesstoken: rotatedError.accesstoken,
                });
                return {
                    Success: false,
                    Message: `获取 Code 失败: ${humanizeWxCodeError(rotatedError.message)}（自动续期失败，请重新扫码登录）`,
                };
            }
        }
        if (!code) return { Success: false, Message: '获取 Code 失败（服务端未返回 code）' };

        persistCredentialFields(account.id, { loginBuffer, refreshtoken, accesstoken });
        return { Success: true, Data: { code } };
    } catch (error) {
        return { Success: false, Message: `获取 Code 失败: ${humanizeWxCodeError(errorMessage(error))}` };
    }
}

function persistCredentialFields(accountId: string | number, fields: Record<string, string | undefined>): void {
    const updates: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
        if (typeof value === 'string' && value) updates[key] = value;
    }
    if (!Object.keys(updates).length) return;
    if (typeof addOrUpdateAccount !== 'function') return;
    try {
        addOrUpdateAccount({ id: String(accountId), ...updates });
    } catch (error) {
        logger.warn('persist account fields failed', { accountId, error: errorMessage(error) });
    }
}

/** 同一账号的取码请求合并，避免定时刷新与手动刷新同时打微信服务器。 */
async function getFarmCode(wxid: string, options: { accountId?: string | number } = {}): Promise<AdapterResult> {
    const targetWxid = String(wxid || '');
    if (!targetWxid) return { Success: false, Message: '缺少 wxid' };
    const accountId = String(options.accountId || '');
    const requestKey = `${targetWxid}:account:${accountId}`;
    const inFlight = farmCodeRequests.get(requestKey);
    if (inFlight) return inFlight;
    const operation = () => issueFarmCode(targetWxid, { accountId });
    const request = (accountId
        ? withAccountCredentialLock(accountId, operation)
        : operation()).finally(() => {
        if (farmCodeRequests.get(requestKey) === request) farmCodeRequests.delete(requestKey);
    });
    farmCodeRequests.set(requestKey, request);
    return request;
}

/**
 * 微信凭证主动保活：用账号 refreshtoken 刷新 loginBuffer + refreshtoken（滚动续期）。
 *
 * 必须不等 loginBuffer 失效就主动刷新：loginBuffer 有效期大于 2h，而 refreshtoken 约 2h 过期，
 * 等到取码失败再续期时 refreshtoken 已经死掉（code=-109），只能重新扫码。
 */
async function keepWxCredentialAlive(accountLike: any): Promise<AdapterResult> {
    const account = asRecord(accountLike);
    const wxid = String(account.wxid || '');
    if (!wxid || !account.refreshtoken || !account.loginBuffer) {
        return { Success: false, Message: '缺少微信凭证（refreshtoken/loginBuffer），请重新扫码登录' };
    }
    return withAccountCredentialLock(account.id, async () => {
        // 锁等待期间另一个流程可能已经滚动过凭证，这里必须重读最新值。
        const latest = findAccountByWxid(wxid, String(account.id || '')) || account;
        try {
            const refreshed = await wxLogin.refreshLoginBuffer({
                openid: String(latest.wxid),
                refreshtoken: String(latest.refreshtoken),
                accesstoken: String(latest.accesstoken || ''),
                cookies: new Map(),
            });
            persistCredentialFields(latest.id, {
                loginBuffer: refreshed.loginBuffer,
                refreshtoken: refreshed.refreshtoken,
                accesstoken: refreshed.accesstoken || latest.accesstoken,
            });
            logger.info('wx credential keepalive ok', { accountId: String(latest.id) });
            return { Success: true };
        } catch (error) {
            const rotatedError = asRotatedCredentialError(error);
            persistCredentialFields(latest.id, {
                refreshtoken: rotatedError.refreshtoken,
                accesstoken: rotatedError.accesstoken,
            });
            const message = humanizeWxCodeError(rotatedError.message);
            logger.warn('keepWxCredentialAlive failed', { accountId: String(latest.id), error: message });
            return { Success: false, Message: message };
        }
    });
}

module.exports = {
    TARGET_APP_ID,
    CREDENTIAL_KEEPALIVE_INTERVAL_MS,
    PENDING_WX_INFO_TTL_MS,
    registerPendingWxInfo,
    peekPendingWxInfo,
    consumePendingWxInfo,
    releasePendingWxInfo,
    findAccountByWxid,
    withAccountCredentialLock,
    getFarmCode,
    keepWxCredentialAlive,
    humanizeWxCodeError,
};
