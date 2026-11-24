const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness({ growing = [], stock = [1], failBook = false, uncertain = false, fallback = 'level' } = {}) {
    const calls = [];
    const lands = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, unlocked: true }));
    growing.forEach((id, index) => { lands[index].plant = { id }; });
    const empty = () => lands.filter(land => !land.plant).map(land => land.id);
    const pending = [1, 2, 3];
    const box = { exports: {} };
    const num = value => Number(value) || 0;
    const config = {
        getPlantBySeedId: id => ({ seed_id: num(id), size: 1, name: String(id) }),
        getPlantById: id => id ? { seed_id: num(id) } : null,
        getPlantByFruitId: () => null,
        getPlantNameBySeedId: String,
        getPlantGrowTime: () => 0,
    };
    const api = {
        getAllLands: async () => ({ lands }),
        buyGoods: async (id, count) => {
            calls.push({ kind: 'buy', id, count });
            return { get_items: [{ id, count }], cost_items: [] };
        },
    };
    const mocks = {
        plant: async (id, anchors, options) => {
            calls.push({ kind: 'plant', id, count: anchors.length });
            anchors.forEach(anchor => { lands.find(land => land.id === anchor).plant = { id }; });
            return { planted: anchors.length, plantedLandIds: anchors, occupiedLandIds: anchors, reservedLandIds: [], uncertain };
        },
        candidates: async strategy => (strategy === 'max_profit' ? [2, 4, 3, 1] : [4, 3, 2, 1]).map(seedId => ({ seedId, goodsId: seedId, requiredLevel: seedId, price: 1, maxPurchaseCount: 99, unitItemCount: 1 })),
    };
    const imports = {
        '../../config/gameConfig': config,
        '../../models/store': {
            getPlantingStrategy: () => 'illustrated', getBagSeedFallbackStrategy: () => fallback,
            getBagSeedPriority: () => [], getBagSeedLandTypes: () => ({}), getBagSeedMultiLandReservationEnabled: () => false,
            getPlantDelaySeconds: () => 0, getPreferredSeed: () => 0,
        },
        '../../utils/network': { getUserState: () => ({ level: 100, gold: 1000 }) },
        '../../utils/utils': { toNum: num, log() {}, logWarn() {} },
        '../illustrated': { getNormalIllustratedList: async () => {
            if (failBook) throw new Error('offline');
            return { list: [...pending.map(fruit_id => ({ fruit_id, unlocked: false })), { fruit_id: 4, unlocked: true }] };
        } },
        '../warehouse': { getBagSeeds: async () => stock.map(seedId => ({ seedId, name: String(seedId), requiredLevel: seedId, count: 99, plantSize: 1 })) },
        './api': api,
        './land-analysis': {
            ALL_FERTILIZER_LAND_TYPES: [], normalizeFertilizerLandTypes: () => [], getLandTypeByLevel: () => 'normal',
            buildPlantingLayouts: ids => ids.map(id => ({ anchorLandId: id, landIds: [id] })),
            selectNonOverlappingLayouts: (layouts, count) => layouts.slice(0, count),
        },
        './layout-reservation': { clearRegisteredLayout() {} },
        '../stats': { recordOperation() {} }, '../status': { updateStatusGold() {} },
    };
    const code = fs.readFileSync(path.resolve(__dirname, '../dist/services/farm/planting.js'), 'utf8');
    vm.runInNewContext(code + '\nplantSeeds = mocks.plant; findBestSeed = mocks.candidates; runFertilizerByConfig = async () => {}; sortBagSeedsForPlanting = seeds => seeds; resolveLandTypeMapForBagSeeds = async () => new Map();', {
        module: box, exports: box.exports, mocks, console,
        require: name => imports[name] || (name.startsWith('node:') || name === 'protobufjs' ? require(name) : {}),
    });
    return { calls, run: () => box.exports.autoPlantEmptyLands([], empty(), { knownLands: lands }) };
}

test('ordinary book plants one per missing species, bag first, then fills with completed species', async () => {
    const h = harness();
    await h.run();
    assert.deepEqual(h.calls.filter(call => call.kind === 'plant').map(call => [call.id, call.count]), [[1, 1], [2, 1], [3, 1], [4, 3]]);
    assert.equal(h.calls.some(call => call.kind === 'buy' && call.id === 1), false);
});

test('growing species are excluded from book targets', async () => {
    const h = harness({ growing: [2] });
    await h.run();
    assert.equal(h.calls.some(call => call.id === 2), false);
});

test('book bag fallback uses the complete bag after purchasing missing targets', async () => {
    const h = harness({ stock: [1, 4], fallback: 'bag_priority' });
    await h.run();
    assert.deepEqual(h.calls.filter(call => call.kind === 'plant').map(call => [call.id, call.count]), [[1, 1], [2, 1], [3, 1], [1, 3]]);
    assert.equal(h.calls.some(call => call.kind === 'buy' && call.id === 4), false);
});

test('normal profit fallback can choose an unlit species already growing', async () => {
    const h = harness({ growing: [2], fallback: 'max_profit' });
    await h.run();
    assert.deepEqual(h.calls.filter(call => call.kind === 'plant').map(call => [call.id, call.count]), [[1, 1], [3, 1], [2, 3]]);
});

test('book bag fallback does not filter unlit stock', async () => {
    const h = harness({ growing: [2], stock: [1, 2, 4], fallback: 'bag_priority' });
    await h.run();
    assert.equal(h.calls.some(call => call.kind === 'plant' && call.id === 1 && call.count > 1), true);
    assert.equal(h.calls.some(call => call.kind === 'buy' && call.id === 4), false);
});

test('a second round does not plant or buy another copy of an in-progress target', async () => {
    const h = harness();
    await h.run();
    const before = h.calls.length;
    await h.run();
    assert.equal(h.calls.length, before);
});

test('failed book reads stop planting and purchasing', async () => {
    const h = harness({ failBook: true });
    await h.run();
    assert.equal(h.calls.length, 0);
});

test('uncertain bag planting never falls through to shop purchases', async () => {
    const h = harness({ uncertain: true });
    await h.run();
    assert.equal(h.calls.filter(call => call.kind === 'buy').length, 0);
});
