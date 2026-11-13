import type { Account, AccountsData } from '../../types/account';
export {};

const { ensureDataDir } = require('../../config/runtime-paths');
const { readJsonFileStrict, writeJsonFileAtomic, storageError } = require('../../services/json-db');

const { ACCOUNTS_FILE } = require('./shared-state');
let accountsCache: AccountsData | null = null;

function cloneAccounts(data: AccountsData): AccountsData {
    return { accounts: data.accounts.map(account => ({ ...account })), nextId: data.nextId };
}

/**
 * 只能留在服务端的微信扫码凭证。客户端提交的同名字段一律先丢弃，
 * 凭证只能通过短期待绑定扫码会话写入。
 */
const WX_CREDENTIAL_FIELDS = ['loginBuffer', 'refreshtoken', 'accesstoken'];

function stripProtectedWxCredentials(source: any): any {
    const result: any = { ...(source && typeof source === 'object' ? source : {}) };
    for (const field of WX_CREDENTIAL_FIELDS) delete result[field];
    return result;
}

/** 账号列表下发前脱敏：不下发凭证，只保留 hasWxCredential 供页面判断可用性。 */
function maskWxCredentialsForClient(data: any): any {
    const list = Array.isArray(data && data.accounts) ? data.accounts : [];
    return {
        ...(data || {}),
        accounts: list.map((account: any) => {
            const masked: any = { ...(account || {}) };
            masked.hasWxCredential = !!String(masked.loginBuffer || '').trim();
            for (const field of WX_CREDENTIAL_FIELDS) delete masked[field];
            return masked;
        }),
    };
}

function loadAccounts(): AccountsData {
    accountsCache = null;
    try {
        ensureDataDir();
        const raw = readJsonFileStrict(ACCOUNTS_FILE, () => ({ accounts: [], nextId: 1 }));
        if (!raw || !Array.isArray(raw.accounts)) throw new Error('Invalid accounts data');
        const data = normalizeAccountsData(raw);
        accountsCache = data;
        return cloneAccounts(data);
    } catch (error: any) {
        throw storageError('读取', ACCOUNTS_FILE, error);
    }
}

function saveAccounts(data: AccountsData): void {
    let normalized: AccountsData;
    try {
        ensureDataDir();
        normalized = normalizeAccountsData(data);
        writeJsonFileAtomic(ACCOUNTS_FILE, normalized);
    }
    catch (error: any) { throw storageError('保存', ACCOUNTS_FILE, error); }
    accountsCache = normalized;
}

function getAccounts(): AccountsData {
    return accountsCache ? cloneAccounts(accountsCache) : loadAccounts();
}

function normalizeAccountsData(raw: unknown): AccountsData {
    const data: any = raw && typeof raw === 'object' ? raw : {};
    const accounts: Account[] = (Array.isArray(data.accounts) ? data.accounts : []).map(normalizeAccount);
    const maxId = accounts.reduce((m: number, a: any) => Math.max(m, Number.parseInt(a && a.id, 10) || 0), 0);
    let nextId = Number.parseInt(data.nextId, 10);
    if (!Number.isFinite(nextId) || nextId <= 0) nextId = maxId + 1;
    if (accounts.length === 0) nextId = 1;
    if (nextId <= maxId) nextId = maxId + 1;
    return { accounts, nextId };
}

function normalizeAccount(raw: any): Account {
    const source = raw && typeof raw === 'object' ? raw : {};
    const account: Account = {
        id: String(source.id || ''),
        name: String(source.name || ''),
        code: String(source.code || ''),
        platform: String(source.platform || 'qq'),
        uin: String(source.uin || ''),
        qq: String(source.qq || source.uin || ''),
        avatar: String(source.avatar || source.avatarUrl || ''),
        createdAt: Number(source.createdAt) || Date.now(),
        updatedAt: Number(source.updatedAt) || Date.now(),
    };
    const nick = String(source.nick || '').trim();
    if (nick) account.nick = nick;
    // 空串是显式清除凭证的信号，必须与普通缺省区分，因此不能只在非空时写入。
    if (typeof source.wxid === 'string') account.wxid = source.wxid.trim();
    if (typeof source.loginBuffer === 'string') account.loginBuffer = source.loginBuffer.trim();
    if (typeof source.refreshtoken === 'string') account.refreshtoken = source.refreshtoken.trim();
    if (typeof source.accesstoken === 'string') account.accesstoken = source.accesstoken.trim();
    return account;
}

function addOrUpdateAccount(acc: Partial<Account> & { avatarUrl?: string }): AccountsData {
    const { ensureAccountConfig } = require('./account-config');
    const data = getAccounts();
    let touchedAccountId = '';
    const source: any = acc || {};
    const cleanAccount: any = {};
    for (const key of ['id', 'name', 'code', 'platform', 'uin', 'qq', 'avatar', 'avatarUrl', 'nick', 'wxid', 'loginBuffer', 'refreshtoken', 'accesstoken']) {
        if (source[key] !== undefined) cleanAccount[key] = source[key];
    }
    acc = cleanAccount;
    if (acc.id) {
        const idx = data.accounts.findIndex(a => a.id === acc.id);
        if (idx >= 0) {
            data.accounts[idx] = { ...data.accounts[idx], ...acc, name: acc.name !== undefined ? acc.name : data.accounts[idx].name, updatedAt: Date.now() };
            touchedAccountId = String(data.accounts[idx].id || '');
        }
    } else {
        const id = data.nextId++;
        touchedAccountId = String(id);
        data.accounts.push({
            id: touchedAccountId,
            name: acc.name || `账号${id}`,
            code: acc.code || '',
            platform: acc.platform || 'qq',
            uin: acc.uin ? String(acc.uin) : '',
            qq: acc.qq ? String(acc.qq) : (acc.uin ? String(acc.uin) : ''),
            avatar: acc.avatar || acc.avatarUrl || '',
            // 新建时也要保留服务端绑定的微信凭证，否则扫码后立即丢失 loginBuffer。
            wxid: acc.wxid ? String(acc.wxid) : '',
            loginBuffer: acc.loginBuffer ? String(acc.loginBuffer) : '',
            refreshtoken: acc.refreshtoken ? String(acc.refreshtoken) : '',
            accesstoken: acc.accesstoken ? String(acc.accesstoken) : '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
    }
    if (touchedAccountId) {
        ensureAccountConfig(touchedAccountId);
    }
    saveAccounts(data);
    return data;
}

function deleteAccount(id: unknown): AccountsData {
    const { removeAccountConfig } = require('./account-config');
    const data = getAccounts();
    data.accounts = data.accounts.filter(a => a.id !== String(id));
    if (data.accounts.length === 0) {
        data.nextId = 1;
    }
    saveAccounts(data);
    removeAccountConfig(id);
    return data;
}

module.exports = {
    loadAccounts,
    saveAccounts,
    getAccounts,
    normalizeAccountsData,
    addOrUpdateAccount,
    deleteAccount,
    stripProtectedWxCredentials,
    maskWxCredentialsForClient,
    WX_CREDENTIAL_FIELDS,
};
