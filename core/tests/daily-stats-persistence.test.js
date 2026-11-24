const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const test = require('node:test');

function statsHarness(t) {
    const dataRoot = path.resolve(__dirname, '../data');
    fs.mkdirSync(dataRoot, { recursive: true });
    const dir = fs.mkdtempSync(path.join(dataRoot, 'test-stats-'));
    t.after(() => {
        assert.equal(path.dirname(dir), dataRoot);
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const clock = { dateKey: '2026-11-17' };
    const filename = path.resolve(__dirname, '../dist/services/stats.js');
    function load() {
        const module = { exports: {} };
        vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
            module,
            exports: module.exports,
            console: { warn() {}, log() {}, error() {} },
            // 立即执行定时器：统计写盘在测试里同步完成，避免用例结束后仍有待执行的落盘任务
            setTimeout(fn) { fn(); return 0; },
            clearTimeout() {},
            Date,
            process: { env: { FARM_DATA_DIR: dir }, pid: 4321, uptime: () => 10 },
            require(name) {
                if (name === '../utils/utils') return { getSystemDateKey: () => clock.dateKey };
                return createRequire(filename)(name);
            },
        }, { filename });
        return module.exports;
    }
    function readStatsFile() {
        const file = path.join(dir, 'stats', 'acc.json');
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    return { load, clock, dir, readStatsFile };
}

function readStats(stats, gold, exp = 0, coupon = 0, goldBean = 0) {
    const state = { gold, exp, coupon, goldBean };
    return stats.getStats(state, state, true, {});
}

test('当日基线建立后，今日金币按净变化累计', (t) => {
    const h = statsHarness(t);
    const stats = h.load();
    // 首次启动：以启动时的余额作为当日 0 点基线
    stats.initStatsWithPersistence('acc', 1000, 0, 0);
    assert.equal(readStats(stats, 1000).sessionGoldGained, 0, '基线时刻没有变化');
    assert.equal(readStats(stats, 1500).sessionGoldGained, 500, '收入累计到基线之上');
});

test('支出体现为负数，不再区分收入与支出', (t) => {
    const h = statsHarness(t);
    const stats = h.load();
    stats.initStatsWithPersistence('acc', 1000, 0, 0);
    assert.equal(readStats(stats, 1500).sessionGoldGained, 500);

    // 买种子花掉 300 金币：净变化把支出扣掉
    assert.equal(readStats(stats, 1200).sessionGoldGained, 200, '支出后净变化减少');
    // 支出后继续赚取，按净额累加
    assert.equal(readStats(stats, 1400).sessionGoldGained, 400, '支出后新增收入按净额累加');
});

test('同一天内账号重启，0 点基线被保留', (t) => {
    const h = statsHarness(t);
    const stats = h.load();
    stats.initStatsWithPersistence('acc', 1000, 0, 0);
    readStats(stats, 1500);
    readStats(stats, 1200);
    stats.recordOperation('harvest', 3);

    const saved = h.readStatsFile();
    assert.equal(saved.todayBaseline.gold, 1000, '保存的是当日 0 点基线');
    assert.equal(saved.todaySpent, undefined, '不再单独记录当日支出合计');

    // 模拟进程重启：重新加载模块并以当前金币重新登录
    const restarted = h.load();
    restarted.initStatsWithPersistence('acc', 1200, 0, 0);
    const snapshot = readStats(restarted, 1200);
    assert.equal(snapshot.sessionGoldGained, 200, '重启后今日金币净变化保留');
    assert.equal(snapshot.operations.harvest, 3, '重启后今日动作统计保留');
});

test('重启不改写当日 0 点基线', (t) => {
    const h = statsHarness(t);
    const stats = h.load();
    stats.initStatsWithPersistence('acc', 1000, 0, 0);
    readStats(stats, 1500);

    const restarted = h.load();
    restarted.initStatsWithPersistence('acc', 1500, 0, 0);
    readStats(restarted, 1500);

    const saved = h.readStatsFile();
    assert.equal(saved.todayBaseline.gold, 1000, '重启不会把 0 点基线改成当前余额');
});

test('跨天重启后金币累计与动作统计一起归零', (t) => {
    const h = statsHarness(t);
    const stats = h.load();
    stats.initStatsWithPersistence('acc', 1000, 0, 0);
    assert.equal(readStats(stats, 1500).sessionGoldGained, 500);
    stats.recordOperation('harvest', 3);

    h.clock.dateKey = '2026-11-18';
    const nextDay = h.load();
    nextDay.initStatsWithPersistence('acc', 1500, 0, 0);
    const snapshot = readStats(nextDay, 1500);
    assert.equal(snapshot.sessionGoldGained, 0, '跨天后金币累计归零');
    assert.equal(snapshot.operations.harvest, 0, '跨天后动作统计归零');
    // 跨天后当天的新收益重新累加
    assert.equal(readStats(nextDay, 1700).sessionGoldGained, 200);
});

test('运行中跨天会以跨天瞬间的余额建立新一天的基线', (t) => {
    const h = statsHarness(t);
    const stats = h.load();
    stats.initStatsWithPersistence('acc', 1000, 0, 0);
    assert.equal(readStats(stats, 1500).sessionGoldGained, 500);

    h.clock.dateKey = '2026-11-18';
    const snapshot = readStats(stats, 1500);
    assert.equal(snapshot.sessionGoldGained, 0, '跨天后金币累计归零');
    assert.equal(snapshot.operations.harvest, 0, '跨天后动作统计归零');

    const saved = h.readStatsFile();
    assert.equal(saved.date, '2026-11-18');
    assert.equal(saved.todayBaseline.gold, 1500, '新一天的基线是跨天瞬间的余额');
});

test('今日经验按 0 点基线计算差值', (t) => {
    const h = statsHarness(t);
    const stats = h.load();
    stats.initStatsWithPersistence('acc', 1000, 500, 0);
    assert.equal(readStats(stats, 1000, 900).sessionExpGained, 400);
});

test('状态栏余额与真实余额不同步时，同一笔支出不会被重复计入', (t) => {
    const h = statsHarness(t);
    const stats = h.load();
    stats.initStatsWithPersistence('acc', 1000, 0, 0);
    const statusData = { gold: 1000, exp: 0, coupon: 0 };
    const userState = { gold: 995, exp: 0, coupon: 0 };

    // 买种子：真实余额已扣款，状态栏仍是扣款前的数值
    stats.recordGoldExp(statusData.gold, 0);
    const first = stats.getStats(statusData, userState, true, {});
    assert.equal(first.sessionGoldGained, -5, '支出体现为负数');

    // 同样的观测重复多次，净变化不会重复累计
    stats.recordGoldExp(statusData.gold, 0);
    const second = stats.getStats(statusData, userState, true, {});
    assert.equal(second.sessionGoldGained, -5, '重复观测不会把同一笔支出累计多次');
});

test('余额下跌时今日金币同步减少', (t) => {
    const h = statsHarness(t);
    const stats = h.load();
    stats.initStatsWithPersistence('acc', 1000, 0, 0);
    const dropped = stats.getStats({ gold: 10 }, { gold: 10 }, true, {});
    assert.equal(dropped.sessionGoldGained, -990, '净变化直接反映余额下跌');

    let latest = dropped;
    for (let i = 0; i < 5; i += 1) {
        const state = { gold: 5, exp: 0, coupon: 0 };
        latest = stats.getStats(state, state, true, {});
    }
    assert.equal(latest.sessionGoldGained, -995, '重复观测不会继续放大支出');
});

test('旧格式统计文件迁移后当日已获得的金额不丢失', (t) => {
    const h = statsHarness(t);
    const statsDir = path.join(h.dir, 'stats');
    fs.mkdirSync(statsDir, { recursive: true });
    // 旧格式：todayGains 记录的是只计收入的今日累计，没有 todaySpent
    fs.writeFileSync(path.join(statsDir, 'acc.json'), JSON.stringify({
        date: '2026-11-17',
        operations: { harvest: 2 },
        initialState: { gold: 1000, exp: 0, coupon: 0, goldBean: null },
        todayGains: { gold: 500, coupon: 0, goldBean: 0 },
        savedAt: Date.now(),
    }));

    const stats = h.load();
    stats.initStatsWithPersistence('acc', 1500, 0, 0);
    const snapshot = stats.getStats({ gold: 1500 }, { gold: 1500 }, true, {});
    assert.equal(snapshot.sessionGoldGained, 500, '迁移后当日收入不丢失');
    assert.equal(snapshot.operations.harvest, 2, '当日动作统计保留');
});

test('登录时金币尚未同步时不会把全部余额算成今日收入', (t) => {
    const h = statsHarness(t);
    const stats = h.load();
    // 登录回包没有金币余额：基线不能取 0
    stats.initStatsWithPersistence('acc', 0, 0, 0);

    // 首个可信观测到达：真实的余额 482240354
    const first = readStats(stats, 482240354);
    assert.equal(first.sessionGoldGained, 0, '未同步的 0 不会被当成 0 点基线');
    assert.ok(first.sessionGoldGained < 482240354, '今日收入不会等于全部余额');

    // 基线建立后继续赚取才累计
    assert.equal(readStats(stats, 482240854).sessionGoldGained, 500);
});

test('旧统计文件里无效的金币基线会被自愈重建', (t) => {
    const h = statsHarness(t);
    const statsDir = path.join(h.dir, 'stats');
    fs.mkdirSync(statsDir, { recursive: true });
    // 旧版本把尚未同步的金币写成了 0，基线失效
    fs.writeFileSync(path.join(statsDir, 'acc.json'), JSON.stringify({
        date: '2026-11-17',
        operations: { harvest: 2 },
        todayBaseline: { gold: 0, exp: 13896074, coupon: 0, goldBean: 49534 },
        todaySpent: { gold: 1708, coupon: 0, goldBean: 0 },
        savedAt: Date.now(),
    }));

    const stats = h.load();
    stats.initStatsWithPersistence('acc', 482240354, 13896074, 0);
    const snapshot = stats.getStats({ gold: 482240354 }, { gold: 482240354 }, true, {});
    assert.equal(snapshot.sessionGoldGained, 0, '无效基线重建后今日累计不会等于全部余额');
    assert.equal(snapshot.operations.harvest, 2, '当日动作统计保留');

    // 重建之后继续赚取正常累计
    const next = stats.getStats({ gold: 482240854 }, { gold: 482240854 }, true, {});
    assert.equal(next.sessionGoldGained, 500);
});

test('今日动作统计（收获/施肥/种植/偷菜）落盘并在重启后恢复', (t) => {
    const h = statsHarness(t);
    const stats = h.load();
    stats.initStatsWithPersistence('acc', 1000, 0, 0);
    stats.recordOperation('harvest', 5);
    stats.recordOperation('fertilize', 7);
    stats.recordOperation('plant', 9);
    stats.recordOperation('steal', 11);

    const saved = h.readStatsFile();
    assert.equal(saved.operations.harvest, 5, '收获落盘');
    assert.equal(saved.operations.fertilize, 7, '施肥落盘');
    assert.equal(saved.operations.plant, 9, '种植落盘');
    assert.equal(saved.operations.steal, 11, '偷菜落盘');

    // 模拟进程重启：动作统计应从落盘文件恢复
    const restarted = h.load();
    restarted.initStatsWithPersistence('acc', 1000, 0, 0);
    const snapshot = readStats(restarted, 1000);
    assert.equal(snapshot.operations.harvest, 5, '重启后收获保留');
    assert.equal(snapshot.operations.fertilize, 7, '重启后施肥保留');
    assert.equal(snapshot.operations.plant, 9, '重启后种植保留');
    assert.equal(snapshot.operations.steal, 11, '重启后偷菜保留');
});

test('跨天后今日动作统计清零', (t) => {
    const h = statsHarness(t);
    const stats = h.load();
    stats.initStatsWithPersistence('acc', 1000, 0, 0);
    stats.recordOperation('harvest', 5);
    stats.recordOperation('steal', 11);

    h.clock.dateKey = '2026-11-18';
    const nextDay = h.load();
    nextDay.initStatsWithPersistence('acc', 1000, 0, 0);
    const snapshot = readStats(nextDay, 1000);
    assert.equal(snapshot.operations.harvest, 0, '跨天后收获清零');
    assert.equal(snapshot.operations.steal, 0, '跨天后偷菜清零');
});

test('点券余额确认为 0 时，首次获得的点券不会当成基线吞掉', (t) => {
    const h = statsHarness(t);
    const stats = h.load();
    // 背包快照里点券余额就是 0：已确认，0 是真实余额
    stats.initStatsWithPersistence('acc', 1000, 0, 0, 0, { coupon: true });
    assert.equal(readStats(stats, 1000).sessionCouponGained, 0, '基线时刻没有变化');

    // 首次赚到 50 点券：基线已经是 0，50 全部计入今日
    assert.equal(readStats(stats, 1000, 0, 50).sessionCouponGained, 50, '首次获得的点券计入今日');
    assert.equal(readStats(stats, 1000, 0, 80).sessionCouponGained, 80, '继续获得的点券累加');
});

test('点券余额未确认时，首次观测只建立基线', (t) => {
    const h = statsHarness(t);
    const stats = h.load();
    // 没有背包快照：点券余额未知，不能把 0 当成 0 点基线
    stats.initStatsWithPersistence('acc', 1000, 0, 0);
    assert.equal(readStats(stats, 1000, 0, 50).sessionCouponGained, 0, '首个可信观测只建立基线');
    assert.equal(readStats(stats, 1000, 0, 80).sessionCouponGained, 30, '基线建立后才开始累计');
});

test('金豆基线在登录时用背包快照建立并落盘', (t) => {
    const h = statsHarness(t);
    const stats = h.load();
    stats.initStatsWithPersistence('acc', 1000, 0, 0, 49534, { goldBean: true });
    assert.equal(readStats(stats, 1000, 0, 0, 49534).sessionGoldBeanGained, 0, '基线时刻没有变化');
    assert.equal(readStats(stats, 1000, 0, 0, 49634).sessionGoldBeanGained, 100, '金豆变化计入今日');

    const saved = h.readStatsFile();
    assert.equal(saved.todayBaseline.goldBean, 49534, '金豆基线落盘');
    assert.equal(saved.baselineReady.goldBean, true, '金豆基线可信标记落盘');
});

test('十二项今日资产按可信余额计算净变化，缺失保持未知', (t) => {
    const h = statsHarness(t);
    const stats = h.load();
    stats.initStatsWithPersistence('acc', 100, 0, 20, 30, { coupon: true, goldBean: true });
    const keys = ['gold', 'coupon', 'goldBean', 'ranchCoupon', 'pinecone', 'grass', 'dung', 'diamond',
        'fertilizerNormal', 'fertilizerOrganic', 'canNormal', 'canOrganic'];
    const initial = readStats(stats, 100, 0, 20, 30).todayAssetGains;
    assert.deepEqual(Object.keys(initial), keys);
    for (const key of keys.slice(3)) assert.equal(initial[key], null, `${key} 未观测时未知`);
    assert.equal(initial.gold, 0);
    assert.equal(initial.coupon, 0);
    assert.equal(initial.goldBean, 0);

    const balances = { ranchCoupon: 0, pinecone: 10, grass: 20, dung: 30,
        diamond: 40, fertilizerNormal: 3600, fertilizerOrganic: 7200, canNormal: 10800, canOrganic: 14400 };
    stats.recordAssetBalances(balances);
    assert.equal(stats.getAssetTodayGains().ranchCoupon, 0, '确认的零余额可用作基线');
    stats.recordAssetBalances({ ranchCoupon: 5, pinecone: 3, grass: 20, dung: 0, diamond: 0,
        fertilizerNormal: 7200, fertilizerOrganic: 3600, canNormal: 7200, canOrganic: 18000 });
    const gains = readStats(stats, 90, 0, 15, 35).todayAssetGains;
    assert.deepEqual(JSON.parse(JSON.stringify(gains)), {
        gold: -10, coupon: -5, goldBean: 5, ranchCoupon: 5, pinecone: -7,
        grass: 0, dung: -30, diamond: -40, fertilizerNormal: 3600,
        fertilizerOrganic: -3600, canNormal: -3600, canOrganic: 3600,
    });
    const offline = stats.getStats({ gold: 90 }, { gold: 90 }, false, {}).todayAssetGains;
    for (const key of keys) assert.equal(offline[key], null, `${key} 离线时未知`);
});

test('资产基线同日持久化，重启等待新观测；跨日重置', (t) => {
    const h = statsHarness(t);
    const stats = h.load();
    stats.initStatsWithPersistence('acc', 100, 0);
    stats.recordAssetBalances({ diamond: 100, canNormal: 0 });
    stats.recordAssetBalances({ diamond: 75, canNormal: 3600 });
    assert.equal(h.readStatsFile().assetBaseline.diamond, 100);
    assert.equal(h.readStatsFile().assetBaseline.canNormal, 0);

    const restarted = h.load();
    restarted.initStatsWithPersistence('acc', 100, 0);
    assert.equal(restarted.getAssetTodayGains().diamond, null, '重启前余额不再当作当前余额');
    restarted.recordAssetBalances({ diamond: 60, canNormal: 0 });
    assert.equal(restarted.getAssetTodayGains().diamond, -40);
    assert.equal(restarted.getAssetTodayGains().canNormal, 0);
    restarted.recordAssetBalances({ pinecone: null, grass: -1, dung: 'oops', diamond: Number.NaN });
    assert.equal(restarted.getAssetTodayGains().pinecone, null);
    assert.equal(restarted.getAssetTodayGains().grass, null);
    assert.equal(restarted.getAssetTodayGains().dung, null);
    assert.equal(restarted.getAssetTodayGains().diamond, -40);

    h.clock.dateKey = '2026-11-18';
    assert.equal(restarted.getAssetTodayGains().diamond, null, '跨日未观测不沿用昨日余额');
    restarted.recordAssetBalances({ diamond: 60, canNormal: 0 });
    assert.equal(restarted.getAssetTodayGains().diamond, 0);
    restarted.recordAssetBalances({ diamond: 65 });
    assert.equal(restarted.getAssetTodayGains().diamond, 5);
    assert.equal(h.readStatsFile().date, '2026-11-18');
    assert.equal(h.readStatsFile().assetBaseline.diamond, 60);

    h.clock.dateKey = '2026-11-19';
    const nextDay = h.load();
    nextDay.initStatsWithPersistence('acc', 100, 0);
    assert.equal(nextDay.getAssetTodayGains().diamond, null);
    nextDay.recordAssetBalances({ diamond: 65 });
    assert.equal(nextDay.getAssetTodayGains().diamond, 0);
    assert.equal(h.readStatsFile().assetBaseline.diamond, 65);
});

test('登录时确认的金币为 0 不会被当成全部余额', (t) => {
    const h = statsHarness(t);
    const stats = h.load();
    // 背包快照确认金币余额就是 0
    stats.initStatsWithPersistence('acc', 0, 0, 0, 0, { gold: true });
    assert.equal(readStats(stats, 0).sessionGoldGained, 0, '余额为 0 时今日累计就是 0');
    assert.equal(readStats(stats, 500).sessionGoldGained, 500, '之后赚到的金币正常累计');
});
