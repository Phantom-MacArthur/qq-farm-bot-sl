const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createYishuAutomation, isYishuAutomationEnabled, nextYishuCheck } = require('../dist/services/yishuhuanfu-auto');
const { estimateYishuLand } = require('../dist/services/farm/yishuhuanfu-plan');
const { latestYishuSellSlot, isYishuSaleTime, yishuSellMode } = require('../dist/config/yishuhuanfu');
const { appendYishuHistory, beginYishuOrder, pendingYishuOrder, readYishuHistory } = require('../dist/services/yishuhuanfu-history');

const at = time => Date.parse('2026-11-26T' + time + ':00+08:00') / 1000;
const end = Date.parse('2026-12-10T00:00:00+08:00') / 1000;

function quote(gid, totalPrice, quota, extra = {}) {
    return { gid, totalPrice: String(totalPrice), quota: String(quota), sharedToday: true, ...extra };
}

function harness(opts = {}) {
    const calls = [];
    let now = opts.now ?? at('12:00');
    const settings = { yishu_sell_mode: opts.mode || 'auto', ...opts.settings };
    const snapshot = {
        active: true, endTime: end, daily: { seedClaimed: true, shared: true, sharedToday: true },
        sweetPotato: { balance: '1000', balanceKnown: true }, luckCoin: { balance: '100', balanceKnown: true },
        shop: { estimatedPrice: '380', bonus: '100' }, commission: { claimable: false },
        ...opts.snapshot,
    };
    const runner = createYishuAutomation({
        getActivity: async () => { calls.push(['read']); return snapshot; },
        claimSeed: async () => {
            calls.push(['seed']);
            snapshot.daily.seedClaimed = true;
            return { count: '28' };
        },
        shareShop: async () => {
            calls.push(['share']);
            snapshot.daily.shared = true;
            return { shareReported: true };
        },
        claimCommission: async () => { calls.push(['commission']); return { amount: '75' }; },
        getFriendQuotes: () => {
            calls.push(['cachedQuotes']);
            if (opts.onReadQuotes) opts.onReadQuotes(settings);
            return { shops: opts.shops || [], scanned: (opts.shops || []).length };
        },
        queryShop: async gid => {
            calls.push(['quote', gid]);
            const current = opts.liveQuotes?.[gid] || opts.shops.find(shop => shop.gid === gid);
            return { ...current, shop: { gid, name: current.name } };
        },
        sell: async (gid, count, options) => {
            calls.push(['sell', gid, count, options.expectedPrice]);
            if (opts.sell) return opts.sell(gid, count, options);
            return { count, price: options.expectedPrice, income: String(BigInt(count) * BigInt(options.expectedPrice)) };
        },
        harvest: async () => {
            calls.push(['harvest']);
            if (opts.harvest) opts.harvest(snapshot);
            return 1;
        },
        getServerTimeSec: () => now,
        log() {},
        delay: async () => {},
    });
    return {
        calls, settings, snapshot,
        run: (slot = latestYishuSellSlot(now, settings.yishu_sell_after_time), source = 'scheduled') => runner.runYishuAutomation(
            settings, () => settings, { plannedAt: now, source, slot },
        ),
        setTime: value => { now = value; },
    };
}

test('默认北京时间 12:00 开始，每半小时一轮，23:55 停单', () => {
    for (const [start, next] of [['11:59', '12:00'], ['12:00', '12:30'], ['12:30', '13:00'], ['23:00', '23:30'], ['23:30', '23:55']]) {
        assert.equal(nextYishuCheck(at(start)), at(next));
    }
    assert.equal(latestYishuSellSlot(at('11:59')), undefined);
    assert.equal(latestYishuSellSlot(at('12:00')), at('12:00'));
    assert.equal(latestYishuSellSlot(at('23:40')), at('23:30'));
    assert.equal(nextYishuCheck(at('12:02'), 5), at('12:05'));
    assert.equal(nextYishuCheck(at('21:58'), 720), at('22:00'));
    assert.equal(isYishuSaleTime(at('23:55'), at('23:30')), false);
    assert.equal(latestYishuSellSlot(at('21:59'), '22:00'), undefined);
});

