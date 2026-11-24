const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const test = require('node:test');
const vm = require('node:vm');

const { PlantPhase } = require('../dist/config/config');
const { getServerTimeSec } = require('../dist/utils/utils');
const { DEFAULT_ACCOUNT_CONFIG, globalConfig, normalizeAccountConfig } = require('../dist/models/store/shared-state');
const { applyConfigSnapshot, ensureAccountConfig, getAccountConfigSnapshot, getConfigSnapshot } = require('../dist/models/store/account-config');
const { pickDefaultPlanConfig } = require('../dist/models/store/user-default-plan');

function load(relativePath, overrides) {
    const filepath = require.resolve(relativePath);
    const localRequire = createRequire(filepath);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filepath, 'utf8'), {
        exports: module.exports, module, require: name => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name),
    });
    return module.exports;
}

test('fertilizer purchase intervals inherit the legacy value and save independently', () => {
    const accountId = '__fertilizer_buy_intervals__';
    try {
        const legacy = normalizeAccountConfig({ fertilizerBuyCheckIntervalMinutes: 17 });
        assert.equal(legacy.fertilizerBuyCheckIntervalMinutes, 17);
        assert.equal(legacy.fertilizerBuyNormalCheckIntervalMinutes, 17);

        applyConfigSnapshot(legacy, { accountId, persist: false });
        applyConfigSnapshot({ fertilizerBuyNormalCheckIntervalMinutes: 52 }, { accountId, persist: false });
        assert.equal(getConfigSnapshot(accountId).fertilizerBuyCheckIntervalMinutes, 17);

        applyConfigSnapshot({ fertilizerBuyCheckIntervalMinutes: 23 }, { accountId, persist: false });
        const plan = pickDefaultPlanConfig(getConfigSnapshot(accountId));
        assert.equal(plan.fertilizerBuyCheckIntervalMinutes, 23);
        assert.equal(plan.fertilizerBuyNormalCheckIntervalMinutes, 52);
    } finally {
        delete globalConfig.accountConfigs[accountId];
    }
});

test('fertilizer purchase timers check only their fertilizer and refresh independently', async () => {
    const calls = [];
    const tasks = new Map();
    const enabled = new Set(['fertilizer_buy_organic', 'fertilizer_buy_normal']);
    let normalMinutes = 41;
    const { startFarmCheckLoop, refreshFarmCheckLoop, stopFarmCheckLoop } = load('../dist/services/farm/scheduler', {
        '../../models/store': {
            isAutomationOn: key => enabled.has(key),
            getAutomation: () => ({}),
            getFertilizerBuyCheckIntervalMinutes: () => 19,
            getFertilizerBuyNormalCheckIntervalMinutes: () => normalMinutes,
            getFertilizerBuyOrganicCount: () => 1,
            getFertilizerBuyOrganicThresholdHours: () => 6,
            getFertilizerBuyNormalCount: () => 2,
            getFertilizerBuyNormalThresholdHours: () => 8,
        },
        '../../utils/network': { getUserState: () => ({ gid: 1 }), networkEvents: { on() {}, removeListener() {} } },
        '../../utils/utils': { log() {}, logWarn: message => assert.fail(message) },
        '../scheduler': {
            createScheduler: () => ({
                setIntervalTask: (name, intervalMs, execute) => tasks.set(name, { intervalMs, execute }),
                has: name => tasks.has(name),
                clear: name => tasks.delete(name),
                clearAll: () => tasks.clear(),
            }),
        },
        '../automation-lock': { runExclusiveAutomationTask: async (_name, execute) => execute() },
        '../mall': {
            checkAndBuyFertilizerBoth: async ({ buyOrganic, buyNormal }) => calls.push([buyOrganic, buyNormal]),
        },
    });

    startFarmCheckLoop({ externalScheduler: true });
    const organicTask = tasks.get('fertilizer_buy_check_organic');
    const normalTask = tasks.get('fertilizer_buy_check_normal');
    assert.equal(organicTask.intervalMs, 19 * 60_000);
    assert.equal(normalTask.intervalMs, 41 * 60_000);
    await organicTask.execute();
    await normalTask.execute();

    normalMinutes = 7;
    refreshFarmCheckLoop();
    assert.equal(tasks.get('fertilizer_buy_check_organic'), organicTask);
    const refreshedTask = tasks.get('fertilizer_buy_check_normal');
    assert.equal(refreshedTask.intervalMs, 7 * 60_000);
    await normalTask.execute();
    await refreshedTask.execute();

    enabled.delete('fertilizer_buy_normal');
    refreshFarmCheckLoop();
    assert.equal(tasks.has('fertilizer_buy_check_normal'), false);
    await refreshedTask.execute();
    stopFarmCheckLoop();
    assert.equal(tasks.size, 0);
    assert.deepEqual(calls, [[true, false], [false, true], [false, true]]);
});

