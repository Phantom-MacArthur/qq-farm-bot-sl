import type { AutomationConfig } from '../types/config';

export const FARM_DAILY_DEFAULTS = {
    farm_illustrated: false,
    farm_email_rewards: true,
    farm_free_gifts: true,
    farm_daily_share: true,
    farm_vip_gift: true,
    farm_month_card_gift: true,
};

export const MUGE_REWARD_DEFAULTS = {
    muge_claim_celebration: false,
    muge_claim_friends: false,
    muge_claim_handbook: false,
    muge_claim_personality: false,
};
export type MugeRewardKey = keyof typeof MUGE_REWARD_DEFAULTS;
export const MUGE_REWARD_KEYS = Object.keys(MUGE_REWARD_DEFAULTS) as MugeRewardKey[];

export const AUTOMATION_MODULE_DEFAULTS = {
    planting_enabled: true,
    fertilizer_enabled: true,
    ranch_production_enabled: true,
    ranch_facilities_enabled: true,
    friends_enabled: true,
    activity_enabled: true,
};

type BooleanAction = { [K in keyof AutomationConfig]: AutomationConfig[K] extends boolean ? K : never }[keyof AutomationConfig];

const RANCH_FRIEND_ACTIONS = ['ranch_friend_steal', 'ranch_friend_clean', 'ranch_friend_mosquito', 'ranch_stroke'] as const;

const MODULE_ACTIONS: Record<keyof typeof AUTOMATION_MODULE_DEFAULTS, BooleanAction[]> = {
    planting_enabled: ['farm', 'farm_push', 'sell'],
    fertilizer_enabled: ['land_upgrade', 'fertilizer_gift', 'fertilizer_buy_organic', 'fertilizer_buy_normal'],
    ranch_production_enabled: ['ranch_harvest', 'ranch_produce', 'ranch_buy', 'ranch_sell'],
    ranch_facilities_enabled: [
        'ranch_activate_shed', 'ranch_upgrade', 'ranch_clean', 'ranch_grass', 'ranch_grass_buy',
        'ranch_fill_cans', 'ranch_feed_normal', 'ranch_feed_organic',
    ],
    friends_enabled: ['friend', 'friend_auto_accept', 'ranch_friend_patrol'],
    activity_enabled: [
        'task', 'mall_coupon_gift_buy', 'mystery_shop_auto_buy', 'mystery_shop_arrival_notify', 'mystery_shop_purchase_notify',
        ...Object.keys(FARM_DAILY_DEFAULTS) as Array<keyof typeof FARM_DAILY_DEFAULTS>,
        ...MUGE_REWARD_KEYS,
        'ranch_task', 'ranch_illustrated', 'ranch_share', 'ranch_daily_benefit', 'ranch_coupon_gift_buy',
        'ranch_market_organic', 'ranch_market_organic_poop', 'ranch_market_organic_pinecone',
    ],
};

export function effectiveAutomation(automation: AutomationConfig): AutomationConfig {
    const result = { ...automation };
    for (const gate of Object.keys(MODULE_ACTIONS) as Array<keyof typeof MODULE_ACTIONS>) {
        if (automation[gate] !== false) continue;
        for (const action of MODULE_ACTIONS[gate]) result[action] = false;
    }
    if (automation.fertilizer_enabled === false) result.fertilizer = 'none';
    if (result.ranch_friend_patrol === false) {
        for (const action of RANCH_FRIEND_ACTIONS) result[action] = false;
    }
    return result;
}
