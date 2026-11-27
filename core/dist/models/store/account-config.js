"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const automation_modules_1 = require("../../config/automation-modules");
const sharedState = require('./shared-state');
const { assertEmailClaimHour } = require('../../utils/hour-of-day');
// 集市兑换迁移只在写入路径跑；条目归一统一走 shared-state.normalizeAutomationValue
// （它内部已委托 normalizeRanchSetting 处理 ranch 键，无需在此单独引入）。
const { migrateRanchMarketAutomation } = require('../../config/ranch-automation');
const { readKnownFriendGidsCache, writeKnownFriendGidsCache } = require('./gid-cache');
const { globalConfig, normalizeAccountConfig, normalizeAutomationValue, cloneAccountConfig, normalizeFertilizerLandTypes, normalizeKnownFriendGids, normalizeKnownFriendGidSyncCooldownSec, normalizeFriendsListCacheTtlSec, normalizeEmailClaimHour, normalizeBagSeedPriority, normalizeBagSeedLandTypes, normalizeBagSeedFallbackStrategy, normalizeRankedSeedFallbackStrategy, normalizeIntervals, normalizeTimeString, normalizeAutoAcceptFriendMinLevel, ALLOWED_PLANTING_STRATEGIES, } = sharedState;
function cloneBagSeedLandTypes(input) {
    const cloned = {};
    for (const [seedId, types] of Object.entries(input || {})) {
        cloned[seedId] = [...(types || [])];
    }
    return cloned;
}
function getAccountConfigSnapshot(accountId) {
    const id = sharedState.resolveAccountId(accountId);
    if (!id)
        return cloneAccountConfig(sharedState.accountFallbackConfig);
    return normalizeAccountConfig(globalConfig.accountConfigs[id], sharedState.accountFallbackConfig);
}
function setAccountConfigSnapshot(accountId, nextConfig, persist = true) {
    if (Object.hasOwn(nextConfig, 'emailClaimHour'))
        assertEmailClaimHour(nextConfig.emailClaimHour);
    // Initialization must happen before changing memory; a first direct call can
    // otherwise reload old data over the configuration it is about to save.
    const persistence = persist ? require('./global-config') : null;
    const id = sharedState.resolveAccountId(accountId);
    const next = normalizeAccountConfig(nextConfig, sharedState.accountFallbackConfig);
    if (!id) {
        if (persist)
            persistence.saveGlobalConfig({ defaultAccountConfig: next });
        else {
            sharedState.accountFallbackConfig = next;
            globalConfig.defaultAccountConfig = cloneAccountConfig(next);
        }
        return cloneAccountConfig(sharedState.accountFallbackConfig);
    }
    if (persist)
        sharedState.configStorage.saveAccount(id, next);
    globalConfig.accountConfigs[id] = next;
    return cloneAccountConfig(globalConfig.accountConfigs[id]);
}
function removeAccountConfig(accountId) {
    require('./global-config');
    const id = sharedState.resolveAccountId(accountId);
    if (!id)
        return;
    if (globalConfig.accountConfigs[id]) {
        sharedState.configStorage.removeAccount(id);
        delete globalConfig.accountConfigs[id];
    }
}
function ensureAccountConfig(accountId, options = {}) {
    if (options.persist !== false)
        require('./global-config');
    const id = sharedState.resolveAccountId(accountId);
    if (!id)
        return null;
    if (globalConfig.accountConfigs[id]) {
        if (options.persist !== false)
            sharedState.configStorage.restoreMissingFiles(id);
        return cloneAccountConfig(globalConfig.accountConfigs[id]);
    }
    const next = cloneAccountConfig(sharedState.DEFAULT_ACCOUNT_CONFIG);
    if (options.persist !== false)
        sharedState.configStorage.saveAccount(id, next);
    globalConfig.accountConfigs[id] = next;
    return cloneAccountConfig(globalConfig.accountConfigs[id]);
}
function getSavedAutomation(accountId) {
    const automation = { ...getAccountConfigSnapshot(accountId).automation };
    automation.fertilizer_land_types = normalizeFertilizerLandTypes(automation.fertilizer_land_types);
    return automation;
}
function getAutomation(accountId) {
    return (0, automation_modules_1.effectiveAutomation)(getSavedAutomation(accountId));
}
function getConfigSnapshot(accountId) {
    const cfg = getAccountConfigSnapshot(accountId);
    return {
        automation: { ...cfg.automation },
        plantingStrategy: cfg.plantingStrategy,
        preferredSeedId: cfg.preferredSeedId,
        intervals: { ...cfg.intervals },
        friendQuietHours: { ...cfg.friendQuietHours },
        knownFriendGids: [...(cfg.knownFriendGids || [])],
        knownFriendGidSyncCooldownSec: cfg.knownFriendGidSyncCooldownSec,
        friendsListCacheTtlSec: cfg.friendsListCacheTtlSec,
        friendBlacklist: [...(cfg.friendBlacklist || [])],
        ranchFriendBlacklist: [...(cfg.ranchFriendBlacklist || [])],
        plantBlacklist: [...(cfg.plantBlacklist || [])],
        stealDelaySeconds: Math.max(0, Math.min(300, Number(cfg.stealDelaySeconds) || 0)),
        plantDelaySeconds: Math.max(0, Math.min(60, Number(cfg.plantDelaySeconds) || 0)),
        fertilizerBuyOrganicCount: Math.max(0, Math.min(10000, Number(cfg.fertilizerBuyOrganicCount) || 0)),
        fertilizerBuyOrganicThresholdHours: Math.max(0, Math.min(990, Number(cfg.fertilizerBuyOrganicThresholdHours) || 0)),
        fertilizerBuyNormalCount: Math.max(0, Math.min(10000, Number(cfg.fertilizerBuyNormalCount) || 0)),
        fertilizerBuyNormalThresholdHours: Math.max(0, Math.min(990, Number(cfg.fertilizerBuyNormalThresholdHours) || 0)),
        fertilizerBuyCheckIntervalMinutes: Math.max(1, Math.min(1440, Number(cfg.fertilizerBuyCheckIntervalMinutes) || 30)),
        fertilizerBuyNormalCheckIntervalMinutes: cfg.fertilizerBuyNormalCheckIntervalMinutes,
        emailClaimHour: normalizeEmailClaimHour(cfg.emailClaimHour, sharedState.DEFAULT_ACCOUNT_CONFIG.emailClaimHour),
        bagSeedPriority: [...(cfg.bagSeedPriority || [])],
        bagSeedMultiLandReservationEnabled: !!cfg.bagSeedMultiLandReservationEnabled,
        bagSeedLandTypes: cloneBagSeedLandTypes(cfg.bagSeedLandTypes),
        bagSeedFallbackStrategy: cfg.bagSeedFallbackStrategy,
        rankedSeedFallbackStrategy: cfg.rankedSeedFallbackStrategy,
        autoAcceptFriendMinLevel: cfg.autoAcceptFriendMinLevel,
        autoAcceptRequireOwnLevel: !!cfg.autoAcceptRequireOwnLevel,
        ui: { ...globalConfig.ui },
    };
}
function applyConfigSnapshot(snapshot, options = {}) {
    const cfg = snapshot || {};
    if (Object.hasOwn(cfg, 'emailClaimHour'))
        assertEmailClaimHour(cfg.emailClaimHour);
    const persist = options.persist !== false;
    const accountId = options.accountId;
    if (persist)
        require('./global-config');
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, sharedState.accountFallbackConfig);
    if (cfg.automation && typeof cfg.automation === 'object') {
        for (const [k, v] of Object.entries(migrateRanchMarketAutomation(cfg.automation))) {
            if (next.automation[k] === undefined)
                continue;
            next.automation[k] = normalizeAutomationValue(k, v, next.automation[k]);
        }
    }
    if (cfg.plantingStrategy && ALLOWED_PLANTING_STRATEGIES.includes(cfg.plantingStrategy)) {
        next.plantingStrategy = cfg.plantingStrategy;
    }
    if (cfg.preferredSeedId !== undefined && cfg.preferredSeedId !== null) {
        next.preferredSeedId = Math.max(0, Number.parseInt(cfg.preferredSeedId, 10) || 0);
    }
    if (cfg.intervals && typeof cfg.intervals === 'object') {
        for (const [type, sec] of Object.entries(cfg.intervals)) {
            if (next.intervals[type] === undefined)
                continue;
            next.intervals[type] = Math.max(1, Number.parseInt(sec, 10) || next.intervals[type] || 1);
        }
        next.intervals = normalizeIntervals(next.intervals);
    }
    if (cfg.friendQuietHours && typeof cfg.friendQuietHours === 'object') {
        const old = next.friendQuietHours || {};
        next.friendQuietHours = {
            enabled: cfg.friendQuietHours.enabled !== undefined ? !!cfg.friendQuietHours.enabled : !!old.enabled,
            start: normalizeTimeString(cfg.friendQuietHours.start, old.start || '23:00'),
            end: normalizeTimeString(cfg.friendQuietHours.end, old.end || '07:00'),
            continueFarm: cfg.friendQuietHours.continueFarm !== undefined
                ? !!cfg.friendQuietHours.continueFarm
                : (old.continueFarm !== undefined ? !!old.continueFarm : true),
        };
    }
    if (Array.isArray(cfg.friendBlacklist)) {
        next.friendBlacklist = cfg.friendBlacklist.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    }
    if (Array.isArray(cfg.ranchFriendBlacklist)) {
        next.ranchFriendBlacklist = cfg.ranchFriendBlacklist.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    }
    if (Array.isArray(cfg.plantBlacklist)) {
        next.plantBlacklist = cfg.plantBlacklist.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    }
    if (cfg.knownFriendGids !== undefined) {
        next.knownFriendGids = normalizeKnownFriendGids(cfg.knownFriendGids, next.knownFriendGids);
    }
    if (cfg.knownFriendGidSyncCooldownSec !== undefined) {
        next.knownFriendGidSyncCooldownSec = normalizeKnownFriendGidSyncCooldownSec(cfg.knownFriendGidSyncCooldownSec, next.knownFriendGidSyncCooldownSec);
    }
    if (cfg.friendsListCacheTtlSec !== undefined) {
        next.friendsListCacheTtlSec = normalizeFriendsListCacheTtlSec(cfg.friendsListCacheTtlSec, next.friendsListCacheTtlSec);
    }
    if (cfg.stealDelaySeconds !== undefined && cfg.stealDelaySeconds !== null) {
        next.stealDelaySeconds = Math.max(0, Math.min(300, Number(cfg.stealDelaySeconds) || 0));
    }
    if (cfg.plantDelaySeconds !== undefined && cfg.plantDelaySeconds !== null) {
        next.plantDelaySeconds = Math.max(0, Math.min(60, Number(cfg.plantDelaySeconds) || 0));
    }
    if (cfg.fertilizerBuyOrganicCount !== undefined && cfg.fertilizerBuyOrganicCount !== null) {
        next.fertilizerBuyOrganicCount = Math.max(0, Math.min(10000, Number(cfg.fertilizerBuyOrganicCount) || 0));
    }
    if (cfg.fertilizerBuyOrganicThresholdHours !== undefined && cfg.fertilizerBuyOrganicThresholdHours !== null) {
        next.fertilizerBuyOrganicThresholdHours = Math.max(0, Math.min(990, Number(cfg.fertilizerBuyOrganicThresholdHours) || 0));
    }
    if (cfg.fertilizerBuyNormalCount !== undefined && cfg.fertilizerBuyNormalCount !== null) {
        next.fertilizerBuyNormalCount = Math.max(0, Math.min(10000, Number(cfg.fertilizerBuyNormalCount) || 0));
    }
    if (cfg.fertilizerBuyNormalThresholdHours !== undefined && cfg.fertilizerBuyNormalThresholdHours !== null) {
        next.fertilizerBuyNormalThresholdHours = Math.max(0, Math.min(990, Number(cfg.fertilizerBuyNormalThresholdHours) || 0));
    }
    if (cfg.fertilizerBuyCheckIntervalMinutes !== undefined && cfg.fertilizerBuyCheckIntervalMinutes !== null) {
        next.fertilizerBuyCheckIntervalMinutes = Math.max(1, Math.min(1440, Number(cfg.fertilizerBuyCheckIntervalMinutes) || 30));
    }
    if (cfg.fertilizerBuyNormalCheckIntervalMinutes !== undefined && cfg.fertilizerBuyNormalCheckIntervalMinutes !== null) {
        next.fertilizerBuyNormalCheckIntervalMinutes = Math.max(1, Math.min(1440, Number(cfg.fertilizerBuyNormalCheckIntervalMinutes) || 30));
    }
    if (cfg.emailClaimHour !== undefined) {
        next.emailClaimHour = normalizeEmailClaimHour(cfg.emailClaimHour, next.emailClaimHour);
    }
    if (cfg.bagSeedPriority !== undefined && cfg.bagSeedPriority !== null) {
        next.bagSeedPriority = normalizeBagSeedPriority(cfg.bagSeedPriority);
    }
    if (cfg.bagSeedMultiLandReservationEnabled !== undefined && cfg.bagSeedMultiLandReservationEnabled !== null) {
        next.bagSeedMultiLandReservationEnabled = !!cfg.bagSeedMultiLandReservationEnabled;
    }
    if (cfg.bagSeedLandTypes !== undefined && cfg.bagSeedLandTypes !== null) {
        next.bagSeedLandTypes = normalizeBagSeedLandTypes(cfg.bagSeedLandTypes);
    }
    next.bagSeedFallbackStrategy = normalizeBagSeedFallbackStrategy(cfg.bagSeedFallbackStrategy ?? next.bagSeedFallbackStrategy, next.bagSeedFallbackStrategy, next.plantingStrategy);
    if (cfg.rankedSeedFallbackStrategy !== undefined && cfg.rankedSeedFallbackStrategy !== null) {
        next.rankedSeedFallbackStrategy = normalizeRankedSeedFallbackStrategy(cfg.rankedSeedFallbackStrategy);
    }
    if (cfg.autoAcceptFriendMinLevel !== undefined && cfg.autoAcceptFriendMinLevel !== null) {
        next.autoAcceptFriendMinLevel = normalizeAutoAcceptFriendMinLevel(cfg.autoAcceptFriendMinLevel, next.autoAcceptFriendMinLevel);
    }
    if (cfg.autoAcceptRequireOwnLevel !== undefined && cfg.autoAcceptRequireOwnLevel !== null) {
        next.autoAcceptRequireOwnLevel = !!cfg.autoAcceptRequireOwnLevel;
    }
    setAccountConfigSnapshot(accountId, next, persist);
    const theme = String(cfg.ui?.theme || '').toLowerCase();
    if ((theme === 'dark' || theme === 'light') && globalConfig.ui.theme !== theme) {
        if (persist)
            require('./global-config').setUITheme(theme);
        else
            globalConfig.ui.theme = theme;
    }
    if (cfg.knownFriendGids !== undefined && accountId)
        writeKnownFriendGidsCache(accountId, next.knownFriendGids);
    return getConfigSnapshot(accountId);
}
function setAutomation(key, value, accountId) {
    return applyConfigSnapshot({ automation: { [key]: value } }, { accountId });
}
function isAutomationOn(key, accountId) {
    return !!getAutomation(accountId)[key];
}
function getPreferredSeed(accountId) {
    return getAccountConfigSnapshot(accountId).preferredSeedId;
}
function getPlantingStrategy(accountId) {
    return getAccountConfigSnapshot(accountId).plantingStrategy;
}
function getBagSeedPriority(accountId) {
    return [...(getAccountConfigSnapshot(accountId).bagSeedPriority || [])];
}
function getBagSeedMultiLandReservationEnabled(accountId) {
    return !!getAccountConfigSnapshot(accountId).bagSeedMultiLandReservationEnabled;
}
function getBagSeedLandTypes(accountId) {
    return cloneBagSeedLandTypes(getAccountConfigSnapshot(accountId).bagSeedLandTypes);
}
function getBagSeedFallbackStrategy(accountId) {
    const config = getAccountConfigSnapshot(accountId);
    return normalizeBagSeedFallbackStrategy(config.bagSeedFallbackStrategy, 'level', config.plantingStrategy);
}
function getIntervals(accountId) {
    return { ...getAccountConfigSnapshot(accountId).intervals };
}
function getFriendQuietHours(accountId) {
    return { ...getAccountConfigSnapshot(accountId).friendQuietHours };
}
function getKnownFriendGids(accountId) {
    const config = getAccountConfigSnapshot(accountId);
    const configGids = config.knownFriendGids || [];
    if (configGids.length > 0) {
        return [...configGids];
    }
    const cachedGids = readKnownFriendGidsCache(accountId);
    if (cachedGids && cachedGids.length > 0) {
        return [...cachedGids];
    }
    return [];
}
function setKnownFriendGids(accountId, list) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, sharedState.accountFallbackConfig);
    const normalizedGids = normalizeKnownFriendGids(list, next.knownFriendGids);
    next.knownFriendGids = normalizedGids;
    setAccountConfigSnapshot(accountId, next);
    writeKnownFriendGidsCache(accountId, normalizedGids);
    return [...normalizedGids];
}
function getKnownFriendGidSyncCooldownSec(accountId) {
    return normalizeKnownFriendGidSyncCooldownSec(getAccountConfigSnapshot(accountId).knownFriendGidSyncCooldownSec);
}
function setKnownFriendGidSyncCooldownSec(accountId, sec) {
    const current = getAccountConfigSnapshot(accountId);
    const normalized = normalizeKnownFriendGidSyncCooldownSec(sec, current.knownFriendGidSyncCooldownSec);
    const next = normalizeAccountConfig({
        ...current,
        knownFriendGidSyncCooldownSec: normalized,
    }, sharedState.accountFallbackConfig);
    setAccountConfigSnapshot(accountId, next, true);
    return next.knownFriendGidSyncCooldownSec;
}
function getFriendsListCacheTtlSec(accountId) {
    return normalizeFriendsListCacheTtlSec(getAccountConfigSnapshot(accountId).friendsListCacheTtlSec);
}
function setFriendsListCacheTtlSec(accountId, sec) {
    const current = getAccountConfigSnapshot(accountId);
    const normalized = normalizeFriendsListCacheTtlSec(sec, current.friendsListCacheTtlSec);
    const next = normalizeAccountConfig({
        ...current,
        friendsListCacheTtlSec: normalized,
    }, sharedState.accountFallbackConfig);
    setAccountConfigSnapshot(accountId, next, true);
    return next.friendsListCacheTtlSec;
}
function getFriendBlacklist(accountId) {
    return [...(getAccountConfigSnapshot(accountId).friendBlacklist || [])];
}
function setFriendBlacklist(accountId, list) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, sharedState.accountFallbackConfig);
    next.friendBlacklist = Array.isArray(list) ? list.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];
    setAccountConfigSnapshot(accountId, next);
    return [...next.friendBlacklist];
}
function addFriendToBlacklist(accountId, gid) {
    const gidNum = Number(gid);
    if (!gidNum || gidNum <= 0)
        return false;
    const current = getFriendBlacklist(accountId);
    if (current.includes(gidNum))
        return false;
    const newList = [...current, gidNum];
    setFriendBlacklist(accountId, newList);
    return true;
}
function getRanchFriendBlacklist(accountId) {
    return [...(getAccountConfigSnapshot(accountId).ranchFriendBlacklist || [])];
}
function setRanchFriendBlacklist(accountId, list) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, sharedState.accountFallbackConfig);
    next.ranchFriendBlacklist = Array.isArray(list) ? list.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];
    setAccountConfigSnapshot(accountId, next);
    return [...next.ranchFriendBlacklist];
}
function addRanchFriendToBlacklist(accountId, gid) {
    const gidNum = Number(gid);
    if (!gidNum || gidNum <= 0)
        return false;
    const current = getRanchFriendBlacklist(accountId);
    if (current.includes(gidNum))
        return false;
    setRanchFriendBlacklist(accountId, [...current, gidNum]);
    return true;
}
function getStealDelaySeconds(accountId) {
    return Math.max(0, Math.min(300, Number(getAccountConfigSnapshot(accountId).stealDelaySeconds) || 0));
}
function getPlantDelaySeconds(accountId) {
    return Math.max(0, Math.min(60, Number(getAccountConfigSnapshot(accountId).plantDelaySeconds) || 0));
}
function getFertilizerBuyOrganicCount(accountId) {
    return Math.max(0, Math.min(10000, Number(getAccountConfigSnapshot(accountId).fertilizerBuyOrganicCount) || 0));
}
function getFertilizerBuyOrganicThresholdHours(accountId) {
    return Math.max(0, Math.min(990, Number(getAccountConfigSnapshot(accountId).fertilizerBuyOrganicThresholdHours) || 0));
}
function getFertilizerBuyNormalCount(accountId) {
    return Math.max(0, Math.min(10000, Number(getAccountConfigSnapshot(accountId).fertilizerBuyNormalCount) || 0));
}
function getFertilizerBuyNormalThresholdHours(accountId) {
    return Math.max(0, Math.min(990, Number(getAccountConfigSnapshot(accountId).fertilizerBuyNormalThresholdHours) || 0));
}
function getFertilizerBuyCheckIntervalMinutes(accountId) {
    return Math.max(1, Math.min(1440, Number(getAccountConfigSnapshot(accountId).fertilizerBuyCheckIntervalMinutes) || 30));
}
function getFertilizerBuyNormalCheckIntervalMinutes(accountId) {
    return getAccountConfigSnapshot(accountId).fertilizerBuyNormalCheckIntervalMinutes;
}
function getAutoAcceptFriendMinLevel(accountId) {
    return normalizeAutoAcceptFriendMinLevel(getAccountConfigSnapshot(accountId).autoAcceptFriendMinLevel);
}
function getAutoAcceptRequireOwnLevel(accountId) {
    return !!getAccountConfigSnapshot(accountId).autoAcceptRequireOwnLevel;
}
function getDefaultAccountConfig() {
    return cloneAccountConfig(sharedState.DEFAULT_ACCOUNT_CONFIG);
}
module.exports = {
    getAccountConfigSnapshot,
    setAccountConfigSnapshot,
    removeAccountConfig,
    ensureAccountConfig,
    getConfigSnapshot,
    applyConfigSnapshot,
    getAutomation,
    getSavedAutomation,
    setAutomation,
    isAutomationOn,
    getPreferredSeed,
    getPlantingStrategy,
    getBagSeedPriority,
    getBagSeedMultiLandReservationEnabled,
    getBagSeedLandTypes,
    getBagSeedFallbackStrategy,
    getRankedSeedFallbackStrategy: (accountId) => getAccountConfigSnapshot(accountId).rankedSeedFallbackStrategy,
    getIntervals,
    getFriendQuietHours,
    getKnownFriendGids,
    setKnownFriendGids,
    getKnownFriendGidSyncCooldownSec,
    setKnownFriendGidSyncCooldownSec,
    getFriendsListCacheTtlSec,
    setFriendsListCacheTtlSec,
    getFriendBlacklist,
    setFriendBlacklist,
    addFriendToBlacklist,
    getRanchFriendBlacklist,
    setRanchFriendBlacklist,
    addRanchFriendToBlacklist,
    getStealDelaySeconds,
    getPlantDelaySeconds,
    getFertilizerBuyOrganicCount,
    getFertilizerBuyOrganicThresholdHours,
    getFertilizerBuyNormalCount,
    getFertilizerBuyNormalThresholdHours,
    getFertilizerBuyCheckIntervalMinutes,
    getFertilizerBuyNormalCheckIntervalMinutes,
    getAutoAcceptFriendMinLevel,
    getAutoAcceptRequireOwnLevel,
    getDefaultAccountConfig,
};
//# sourceMappingURL=account-config.js.map