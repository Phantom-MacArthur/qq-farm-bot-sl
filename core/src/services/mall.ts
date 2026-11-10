export {};
const { Buffer } = require('node:buffer');
/**
 * 商城自动购买
 */

const { sendMsgAsync, getUserState } = require('../utils/network');
const { types } = require('../utils/proto');
const { toNum, log, sleep, getSystemDateKey } = require('../utils/utils');
const { getAutomation } = require('../models/store');

const ORGANIC_FERTILIZER_MALL_GOODS_ID: number = 1002;
const INORGANIC_FERTILIZER_MALL_GOODS_ID: number = 1003;
const BUY_COOLDOWN_MS: number = 10 * 60 * 1000;
const CHECK_BUY_COOLDOWN_MS: number = 60 * 1000;
const MAX_ROUNDS: number = 100;
const BUY_PER_ROUND: number = 10;
const FREE_GIFTS_DAILY_KEY: string = 'mall_free_gifts';

let lastBuyAt: number = 0;
const lastCheckBuyAt: number = 0;
let buyDoneDateKey: string = '';
let buyLastSuccessAt: number = 0;
let buyPausedNoGoldDateKey: string = '';
let freeGiftDoneDateKey: string = '';
let freeGiftLastAt: number = 0;
let freeGiftLastCheckAt: number = 0;

