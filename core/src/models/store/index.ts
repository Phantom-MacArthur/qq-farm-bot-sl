export {};
const sharedState = require('./shared-state');
const globalConfig = require('./global-config');
const accountConfig = require('./account-config');
const accounts = require('./accounts');
const userDefaultPlan = require('./user-default-plan');

module.exports = {
    // Account config
    getConfigSnapshot: accountConfig.getConfigSnapshot,
    applyConfigSnapshot: accountConfig.applyConfigSnapshot,
    getAutomation: accountConfig.getAutomation,
    setAutomation: accountConfig.setAutomation,
    isAutomationOn: accountConfig.isAutomationOn,
    getPreferredSeed: accountConfig.getPreferredSeed,
    getPlantingStrategy: accountConfig.getPlantingStrategy,
    getBagSeedPriority: accountConfig.getBagSeedPriority,
    getBagSeedMultiLandReservationEnabled: accountConfig.getBagSeedMultiLandReservationEnabled,
    getBagSeedLandTypes: accountConfig.getBagSeedLandTypes,
    getBagSeedFallbackStrategy: accountConfig.getBagSeedFallbackStrategy,
    getIntervals: accountConfig.getIntervals,
    getFriendQuietHours: accountConfig.getFriendQuietHours,
    getKnownFriendGids: accountConfig.getKnownFriendGids,
    setKnownFriendGids: accountConfig.setKnownFriendGids,
    getKnownFriendGidSyncCooldownSec: accountConfig.getKnownFriendGidSyncCooldownSec,
    setKnownFriendGidSyncCooldownSec: accountConfig.setKnownFriendGidSyncCooldownSec,
    getFriendsListCacheTtlSec: accountConfig.getFriendsListCacheTtlSec,
    setFriendsListCacheTtlSec: accountConfig.setFriendsListCacheTtlSec,
    getFriendBlacklist: accountConfig.getFriendBlacklist,
    setFriendBlacklist: accountConfig.setFriendBlacklist,
    addFriendToBlacklist: accountConfig.addFriendToBlacklist,
    getStealDelaySeconds: accountConfig.getStealDelaySeconds,
    getPlantDelaySeconds: accountConfig.getPlantDelaySeconds,
    getFertilizerBuyOrganicCount: accountConfig.getFertilizerBuyOrganicCount,
    getFertilizerBuyOrganicThresholdHours: accountConfig.getFertilizerBuyOrganicThresholdHours,
    getFertilizerBuyNormalCount: accountConfig.getFertilizerBuyNormalCount,
    getFertilizerBuyNormalThresholdHours: accountConfig.getFertilizerBuyNormalThresholdHours,
    getFertilizerBuyCheckIntervalMinutes: accountConfig.getFertilizerBuyCheckIntervalMinutes,
    getAutoAcceptFriendMinLevel: accountConfig.getAutoAcceptFriendMinLevel,
    getAutoAcceptRequireOwnLevel: accountConfig.getAutoAcceptRequireOwnLevel,
    getDefaultAccountConfig: accountConfig.getDefaultAccountConfig,

    // Global config
    getUI: globalConfig.getUI,
    setUITheme: globalConfig.setUITheme,
    getLoginSettings: globalConfig.getLoginSettings,
    setLoginSettings: globalConfig.setLoginSettings,
    getCaptureSettings: globalConfig.getCaptureSettings,
    setCaptureSettings: globalConfig.setCaptureSettings,
    getAutoCodeRefresh: globalConfig.getAutoCodeRefresh,
    setAutoCodeRefresh: globalConfig.setAutoCodeRefresh,
    getOfflineReminder: globalConfig.getOfflineReminder,
    setOfflineReminder: globalConfig.setOfflineReminder,
    getOfflineReminderDefault: globalConfig.getOfflineReminderDefault,
    setOfflineReminderDefault: globalConfig.setOfflineReminderDefault,
    applyOfflineReminderDefault: globalConfig.applyOfflineReminderDefault,

    // Accounts
    getAccounts: accounts.getAccounts,
    addOrUpdateAccount: accounts.addOrUpdateAccount,
    deleteAccount: accounts.deleteAccount,
    stripProtectedWxCredentials: accounts.stripProtectedWxCredentials,
    maskWxCredentialsForClient: accounts.maskWxCredentialsForClient,

    // System config
    getSystemConfig: globalConfig.getSystemConfig,
    setSystemConfig: globalConfig.setSystemConfig,

    // 默认方案（单用户全局一份，跨账号复用策略/自动化）
    getDefaultPlan: userDefaultPlan.getDefaultPlan,
    setDefaultPlan: userDefaultPlan.setDefaultPlan,
    importDefaultPlanFromAccount: userDefaultPlan.importDefaultPlanFromAccount,
    resetDefaultPlan: userDefaultPlan.resetDefaultPlan,
    applyDefaultPlan: userDefaultPlan.applyDefaultPlan,
};
