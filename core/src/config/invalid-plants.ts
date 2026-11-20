export {};
/**
 * 官方配置表里残留的调试/无效作物（例：成熟仅 2 秒的白萝卜）不属于用户可见范围。
 * 官方配置表每次同步都会重新写入这些条目，因此在加载期统一剔除，
 * 而不是直接删除 Plant.json / ItemInfo.json 条目（会被下次同步覆盖回来）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { getResourcePath } = require('./runtime-paths');

interface InvalidPlantsConfig {
    plant_ids?: number[];
    seed_ids?: number[];
}

function loadInvalidPlants(): { plantIds: Set<number>; seedIds: Set<number> } {
    const empty = { plantIds: new Set<number>(), seedIds: new Set<number>() };
    try {
        const file = path.join(getResourcePath('gameConfig'), 'InvalidPlants.json');
        if (!fs.existsSync(file))
            return empty;
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as InvalidPlantsConfig;
        return {
            plantIds: new Set((raw.plant_ids || []).map(Number)),
            seedIds: new Set((raw.seed_ids || []).map(Number)),
        };
    } catch (e: any) {
        console.warn('[配置] 加载 InvalidPlants.json 失败:', e.message);
        return empty;
    }
}

const { plantIds, seedIds } = loadInvalidPlants();

function isInvalidSeedId(seedId: number | null | undefined): boolean {
    return seedIds.has(Number(seedId));
}

function isInvalidPlant(plant: any): boolean {
    if (!plant)
        return false;
    return plantIds.has(Number(plant.id)) || isInvalidSeedId(plant.seed_id);
}

function filterInvalidPlants<T>(plants: T[]): T[] {
    return (Array.isArray(plants) ? plants : []).filter(plant => !isInvalidPlant(plant));
}

module.exports = {
    isInvalidPlant,
    isInvalidSeedId,
    filterInvalidPlants,
};
