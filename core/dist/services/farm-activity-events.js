"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.farmActivityEvents = void 0;
exports.emitFarmReward = emitFarmReward;
const node_events_1 = require("node:events");
exports.farmActivityEvents = new node_events_1.EventEmitter();
function emitFarmReward(name, rewards) {
    if (!rewards.length)
        return;
    const items = rewards.filter(item => item.name).map(item => `${item.name} ×${item.count}`);
    exports.farmActivityEvents.emit('activity', 'reward', `已领取${name}${items.length ? `：${items.join('、')}` : ''}`);
}
//# sourceMappingURL=farm-activity-events.js.map