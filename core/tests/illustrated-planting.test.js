const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness({
    growing = [], failBook = false, uncertain = false, fallback = 'level',
    strategy = 'illustrated', stock = strategy === 'illustrated' ? [1] : [], rankedFallback = '',
    preferredSeed = strategy === 'preferred' ? 1 : 0, gold = 1000, confirmedGold = gold, purchaseError,
    shopSeeds = [1, 2, 3, 4], shopUnitCounts = {}, activityEnd = 0, eligibleActivityLands = [], automaticRedPotatoes = false,
} = {}) {
    const calls = [];
    const lands = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, unlocked: true }));
    growing.forEach((id, index) => { lands[index].plant = { id }; });
    const empty = () => lands.filter(land => !land.plant).map(land => land.id);
    const pending = [1, 2, 3];
    const box = { exports: {} };
    const state = { level: 100, gold };
    const priceOf = id => strategy === 'illustrated' ? 1 : (id === 1 ? 10 : id === 20307 ? 3 : id);
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
        getShopInfo: async () => ({
            goods_list: shopSeeds.map(id => ({
                id, item_id: id, item_count: shopUnitCounts[id] || 1, price: priceOf(id), unlocked: true,
                conds: [{ type: 1, param: id === 20307 ? 1 : id }],
            })),
        }),
        buyGoods: async (id, count) => {
            calls.push({ kind: 'buy', id, count });
            if (id === 1 && purchaseError) throw purchaseError;
            return { get_items: [{ id, count: count * (shopUnitCounts[id] || 1) }], cost_items: [{ count: priceOf(id) * count }] };
        },
    };
    const mocks = {
        plant: async (id, anchors, options) => {
            anchors = anchors.filter(anchor => !options.canPlant || options.canPlant(anchor)).slice(0, options.maxPlantCount);
            if (!anchors.length) return { planted: 0, plantedLandIds: [], occupiedLandIds: [], reservedLandIds: [], uncertain: false };
            calls.push({ kind: 'plant', id, count: anchors.length });
            anchors.forEach(anchor => { lands.find(land => land.id === anchor).plant = { id }; });
            return { planted: anchors.length, plantedLandIds: anchors, occupiedLandIds: anchors, reservedLandIds: [], uncertain };
        },
    };
    const imports = {
        '../../config/gameConfig': config,
        '../../config/yishuhuanfu': { YISHU_SEED_ID: 20307, getYishuActivityEnd: () => activityEnd },
        './yishuhuanfu-plan': { estimateYishuLand: land => ({ landId: land.id, eligible: eligibleActivityLands.includes(land.id) }) },
        '../yishuhuanfu-history': { appendYishuHistory() {} },
        '../../models/store': {
            getAutomation: () => ({ yishu_plant: automaticRedPotatoes }),
            getPlantingStrategy: () => strategy, getBagSeedFallbackStrategy: () => fallback,
            getRankedSeedFallbackStrategy: () => rankedFallback,
            getBagSeedPriority: () => [], getBagSeedLandTypes: () => ({}), getBagSeedMultiLandReservationEnabled: () => false,
            getPlantDelaySeconds: () => 0, getPreferredSeed: () => preferredSeed,
        },
        '../../utils/network': { getUserState: () => state },
        '../../utils/utils': { toNum: num, getServerTimeSec: () => 100, log() {}, logWarn() {} },
        '../analytics': {
            getPlantRankings: sort => ({ profit: [2, 4, 3, 1], exp: [1, 4, 3, 2] }[sort] || []).map(seedId => ({ seedId })),
        },
        '../illustrated': { getNormalIllustratedList: async () => {
            if (failBook) throw new Error('offline');
            return { list: [...pending.map(fruit_id => ({ fruit_id, unlocked: false })), { fruit_id: 4, unlocked: true }] };
        } },
        '../warehouse': {
            getBagSeeds: async () => stock.map(seed => {
                const { seedId, count } = typeof seed === 'number' ? { seedId: seed, count: 99 } : seed;
                return { seedId, name: String(seedId), requiredLevel: seedId, count, plantSize: 1 };
            }),
            getCurrentTotalsFromBag: async () => ({ gold: confirmedGold }),
        },
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
    vm.runInNewContext(code + '\nplantSeeds = mocks.plant; runFertilizerByConfig = async () => {}; sortBagSeedsForPlanting = seeds => seeds; resolveLandTypeMapForBagSeeds = async () => new Map();', {
        module: box, exports: box.exports, mocks, console, process: { env: {} },
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

test('preferred seed uses the configured shop ranking for land left after a partial purchase', async () => {
    const h = harness({ strategy: 'preferred', fallback: 'max_profit', gold: 14 });
    await h.run();
    assert.deepEqual(h.calls.filter(call => call.kind === 'buy').map(({ id, count }) => [id, count]), [[1, 1], [2, 2]]);
});

test('preferred seed uses the second strategy when the first seed is unaffordable', async () => {
    const h = harness({ strategy: 'preferred', fallback: 'max_profit', gold: 6 });
    await h.run();
    assert.deepEqual(h.calls.filter(call => call.kind === 'buy').map(({ id, count }) => [id, count]), [[2, 3]]);
});

test('preferred seed can fall back to bag seeds with no gold', async () => {
    const h = harness({ strategy: 'preferred', fallback: 'bag_priority', gold: 0, stock: [2] });
    await h.run();
    assert.deepEqual(h.calls, [{ kind: 'plant', id: 2, count: 6 }]);
});

test('an unavailable preferred seed and an empty bag fall back to the cheapest seed', async () => {
    const h = harness({ strategy: 'preferred', fallback: 'bag_priority', gold: 6, stock: [] });
    await h.run();
    assert.deepEqual(h.calls, [{ kind: 'buy', id: 2, count: 3 }, { kind: 'plant', id: 2, count: 3 }]);
});

test('cheapest fallback compares unit price but still requires enough gold for the whole pack', async () => {
    const pack = { strategy: 'preferred', fallback: 'bag_priority', stock: [], shopUnitCounts: { 4: 4 } };
    const affordable = harness({ ...pack, gold: 4 });
    await affordable.run();
    assert.deepEqual(affordable.calls, [{ kind: 'buy', id: 4, count: 1 }, { kind: 'plant', id: 4, count: 4 }]);
    const tooExpensive = harness({ ...pack, gold: 2 });
    await tooExpensive.run();
    assert.deepEqual(tooExpensive.calls, [{ kind: 'buy', id: 2, count: 1 }, { kind: 'plant', id: 2, count: 1 }]);
});

test('confirmed insufficient gold refreshes the balance before trying the second strategy', async () => {
    const purchaseError = Object.assign(new Error('金币不足'), { name: 'GatewayError', errorMessage: '金币不足' });
    const h = harness({ strategy: 'preferred', fallback: 'max_profit', gold: 20, confirmedGold: 6, purchaseError });
    await h.run();
    assert.deepEqual(h.calls.map(({ kind, id, count }) => [kind, id, count]), [['buy', 1, 2], ['buy', 2, 3], ['plant', 2, 3]]);
});

test('unknown preferred purchase outcome stops before using the second strategy', async () => {
    const h = harness({ strategy: 'preferred', fallback: 'bag_priority', gold: 20, stock: [2], purchaseError: new Error('timeout') });
    await h.run();
    assert.deepEqual(h.calls, [{ kind: 'buy', id: 1, count: 2 }]);
});

test('legacy experience ranking continues through its own candidates without a configured fallback', async () => {
    const h = harness({ strategy: 'max_exp', gold: 6 });
    await h.run();
    assert.deepEqual(h.calls.filter(call => call.kind === 'buy').map(({ id, count }) => [id, count]), [[4, 1], [2, 1]]);
});

test('experience ranking uses the configured shop strategy when the top seed is unaffordable', async () => {
    const h = harness({ strategy: 'max_exp', rankedFallback: 'max_profit', gold: 6 });
    await h.run();
    assert.deepEqual(h.calls.filter(call => call.kind === 'buy').map(({ id, count }) => [id, count]), [[2, 3]]);
});

test('experience ranking buys the top seed first and fills remaining land from the bag', async () => {
    const h = harness({ strategy: 'max_exp', rankedFallback: 'bag_priority', gold: 11, stock: [2] });
    await h.run();
    assert.deepEqual(h.calls, [{ kind: 'buy', id: 1, count: 1 }, { kind: 'plant', id: 1, count: 1 }, { kind: 'plant', id: 2, count: 5 }]);
});

test('a preferred seed found only in the bag uses just that stock before the second strategy', async () => {
    const h = harness({
        strategy: 'preferred', preferredSeed: 5, fallback: 'max_exp',
        stock: [{ seedId: 5, count: 2 }, 2],
    });
    await h.run();
    assert.deepEqual(h.calls.map(({ kind, id, count }) => [kind, id, count]), [
        ['plant', 5, 2], ['buy', 1, 4], ['plant', 1, 4],
    ]);
});

test('selected red potatoes only use eligible plots before the second strategy', async () => {
    const h = harness({
        strategy: 'preferred', preferredSeed: 20307, fallback: 'max_exp',
        stock: [20307, 2], activityEnd: 200, eligibleActivityLands: [1, 2],
    });
    await h.run();
    assert.deepEqual(h.calls.map(({ kind, id, count }) => [kind, id, count]), [
        ['plant', 20307, 2], ['buy', 1, 4], ['plant', 1, 4],
    ]);
});

test('selected red potatoes stay in the bag when the activity is inactive', async () => {
    const h = harness({ strategy: 'preferred', preferredSeed: 20307, fallback: 'max_exp', stock: [20307] });
    await h.run();
    assert.deepEqual(h.calls.map(({ kind, id, count }) => [kind, id, count]), [['buy', 1, 6], ['plant', 1, 6]]);
});

test('a preferred red potato fallback is used after the primary experience crop', async () => {
    const h = harness({
        strategy: 'max_exp', rankedFallback: 'preferred', preferredSeed: 20307,
        gold: 11, stock: [20307], activityEnd: 200, eligibleActivityLands: [2], automaticRedPotatoes: true,
    });
    await h.run();
    assert.deepEqual(h.calls.map(({ kind, id, count }) => [kind, id, count]), [
        ['buy', 1, 1], ['plant', 1, 1], ['plant', 20307, 1],
    ]);
});

test('preferred seed consumes its own bag stock and can buy more of the same seed', async () => {
    const h = harness({ strategy: 'preferred', fallback: 'max_exp', stock: [{ seedId: 1, count: 2 }, 2] });
    await h.run();
    assert.deepEqual(h.calls.map(({ kind, id, count }) => [kind, id, count]), [
        ['plant', 1, 2], ['buy', 1, 4], ['plant', 1, 4],
    ]);
});

test('listed preferred red potatoes can be purchased for plots within the activity deadline', async () => {
    const h = harness({
        strategy: 'preferred', preferredSeed: 20307, fallback: 'max_exp',
        shopSeeds: [1, 2, 20307], activityEnd: 200, eligibleActivityLands: [1, 2],
    });
    await h.run();
    assert.deepEqual(h.calls.map(({ kind, id, count }) => [kind, id, count]), [
        ['buy', 20307, 2], ['plant', 20307, 2], ['buy', 1, 4], ['plant', 1, 4],
    ]);
});

test('a listed red potato seed is skipped when no land can meet the deadline', async () => {
    const h = harness({ strategy: 'preferred', preferredSeed: 20307, fallback: 'max_exp',
        shopSeeds: [1, 2, 20307], activityEnd: 200 });
    await h.run();
    assert.deepEqual(h.calls.map(({ kind, id, count }) => [kind, id, count]), [['buy', 1, 6], ['plant', 1, 6]]);
});

test('confirmed sold-out preferred seeds fall through to the next strategy', async () => {
    const purchaseError = Object.assign(new Error('商品已售罄'), { name: 'GatewayError', errorMessage: '商品已售罄' });
    const h = harness({ strategy: 'preferred', fallback: 'max_profit', purchaseError });
    await h.run();
    assert.deepEqual(h.calls.map(({ kind, id, count }) => [kind, id, count]), [['buy', 1, 6], ['buy', 2, 6], ['plant', 2, 6]]);
});

test('preferred seed and unlit book targets run before cheapest seeds', async () => {
    const h = harness({ strategy: 'preferred', fallback: 'illustrated',
        stock: [{ seedId: 1, count: 2 }, 2, 4], gold: 5 });
    await h.run();
    assert.deepEqual(h.calls.map(({ kind, id, count }) => [kind, id, count]), [
        ['plant', 1, 2], ['plant', 2, 1], ['buy', 3, 1], ['plant', 3, 1], ['buy', 2, 1], ['plant', 2, 1],
    ]);
});

test('failed book read leaves confirmed preferred planting in the result', async () => {
    const h = harness({ strategy: 'preferred', fallback: 'illustrated',
        stock: [{ seedId: 1, count: 2 }, 2], gold: 0, failBook: true });
    const result = await h.run();
    assert.deepEqual(Array.from(result.plantedLands), [1, 2]);
    assert.deepEqual(h.calls, [{ kind: 'plant', id: 1, count: 2 }]);
});

test('experience ranking runs the book strategy before other ranked shop seeds', async () => {
    const h = harness({ strategy: 'max_exp', rankedFallback: 'illustrated', gold: 11, stock: [2, 3] });
    await h.run();
    assert.deepEqual(h.calls.map(({ kind, id, count }) => [kind, id, count]), [
        ['buy', 1, 1], ['plant', 1, 1], ['plant', 2, 1], ['plant', 3, 1],
    ]);
});

test('bag strategy uses the book strategy when its inventory leaves empty plots', async () => {
    const h = harness({ strategy: 'bag_priority', fallback: 'illustrated', stock: [{ seedId: 4, count: 2 }] });
    await h.run();
    assert.deepEqual(h.calls.filter(call => call.kind === 'plant').map(({ id, count }) => [id, count]), [
        [4, 2], [1, 1], [2, 1], [3, 1], [2, 1],
    ]);
});

test('a legacy duplicate book strategy uses the normalized level strategy for its second slot', async () => {
    const h = harness({ fallback: 'illustrated', stock: [1, 4] });
    await h.run();
    assert.deepEqual(h.calls.filter(call => call.kind === 'plant').map(({ id, count }) => [id, count]), [
        [1, 1], [2, 1], [3, 1], [4, 3],
    ]);
});
