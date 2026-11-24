const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness({ failBook = false, uncertain = false, fallback = 'level', completedStock = false, activeHigh = false } = {}) {
    const animals = activeHigh ? [2, 4] : [2];
    const calls = [];
    const settings = { ranch_strategy: 'illustrated', ranch_bag_fallback: fallback, ranch_coop_cub_priority: [], ranch_shed_cub_priority: [] };
    const good = id => ({ id, available: true, animal: { id, enable_flag: true, husbandry_type: '窝' }, price: { id: 1007, count: '10', balance: '100' }, requiredLevel: id, maxCount: 99, remaining: null });
    const state = () => ({
        facilities: [{ id: 'coop', moduleType: 6, active: true, name: '窝', ranch: { count: animals.length, capacity: 5, animals: animals.map(animalId => ({ animalId })) } }],
        bag: [{ id: 1, animalId: 1, husbandryType: '窝', count: '5', locked: false, requiredLevel: 1 }, { id: 3, animalId: 3, husbandryType: '窝', count: '5', locked: true, requiredLevel: 3 }, ...(completedStock ? [{ id: 4, animalId: 4, husbandryType: '窝', count: '5', locked: false, requiredLevel: 4 }] : [])],
        shop: { goods: [good(1), good(2), good(3), good(4)] },
        book: { animals: [1, 2, 3].map(animalId => ({ animalId, unlocked: false })).concat([{ animalId: 4, unlocked: !activeHigh }]) },
    });
    const box = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../dist/services/ranch/restock.js'), 'utf8'), {
        module: box, exports: box.exports,
        require: name => name === './state' ? { getState: async view => {
            if (view === 'illustrated' && failBook) throw new Error('book unavailable');
            return state();
        } } : name === './actions' ? {
            prepareAction: async () => ({ expected: {} }),
            operate: async (kind, input) => {
                calls.push({ kind, ...input });
                if (uncertain) return { status: 'pending' };
                const id = kind === 'place' ? input.itemId : input.goodsId;
                for (let i = 0; i < input.count; i++) animals.push(id);
                return { status: 'confirmed' };
            },
        } : name === './automation' ? { selectAnimal: goods => goods.slice().sort((a, b) => b.animal.id - a.animal.id)[0] }
            : { getAutomation: () => settings },
    });
    return { calls, run: box.exports.restock };
}

test('book restock uses one bag cub and buys one missing species, excluding active and locked stock', async () => {
    const h = harness();
    await h.run();
    assert.deepEqual(h.calls.map(call => [call.kind, call.itemId || call.goodsId, call.count]), [['place', 1, 1], ['buy', 3, 1], ['buy', 4, 2]]);
});

test('book restock does not repeat pending species after restart or another click', async () => {
    const h = harness();
    await h.run();
    const before = h.calls.length;
    await h.run();
    assert.equal(h.calls.length, before);
});

test('book bag fallback uses completed cubs after buying missing targets', async () => {
    const h = harness({ fallback: 'bag_priority', completedStock: true });
    await h.run();
    assert.deepEqual(h.calls.map(call => [call.kind, call.itemId || call.goodsId, call.count]), [['place', 1, 1], ['buy', 3, 1], ['place', 4, 2]]);
});

test('book bag fallback can reuse remaining unlit cubs during normal filling', async () => {
    const h = harness({ fallback: 'bag_priority' });
    await h.run();
    assert.deepEqual(h.calls.map(call => [call.kind, call.itemId || call.goodsId, call.count]), [['place', 1, 1], ['buy', 3, 1], ['place', 1, 2]]);
});

test('normal level fallback may buy an unlit animal already being raised', async () => {
    const h = harness({ activeHigh: true });
    await h.run();
    assert.deepEqual(h.calls.map(call => [call.kind, call.itemId || call.goodsId, call.count]), [['place', 1, 1], ['buy', 3, 1], ['buy', 4, 1]]);
});

test('a pending placement stops the pen before buying', async () => {
    const h = harness({ uncertain: true });
    await h.run();
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].kind, 'place');
});

test('book read failure never falls back to purchases', async () => {
    const h = harness({ failBook: true });
    await assert.rejects(h.run(), /book unavailable/);
    assert.equal(h.calls.length, 0);
});

test('configuration accepts book priority but disallows recursive fallback', () => {
    const { normalizeAccountConfig } = require('../dist/models/store/shared-state');
    const { normalizeRanchSetting } = require('../dist/config/ranch-automation');
    assert.equal(normalizeAccountConfig({ plantingStrategy: 'illustrated' }).plantingStrategy, 'illustrated');
    assert.equal(normalizeAccountConfig({ bagSeedFallbackStrategy: 'illustrated' }).bagSeedFallbackStrategy, 'level');
    assert.equal(normalizeRanchSetting('ranch_strategy', 'illustrated'), 'illustrated');
    assert.equal(normalizeAccountConfig({ bagSeedFallbackStrategy: 'bag_priority' }).bagSeedFallbackStrategy, 'bag_priority');
    assert.equal(normalizeRanchSetting('ranch_bag_fallback', 'bag_priority'), 'bag_priority');
    assert.throws(() => normalizeRanchSetting('ranch_bag_fallback', 'illustrated'));
});
