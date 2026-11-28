import type { AutomationConfig } from '../types/config';
import {
    getYishuAutomationWindow, isYishuAutomationInWindow, isYishuSaleTime, latestYishuSellSlot, normalizeYishuMinPrice,
    YISHU_SCAN_LIMIT, YISHU_SCAN_MINUTES, YISHU_SELL_CUTOFF, yishuDate, yishuDayStart, yishuSellMinutes, yishuSellMode,
} from '../config/yishuhuanfu';
import { appendYishuHistory, readYishuHistory } from './yishuhuanfu-history';
import { getDailyMark } from './daily-completion';

const YISHU_DAILY_ACTION_KEYS = [
    'yishu_claim_seed', 'yishu_share',
    'yishu_claim_commission', 'yishu_plant', 'yishu_harvest',
] as const;
export const YISHU_AUTOMATION_KEYS = [
    ...YISHU_DAILY_ACTION_KEYS, 'yishu_auto_sell', 'yishu_sell_mode',
    'yishu_sell_after_time', 'yishu_scan_friend_limit', 'yishu_scan_interval_minutes',
] as const;

type Settings = Partial<AutomationConfig>;
type Round = { plannedAt: number; source: 'scheduled' | 'reconnect' | 'settlement'; slot?: number };
type Quote = { gid: string; name?: string; own?: boolean; sharedToday?: boolean; canSell?: boolean | null; totalPrice: string; quota: string; quotedAt?: number; quotePending?: boolean };
interface RoundSummary extends Round {
    type: 'round';
    status: string;
    reason: string;
    minPrice: number;
    mode?: string;
    ownPrice?: string;
    ownPriceConfirmed?: boolean;
    remaining: string | null;
    luckCoin?: string | null;
    actions: Array<{ key: string; message: string; error?: boolean }>;
    trades: any[];
    scan?: any;
    rechecked?: number;
    recheckFailed?: number;
    candidates?: Quote[];
}
const SKIP_SALE_CODES = new Set([
    'YSHF_SHOP_QUOTA_INSUFFICIENT', 'YSHF_SHOP_UNKNOWN', 'YSHF_SHOP_CLOSED', 'YSHF_PRICE_TOO_LOW',
    'YSHF_SHOP_SHARE_EXPIRED',
]);
const TASK = 'yishu_next';
const QUOTE_TASK = 'yishu_quotes';
const SELL_SPACING_MS = 1200;

export function isYishuAutomationEnabled(automation: Settings = {}): boolean {
    if (automation.activity_enabled === false) return false;
    return isBackgroundQuoteEnabled(automation)
        || YISHU_DAILY_ACTION_KEYS.some(key => automation[key] === true);
}

function isBackgroundQuoteEnabled(automation: Settings): boolean {
    const mode = yishuSellMode(automation);
    return automation.activity_enabled !== false && (mode === 'scan' || mode === 'auto');
}

export function nextYishuCheck(seconds: number, scanMinutes = YISHU_SCAN_MINUTES, sellAfterTime?: string): number {
    const start = yishuDayStart(seconds);
    const scan = Math.min(720, Math.max(5, Number(scanMinutes) || YISHU_SCAN_MINUTES));
    const nextGrid = (minutes: number) => {
        const interval = minutes * 60;
        return start + (Math.floor((seconds - start) / interval) + 1) * interval;
    };
    const sale = [...yishuSellMinutes(sellAfterTime), YISHU_SELL_CUTOFF].map(minute => start + minute * 60).find(at => at > seconds);
    return Math.min(nextGrid(YISHU_SCAN_MINUTES), nextGrid(scan), sale ?? Infinity);
}

function quoteSort(a: Quote, b: Quote): number {
    const price = BigInt(b.totalPrice) - BigInt(a.totalPrice);
    const delta = price || BigInt(Number(!!b.own) - Number(!!a.own)) || BigInt(b.quota) - BigInt(a.quota);
    return delta === 0n ? 0 : delta > 0n ? 1 : -1;
}

function eligibleQuote(quote: Quote, minPrice: number): boolean {
    const price = BigInt(quote.totalPrice);
    return !quote.quotePending && (quote.own || (quote.canSell !== false && BigInt(quote.quota) > 0n))
        && price > 0n && price >= BigInt(minPrice);
}

