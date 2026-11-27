import type { AutomationConfig, FertilizerLandType, FertilizerMode } from '../types/config';
export declare const FERTILIZER_LAND_TYPES: readonly FertilizerLandType[];
export declare const FERTILIZER_MODES: Set<FertilizerMode>;
export declare function normalizeFertilizerLandStrategies(input: unknown): Partial<Record<FertilizerLandType, FertilizerMode>>;
export type FertilizerSettings = Partial<Pick<AutomationConfig, 'fertilizer' | 'fertilizer_enabled' | 'fertilizer_land_types' | 'fertilizer_land_strategies' | 'fertilizer_smart_seconds'>>;
export declare function getFertilizerStrategyGroups(settings: FertilizerSettings): Map<FertilizerMode, FertilizerLandType[]>;
export declare function usesNormalFertilizer(mode: FertilizerMode): boolean;
export declare function usesImmediateOrganicFertilizer(mode: FertilizerMode): boolean;
export declare function usesRipeningFertilizer(mode: FertilizerMode): boolean;
//# sourceMappingURL=fertilizer-strategy.d.ts.map