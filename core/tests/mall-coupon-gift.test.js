'use strict';

const test = require('node:test');
const assert = require('node:assert');

const mall = require('../dist/services/mall');

const NOW_MS = 1_000_000_000_000;
const PROMO_END_SEC = 1_000_003_600; // 晚于 NOW_MS/1000，视为未过期

function makeGift(overrides = {}) {
    return Object.assign({
        goods_id: 1061,
        name: '点券限时礼包',
        is_available: true,
        price: { id: 1002, count: 50 },
        purchase_limit: { limit_type: 1, bought_count: 2, limit_count: 10 },
        promotion_end_time: PROMO_END_SEC,
    }, overrides);
}

test('parseMallPriceInfo 解析 SL 已解码的 Item 对象', () => {
    assert.deepStrictEqual(mall.parseMallPriceInfo({ id: 1002, count: 50 }), { currencyId: 1002, price: 50 });
    assert.deepStrictEqual(mall.parseMallPriceInfo(null), { currencyId: 0, price: 0 });
    assert.deepStrictEqual(mall.parseMallPriceInfo(80), { currencyId: 0, price: 80 });
});

test('parseMallLimitInfo 解析 PurchaseLimit 对象', () => {
    assert.deepStrictEqual(mall.parseMallLimitInfo({ limit_type: 1, bought_count: 2, limit_count: 10 }), {
        limitType: 1, limitCount: 10, boughtNum: 2,
    });
    assert.deepStrictEqual(mall.parseMallLimitInfo(null), { limitType: 0, limitCount: 0, boughtNum: 0 });
});

test('getCouponGiftPurchase 正常在售点券礼包返回限购余量', () => {
    assert.strictEqual(mall.getCouponGiftPurchase(makeGift(), 100000, NOW_MS), 8); // 10 - 2
});

test('getCouponGiftPurchase 各类不合格商品返回 0', () => {
    assert.strictEqual(mall.getCouponGiftPurchase(makeGift({ goods_id: 999 }), 100000, NOW_MS), 0, '非目标商品');
    assert.strictEqual(mall.getCouponGiftPurchase(makeGift({ is_available: false }), 100000, NOW_MS), 0, '不在售');
    assert.strictEqual(mall.getCouponGiftPurchase(makeGift({ price: { id: 1, count: 50 } }), 100000, NOW_MS), 0, '非点券计价');
    assert.strictEqual(mall.getCouponGiftPurchase(makeGift({ promotion_end_time: 1_000_000_000 }), 100000, NOW_MS), 0, '促销已结束');
    assert.strictEqual(mall.getCouponGiftPurchase(makeGift({ purchase_limit: { limit_count: 10, bought_count: 10 } }), 100000, NOW_MS), 0, '已买满');
});

test('getCouponGiftPurchase 余额不足返回 0', () => {
    // 需要 8 * 50 = 400
    assert.strictEqual(mall.getCouponGiftPurchase(makeGift(), 399, NOW_MS), 0);
    assert.strictEqual(mall.getCouponGiftPurchase(makeGift(), 400, NOW_MS), 8);
});

test('createCouponGiftBuyer 开关关闭时直接返回 0 且不打商城', async () => {
    let goodsCalls = 0;
    const buyer = mall.createCouponGiftBuyer({
        getAutomation: () => ({ mall_coupon_gift_buy: false }),
        getBalance: () => 100000,
        getGoods: async () => { goodsCalls += 1; return [makeGift()]; },
        purchase: async () => {},
        report: () => {},
        now: () => NOW_MS,
    });
    assert.strictEqual(await buyer(), 0);
    assert.strictEqual(goodsCalls, 0);
});

test('createCouponGiftBuyer 余额充足时购买限购余量', async () => {
    const purchases = [];
    const buyer = mall.createCouponGiftBuyer({
        getAutomation: () => ({ mall_coupon_gift_buy: true }),
        getBalance: () => 100000,
        getGoods: async () => [makeGift()],
        purchase: async (id, count) => { purchases.push({ id, count }); },
        report: () => {},
        now: () => NOW_MS,
    });
    const bought = await buyer();
    assert.strictEqual(bought, 8);
    assert.deepStrictEqual(purchases, [{ id: 1061, count: 8 }]);
});

test('createCouponGiftBuyer 节流：非强制的第二次立即调用被跳过', async () => {
    let goodsCalls = 0;
    const buyer = mall.createCouponGiftBuyer({
        getAutomation: () => ({ mall_coupon_gift_buy: true }),
        getBalance: () => 100000,
        getGoods: async () => { goodsCalls += 1; return [makeGift()]; },
        purchase: async () => {},
        report: () => {},
        now: () => NOW_MS,
    });
    await buyer();
    await buyer(); // 同一时间戳，间隔未到，跳过
    assert.strictEqual(goodsCalls, 1);
});

test('createCouponGiftBuyer 商城查询异常时安全返回 0', async () => {
    const buyer = mall.createCouponGiftBuyer({
        getAutomation: () => ({ mall_coupon_gift_buy: true }),
        getBalance: () => 100000,
        getGoods: async () => { throw new Error('network down'); },
        purchase: async () => {},
        report: () => {},
        now: () => NOW_MS,
    });
    assert.strictEqual(await buyer(), 0);
});