export function createYishuAutomation(deps: {
    getActivity: (options?: any) => Promise<any>;
    claimSeed: (options?: any) => Promise<any>;
    shareShop: (options?: any) => Promise<any>;
    claimCommission: (options?: any) => Promise<any>;
    getFriendQuotes: () => any;
    queryShop: (gid: string) => Promise<any>;
    sell: (gid: string, count: string, options?: any) => Promise<any>;
    harvest: () => Promise<number>;
    maintainFarm?: () => Promise<{ planted: number; harvested: number }>;
    getServerTimeSec: () => number;
    getDailyStatus?: (key: 'yishu_claim_seed' | 'yishu_share') => 'completed' | 'pending_confirmation' | undefined;
    log: (module: string, message: string, meta?: any) => void;
    delay?: (ms: number) => Promise<void>;
}) {
    const delay = deps.delay || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
    const dailyStatus = deps.getDailyStatus || (key => getDailyMark(key)?.status);

    async function runYishuAutomation(automation: Settings, live: () => Settings, round: Round) {
        const summary: RoundSummary = {
            type: 'round', ...round, status: 'skip', reason: '', minPrice: normalizeYishuMinPrice(automation.yishu_sell_min_price),
            actions: [], trades: [], remaining: null,
        };
        const mode = yishuSellMode(automation);
        summary.mode = mode;
        const today = yishuDate(deps.getServerTimeSec());
        const stillToday = () => yishuDate(deps.getServerTimeSec()) === today;
        const enabled = (key: keyof AutomationConfig) => stillToday() && live()[key] === true;
        const saleEnabled = () => stillToday() && live().activity_enabled !== false && yishuSellMode(live()) === 'auto';
        const getMinPrice = () => normalizeYishuMinPrice(live().yishu_sell_min_price);
        const getSellAfterTime = () => live().yishu_sell_after_time;
        const canTrade = () => round.slot !== undefined && stillToday() && isYishuSaleTime(deps.getServerTimeSec(), round.slot, getSellAfterTime());
        const finish = (reason: string, status = 'skip') => ({ ...summary, reason, status });
        if (!isYishuAutomationEnabled(automation)) return finish('活动自动化已关闭');
        if (!isBackgroundQuoteEnabled(automation) && round.source !== 'settlement'
            && !enabled('yishu_claim_commission') && !enabled('yishu_plant') && !enabled('yishu_harvest')
            && (!enabled('yishu_claim_seed') || dailyStatus('yishu_claim_seed') === 'completed')
            && (!enabled('yishu_share') || dailyStatus('yishu_share') === 'completed')) {
            return finish('今日领种和分享已完成');
        }

        try {
            let snapshot = await deps.getActivity({ freshBalances: true, balanceRetries: 1, balanceStaleMaxMs: 0 });
            if (!snapshot?.active || !stillToday()) return finish('活动未开放，或已跨日');
            let changed = false;
            const activeEnd = Number(snapshot.endTime);
            const activityReady = () => stillToday() && (!(activeEnd > 0) || deps.getServerTimeSec() < activeEnd);

            async function action(
                key: 'yishu_claim_seed' | 'yishu_share' | 'yishu_claim_commission',
                needed: boolean,
                execute: () => Promise<any>,
                description: (result: any) => string,
            ) {
                if (!needed || !enabled(key) || !activityReady()) return;
                if (changed) await delay(SELL_SPACING_MS);
                if (!enabled(key) || !activityReady()) return;
                try {
                    const result = await execute();
                    changed = true;
                    const message = description(result);
                    summary.actions.push({ key, message });
                    deps.log('活动', message, { module: 'activity', event: '以薯换福自动', result: 'success' });
                } catch (error: any) {
                    summary.actions.push({ key, message: String(error?.message || error), error: true });
                }
            }

            if (round.source !== 'settlement') {
                await action('yishu_claim_seed', !snapshot.daily?.seedClaimed && !dailyStatus('yishu_claim_seed'), () => deps.claimSeed({ withSnapshot: false }),
                    result => '领取红薯种子 ' + result.count + ' 个');
                await action('yishu_share', !snapshot.daily?.shared && !dailyStatus('yishu_share'), () => deps.shareShop({ withSnapshot: false }),
                    result => result.shareReported ? '已上报分享，等待服务端确认暴击' : (result.shareReportError || '请在游戏里分享铺子'));
                await action('yishu_claim_commission', snapshot.commission?.claimable === true, () => deps.claimCommission({ withSnapshot: false }),
                    result => '领取收购提成 ' + result.amount + ' 福气币');
                const lastSaleMinute = yishuSellMinutes(getSellAfterTime()).at(-1)!;
                if (canTrade() && round.slot === yishuDayStart(round.plannedAt) + lastSaleMinute * 60 && enabled('yishu_harvest')) {
                    const count = await deps.harvest();
                    changed = true;
                    if (count) {
                        summary.actions.push({ key: 'yishu_harvest', message: '先收获 ' + count + ' 块成熟红薯' });
                    }
                }
                if (activityReady() && deps.maintainFarm && (enabled('yishu_plant') || enabled('yishu_harvest'))) {
                    const { planted, harvested } = await deps.maintainFarm();
                    if (planted || harvested) {
                        changed = true;
                        summary.actions.push({ key: 'farm', message: '种植 ' + planted + ' 块，收获 ' + harvested + ' 块红薯' });
                    }
                }
                if (changed && activityReady()) snapshot = await deps.getActivity({ freshBalances: true, balanceRetries: 1, balanceStaleMaxMs: 0 });
            }

            const ownPrice = BigInt(snapshot.shop?.estimatedPrice || '0');
            const balance = snapshot.sweetPotato;
            let remaining = balance?.balanceKnown !== false && !snapshot.balanceStale && balance?.balance != null
                ? BigInt(balance.balance) : null;
            summary.ownPrice = ownPrice.toString();
            summary.remaining = remaining?.toString() ?? null;
            summary.luckCoin = snapshot.luckCoin?.balanceKnown !== false ? snapshot.luckCoin?.balance ?? null : null;
            summary.ownPriceConfirmed = snapshot.daily?.sharedToday === true || BigInt(snapshot.shop?.bonus || '0') > 0n;
            if (!snapshot.active || !activityReady()) return finish('活动未开放，或已跨日');
            if (round.source === 'settlement') return finish('已停发新订单，等待游戏日终结算', 'settlement');
            if (mode === 'off' || mode === 'manual') return finish('自动卖薯已关闭');
            if (!isBackgroundQuoteEnabled(live())) return finish('本轮已暂停', 'interrupted');
            summary.scan = deps.getFriendQuotes();
            if (mode === 'scan') return finish('后台持续比价', 'scanned');
            if (!canTrade()) return finish('等待自动卖薯轮次', 'scanned');
            if (remaining === null) return finish('蜜薯库存未确认');
            if (remaining < BigInt(automation.yishu_sell_min_count || 1)) return finish('蜜薯库存未达到起卖数量');
            const quotes: Quote[] = (summary.scan?.shops || []).map((shop: Quote) => ({ ...shop }));
            if (!quotes.length) return finish('等待后台取得好友报价', 'idle');
            summary.candidates = quotes.sort(quoteSort);
            summary.minPrice = getMinPrice();
            const eligible = quotes.filter(quote => eligibleQuote(quote, summary.minPrice));
            if (!eligible.length) return finish(`没有达到最低报价 ${summary.minPrice} 且有额度的铺子`);

            const retried = new Set<string>();
            while (eligible.length > 0 && remaining > 0n && canTrade() && activityReady() && saleEnabled()) {
                if (summary.trades.length) await delay(SELL_SPACING_MS);
                if (!canTrade() || !activityReady() || !saleEnabled()) break;
                const quote = eligible.shift()!;
                if (!eligibleQuote(quote, getMinPrice())) continue;
                const quota = quote.own ? remaining : BigInt(quote.quota);
                const count = quota < remaining ? quota : remaining;
                try {
                    const receipt = await deps.sell(quote.gid, count.toString(), {
                        withSnapshot: false,
                        expectedPrice: quote.totalPrice,
                        auto: {
                            slot: round.slot,
                            isEnabled: saleEnabled,
                            getMinPrice,
                            getSellAfterTime,
                        },
                    });
                    summary.trades.push(receipt);
                    remaining -= BigInt(receipt.count);
                    summary.remaining = remaining.toString();
                    quote.quota = (quota - BigInt(receipt.count)).toString();
                    deps.log('活动', receipt.message || '自动卖薯成交', { module: 'activity', event: '以薯换福自动', result: 'success' });
                } catch (error: any) {
                    if (['YSHF_QUOTE_CHANGED', 'YSHF_SHOP_QUOTA_INSUFFICIENT'].includes(error.code) && !retried.has(quote.gid)) {
                        retried.add(quote.gid);
                        try {
                            const updated = await deps.queryShop(quote.gid);
                            if (String(updated?.shop?.gid) === quote.gid) {
                                Object.assign(quote, updated, { name: updated.shop.name || quote.name, quotePending: false });
                                if (eligibleQuote(quote, getMinPrice())) {
                                    eligible.push(quote);
                                    eligible.sort(quoteSort);
                                }
                            }
                        } catch { /* 该铺子报价暂不可用，继续下一家。 */ }
                        continue;
                    }
                    if (SKIP_SALE_CODES.has(error.code) || error.code === 'YSHF_QUOTE_CHANGED') continue;
                    if (error.code === 'YSHF_ORDER_PENDING' || error.code === 'YSHF_RESULT_UNKNOWN') {
                        return finish(error.message || '出售结果待核对', 'pending');
                    }
                    if (error.code === 'YSHF_SELL_WINDOW_CLOSED' || error.code === 'GAME_OFFLINE') {
                        return finish(error.message || '本轮已中断', 'interrupted');
                    }
                    throw error;
                }
            }
            if (!canTrade() || !saleEnabled()) return finish('本轮已中断，已成交记录可查', 'interrupted');
            return finish(remaining === 0n ? '本轮蜜薯已售完' : '剩余蜜薯等待下一轮或日终结算',
                summary.trades.length ? 'sold' : 'skip');
        } catch (error: any) {
            return finish(String(error?.message || error), 'error');
        }
    }

    return { runYishuAutomation };
}
let runner: ReturnType<typeof createYishuAutomation> | undefined;
let inFlight = false;
let watchdog: ReturnType<typeof setInterval> | undefined;

