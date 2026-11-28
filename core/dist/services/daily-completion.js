"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.beginDailyCheck = beginDailyCheck;
exports.getDailyMark = getDailyMark;
exports.isDailyComplete = isDailyComplete;
exports.recordDailyMark = recordDailyMark;
exports.getDailyCompletionSnapshot = getDailyCompletionSnapshot;
const node_crypto_1 = require("node:crypto");
const DAILY = ['farm_daily_share', 'farm_free_gifts', 'farm_month_card_gift', 'farm_vip_gift', 'ranch_share', 'ranch_daily_benefit'];
const ACTIVITY = ['yishu_claim_seed', 'yishu_share'];
const cache = new Map();
function useGameDate(action) {
    return action === 'ranch_share' || action === 'ranch_daily_benefit' || action === 'yishu_claim_seed' || action === 'yishu_share';
}
function context(action) {
    const accountId = process.env.FARM_ACCOUNT_ID;
    if (!accountId)
        return null;
    const clock = require('../utils/utils');
    const sample = clock.getServerClockSample?.();
    if (!sample || !Number.isFinite(sample.ms) || !Number.isFinite(sample.nowMs))
        return null;
    const format = (ms) => useGameDate(action)
        ? clock.formatDateKeyInTimeZone(ms, 'Asia/Shanghai')
        : clock.getSystemDateKey(ms);
    const dateKey = format(sample.nowMs);
    if (!dateKey || format(sample.ms) !== dateKey)
        return null;
    const gid = String(require('../utils/network').getUserState?.()?.gid ?? '');
    if (!/^[1-9]\d*$/.test(gid))
        return null;
    const platform = require('../config/config').CONFIG.platform;
    const id = (0, node_crypto_1.createHash)('sha256').update(JSON.stringify([accountId, platform, gid])).digest('hex');
    const file = require('../config/runtime-paths').getDataFile(`daily-completion/${id}.json`);
    return { file, dateKey };
}
function load(file) {
    const existing = cache.get(file);
    if (existing)
        return existing;
    const stored = require('./json-db').readJsonFile(file);
    const ledger = stored?.version === 1 && stored.operations && typeof stored.operations === 'object'
        ? stored : { version: 1, operations: {} };
    cache.set(file, ledger);
    return ledger;
}
function applicableMark(mark) {
    return mark && ['completed', 'pending_confirmation'].includes(mark.status) && Number.isFinite(mark.at) ? mark : undefined;
}
function beginDailyCheck(action) {
    const scope = context(action);
    return scope && { ...scope, action };
}
function getDailyMark(action, item) {
    const scope = context(action);
    if (!scope)
        return undefined;
    const row = load(scope.file).operations[action];
    if (row?.dateKey !== scope.dateKey)
        return undefined;
    return applicableMark(item === undefined ? row.mark : row.items?.[item]);
}
function isDailyComplete(action, item) {
    return getDailyMark(action, item)?.status === 'completed';
}
function recordDailyMark(ticket, status, { item, count } = {}) {
    if (!ticket)
        return;
    const scope = context(ticket.action);
    if (scope?.file !== ticket.file || scope.dateKey !== ticket.dateKey)
        return;
    const ledger = load(ticket.file);
    const saved = ledger.operations[ticket.action];
    const row = saved?.dateKey === ticket.dateKey ? saved : { dateKey: ticket.dateKey };
    const previous = applicableMark(item === undefined ? row.mark : row.items?.[item]);
    if ((status === 'clear_pending' && previous?.status !== 'pending_confirmation')
        || (previous?.status === 'completed' && status !== 'completed'))
        return;
    const nextCount = count ?? previous?.count;
    if (previous?.status === status && previous?.count === nextCount)
        return;
    const mark = status === 'clear_pending' ? undefined : { status, at: Date.now(), ...(nextCount !== undefined ? { count: nextCount } : {}) };
    if (item === undefined)
        row.mark = mark;
    else if (mark)
        row.items = { ...row.items, [item]: mark };
    else if (row.items)
        delete row.items[item];
    ledger.operations[ticket.action] = row;
    try {
        require('./json-db').writeJsonFileAtomic(ticket.file, ledger, 0);
    }
    catch (error) {
        require('../utils/utils').logWarn?.('系统', `保存每日完成状态失败：${error.message}`);
    }
}
function getDailyCompletionSnapshot() {
    const snapshots = new Map();
    function section(actions) {
        return Object.fromEntries(actions.map(action => {
            const scope = context(action);
            if (scope && !snapshots.has(scope.file))
                snapshots.set(scope.file, load(scope.file));
            const saved = scope && snapshots.get(scope.file)?.operations[action];
            const row = saved && saved.dateKey === scope?.dateKey ? saved : null;
            const mark = applicableMark(row?.mark);
            const items = Object.fromEntries(Object.entries(row?.items ?? {}).filter(([, value]) => applicableMark(value)));
            return [action, { dateKey: scope?.dateKey ?? null, status: mark?.status ?? 'unknown', at: mark?.at ?? null,
                    ...(mark?.count !== undefined ? { count: mark.count } : {}), items }];
        }));
    }
    return { daily: section(DAILY), activity: section(ACTIVITY) };
}
//# sourceMappingURL=daily-completion.js.map