test('每块土地独立算成熟时刻，恰好 23:30 的种子留到次日', () => {
    assert.equal(estimateYishuLand({ id: 1, level: 1 }, at('12:00'), end).eligible, false);
    const gold = estimateYishuLand({ id: 2, level: 4 }, at('12:00'), end);
    assert.equal(gold.reduction, 2000);
    assert.equal(gold.matureAt, at('21:36'));
    assert.equal(gold.eligible, true);
    assert.equal(estimateYishuLand({ id: 2, level: 4 }, at('13:54'), end).eligible, false);
    assert.equal(estimateYishuLand({ id: 2, level: 4, buff: { planting_time_reduction: 0 } }, at('12:00'), end).eligible, false);
    assert.equal(estimateYishuLand({ id: 2, level: 4 }, at('12:00'), at('21:35')).eligible, false);
});

test('旧版已关卖薯的账号沿用保存值，空配置默认按策略卖', () => {
    assert.equal(yishuSellMode({ yishu_auto_sell: false }), 'off');
    assert.equal(yishuSellMode({ yishu_auto_sell: true, yishu_sell_mode: 'confirm' }), 'scan');
    assert.equal(yishuSellMode({}), 'auto');
    assert.equal(isYishuAutomationEnabled({ yishu_sell_mode: 'off', yishu_auto_sell: true }), false);
    assert.equal(isYishuAutomationEnabled({ activity_enabled: false, yishu_plant: true }), false);
});

test('领种和分享遵循当日状态，只在服务端有可领提成时领取', async () => {
    const h = harness({
        now: at('12:00'),
        settings: { yishu_claim_seed: true, yishu_share: true, yishu_claim_commission: true },
        snapshot: { daily: { seedClaimed: false, shared: false }, commission: { claimable: true } },
    });
    await h.run();
    h.snapshot.commission.claimable = false;
    await h.run();
    assert.equal(h.calls.filter(([action]) => action === 'seed').length, 1);
    assert.equal(h.calls.filter(([action]) => action === 'share').length, 1);
    assert.equal(h.calls.filter(([action]) => action === 'commission').length, 1);
});

test('最早出售时间前从缓存读取报价，卖薯任务不直接查网关', async () => {
    const h = harness({ now: at('15:00'), settings: { yishu_sell_after_time: '22:00' }, shops: [quote('1', 500, 1000)] });
    await h.run();
    h.setTime(at('15:01'));
    await h.run();
    assert.deepEqual(h.calls, [['read'], ['cachedQuotes'], ['read'], ['cachedQuotes']]);
});

test('白天重连先补领种子，销售任务只读取后台报价', async () => {
    const h = harness({ now: at('11:04'), settings: { yishu_claim_seed: true }, snapshot: { daily: { seedClaimed: false } } });
    assert.equal((await h.run(undefined, 'reconnect')).reason, '等待自动卖薯轮次');
    assert.deepEqual(h.calls, [['read'], ['seed'], ['read'], ['cachedQuotes']]);
});

test('默认首轮按后台报价从高到低分配，不批量复核加成', async () => {
    const h = harness({
        shops: [quote('1', 480, 300), quote('2', 500, 700, { sharedToday: false }), quote('3', 430, 900)],
    });
    const result = await h.run();
    assert.equal(result.status, 'sold');
    assert.equal(h.calls.some(([op]) => op === 'quote'), false);
    assert.deepEqual(h.calls.filter(([op]) => op === 'sell'), [['sell', '2', '700', '500'], ['sell', '1', '300', '480']]);
});

test('低于最低报价、停收或收满的铺子不能成交', async () => {
    const h = harness({
        snapshot: { shop: { estimatedPrice: '460', bonus: '100' } },
        shops: [
            quote('self', 440, 0, { own: true }), quote('1', 470, 20, { canSell: false }),
            quote('2', 480, 0), quote('3', 448, 100), quote('4', 449, 100),
        ],
    });
    assert.equal((await h.run()).status, 'skip');
    assert.equal(h.calls.some(([op]) => op === 'sell'), false);
});

test('可按账号配置最早出售时间，自家铺子按报价参加排序', async () => {
    assert.equal(nextYishuCheck(at('14:11'), 30, '14:12'), at('14:12'));
    assert.equal(latestYishuSellSlot(at('14:11'), '14:12'), undefined);
    assert.equal(latestYishuSellSlot(at('14:42'), '14:12'), at('14:42'));
    const h = harness({ now: at('14:12'), settings: { yishu_sell_after_time: '14:12' },
        shops: [quote('own', 499, 0, { own: true }), quote('friend', 510, 100), quote('third', 489, 100)] });
    assert.equal((await h.run()).status, 'sold');
    assert.deepEqual(h.calls.filter(([op]) => op === 'sell'), [['sell', 'friend', '100', '510'], ['sell', 'own', '900', '499']]);
});

