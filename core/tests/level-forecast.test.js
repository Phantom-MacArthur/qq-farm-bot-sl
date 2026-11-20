const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildHarvestEvents, calculateLevelForecast } = require('../dist/services/level-forecast');
const now = 1800000000;
const plant = id => ({ exp: id === 2 ? 1000 : 856 });
function land(id, matureAt = now + 21600, options = {}) {
    return { id, unlocked: true, level: 4, buff: { plant_exp_bonus: 0 },
        plant: { id: 1, phases: [{ phase: 1, begin_time: now - 100 }, { phase: 6, begin_time: matureAt }] }, ...options };
}
const predict = options => calculateLevelForecast({ nowSec: now, remainingExp: 12660, historyRate: 1121,
    connected: true, autoHarvest: true, getPlant: plant, ...options });

test('issue 86: scheduled harvest reaches the threshold in six hours even after a fresh login', () => {
    const lands = Array.from({ length: 24 }, (_, i) => land(i + 1, now + 21600 + i));
    const value = predict({ lands });
    assert.equal(value.source, 'planted');
    assert.equal(value.scheduledExp, 20544);
    assert.equal(value.plotCount, 24);
    assert.equal(value.estimatedAt, (now + 21614) * 1000);
    assert.equal(predict({ lands, historyRate: 0 }).estimatedAt, value.estimatedAt);
});

test('joint footprints and duplicate land entries contribute only one harvest', () => {
    const master = land(1, now + 100, { slave_land_ids: [2, 3, 4], buff: { plant_exp_bonus: 2500 } });
    const events = buildHarvestEvents([master, master, land(2), land(3, now + 100, { master_land_id: 1 }), land(4)], now, plant);
    assert.deepEqual(events, [{ landId: 1, at: now + 100, exp: 1070 }]);
});

test('locked, dead, missing configurations, missing buffs and missing maturity are excluded', () => {
    const lands = [land(1, now, { unlocked: false }), land(2, now, { buff: null }),
        land(3, now, { plant: { id: 1, phases: [{ phase: 7, begin_time: now - 1 }] } }),
        land(4, now, { plant: { id: 1, phases: [{ phase: 1, begin_time: now - 1 }] } }),
        land(5, now, { plant: { id: 99, phases: [{ phase: 6, begin_time: now }] } })];
    assert.deepEqual(buildHarvestEvents(lands, now, id => id === 99 ? null : plant(id)), []);
});

test('server maturity uses phase six, not a later dead phase or an assumed extra season', () => {
    const entry = land(1, now + 100);
    entry.plant.season = 1;
    entry.plant.phases.push({ phase: 7, begin_time: now + 1000 });
    assert.equal(buildHarvestEvents([entry], now, () => ({ exp: 500, seasons: 2 }))[0].at, now + 100);
    assert.equal(buildHarvestEvents([entry], now, () => ({ exp: 500, seasons: 2 }))[0].exp, 500);
});

test('ready harvest remains conditional on collecting; manual and quiet modes have no historical ETA', () => {
    const ready = predict({ lands: [land(1, now - 10)], remainingExp: 500, autoHarvest: false });
    assert.equal(ready.source, 'ready');
    assert.equal(ready.automatic, false);
    assert.equal(ready.estimatedAt, now * 1000);
    for (const flags of [{ autoHarvest: false }, { quiet: true }]) {
        assert.equal(predict({ lands: [], ...flags }).estimatedAt, null);
    }
    assert.equal(predict({ connected: false, lands: [land(1)], remainingExp: 500 }).estimatedAt, null);
});

test('detailed mature phase and the configured final blooming phase are forecast without guessing another season', () => {
    const explicit = land(1, now, { plant: { id: 1, phases: [{ phase: 2, phase_id: 19, begin_time: now - 1 }] } });
    assert.equal(buildHarvestEvents([explicit], now, plant)[0].at, now);
    const blooming = land(2, now, { plant: { id: 2, phases: [{ phase: 2, begin_time: now - 100 }, { phase: 2, begin_time: now + 50 }] } });
    assert.equal(buildHarvestEvents([blooming], now, () => ({ exp: 100, grow_phases: '种子:50;生长:50;盛开:0' }))[0].at, now + 50);
});

