"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sharedState = require('./shared-state');
const { globalConfig, normalizeAccountConfig, DEFAULT_ACCOUNT_CONFIG, } = sharedState;
/**
 * 从任意账号配置里挑出「默认方案」应当携带的字段：策略、自动化、节奏、施肥补肥参数、
 * 好友申请与邮箱领取等。刻意排除账号特有数据（已知好友、黑名单、背包种子优先/占地、
 * 首选种子等），这样把方案应用到别的账号时不会污染这些内容。
 */
function pickDefaultPlanConfig(raw) {
    const cfg = normalizeAccountConfig(raw, DEFAULT_ACCOUNT_CONFIG);
    return {
        automation: { ...cfg.automation },
        plantingStrategy: cfg.plantingStrategy,
        intervals: { ...cfg.intervals },
        friendQuietHours: { ...cfg.friendQuietHours },
        stealDelaySeconds: cfg.stealDelaySeconds,
        plantDelaySeconds: cfg.plantDelaySeconds,
        fertilizerBuyOrganicCount: cfg.fertilizerBuyOrganicCount,
        fertilizerBuyOrganicThresholdHours: cfg.fertilizerBuyOrganicThresholdHours,
        fertilizerBuyNormalCount: cfg.fertilizerBuyNormalCount,
        fertilizerBuyNormalThresholdHours: cfg.fertilizerBuyNormalThresholdHours,
        fertilizerBuyCheckIntervalMinutes: cfg.fertilizerBuyCheckIntervalMinutes,
        fertilizerBuyNormalCheckIntervalMinutes: cfg.fertilizerBuyNormalCheckIntervalMinutes,
        emailClaimHour: cfg.emailClaimHour,
        bagSeedFallbackStrategy: cfg.bagSeedFallbackStrategy,
        rankedSeedFallbackStrategy: cfg.rankedSeedFallbackStrategy,
        autoAcceptFriendMinLevel: cfg.autoAcceptFriendMinLevel,
        autoAcceptRequireOwnLevel: !!cfg.autoAcceptRequireOwnLevel,
    };
}
function normalizeUserDefaultPlan(raw) {
    const input = (raw && typeof raw === 'object') ? raw : {};
    return {
        enabled: input.enabled !== false,
        config: pickDefaultPlanConfig(input.config),
        updatedAt: Math.max(0, Number(input.updatedAt) || 0),
    };
}
/** 读取当前默认方案；未保存过时 exists=false 并回落到出厂默认配置。 */
function getDefaultPlan() {
    const saved = globalConfig.userDefaultPlan;
    if (!saved) {
        return {
            exists: false,
            enabled: true,
            config: pickDefaultPlanConfig(DEFAULT_ACCOUNT_CONFIG),
            updatedAt: 0,
        };
    }
    return { exists: true, ...normalizeUserDefaultPlan(saved) };
}
/** 保存默认方案。saveGlobalConfig 落盘成功后才更新内存，失败即整体回滚。 */
function setDefaultPlan(rawConfig, options = {}) {
    const persistence = require('./global-config');
    const plan = {
        enabled: options.enabled !== false,
        config: pickDefaultPlanConfig(rawConfig),
        updatedAt: Date.now(),
    };
    persistence.saveGlobalConfig({ userDefaultPlan: plan });
    return { exists: true, ...normalizeUserDefaultPlan(plan) };
}
/** 用指定账号的当前配置覆盖默认方案（“设为默认方案”）。 */
function importDefaultPlanFromAccount(accountId) {
    const accountConfig = require('./account-config');
    const current = getDefaultPlan();
    const config = accountConfig.getConfigSnapshot(accountId);
    return setDefaultPlan(config, { enabled: current.enabled !== false });
}
/** 把默认方案重置为出厂默认配置（“重置默认方案”），保留方案记录本身。 */
function resetDefaultPlan() {
    const accountConfig = require('./account-config');
    const current = getDefaultPlan();
    return setDefaultPlan(accountConfig.getDefaultAccountConfig(), { enabled: current.enabled !== false });
}
/**
 * 将默认方案应用到指定账号：按字段合并到账号现有配置（保留好友列表等账号特有数据），
 * 落盘后返回该账号合并后的完整配置快照，供前端刷新与 worker 同步。
 */
function applyDefaultPlan(accountId) {
    const plan = getDefaultPlan();
    if (!plan.exists) {
        throw new Error('尚未保存默认方案');
    }
    const accountConfig = require('./account-config');
    return accountConfig.applyConfigSnapshot(plan.config, { accountId });
}
module.exports = {
    pickDefaultPlanConfig,
    normalizeUserDefaultPlan,
    getDefaultPlan,
    setDefaultPlan,
    importDefaultPlanFromAccount,
    resetDefaultPlan,
    applyDefaultPlan,
};
//# sourceMappingURL=user-default-plan.js.map