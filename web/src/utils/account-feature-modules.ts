export type FeatureModuleKey = 'planting' | 'ranchProduction' | 'fertilizer' | 'ranchFacilities' | 'friends' | 'activity'
export type BagPreferenceModule = Extract<FeatureModuleKey, 'planting' | 'ranchProduction'>

export const MUGE_REWARD_OPTIONS = [
  { key: 'muge_claim_celebration', label: '领取兴牧庆典奖励' },
  { key: 'muge_claim_friends', label: '领取牧友同行奖励' },
  { key: 'muge_claim_handbook', label: '领取成长手册奖励' },
  { key: 'muge_claim_personality', label: '领取牧场人格奖励' },
] as const

export const SOLAR_REWARD_OPTIONS = [
  { key: 'solar_calendar_claim_events', label: '自动领取节令奖励' },
  { key: 'solar_calendar_claim_seasons', label: '自动领取季度奖励' },
  { key: 'solar_calendar_answer_quiz', label: '自动回答有官方答案的节令题' },
] as const

export const YISHU_ACTIVITY_OPTIONS = [
  { key: 'yishu_claim_seed', label: '每日领取红薯种子' },
  { key: 'yishu_plant', label: '空地优先种红薯' },
  { key: 'yishu_harvest', label: '自动收获成熟红薯' },
  { key: 'yishu_share', label: '每日分享铺子' },
  { key: 'yishu_claim_commission', label: '领取收购提成' },
] as const

export const YISHU_SELL_DEFAULTS = {
  yishu_scan_friend_limit: 200,
  yishu_scan_interval_minutes: 30,
  yishu_sell_min_count: 1,
  yishu_sell_min_price: 450,
  yishu_sell_after_time: '12:00',
  yishu_sell_mode: '',
  yishu_use_unshared_price: false,
}

export const YISHU_AUTOMATION_DEFAULTS = {
  yishu_claim_seed: true,
  yishu_plant: true,
  yishu_harvest: true,
  yishu_share: true,
  yishu_claim_commission: true,
  yishu_auto_sell: true,
  ...YISHU_SELL_DEFAULTS,
}

export const YISHU_SELL_MODES = [
  { value: 'off', label: '不询价也不卖薯' },
  { value: 'manual', label: '仅询价' },
  { value: 'scan', label: '询价但不卖薯' },
  { value: 'auto', label: '自动询价并卖薯' },
] as const

export function yishuSellMode(automation: Record<string, any>) {
  if (automation.yishu_sell_mode === 'confirm')
    return 'scan'
  const mode = YISHU_SELL_MODES.find(option => option.value === automation.yishu_sell_mode)
  return mode?.value ?? (automation.yishu_auto_sell === false ? 'off' : 'auto')
}

export function yishuAutomationDraft(automation: Record<string, any>) {
  return {
    ...Object.fromEntries(Object.entries(YISHU_AUTOMATION_DEFAULTS).map(([key, value]) => [key, automation[key] ?? value])),
    yishu_sell_mode: yishuSellMode(automation),
    yishu_sell_after_time: automation.yishu_sell_after_time || YISHU_SELL_DEFAULTS.yishu_sell_after_time,
  }
}

export const ACTIVITY_AUTOMATION_DEFAULTS = {
  solar_calendar_claim_events: false,
  solar_calendar_claim_seasons: false,
  solar_calendar_answer_quiz: false,
  ...YISHU_AUTOMATION_DEFAULTS,
}

export interface FeatureModuleMeta {
  key: FeatureModuleKey
  title: string
  image?: string
  icon?: string
}

export interface FeatureStrategyShape {
  plantingStrategy: string
  bagSeedPriority: number[]
  bagSeedLandTypes: Record<string, string[]>
  bagSeedMultiLandReservationEnabled?: boolean
  stealDelaySeconds?: number
  intervals: {
    farmMin?: number
    farmMax?: number
    friendMin?: number
    friendMax?: number
  }
  friendQuietHours: {
    enabled?: boolean
    start?: string
    end?: string
    continueFarm?: boolean
  }
}