test('history only extends the gap after the last scheduled harvest without double counting', () => {
    const value = predict({ lands: [land(1, now + 7200)], remainingExp: 1000, historyRate: 100, getPlant: () => ({ exp: 500 }) });
    assert.equal(value.source, 'mixed');
    assert.equal(value.estimatedAt, (now + 7200 + 18000) * 1000);
    assert.equal(predict({ lands: [], remainingExp: 1000, historyRate: 100 }).source, 'history');
    assert.equal(predict({ lands: [], historyRate: 0 }).estimatedAt, null);
});

test('snapshot invalidation rejects in-flight old reads, stale snapshots and another account, but survives experience changes', () => {
    let clock = now;
    const box = { exports: {} };
    const filename = path.resolve(__dirname, '../dist/services/level-forecast.js');
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: box, exports: box.exports,
        require: name => name.includes('gameConfig') ? { getPlantById: plant } : { getServerTimeSec: () => clock } });
    const api = box.exports;
    const user = { gid: 1, exp: 100 }; const progress = { needed: 600, current: 100 };
    const stats = { connection: { connected: true }, sessionExpGained: 0, sessionElapsedSeconds: 0 };
    const query = (owner = user) => api.getLevelForecast(owner, progress, stats, { farm: true }, false);
    const revision = api.getLandForecastRevision();
    api.invalidateLandForecast();
    api.rememberLandForecast([land(1)], user, revision);
    assert.equal(query().source, 'unavailable');
    api.rememberLandForecast([land(1)], user, api.getLandForecastRevision());
    assert.equal(query().source, 'planted');
    assert.equal(query().snapshotValid, true);
    assert.equal(query({ ...user, gid: 2 }).source, 'unavailable');
    // 收获只改变经验值，不改变土地快照：经验变化不再让种植经验整栏消失。
    assert.equal(query({ ...user, exp: 101 }).source, 'planted');
    clock += 181;
    assert.equal(query().source, 'unavailable');
    // 快照过期时必须告诉前端「数据暂不可用」，而不是「确实没有在田作物」。
    assert.equal(query().snapshotValid, false);
});

test('stale land snapshots trigger an extra refresh so the forecast shows up right after login', () => {
    let clock = now;
    const box = { exports: {} };
    const filename = path.resolve(__dirname, '../dist/services/level-forecast.js');
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: box, exports: box.exports,
        require: name => name.includes('gameConfig') ? { getPlantById: plant } : { getServerTimeSec: () => clock } });
    const api = box.exports;
    const user = { gid: 1, exp: 100 }; const progress = { needed: 600, current: 100 };
    const stats = { connection: { connected: true }, sessionExpGained: 0, sessionElapsedSeconds: 0 };
    const query = () => api.getLevelForecast(user, progress, stats, { farm: true }, false);
    // 刚登录时还没有快照：需要立刻补拉一次。
    assert.equal(api.isLandForecastStale(user), true);
    api.rememberLandForecast([land(1)], user, api.getLandForecastRevision());
    assert.equal(api.isLandForecastStale(user), false);
    assert.equal(query().source, 'planted');
    // 自家土地变动后快照作废，需要补拉。
    api.invalidateLandForecast();
    assert.equal(api.isLandForecastStale(user), true);
    api.rememberLandForecast([land(1)], user, api.getLandForecastRevision());
    assert.equal(api.isLandForecastStale(user), false);
    // 快照放太久也要补拉。
    clock += 61;
    assert.equal(api.isLandForecastStale(user), true);
});

test('session efficiency starts at login and resets its numerator and denominator together on another login', () => {
    let clock = 1000000;
    const filename = path.resolve(__dirname, '../dist/services/stats.js');
    const actualRequire = require('node:module').createRequire(filename);
    const box = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module: box, exports: box.exports, require: actualRequire,
        Date: class extends Date { static now() { return clock; } },
        process: { uptime: () => 90000 }, console,
    });
    const api = box.exports;
    clock += 50000;
    api.initStats(0, 1000);
    clock += 60000;
    const first = api.getStats({}, { exp: 1600 }, true, {});
    assert.equal(first.sessionElapsedSeconds, 60);
    assert.equal(first.sessionExpGained, 600);
    api.initStats(0, 5000);
    const next = api.getStats({}, { exp: 5000 }, true, {});
    assert.equal(next.sessionElapsedSeconds, 0);
    assert.equal(next.sessionExpGained, 0);
});
