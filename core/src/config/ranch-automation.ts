import { animalMap, cubMap, getAnimalRequiredLevel } from './ranch-animals';

const RANCH_FEED_STAGES = ['any', 'longest', 'to_production', 'near_harvest'] as const;
export type RanchFeedStage = typeof RANCH_FEED_STAGES[number];
export const RANCH_NEAR_HARVEST_MS = 10 * 60_000;

export const RANCH_AUTOMATION_DEFAULTS = {
    ranch_harvest: true,
    ranch_produce: true,
    ranch_buy: true,
    ranch_activate_shed: true,
    ranch_upgrade: true,
    ranch_sell: true,
    // 旧总开关仅用于兼容旧配置；运行时分别检查两种货币开关。
    ranch_market_organic: true,
    ranch_market_organic_poop: true,
    ranch_market_organic_pinecone: true,
    ranch_grass: true,
    ranch_grass_buy: true,
    ranch_grass_threshold_percent: 20,
    ranch_fill_cans: true,
    ranch_feed_normal: true,
    ranch_feed_normal_stage: 'longest' as RanchFeedStage,
    ranch_feed_organic: true,
    ranch_feed_organic_stage: 'near_harvest' as RanchFeedStage,
    ranch_clean: true,
    ranch_stroke: true,
    ranch_friend_patrol: true,
    ranch_friend_steal: true,
    ranch_friend_produce: false,
    ranch_friend_clean: true,
    ranch_friend_mosquito: true,
    ranch_task: true,
    ranch_illustrated: true,
    ranch_share: true,
    ranch_daily_benefit: true,
    ranch_coupon_gift_buy: false,
    ranch_check_minutes: 5,
    ranch_check_min_seconds: 300,
    ranch_check_max_seconds: 300,
    ranch_strategy: 'level' as 'level' | 'preferred' | 'bag_priority' | 'illustrated',
    ranch_bag_fallback: 'level' as 'level' | 'preferred' | 'bag_priority',
    ranch_coop_animal: 0,
    ranch_shed_animal: 0,
    ranch_coop_cub_priority: [] as number[],
    ranch_shed_cub_priority: [] as number[],
};

export type RanchAutomationConfig = typeof RANCH_AUTOMATION_DEFAULTS;
export const RANCH_SWITCH_KEYS = Object.keys(RANCH_AUTOMATION_DEFAULTS).filter(key => typeof RANCH_AUTOMATION_DEFAULTS[key as keyof RanchAutomationConfig] === 'boolean');
export const RANCH_ANIMAL_OPTIONS = [...animalMap.values()].filter(animal => animal.enable_flag).map(animal => ({
    value: animal.id, label: `${animal.name} · ${getAnimalRequiredLevel(animal.cub_item_id) === null ? '解锁等级未知' : `Lv.${getAnimalRequiredLevel(animal.cub_item_id)}`}`, kind: animal.husbandry_type,
}));

