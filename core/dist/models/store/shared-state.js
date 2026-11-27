"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const automation_modules_1 = require("../../config/automation-modules");
const yishuhuanfu_1 = require("../../config/yishuhuanfu");
const { DEFAULT_TIME_ZONE, normalizeTimeZone, resolveClientVersion } = require('../../config/config');
const { getDataFile, ensureDataDir } = require('../../config/runtime-paths');
const { createConfigStorage } = require('./config-storage');
const { storageError } = require('../../services/json-db');
const { parseHourOfDay } = require('../../utils/hour-of-day');
const { RANCH_AUTOMATION_DEFAULTS, normalizeRanchSetting, migrateRanchMarketAutomation } = require('../../config/ranch-automation');
const STORE_FILE = getDataFile('store.json');
const ACCOUNTS_FILE = getDataFile('accounts.json');
const configStorage = createConfigStorage(STORE_FILE);
const KNOWN_FRIEND_GIDS_DIR = getDataFile('known_friend_gids');
const ALLOWED_PLANTING_STRATEGIES = ['preferred', 'level', 'max_exp', 'max_fert_exp', 'max_profit', 'max_fert_profit', 'bag_priority', 'illustrated'];
const ALLOWED_BAG_SEED_FALLBACK_STRATEGIES = ALLOWED_PLANTING_STRATEGIES;
const PUSHOO_CHANNELS = new Set([
    'webhook', 'qmsg', 'serverchan', 'pushplus', 'pushplushxtrip',
    'dingtalk', 'wecom', 'bark', 'gocqhttp', 'onebot', 'atri',
    'pushdeer', 'igot', 'telegram', 'feishu', 'ifttt', 'wecombot',
    'discord', 'wxpusher', 'meow',
]);
const DEFAULT_FERTILIZER_LAND_TYPES = ['purple-gold', 'gold', 'black', 'red', 'normal'];
const { FERTILIZER_MODES, normalizeFertilizerLandStrategies } = require('../../config/fertilizer-strategy');
const ALL_FERTILIZER_LAND_TYPES = ['blue-crystal', ...DEFAULT_FERTILIZER_LAND_TYPES];
const FERTILIZER_LAND_TYPE_SET = new Set(ALL_FERTILIZER_LAND_TYPES);
const INTERVAL_MAX_SEC = 86400;
const DEFAULT_KNOWN_FRIEND_GID_SYNC_COOLDOWN_SEC = 300;
const DEFAULT_FRIENDS_LIST_CACHE_TTL_SEC = 60;
let systemConfigMigrated = false;
let accountFallbackConfig;
const OFFLINE_PUSH_CHANNELS = ['qmsg', 'wxpusher', 'wxpusher_wechat', 'bark'];
function defaultChannelCredentials() {
    const map = {};
    for (const channel of OFFLINE_PUSH_CHANNELS) {
        map[channel] = { token: '', wxPusherUid: '' };
    }
    return map;
}
const DEFAULT_OFFLINE_REMINDER = {
    channel: 'wxpusher',
    endpoint: '',
    token: '',
    secret: '',
    wxPusherUid: '',
    channelCredentials: defaultChannelCredentials(),
    // 标题留空，发送时用当前账号备注兜底。
    title: '',
    msg: '账号下线',
};
const DEFAULT_LOGIN_SETTINGS = {
    wechatQrLogin: true,
    // 扫码登录是本仓库的主要登录方式：compose 起 napcat profile 后， NapCat 地址由
    // NAPCAT_WEBUI_URL / NAPCAT_OPENAUTH_URL 给出，不需要用户在面板里再填一遍。
    qqQrLogin: true,
    napCatEndpoint: '',
    napCatSignature: '',
};
// 抓包登录默认开启；内核 MITM 代理仍只在创建抓包会话时按会话临时监听端口。
const DEFAULT_CAPTURE_SETTINGS = {
    enabled: true,
    autoImportQqGids: true,
};
// 只对带内置登录凭据的微信扫码账号生效；QQ 账号在调度阶段会直接静默退出。
const DEFAULT_AUTO_CODE_REFRESH = {
    enabled: true,
    intervalMinutes: 2,
    maxRetries: 8,
};
const DEFAULT_ACCOUNT_CONFIG = {
    automation: {
        ...RANCH_AUTOMATION_DEFAULTS,
        ...automation_modules_1.AUTOMATION_MODULE_DEFAULTS,
        ...automation_modules_1.FARM_DAILY_DEFAULTS,
        ...automation_modules_1.MUGE_REWARD_DEFAULTS,
        farm: true,
        farm_harvest_tiangong: true,
        farm_push: true,
        land_upgrade: true,
        friend: true,
        friend_auto_accept: true,
        friend_help_exp_limit: true,
        friend_steal: true,
        friend_help: true,
        friend_bad: true,
        friend_help_protect_dog_ignore_exp_limit: true,
        task: true,
        fertilizer_gift: false,
        fertilizer_buy_organic: false,
        fertilizer_buy_normal: false,
        mystery_shop_auto_buy: false,
        mystery_shop_allow_gold: true,
        mystery_shop_allow_coupon: false,
        mystery_shop_allow_gold_bean: false,
        mystery_shop_allow_diamond: false,
        mystery_shop_arrival_notify: false,
        mystery_shop_purchase_notify: false,
        mall_coupon_gift_buy: false,
        sell: true,
        fertilizer: 'none',
        fertilizer_multi_season: true,
        fertilizer_land_types: [...DEFAULT_FERTILIZER_LAND_TYPES],
        fertilizer_land_strategies: {},
        fertilizer_smart_seconds: 300,
        skip_own_weed_bug: true,
        show_manual_fertilizer: true,
        ...automation_modules_1.ACTIVITY_AUTOMATION_DEFAULTS,
    },
    plantingStrategy: 'max_exp',
    preferredSeedId: 0,
    intervals: {
        farm: 2,
        farmMin: 20,
        farmMax: 25,
        friendMin: 20,
        friendMax: 25,
        helpMin: 20,
        helpMax: 25,
        stealMin: 20,
        stealMax: 25,
    },
    friendQuietHours: {
        enabled: false,
        start: '01:00',
        end: '07:30',
        continueFarm: true,
    },
    knownFriendGids: [],
    knownFriendGidSyncCooldownSec: DEFAULT_KNOWN_FRIEND_GID_SYNC_COOLDOWN_SEC,
    friendsListCacheTtlSec: DEFAULT_FRIENDS_LIST_CACHE_TTL_SEC,
    friendBlacklist: [],
    ranchFriendBlacklist: [],
    plantBlacklist: [
        20002,
        20003,
        20059,
        20065,
        20064,
        20060,
        20061,
    ],
    stealDelaySeconds: 1,
    plantDelaySeconds: 0,
    fertilizerBuyOrganicCount: 1,
    fertilizerBuyOrganicThresholdHours: 10,
    fertilizerBuyNormalCount: 1,
    fertilizerBuyNormalThresholdHours: 10,
    fertilizerBuyCheckIntervalMinutes: 60,
    fertilizerBuyNormalCheckIntervalMinutes: 60,
    emailClaimHour: 10,
    bagSeedPriority: [],
    bagSeedMultiLandReservationEnabled: false,
    bagSeedLandTypes: {},
    bagSeedFallbackStrategy: 'level',
    rankedSeedFallbackStrategy: '',
    autoAcceptFriendMinLevel: 0,
    autoAcceptRequireOwnLevel: false,
};
const ALLOWED_AUTOMATION_KEYS = new Set(Object.keys(DEFAULT_ACCOUNT_CONFIG.automation));
// ============ Normalization Helpers ============
function normalizeKnownFriendGids(input, fallback = []) {
    const source = Array.isArray(input) ? input : fallback;
    const normalized = [];
    for (const item of source) {
        const value = Number.parseInt(item, 10);
        if (!Number.isFinite(value) || value <= 0)
            continue;
        if (normalized.includes(value))
            continue;
        normalized.push(value);
    }
    return normalized;
}
function normalizeKnownFriendGidSyncCooldownSec(input, fallback = DEFAULT_KNOWN_FRIEND_GID_SYNC_COOLDOWN_SEC) {
    const value = Number.parseInt(input, 10);
    const base = Number.isFinite(value) ? value : fallback;
    return Math.max(30, Math.min(INTERVAL_MAX_SEC, base));
}
function normalizeFriendsListCacheTtlSec(input, fallback = DEFAULT_FRIENDS_LIST_CACHE_TTL_SEC) {
    const value = Number.parseInt(input, 10);
    const base = Number.isFinite(value) ? value : fallback;
    return Math.max(10, Math.min(INTERVAL_MAX_SEC, base));
}
function normalizeEmailClaimHour(input, fallback = DEFAULT_ACCOUNT_CONFIG.emailClaimHour) {
    return parseHourOfDay(input) ?? parseHourOfDay(fallback) ?? DEFAULT_ACCOUNT_CONFIG.emailClaimHour;
}
function normalizeAutoAcceptFriendMinLevel(input, fallback = 0) {
    const value = Number.parseInt(input, 10);
    const base = Number.isFinite(value) ? value : fallback;
    return Math.max(0, Math.min(200, base));
}
function normalizeBagSeedPriority(input) {
    if (!Array.isArray(input))
        return [];
    const normalized = [];
    for (const item of input) {
        const value = Number.parseInt(item, 10);
        if (!Number.isFinite(value) || value <= 0)
            continue;
        if (normalized.includes(value))
            continue;
        normalized.push(value);
    }
    return normalized;
}
/**
 * seedId -> 允许的土地类型。缺 key、空数组、全类型三者等价于不限制，统一省略该 key。
 */