export interface FeatureAutomationShape {
  automation: Record<string, any>
  autoAcceptFriendMinLevel?: number
  autoAcceptRequireOwnLevel?: boolean
  emailClaimHour: number | string
  fertilizerBuyOrganicCount?: number
  fertilizerBuyOrganicThresholdHours?: number
  fertilizerBuyNormalCount?: number
  fertilizerBuyNormalThresholdHours?: number
  fertilizerBuyCheckIntervalMinutes?: number
  fertilizerBuyNormalCheckIntervalMinutes?: number
}

export interface FeatureModuleContext {
  strategy: FeatureStrategyShape
  automation: FeatureAutomationShape
}

/** 神秘商人货币在后端是四个独立布尔，UI 用单选下拉，这里做双向映射。 */
export const MYSTERY_SHOP_CURRENCIES = [
  { label: '金币', value: 'gold', key: 'mystery_shop_allow_gold' },
  { label: '点券', value: 'coupon', key: 'mystery_shop_allow_coupon' },
  { label: '金豆豆', value: 'gold_bean', key: 'mystery_shop_allow_gold_bean' },
  { label: '钻石', value: 'diamond', key: 'mystery_shop_allow_diamond' },
] as const

export function getAllowedMysteryShopCurrency(a: Record<string, any>): string {
  const found = MYSTERY_SHOP_CURRENCIES.find(currency => a?.[currency.key] === true)
  return found ? found.value : ''
}

export function applyAllowedMysteryShopCurrency(a: Record<string, any>, value: string): void {
  for (const currency of MYSTERY_SHOP_CURRENCIES)
    a[currency.key] = currency.value === value
}

/** 卡片顺序即页面渲染顺序，不要依赖对象字面量的隐式次序。 */
export const FEATURE_MODULES: FeatureModuleMeta[] = [
  { key: 'planting', title: '种植与收获', image: '/game-config/module_icons/planting.png' },
  { key: 'ranchProduction', title: '养殖与收获', icon: 'i-carbon-pet-image-o' },
  { key: 'fertilizer', title: '土地与施肥', image: '/game-config/module_icons/fertilizer.png' },
  { key: 'ranchFacilities', title: '设施与喂养', icon: 'i-carbon-building' },
  { key: 'friends', title: '好友', image: '/game-config/module_icons/friends-friendship.png' },
  { key: 'activity', title: '日常与活动', image: '/game-config/module_icons/activity-task.png' },
]


export const MODULE_GATE_KEYS = {
  planting: 'planting_enabled',
  ranchProduction: 'ranch_production_enabled',
  fertilizer: 'fertilizer_enabled',
  ranchFacilities: 'ranch_facilities_enabled',
  friends: 'friends_enabled',
  activity: 'activity_enabled',
} as const satisfies Record<FeatureModuleKey, string>

const FRIEND_ACTION_FIELDS = {
  patrol: ['friend', 'ranch_friend_patrol'],
  help: ['friend_help', 'ranch_friend_clean'],
  steal: ['friend_steal', 'ranch_friend_steal'],
  mischief: ['friend_bad', 'ranch_friend_mosquito'],
} as const

export type FriendAction = keyof typeof FRIEND_ACTION_FIELDS

export function getSharedFriendAction(action: FriendAction, automation: Record<string, unknown>): boolean | 'mixed' {
  const [farm, ranch] = FRIEND_ACTION_FIELDS[action]
  const farmEnabled = automation[farm] === true
  const ranchEnabled = action === 'patrol' ? automation[ranch] !== false : automation[ranch] === true
  return farmEnabled === ranchEnabled ? farmEnabled : 'mixed'
}

export function setSharedFriendAction(action: FriendAction, enabled: boolean, automation: Record<string, unknown>): void {
  for (const field of FRIEND_ACTION_FIELDS[action])
    automation[field] = enabled
}