test('允许 450 整价成交，且售前依据不是陈旧库存', async () => {
    const h = harness({ shops: [quote('1', 450, 300)] });
    assert.equal((await h.run()).status, 'sold');
    h.snapshot.balanceStale = true;
    assert.match((await h.run()).reason, /库存未确认/);
    assert.equal(h.calls.filter(([op]) => op === 'sell').length, 1);
});

test('最低报价可高于或低于默认值，并允许自家报价较高时出售', async () => {
    const h = harness({
        settings: { yishu_sell_min_price: 510 },
        snapshot: { shop: { estimatedPrice: '600', bonus: '100' } },
        shops: [quote('1', 510, 100), quote('2', 480, 100), quote('3', 380, 100)],
    });
    let result = await h.run();
    assert.equal(result.minPrice, 510);
    assert.deepEqual(h.calls.filter(([op]) => op === 'sell').map(([, gid]) => gid), ['1']);
    h.calls.length = 0;
    h.settings.yishu_sell_min_price = 0;
    result = await h.run();
    assert.equal(result.minPrice, 0);
    assert.deepEqual(h.calls.filter(([op]) => op === 'sell').map(([, gid]) => gid), ['1', '2', '3']);
});

test('关闭卖薯后，已在比价的轮次停止发单', async () => {
    const h = harness({ shops: [quote('1', 500, 300)], onReadQuotes: cfg => { cfg.yishu_sell_mode = 'off'; } });
    await h.run();
    assert.equal(h.calls.some(([op]) => op === 'sell'), false);
});

test('23:40 重连可补跑最后一轮，先收获刷新库存再卖', async () => {
    const h = harness({
        now: at('23:40'), settings: { yishu_harvest: true },
        snapshot: { sweetPotato: { balance: '0', balanceKnown: true } },
        harvest: state => { state.sweetPotato.balance = '200'; },
        shops: [quote('1', 500, 300)],
    });
    const result = await h.run(at('23:30'), 'reconnect');
    assert.equal(result.status, 'sold');
    assert.deepEqual(h.calls.slice(0, 4), [['read'], ['harvest'], ['read'], ['cachedQuotes']]);
    assert.deepEqual(h.calls.at(-1), ['sell', '1', '200', '500']);
});

test('旧确认模式仅持续比价，收尾轮仍记录日终估算', async () => {
    const h = harness({ mode: 'confirm', shops: [quote('1', 500, 300)] });
    const result = await h.run();
    assert.equal(result.status, 'scanned');
    assert.equal(result.plan, undefined);
    h.setTime(at('23:55'));
    assert.equal((await h.run(undefined, 'settlement')).status, 'settlement');
    assert.equal(h.calls.some(([op]) => op === 'sell'), false);
});

test('未知出售结果结束这一轮，保留已完成的成交', async () => {
    const h = harness({
        shops: [quote('1', 500, 300), quote('2', 480, 300), quote('3', 470, 700)],
        sell(gid, count) {
            if (gid === '2') throw Object.assign(new Error('待核对'), { code: 'YSHF_RESULT_UNKNOWN' });
            return { count, price: '500', income: '150000' };
        },
    });
    const result = await h.run();
    assert.equal(result.status, 'pending');
    assert.equal(result.trades.length, 1);
    assert.deepEqual(h.calls.filter(([op]) => op === 'sell').map(([, gid]) => gid), ['1', '2']);
});

test('出售日志能从磁盘恢复未确认状态，并在已核对后解除', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yishu-history-'));
    const previous = process.env.FARM_DATA_DIR;
    process.env.FARM_DATA_DIR = dir;
    try {
        const orderId = beginYishuOrder('unit-account', at('22:00'), { count: '30' });
        assert.equal(pendingYishuOrder(readYishuHistory('unit-account')).orderId, orderId);
        appendYishuHistory('unit-account', at('22:01'), { type: 'resolved', orderId });
        assert.equal(pendingYishuOrder(readYishuHistory('unit-account')), undefined);
        assert.deepEqual(readYishuHistory('another-account'), []);
    } finally {
        if (previous === undefined) delete process.env.FARM_DATA_DIR;
        else process.env.FARM_DATA_DIR = previous;
        const historyDir = path.join(dir, 'yishuhuanfu');
        fs.rmSync(path.join(historyDir, Buffer.from('unit-account').toString('base64url') + '.jsonl'), { force: true });
        if (fs.existsSync(historyDir)) fs.rmdirSync(historyDir);
        fs.rmdirSync(dir);
    }
});
