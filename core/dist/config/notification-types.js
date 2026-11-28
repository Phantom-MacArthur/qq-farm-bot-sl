"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FARM_ACTIVITY_LABELS = void 0;
exports.normalizeFarmActivityEvents = normalizeFarmActivityEvents;
exports.normalizeNotificationTypes = normalizeNotificationTypes;
exports.FARM_ACTIVITY_LABELS = {
    cropHarvest: '收获作物',
    animalHarvest: '收获动物',
    sale: '出售成功',
    reward: '领取奖励',
};
function normalizeFarmActivityEvents(input) {
    const events = Object.keys(exports.FARM_ACTIVITY_LABELS);
    return Array.isArray(input) ? events.filter(event => input.includes(event)) : events;
}
// 旧配置只在账号内选择商人提醒，全局默认放行以保留原有选择。
function normalizeNotificationTypes(input) {
    return {
        offline: input?.offline !== false,
        mysteryArrival: input?.mysteryArrival !== false,
        mysteryPurchase: input?.mysteryPurchase !== false,
        farmActivity: input?.farmActivity === true,
    };
}
//# sourceMappingURL=notification-types.js.map