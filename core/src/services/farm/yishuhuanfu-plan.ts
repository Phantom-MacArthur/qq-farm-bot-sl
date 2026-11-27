import levels from '../../gameConfig/LandLevel.json';
import { estimateYishuMaturity, yishuPlantDeadline, YISHU_SEED_ID } from '../../config/yishuhuanfu';

const { getPlantBySeedId, getPlantGrowTime } = require('../../config/gameConfig');

export function estimateYishuLand(land: any, now: number, end: number) {
    const level = levels.find(item => Number(item.id) === Number(land.level));
    const reduction = Number(land.buff?.planting_time_reduction ?? level?.planting_time_reduction ?? 0);
    const growth = getPlantGrowTime(getPlantBySeedId(YISHU_SEED_ID)?.id);
    const matureAt = estimateYishuMaturity(now, growth, reduction);
    const deadline = yishuPlantDeadline(now, end);
    return {
        landId: Number(land.id), reduction, matureAt, deadline,
        eligible: end > now && matureAt !== null && matureAt < deadline,
    };
}