function growingLand(id, time, options = {}) {
    const now = getServerTimeSec();
    return {
        id, unlocked: true, level: options.level ?? 1, master_land_id: options.masterId ?? 0,
        plant: { id: 2020002, left_inorc_fert_times: options.remaining ?? 1, phases: [
            { phase: PlantPhase.GERMINATION, begin_time: now - 100 },
            { phase: PlantPhase.MATURE, begin_time: now + time },
        ] },
    };
}

test('new accounts default to no fertilizer and existing strategies round-trip unchanged', () => {
    const accountId = '__farm_ripening_test__';
    try {
        assert.equal(DEFAULT_ACCOUNT_CONFIG.automation.fertilizer, 'none');
        assert.equal(ensureAccountConfig(accountId, { persist: false }).automation.fertilizer, 'none');
        for (const mode of ['smart', 'both', 'normal', 'organic', 'none', 'normal_ripen', 'organic_ripen']) {
            const automation = { fertilizer: mode, fertilizer_smart_seconds: 450 };
            assert.equal(normalizeAccountConfig({ automation }).automation.fertilizer, mode);
            applyConfigSnapshot({ automation }, { accountId, persist: false });
            const saved = getAccountConfigSnapshot(accountId).automation;
            assert.equal(saved.fertilizer, mode);
            assert.equal(saved.fertilizer_smart_seconds, 450);
        }
        applyConfigSnapshot({ automation: { fertilizer: 'invalid' } }, { accountId, persist: false });
        assert.equal(getAccountConfigSnapshot(accountId).automation.fertilizer, 'organic_ripen');
    } finally {
        delete globalConfig.accountConfigs[accountId];
    }
});

test('ripening selects only configured land types and sends one batch of the chosen fertilizer', async () => {
    const calls = [];
    const { runRipeningFertilizer } = load('../dist/services/farm/ripening', {
        './api': {
            getAllLands: async () => assert.fail('reuse supplied snapshot'),
            fertilizeBatch: async (ids, fertilizer) => {
                calls.push([fertilizer, ...ids]);
                return { land: [{ id: ids[0] }, { id: 99 }] };
            },
            fertilizeOrganicLoop: async ids => { calls.push(['legacy', ...ids]); return ids.length; },
        },
        '../stats': { recordOperation() {} },
        '../../utils/utils': { toNum: value => Number(value) || 0, log() {} },
    });
    const lands = [
        growingLand(1, 120), growingLand(2, 240, { remaining: 0 }), growingLand(3, 600),
        growingLand(4, 120, { level: 4 }), growingLand(5, 120, { masterId: 1 }),
    ];
    const config = { fertilizer_land_types: ['normal'], fertilizer_smart_seconds: 300 };
    assert.equal(await runRipeningFertilizer({ ...config, fertilizer: 'none' }, lands), 0);
    assert.equal(await runRipeningFertilizer({ ...config, fertilizer: 'normal_ripen' }, lands), 1);
    assert.equal(await runRipeningFertilizer({ ...config, fertilizer: 'organic_ripen' }, lands), 1);
    assert.equal(await runRipeningFertilizer({ ...config, fertilizer: 'smart' }, lands), 2);
    assert.equal(await runRipeningFertilizer({ ...config, fertilizer: 'organic_ripen', fertilizer_land_types: [] }, lands), 0);
    assert.deepEqual(calls, [[1011, 1], [1012, 1, 2], ['legacy', 1, 2]]);
});

test('ripening-only modes do not spend fertilizer in sowing or multi-season top-up', async () => {
    for (const fertilizer of ['normal_ripen', 'organic_ripen']) {
        const { runFertilizerByConfig } = load('../dist/services/farm/planting', {
            '../../models/store': { getAutomation: () => ({ fertilizer }) },
            './api': {
                getAllLands: async () => assert.fail('ripening-only mode must not read at sowing'),
                fertilize: async () => assert.fail('ripening-only mode must not fertilize at sowing'),
                fertilizeOrganicLoop: async () => assert.fail('ripening-only mode must not fertilize at sowing'),
            },
        });
        for (const reason of ['normal', 'multi_season']) {
            const result = await runFertilizerByConfig([1], { reason });
            assert.equal(result.normal + result.organic, 0);
        }
    }
});

