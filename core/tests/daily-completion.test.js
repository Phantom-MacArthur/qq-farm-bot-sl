const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const { runInNewContext } = require('node:vm');

const filename = require.resolve('../dist/services/daily-completion');
const source = readFileSync(filename, 'utf8');
const realRequire = createRequire(filename);
const at = (time) => Date.parse(`2026-11-${time}+08:00`);

function setup(t) {
    const dir = mkdtempSync(path.join(tmpdir(), 'daily-completion-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const env = { FARM_ACCOUNT_ID: 'account-A' };
    const user = { gid: '101' };
    const clock = { ms: at('28T23:59:59'), nowMs: at('28T23:59:59') };
    const gameDay = ms => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const mocks = {
        '../utils/utils': { getServerClockSample: () => clock, getSystemDateKey: gameDay, formatDateKeyInTimeZone: gameDay },
        '../utils/network': { getUserState: () => user },
        '../config/config': { CONFIG: { platform: 'qq' } },
        '../config/runtime-paths': { getDataFile: (file) => path.join(dir, file) },
    };
    function load() {
        const exports = {};
        runInNewContext(source, { exports, process: { env }, require: name => mocks[name] ?? realRequire(name) }, { filename });
        return exports;
    }
    return { load, env, user, clock };
}

test('daily and activity marks persist per account, with independently completed items', (t) => {
    const { load, env, user } = setup(t);
    const ledger = load();
    ledger.recordDailyMark(ledger.beginDailyCheck('farm_free_gifts'), 'completed', { item: '2001' });
    ledger.recordDailyMark(ledger.beginDailyCheck('yishu_claim_seed'), 'completed', { count: '32' });

    const reloaded = load();
    assert.equal(reloaded.isDailyComplete('farm_free_gifts'), false);
    assert.equal(reloaded.isDailyComplete('farm_free_gifts', '2001'), true);
    const snapshot = reloaded.getDailyCompletionSnapshot();
    assert.equal(snapshot.daily.farm_free_gifts.items['2001'].status, 'completed');
    assert.equal(snapshot.activity.yishu_claim_seed.count, '32');
    env.FARM_ACCOUNT_ID = 'account-B';
    assert.equal(reloaded.isDailyComplete('yishu_claim_seed'), false);
    env.FARM_ACCOUNT_ID = 'account-A';
    user.gid = '102';
    assert.equal(reloaded.isDailyComplete('yishu_claim_seed'), false);
});

test('pending is distinct from confirmed and an old request cannot mark the next day', (t) => {
    const { load, clock } = setup(t);
    const ledger = load();
    const ticket = ledger.beginDailyCheck('yishu_share');
    ledger.recordDailyMark(ticket, 'pending_confirmation', { count: '4' });
    assert.equal(load().getDailyMark('yishu_share').status, 'pending_confirmation');
    ledger.recordDailyMark(ticket, 'completed');
    assert.equal(ledger.getDailyMark('yishu_share').count, '4');
    assert.equal(ledger.isDailyComplete('yishu_share'), true);

    clock.nowMs = at('29T00:00:01');
    assert.equal(ledger.getDailyCompletionSnapshot().activity.yishu_share.dateKey, null);
    clock.ms = clock.nowMs;
    ledger.recordDailyMark(ticket, 'completed');
    assert.equal(ledger.getDailyCompletionSnapshot().activity.yishu_share.dateKey, '2026-11-29');
    assert.equal(ledger.isDailyComplete('yishu_share'), false);
});
