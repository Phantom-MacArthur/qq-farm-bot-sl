"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * 奖励物品展示信息：把协议里的 corepb.Item 列表补齐名称与图标，供面板直接渲染。
 */
const { getItemById, getItemImageById } = require('../config/gameConfig');
const { toNum } = require('./utils');
// 奖励里的金币/经验可能沿用旧 ID（1、2），统一到配置表 ID 才能取到名称和图标。
const REWARD_ID_ALIASES = { 1: 1001, 2: 1101 };
/** 单个列表转展示项；无效 ID 或数量为 0 的条目丢弃。 */
function describeRewardItems(list, extra = false) {
    return (Array.isArray(list) ? list : [])
        .map((r) => {
        const rawId = toNum(r && r.id);
        const id = REWARD_ID_ALIASES[rawId] || rawId;
        return { id, count: toNum(r && r.count) };
    })
        .filter((r) => r.id > 0 && r.count > 0)
        .map((r) => ({
        ...r,
        extra,
        name: getItemById(r.id)?.name || `物品${r.id}`,
        image: getItemImageById(r.id) || '',
    }));
}
/** 多份奖励按物品 ID 累加（普通与额外奖励分开），用于「每日任务」等多条任务的合计。 */
function mergeRewardItems(...lists) {
    const merged = new Map();
    for (const item of lists.flat()) {
        const key = `${item.extra ? 'x' : 'n'}:${item.id}`;
        const prev = merged.get(key);
        if (prev)
            prev.count += item.count;
        else
            merged.set(key, { ...item });
    }
    return [...merged.values()];
}
module.exports = {
    describeRewardItems,
    mergeRewardItems,
};
//# sourceMappingURL=reward-items.js.map