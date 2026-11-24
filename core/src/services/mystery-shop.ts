export {};

/**
 * 神秘商人类服务：GetActiveNPC / Buy 协议调用 + 购买历史持久化。
 * 购买历史移植自 B 项目 mystery-shop-history.js，按 SL 的 json-db / 目录数据文件约定改写，
 * 账号维一 key 取自 worker 上下文的 FARM_ACCOUNT_ID；记录字段映射为 SL commerce 吐出的
 * 已归一 offer 结构（reward/price/originalPrice/discountPercent）。
 */

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { getDataFile } = require('../config/runtime-paths');
const { readJsonFile, readJsonFileStrict, writeJsonFileAtomic } = require('./json-db');
const { sendMsgAsync, sendMsgNoReply, getWs, networkEvents } = require('../utils/network');
const { types } = require('../utils/proto');
const { toNum } = require('../utils/utils');

const MYSTERY_SHOP_SERVICE = 'gamepb.mysteryshoppb.MysteryShopService';
const MAX_HISTORY_RECORDS = 100;
let activeOfferCache: { socket: unknown, reply: any, readAt: number } | null = null;
let activeOfferRequest: { socket: unknown, promise: Promise<any> } | null = null;

async function getActiveNPC(): Promise<any> {
    const socket = getWs();
    if (activeOfferRequest && activeOfferRequest.socket === socket) return activeOfferRequest.promise;
    const body: Uint8Array = types.GetActiveNPCRequest
        .encode(types.GetActiveNPCRequest.create({}))
        .finish();
    const promise = (async () => {
        const { body: replyBody } = await sendMsgAsync(MYSTERY_SHOP_SERVICE, 'GetActiveNPC', body);
        const reply = types.GetActiveNPCReply.decode(replyBody);
        if (getWs() === socket) activeOfferCache = reply.is_active && reply.npc ? { socket, reply, readAt: Date.now() } : null;
        return reply;
    })();
    activeOfferRequest = { socket, promise };
    try { return await promise; }
    finally {
        if (activeOfferRequest?.promise === promise) activeOfferRequest = null;
    }
}

function getCachedActiveNPC(): any {
    const cached = activeOfferCache;
    return cached && cached.socket === getWs() && Date.now() - cached.readAt < 1000 ? cached.reply : null;
}

function clearCachedActiveNPC(): void {
    activeOfferCache = null;
}

async function buy(npcId: number, onSent?: () => void): Promise<void> {
    const body: Uint8Array = types.MysteryShopBuyRequest
        .encode(types.MysteryShopBuyRequest.create({ npc_id: npcId }))
        .finish();
    await sendMsgNoReply(MYSTERY_SHOP_SERVICE, 'Buy', body, onSent);
}

function watchPurchase(offer: any, socket: unknown) {
    let sent = false;
    let rewardReceived = false;
    let pricePaid = offer.price.count === 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolveResult!: (confirmed: boolean) => void;
    const result = new Promise<boolean>(resolve => { resolveResult = resolve; });
    const finish = (confirmed: boolean) => {
        clearTimeout(timer);
        networkEvents.off('itemChanges', onItems);
        networkEvents.off('rechargeInfoChanged', onRecharge);
        networkEvents.off('disconnected', onDisconnect);
        resolveResult(confirmed);
    };
    const check = () => {
        if (rewardReceived && pricePaid) finish(true);
    };
    function onItems(items: any[]) {
        if (!sent || getWs() !== socket) return;
        let rewardDelta = 0;
        let currencyDelta = 0;
        for (const change of items) {
            const id = toNum(change.item?.id);
            const delta = toNum(change.delta);
            if (id === offer.reward.id) rewardDelta += delta;
            if (id === offer.price.id || (offer.price.id === 1001 && id === 1)) currencyDelta += delta;
        }
        rewardReceived ||= rewardDelta === offer.reward.count;
        pricePaid ||= currencyDelta === -offer.price.count;
        check();
    }
    function onRecharge(notification: any) {
        if (!sent || getWs() !== socket || offer.price.id !== 1004 || offer.price.balance == null) return;
        const balance = notification?.info?.balance;
        if (balance != null && offer.price.balance - toNum(balance) === offer.price.count) pricePaid = true;
        check();
    }
    function onDisconnect() { finish(false); }
    networkEvents.on('itemChanges', onItems);
    networkEvents.on('rechargeInfoChanged', onRecharge);
    networkEvents.on('disconnected', onDisconnect);
    return {
        result,
        onSent() {
            sent = true;
            timer = setTimeout(() => finish(false), 5000);
        },
        stop: () => finish(false),
    };
}

function safeAccountId(accountId: any): string {
    return String(accountId || process.env.FARM_ACCOUNT_ID || '').trim().replace(/[^\w-]/g, '_');
}

