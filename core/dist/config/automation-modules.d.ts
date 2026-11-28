import type { AutomationConfig } from '../types/config';
export declare const FARM_DAILY_DEFAULTS: {
    farm_illustrated: boolean;
    farm_email_rewards: boolean;
    farm_free_gifts: boolean;
    farm_daily_share: boolean;
    farm_vip_gift: boolean;
    farm_month_card_gift: boolean;
};
export declare const MUGE_REWARD_DEFAULTS: {
    muge_claim_celebration: boolean;
    muge_claim_friends: boolean;
    muge_claim_handbook: boolean;
    muge_claim_personality: boolean;
};
export type MugeRewardKey = keyof typeof MUGE_REWARD_DEFAULTS;
export declare const MUGE_REWARD_KEYS: MugeRewardKey[];
export declare const ACTIVITY_AUTOMATION_DEFAULTS: {
    solar_calendar_claim_events: boolean;
    solar_calendar_claim_seasons: boolean;
    solar_calendar_answer_quiz: boolean;
    yishu_claim_seed: boolean;
    yishu_share: boolean;
    yishu_auto_sell: boolean;
    yishu_claim_commission: boolean;
    yishu_plant: boolean;
    yishu_harvest: boolean;
    yishu_use_unshared_price: boolean;
    yishu_sell_mode: AutomationConfig["yishu_sell_mode"];
    yishu_sell_fallback_own: boolean;
    yishu_scan_friend_limit: number;
    yishu_scan_interval_minutes: number;
    yishu_sell_min_count: number;
    yishu_sell_min_price: number;
    yishu_sell_after_time: string;
};
export declare const AUTOMATION_MODULE_DEFAULTS: {
    planting_enabled: boolean;
    fertilizer_enabled: boolean;
    ranch_production_enabled: boolean;
    ranch_facilities_enabled: boolean;
    friends_enabled: boolean;
    activity_enabled: boolean;
};
export declare function effectiveAutomation(automation: AutomationConfig): AutomationConfig;
//# sourceMappingURL=automation-modules.d.ts.map