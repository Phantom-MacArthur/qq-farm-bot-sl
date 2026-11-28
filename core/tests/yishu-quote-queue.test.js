const assert = require('node:assert/strict');
const test = require('node:test');
const { createYishuQuoteQueue } = require('../dist/services/activity-center/yishu-quote-queue');
const { confirmedYishuQuoteDay } = require('../dist/config/yishuhuanfu');

const targets = count => Array.from({ length: count }, (_, index) => ({ gid: String(index + 1), via: 'friend' }));

function harness(list, getPrice = () => ({ price: '200', bonus: '40' })) {
    let time = 0;
    let day = '2026-11-27';
    const cachedDays = new Map();
    let latestConfirmed = '';
    const requests = [];
    const deps = {
        day: () => day,
        now: () => time,
        loadTargets: async () => list,
        query: async target => {
            requests.push({ at: time, gid: target.gid });
            const { price, bonus } = await getPrice(target.gid);
            return { ...target, price, bonus, totalPrice: String(Number(price) + Number(bonus)), quota: '100', quotaCap: '100', quotedAt: 1795749000 + time / 1000 };
        },
        minimumDay: () => latestConfirmed,
        activateDay: day => { latestConfirmed = day; },
        restore: requestedDay => cachedDays.get(requestedDay) || [],
        save: (day, rows) => { cachedDays.set(day, rows); },
    };
    let queue = createYishuQuoteQueue(deps);
    return { get queue() { return queue; }, cachedDays, requests, async tick(at, limit = 200, enabled = true, manualEnabled = true) {
        time = at;
        await queue.tick({ limit, intervalMs: 30 * 60_000, enabled: () => enabled, manualEnabled: () => manualEnabled, ready: () => true });
    }, setDay(next) { day = next; }, nextDay() { day = '2026-11-28'; }, restart() { queue = createYishuQuoteQueue(deps); } };
}

test('Beijing midnight hides old quotes until an upstream sample confirms the new day', () => {
    const midnight = Date.parse('2026-11-28T00:00:00+08:00');
    assert.equal(confirmedYishuQuoteDay(null), '');
    assert.equal(confirmedYishuQuoteDay({ ms: midnight - 2000, nowMs: midnight - 1 }), '2026-11-27');
    assert.equal(confirmedYishuQuoteDay({ ms: midnight - 2000, nowMs: midnight }), '');
    assert.equal(confirmedYishuQuoteDay({ ms: midnight, nowMs: midnight + 50 }), '2026-11-28');
});

test('background compares one shop per ten seconds and keeps more than sixty quotes', async () => {
    const h = harness(targets(201));
    await h.tick(0);
    await h.tick(9999);
    assert.equal(h.requests.length, 1);
    for (let index = 1; index < 200; index++) await h.tick(index * 10000);
    assert.equal(h.queue.snapshot().scanned, 200);
    assert.equal(h.queue.snapshot().pendingCount, 1);
    await h.tick(2000000);
    assert.equal(h.requests.at(-1).gid, '201');
    assert.equal(h.queue.snapshot().scanned, 201);
    h.nextDay();
    assert.equal(h.queue.snapshot().scanned, 0);
});

test('manual refresh only queues already queried zero components, with three-second spacing', async () => {
    const h = harness(targets(4), gid => ({ price: gid === '1' ? '0' : '200', bonus: gid === '2' ? '0' : '40' }));
    for (let index = 0; index < 3; index++) await h.tick(index * 10000);
    assert.equal(h.queue.refreshQuotes().manualPending, 2);
    assert.equal(h.queue.refreshQuotes().manualPending, 2);
    await h.tick(22999);
    assert.equal(h.requests.length, 3);
    await h.tick(23000);
    await h.tick(25999);
    assert.equal(h.requests.length, 4);
    await h.tick(26000);
    assert.deepEqual(h.requests.slice(3), [{ at: 23000, gid: '1' }, { at: 26000, gid: '2' }]);
    assert.equal(h.queue.snapshot().manualPending, 0);
    await h.tick(35999);
    assert.equal(h.requests.length, 5);
    await h.tick(36000);
    assert.equal(h.requests.at(-1).gid, '4');
});