export function stopYishuWatchdog(): void {
    if (watchdog) clearInterval(watchdog);
    watchdog = undefined;
}

async function runYishuTick(isReady: () => boolean, plannedAt: number, source: Round['source']): Promise<void> {
    if (inFlight) return;
    const { getAutomation } = require('../models/store');
    const { getServerTimeSec, log, logWarn } = require('../utils/utils');
    const { runExclusiveAutomationTask } = require('./automation-lock');
    const now = getServerTimeSec();
    if (!isYishuAutomationInWindow(now) || !isYishuAutomationEnabled(getAutomation())) return;
    const slot = latestYishuSellSlot(now, getAutomation().yishu_sell_after_time);
    const accountId = process.env.FARM_ACCOUNT_ID || '';
    if (!isReady()) {
        if (slot === plannedAt) appendYishuHistory(accountId, now, {
            type: 'round', plannedAt, slot, source, status: 'offline', reason: '账号未在线',
        });
        return;
    }
    inFlight = true;
    try {
        await runExclusiveAutomationTask('yishuhuanfu', async () => {
            if (!isReady() || !isYishuAutomationEnabled(getAutomation())) return;
            const seconds = getServerTimeSec();
            if (!isYishuAutomationInWindow(seconds)) return;
            const sellAfterTime = getAutomation().yishu_sell_after_time;
            const history = readYishuHistory(accountId);
            const done = history.some(entry => entry.type === 'round' && entry.slot === slot
                && ['sold', 'skip', 'pending'].includes(entry.status || ''));
            const closeToNext = source === 'reconnect'
                && yishuSellMinutes(sellAfterTime).some(minute => {
                    const until = yishuDayStart(seconds) + minute * 60 - seconds;
                    return until > 0 && until <= 60;
                });
            const slotToRun = !done && !closeToNext && source !== 'settlement' && slot !== undefined
                && isYishuSaleTime(seconds, slot, sellAfterTime) && (source === 'reconnect' || plannedAt === slot) ? slot : undefined;
            if (!runner) {
                const activity = require('./activity-center');
                runner = createYishuAutomation({
                    getActivity: activity.getCurrentYishuHuanfuActivity,
                    claimSeed: activity.claimYishuHuanfuSeeds,
                    shareShop: activity.shareYishuHuanfuShop,
                    claimCommission: activity.claimYishuHuanfuCommission,
                    getFriendQuotes: activity.scanYishuHuanfuFriendShops,
                    queryShop: activity.queryYishuHuanfuShop,
                    sell: activity.sellYishuHuanfuSweetPotato,
                    harvest: () => require('./farm/scheduler').harvestYishuMatureLands(),
                    maintainFarm: async () => {
                        if (getAutomation()?.farm) return { planted: 0, harvested: 0 };
                        const farm = require('./farm/scheduler');
                        const harvested = await farm.harvestYishuMatureLands();
                        return { harvested, planted: await farm.plantYishuWhenFarmPaused() };
                    },
                    getServerTimeSec, log,
                });
            }
            const result = await runner.runYishuAutomation(getAutomation(),
                () => isReady() ? getAutomation() : { activity_enabled: false, yishu_sell_mode: 'off' },
                { plannedAt, slot: slotToRun, source });
            appendYishuHistory(accountId, seconds, { ...result, type: 'round' });
            if (result.status === 'error' || result.status === 'pending' || result.reason === '蜜薯库存未确认') {
                logWarn('系统', `以薯换福自动任务：${result.reason}`, { module: 'system', event: '以薯换福自动', result: result.status });
            }
            const day = yishuDate(seconds);
            if (result.status === 'settlement') {
                appendYishuHistory(accountId, seconds, {
                    type: 'settlement', status: 'estimate', count: result.remaining, ownPrice: result.ownPrice,
                    beforeCoins: result.luckCoin, priceConfirmed: result.ownPriceConfirmed,
                    estimated: result.remaining != null ? (BigInt(result.remaining) * BigInt(result.ownPrice)).toString() : null,
                });
            } else if (result.luckCoin != null) {
                const previous = history.filter(entry => entry.type === 'settlement' && entry.status === 'estimate' && entry.day < day).at(-1);
                if (previous && !history.some(entry => entry.type === 'settlement' && entry.settlementDay === previous.day)) {
                    appendYishuHistory(accountId, seconds, {
                        type: 'settlement', status: 'unverified', settlementDay: previous.day,
                        count: previous.count, ownPrice: previous.ownPrice, estimated: previous.estimated,
                        beforeCoins: previous.beforeCoins, afterCoins: result.luckCoin,
                        reason: '服务端没有独立的结算回执，变化待核对',
                    });
                }
            }
        });
    } catch (error: any) {
        log('活动', '以薯换福执行失败：' + String(error?.message || error), { module: 'activity', result: 'error' });
    } finally {
        inFlight = false;
    }
}