function normalizeBagSeedLandTypes(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return {};
    const normalized = {};
    for (const [key, value] of Object.entries(input)) {
        const seedId = Number.parseInt(key, 10);
        if (!Number.isFinite(seedId) || seedId <= 0)
            continue;
        if (!Array.isArray(value))
            continue;
        const types = [];
        for (const item of value) {
            const type = String(item || '').trim().toLowerCase();
            if (!FERTILIZER_LAND_TYPE_SET.has(type))
                continue;
            if (types.includes(type))
                continue;
            types.push(type);
        }
        if (types.length === 0 || types.length === ALL_FERTILIZER_LAND_TYPES.length)
            continue;
        normalized[String(seedId)] = types;
    }
    return normalized;
}
function normalizeRankedSeedFallbackStrategy(input) {
    const strategy = String(input || '').trim();
    return ALLOWED_BAG_SEED_FALLBACK_STRATEGIES.find(candidate => candidate === strategy) || '';
}
function normalizeBagSeedFallbackStrategy(input, fallback = 'level', primary) {
    const strategy = normalizeRankedSeedFallbackStrategy(input) || fallback;
    return primary === 'illustrated' && strategy === 'illustrated' ? 'level' : strategy;
}
function normalizeFertilizerLandTypes(input, fallback = DEFAULT_FERTILIZER_LAND_TYPES) {
    const source = Array.isArray(input) ? input : fallback;
    const normalized = [];
    for (const item of source) {
        const value = String(item || '').trim().toLowerCase();
        if (!FERTILIZER_LAND_TYPE_SET.has(value))
            continue;
        if (normalized.includes(value))
            continue;
        normalized.push(value);
    }
    return normalized;
}
function normalizeTimeString(v, fallback) {
    const s = String(v || '').trim();
    const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m)
        return fallback;
    const hh = Math.max(0, Math.min(23, Number.parseInt(m[1], 10)));
    const mm = Math.max(0, Math.min(59, Number.parseInt(m[2], 10)));
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
function normalizeIntervals(intervals) {
    const src = (intervals && typeof intervals === 'object') ? intervals : {};
    const toSec = (v, d) => Math.max(1, Number.parseInt(v, 10) || d);
    const farm = toSec(src.farm, 2);
    let farmMin = toSec(src.farmMin, farm);
    let farmMax = toSec(src.farmMax, farm);
    if (farmMin > farmMax)
        [farmMin, farmMax] = [farmMax, farmMin];
    let helpMin = toSec(src.helpMin, 10);
    let helpMax = toSec(src.helpMax, 10);
    if (helpMin > helpMax)
        [helpMin, helpMax] = [helpMax, helpMin];
    let stealMin = toSec(src.stealMin, 10);
    let stealMax = toSec(src.stealMax, 10);
    if (stealMin > stealMax)
        [stealMin, stealMax] = [stealMax, stealMin];
    // 新配置使用统一好友任务间隔；旧账号自动取帮助/偷菜两组间隔中较快的一组。
    let friendMin = toSec(src.friendMin, Math.min(helpMin, stealMin));
    let friendMax = toSec(src.friendMax, Math.min(helpMax, stealMax));
    if (friendMin > friendMax)
        [friendMin, friendMax] = [friendMax, friendMin];
    return {
        ...src,
        farm,
        farmMin,
        farmMax,
        friendMin,
        friendMax,
        helpMin,
        helpMax,
        stealMin,
        stealMax,
    };
}
function cloneAccountConfig(base = DEFAULT_ACCOUNT_CONFIG) {
    const srcAutomation = (base && base.automation && typeof base.automation === 'object')
        ? migrateRanchMarketAutomation(base.automation)
        : {};
    const automation = { ...DEFAULT_ACCOUNT_CONFIG.automation };
    for (const key of Object.keys(automation)) {
        if (key === 'ranch_activate_shed')
            continue;
        if (key === 'fertilizer_land_types') {
            automation[key] = normalizeFertilizerLandTypes(srcAutomation[key], DEFAULT_FERTILIZER_LAND_TYPES);
            continue;
        }
        if (key === 'fertilizer_land_strategies') {
            automation[key] = normalizeFertilizerLandStrategies(srcAutomation[key]);
            continue;
        }
        if (key === 'ranch_coop_cub_priority' || key === 'ranch_shed_cub_priority') {
            automation[key] = [...(srcAutomation[key] ?? automation[key])];
            continue;
        }
        if (srcAutomation[key] !== undefined)
            automation[key] = srcAutomation[key];
    }
    const rawBlacklist = Array.isArray(base.friendBlacklist) ? base.friendBlacklist : [];
    const rawRanchFriendBlacklist = Array.isArray(base.ranchFriendBlacklist) ? base.ranchFriendBlacklist : [];
    const rawPlantBlacklist = Array.isArray(base.plantBlacklist) ? base.plantBlacklist : DEFAULT_ACCOUNT_CONFIG.plantBlacklist;
    const knownFriendGids = normalizeKnownFriendGids(base.knownFriendGids);
    const knownFriendGidSyncCooldownSec = normalizeKnownFriendGidSyncCooldownSec(base.knownFriendGidSyncCooldownSec);
    const friendsListCacheTtlSec = normalizeFriendsListCacheTtlSec(base.friendsListCacheTtlSec);
    return {
        ...DEFAULT_ACCOUNT_CONFIG,
        ...base,
        automation,
        intervals: { ...(base.intervals || DEFAULT_ACCOUNT_CONFIG.intervals) },
        friendQuietHours: { ...DEFAULT_ACCOUNT_CONFIG.friendQuietHours, ...(base.friendQuietHours || {}) },
        knownFriendGids,
        knownFriendGidSyncCooldownSec,
        friendsListCacheTtlSec,
        friendBlacklist: rawBlacklist.map(Number).filter(n => Number.isFinite(n) && n > 0),
        ranchFriendBlacklist: rawRanchFriendBlacklist.map(Number).filter(n => Number.isFinite(n) && n > 0),
        plantBlacklist: rawPlantBlacklist.map(Number).filter(n => Number.isFinite(n) && n > 0),
        plantingStrategy: ALLOWED_PLANTING_STRATEGIES.includes(String(base.plantingStrategy || ''))
            ? String(base.plantingStrategy)
            : DEFAULT_ACCOUNT_CONFIG.plantingStrategy,
        preferredSeedId: Math.max(0, Number.parseInt(String(base.preferredSeedId), 10) || 0),
        stealDelaySeconds: Math.max(0, Math.min(300, Number(base.stealDelaySeconds) || 0)),
        plantDelaySeconds: Math.max(0, Math.min(60, Number(base.plantDelaySeconds) || 0)),
        fertilizerBuyOrganicCount: Math.max(0, Math.min(10000, Number(base.fertilizerBuyOrganicCount) || 0)),
        fertilizerBuyOrganicThresholdHours: Math.max(0, Math.min(990, Number(base.fertilizerBuyOrganicThresholdHours) || 0)),
        fertilizerBuyNormalCount: Math.max(0, Math.min(10000, Number(base.fertilizerBuyNormalCount) || 0)),
        fertilizerBuyNormalThresholdHours: Math.max(0, Math.min(990, Number(base.fertilizerBuyNormalThresholdHours) || 0)),
        fertilizerBuyCheckIntervalMinutes: Math.max(1, Math.min(1440, Number(base.fertilizerBuyCheckIntervalMinutes) || 30)),
        fertilizerBuyNormalCheckIntervalMinutes: Math.max(1, Math.min(1440, Number(base.fertilizerBuyNormalCheckIntervalMinutes ?? base.fertilizerBuyCheckIntervalMinutes) || 30)),
        emailClaimHour: normalizeEmailClaimHour(base.emailClaimHour, DEFAULT_ACCOUNT_CONFIG.emailClaimHour),
        bagSeedPriority: normalizeBagSeedPriority(base.bagSeedPriority),
        bagSeedMultiLandReservationEnabled: base.bagSeedMultiLandReservationEnabled !== undefined
            ? !!base.bagSeedMultiLandReservationEnabled
            : DEFAULT_ACCOUNT_CONFIG.bagSeedMultiLandReservationEnabled,
        bagSeedLandTypes: normalizeBagSeedLandTypes(base.bagSeedLandTypes),
        bagSeedFallbackStrategy: normalizeBagSeedFallbackStrategy(base.bagSeedFallbackStrategy, 'level', base.plantingStrategy),
        rankedSeedFallbackStrategy: normalizeRankedSeedFallbackStrategy(base.rankedSeedFallbackStrategy),
        autoAcceptFriendMinLevel: normalizeAutoAcceptFriendMinLevel(base.autoAcceptFriendMinLevel, DEFAULT_ACCOUNT_CONFIG.autoAcceptFriendMinLevel),
        autoAcceptRequireOwnLevel: !!base.autoAcceptRequireOwnLevel,
    };
}
function normalizeFertilizerMode(value, fallback) {
    return FERTILIZER_MODES.has(value) ? value : fallback;
}
/**
 * 单个 automation 键的归一。两处写入路径（`normalizeAccountConfig` 读账号存档、
 * `applyConfigSnapshot` 保存设置页）必须共用这一份，否则选法配置会被另一处 `!!v` 布尔化：
 * 2026-10-19 的 bug 就是雇佣班次/特长在保存时被折成 true，再读回来落回默认档。
 * `current` 是该键归一前的现值，非法值一律回到它而不是硬编码默认。
 */