test('disabled background quotes leave manual refresh available and resume when enabled', async () => {
    const h = harness(targets(2), () => ({ price: '200', bonus: '0' }));
    await h.tick(0);
    h.queue.setOnlineTargets([{ gid: '3', via: 'account' }]);
    await h.tick(10000, 200, false);
    assert.deepEqual(h.requests.map(request => request.gid), ['1']);
    assert.equal(h.queue.refreshQuotes().manualPending, 1);
    await h.tick(11000, 200, false);
    await h.tick(21000, 200, false);
    assert.deepEqual(h.requests.map(request => request.gid), ['1', '1']);
    await h.tick(22000);
    assert.equal(h.requests.at(-1).gid, '3');
});

test('manual mode starts from an empty cache only after a click and off mode clears the rest', async () => {
    const h = harness(targets(3));
    await h.tick(0, 2, false);
    assert.deepEqual(h.requests, []);
    assert.equal(h.queue.refreshQuotes(true).manualPending, 1);
    assert.equal(h.queue.refreshQuotes(true).manualPending, 1);
    await h.tick(1000, 2, false);
    assert.equal(h.queue.snapshot().manualPending, 1);
    await h.tick(3999, 2, false);
    await h.tick(4000, 2, false);
    await h.tick(14000, 2, false);
    assert.deepEqual(h.requests, [{ at: 1000, gid: '1' }, { at: 4000, gid: '2' }]);
    h.queue.refreshQuotes(true);
    await h.tick(15000, 2, false, false);
    assert.equal(h.queue.snapshot().manualPending, 0);
    assert.equal(h.requests.length, 2);
});

test('an unconfirmed date only pauses access and a confirmed rollover cannot go backwards after restart', async () => {
    const h = harness(targets(1), () => ({ price: '230', bonus: '0' }));
    await h.tick(0);
    assert.equal(h.queue.refreshQuotes().manualPending, 1);
    h.setDay('');
    assert.equal(h.queue.snapshot().scanned, 0);
    assert.equal(h.queue.snapshot().manualPending, 0);
    await h.tick(4000);
    assert.equal(h.requests.length, 1);
    h.setDay('2026-11-27');
    assert.equal(h.queue.snapshot().scanned, 1);
    h.restart();
    assert.equal(h.queue.snapshot().scanned, 1);

    h.nextDay();
    assert.equal(h.queue.snapshot().scanned, 0);
    assert.equal(h.queue.snapshot().manualPending, 0);
    assert.equal(h.cachedDays.get('2026-11-27').length, 1);
    h.setDay('2026-11-27');
    h.restart();
    assert.equal(h.queue.snapshot().day, '');
    assert.equal(h.queue.snapshot().scanned, 0);
});

test('previous-day replies and sale quota updates cannot modify a new daily bucket', async () => {
    let reply;
    const delayed = new Promise(resolve => { reply = resolve; });
    let first = true;
    const h = harness(targets(1), () => {
        if (!first) return { price: '200', bonus: '30' };
        first = false;
        return delayed;
    });
    const pending = h.tick(0);
    await Promise.resolve();
    assert.equal(h.requests.length, 1);
    h.nextDay();
    assert.equal(h.queue.snapshot().scanned, 0);
    reply({ price: '800', bonus: '50' });
    await pending;
    assert.equal(h.queue.snapshot().scanned, 0);
    await h.tick(10000);
    assert.equal(h.queue.snapshot().best.price, '200');
    h.queue.updateQuota('2026-11-27', '1', '0');
    assert.equal(h.queue.snapshot().best.quota, '100');
});
