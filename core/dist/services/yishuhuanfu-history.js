"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readYishuHistory = readYishuHistory;
exports.appendYishuHistory = appendYishuHistory;
exports.pendingYishuOrder = pendingYishuOrder;
exports.beginYishuOrder = beginYishuOrder;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const yishuhuanfu_1 = require("../config/yishuhuanfu");
const { getDataFile } = require('../config/runtime-paths');
function historyFile(accountId) {
    return getDataFile(node_path_1.default.join('yishuhuanfu', `${Buffer.from(accountId, 'utf8').toString('base64url')}.jsonl`));
}
function readYishuHistory(accountId) {
    if (!accountId)
        return [];
    let source;
    try {
        source = node_fs_1.default.readFileSync(historyFile(accountId), 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
    return source.split('\n').flatMap(line => {
        if (!line.trim())
            return [];
        try {
            return [JSON.parse(line)];
        }
        catch {
            return [];
        }
    });
}
function appendYishuHistory(accountId, seconds, entry) {
    if (!accountId)
        return;
    const file = historyFile(accountId);
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
    node_fs_1.default.appendFileSync(file, `${JSON.stringify({ ...entry, day: (0, yishuhuanfu_1.yishuDate)(seconds), at: seconds })}\n`, 'utf8');
}
function pendingYishuOrder(history) {
    const terminal = new Set(history.filter(entry => entry.type === 'sale' || entry.type === 'resolved').map(entry => entry.orderId));
    return history.filter(entry => entry.type === 'order' && !terminal.has(entry.orderId)).at(-1);
}
function beginYishuOrder(accountId, seconds, order) {
    const orderId = (0, node_crypto_1.randomUUID)();
    appendYishuHistory(accountId, seconds, { ...order, type: 'order', orderId });
    return orderId;
}
//# sourceMappingURL=yishuhuanfu-history.js.map