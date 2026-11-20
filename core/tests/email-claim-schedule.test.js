const assert = require('node:assert/strict');
const test = require('node:test');

const {
    configureEmailClaim,
    resetEmailClaimStateForTest,
} = require('../dist/services/email');
const { normalizeAccountConfig, DEFAULT_ACCOUNT_CONFIG } = require('../dist/models/store/shared-state');

test('邮箱不再按配置整点触发，hour 入参被忽略且不报错', () => {
    resetEmailClaimStateForTest();
    // 旧调用方仍会传 hour；周期检查模式下它只影响日志，不参与判断
    configureEmailClaim({ hour: 0 });
    configureEmailClaim({ hour: 23 });
    configureEmailClaim({ hour: 'abc' });
    configureEmailClaim({ hour: undefined });
    resetEmailClaimStateForTest();
});

test('邮箱小时配置仍然可读兼容，默认 10 点', () => {
    assert.equal(normalizeAccountConfig({ emailClaimHour: 0 }, DEFAULT_ACCOUNT_CONFIG).emailClaimHour, 0);
    assert.equal(normalizeAccountConfig({ emailClaimHour: 10 }, DEFAULT_ACCOUNT_CONFIG).emailClaimHour, 10);
    assert.equal(normalizeAccountConfig({ emailClaimHour: 25 }, DEFAULT_ACCOUNT_CONFIG).emailClaimHour, 10);
    assert.equal(normalizeAccountConfig({}, DEFAULT_ACCOUNT_CONFIG).emailClaimHour, 10);
});

test('邮箱时间保存拒绝非法输入，且不影响同次提交中的其他配置', () => {
    const shared = require('../dist/models/store/shared-state');
    const accountConfig = require('../dist/models/store/account-config');
    const previousFallback = shared.accountFallbackConfig;
    const previousDefault = shared.globalConfig.defaultAccountConfig;
    try {
        const baseline = shared.cloneAccountConfig(previousFallback);
        for (const invalid of [-1, 24, 10.5, '10.5', '10abc', '1e1', '', ' ', null, undefined, true, [], {}, Infinity, Number.NaN]) {
            const payload = { emailClaimHour: invalid, automation: { sell: !baseline.automation.sell } };
            assert.throws(() => accountConfig.applyConfigSnapshot(payload, { persist: false, accountId: '' }), error => error.code === 'INVALID_CONFIG');
            assert.throws(() => accountConfig.setAccountConfigSnapshot('', payload, false), error => error.code === 'INVALID_CONFIG');
            assert.deepEqual(shared.accountFallbackConfig, baseline);
            assert.equal(normalizeAccountConfig({ emailClaimHour: invalid }, DEFAULT_ACCOUNT_CONFIG).emailClaimHour, 10);
        }
        for (const hour of [0, 10, 23, '0', '23']) {
            const saved = accountConfig.applyConfigSnapshot({ emailClaimHour: hour }, { persist: false, accountId: '' });
            assert.equal(saved.emailClaimHour, Number(hour));
        }
    } finally {
        shared.accountFallbackConfig = previousFallback;
        shared.globalConfig.defaultAccountConfig = previousDefault;
    }
});
