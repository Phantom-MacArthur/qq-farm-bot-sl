const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup({ stock = 1, balance = 100, fail = false } = {}) {
    let occupied = 0;
    const calls = [];
    const goods = { id: '10', animal: { id: 1 }, maxCount: 1, price: { count: '10', balance } };
    const state = () => ({
        facilities: [{ id: 'pen', name: 'coop', moduleType: 6, active: true, ranch: { count: occupied, capacity: 3 } }],
        bag: stock ? [{ id: 1, animalId: 1, husbandryType: '\u7a9d', count: stock, locked: false }] : [],
        shop: { goods: [goods] },
    });
    const box = { exports: {} };
    const settings = { ranch_strategy: 'bag_priority', ranch_coop_cub_priority: [1], ranch_shed_cub_priority: [] };
    const actions = {
        prepareAction: async (kind, input) => ({ expected: { signature: 'fresh' }, skipped: false }),
        operate: async (kind, input) => {
            calls.push({ kind, input });
            if (fail) throw new Error('pending operation');
            if (kind === 'place') stock -= input.count;
            else goods.price.balance -= input.count * 10;
            occupied += input.count;
            return { status: 'confirmed' };
        },
    };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../dist/services/ranch/restock.js'), 'utf8'), {
        module: box, exports: box.exports,
        require: name => name === './state' ? { getState: async () => state() }
            : name === './actions' ? actions
            : name === './automation' ? { selectAnimal: list => list[0] }
            : { getAutomation: () => settings },
    });
    return { run: box.exports.restock, calls };
}

test('restock places bag cubs first then buys only the remaining vacancies', async () => {
    const api = setup();
    const result = await api.run();
    assert.equal(result.completed, 3);
    assert.deepEqual(api.calls.map(call => call.kind), ['place', 'buy', 'buy']);
    assert.equal(api.calls[0].input.count, 1);
});
test('restock respects the available purchase balance', async () => {
    const api = setup({ stock: 0, balance: 0 });
    const result = await api.run();
    assert.equal(result.completed, 0);
    assert.equal(api.calls.length, 0);
});
test('an uncertain placement never falls through to another purchase for the same pen', async () => {
    const api = setup({ fail: true });
    const result = await api.run();
    assert.equal(result.completed, 0);
    assert.equal(api.calls.length, 1);
    assert.match(result.notice, /pending operation/);
});
