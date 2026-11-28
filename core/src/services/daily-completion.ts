import { createHash } from 'node:crypto';

const DAILY = ['farm_daily_share', 'farm_free_gifts', 'farm_month_card_gift', 'farm_vip_gift', 'ranch_share', 'ranch_daily_benefit'] as const;
const ACTIVITY = ['yishu_claim_seed', 'yishu_share'] as const;
export type DailyAction = typeof DAILY[number] | typeof ACTIVITY[number];
type Result = 'completed' | 'pending_confirmation';
type Mark = { status: Result; at: number; count?: string };
type DayRecord = { dateKey: string; mark?: Mark; items?: Record<string, Mark> };
type LedgerFile = { version: 1; operations: Partial<Record<DailyAction, DayRecord>> };
type Context = { file: string; dateKey: string };
type Ticket = Context & { action: DailyAction };
type Options = { item?: string; count?: string };
const cache = new Map<string, LedgerFile>();

function useGameDate(action: DailyAction): boolean {
    return action === 'ranch_share' || action === 'ranch_daily_benefit' || action === 'yishu_claim_seed' || action === 'yishu_share';
}

function context(action: DailyAction): Context | null {
    const accountId = process.env.FARM_ACCOUNT_ID;
    if (!accountId) return null;
    const clock = require('../utils/utils');
    const sample = clock.getServerClockSample?.();
    if (!sample || !Number.isFinite(sample.ms) || !Number.isFinite(sample.nowMs)) return null;
    const format = (ms: number): string => useGameDate(action)
        ? clock.formatDateKeyInTimeZone(ms, 'Asia/Shanghai')
        : clock.getSystemDateKey(ms);
    const dateKey = format(sample.nowMs);
    if (!dateKey || format(sample.ms) !== dateKey) return null;
    const gid = String(require('../utils/network').getUserState?.()?.gid ?? '');
    if (!/^[1-9]\d*$/.test(gid)) return null;
    const platform = require('../config/config').CONFIG.platform;
    const id = createHash('sha256').update(JSON.stringify([accountId, platform, gid])).digest('hex');
    const file = require('../config/runtime-paths').getDataFile(`daily-completion/${id}.json`);
    return { file, dateKey };
}

function load(file: string): LedgerFile {
    const existing = cache.get(file);
    if (existing) return existing;
    const stored = require('./json-db').readJsonFile(file);
    const ledger = stored?.version === 1 && stored.operations && typeof stored.operations === 'object'
        ? stored : { version: 1, operations: {} };
    cache.set(file, ledger);
    return ledger;
}

function applicableMark(mark: Mark | undefined): Mark | undefined {
    return mark && ['completed', 'pending_confirmation'].includes(mark.status) && Number.isFinite(mark.at) ? mark : undefined;
}

export function beginDailyCheck(action: DailyAction): Ticket | null {
    const scope = context(action);
    return scope && { ...scope, action };
}

export function getDailyMark(action: DailyAction, item?: string): Mark | undefined {
    const scope = context(action);
    if (!scope) return undefined;
    const row = load(scope.file).operations[action];
    if (row?.dateKey !== scope.dateKey) return undefined;
    return applicableMark(item === undefined ? row.mark : row.items?.[item]);
}

export function isDailyComplete(action: DailyAction, item?: string): boolean {
    return getDailyMark(action, item)?.status === 'completed';
}

export function recordDailyMark(ticket: Ticket | null, status: Result | 'clear_pending', { item, count }: Options = {}): void {
    if (!ticket) return;
    const scope = context(ticket.action);
    if (scope?.file !== ticket.file || scope.dateKey !== ticket.dateKey) return;
    const ledger = load(ticket.file);
    const saved = ledger.operations[ticket.action];
    const row = saved?.dateKey === ticket.dateKey ? saved : { dateKey: ticket.dateKey };
    const previous = applicableMark(item === undefined ? row.mark : row.items?.[item]);
    if ((status === 'clear_pending' && previous?.status !== 'pending_confirmation')
        || (previous?.status === 'completed' && status !== 'completed')) return;
    const nextCount = count ?? previous?.count;
    if (previous?.status === status && previous?.count === nextCount) return;
    const mark = status === 'clear_pending' ? undefined : { status, at: Date.now(), ...(nextCount !== undefined ? { count: nextCount } : {}) };
    if (item === undefined) row.mark = mark;
    else if (mark) row.items = { ...row.items, [item]: mark };
    else if (row.items) delete row.items[item];
    ledger.operations[ticket.action] = row;
    try { require('./json-db').writeJsonFileAtomic(ticket.file, ledger, 0); }
    catch (error: any) { require('../utils/utils').logWarn?.('系统', `保存每日完成状态失败：${error.message}`); }
}

export function getDailyCompletionSnapshot() {
    const snapshots = new Map<string, LedgerFile>();
    function section(actions: readonly DailyAction[]) {
        return Object.fromEntries(actions.map(action => {
            const scope = context(action);
            if (scope && !snapshots.has(scope.file)) snapshots.set(scope.file, load(scope.file));
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
