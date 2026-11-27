"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { getServerTimeSec, log } = require('../../utils/utils');
const { rpc, inScene, isUnlocked } = require('./transport');
const { balance, loadBag, readRanchMallGoods } = require('./state');
const { error, quantity, signature } = require('./model');
const reservations = require('./operation-state');
const RANCH_LIMITED_MALL_SLOT = 7;
const COUPON_ID = 1002;
function getOffer(goods, now) {
    const id = Number(goods.goods_id);
    if (!Number.isSafeInteger(id) || id <= 0 || !String(goods.name).includes('礼包')
        || goods.is_available !== true || goods.is_free || goods.is_owned || goods.ad_only || goods.share?.share_only
        || Number(goods.price?.id) !== COUPON_ID || !goods.reward_items?.length)
        return null;
    const limit = goods.purchase_limit;
    const limitCount = Number(limit?.limit_count);
    const boughtCount = Number(limit?.bought_count);
    if (![1, 2, 3, 4].includes(Number(limit?.limit_type)) || !Number.isSafeInteger(limitCount)
        || !Number.isSafeInteger(boughtCount) || boughtCount < 0 || limitCount <= boughtCount)
        return null;
    const startsAt = Number(goods.promotion_start_time || 0);
    const endsAt = Number(goods.promotion_end_time || 0);
    if (startsAt > now || (endsAt > 0 && endsAt <= now))
        return null;
    const discount = Number(goods.discount_price || 0);
    const unitPrice = endsAt > now && discount > 0 ? discount : Number(goods.price?.count);
    if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0)
        return null;
    const count = limitCount - boughtCount;
    return { id: String(id), count, cost: BigInt(unitPrice) * BigInt(count) };
}
async function autoBuyRanchCouponGifts(enabled) {
    if (!enabled() || !isUnlocked())
        return 0;
    return inScene(async () => {
        if (!enabled())
            return 0;
        const catalog = await readRanchMallGoods(RANCH_LIMITED_MALL_SLOT);
        const now = getServerTimeSec();
        const gifts = catalog.filter(good => getOffer(good, now));
        if (!gifts.length || !enabled())
            return 0;
        const operations = reservations.forCurrentAccount();
        const wallet = balance(await loadBag(), COUPON_ID);
        let bought = 0;
        for (const gift of gifts) {
            if (!enabled())
                break;
            const offer = getOffer(gift, getServerTimeSec());
            if (!offer)
                continue;
            const target = `ranch:buyMall:${offer.id}`;
            if (operations.pending().some((row) => row.target === target))
                continue;
            const available = BigInt(wallet.total) - BigInt(wallet.locked) - BigInt(operations.reserved(wallet.resourceKey));
            if (available < offer.cost)
                continue;
            const label = `自动购买牧场${gift.name} ×${offer.count}`;
            const confirmed = await operations.spend({
                target, label, costs: [{ resourceKey: wallet.resourceKey, amount: offer.cost.toString() }], balances: [wallet],
            }, async () => {
                if (!enabled())
                    return false;
                const expected = gift.reward_items.map((item) => ({
                    id: item.id, count: BigInt(quantity(item.count)) * BigInt(offer.count),
                }));
                const reply = await rpc('buyCan', { goods_id: offer.id, count: offer.count }, true);
                if (!reply.success || quantity(reply.goods_id) !== offer.id || signature(reply.reward_items) !== signature(expected)) {
                    throw error('RANCH_RESULT_UNKNOWN', '牧场点券礼包购买结果未确认，请核对商城');
                }
                return true;
            });
            if (!confirmed)
                break;
            wallet.total = (BigInt(wallet.total) - offer.cost).toString();
            bought += offer.count;
            log('牧场', label, { module: 'ranch', event: '点券限时礼包自动购买', result: 'ok' });
        }
        return bought;
    });
}
module.exports = { autoBuyRanchCouponGifts };
//# sourceMappingURL=coupon-gift.js.map