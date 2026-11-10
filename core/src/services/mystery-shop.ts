export {};

/**
 * 神秘商人类服务：GetActiveNPC / Buy 协议调用 + 购买历史持久化。
 * 购买历史移植自 B 项目 mystery-shop-history.js，按 SL 的 json-db / 目录数据文件约定改写，
 * 账号维一 key 取自 worker 上下文的 FARM_ACCOUNT_ID；记录字段映射为 SL commerce 吐出的
 * 已归一 offer 结构（reward/price/originalPrice/discountPercent）。
 */

const path = require('node:path');
const { getDataFile } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('./json-db');
const { sendMsgAsync, sendMsgNoReply } = require('../utils/network');
const { types } = require('../utils/proto');

const MYSTERY_SHOP_SERVICE = 'gamepb.mysteryshoppb.MysteryShopService';
const MAX_HISTORY_RECORDS = 100;

async function getActiveNPC(): Promise<any> {
    const body: Uint8Array = types.GetActiveNPCRequest
        .encode(types.GetActiveNPCRequest.create({}))
        .finish();
    const { body: replyBody } = await sendMsgAsync(MYSTERY_SHOP_SERVICE, 'GetActiveNPC', body);
    return types.GetActiveNPCReply.decode(replyBody);
}

async function buy(npcId: number): Promise<void> {
    const body: Uint8Array = types.MysteryShopBuyRequest
        .encode(types.MysteryShopBuyRequest.create({ npc_id: npcId }))
        .finish();
    await sendMsgNoReply(MYSTERY_SHOP_SERVICE, 'Buy', body);
}

function safeAccountId(accountId: any): string {
    return String(accountId || process.env.FARM_ACCOUNT_ID || '').trim().replace(/[^\w-]/g, '_');
}

function getHistoryFile(accountId: any): string {
    const id = safeAccountId(accountId);
    if (!id) throw new Error('缺少账号 ID');
    return path.join(getDataFile('mystery_shop_history'), `${id}.json`);
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
    buy,
    MAX_HISTORY_RECORDS,
    getMysteryShopHistory,
    appendMysteryShopHistory,
};
