const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const now = 1_800_000_000;
const source = readFileSync(require.resolve('../dist/services/ranch/coupon-gift'), 'utf8');

function gift(overrides = {}) {
    return {
        goods_id: 21001, name: '牧场点券礼包', is_available: true,
        price: { id: 1002, count: 40 }, reward_items: [{ id: 80033, count: 3 }],
        purchase_limit: { limit_type: 1, limit_count: 4, bought_count: 1 },
        promotion_start_time: now - 60, promotion_end_time: now + 60,
        ...overrides,
    };
}

function setup({ catalog = [gift()], total = '200', locked = '0', reserved = '0', unlocked = true, validReceipt = true } = {}) {
    const calls = [];
    const pending = [];
    const signature = items => items.map(item => `${item.id}:${item.count}`).sort().join('|');
    const dependencies = {
        '../../utils/utils': { getServerTimeSec: () => now, log() {} },
        './transport': {
            isUnlocked: () => unlocked,
            inScene: async run => { calls.push('scene'); return run(); },
            rpc: async (route, params, writing) => {
                assert.equal(route, 'buyCan');
                assert.equal(writing, true);
                calls.push([params.goods_id, params.count]);
                return { success: validReceipt, goods_id: params.goods_id, reward_items: [{ id: 80033, count: params.count * 3 }] };
            },
        },
        './state': {
            readRanchMallGoods: async slot => { assert.equal(slot, 7); calls.push('catalog'); return catalog; },
            loadBag: async () => { calls.push('bag'); return {}; },
            balance: (_bag, id) => { assert.equal(id, 1002); return { resourceKey: 'item:1002', total, locked }; },
        },
        './model': { error: (code, message) => Object.assign(new Error(message), { code }), quantity: String, signature },
        './operation-state': { forCurrentAccount: () => ({
            pending: () => pending,
            reserved: () => reserved,
            async spend(plan, run) {
                calls.push([plan.target, plan.costs[0].resourceKey, plan.costs[0].amount]);
                try { return await run(); }
                catch (error) { pending.push({ target: plan.target }); throw error; }
            },
        }) },
    };
    const module = { exports: {} };
    vm.runInNewContext(source, { module, exports: module.exports, require: name => dependencies[name] });
    return { buy: module.exports.autoBuyRanchCouponGifts, calls };
}

test('ranch coupon gifts use the ranch limited catalog and the current coupon price', async () => {
    const { buy, calls } = setup({ catalog: [
        gift({ goods_id: 20001, price: { id: 1004, count: 80 } }),
        gift({ goods_id: 20007, name: '20小时有机罐头' }),
        gift({ goods_id: 20008, is_free: true }),
        gift({ goods_id: 20009, promotion_end_time: now }),
        gift({ goods_id: 20010, purchase_limit: { limit_type: 1, limit_count: 2, bought_count: 2 } }),
        gift({ discount_price: 25 }),
    ] });
    assert.equal(await buy(() => true), 3);
    assert.deepEqual(calls, ['scene', 'catalog', 'bag', ['ranch:buyMall:21001', 'item:1002', '75'], ['21001', 3]]);
});

test('ranch coupon gifts skip spending when disabled, locked, or short of available coupons', async () => {
    const disabled = setup();
    assert.equal(await disabled.buy(() => false), 0);
    assert.deepEqual(disabled.calls, []);
    const locked = setup({ unlocked: false });
    assert.equal(await locked.buy(() => true), 0);
    assert.deepEqual(locked.calls, []);
    const low = setup({ total: '140', locked: '10', reserved: '15' });
    assert.equal(await low.buy(() => true), 0);
    assert.deepEqual(low.calls, ['scene', 'catalog', 'bag']);
});

test('a ranch coupon purchase with an unconfirmed receipt is not submitted again', async () => {
    const { buy, calls } = setup({ validReceipt: false });
    await assert.rejects(buy(() => true), { code: 'RANCH_RESULT_UNKNOWN' });
    assert.equal(await buy(() => true), 0);
    assert.deepEqual(calls.filter(call => Array.isArray(call) && call[0] === '21001'), [['21001', 3]]);
});
