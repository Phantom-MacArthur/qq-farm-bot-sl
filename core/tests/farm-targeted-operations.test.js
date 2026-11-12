const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const dist = path.resolve(__dirname, '../dist');
const calls = [];
let status;

function installMock(relativePath, exports) {
    const filename = path.resolve(dist, relativePath);
    const mocked = new Module(filename);
    mocked.filename = filename;
    mocked.loaded = true;
    mocked.exports = exports;
    require.cache[filename] = mocked;
}

function makeStatus(overrides = {}) {
    return {
        harvestable: [],
        needWeed: [],
        needBug: [],
        needInteractionCleanup: [],
        needWater: [],
        dead: [],
        empty: [],
        unlockable: [],
        upgradable: [],
        growing: [],
        harvestableInfo: [],
        ...overrides,
    };
}

installMock('config/config.js', { CONFIG: { farmCheckInterval: 1000 } });
installMock('config/gameConfig.js', { getPlantById: () => null, getItemById: () => null });
installMock('models/store/index.js', {
    isAutomationOn: () => false,
    getAutomation: () => ({}),
    getFertilizerBuyOrganicCount: () => 0,
    getFertilizerBuyOrganicThresholdHours: () => 0,
    getFertilizerBuyNormalCount: () => 0,
    getFertilizerBuyNormalThresholdHours: () => 0,
    getFertilizerBuyCheckIntervalMinutes: () => 0,
});
installMock('utils/network.js', {
    getUserState: () => ({ gid: 1 }),
    networkEvents: { emit: () => {}, on: () => {} },
});
installMock('utils/utils.js', {
    toNum: value => Number(value) || 0,
    log: () => {},
    logWarn: () => {},
    randomDelay: async () => {},
});
installMock('services/scheduler.js', { createScheduler: () => ({ setTimeoutTask: () => {} }) });
installMock('services/automation-lock.js', { runExclusiveAutomationTask: async () => {} });
installMock('services/stats.js', { recordOperation: () => {} });
installMock('services/mall.js', { checkAndBuyFertilizerBoth: async () => {} });
installMock('services/farm/api.js', {
    getAllLands: async () => ({ lands: [{ id: 1 }, { id: 2 }, { id: 3 }] }),
    harvest: async landIds => {
        calls.push(['harvest', landIds]);
        return {};
    },
    farming: async () => {},
    unlockLand: async () => {},
    upgradeLand: async landId => {
        calls.push(['upgrade', landId]);
        return { land: { level: 2 } };
    },
    removePlant: async landIds => {
        calls.push(['remove', landIds]);
        return {};
    },
});
installMock('services/farm/land-analysis.js', {
    analyzeLands: () => status,
    getCleanableFarmSocialEventItemIds: () => [],
    getNormalFertilizerTargetsFromLands: () => [],
    resolveRemovableHarvestedLands: async () => ({ growing: [], removable: [] }),
    getLandTypeByLevel: () => 'normal',
    normalizeFertilizerLandTypes: () => [],
    filterLandIdsByTypes: () => [],
    ALL_FERTILIZER_LAND_TYPES: [],
});
installMock('services/farm/planting.js', {
    autoPlantEmptyLands: async (deadLandIds, emptyLandIds, options) => {
        calls.push(['plant', deadLandIds, emptyLandIds, options.targetLandIds]);
        return { plantedLands: [...emptyLandIds] };
    },
    getRemainingPlantDelayMs: () => 0,
    runFertilizerByConfig: async () => ({ normal: 0, organic: 0 }),
});

const { runFarmOperation } = require('../dist/services/farm/scheduler');

test('harvest operation is restricted to the selected land', async () => {
    calls.length = 0;
    status = makeStatus({ harvestable: [1, 2] });

    await runFarmOperation('harvest', 2, true);

    assert.deepEqual(calls, [['harvest', [2]]]);
});

test('plant operation only removes and replants the selected land', async () => {
    calls.length = 0;
    status = makeStatus({ empty: [1, 2], dead: [3] });

    await runFarmOperation('plant', 2, true);

    assert.deepEqual(calls, [['plant', [], [2], [2]]]);
});

test('planting a selected dead land keeps its cleanup and replanting target scoped', async () => {
    calls.length = 0;
    status = makeStatus({ empty: [1, 2], dead: [3] });

    await runFarmOperation('plant', 3, true);

    assert.deepEqual(calls, [['plant', [3], [], [3]]]);
});

test('upgrade operation is restricted to the selected upgradable land', async () => {
    calls.length = 0;
    status = makeStatus({ unlockable: [3], upgradable: [1, 2] });

    await runFarmOperation('upgrade', 2, true);

    assert.deepEqual(calls, [['upgrade', 2]]);
});

test('remove operation only removes the selected planted land', async () => {
    calls.length = 0;
    status = makeStatus({ growing: [1, 2], harvestable: [3] });

    await runFarmOperation('remove', 2, true);

    assert.deepEqual(calls, [['remove', [2]]]);
});

test('remove operation rejects empty lands', async () => {
    calls.length = 0;
    status = makeStatus({ growing: [1], empty: [2] });

    await assert.rejects(runFarmOperation('remove', 2, true), /当前没有可铲除的作物/);

    assert.deepEqual(calls, []);
});

test('remove operation requires an explicit land target', async () => {
    calls.length = 0;
    status = makeStatus({ growing: [1] });

    await assert.rejects(runFarmOperation('remove', null, true), /必须指定地块/);

    assert.deepEqual(calls, []);
});
