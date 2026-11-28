import type { AUTOMATION_MODULE_DEFAULTS, FARM_DAILY_DEFAULTS, MugeRewardKey } from '../config/automation-modules';
import type { FarmActivityEvent, MysteryNotificationMessages, NotificationTypes } from '../config/notification-types';
import type { RanchAutomationConfig } from '../config/ranch-automation';
export {};
export type PlantingStrategy = 'preferred' | 'level' | 'max_exp' | 'max_fert_exp' | 'max_profit' | 'max_fert_profit' | 'bag_priority' | 'illustrated';
export type BagSeedFallbackStrategy = PlantingStrategy;
export type RankedSeedFallbackStrategy = PlantingStrategy | '';
export type FertilizerMode = 'both' | 'normal' | 'organic' | 'smart' | 'none' | 'normal_ripen' | 'organic_ripen';
export type FertilizerLandType = 'blue-crystal' | 'purple-gold' | 'gold' | 'black' | 'red' | 'normal';
export interface AutomationConfig extends RanchAutomationConfig, Record<keyof typeof AUTOMATION_MODULE_DEFAULTS | keyof typeof FARM_DAILY_DEFAULTS | MugeRewardKey, boolean> {
    farm: boolean;
    farm_harvest_tiangong: boolean;
    farm_push: boolean;
    land_upgrade: boolean;
    friend: boolean;
    friend_auto_accept: boolean;
    friend_help_exp_limit: boolean;
    friend_steal: boolean;
    friend_help: boolean;
    friend_bad: boolean;
    friend_help_protect_dog_ignore_exp_limit: boolean;
    task: boolean;
    fertilizer_gift: boolean;
    fertilizer_buy_organic: boolean;
    fertilizer_buy_normal: boolean;
    mystery_shop_auto_buy: boolean;
    mystery_shop_allow_gold: boolean;
    mystery_shop_allow_coupon: boolean;
    mystery_shop_allow_gold_bean: boolean;
    mystery_shop_allow_diamond: boolean;
    mystery_shop_arrival_notify: boolean;
    mystery_shop_purchase_notify: boolean;
    mall_coupon_gift_buy: boolean;
    sell: boolean;
    fertilizer: FertilizerMode;
    fertilizer_multi_season: boolean;
    fertilizer_land_types: FertilizerLandType[];
    fertilizer_land_strategies: Partial<Record<FertilizerLandType, FertilizerMode>>;
    fertilizer_smart_seconds: number;
    skip_own_weed_bug: boolean;
    show_manual_fertilizer: boolean;
    solar_calendar_claim_events: boolean;
    solar_calendar_claim_seasons: boolean;
    solar_calendar_answer_quiz: boolean;
    yishu_claim_seed: boolean;
    yishu_share: boolean;
    yishu_auto_sell: boolean;
    yishu_plant: boolean;
    yishu_harvest: boolean;
    yishu_use_unshared_price: boolean;
    /** 空值保留旧版 yishu_auto_sell 的保存值。 */
    yishu_sell_mode: '' | 'off' | 'manual' | 'scan' | 'auto';
    /** 小铺收购提成（好友把蜜薯卖进你的铺子产生）到账后自动领。 */
    yishu_claim_commission: boolean;
    /** 好友铺子当天都收满时，把剩下的卖给自己铺子（不浪费已收获的蜜薯）。 */
    yishu_sell_fallback_own: boolean;
    /** 每次比价扫描的好友数量上限，好友越多单轮读请求越多。 */
    yishu_scan_friend_limit: number;
    /** 两次比价之间的最小间隔（分钟），间隔内复用上一轮结果。 */
    yishu_scan_interval_minutes: number;
    /** 背包蜜薯达到这个数量才自动卖出。 */
    yishu_sell_min_count: number;
    yishu_sell_min_price: number;
    /** 最早出售时间（北京时间 HH:MM），缺省为 12:00。 */
    yishu_sell_after_time: string;
}
export interface IntervalConfig {
    farm: number;
    farmMin: number;
    farmMax: number;
    friendMin: number;
    friendMax: number;
    helpMin: number;
    helpMax: number;
    stealMin: number;
    stealMax: number;
    [key: string]: number;
}
export interface QuietHoursConfig {
    enabled: boolean;
    start: string;
    end: string;
    continueFarm: boolean;
}
export interface AccountConfig {
    automation: AutomationConfig;
    plantingStrategy: PlantingStrategy;
    preferredSeedId: number;
    intervals: IntervalConfig;
    friendQuietHours: QuietHoursConfig;
    knownFriendGids: number[];
    knownFriendGidSyncCooldownSec: number;
    friendsListCacheTtlSec: number;
    friendBlacklist: number[];
    ranchFriendBlacklist: number[];
    plantBlacklist: number[];
    stealDelaySeconds: number;
    plantDelaySeconds: number;
    fertilizerBuyOrganicCount: number;
    fertilizerBuyOrganicThresholdHours: number;
    fertilizerBuyNormalCount: number;
    fertilizerBuyNormalThresholdHours: number;
    fertilizerBuyCheckIntervalMinutes: number;
    fertilizerBuyNormalCheckIntervalMinutes: number;
    /** 已废弃：邮箱改为默认周期检查（登录/刷新 code 立即 + 冷却轮询），仅为兼容旧配置保留。 */
    emailClaimHour: number;
    bagSeedPriority: number[];
    /** 是否为明确排在前面的多格背包种子保留尚未连成布局的空地。 */
    bagSeedMultiLandReservationEnabled: boolean;
    /** seedId -> 允许种植的土地类型。缺 key 视为不限制。 */
    bagSeedLandTypes: Record<string, FertilizerLandType[]>;
    bagSeedFallbackStrategy: BagSeedFallbackStrategy;
    rankedSeedFallbackStrategy: RankedSeedFallbackStrategy;
    autoAcceptFriendMinLevel: number;
    autoAcceptRequireOwnLevel: boolean;
}
export interface OfflineChannelCredential {
    token: string;
    wxPusherUid: string;
}
export interface OfflineReminder {
    channel: string;
    endpoint: string;
    token: string;
    secret: string;
    wxPusherUid: string;
    channelCredentials: Record<string, OfflineChannelCredential>;
    title: string;
    msg: string;
    notificationTypes?: Partial<NotificationTypes>;
    mysteryMessages?: Partial<MysteryNotificationMessages>;
    farmActivityEvents?: FarmActivityEvent[];
}
export interface UIConfig {
    theme: 'light' | 'dark';
}
export interface LoginSettings {
    wechatQrLogin: boolean;
    qqQrLogin: boolean;
    napCatEndpoint: string;
    napCatSignature: string;
}
/**
 * 面板侧的抓包登录开关（落在 store.json）。
 * 与 `<data>/capture/config.json`（代理端口、抓取域名等内核配置）相互独立。
 */
