const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const protobuf = require('protobufjs');
const root = new protobuf.Root().loadSync(path.join(__dirname, '../src/proto/mallpb.proto'), { keepCase: true });
const names = ['GetMonthCardInfosRequest', 'GetMonthCardInfosReply', 'ClaimMonthCardRewardRequest', 'ClaimMonthCardRewardReply'];
const types = Object.fromEntries(names.map(name => [name, root.lookupType(`gamepb.mallpb.${name}`)]));

function loadMonthCard(replies) {
    const mock = (name, exports) => { const id = require.resolve(`../dist/${name}`); require.cache[id] = { id, filename: id, loaded: true, exports }; };
    mock('utils/proto', { types });
    mock('utils/utils', { toNum: v => Number(v) || 0, log() {}, getSystemDateKey: () => '2026-11-19' });
    mock('config/gameConfig', {
        getItemById: id => ({ 1002: { name: '点券' } })[id],
        getItemImageById: id => `/game-config/seed_images_named/seed_images/${id}.png`,
    });
    mock('utils/network', {
        sendMsgAsync: async (_service, method) => {
            const type = types[`${method}Reply`];
            return { body: Buffer.from(type.encode(type.fromObject(replies[method])).finish()) };
        },
    });
    for (const name of ['services/monthcard', 'utils/reward-items']) delete require.cache[require.resolve(`../dist/${name}`)];
    return require('../dist/services/monthcard');
}

test('没买月卡时服务器仍返回月卡条目：不能显示为今日已完成，也不能断言已开通', async () => {
    const service = loadMonthCard({ GetMonthCardInfos: { infos: [{ goods_id: 2001, reward: { id: 1002, count: 30 }, can_claim: false }] } });
    assert.equal(await service.performDailyMonthCardGift(true), false);
    const state = service.getMonthCardDailyState();
    assert.equal(state.doneToday, false, '没有领到就不是已完成');
    assert.equal(state.checkedToday, true, '今天已查过，避免重复轮询');
    assert.equal(state.hasCard, null, '条目存在但不可领时无法确认是否开通');
    assert.equal(state.hasClaimable, false);
    assert.deepEqual(state.rewards, []);
});

test('月卡可领时领取并记录奖励，状态为今日已领取', async () => {
    const service = loadMonthCard({
        GetMonthCardInfos: { infos: [{ goods_id: 2001, reward: { id: 1002, count: 30 }, can_claim: true }] },
        ClaimMonthCardReward: { items: [{ id: 1002, count: 30 }] },
    });
    assert.equal(await service.performDailyMonthCardGift(true), true);
    const state = service.getMonthCardDailyState();
    assert.equal(state.doneToday, true);
    assert.equal(state.hasCard, true);
    assert.deepEqual(state.rewards, [{ id: 1002, count: 30, extra: false, name: '点券', image: '/game-config/seed_images_named/seed_images/1002.png' }]);
});

test('服务器没有任何月卡条目时为未开通', async () => {
    const service = loadMonthCard({ GetMonthCardInfos: { infos: [] } });
    await service.performDailyMonthCardGift(true);
    const state = service.getMonthCardDailyState();
    assert.equal(state.hasCard, false);
    assert.equal(state.doneToday, false);
});
