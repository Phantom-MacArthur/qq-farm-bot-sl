/**
 * 「常规设置」模块卡的纯逻辑：总开关语义、按模块保存需要写回的设置分组。
 * 这里只读 sl 已有的配置键，不引入新键；也不 import 项目内其他模块，
 * 以便测试用 typescript.transpileModule 单文件转译后直接 require。
 */

export type FeatureModuleKey = 'planting' | 'fertilizer' | 'friends' | 'activity'

/** 保存一个模块时实际需要写回的顶层设置分组。 */
export type SettingsSavePart = 'strategy' | 'automation'

export interface FeatureModuleMeta {
  key: FeatureModuleKey
  title: string
  /** 卡片和弹窗头部用的图片，直接指向 public 下的静态资源。 */
  image: string
}

export interface FeatureStrategyShape {
  plantingStrategy: string
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
  { key: 'fertilizer', title: '土地与施肥', image: '/game-config/module_icons/fertilizer.png' },
  { key: 'friends', title: '好友', image: '/game-config/module_icons/friends-friendship.png' },
  { key: 'activity', title: '日常与活动', image: '/game-config/module_icons/activity-task.png' },
]

export const MODULE_SAVE_PARTS: Record<FeatureModuleKey, SettingsSavePart[]> = {
  planting: ['strategy', 'automation'],
  fertilizer: ['automation'],
  friends: ['strategy', 'automation'],
  activity: ['automation'],
}

function auto(ctx: FeatureModuleContext) {
  return ctx.automation?.automation || {}
}

/**
 * 模块总开关的当前状态。偷菜不是独立模块，它只是好友模块里的一个动作，
 * 所以这里只看好友互动总开关 friend，与后端 runFriendTick 的入口判断一致。
 */
export function isModuleEnabled(key: FeatureModuleKey, ctx: FeatureModuleContext): boolean {
  const a = auto(ctx)
  switch (key) {
    case 'planting':
      return a.farm === true
    case 'fertilizer':
      return a.fertilizer !== 'none' || a.land_upgrade === true
    case 'friends':
      return a.friend === true
    case 'activity':
      return a.task === true || a.mall_coupon_gift_buy === true || a.mystery_shop_auto_buy === true
    default:
      return false
  }
}

/**
 * 切换模块总开关。关闭时把该模块下会独立执行的动作一并置 false，
 * 避免出现「开关显示已关闭、后台仍在跑」的状态。直接修改传入对象，
 * 由调用方负责保存。
 */
export function applyModuleEnabled(
  key: FeatureModuleKey,
  enabled: boolean,
  ctx: FeatureModuleContext,
): void {
  const a = ctx.automation.automation
  switch (key) {
    case 'planting':
      a.farm = enabled
      break
    case 'fertilizer':
      if (enabled) {
        if (a.fertilizer === 'none')
          a.fertilizer = 'normal'
      }
      else {
        a.fertilizer = 'none'
        a.land_upgrade = false
      }
      break
    case 'friends':
      a.friend = enabled
      break
    case 'activity':
      a.task = enabled
      if (!enabled) {
        a.mall_coupon_gift_buy = false
        // 神秘商人并入本模块后，总开关关闭时同样要停掉自动购买及其提醒
        a.mystery_shop_auto_buy = false
        a.mystery_shop_purchase_notify = false
      }
      break
  }
}