function normalizeAutomationValue(key, value, current) {
    if (key === 'fertilizer') {
        return normalizeFertilizerMode(value, current);
    }
    if (key === 'fertilizer_land_types') {
        return normalizeFertilizerLandTypes(value, current);
    }
    if (key === 'fertilizer_land_strategies') {
        return normalizeFertilizerLandStrategies(value);
    }
    if (key.startsWith('ranch_')) {
        return normalizeRanchSetting(key, value);
    }
    if (key === 'fertilizer_smart_seconds') {
        return Math.max(30, Math.min(3600, Number(value) || 300));
    }
    // 以薯换福的数值项：默认值是数字，这里必须显式夹取，否则会被下面的 `!!value` 折成 true。
    if (key === 'yishu_scan_friend_limit') {
        return Math.max(1, Math.min(200, Number.parseInt(String(value), 10) || 200));
    }
    if (key === 'yishu_scan_interval_minutes') {
        return Math.max(5, Math.min(720, Number.parseInt(String(value), 10) || 30));
    }
    if (key === 'yishu_sell_min_count') {
        return Math.max(1, Math.min(10000, Number.parseInt(String(value), 10) || 1));
    }
    if (key === 'yishu_sell_min_price') {
        return (0, yishuhuanfu_1.normalizeYishuMinPrice)(value);
    }
    // "HH:MM" 是字符串项，不夹取就会被折成 true，卖薯闸门直接失效。
    if (key === 'yishu_sell_after_time') {
        return (0, yishuhuanfu_1.normalizeYishuSellAfterTime)(value);
    }
    if (key === 'yishu_sell_mode') {
        if (value === 'confirm')
            return 'scan';
        return ['', 'off', 'scan', 'auto'].includes(String(value)) ? String(value) : current;
    }
    if (Object.hasOwn(automation_modules_1.ACTIVITY_AUTOMATION_DEFAULTS, key))
        return value === true;
    return !!value;
}
function normalizeAccountConfig(input, fallback = accountFallbackConfig) {
    const src = (input && typeof input === 'object') ? input : {};
    const cfg = cloneAccountConfig(fallback || DEFAULT_ACCOUNT_CONFIG);
    if (src.automation && typeof src.automation === 'object') {
        // 没有独立抚摸选项的旧配置沿用之前的偷取开关状态。
        if (src.automation.ranch_stroke === undefined && typeof src.automation.ranch_friend_steal === 'boolean') {
            cfg.automation.ranch_stroke = src.automation.ranch_friend_steal;
        }
        for (const [k, v] of Object.entries(migrateRanchMarketAutomation(src.automation))) {
            if (!ALLOWED_AUTOMATION_KEYS.has(k))
                continue;
            cfg.automation[k] = normalizeAutomationValue(k, v, cfg.automation[k]);
        }
    }
    if (src.plantingStrategy && ALLOWED_PLANTING_STRATEGIES.includes(src.plantingStrategy)) {
        cfg.plantingStrategy = src.plantingStrategy;
    }
    if (src.preferredSeedId !== undefined && src.preferredSeedId !== null) {
        cfg.preferredSeedId = Math.max(0, Number.parseInt(src.preferredSeedId, 10) || 0);
    }
    if (src.intervals && typeof src.intervals === 'object') {
        for (const [type, sec] of Object.entries(src.intervals)) {
            if (cfg.intervals[type] === undefined)
                continue;
            cfg.intervals[type] = Math.max(1, Number.parseInt(sec, 10) || cfg.intervals[type] || 1);
        }
        cfg.intervals = normalizeIntervals(cfg.intervals);
    }
    else {
        cfg.intervals = normalizeIntervals(cfg.intervals);
    }
    if (src.friendQuietHours && typeof src.friendQuietHours === 'object') {
        const old = cfg.friendQuietHours || {};
        cfg.friendQuietHours = {
            enabled: src.friendQuietHours.enabled !== undefined ? !!src.friendQuietHours.enabled : !!old.enabled,
            start: normalizeTimeString(src.friendQuietHours.start, old.start || '23:00'),
            end: normalizeTimeString(src.friendQuietHours.end, old.end || '07:00'),
            continueFarm: src.friendQuietHours.continueFarm !== undefined
                ? !!src.friendQuietHours.continueFarm
                : (old.continueFarm !== undefined ? !!old.continueFarm : true),
        };
    }
    if (Array.isArray(src.friendBlacklist)) {
        cfg.friendBlacklist = src.friendBlacklist.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    }
    if (Array.isArray(src.ranchFriendBlacklist)) {
        cfg.ranchFriendBlacklist = src.ranchFriendBlacklist.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    }
    if (Array.isArray(src.plantBlacklist)) {
        cfg.plantBlacklist = src.plantBlacklist.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    }
    if (src.knownFriendGids !== undefined) {
        cfg.knownFriendGids = normalizeKnownFriendGids(src.knownFriendGids, cfg.knownFriendGids);
    }
    if (src.knownFriendGidSyncCooldownSec !== undefined) {
        cfg.knownFriendGidSyncCooldownSec = normalizeKnownFriendGidSyncCooldownSec(src.knownFriendGidSyncCooldownSec, cfg.knownFriendGidSyncCooldownSec);
    }
    if (src.friendsListCacheTtlSec !== undefined) {
        cfg.friendsListCacheTtlSec = normalizeFriendsListCacheTtlSec(src.friendsListCacheTtlSec, cfg.friendsListCacheTtlSec);
    }
    if (src.stealDelaySeconds !== undefined && src.stealDelaySeconds !== null) {
        cfg.stealDelaySeconds = Math.max(0, Math.min(300, Number(src.stealDelaySeconds) || 0));
    }
    if (src.plantDelaySeconds !== undefined && src.plantDelaySeconds !== null) {
        cfg.plantDelaySeconds = Math.max(0, Math.min(60, Number(src.plantDelaySeconds) || 0));
    }
    if (src.fertilizerBuyOrganicCount !== undefined && src.fertilizerBuyOrganicCount !== null) {
        cfg.fertilizerBuyOrganicCount = Math.max(0, Math.min(10000, Number(src.fertilizerBuyOrganicCount) || 0));
    }
    if (src.fertilizerBuyOrganicThresholdHours !== undefined && src.fertilizerBuyOrganicThresholdHours !== null) {
        cfg.fertilizerBuyOrganicThresholdHours = Math.max(0, Math.min(990, Number(src.fertilizerBuyOrganicThresholdHours) || 0));
    }
    if (src.fertilizerBuyNormalCount !== undefined && src.fertilizerBuyNormalCount !== null) {
        cfg.fertilizerBuyNormalCount = Math.max(0, Math.min(10000, Number(src.fertilizerBuyNormalCount) || 0));
    }
    if (src.fertilizerBuyNormalThresholdHours !== undefined && src.fertilizerBuyNormalThresholdHours !== null) {
        cfg.fertilizerBuyNormalThresholdHours = Math.max(0, Math.min(990, Number(src.fertilizerBuyNormalThresholdHours) || 0));
    }
    if (src.fertilizerBuyCheckIntervalMinutes !== undefined && src.fertilizerBuyCheckIntervalMinutes !== null) {
        cfg.fertilizerBuyCheckIntervalMinutes = Math.max(1, Math.min(1440, Number(src.fertilizerBuyCheckIntervalMinutes) || 30));
        // 旧配置只保存了两种化肥共用的间隔。
        cfg.fertilizerBuyNormalCheckIntervalMinutes = cfg.fertilizerBuyCheckIntervalMinutes;
    }
    if (src.fertilizerBuyNormalCheckIntervalMinutes !== undefined && src.fertilizerBuyNormalCheckIntervalMinutes !== null) {
        cfg.fertilizerBuyNormalCheckIntervalMinutes = Math.max(1, Math.min(1440, Number(src.fertilizerBuyNormalCheckIntervalMinutes) || 30));
    }
    if (src.emailClaimHour !== undefined && src.emailClaimHour !== null) {
        cfg.emailClaimHour = normalizeEmailClaimHour(src.emailClaimHour, cfg.emailClaimHour);
    }
    if (src.bagSeedPriority !== undefined && src.bagSeedPriority !== null) {
        cfg.bagSeedPriority = normalizeBagSeedPriority(src.bagSeedPriority);
    }
    if (src.bagSeedMultiLandReservationEnabled !== undefined && src.bagSeedMultiLandReservationEnabled !== null) {
        cfg.bagSeedMultiLandReservationEnabled = !!src.bagSeedMultiLandReservationEnabled;
    }
    if (src.bagSeedLandTypes !== undefined && src.bagSeedLandTypes !== null) {
        cfg.bagSeedLandTypes = normalizeBagSeedLandTypes(src.bagSeedLandTypes);
    }
    cfg.bagSeedFallbackStrategy = normalizeBagSeedFallbackStrategy(src.bagSeedFallbackStrategy ?? cfg.bagSeedFallbackStrategy, cfg.bagSeedFallbackStrategy, cfg.plantingStrategy);
    if (src.rankedSeedFallbackStrategy !== undefined && src.rankedSeedFallbackStrategy !== null) {
        cfg.rankedSeedFallbackStrategy = normalizeRankedSeedFallbackStrategy(src.rankedSeedFallbackStrategy);
    }
    if (src.autoAcceptFriendMinLevel !== undefined && src.autoAcceptFriendMinLevel !== null) {
        cfg.autoAcceptFriendMinLevel = normalizeAutoAcceptFriendMinLevel(src.autoAcceptFriendMinLevel, cfg.autoAcceptFriendMinLevel);
    }
    if (src.autoAcceptRequireOwnLevel !== undefined && src.autoAcceptRequireOwnLevel !== null) {
        cfg.autoAcceptRequireOwnLevel = !!src.autoAcceptRequireOwnLevel;
    }
    return cfg;
}
// ============ Global Config (mutable shared state) ============
accountFallbackConfig = {
    ...DEFAULT_ACCOUNT_CONFIG,
    automation: { ...DEFAULT_ACCOUNT_CONFIG.automation, fertilizer_land_types: [...DEFAULT_FERTILIZER_LAND_TYPES] },
    intervals: { ...DEFAULT_ACCOUNT_CONFIG.intervals },
    friendQuietHours: { ...DEFAULT_ACCOUNT_CONFIG.friendQuietHours },
    knownFriendGids: [],
    knownFriendGidSyncCooldownSec: DEFAULT_KNOWN_FRIEND_GID_SYNC_COOLDOWN_SEC,
    friendsListCacheTtlSec: DEFAULT_FRIENDS_LIST_CACHE_TTL_SEC,
};
const globalConfig = {
    accountConfigs: {},
    defaultAccountConfig: cloneAccountConfig(DEFAULT_ACCOUNT_CONFIG),
    autoCodeRefresh: { ...DEFAULT_AUTO_CODE_REFRESH },
    ui: {
        theme: 'light',
    },
    loginSettings: { ...DEFAULT_LOGIN_SETTINGS },
    captureSettings: { ...DEFAULT_CAPTURE_SETTINGS },
    accountOfflineReminders: {},
    offlineReminderDefault: null,
    systemConfig: null,
    userDefaultPlan: null,
};
function resolveAccountId(accountId) {
    const direct = (accountId !== undefined && accountId !== null) ? String(accountId).trim() : '';
    if (direct)
        return direct;
    const envId = String(process.env.FARM_ACCOUNT_ID || '').trim();
    return envId;
}
function loadGlobalConfig() {
    try {
        ensureDataDir();
        const data = configStorage.load({ migrate: !process.env.FARM_ACCOUNT_ID });
        if (data && typeof data === 'object') {
            accountFallbackConfig = cloneAccountConfig(DEFAULT_ACCOUNT_CONFIG);
            globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);
            const cfgMap = (data.accountConfigs && typeof data.accountConfigs === 'object')
                ? data.accountConfigs
                : {};
            globalConfig.accountConfigs = Object.create(null);
            for (const [id, cfg] of Object.entries(cfgMap)) {
                const sid = String(id || '').trim();
                if (!sid)
                    continue;
                globalConfig.accountConfigs[sid] = normalizeAccountConfig(cfg, DEFAULT_ACCOUNT_CONFIG);
            }
            globalConfig.ui = { ...globalConfig.ui, ...(data.ui || {}) };
            const theme = String(globalConfig.ui.theme || '').toLowerCase();
            globalConfig.ui.theme = theme === 'light' ? 'light' : 'dark';
            // 下线提醒按账号存储：accountOfflineReminders[accountId]
            if (data.accountOfflineReminders && typeof data.accountOfflineReminders === 'object') {
                globalConfig.accountOfflineReminders = data.accountOfflineReminders;
            }
            // 旧版全局 offlineReminder 保留在 globalConfig 上，由 global-config 加载时迁移
            if (data.offlineReminder && typeof data.offlineReminder === 'object') {
                globalConfig.offlineReminder = data.offlineReminder;
            }
            if (data.pushNotifications && typeof data.pushNotifications === 'object') {
                globalConfig.pushNotifications = data.pushNotifications;
            }
            if (data.qqBotPush && typeof data.qqBotPush === 'object') {
                globalConfig.qqBotPush = data.qqBotPush;
            }
            if (data.offlineReminderDefault && typeof data.offlineReminderDefault === 'object') {
                globalConfig.offlineReminderDefault = data.offlineReminderDefault;
            }
            if (data.loginSettings && typeof data.loginSettings === 'object') {
                globalConfig.loginSettings = {
                    wechatQrLogin: typeof data.loginSettings.wechatQrLogin === 'boolean'
                        ? data.loginSettings.wechatQrLogin
                        : DEFAULT_LOGIN_SETTINGS.wechatQrLogin,
                    qqQrLogin: typeof data.loginSettings.qqQrLogin === 'boolean'
                        ? data.loginSettings.qqQrLogin
                        : DEFAULT_LOGIN_SETTINGS.qqQrLogin,
                    napCatEndpoint: typeof data.loginSettings.napCatEndpoint === 'string'
                        ? data.loginSettings.napCatEndpoint.trim()
                        : DEFAULT_LOGIN_SETTINGS.napCatEndpoint,
                    napCatSignature: typeof data.loginSettings.napCatSignature === 'string'
                        ? data.loginSettings.napCatSignature.trim()
                        : DEFAULT_LOGIN_SETTINGS.napCatSignature,
                };
            }
            if (data.autoCodeRefresh && typeof data.autoCodeRefresh === 'object') {
                const intervalMinutes = Number(data.autoCodeRefresh.intervalMinutes);
                const maxRetries = Number(data.autoCodeRefresh.maxRetries);
                globalConfig.autoCodeRefresh = {
                    enabled: data.autoCodeRefresh.enabled !== false,
                    intervalMinutes: Math.max(1, Math.min(1440, Number.isFinite(intervalMinutes)
                        ? Math.round(intervalMinutes)
                        : DEFAULT_AUTO_CODE_REFRESH.intervalMinutes)),
                    maxRetries: Math.max(1, Math.min(100, Number.isFinite(maxRetries)
                        ? Math.round(maxRetries)
                        : DEFAULT_AUTO_CODE_REFRESH.maxRetries)),
                };
            }
            if (data.captureSettings && typeof data.captureSettings === 'object') {
                globalConfig.captureSettings = {
                    enabled: typeof data.captureSettings.enabled === 'boolean'
                        ? data.captureSettings.enabled
                        : DEFAULT_CAPTURE_SETTINGS.enabled,
                    autoImportQqGids: typeof data.captureSettings.autoImportQqGids === 'boolean'
                        ? data.captureSettings.autoImportQqGids
                        : DEFAULT_CAPTURE_SETTINGS.autoImportQqGids,
                };
            }
            if (data.userDefaultPlan && typeof data.userDefaultPlan === 'object') {
                globalConfig.userDefaultPlan = data.userDefaultPlan;
            }
            if (data.systemConfig && typeof data.systemConfig === 'object') {
                const srcDevice = (data.systemConfig.deviceInfo && typeof data.systemConfig.deviceInfo === 'object')
                    ? data.systemConfig.deviceInfo : {};
                const deviceOs = String(srcDevice.os || data.systemConfig.os || 'Windows').trim();
                const savedTopVersion = String(data.systemConfig.clientVersion || '').trim();
                const savedDeviceVersion = String(srcDevice.clientVersion || '').trim();
                const savedVersion = savedDeviceVersion || savedTopVersion;
                const savedVersionUpdatedAt = Number(data.systemConfig.clientVersionUpdatedAt);
                const { clientVersion: deviceClientVersion, clientVersionUpdatedAt: deviceClientVersionUpdatedAt, } = resolveClientVersion(savedVersion, savedVersionUpdatedAt);
                const wxVersion = resolveClientVersion(data.systemConfig.wxClientVersion, data.systemConfig.wxClientVersionUpdatedAt, 'wx');
                const normalizedSystemConfig = {
                    serverUrl: String(data.systemConfig.serverUrl || '').trim(),
                    clientVersion: deviceClientVersion,
                    clientVersionUpdatedAt: deviceClientVersionUpdatedAt,
                    wxClientVersion: wxVersion.clientVersion,
                    wxClientVersionUpdatedAt: wxVersion.clientVersionUpdatedAt,
                    platform: String(data.systemConfig.platform || 'qq').trim(),
                    os: deviceOs,
                    timeZone: normalizeTimeZone(data.systemConfig.timeZone || DEFAULT_TIME_ZONE),
                    deviceInfo: {
                        os: deviceOs,
                        clientVersion: deviceClientVersion,
                        sysSoftware: String(srcDevice.sysSoftware || 'Windows').trim(),
                        network: String(srcDevice.network || 'wifi').trim(),
                        memory: String(srcDevice.memory || '16384').trim(),
                        deviceId: String(srcDevice.deviceId || 'DESKTOP-PC<WPC>').trim(),
                        userAgent: String(srcDevice.userAgent || '').trim(),
                    },
                };
                systemConfigMigrated = savedTopVersion !== deviceClientVersion
                    || savedDeviceVersion !== deviceClientVersion
                    || Number(data.systemConfig.clientVersionUpdatedAt) !== deviceClientVersionUpdatedAt
                    || data.systemConfig.wxClientVersion !== wxVersion.clientVersion
                    || Number(data.systemConfig.wxClientVersionUpdatedAt) !== wxVersion.clientVersionUpdatedAt
                    || data.systemConfig.timeZone !== normalizedSystemConfig.timeZone;
                globalConfig.systemConfig = normalizedSystemConfig;
            }
        }
    }
    catch (e) {
        console.error('加载配置失败:', e.message);
        throw storageError('读取', STORE_FILE, e);
    }
}
module.exports = {
    // File paths
    STORE_FILE,
    configStorage,
    ACCOUNTS_FILE,
    KNOWN_FRIEND_GIDS_DIR,
    // Constants
    ALLOWED_PLANTING_STRATEGIES,
    ALLOWED_BAG_SEED_FALLBACK_STRATEGIES,
    PUSHOO_CHANNELS,
    DEFAULT_FERTILIZER_LAND_TYPES,
    FERTILIZER_LAND_TYPE_SET,
    INTERVAL_MAX_SEC,
    DEFAULT_KNOWN_FRIEND_GID_SYNC_COOLDOWN_SEC,
    DEFAULT_FRIENDS_LIST_CACHE_TTL_SEC,
    DEFAULT_OFFLINE_REMINDER,
    OFFLINE_PUSH_CHANNELS,
    defaultChannelCredentials,
    DEFAULT_LOGIN_SETTINGS,
    DEFAULT_CAPTURE_SETTINGS,
    DEFAULT_AUTO_CODE_REFRESH,
    DEFAULT_ACCOUNT_CONFIG,
    ALLOWED_AUTOMATION_KEYS,
    // Mutable shared state (by reference)
    globalConfig,
    get accountFallbackConfig() { return accountFallbackConfig; },
    set accountFallbackConfig(v) { accountFallbackConfig = v; },
    get systemConfigMigrated() { return systemConfigMigrated; },
    set systemConfigMigrated(v) { systemConfigMigrated = !!v; },
    // Helpers
    normalizeKnownFriendGids,
    normalizeKnownFriendGidSyncCooldownSec,
    normalizeFriendsListCacheTtlSec,
    normalizeEmailClaimHour,
    normalizeBagSeedPriority,
    normalizeBagSeedLandTypes,
    normalizeBagSeedFallbackStrategy,
    normalizeRankedSeedFallbackStrategy,
    normalizeFertilizerMode,
    normalizeFertilizerLandTypes,
    normalizeTimeString,
    normalizeIntervals,
    normalizeAutoAcceptFriendMinLevel,
    normalizeAccountConfig,
    normalizeAutomationValue,
    cloneAccountConfig,
    resolveAccountId,
    loadGlobalConfig,
};
//# sourceMappingURL=shared-state.js.map