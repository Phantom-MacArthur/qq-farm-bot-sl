export {};

const { getAutomation } = require('../models/store');
const { log, logWarn } = require('../utils/utils');

const GOLD_ITEM_ID = 1001;
const COUPON_ITEM_ID = 1002;
const DIAMOND_ITEM_ID = 1004;
const GOLD_BEAN_ITEM_ID = 1005;

const CURRENCY_ALLOW_KEYS: Record<number, string> = {
    [GOLD_ITEM_ID]: 'mystery_shop_allow_gold',
    [COUPON_ITEM_ID]: 'mystery_shop_allow_coupon',
    [DIAMOND_ITEM_ID]: 'mystery_shop_allow_diamond',
    [GOLD_BEAN_ITEM_ID]: 'mystery_shop_allow_gold_bean',
};

const MYSTERY_SHOP_AUTOMATION_KEYS = [
    'mystery_shop_auto_buy',
    'mystery_shop_allow_gold',
    'mystery_shop_allow_coupon',
    'mystery_shop_allow_gold_bean',
    'mystery_shop_allow_diamond',
    'mystery_shop_arrival_notify',
    'mystery_shop_purchase_notify',
] as const;

interface MysteryShopPending {
    visitKey: string;
    buying: boolean;
}

interface MysteryShopAutoState {
    lastArrivalKey: string;
    lastPurchaseKey: string;
    lastSubmittedKey?: string;
    pending?: MysteryShopPending;
    generation?: number;
}

interface MysteryShopDecision {
    skipReason?: 'inactive' | 'disabled';
    visitKey?: string;
    notifyArrival: boolean;
    shouldBuy: boolean;
    skipBuyReason?: 'auto_buy_off' | 'currency_not_allowed' | 'balance_unknown' | 'insufficient';
}

interface MysteryShopPushFlags {
    arrival: boolean;
    purchase: boolean;
}

const defaultState: MysteryShopAutoState = {
    lastArrivalKey: '',
    lastPurchaseKey: '',
};

function createMysteryShopAutoState(): MysteryShopAutoState {
    return { lastArrivalKey: '', lastPurchaseKey: '', lastSubmittedKey: '', pending: undefined, generation: 0 };
}

function resetMysteryShopPending(state: MysteryShopAutoState = defaultState): void {
    state.pending = undefined;
    state.generation = (state.generation || 0) + 1;
}

function isMysteryShopWatchEnabled(automation: any = {}): boolean {
    return automation.mystery_shop_auto_buy === true || automation.mystery_shop_arrival_notify === true;
}

function mysteryShopConfigChanged(prevAuto: any = {}, nextAuto: any = {}): boolean {
    return MYSTERY_SHOP_AUTOMATION_KEYS.some(key => !!prevAuto[key] !== !!nextAuto[key]);
}

function isCurrencyAllowed(currencyId: number, automation: any = {}): boolean {
    const key = CURRENCY_ALLOW_KEYS[Number(currencyId) || 0];
    return !!key && automation[key] === true;
}

function canAffordOffer(price: any): { ok: boolean; reason?: 'balance_unknown' | 'insufficient' } {
    if (!Number.isFinite(price?.balance) || !Number.isSafeInteger(price?.count) || price.count < 0) {
        return { ok: false, reason: 'balance_unknown' };
    }
    if (Number(price.balance) < Number(price.count)) {
        return { ok: false, reason: 'insufficient' };
    }
    return { ok: true };
}

function mysteryShopVisitKey(shop: any): string {
    return require('./mystery-shop').mysteryShopVisitKey(shop);
}

function decideMysteryShopTick(shop: any, automation: any = {}, state: MysteryShopAutoState = defaultState): MysteryShopDecision {
    const npc = shop?.npc;
    const visitKey = mysteryShopVisitKey(shop);
    if (!visitKey || !(Number(npc?.reward?.count) > 0)) {
        return { notifyArrival: false, shouldBuy: false, skipReason: 'inactive' };
    }
    const notifyArrival = automation.mystery_shop_arrival_notify === true && state.lastArrivalKey !== visitKey;

    if (automation.mystery_shop_auto_buy !== true) {
        return { visitKey, notifyArrival, shouldBuy: false, skipBuyReason: 'auto_buy_off' };
    }
    if (!isCurrencyAllowed(npc.price?.id, automation)) {
        return { visitKey, notifyArrival, shouldBuy: false, skipBuyReason: 'currency_not_allowed' };
    }
    const afford = canAffordOffer(npc.price);
    if (!afford.ok) {
        return { visitKey, notifyArrival, shouldBuy: false, skipBuyReason: afford.reason };
    }
    return { visitKey, notifyArrival, shouldBuy: true };
}

