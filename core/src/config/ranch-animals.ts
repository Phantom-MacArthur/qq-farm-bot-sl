import animals from '../gameConfig/ranch/MCAnimalConfig.json';
import mutations from '../gameConfig/ranch/MCAnimalMutation.json';
import goods from '../gameConfig/Goods.json';

export function getAnimalRequiredLevel(cubItemId: number): number | null {
    const levels = goods.filter(row => row.shop_id === 5 && row.item_id === cubItemId)
        .map(row => row.conds?.match(/:(\d+)$/)?.[1]).filter(Boolean).map(Number);
    return levels.length ? Math.min(...levels) : null;
}

export const animalMap = new Map(animals.map(row => [row.id, row]));
export const cubMap = new Map([
    ...animals.map(row => [row.cub_item_id, { ...row, giantCubItemId: 0 }] as const),
    ...mutations.map(row => [row.giant_cub_item_id, { ...animalMap.get(row.animal_id)!, giantCubItemId: row.giant_cub_item_id }] as const),
]);
