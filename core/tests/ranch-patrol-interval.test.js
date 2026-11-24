const assert = require('node:assert/strict');
const test = require('node:test');
const { getRanchPatrolIntervalMs, migrateRanchMarketAutomation, normalizeRanchSetting } = require('../dist/config/ranch-automation');
const { normalizeAccountConfig } = require('../dist/models/store/shared-state');
const { applyConfigSnapshot } = require('../dist/models/store/account-config');
const { globalConfig } = require('../dist/models/store/shared-state');

test('legacy fixed minutes migrate to equal seconds without changing frequency', () => {
    const config = normalizeAccountConfig({ automation: { ranch_check_minutes: 7 } });
    assert.equal(config.automation.ranch_check_min_seconds, 420);
    assert.equal(config.automation.ranch_check_max_seconds, 420);
    assert.equal(getRanchPatrolIntervalMs(config.automation), 420000);
});

test('explicit second ranges survive normalization and legacy minute fields', () => {
    const config = normalizeAccountConfig({ automation: { ranch_check_minutes: 5, ranch_check_min_seconds: 2, ranch_check_max_seconds: 8 } });
    assert.equal(config.automation.ranch_check_min_seconds, 2);
    assert.equal(config.automation.ranch_check_max_seconds, 8);
    assert.equal(migrateRanchMarketAutomation({ ranch_buy: true }).ranch_check_min_seconds, undefined);
});

test('random patrol interval includes both endpoints and accepts reversed endpoints', () => {
    const config = { ranch_check_min_seconds: 2, ranch_check_max_seconds: 5 };
    assert.equal(getRanchPatrolIntervalMs(config, () => 0), 2000);
    assert.equal(getRanchPatrolIntervalMs(config, () => 0.99999), 5000);
    assert.equal(getRanchPatrolIntervalMs({ ranch_check_min_seconds: 5, ranch_check_max_seconds: 2 }, () => 0), 2000);
    assert.equal(getRanchPatrolIntervalMs({ ranch_check_minutes: 3 }), 180000);
});

test('saved ranges survive unrelated updates and reject invalid seconds', () => {
    const accountId = '__ranch_patrol_interval__';
    try {
        const saved = applyConfigSnapshot({ automation: { ranch_check_min_seconds: 10, ranch_check_max_seconds: 20 } }, { accountId, persist: false });
        assert.equal(saved.automation.ranch_check_min_seconds, 10);
        const next = applyConfigSnapshot({ automation: { ranch_buy: true } }, { accountId, persist: false });
        assert.equal(next.automation.ranch_check_min_seconds, 10);
        assert.equal(next.automation.ranch_check_max_seconds, 20);
        for (const value of [0, -1, 3601, 1.5, NaN]) assert.throws(() => normalizeRanchSetting('ranch_check_min_seconds', value));
    } finally {
        delete globalConfig.accountConfigs[accountId];
    }
});