function resolveMysteryShopPushFlags(
    decision: MysteryShopDecision,
    bought: boolean,
    automation: any = {},
    state: MysteryShopAutoState = defaultState,
): MysteryShopPushFlags {
    if (!decision.visitKey) return { arrival: false, purchase: false };
    return {
        arrival: !!decision.notifyArrival,
        purchase: !!(bought && automation.mystery_shop_purchase_notify === true && state.lastPurchaseKey !== decision.visitKey),
    };
}

function commitMysteryShopNotify(state: MysteryShopAutoState, visitKey: string, flags: MysteryShopPushFlags): void {
    if (!visitKey) return;
    if (flags.arrival) state.lastArrivalKey = visitKey;
    if (flags.purchase) state.lastPurchaseKey = visitKey;
}

function remainingLabel(expireTime: number): string {
    const diff = Math.max(0, Number(expireTime) || 0) - Date.now();
    if (diff <= 0) return '';
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    return `${hours}小时${minutes}分`;
}

function buildMysteryShopPush(shop: any, flags: MysteryShopPushFlags): { title: string; content: string } | null {
    if (!flags.arrival && !flags.purchase) return null;
    const npc = shop?.npc;
    const item = `${npc?.reward?.name || '神秘商品'} x${Number(npc?.reward?.count) || 0}`;
    const price = `${Number(npc?.price?.count || 0).toLocaleString()} ${npc?.price?.name || '货币'}`;
    const remain = remainingLabel(shop?.expireTime);
    const remainLine = remain ? `\n剩余 ${remain}` : '';

    if (flags.arrival && flags.purchase) {
        return {
            title: '神秘商人已自动购买',
            content: `到货 ${item}\n花费 ${price}${remainLine}`,
        };
    }
    if (flags.purchase) {
        return {
            title: '神秘商人已自动购买',
            content: `购买 ${item}\n花费 ${price}`,
        };
    }
    return {
        title: '神秘商人到货',
        content: `${item}\n价格 ${price}${remainLine}`,
    };
}

function skipBuyLog(decision: MysteryShopDecision, shop: any): string {
    const currencyName = shop?.npc?.price?.name || '该货币';
    if (decision.skipBuyReason === 'currency_not_allowed') {
        return `神秘商人自动购买已跳过：未允许使用${currencyName}`;
    }
    if (decision.skipBuyReason === 'insufficient') {
        return `神秘商人自动购买已跳过：${currencyName}余额不足`;
    }
    if (decision.skipBuyReason === 'balance_unknown') {
        return `神秘商人自动购买已跳过：未能读取${currencyName}余额`;
    }
    return '';
}

interface MysteryShopTickOptions {
    getAutomation?: () => any;
    getShop?: () => Promise<any>;
    buy?: (npcId: number, source: string, expectedOffer: any, canContinue: () => boolean) => Promise<any>;
    state?: MysteryShopAutoState;
    canContinue?: () => boolean;
}