export function normalizeRanchSetting(key: string, value: unknown): boolean | number | string | number[] {
    // 免费解锁随设施维护启用，兼容旧版本仍提交的独立开关。
    if (key === 'ranch_activate_shed') return RANCH_AUTOMATION_DEFAULTS.ranch_activate_shed;
    if (key === 'ranch_feed_normal_stage' || key === 'ranch_feed_organic_stage') {
        if (typeof value !== 'string' || !RANCH_FEED_STAGES.includes(value as RanchFeedStage)) {
            throw Object.assign(new Error('请选择有效的罐头使用时机'), { code: 'INVALID_CONFIG' });
        }
        return value;
    }
    if (key === 'ranch_strategy' || key === 'ranch_bag_fallback') {
        const allowed = key === 'ranch_strategy' ? ['level', 'preferred', 'bag_priority', 'illustrated'] : ['level', 'preferred', 'bag_priority'];
        if (!allowed.includes(String(value))) throw Object.assign(new Error('请选择有效的养殖策略'), { code: 'INVALID_CONFIG' });
        return String(value);
    }
    if (key === 'ranch_coop_animal' || key === 'ranch_shed_animal') {
        const id = Number(value);
        if (id !== 0 && !RANCH_ANIMAL_OPTIONS.some(animal => animal.value === id && animal.kind === (key === 'ranch_coop_animal' ? '窝' : '棚'))) {
            throw Object.assign(new Error('所选动物不适用于当前窝或棚'), { code: 'INVALID_CONFIG' });
        }
        return id;
    }
    if (key === 'ranch_coop_cub_priority' || key === 'ranch_shed_cub_priority') {
        const housing = key === 'ranch_coop_cub_priority' ? '窝' : '棚';
        if (!Array.isArray(value) || value.some(id => cubMap.get(id)?.husbandry_type !== housing)) {
            throw Object.assign(new Error(`${housing}的背包顺序只能包含适用于${housing}的幼崽`), { code: 'INVALID_CONFIG' });
        }
        return [...new Set<number>(value)];
    }
    if (key === 'ranch_check_min_seconds' || key === 'ranch_check_max_seconds') {
        const number = Number(value);
        if (!Number.isInteger(number) || number < 1 || number > 3600) {
            throw Object.assign(new Error('牧场巡查间隔必须是 1–3600 的整数秒'), { code: 'INVALID_CONFIG' });
        }
        return number;
    }
    if (key === 'ranch_check_minutes') {
        const number = Number(value);
        if (!Number.isInteger(number) || number < 1 || number > 60) {
            throw Object.assign(new Error('牧场巡查间隔必须是 1–60 的整数分钟'), { code: 'INVALID_CONFIG' });
        }
        return number;
    }
    if (key === 'ranch_grass_threshold_percent') {
        const number = Number(value);
        if (!Number.isInteger(number) || number < 1 || number > 100) {
            throw Object.assign(new Error('牧草补充阈值必须是 1–100 的整数百分比'), { code: 'INVALID_CONFIG' });
        }
        return number;
    }
    if (typeof value !== 'boolean') throw Object.assign(new Error('牧场开关必须为布尔值'), { code: 'INVALID_CONFIG' });
    return value;
}

export const RANCH_MARKET_SWITCH_BY_CURRENCY = {
    7002: 'ranch_market_organic_poop',
    1008: 'ranch_market_organic_pinecone',
} as const;
export const RANCH_MARKET_SWITCH_KEYS = Object.values(RANCH_MARKET_SWITCH_BY_CURRENCY);

/** 旧配置的总开关只填充缺失的新字段，已明确设置的独立开关优先。 */
export function migrateRanchMarketAutomation(input: Record<string, any>): Record<string, any> {
    const result = { ...input };
    // 老版本只保存固定分钟值，迁移为等值秒数区间；部分更新不触碰已有区间。
    if (result.ranch_check_minutes !== undefined) {
        const seconds = (normalizeRanchSetting('ranch_check_minutes', result.ranch_check_minutes) as number) * 60;
        if (result.ranch_check_min_seconds === undefined) result.ranch_check_min_seconds = seconds;
        if (result.ranch_check_max_seconds === undefined) result.ranch_check_max_seconds = seconds;
    }
    if (typeof result.ranch_market_organic === 'boolean') {
        for (const key of RANCH_MARKET_SWITCH_KEYS) {
            if (result[key] === undefined) result[key] = result.ranch_market_organic;
        }
    }
    return result;
}

export function getRanchPatrolIntervalMs(input: Partial<RanchAutomationConfig>, random: () => number = Math.random): number {
    const legacy = Math.max(1, Math.min(60, Number(input.ranch_check_minutes) || 5)) * 60;
    const first = Math.max(1, Math.min(3600, Number(input.ranch_check_min_seconds) || legacy));
    const second = Math.max(1, Math.min(3600, Number(input.ranch_check_max_seconds) || legacy));
    const minimum = Math.min(first, second);
    const maximum = Math.max(first, second);
    return (minimum + Math.floor(random() * (maximum - minimum + 1))) * 1000;
}

export function isRanchMarketEnabled(input: Partial<RanchAutomationConfig>): boolean {
    return RANCH_MARKET_SWITCH_KEYS.some(key => (input[key] ?? input.ranch_market_organic) === true);
}
