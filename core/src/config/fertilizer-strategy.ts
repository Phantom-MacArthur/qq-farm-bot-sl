import type { AutomationConfig, FertilizerLandType, FertilizerMode } from '../types/config';

export const FERTILIZER_LAND_TYPES: readonly FertilizerLandType[] = ['blue-crystal', 'purple-gold', 'gold', 'black', 'red', 'normal'];
export const FERTILIZER_MODES = new Set<FertilizerMode>(['none', 'normal', 'organic', 'both', 'smart', 'normal_ripen', 'organic_ripen']);

export function normalizeFertilizerLandStrategies(input: unknown): Partial<Record<FertilizerLandType, FertilizerMode>> {
    const strategies: Partial<Record<FertilizerLandType, FertilizerMode>> = {};
    if (!input || typeof input !== 'object') return strategies;
    const source = input as Record<string, FertilizerMode>;
    for (const type of FERTILIZER_LAND_TYPES) {
        if (FERTILIZER_MODES.has(source[type])) strategies[type] = source[type];
    }
    return strategies;
}

export type FertilizerSettings = Partial<Pick<AutomationConfig, 'fertilizer' | 'fertilizer_enabled' | 'fertilizer_land_types' | 'fertilizer_land_strategies' | 'fertilizer_smart_seconds'>>;

export function getFertilizerStrategyGroups(settings: FertilizerSettings): Map<FertilizerMode, FertilizerLandType[]> {
    const groups = new Map<FertilizerMode, FertilizerLandType[]>();
    if (settings.fertilizer_enabled === false) return groups;
    const selected = new Set(settings.fertilizer_land_types ?? FERTILIZER_LAND_TYPES);
    for (const type of FERTILIZER_LAND_TYPES) {
        const mode = settings.fertilizer_land_strategies?.[type] ?? (selected.has(type) ? settings.fertilizer : 'none');
        if (!mode || mode === 'none') continue;
        const types = groups.get(mode) ?? [];
        types.push(type);
        groups.set(mode, types);
    }
    return groups;
}

export function usesNormalFertilizer(mode: FertilizerMode): boolean {
    return mode === 'normal' || mode === 'both' || mode === 'smart';
}

export function usesImmediateOrganicFertilizer(mode: FertilizerMode): boolean {
    return mode === 'organic' || mode === 'both' || mode === 'smart';
}

export function usesRipeningFertilizer(mode: FertilizerMode): boolean {
    return mode === 'smart' || mode === 'normal_ripen' || mode === 'organic_ripen';
}
