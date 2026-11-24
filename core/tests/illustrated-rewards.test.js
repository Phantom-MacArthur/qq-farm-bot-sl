const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const protobuf = require('protobufjs');
const root = new protobuf.Root().loadSync(['illustratedpb.proto', 'collectionpb.proto'].map(file => path.join(__dirname, '../src/proto', file)), { keepCase: true });
const types = Object.fromEntries(['GetIllustratedListV2Request', 'GetIllustratedListV2Reply', 'GetIllustratedLevelListV2Request', 'GetIllustratedLevelListV2Reply', 'ClaimAllRewardsV2Request', 'ClaimAllRewardsV2Reply'].map(n => [n, root.lookupType(`gamepb.illustratedpb.${n}`)]));
for (const name of ['GetCollectionsRequest', 'GetCollectionsReply', 'ClaimCollectionRewardRequest', 'ClaimCollectionRewardReply']) {
    types[name] = root.lookupType(`gamepb.collectionpb.${name}`);
}
function harness() {
    let writes = 0;
    let failRefresh = false;
    const requests = [];
    const levels = [{ level: 28, point_condition: 5530, rewards: [{ id: 1002, count: 200 }], claimed: true }, { level: 29, point_condition: 6010, rewards: [{ id: 1002, count: 200 }], can_claim: true }, { level: 30, point_condition: 6520, rewards: [{ id: 1002, count: 200 }] }];
    const bookLevels = { 1: levels, 2: structuredClone(levels) };
    const collection = { category: 1, current_score: 400, claimed_reward_score: 0 };
    const records = [];
    const warnings = [];
    const control = { beforeSend: () => {} };
    const mock = (name, exports) => { const id = require.resolve(`../dist/${name}`); require.cache[id] = { id, filename: id, loaded: true, exports }; };
    mock('utils/proto', { types }); mock('utils/utils', { toNum: Number, log() {}, logWarn: (_module, message) => warnings.push(message) });
    mock('services/farm-reward-history', { recordFarmReward: (key, rewards, name) => records.push({ key, rewards, name }) });
    mock('config/gameConfig', { getItemById: id => ({ name: `物品${id}` }), getItemImageById: () => '', getPlantBySeedId: () => null, getPlantByFruitId: () => null, getPlantNameBySeedId: () => '', getIllustratedTypeByParam: () => '', getIllustratedSortByParam: () => 1, getIllustratedBuffsByLevel: () => [], getIllustratedBuffs: () => [], getAllSeeds: () => [] });
    mock('services/farm', { getAvailableSeeds: async () => [] });
    mock('utils/network', { sendMsgAsync: async (_service, method, body, options) => {
        const req = types[`${method}Request`].decode(body);
        control.beforeSend(method, req.type);
        const blocked = options?.beforeSend?.();
        if (blocked) throw blocked;
        requests.push({ method, type: req.type, body });
        let reply;
        if (method === 'ClaimAllRewardsV2') {
            writes++;
            bookLevels[req.type][1].claimed = true;
            bookLevels[req.type][1].can_claim = false;
            reply = { total_rewards: [{ id: 1002, count: 200 }], claimed_level_ids: [29], current_level: 29 };
        } else if (method === 'GetCollections') {
            assert.deepEqual(req.categories, [1]);
            reply = { details: [collection] };
        } else if (method === 'ClaimCollectionReward') {
            assert.equal(req.category, 1);
            writes++;
            collection.claimed_reward_score = 400;
            reply = { ...collection, claimed_scores: [400], total_rewards: [{ id: 1002, count: 10 }] };
        } else {
            if (failRefresh && writes) throw new Error('offline');
            reply = method === 'GetIllustratedLevelListV2' ? { current_level: 29, total_progress: 6100, level_list: bookLevels[req.type] } : { type: req.type, current_level: 29, total_progress: 6100, next_level_progress: 6520, list: [] };
        }
        return { body: types[`${method}Reply`].encode(types[`${method}Reply`].fromObject(reply)).finish() };
    } });
    for (const module of ['illustrated', 'collections', 'farm-illustrated-rewards', '../utils/reward-items']) {
        delete require.cache[require.resolve(`../dist/services/${module}`)];
    }
    return {
        service: require('../dist/services/illustrated'),
        autoClaim: require('../dist/services/farm-illustrated-rewards').claimFarmIllustratedRewards,
        records, warnings, control, requests, failRefresh: () => { failRefresh = true; }, writes: () => writes,
    };
}
test('illustrated rewards distinguish claimed, claimable and unmet levels', async () => {
    const h = harness();
    const state = (await h.service.getIllustratedSnapshot()).crop;
    assert.equal(state.progress, 6100);
    assert.equal(state.nextLevelProgress, 6520);
    assert.deepEqual(state.levels.map(v => [v.claimed, v.canClaim]), [[true, false], [false, true], [false, false]]);
    assert.equal(state.levels[1].rewards[0].count, 200);
    assert.equal(state.claimable, true);
    assert.equal(h.requests[0].body.toString('hex'), '08001001');
});
test('illustrated claims use the requested book type and reject duplicate/invalid claims', async () => {
    const h = harness();
    await assert.rejects(h.service.claimIllustratedRewards('1'), /类型无效/);
    const result = await h.service.claimIllustratedRewards(2);
    assert.deepEqual(result.claimedLevels, [29]);
    assert.equal(result.rewards[0].itemId, 1002);
    assert.equal(h.requests.find(v => v.method === 'ClaimAllRewardsV2').body.toString('hex'), '0802');
    await assert.rejects(h.service.claimIllustratedRewards(2), /暂无/);
    assert.equal(h.writes(), 1);
});
test('illustrated claim success survives a subsequent refresh failure', async () => {
    const h = harness(); h.failRefresh();
    const result = await h.service.claimIllustratedRewards(1);
    assert.equal(result.refreshRequired, true);
    assert.equal(result.rewards[0].count, 200);
    assert.equal(h.writes(), 1);
});

test('farm automation claims each eligible book once without loading display snapshots', async () => {
    const h = harness();
    await h.autoClaim(() => true);
    assert.deepEqual(h.requests.map(({ method, type }) => type ? `${method}:${type}` : method), [
        'GetIllustratedLevelListV2:1', 'ClaimAllRewardsV2:1',
        'GetIllustratedLevelListV2:2', 'ClaimAllRewardsV2:2',
        'GetCollections', 'ClaimCollectionReward',
    ]);
    assert.deepEqual(h.records.map(({ name }) => name), ['作物图鉴奖励', '超变图鉴奖励', '藏品图鉴奖励']);
    assert.deepEqual(h.records.map(({ rewards }) => rewards[0].count), [200, 200, 10]);
    await h.autoClaim(() => true);
    assert.equal(h.writes(), 3);
    assert.equal(h.records.length, 3);
});

test('a failed book does not block other books, and disabling before a queued claim stops writes', async () => {
    const h = harness();
    await h.autoClaim(() => false);
    assert.equal(h.requests.length, 0);
    let enabled = true;
    h.control.beforeSend = (method, type) => {
        if (method === 'GetIllustratedLevelListV2' && type === 1) throw new Error('crop unavailable');
        if (method === 'ClaimCollectionReward') enabled = false;
    };
    await h.autoClaim(() => enabled);
    assert.equal(h.writes(), 1);
    assert.deepEqual(h.records.map(({ name }) => name), ['超变图鉴奖励']);
    assert.deepEqual(h.warnings, ['作物图鉴自动领取失败：crop unavailable']);
});
