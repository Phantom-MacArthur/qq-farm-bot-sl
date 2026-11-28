"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFarmRewardHistory = getFarmRewardHistory;
exports.recordFarmReward = recordFarmReward;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const farm_activity_events_1 = require("./farm-activity-events");
function historyPath(accountId = process.env.FARM_ACCOUNT_ID) {
    if (!accountId)
        return null;
    const directory = process.env.FARM_DATA_DIR || node_path_1.default.join(__dirname, '../../data');
    return node_path_1.default.join(directory, 'farm-reward-history', `${Buffer.from(accountId).toString('hex')}.json`);
}
function getFarmRewardHistory(accountId) {
    const file = historyPath(accountId);
    if (!file)
        return [];
    try {
        const records = JSON.parse((0, node_fs_1.readFileSync)(file, 'utf8'));
        return Array.isArray(records) ? records.slice(0, 100) : [];
    }
    catch {
        return [];
    }
}
function recordFarmReward(key, rewards, name) {
    (0, farm_activity_events_1.emitFarmReward)(name || (key === 'daily_share' ? '每日分享礼包' : '奖励'), rewards);
    const file = historyPath();
    if (!file)
        return;
    try {
        const records = [{ id: (0, node_crypto_1.randomUUID)(), key, name, rewards, claimedAt: Date.now() }, ...getFarmRewardHistory()].slice(0, 100);
        (0, node_fs_1.mkdirSync)(node_path_1.default.dirname(file), { recursive: true });
        (0, node_fs_1.writeFileSync)(`${file}.tmp`, JSON.stringify(records), 'utf8');
        (0, node_fs_1.renameSync)(`${file}.tmp`, file);
    }
    catch (error) {
        require('../utils/utils').logWarn('农场奖励', `保存领取记录失败: ${String(error)}`);
    }
}
//# sourceMappingURL=farm-reward-history.js.map