async function getMallListBySlotType(slotType: number = 1, subSlotType: number = 0): Promise<any> {
    const body: Uint8Array = types.GetMallListBySlotTypeRequest.encode(types.GetMallListBySlotTypeRequest.create({
        slot_type: Number(slotType) || 1,
        is_manual_open: Number(subSlotType) === 1,
        global_scene_id: 1,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.mallpb.MallService', 'GetMallListBySlotType', body);
    return types.GetMallListBySlotTypeResponse.decode(replyBody);
}

async function purchaseMallGoods(goodsId: number, count: number = 1): Promise<any> {
    const body: Uint8Array = types.PurchaseRequest.encode(types.PurchaseRequest.create({
        goods_id: Number(goodsId) || 0,
        count: Number(count) || 1,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.mallpb.MallService', 'Purchase', body);
    const reply = types.PurchaseResponse.decode(replyBody);
    if (reply.success !== true) throw new Error('商城未确认购买成功，请刷新核对');
    return reply;
}

async function getMallGoodsList(slotType: number = 1): Promise<any[]> {
    const mall: any = await getMallListBySlotType(slotType);
    const raw: any[] = Array.isArray(mall && mall.goods_list) ? mall.goods_list : [];
    return raw.flatMap((entry: any) => {
        if (!Buffer.isBuffer(entry) && !(entry instanceof Uint8Array)) return entry ? [entry] : [];
        try {
            return [types.MallGoods.decode(entry)];
        } catch {
            return [];
        }
    });
}

function parseMallPriceValue(priceField: any): number {
    if (priceField == null) return 0;
    if (typeof priceField === 'number') return Math.max(0, Math.floor(priceField));
    if (typeof priceField === 'object' && !Buffer.isBuffer(priceField) && !(priceField instanceof Uint8Array)) {
        return Math.max(0, Math.floor(toNum(priceField.count)));
    }
    const bytes: Buffer = Buffer.isBuffer(priceField) ? priceField : Buffer.from(priceField || []);
    if (!bytes.length) return 0;
    // 从 bytes 中读取 field=2 的 varint 作为价格
    let idx: number = 0;
    let parsed: number = 0;
    while (idx < bytes.length) {
        const key: number = bytes[idx++];
        const field: number = key >> 3;
        const wire: number = key & 0x07;
        if (wire !== 0) break;
        let val: number = 0;
        let shift: number = 0;
        while (idx < bytes.length) {
            const b: number = bytes[idx++];
            val |= (b & 0x7F) << shift;
            if ((b & 0x80) === 0) break;
            shift += 7;
        }
        if (field === 2) parsed = val;
    }
    return Math.max(0, Math.floor(parsed || 0));
}

function findOrganicFertilizerMallGoods(goodsList: any[]): any {
    const list: any[] = Array.isArray(goodsList) ? goodsList : [];
    return list.find((g: any) => toNum(g && g.goods_id) === ORGANIC_FERTILIZER_MALL_GOODS_ID) || null;
}

function findInorganicFertilizerMallGoods(goodsList: any[]): any {
    const list: any[] = Array.isArray(goodsList) ? goodsList : [];
    return list.find((g: any) => toNum(g && g.goods_id) === INORGANIC_FERTILIZER_MALL_GOODS_ID) || null;
}

function findFertilizerMallGoods(goodsList: any[], type: string = 'organic'): any {
    if (type === 'normal') {
        return findInorganicFertilizerMallGoods(goodsList);
    }
    return findOrganicFertilizerMallGoods(goodsList);
}

async function autoBuyOrganicFertilizerViaMall(): Promise<number> {
    const goodsList: any[] = await getMallGoodsList(1);
    const goods: any = findOrganicFertilizerMallGoods(goodsList);
    if (!goods) return 0;

    const goodsId: number = toNum(goods.goods_id);
    if (goodsId <= 0) return 0;
    const singlePrice: number = parseMallPriceValue(goods.price);
    let ticket: number = Math.max(0, toNum((getUserState() || {}).ticket));
    let totalBought: number = 0;
    let perRound: number = BUY_PER_ROUND;
    if (singlePrice > 0 && ticket > 0) {
        perRound = Math.max(1, Math.min(BUY_PER_ROUND, Math.floor(ticket / singlePrice) || 1));
    }

    for (let i = 0; i < MAX_ROUNDS; i++) {
        if (singlePrice > 0 && ticket > 0 && ticket < singlePrice) {
            buyPausedNoGoldDateKey = getSystemDateKey();
            break;
        }
        try {
            await purchaseMallGoods(goodsId, perRound);
            totalBought += perRound;
            if (singlePrice > 0 && ticket > 0) {
                ticket = Math.max(0, ticket - (singlePrice * perRound));
                if (ticket < singlePrice) break;
            }
            await sleep(120);
        } catch (e: any) {
            const msg: string = String((e && e.message) || '');
            log('商城', `购买化肥失败: ${msg}`, {
                module: 'warehouse',
                event: '购买化肥',
                result: 'error',
                error: msg,
            });
            if (msg.includes('余额不足') || msg.includes('点券不足') || msg.includes('code=1000019')) {
                if (perRound > 1) {
                    perRound = 1;
                    continue;
                }
                buyPausedNoGoldDateKey = getSystemDateKey();
            }
            break;
        }
    }

    if (totalBought > 0) {
        log('商城', `购买化肥成功，共购买 ${totalBought} 个`, {
            module: 'warehouse',
            event: '购买化肥',
            result: 'ok',
            count: totalBought,
            type: 'organic',
        });
    }

    return totalBought;
}

async function autoBuyFertilizerViaMall(type: string = 'organic', targetCount: number = 0, propagateErrors: boolean = false): Promise<number> {
    log('商城', `开始购买化肥, 类型: ${type === 'normal' ? '无机化肥' : '有机化肥'}, 数量: ${targetCount || '不限'}`, {
        module: 'warehouse',
        event: '购买化肥',
        type,
        targetCount,
    });

    const goodsList: any[] = await getMallGoodsList(1);
    const goods: any = findFertilizerMallGoods(goodsList, type);
    if (!goods) {
        log('商城', `未找到化肥商品`, {
            module: 'warehouse',
            event: '购买化肥',
            result: 'error',
            type,
            error: '商品不存在',
        });
        return 0;
    }

    const goodsId: number = toNum(goods.goods_id);
    if (goodsId <= 0) return 0;
    const singlePrice: number = parseMallPriceValue(goods.price);
    let ticket: number = Math.max(0, toNum((getUserState() || {}).ticket));
    let totalBought: number = 0;
    let perRound: number = BUY_PER_ROUND;
    if (singlePrice > 0 && ticket > 0) {
        perRound = Math.max(1, Math.min(BUY_PER_ROUND, Math.floor(ticket / singlePrice) || 1));
    }

    log('商城', `准备购买化肥: goodsId=${goodsId}, 单价=${singlePrice}`, {
        module: 'warehouse',
        event: '购买化肥',
        goodsId,
        singlePrice,
        ticket,
        perRound,
    });

    const remainingToBuy: number = targetCount > 0 ? targetCount : Infinity;

    for (let i = 0; i < MAX_ROUNDS; i++) {
        if (targetCount > 0 && totalBought >= remainingToBuy) break;
        if (singlePrice > 0 && ticket > 0 && ticket < singlePrice) {
            buyPausedNoGoldDateKey = getSystemDateKey();
            break;
        }
        const buyCount: number = targetCount > 0 ? Math.min(perRound, remainingToBuy - totalBought) : perRound;
        try {
            await purchaseMallGoods(goodsId, buyCount);
            totalBought += buyCount;
            if (singlePrice > 0 && ticket > 0) {
                ticket = Math.max(0, ticket - (singlePrice * buyCount));
                if (ticket < singlePrice) break;
            }
            await sleep(120);
        } catch (e: any) {
            const msg: string = String((e && e.message) || '');
            log('商城', `购买化肥失败: ${msg}`, {
                module: 'warehouse',
                event: '购买化肥',
                result: 'error',
                error: msg,
                type,
            });
            if (msg.includes('余额不足') || msg.includes('点券不足') || msg.includes('code=1000019')) {
                if (perRound > 1) {
                    perRound = 1;
                    continue;
                }
                buyPausedNoGoldDateKey = getSystemDateKey();
            }
            if (propagateErrors) throw e;
            break;
        }
    }

    if (totalBought > 0) {
        log('商城', `购买化肥成功，共购买 ${totalBought} 个`, {
            module: 'warehouse',
            event: '购买化肥',
            result: 'ok',
            count: totalBought,
            type,
        });
    }

    return totalBought;
}

async function autoBuyOrganicFertilizer(force: boolean = false): Promise<number> {
    const now: number = Date.now();
    if (!force && now - lastBuyAt < BUY_COOLDOWN_MS) return 0;
    lastBuyAt = now;

    try {
        const totalBought: number = await autoBuyOrganicFertilizerViaMall();
        if (totalBought > 0) {
            buyDoneDateKey = getSystemDateKey();
            buyLastSuccessAt = Date.now();
            log('商城', `自动购买有机化肥 x${totalBought}`, {
                module: 'warehouse',
                event: '购买化肥',
                result: 'ok',
                count: totalBought,
            });
        }
        return totalBought;
    } catch {
        return 0;
    }
}

async function autoBuyFertilizer(force: boolean = false, type: string = 'organic', targetCount: number = 0, propagateErrors: boolean = false): Promise<number> {
    const now: number = Date.now();
    if (!force && now - lastBuyAt < BUY_COOLDOWN_MS) return 0;
    lastBuyAt = now;

    try {
        const totalBought: number = await autoBuyFertilizerViaMall(type, targetCount, propagateErrors);
        if (totalBought > 0) {
            buyDoneDateKey = getSystemDateKey();
            buyLastSuccessAt = Date.now();
            const typeName: string = type === 'normal' ? '无机化肥' : '有机化肥';
            log('商城', `自动购买${typeName} x${totalBought}`, {
                module: 'warehouse',
                event: '购买化肥',
                result: 'ok',
                count: totalBought,
                type,
            });
        }
        return totalBought;
    } catch (error) {
        if (propagateErrors) throw error;
        return 0;
    }
}

function isDoneTodayByKey(key: string): boolean {
    return String(key || '') === getSystemDateKey();
}

async function buyFreeGifts(force: boolean = false): Promise<number> {
    const now: number = Date.now();
    if (!force && isDoneTodayByKey(freeGiftDoneDateKey)) return 0;
    if (!force && now - freeGiftLastCheckAt < BUY_COOLDOWN_MS) return 0;
    freeGiftLastCheckAt = now;

    try {
        const goods: any[] = await getMallGoodsList(1);
        const free: any[] = goods.filter((g: any) => !!g && g.is_free === true && g.is_available === true && !g.ad_only && !g.share?.share_only && toNum(g.price?.count) === 0 && Number(g.goods_id || 0) > 0);
        if (!free.length) {
            freeGiftDoneDateKey = getSystemDateKey();
            log('商城', '今日暂无可领取免费礼包', {
                module: 'task',
                event: FREE_GIFTS_DAILY_KEY,
                result: 'none',
            });
            return 0;
        }

        let bought: number = 0;
        for (const g of free) {
            try {
                await purchaseMallGoods(Number(g.goods_id || 0), 1);
                bought += 1;
            } catch {
                // 单个失败跳过
            }
        }
        freeGiftDoneDateKey = getSystemDateKey();
        if (bought > 0) {
            freeGiftLastAt = Date.now();
            log('商城', `自动购买免费礼包 x${bought}`, {
                module: 'task',
                event: FREE_GIFTS_DAILY_KEY,
                result: 'ok',
                count: bought,
            });
        } else {
            log('商城', '本次未成功领取免费礼包', {
                module: 'task',
                event: FREE_GIFTS_DAILY_KEY,
                result: 'none',
            });
        }
        return bought;
    } catch (e: any) {
        log('商城', `领取免费礼包失败: ${e.message}`, {
            module: 'task',
            event: FREE_GIFTS_DAILY_KEY,
            result: 'error',
        });
        return 0;
    }
}

async function checkAndBuyFertilizerByThreshold(type: string, count: number, thresholdHours: number, propagateErrors: boolean = false): Promise<any> {
    const { getBag, getBagItems, getContainerHoursFromBagItems } = require('./warehouse');

    if (count <= 0 || thresholdHours <= 0) {
        return { bought: 0, message: '参数无效' };
    }

    try {
        const bagReply: any = await getBag();
        const bagItems: any[] = getBagItems(bagReply);
        const containerHours: { normal: number; organic: number } = getContainerHoursFromBagItems(bagItems);

        const currentHours: number = type === 'normal' ? containerHours.normal : containerHours.organic;
        const typeName: string = type === 'normal' ? '无机化肥' : '有机化肥';

        log('商城', `检测${typeName}容器: 剩余 ${currentHours.toFixed(1)} 小时，阈值 ${thresholdHours} 小时`, {
            module: 'mall',
            event: 'check_fertilizer',
            type,
            currentHours,
            thresholdHours,
        });

        if (currentHours < thresholdHours) {
            const bought: number = await autoBuyFertilizer(true, type, count, propagateErrors);
            return { bought, currentHours, thresholdHours, needed: true };
        }

        return { bought: 0, currentHours, thresholdHours, needed: false };
    } catch (e: any) {
        log('商城', `检测化肥容器失败: ${e.message}`, {
            module: 'mall',
            event: 'check_fertilizer',
            result: 'error',
            error: e.message,
        });
        if (propagateErrors) throw e;
        return { bought: 0, error: e.message };
    }
}

async function checkAndBuyFertilizerBoth(options: any, propagateErrors: boolean = false): Promise<any> {
    const { getBag, getBagItems, getContainerHoursFromBagItems } = require('./warehouse');
    const { sleep, randomDelay } = require('../utils/utils');

    const {
        buyOrganic = false,
        buyNormal = false,
        organicCount = 0,
        organicThresholdHours = 0,
        normalCount = 0,
        normalThresholdHours = 0,
    } = options || {};

    const result: any = {
        organicBought: 0,
        normalBought: 0,
        organicCurrentHours: 0,
        normalCurrentHours: 0,
    };

    if (!buyOrganic && !buyNormal) {
        return result;
    }

    try {
        const bagReply: any = await getBag();
        const bagItems: any[] = getBagItems(bagReply);
        const containerHours: { normal: number; organic: number } = getContainerHoursFromBagItems(bagItems);

        result.organicCurrentHours = containerHours.organic;
        result.normalCurrentHours = containerHours.normal;

        // 优先购买有机化肥
        if (buyOrganic && organicCount > 0 && organicThresholdHours > 0) {
            log('商城', `检测有机化肥容器: 剩余 ${containerHours.organic.toFixed(1)} 小时，阈值 ${organicThresholdHours} 小时`, {
                module: 'mall',
                event: 'check_fertilizer_organic',
                currentHours: containerHours.organic,
                thresholdHours: organicThresholdHours,
            });

            if (containerHours.organic < organicThresholdHours) {
                result.organicBought = await autoBuyFertilizer(true, 'organic', organicCount, propagateErrors);
            }
        }

        // 如果同时购买两种化肥，添加随机延迟
        if (buyOrganic && buyNormal && result.organicBought > 0) {
            const delay: number = 1000 + Math.random() * 1000; // 1000-2000ms
            await sleep(delay);
        }

        // 购买无机化肥
        if (buyNormal && normalCount > 0 && normalThresholdHours > 0) {
            log('商城', `检测无机化肥容器: 剩余 ${containerHours.normal.toFixed(1)} 小时，阈值 ${normalThresholdHours} 小时`, {
                module: 'mall',
                event: 'check_fertilizer_normal',
                currentHours: containerHours.normal,
                thresholdHours: normalThresholdHours,
            });

            if (containerHours.normal < normalThresholdHours) {
                result.normalBought = await autoBuyFertilizer(true, 'normal', normalCount, propagateErrors);
            }
        }

        return result;
    } catch (e: any) {
        log('商城', `检测化肥容器失败: ${e.message}`, {
            module: 'mall',
            event: 'check_fertilizer',
            result: 'error',
            error: e.message,
        });
        if (propagateErrors) throw e;
        return { ...result, error: e.message };
    }
}

// ===== 点券限时礼包自动购买（移植自 B mall-gift-auto-buy.js，判定改用 SL 的 MallGoods proto 结构）=====
// B 的判定依赖 goods.enabled/is_activity/is_limited/type/end_time/limit 等字段，SL 的 MallGoods
// 里没有这些；改按 SL 已解码字段：is_available + price(Item{id,count}) + purchase_limit
// (PurchaseLimit{limit_type,bought_count,limit_count}) + promotion_end_time。促销窗口交给
// 商品自身的 is_available / promotion_end_time 判断，不再硬编码绝对时间戳，过期自动失效。
const COUPON_GIFT_GOODS_ID: number = 1061;
const COUPON_CURRENCY_ID: number = 1002; // 点券
const COUPON_GIFT_CHECK_INTERVAL_MS: number = 10 * 60 * 1000;

function parseMallPriceInfo(raw: any): { currencyId: number; price: number } {
    if (raw == null) return { currencyId: 0, price: 0 };
    if (typeof raw === 'number') return { currencyId: 0, price: Math.max(0, Math.floor(raw)) };
    // SL 的 price 是已解码的 corepb.Item：{ id: 货币ID, count: 单价 }
    return {
        currencyId: Math.max(0, Math.floor(toNum(raw.id))),
        price: Math.max(0, Math.floor(toNum(raw.count))),
    };
}

function parseMallLimitInfo(raw: any): { limitType: number; limitCount: number; boughtNum: number } {
    if (raw == null) return { limitType: 0, limitCount: 0, boughtNum: 0 };
    return {
        limitType: Math.max(0, toNum(raw.limit_type)),
        limitCount: Math.max(0, Math.floor(toNum(raw.limit_count))),
        boughtNum: Math.max(0, Math.floor(toNum(raw.bought_count))),
    };
}

// 仅接受在售、点券计价、有限购余量且促销未结束的点券礼包；余额不足时返回 0。
function getCouponGiftPurchase(goods: any, balance: number, nowMs: number = Date.now()): number {
    if (Number(goods?.goods_id) !== COUPON_GIFT_GOODS_ID || goods?.is_available !== true) return 0;
    const price = parseMallPriceInfo(goods.price);
    if (price.currencyId !== COUPON_CURRENCY_ID || price.price <= 0) return 0;
    const limit = parseMallLimitInfo(goods.purchase_limit);
    if (limit.limitCount <= 0) return 0;
    const promoEnd = toNum(goods.promotion_end_time);
    if (promoEnd > 0 && promoEnd * 1000 <= nowMs) return 0;
    const remaining = Math.max(0, limit.limitCount - limit.boughtNum);
    if (remaining <= 0) return 0;
    return Number(balance) >= remaining * price.price ? remaining : 0;
}

function getCouponGiftBalance(state: any): number {
    return Math.max(0, toNum(state?.coupon));
}

function createCouponGiftBuyer(deps: any): (force?: boolean) => Promise<number> {
    const { getBalance, getGoods, purchase, report, now = Date.now } = deps;
    const isEnabled: () => any = deps.getAutomation || (() => getAutomation() || {});
    let busy = false;
    let lastCheck = -Infinity;
    return async function autoBuyCouponGifts(force: boolean = false): Promise<number> {
        if (busy || isEnabled().mall_coupon_gift_buy !== true || (!force && now() - lastCheck < COUPON_GIFT_CHECK_INTERVAL_MS)) return 0;
        busy = true;
        lastCheck = now();
        let bought = 0;
        try {
            const goods = await getGoods();
            let balance = getBalance();
            for (const item of goods || []) {
                if (isEnabled().mall_coupon_gift_buy !== true) break;
                const count = getCouponGiftPurchase(item, balance, now());
                if (!count) {
                    const required = getCouponGiftPurchase(item, Number.MAX_SAFE_INTEGER, now());
                    if (required > 0) report(`点券礼包购买已跳过：需要 ${parseMallPriceInfo(item.price).price * required} 点券，当前 ${balance}`, 'skip');
                    continue;
                }
                await purchase(Number(item.goods_id), count);
                balance -= parseMallPriceInfo(item.price).price * count;
                bought += count;
                report(`自动购买点券限时礼包：${item.name} x${count}`, 'success');
            }
        } catch (error: any) {
            report(`自动购买点券限时礼包失败：${error.message}`, 'error');
        } finally {
            busy = false;
        }
        return bought;
    };
}

const autoBuyCouponGifts = createCouponGiftBuyer({
    getAutomation: () => getAutomation() || {},
    getBalance: () => getCouponGiftBalance(getUserState()),
    getGoods: () => getMallGoodsList(5),
    purchase: purchaseMallGoods,
    report: (message: string, result: string) => log('商城', message, { module: 'shop', event: '点券限时礼包自动购买', result }),
});

module.exports = {
    getMallListBySlotType,
    getMallGoodsList,
    purchaseMallGoods,
    parseMallPriceValue,
    autoBuyOrganicFertilizer,
    autoBuyFertilizer,
    checkAndBuyFertilizerByThreshold,
    checkAndBuyFertilizerBoth,
    buyFreeGifts,
    COUPON_GIFT_GOODS_ID,
    COUPON_GIFT_CHECK_INTERVAL_MS,
    parseMallPriceInfo,
    parseMallLimitInfo,
    getCouponGiftBalance,
    getCouponGiftPurchase,
    createCouponGiftBuyer,
    autoBuyCouponGifts,
    getFertilizerBuyDailyState: () => ({
        key: 'fertilizer_buy',
        doneToday: buyDoneDateKey === getSystemDateKey(),
        pausedNoGoldToday: buyPausedNoGoldDateKey === getSystemDateKey(),
        lastSuccessAt: buyLastSuccessAt,
    }),
    getFreeGiftDailyState: () => ({
        key: FREE_GIFTS_DAILY_KEY,
        doneToday: freeGiftDoneDateKey === getSystemDateKey(),
        lastCheckAt: freeGiftLastCheckAt,
        lastClaimAt: freeGiftLastAt,
    }),
};