async function checkMysteryShopTick(input: MysteryShopTickOptions | (() => boolean) = {}): Promise<{
    skipped?: boolean; reason?: string; bought?: boolean; push?: { title: string; content: string } | null;
}> {
    const options = typeof input === 'function' ? { canContinue: input } : input;
    const state = options.state || defaultState;
    const generation = state.generation;
    const canContinue = () => state.generation === generation && options.canContinue?.() !== false;
    const readAutomation = () => (options.getAutomation || getAutomation)() || {};
    const cancelled = { skipped: true, reason: 'cancelled' };
    if (!canContinue()) return cancelled;
    const initialAutomation = readAutomation();
    if (initialAutomation.mystery_shop_auto_buy !== true) state.pending = undefined;
    if (!isMysteryShopWatchEnabled(initialAutomation)) return { skipped: true, reason: 'disabled' };

    const getShop = options.getShop || require('./commerce').getMysteryShop;
    let shop: any;
    try {
        shop = await getShop();
    } catch (err: any) {
        if (!canContinue()) return cancelled;
        logWarn('商城', `神秘商人检查失败: ${err.message}`, {
            module: 'shop', event: '神秘商人自动购买', result: 'error', error: err.message,
        });
        return { skipped: true, reason: 'error' };
    }

    if (!canContinue()) return cancelled;
    const automation = readAutomation();
    if (!isMysteryShopWatchEnabled(automation)) {
        state.pending = undefined;
        return { skipped: true, reason: 'disabled' };
    }
    const decision = decideMysteryShopTick(shop, automation, state);
    const visitKey = decision.visitKey;
    if (!visitKey) {
        state.pending = undefined;
        return { skipped: true, reason: decision.skipReason };
    }

    if (automation.mystery_shop_auto_buy !== true || state.lastSubmittedKey === visitKey) {
        state.pending = undefined;
    } else if (state.pending?.visitKey !== visitKey) {
        state.pending = { visitKey, buying: false };
    }

    let bought = false;
    let reason: string | undefined;
    const pending = state.pending;
    if (decision.shouldBuy && pending && !pending.buying) {
        const buy = options.buy || require('./commerce').purchaseMysteryOffer;
        const expectedOffer = {
            visitKey,
            reward: { id: shop.npc.reward.id, count: shop.npc.reward.count },
            price: { id: shop.npc.price.id, count: shop.npc.price.count },
        };
        const canBuy = () => canContinue() && state.pending === pending;
        if (!canBuy()) return cancelled;
        pending.buying = true;
        try {
            await buy(shop.npc.id, 'auto', expectedOffer, canBuy);
            bought = true;
            state.lastSubmittedKey = visitKey;
            log('商城', `神秘商人自动购买成功：${shop.npc.reward.name} x${shop.npc.reward.count}，花费 ${shop.npc.price.count} ${shop.npc.price.name}`, {
                module: 'shop',
                event: '神秘商人自动购买',
                result: 'success',
                itemId: shop.npc.reward.id,
                count: shop.npc.reward.count,
                currencyId: shop.npc.price.id,
                price: shop.npc.price.count,
            });
        } catch (err: any) {
            reason = err?.code || 'error';
            if (reason === 'MYSTERY_PURCHASE_ALREADY_SUBMITTED' || reason === 'MYSTERY_PURCHASE_NOT_CONFIRMED') {
                state.lastSubmittedKey = visitKey;
            }
            if (reason !== 'MYSTERY_PURCHASE_ALREADY_SUBMITTED' && reason !== 'MYSTERY_SESSION_CHANGED') {
                logWarn('商城', `神秘商人自动购买失败: ${err.message}`, {
                    module: 'shop', event: '神秘商人自动购买', result: 'error', error: err.message,
                });
            }
        } finally {
            if (state.pending === pending) {
                if (state.lastSubmittedKey === visitKey || reason === 'MYSTERY_AUTO_BUY_DISABLED'
                    || reason === 'MYSTERY_OFFER_STALE' || !canContinue()) state.pending = undefined;
                else pending.buying = false;
            }
        }
    } else if (!decision.shouldBuy) {
        const message = skipBuyLog(decision, shop);
        if (message) {
            log('商城', message, {
                module: 'shop',
                event: '神秘商人自动购买',
                result: 'skip',
                reason: decision.skipBuyReason,
                currencyId: shop.npc.price?.id,
            });
        }
    }

    if (!canContinue()) return cancelled;
    const notificationAutomation = readAutomation();
    if (notificationAutomation.mystery_shop_auto_buy !== true) state.pending = undefined;
    const flags = resolveMysteryShopPushFlags({
        ...decision,
        notifyArrival: notificationAutomation.mystery_shop_arrival_notify === true && state.lastArrivalKey !== visitKey,
    }, bought, notificationAutomation, state);
    const result = reason ? { bought, reason } : { bought };
    if (!flags.arrival && !flags.purchase) return result;
    commitMysteryShopNotify(state, visitKey, flags);
    return { ...result, push: buildMysteryShopPush(shop, flags) };
}

module.exports = {
    GOLD_ITEM_ID,
    COUPON_ITEM_ID,
    DIAMOND_ITEM_ID,
    GOLD_BEAN_ITEM_ID,
    MYSTERY_SHOP_AUTOMATION_KEYS,
    createMysteryShopAutoState,
    isMysteryShopWatchEnabled,
    mysteryShopConfigChanged,
    isCurrencyAllowed,
    canAffordOffer,
    mysteryShopVisitKey,
    decideMysteryShopTick,
    resolveMysteryShopPushFlags,
    commitMysteryShopNotify,
    buildMysteryShopPush,
    checkMysteryShopTick,
    resetMysteryShopPending,
};
