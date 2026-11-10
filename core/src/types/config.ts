export {};
export type PlantingStrategy =
  | 'preferred'
  | 'level'
  | 'max_exp'
  | 'max_fert_exp'
  | 'max_profit'
  | 'max_fert_profit'
  | 'bag_priority';

export type BagSeedFallbackStrategy = Exclude<PlantingStrategy, 'bag_priority'>;

export type FertilizerMode = 'both' | 'normal' | 'organic' | 'smart' | 'none';

export type FertilizerLandType = 'blue-crystal' | 'purple-gold' | 'gold' | 'black' | 'red' | 'normal';

export interface AutomationConfig {
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
  sell: boolean;
  fertilizer: FertilizerMode;
  fertilizer_multi_season: boolean;
  fertilizer_land_types: FertilizerLandType[];
  fertilizer_smart_seconds: number;
  skip_own_weed_bug: boolean;
  show_manual_fertilizer: boolean;
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
  plantBlacklist: number[];
  stealDelaySeconds: number;
  plantOrderRandom: boolean;
  plantDelaySeconds: number;
  fertilizerBuyOrganicCount: number;
  fertilizerBuyOrganicThresholdHours: number;
  fertilizerBuyNormalCount: number;
  fertilizerBuyNormalThresholdHours: number;
  fertilizerBuyCheckIntervalMinutes: number;
  /** 每天检查邮箱奖励的时间（0-23 点，默认 10 点）；到点后每天只触发一次。 */
  emailClaimHour: number;
  bagSeedPriority: number[];
  /** 是否为明确排在前面的多格背包种子保留尚未连成布局的空地。 */
  bagSeedMultiLandReservationEnabled: boolean;
  /** seedId -> 允许种植的土地类型。缺 key 视为不限制。 */
  bagSeedLandTypes: Record<string, FertilizerLandType[]>;
  bagSeedFallbackStrategy: BagSeedFallbackStrategy;
  autoAcceptFriendMinLevel: number;
  autoAcceptRequireOwnLevel: boolean;
  autoAcceptHarvestStealEnabled: boolean;
  autoAcceptHarvestStealHarvest: number;
  autoAcceptHarvestStealSteal: number;
}

export interface OfflineReminder {
  channel: string;
  endpoint: string;
  token: string;
  secret: string;
  title: string;
  msg: string;
  offlineDeleteSec: number;
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
}

export interface GlobalConfig {
  accountConfigs: Record<string, AccountConfig>;
  defaultAccountConfig: AccountConfig;
  ui: UIConfig;
  loginSettings: LoginSettings;
  captureSettings: CaptureSettings;
  offlineReminder: OfflineReminder;
  systemConfig: SystemConfig | null;
}