function getHistoryFile(accountId: any): string {
    const id = safeAccountId(accountId);
    if (!id) throw new Error('缺少账号 ID');
    return path.join(getDataFile('mystery_shop_history'), `${id}.json`);
}

function mysteryShopVisitKey(shop: any): string {
    const npcId = Number(shop?.npc?.id);
    const shopActivatedAtMs = Number(shop?.activeTime);
    if (!shop?.active || !Number.isSafeInteger(npcId) || npcId <= 0
        || !Number.isSafeInteger(shopActivatedAtMs) || shopActivatedAtMs <= 0) return '';
    return `${npcId}:${shopActivatedAtMs}`;
}

interface MysteryShopSubmission {
    visitKey: string;
    submittedAt: number;
}

function getSubmissionFile(accountId: unknown, visitKey: string): string {
    const id = safeAccountId(accountId);
    if (!id) throw new Error('缺少账号 ID');
    if (!/^[1-9]\d*:[1-9]\d*$/.test(visitKey)) throw new Error('来访标识无效');
    return path.join(getDataFile('mystery_shop_submissions'), id, `${visitKey.replace(':', '-')}.json`);
}

function readSubmission(file: string, visitKey: string, allowMissing: boolean): MysteryShopSubmission | null {
    const missing = Symbol('missing');
    const data = readJsonFileStrict(file, allowMissing ? () => missing : undefined);
    if (data === missing) return null;
    if (data?.visitKey !== visitKey || !Number.isSafeInteger(data?.submittedAt) || data.submittedAt < 0) {
        throw new Error('来访提交记录格式无效');
    }
    return data;
}

function submissionStorageError(cause: unknown): Error {
    return Object.assign(new Error('无法读取或保存神秘商人提交记录，已阻止下单', { cause }), {
        code: 'MYSTERY_PURCHASE_STORAGE_FAILED',
    });
}

function readMysteryShopSubmission(accountId: unknown, visitKey: string): MysteryShopSubmission | null {
    try {
        return readSubmission(getSubmissionFile(accountId, visitKey), visitKey, true);
    } catch (error) {
        throw submissionStorageError(error);
    }
}

function reserveMysteryShopSubmission(accountId: unknown, visitKey: string): boolean {
    let stagedFile: string | undefined;
    try {
        const file = getSubmissionFile(accountId, visitKey);
        if (readSubmission(file, visitKey, true)) return false;
        stagedFile = `${file}.${randomUUID()}.pending`;
        writeJsonFileAtomic(stagedFile, { visitKey, submittedAt: Date.now() });
        try {
            // 原子发布完整 JSON，且不覆盖另一个进程已经占用的来访。
            fs.linkSync(stagedFile, file);
        } catch (error: any) {
            if (error.code !== 'EEXIST') throw error;
            readSubmission(file, visitKey, false);
            return false;
        }
        return true;
    } catch (error) {
        throw submissionStorageError(error);
    } finally {
        if (stagedFile) {
            try { fs.unlinkSync(stagedFile); } catch { /* 已发布的标记独立保留 */ }
        }
    }
}

function getMysteryShopHistory(accountId?: any): any[] {
    const data = readJsonFile(getHistoryFile(accountId), () => ({ records: [] }));
    return Array.isArray(data?.records) ? data.records.slice(0, MAX_HISTORY_RECORDS) : [];
}

// offer = commerce.getMysteryShop().npc（已归一）；source 区分手动/自动。
function appendMysteryShopHistory(accountId: any, offer: any, result: any = null, source = 'manual'): any {
    const reward = result?.reward || offer?.reward || {};
    const record = {
        id: `${Date.now()}-${Number(offer?.id || 0)}`,
        purchasedAt: Date.now(),
        source: source === 'auto' ? 'auto' : 'manual',
        npcId: Number(offer?.id || 0),
        itemId: Number(reward?.id || offer?.itemId || 0),
        itemName: String(reward?.name || offer?.itemName || `物品${reward?.id || 0}`),
        itemImage: reward?.image || offer?.itemImage || '',
        itemCount: Number(reward?.count || offer?.itemCount || 0),
        currencyId: Number(offer?.price?.id || 0),
        currencyName: String(offer?.price?.name || `货币${offer?.price?.id || 0}`),
        price: Number(offer?.price?.count || 0),
        originalPrice: Number(offer?.originalPrice || 0),
        discountPercent: Number(offer?.discountPercent || 0),
    };
    const records = [record, ...getMysteryShopHistory(accountId)].slice(0, MAX_HISTORY_RECORDS);
    writeJsonFileAtomic(getHistoryFile(accountId), { records });
    return record;
}

module.exports = {
    getActiveNPC,
    getCachedActiveNPC,
    clearCachedActiveNPC,
    watchPurchase,
    buy,
    MAX_HISTORY_RECORDS,
    mysteryShopVisitKey,
    readMysteryShopSubmission,
    reserveMysteryShopSubmission,
    getMysteryShopHistory,
    appendMysteryShopHistory,
};
