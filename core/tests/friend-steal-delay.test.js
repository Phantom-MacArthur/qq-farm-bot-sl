const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadFixture(filename, dependencies, now) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports, Date: { now }, require: name => dependencies[name] || {},
    }, { filename });
    return module.exports;
}

test('farm schedules stealing from the first entry, then rechecks on a later visit', async () => {
    let now = 1000;
    let stealable = true;
    const calls = [];
    const { visitFriend } = loadFixture(require.resolve('../dist/services/friend/visit-strategy'), {
        '../../config/config': { PlantPhase: { MATURE: 6 } },
        '../../config/gameConfig': { getPlantName: () => '白菜' },
        '../../models/store': { isAutomationOn: key => key === 'friend_steal' },
        '../../utils/network': { networkEvents: { on() {} } },
        '../../utils/utils': { toNum: Number, randomDelay: async () => {}, log: () => {} },
        '../farm': {
            buildLandMap: () => ({}), isOccupiedSlaveLand: () => false, getCurrentPhase: phases => phases[0],
        },
        './scheduler': { setCanGetHelpExp: () => {} },
        './api': {
            enterFriendFarm: async () => {
                calls.push('enter');
                return { lands: [{ id: 1, plant: { id: 2, stealable, phases: [{ phase: 6 }] } }] };
            },
            leaveFriendFarm: async () => calls.push('leave'),
            stealHarvest: async () => calls.push('steal'),
        },
        '../stats': { recordOperation: () => {} },
    }, () => now);
    const friend = { gid: 7, name: '好友' };
    const actions = { steal: 0 };
    const first = await visitFriend(friend, actions, 1, 'test', { stealDelayMs: 5000 });
    assert.equal(first.stealReadyAt, 6000);
    assert.deepEqual(calls, ['enter', 'leave']);
    now = first.stealReadyAt;
    stealable = false;
    await visitFriend(friend, actions, 1, 'test');
    assert.equal(actions.steal, 0);
    stealable = true;
    await visitFriend(friend, actions, 1, 'test');
    assert.equal(actions.steal, 1);
    assert.deepEqual(calls.slice(-3), ['enter', 'steal', 'leave']);
});

test('ranch leaves the scene while waiting and steals on a fresh visit when released', async () => {
    let now = 1000;
    const calls = [];
    const socket = {};
    const { automateFriend } = loadFixture(require.resolve('../dist/services/ranch/friends'), {
        './transport': {
            inScene: run => run(),
            rpc: async route => {
                calls.push(route);
                if (route === 'enterFriend') return { basic: { gid: '7', name: '好友' }, homestead_cells: {} };
                if (route === 'animals') {
                    now += 100; // The delay starts on entry, not when the animal snapshot arrives.
                    return { ranches: [{ ranch_inst_id: 1, shelves: [{
                        can_steal: true, slot_index: 0, lots: [{ can_steal: true, remain_num: 1, stealers: [], item_id: 2 }],
                    }] }] };
                }
                if (route === 'steal') return { op_results: [] };
            },
        },
        '../../utils/network': { getUserState: () => ({ gid: 1 }), getWs: () => socket },
        './model': { positiveId: String, quantity: String, sumItems: items => items },
        './context': { getAmbientSendContext: () => null, runWithSendContext: (_ctx, run) => run() },
        './operation-state': { forCurrentAccount: () => ({ spend: (_reservation, run) => run() }) },
    }, () => now);
    const enabled = action => action === 'steal';
    const first = await automateFriend('7', enabled, undefined, undefined, {}, 5000);
    assert.equal(first.stealReadyAt, 6000);
    assert.deepEqual(calls, ['enterFriend', 'animals', 'leaveFriend']);
    now = first.stealReadyAt;
    await automateFriend('7', enabled);
    assert.deepEqual(calls.slice(3), ['enterFriend', 'animals', 'steal', 'leaveFriend']);
});
