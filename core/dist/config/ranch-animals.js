"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cubMap = exports.animalMap = void 0;
exports.getAnimalRequiredLevel = getAnimalRequiredLevel;
const MCAnimalConfig_json_1 = __importDefault(require("../gameConfig/ranch/MCAnimalConfig.json"));
const MCAnimalMutation_json_1 = __importDefault(require("../gameConfig/ranch/MCAnimalMutation.json"));
const Goods_json_1 = __importDefault(require("../gameConfig/Goods.json"));
function getAnimalRequiredLevel(cubItemId) {
    const levels = Goods_json_1.default.filter(row => row.shop_id === 5 && row.item_id === cubItemId)
        .map(row => row.conds?.match(/:(\d+)$/)?.[1]).filter(Boolean).map(Number);
    return levels.length ? Math.min(...levels) : null;
}
exports.animalMap = new Map(MCAnimalConfig_json_1.default.map(row => [row.id, row]));
exports.cubMap = new Map([
    ...MCAnimalConfig_json_1.default.map(row => [row.cub_item_id, { ...row, giantCubItemId: 0 }]),
    ...MCAnimalMutation_json_1.default.map(row => [row.giant_cub_item_id, { ...exports.animalMap.get(row.animal_id), giantCubItemId: row.giant_cub_item_id }]),
]);
//# sourceMappingURL=ranch-animals.js.map