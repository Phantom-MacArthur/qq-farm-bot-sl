"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateYishuLand = estimateYishuLand;
const LandLevel_json_1 = __importDefault(require("../../gameConfig/LandLevel.json"));
const yishuhuanfu_1 = require("../../config/yishuhuanfu");
const { getPlantBySeedId, getPlantGrowTime } = require('../../config/gameConfig');
function estimateYishuLand(land, now, end) {
    const level = LandLevel_json_1.default.find(item => Number(item.id) === Number(land.level));
    const reduction = Number(land.buff?.planting_time_reduction ?? level?.planting_time_reduction ?? 0);
    const growth = getPlantGrowTime(getPlantBySeedId(yishuhuanfu_1.YISHU_SEED_ID)?.id);
    const matureAt = (0, yishuhuanfu_1.estimateYishuMaturity)(now, growth, reduction);
    const deadline = (0, yishuhuanfu_1.yishuPlantDeadline)(now, end);
    return {
        landId: Number(land.id), reduction, matureAt, deadline,
        eligible: end > now && matureAt !== null && matureAt < deadline,
    };
}
//# sourceMappingURL=yishuhuanfu-plan.js.map