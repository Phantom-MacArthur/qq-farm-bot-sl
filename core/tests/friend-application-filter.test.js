const assert = require('node:assert/strict');
const test = require('node:test');

const {
    effectiveMinLevel,
    evaluateLevelFilter,
} = require('../dist/services/friend/application-filter');

function config(overrides = {}) {
    return {
        minLevel: 0,
        requireOwnLevel: false,
        ownLevel: 50,
        ...overrides,
    };
}

test('manual min level rejects below and accepts equal or above', () => {
    const cfg = config({ minLevel: 30 });
    assert.equal(evaluateLevelFilter(29, cfg).action, 'reject');
    assert.equal(evaluateLevelFilter(30, cfg).action, 'accept');
    assert.equal(evaluateLevelFilter(31, cfg).action, 'accept');
    assert.match(evaluateLevelFilter(10, cfg).reason, /手动最低30级/);
});

test('own-level filter rejects below self and accepts equal or above', () => {
    const cfg = config({ requireOwnLevel: true, ownLevel: 80 });
    assert.equal(evaluateLevelFilter(79, cfg).action, 'reject');
    assert.equal(evaluateLevelFilter(80, cfg).action, 'accept');
    assert.match(evaluateLevelFilter(10, cfg).reason, /自己80级/);
});

test('both level filters use the stricter threshold', () => {
    const cfg = config({ minLevel: 40, requireOwnLevel: true, ownLevel: 70 });
    assert.equal(effectiveMinLevel(cfg), 70);
    assert.equal(evaluateLevelFilter(69, cfg).action, 'reject');
    assert.equal(evaluateLevelFilter(70, cfg).action, 'accept');

    const cfgManualHigher = config({ minLevel: 90, requireOwnLevel: true, ownLevel: 70 });
    assert.equal(effectiveMinLevel(cfgManualHigher), 90);
    assert.equal(evaluateLevelFilter(89, cfgManualHigher).action, 'reject');
    assert.equal(evaluateLevelFilter(90, cfgManualHigher).action, 'accept');
});

test('level 0 disables both manual and own-level checks', () => {
    const cfg = config({ minLevel: 0, requireOwnLevel: false, ownLevel: 0 });
    assert.equal(evaluateLevelFilter(0, cfg).action, 'accept');
    assert.equal(evaluateLevelFilter(1, cfg).action, 'accept');
});