test('land strategies save independently and leave other land types on their previous settings', () => {
    const accountId = '__farm_land_fertilizer_strategies__';
    try {
        applyConfigSnapshot({ automation: { fertilizer: 'both', fertilizer_land_types: ['normal', 'gold'] } }, { accountId, persist: false });
        applyConfigSnapshot({ automation: { fertilizer_land_strategies: { gold: 'organic_ripen', red: 'normal', normal: 'none', unknown: 'both' } } }, { accountId, persist: false });
        assert.deepEqual(getAccountConfigSnapshot(accountId).automation.fertilizer_land_strategies, {
            gold: 'organic_ripen', red: 'normal', normal: 'none',
        });
        assert.deepEqual(getAccountConfigSnapshot(accountId).automation.fertilizer_land_types, ['normal', 'gold']);
    } finally {
        delete globalConfig.accountConfigs[accountId];
    }
});

test('sowing and ripening route each land type to its own fertilizer choice', async () => {
    const config = {
        fertilizer: 'both', fertilizer_land_types: ['normal', 'gold'], fertilizer_smart_seconds: 300,
        fertilizer_land_strategies: { gold: 'organic', black: 'organic_ripen', red: 'normal_ripen', normal: 'none', 'blue-crystal': 'normal' },
    };
    const lands = [
        growingLand(1, 120), growingLand(2, 120, { level: 2 }), growingLand(3, 120, { level: 3 }),
        growingLand(4, 120, { level: 4 }), growingLand(5, 120, { level: 6 }),
    ];
    const calls = [];
    const api = {
        getAllLands: async () => ({ lands }),
        fertilize: async ids => { calls.push(['normal', ...ids]); return ids.length; },
        fertilizeOrganicLoop: async ids => { calls.push(['organic', ...ids]); return ids.length; },
        fertilizeBatch: async (ids, item) => { calls.push([item, ...ids]); return { land: ids.map(id => ({ id })) }; },
    };
    const mocks = { './api': api, '../stats': { recordOperation() {} }, '../../utils/utils': { toNum: Number, log() {}, logWarn() {} } };
    const { runFertilizerByConfig } = load('../dist/services/farm/planting', {
        ...mocks, '../../models/store': { getAutomation: () => config },
    });
    const { runRipeningFertilizer } = load('../dist/services/farm/ripening', mocks);
    const result = await runFertilizerByConfig([1, 2, 3, 4, 5]);
    assert.equal(result.normal, 1);
    assert.equal(result.organic, 1);
    assert.equal(await runRipeningFertilizer(config, lands), 2);
    assert.equal(await runRipeningFertilizer({ ...config, fertilizer_enabled: false }, lands), 0);
    assert.deepEqual(calls, [['normal', 5], ['organic', 4], [1012, 3], [1011, 2]]);
});

test('patrol reuses its land read and rechecks once for harvest only after successful ripening', async () => {
    for (const successful of [false, true]) {
        const calls = [];
        const land = growingLand(1, 120);
        const status = { harvestable: [], needWeed: [], needBug: [], needWater: [], needInteractionCleanup: [],
            dead: [], empty: [], unlockable: [], upgradable: [], growing: [1] };
        const { runFarmOperation } = load('../dist/services/farm/scheduler', {
            '../../models/store': { getAutomation: () => ({ fertilizer: 'normal_ripen' }), isAutomationOn: () => false },
            '../../utils/network': { getUserState: () => ({ gid: 1 }), networkEvents: { emit() {} } },
            '../../utils/utils': { toNum: Number, log() {}, logWarn() {} },
            '../stats': { recordOperation() {} },
            './api': {
                getAllLands: async () => { calls.push('read'); return { lands: [land] }; },
                harvest: async ids => { calls.push(`harvest:${ids.join(',')}`); return {}; },
            },
            './land-analysis': {
                analyzeLands: () => calls.includes('ripen') ? { ...status, harvestable: [1] } : status,
                getCleanableFarmSocialEventItemIds: () => [], resolveRemovableHarvestedLands: async () => ({ growing: [] }),
            },
            './ripening': {
                isRipeningOnlyMode: mode => mode === 'normal_ripen',
                runRipeningFertilizer: async (config, lands) => {
                    assert.equal(config.fertilizer, 'normal_ripen');
                    assert.equal(lands[0], land);
                    calls.push('ripen');
                    return Number(successful);
                },
            },
        });
        assert.equal((await runFarmOperation('all', null, true)).hadWork, successful);
        assert.deepEqual(calls, successful ? ['read', 'ripen', 'read', 'harvest:1'] : ['read', 'ripen']);
    }
});