export function startYishuTimer(scheduler: any, isReady: () => boolean): void {
    if (!isReady()) return;
    const { getServerTimeSec, logWarn } = require('../utils/utils');
    const { getAutomation } = require('../models/store');
    const { isAutomationTaskRunning, runExclusiveAutomationTask } = require('./automation-lock');
    const canQuery = () => isReady() && isYishuAutomationInWindow(getServerTimeSec());

    function nextScheduledCheck(now: number): number | undefined {
        const automation = getAutomation();
        if (!isYishuAutomationEnabled(automation)) return;
        const { start, end } = getYishuAutomationWindow();
        if (now >= end) return;
        const interval = isBackgroundQuoteEnabled(automation) ? automation.yishu_scan_interval_minutes : YISHU_SCAN_MINUTES;
        const next = now < start ? start : nextYishuCheck(now, interval, automation.yishu_sell_after_time);
        return next < end ? next : undefined;
    }

    watchdog ??= setInterval(() => {
        if (!canQuery()) return;
        const scheduledCheckMissing = !scheduler.has(TASK) && nextScheduledCheck(getServerTimeSec()) !== undefined;
        if (scheduler.has(QUOTE_TASK) && !scheduledCheckMissing) return;
        startYishuTimer(scheduler, isReady);
        logWarn('系统', '以薯换福自动任务定时器丢失，已重新注册', { module: 'system', event: '以薯换福自动', result: 'recovered' });
    }, 60_000);
    watchdog.unref?.();
    if (!scheduler.has(QUOTE_TASK)) scheduler.setIntervalTask(QUOTE_TASK, 1000, async () => {
        if (!canQuery() || isAutomationTaskRunning()) return;
        const { yishu_scan_friend_limit, yishu_scan_interval_minutes } = getAutomation();
        await runExclusiveAutomationTask('yishu_friend_quote', () =>
            require('./activity-center').tickYishuHuanfuFriendShops({
                limit: Math.max(1, Math.min(YISHU_SCAN_LIMIT, Number(yishu_scan_friend_limit) || YISHU_SCAN_LIMIT)),
                intervalMs: 60_000 * Math.max(5, Number(yishu_scan_interval_minutes) || YISHU_SCAN_MINUTES),
                enabled: () => isBackgroundQuoteEnabled(getAutomation()),
                manualEnabled: () => yishuSellMode(getAutomation()) !== 'off',
                ready: canQuery,
            }));
    }, { preventOverlap: true });
    if (!isYishuAutomationEnabled(getAutomation())) {
        scheduler.clear(TASK);
        scheduler.clear('yishu_start');
        return;
    }
    const resume = !scheduler.has(TASK);

    function schedule() {
        const now = getServerTimeSec();
        const next = nextScheduledCheck(now);
        if (next === undefined) return;
        scheduler.setTimeoutTask(TASK, Math.max(1, (next - now) * 1000), () => {
            schedule();
            const settlement = next === yishuDayStart(next) + YISHU_SELL_CUTOFF * 60;
            return runYishuTick(isReady, next, settlement ? 'settlement' : 'scheduled');
        });
    }

    schedule();
    const now = getServerTimeSec();
    if (resume && isYishuAutomationInWindow(now)) {
        scheduler.setTimeoutTask('yishu_start', 1000, () => runYishuTick(isReady, now, 'reconnect'));
    }
}
