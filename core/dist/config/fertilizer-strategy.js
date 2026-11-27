"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FERTILIZER_MODES = exports.FERTILIZER_LAND_TYPES = void 0;
exports.normalizeFertilizerLandStrategies = normalizeFertilizerLandStrategies;
exports.getFertilizerStrategyGroups = getFertilizerStrategyGroups;
exports.usesNormalFertilizer = usesNormalFertilizer;
exports.usesImmediateOrganicFertilizer = usesImmediateOrganicFertilizer;
exports.usesRipeningFertilizer = usesRipeningFertilizer;
exports.FERTILIZER_LAND_TYPES = ['blue-crystal', 'purple-gold', 'gold', 'black', 'red', 'normal'];
exports.FERTILIZER_MODES = new Set(['none', 'normal', 'organic', 'both', 'smart', 'normal_ripen', 'organic_ripen']);
function normalizeFertilizerLandStrategies(input) {
    const strategies = {};
    if (!input || typeof input !== 'object')
        return strategies;
    const source = input;
    for (const type of exports.FERTILIZER_LAND_TYPES) {
        if (exports.FERTILIZER_MODES.has(source[type]))
            strategies[type] = source[type];
    }
    return strategies;
}
function getFertilizerStrategyGroups(settings) {
    const groups = new Map();
    if (settings.fertilizer_enabled === false)
        return groups;
    const selected = new Set(settings.fertilizer_land_types ?? exports.FERTILIZER_LAND_TYPES);
    for (const type of exports.FERTILIZER_LAND_TYPES) {
        const mode = settings.fertilizer_land_strategies?.[type] ?? (selected.has(type) ? settings.fertilizer : 'none');
        if (!mode || mode === 'none')
            continue;
        const types = groups.get(mode) ?? [];
        types.push(type);
        groups.set(mode, types);
    }
    return groups;
}
function usesNormalFertilizer(mode) {
    return mode === 'normal' || mode === 'both' || mode === 'smart';
}
function usesImmediateOrganicFertilizer(mode) {
    return mode === 'organic' || mode === 'both' || mode === 'smart';
}
function usesRipeningFertilizer(mode) {
    return mode === 'smart' || mode === 'normal_ripen' || mode === 'organic_ripen';
}
//# sourceMappingURL=fertilizer-strategy.js.map