export interface CaptureSettings {
    /** 是否允许使用抓包登录添加/更新账号 */
    enabled: boolean;
    /** QQ 抓包登录后是否把抓到的好友 GID 自动并入已知好友列表 */
    autoImportQqGids: boolean;
}
export interface DeviceInfo {
    os: string;
    clientVersion: string;
    sysSoftware: string;
    network: string;
    memory: string;
    deviceId: string;
    userAgent: string;
}
export interface AutoCodeRefreshConfig {
    /** 掉线重登：账号掉线后等待一段时间自动续期并重登。 */
    offlineEnabled: boolean;
    offlineDelaySeconds: number;
}
export interface SystemConfig {
    serverUrl: string;
    clientVersion: string;
    clientVersionUpdatedAt?: number;
    wxClientVersion: string;
    wxClientVersionUpdatedAt?: number;
    platform: string;
    os: string;
    timeZone: string;
    deviceInfo: DeviceInfo;
    autoCodeRefresh?: AutoCodeRefreshConfig;
    /** 服务启动后是否自动拉起已保存账号（系统级，默认开启）。 */
    autoStartAccounts?: boolean;
}
/**
 * 旧版微信 Code 设置格式，仍用于读取已有的配置和兼容旧面板接口。
 */
export interface LegacyAutoCodeRefreshConfig {
    enabled: boolean;
    intervalMinutes: number;
    maxRetries: number;
}
/**
 * 单用户「默认方案」：一份可跨账号复用的策略/自动化模板，落在 store.json。
 * config 只保存方案相关的字段，应用时按字段合并，不会覆盖账号特有的好友列表等。
 */
export interface UserDefaultPlan {
    enabled: boolean;
    config: Record<string, any>;
    updatedAt: number;
}
export interface GlobalConfig {
    accountConfigs: Record<string, AccountConfig>;
    defaultAccountConfig: AccountConfig;
    autoCodeRefresh: LegacyAutoCodeRefreshConfig;
    ui: UIConfig;
    loginSettings: LoginSettings;
    captureSettings: CaptureSettings;
    accountOfflineReminders: Record<string, OfflineReminder>;
    offlineReminderDefault: OfflineReminder | null;
    pushNotifications?: {
        notificationTypes?: Partial<NotificationTypes>;
    };
    systemConfig: SystemConfig | null;
    userDefaultPlan: UserDefaultPlan | null;
}
//# sourceMappingURL=config.d.ts.map