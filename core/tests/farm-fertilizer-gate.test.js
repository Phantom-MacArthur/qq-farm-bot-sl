const assert = require('node:assert/strict');
const test = require('node:test');

const { PlantPhase } = require('../dist/config/config');

const NOW_SEC = 1790000000;

/**
 * 两块都在生长、都还能施普通化肥；leftTimes 传 0 表示这一季已经施满。
 */
function land(id, leftTimes) {
    return {
        id,
        unlocked: true,
        level: 1,
        plant: {
            id: 2020002,
            left_inorc_fert_times: leftTimes,
            phases: [{ phase: PlantPhase.SMALL_LEAVES, begin_time: NOW_SEC - 60 }],
        },
    };
}

function stub(name, exports) {
    const id = require.resolve(`../dist/${name}`);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function harness({ latched, lands, targetLeftTimes = [2, 2], automation = { fertilizer: 'normal' }, levels = [1, 1] }) {
    const snapshot = targetLeftTimes.map((leftTimes, index) => ({ ...land(index + 1, leftTimes), level: levels[index] }));
    const calls = { getAllLands: 0, fertilize: [], organic: [] };
    const logs = [];
    stub('services/farm/api', {
        getAllLands: async () => { calls.getAllLands++; return { lands: snapshot }; },
        buyGoods: async () => ({}),
        removePlant: async () => ({}),
        fertilizeOne: async () => ({}),
        isFertilizerContainerEmpty: id => latched && id === 1011,
        fertilize: async (ids) => { calls.fertilize.push(ids); return ids.length; },
        fertilizeOrganicLoop: async ids => { calls.organic.push(ids); return ids.length; },
    });
    stub('models/store', {
        // 不勾范围限制（用默认全选），让断言只盯住「容器为空」和「地块复用」这两件事
        getAutomation: () => automation,
        getPreferredSeed: () => 0,
        getPlantingStrategy: () => ({}),
        getBagSeedPriority: () => [],
        getBagSeedMultiLandReservationEnabled: () => false,
        getBagSeedLandTypes: () => [],
        getBagSeedFallbackStrategy: () => 'any',
    });
    stub('utils/network', { getUserState: () => ({ gid: 1 }), getWsErrorState: () => ({}), sendMsgAsync: async () => ({ body: Buffer.alloc(0) }) });
    stub('utils/proto', { types: {} });
    stub('utils/utils', {
        toNum: v => Number(v) || 0,
        getServerTimeSec: () => NOW_SEC,
        log: (...args) => logs.push(args),
        logWarn: (...args) => logs.push(args),
        sleep: async () => {},
    });
    stub('services/analytics', { getPlantRankings: () => [] });
    stub('services/stats', { recordOperation: () => {} });
    stub('services/warehouse', { getBagSeeds: () => [] });
    stub('services/career', { getCareerInfoOrNull: () => null });

    const plantingId = require.resolve('../dist/services/farm/planting');
    delete require.cache[plantingId];
    const { runFertilizerByConfig } = require(plantingId);
    const options = { reason: 'multi_season' };
    if (lands) options.lands = lands === 'snapshot' ? snapshot : lands;
    return {
        run: () => runFertilizerByConfig([1, 2], options),
        calls,
        skipLogs: () => logs.filter(entry => entry[2]?.result === 'skip'),
    };
}

test('普通化肥容器为空时不发施肥请求，日志说明是容器为空', async () => {
    const h = harness({ latched: true, lands: 'snapshot' });
    const result = await h.run();
    assert.deepEqual(h.calls.fertilize, []);
    assert.equal(result.normal, 0);
    assert.ok(h.skipLogs().some(entry => entry[2]?.cause === 'container_empty'), '跳过要能看出是容器为空');
});

test('容器没空时按传入的地块快照筛目标，不再拉 AllLands', async () => {
    const h = harness({ latched: false, lands: 'snapshot', targetLeftTimes: [2, 0] });
    const result = await h.run();
    assert.deepEqual(h.calls.fertilize, [[1]]);
    assert.equal(result.normal, 1);
    assert.equal(h.calls.getAllLands, 0);
});

test('分地类补肥复用同一快照，普通肥不足时金土地仍施有机肥', async () => {
    const config = { fertilizer_land_strategies: { red: 'normal', gold: 'organic' } };
    for (const latched of [false, true]) {
        const h = harness({ latched, lands: 'snapshot', automation: config, levels: [2, 4] });
        const result = await h.run();
        assert.equal(h.calls.getAllLands, 0);
        assert.deepEqual(h.calls.fertilize, latched ? [] : [[1]]);
        assert.deepEqual(h.calls.organic, [[2]]);
        assert.deepEqual(result, { normal: latched ? 0 : 1, organic: 1 });
    }
});

test('调用方没有地块时仍自己拉一次 AllLands', async () => {
    const h = harness({ latched: false, lands: null });
    const result = await h.run();
    assert.deepEqual(h.calls.fertilize, [[1, 2]]);
    assert.equal(result.normal, 2);
    assert.equal(h.calls.getAllLands, 1);
});
