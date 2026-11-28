"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTOMATION_MODULE_DEFAULTS = exports.ACTIVITY_AUTOMATION_DEFAULTS = exports.MUGE_REWARD_KEYS = exports.MUGE_REWARD_DEFAULTS = exports.FARM_DAILY_DEFAULTS = void 0;
exports.effectiveAutomation = effectiveAutomation;
const yishuhuanfu_1 = require("./yishuhuanfu");
exports.FARM_DAILY_DEFAULTS = {
    farm_illustrated: false,
    farm_email_rewards: true,
    farm_free_gifts: true,
    farm_daily_share: true,
    farm_vip_gift: true,
    farm_month_card_gift: true,
};
exports.MUGE_REWARD_DEFAULTS = {
    muge_claim_celebration: false,
    muge_claim_friends: false,
    muge_claim_handbook: false,
    muge_claim_personality: false,
};
exports.MUGE_REWARD_KEYS = Object.keys(exports.MUGE_REWARD_DEFAULTS);
exports.ACTIVITY_AUTOMATION_DEFAULTS = {
    solar_calendar_claim_events: false,
    solar_calendar_claim_seasons: false,
    solar_calendar_answer_quiz: false,
    yishu_claim_seed: true,
    yishu_share: true,
    yishu_auto_sell: true,
    yishu_claim_commission: true,
    yishu_plant: true,
    yishu_harvest: true,
    yishu_use_unshared_price: false,
    yishu_sell_mode: '',
    yishu_sell_fallback_own: false,
    yishu_scan_friend_limit: yishuhuanfu_1.YISHU_SCAN_LIMIT,
    yishu_scan_interval_minutes: yishuhuanfu_1.YISHU_SCAN_MINUTES,
    yishu_sell_min_count: 1,
    yishu_sell_min_price: yishuhuanfu_1.YISHU_MIN_PRICE,
    yishu_sell_after_time: yishuhuanfu_1.YISHU_DEFAULT_SELL_AFTER_TIME,
};
exports.AUTOMATION_MODULE_DEFAULTS = {
    planting_enabled: true,
    fertilizer_enabled: true,
    ranch_production_enabled: true,
    ranch_facilities_enabled: true,
    friends_enabled: true,
    activity_enabled: true,
};
const RANCH_FRIEND_ACTIONS = ['ranch_friend_steal', 'ranch_friend_clean', 'ranch_friend_mosquito', 'ranch_stroke'];
const MODULE_ACTIONS = {
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
        ...Object.keys(exports.FARM_DAILY_DEFAULTS),
        ...exports.MUGE_REWARD_KEYS,
        'solar_calendar_claim_events', 'solar_calendar_claim_seasons', 'solar_calendar_answer_quiz',
        'yishu_claim_seed', 'yishu_share', 'yishu_auto_sell', 'yishu_claim_commission',
        'yishu_plant', 'yishu_harvest',
        'ranch_task', 'ranch_illustrated', 'ranch_share', 'ranch_daily_benefit', 'ranch_coupon_gift_buy',
        'ranch_market_organic', 'ranch_market_organic_poop', 'ranch_market_organic_pinecone',
    ],
};
function effectiveAutomation(automation) {
    const result = { ...automation };
    for (const gate of Object.keys(MODULE_ACTIONS)) {
        if (automation[gate] !== false)
            continue;
        for (const action of MODULE_ACTIONS[gate])
            result[action] = false;
    }
    if (automation.activity_enabled === false)
        result.yishu_sell_mode = 'off';
    if (automation.fertilizer_enabled === false)
        result.fertilizer = 'none';
    if (result.ranch_friend_patrol === false) {
        for (const action of RANCH_FRIEND_ACTIONS)
            result[action] = false;
    }
    return result;
}
//# sourceMappingURL=automation-modules.js.map