const MODULE_AUTOMATION_KEYS: Record<FeatureModuleKey, string[]> = {
  planting: ['farm', 'farm_harvest_tiangong', 'farm_push', 'skip_own_weed_bug', 'sell'],
  ranchProduction: [
    'ranch_produce', 'ranch_harvest', 'ranch_buy', 'ranch_sell', 'ranch_check_min_seconds', 'ranch_check_max_seconds',
    'ranch_strategy', 'ranch_bag_fallback', 'ranch_coop_animal', 'ranch_shed_animal',
    'ranch_coop_cub_priority', 'ranch_shed_cub_priority',
  ],
  fertilizer: [
    'land_upgrade', 'fertilizer_gift', 'fertilizer_buy_organic', 'fertilizer_buy_normal',
    'fertilizer_multi_season', 'show_manual_fertilizer', 'fertilizer', 'fertilizer_land_types', 'fertilizer_land_strategies', 'fertilizer_smart_seconds',
  ],
  ranchFacilities: [
    'ranch_upgrade', 'ranch_clean', 'ranch_grass', 'ranch_grass_buy',
    'ranch_grass_threshold_percent', 'ranch_fill_cans', 'ranch_feed_normal', 'ranch_feed_organic',
    'ranch_feed_normal_stage', 'ranch_feed_organic_stage',
  ],
  friends: [
    ...Object.values(FRIEND_ACTION_FIELDS).flat(),
    'friend_help_exp_limit', 'friend_help_protect_dog_ignore_exp_limit', 'friend_auto_accept', 'ranch_stroke',
  ],
  activity: [
    'task', 'farm_illustrated', 'farm_email_rewards', 'farm_free_gifts', 'farm_daily_share', 'farm_vip_gift', 'farm_month_card_gift',
    'mystery_shop_auto_buy', 'mall_coupon_gift_buy',
    ...MYSTERY_SHOP_CURRENCIES.map(currency => currency.key),
    'ranch_task', 'ranch_illustrated', 'ranch_share', 'ranch_daily_benefit', 'ranch_coupon_gift_buy',
    'ranch_market_organic_poop', 'ranch_market_organic_pinecone',
    ...MUGE_REWARD_OPTIONS.map(option => option.key),
    ...Object.keys(ACTIVITY_AUTOMATION_DEFAULTS),
  ],
}

export function getModuleAutomation(key: FeatureModuleKey, automation: Record<string, any>, gateOnly = false) {
  const fields = gateOnly ? [MODULE_GATE_KEYS[key]] : [MODULE_GATE_KEYS[key], ...MODULE_AUTOMATION_KEYS[key]]
  return Object.fromEntries(fields.filter(field => Object.prototype.hasOwnProperty.call(automation, field)).map(field => [field, automation[field]]))
}

const ACTIVITY_REWARD_KEYS = [
  'farm_illustrated',
  ...MUGE_REWARD_OPTIONS.map(option => option.key),
  ...SOLAR_REWARD_OPTIONS.map(option => option.key),
  ...YISHU_ACTIVITY_OPTIONS.map(option => option.key),
  'yishu_auto_sell',
  'yishu_sell_mode',
  'yishu_use_unshared_price',
] as const
type ActivityRewardSettings = Partial<Record<typeof ACTIVITY_REWARD_KEYS[number], boolean | string>>

export function wereActivityRewardSettingsSaved(requested: ActivityRewardSettings | undefined, saved: ActivityRewardSettings | undefined): boolean {
  return ACTIVITY_REWARD_KEYS.every(key => requested?.[key] === undefined || requested[key] === saved?.[key])
}

export function isModuleEnabled(key: FeatureModuleKey, ctx: FeatureModuleContext): boolean {
  return ctx.automation.automation[MODULE_GATE_KEYS[key]] !== false
}

export function applyModuleEnabled(key: FeatureModuleKey, enabled: boolean, ctx: FeatureModuleContext): void {
  ctx.automation.automation[MODULE_GATE_KEYS[key]] = enabled
}
