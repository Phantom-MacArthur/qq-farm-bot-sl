import type { RanchAutomationConfig, RanchFeedStage } from '../../config/ranch-automation';
import type { RanchFriend } from './friend-roster';
import type { FriendPatrolProgress } from './friends';
import { getRanchFriendList, refreshRanchFriendStatus } from './friend-roster';
import { inFriendQuietHours } from '../friend/visit-strategy';
import { postToMaster } from '../friend/gid-manager';
export {};

const { RANCH_SWITCH_KEYS, RANCH_MARKET_SWITCH_KEYS, RANCH_MARKET_SWITCH_BY_CURRENCY, RANCH_NEAR_HARVEST_MS, isRanchMarketEnabled } = require('../../config/ranch-automation');
const { getAutomation, getRanchFriendBlacklist, getStealDelaySeconds } = require('../../models/store');
const { inScene, isUnlocked } = require('./transport');
const { loadRaw, isPendingShed, shedAwaitingActivation, snapshot, inventory, catalog, market, readMarketRotation, balance } = require('./state');
const { animalMap, cubMap, quantity } = require('./model');
const { prepareAction, operate } = require('./actions');
const { getServerTimeSec, log, randomDelay } = require('../../utils/utils');
const { getShopGoodsById } = require('../../config/gameConfig');
const reservations = require('./operation-state');
const { getAmbientSendContext, runWithSendContext } = require('./context');
const daily = require('./daily');
const interactions = require('./friends');

let nextCheckAt = 0;
let lastCycleEndAt = 0;
let retryAt = 0;
let nextFriendIndex = 0;
let nextFriendPatrolAt = 0;
let friendVisits = 0;
let pendingFriend: { gid: string; progress: FriendPatrolProgress } | null = null;
let patrolFriends: RanchFriend[] | null = null;
let patrolStatusRefresh = { attempted: new Set<number>(), lastAt: 0, rejected: false };
const friendRetryAt = new Map<number, number>();
const deferredSteals = new Map<string, { readyAt: number; name: string }>();
let cycleStartedAt = 0;
let cycleChanged = false;
let ownRecheckUsed = false;
const completedPhases = new Set<string>();
const completedSteps = new Set<string>();
const pendingBookKinds = new Set<'normal' | 'giant'>();
let shedCheckPending = true;
let shedNotifyRevision = 0;
const PATROL_SLICE_MS = 5000;
const SCENE_REENTRY_MS = 20_000;
const FRIEND_STATUS_FRESH_MS = 10_000;
const FRIEND_ENTRY_RETRY_MS = 30 * 60_000;
const MARKET_EXCHANGES = [
    { currencyId: 7002, rewardPriority: [80012, 80011], minBalance: 3n },
    { currencyId: 1008, rewardPriority: [80013, 80012, 80011], minBalance: 1n },
].map(exchange => ({ ...exchange, key: RANCH_MARKET_SWITCH_BY_CURRENCY[exchange.currencyId] }));
type MarketRotation = { periodDay: string; roundIndex: number; startsAt: number; endsAt: number; present: boolean };
let marketCheckPending = true;
let marketRunId = 0;
let lastMarketRotation: MarketRotation | null = null;
const lastMarketBalances = new Map<number, bigint>();

function resetCycle(): void {
    completedPhases.clear();
    completedSteps.clear();
    cycleStartedAt = 0;
    cycleChanged = false;
    ownRecheckUsed = false;
}

function resetFriendCycle(): void {
    friendVisits = 0;
    pendingFriend = null;
    patrolFriends = null;
    patrolStatusRefresh = { attempted: new Set<number>(), lastAt: 0, rejected: false };
}

const FRIEND_CONTROLS = {
    stroke: 'ranch_stroke', steal: 'ranch_friend_steal', cleanFriend: 'ranch_friend_clean', putMosquito: 'ranch_friend_mosquito',
} as const;
type FriendAction = keyof typeof FRIEND_CONTROLS;
const FRIEND_ACTIONS = Object.keys(FRIEND_CONTROLS) as FriendAction[];
const FRIEND_SWITCHES: ReadonlySet<string> = new Set(Object.values(FRIEND_CONTROLS));
const enabled = (key: string) => getAutomation()[key] === true;
function logCanFeed(canLabel: string, message: string, result: 'skipped' | 'ok'): void {
    log('牧场', `${canLabel}：${message}`, {
        module: 'ranch', event: 'ranch_feed', result, accountId: process.env.FARM_ACCOUNT_ID,
    });
}
const canInteract = (action: FriendAction) => enabled(FRIEND_CONTROLS[action]) && !inFriendQuietHours() && !interactions.getInteractionQuotaResetAt(action);

function nextDeferredSteal() {
    if (!deferredSteals.size || !canInteract('steal')) return undefined;
    let next: { gid: string; readyAt: number; name: string } | undefined;
    for (const [gid, entry] of deferredSteals) {
        if (!next || entry.readyAt < next.readyAt) next = { gid, ...entry };
    }
    return next;
}

function reportFriendOutcome(outcome: any, name: string): void {
    const confirmed = outcome.status === 'confirmed';
    if (confirmed) daily.markTasksChanged();
    ownRecheckUsed = false;
    log('牧场', `${name}：${outcome.notice}`, {
        module: 'ranch', event: `ranch_${outcome.action}`, result: confirmed ? 'ok' : 'skipped',
    });
}

function wakeRanchCheck(key: string): void {
    if (enabled(key) && !cycleStartedAt && Date.now() >= retryAt) {
        nextCheckAt = Math.min(nextCheckAt, lastCycleEndAt + SCENE_REENTRY_MS);
    }
}

function noteRanchFacilities(facilities: any[]): boolean {
    if (!facilities.some(isPendingShed)) return false;
    shedNotifyRevision++;
    if (shedCheckPending) return false;
    shedCheckPending = true;
    wakeRanchCheck('ranch_activate_shed');
    return true;
}

function noteBookReward(kind: 'normal' | 'giant', available: boolean): boolean {
    if (pendingBookKinds.has(kind) === available) return false;
    if (available) {
        pendingBookKinds.add(kind);
        wakeRanchCheck('ranch_illustrated');
    } else pendingBookKinds.delete(kind);
    return true;
}

function marketRotation(raw: any): MarketRotation {
    return { periodDay: quantity(raw.period_day), roundIndex: raw.round_index, startsAt: Number(raw.shop_start_time),
        endsAt: Number(raw.shop_end_time), present: raw.present };
}

function sameMarketRound(a: Pick<MarketRotation, 'periodDay' | 'roundIndex'>, b: MarketRotation): boolean {
    return a.periodDay === b.periodDay && a.roundIndex === b.roundIndex;
}

function marketIsOpen(rotation: MarketRotation | null): rotation is MarketRotation {
    const now = getServerTimeSec();
    return !!rotation?.present && rotation.startsAt <= now && now < rotation.endsAt;
}

function requestMarketCheck(): void {
    marketCheckPending = true;
    marketRunId++;
    completedPhases.delete('market-organic');
}

function noteMarketVisit(raw: any): boolean {
    const rotation = marketRotation(raw);
    const previous = lastMarketRotation;
    if (previous && sameMarketRound(previous, rotation) && previous.present === rotation.present
        && previous.startsAt === rotation.startsAt && previous.endsAt === rotation.endsAt) return false;
    lastMarketRotation = rotation;
    if (!marketIsOpen(rotation)) {
        marketRunId++;
        return false;
    }
    requestMarketCheck();
    return true;
}
const due = (state: any) => !state.doneToday && Date.now() >= (state.nextCheckAt || 0);

function ownRoutinePending(auto: RanchAutomationConfig): boolean {
    const work = RANCH_SWITCH_KEYS.some((key: keyof RanchAutomationConfig) => !FRIEND_SWITCHES.has(key) && ![
        'ranch_task', 'ranch_illustrated', 'ranch_share', 'ranch_daily_benefit', 'ranch_coupon_gift_buy', 'ranch_activate_shed', 'ranch_grass_buy',
        'ranch_market_organic', 'ranch_friend_patrol', ...RANCH_MARKET_SWITCH_KEYS,
    ].includes(key) && auto[key]);
    return !!(cycleStartedAt || work || auto.ranch_activate_shed && shedCheckPending
        || auto.ranch_illustrated && pendingBookKinds.size > 0
        || auto.ranch_task && due(daily.getTaskRoutineState()) || auto.ranch_share && due(daily.getShareRoutineState())
        || auto.ranch_daily_benefit && due(daily.getBenefitRoutineState())
        || isRanchMarketEnabled(auto) && marketCheckPending);
}

function getRoutineState() {
    if (!isUnlocked()) return { doneToday: true, nextCheckAt: Infinity };
    const auto = getAutomation();
    const ownAt = ownRoutinePending(auto) ? nextCheckAt : Infinity;
    const enabledActions = FRIEND_ACTIONS.filter(action => auto[FRIEND_CONTROLS[action]] === true);
    const quiet = enabledActions.length > 0 && inFriendQuietHours();
    const quietRecheckAt = quiet ? (Math.floor(Date.now() / 60_000) + 1) * 60_000 : Infinity;
    const quotaDates = quiet ? [] : enabledActions.map(action => interactions.getInteractionQuotaResetAt(action));
    const friendAt = quotaDates.includes(0) ? nextFriendPatrolAt : Infinity;
    const deferredAt = nextDeferredSteal()?.readyAt ?? Infinity;
    return {
        doneToday: Math.min(ownAt, friendAt, deferredAt) === Infinity,
        nextCheckAt: Math.min(ownAt, friendAt, deferredAt, quietRecheckAt, ...quotaDates.filter(at => at > 0)),
    };
}

function selectAnimal(goods: any[], settings: RanchAutomationConfig, kind: number): any {
    const strategy = settings.ranch_strategy === 'bag_priority' ? settings.ranch_bag_fallback : settings.ranch_strategy;
    const preferred = kind === 1 ? settings.ranch_coop_animal : settings.ranch_shed_animal;
    const candidates = goods.filter(good => good.available && good.animal?.enable_flag
        && good.animal.husbandry_type === (kind === 1 ? '窝' : '棚') && good.price.id === 1007 && BigInt(good.price.count) > 0n);
    if (strategy === 'preferred') return candidates.find(good => good.animal.id === preferred);
    const level = (good: any) => Number(getShopGoodsById(Number(good.id))?.conds?.match(/:(\d+)$/)?.[1] || good.requiredLevel || 0);
    return candidates.sort((a, b) => level(b) - level(a) || b.animal.id - a.animal.id)[0];
}

type RoutineOptions = { farmDeadline?: () => number; canContinue?: () => boolean; nextFriendIntervalMs?: () => number };

function cannotContinue(options: RoutineOptions): boolean {
    return options.canContinue?.() === false || Date.now() >= (options.farmDeadline?.() ?? Infinity);
}

async function runFriendPatrol(options: RoutineOptions): Promise<void> {
    if (cannotContinue(options)) {
        nextFriendPatrolAt = Date.now() + SCENE_REENTRY_MS;
        return;
    }
    try {
        await inScene(async () => {
            const startedAt = Date.now();
            let steps = 0;
            const markStep = () => { steps++; };
            const shouldYield = (friendActed = false) => cannotContinue(options)
                || (steps > 0 || friendActed) && Date.now() >= startedAt + PATROL_SLICE_MS;
            const checkpoint = (checkDeadline = false) => {
                if (shouldYield(checkDeadline)) {
                    throw Object.assign(new Error('牧场好友巡查让路'), { code: 'RANCH_PATROL_YIELD' });
                }
            };
            if (FRIEND_ACTIONS.some(canInteract)) {
                checkpoint();
                patrolFriends ??= await getRanchFriendList(completedBatch => {
                    if (completedBatch) markStep();
                    checkpoint();
                });
                const blacklist = new Set(getRanchFriendBlacklist(process.env.FARM_ACCOUNT_ID));
                const friends = patrolFriends.filter(friend => !blacklist.has(friend.gid));
                if (!friends.length) return;
                const hasBulkWork = enabled('ranch_friend_steal') || enabled('ranch_friend_clean');
                const times = hasBulkWork ? {} : await interactions.getInteractionTimes();
                const wanted = (action: FriendAction) => canInteract(action) && times[action] !== 0;
                const statusDecides = () => !wanted('stroke') && !wanted('putMosquito');
                if (FRIEND_ACTIONS.some(wanted)) {
                    // 沿用本轮巡查，每轮最多拜访三位，避免长期占用农牧场共用连接。
                    for (let scanned = 0; scanned < friends.length && friendVisits < Math.min(3, friends.length)
                        && FRIEND_ACTIONS.some(wanted); scanned++, nextFriendIndex++) {
                        checkpoint();
                        const friend = (pendingFriend && friends.find(row => String(row.gid) === pendingFriend?.gid)) || friends[nextFriendIndex % friends.length];
                        const gid = String(friend.gid);
                        const canVisit = () => !getRanchFriendBlacklist(process.env.FARM_ACCOUNT_ID).includes(friend.gid);
                        if (!canVisit() || (friendRetryAt.get(friend.gid) ?? 0) > Date.now()) {
                            pendingFriend = null;
                            continue;
                        }
                        if (pendingFriend?.gid !== gid && statusDecides() && !patrolStatusRefresh.rejected
                            && !patrolStatusRefresh.attempted.has(friend.gid) && Date.now() - friend.statusAtMs > FRIEND_STATUS_FRESH_MS) {
                            if (Date.now() - patrolStatusRefresh.lastAt < 1000) await randomDelay(500, 1000);
                            checkpoint(true);
                            try {
                                const queried = await refreshRanchFriendStatus(friends, nextFriendIndex % friends.length);
                                for (const id of queried) patrolStatusRefresh.attempted.add(id);
                            } catch (error: any) {
                                if (error.name !== 'GatewayError') throw error;
                                patrolStatusRefresh.rejected = true;
                                log('牧场', `好友状态刷新失败，本轮进门核对：${error.message}`, { module: 'ranch', event: 'ranch_friend', result: 'skipped' });
                            }
                            patrolStatusRefresh.lastAt = Date.now();
                            markStep();
                            checkpoint();
                        }
                        if (!canVisit() || (pendingFriend?.gid !== gid && statusDecides() && Date.now() - friend.statusAtMs <= FRIEND_STATUS_FRESH_MS
                            && !(wanted('steal') && friend.canSteal) && !(wanted('cleanFriend') && friend.canHelp))) {
                            pendingFriend = null;
                            continue;
                        }
                        if (pendingFriend?.gid !== gid) pendingFriend = { gid, progress: {} };
                        try {
                            const queued = deferredSteals.get(gid);
                            const queuedReady = !!queued && queued.readyAt <= Date.now();
                            const result = await interactions.automateFriend(friend.gid,
                                action => wanted(action as FriendAction) && canVisit() && (action !== 'steal' || !queued || queuedReady),
                                shouldYield, (outcome: any, nickname: string) => reportFriendOutcome(outcome, nickname || friend.name),
                                pendingFriend.progress, queued ? 0 : getStealDelaySeconds() * 1000);
                            Object.assign(times, result.times);
                            if (result.yielded) {
                                throw Object.assign(new Error('牧场好友巡查让路'), { code: 'RANCH_PATROL_YIELD' });
                            }
                            if (result.stealReadyAt) deferredSteals.set(gid, { readyAt: result.stealReadyAt, name: friend.name });
                            else if (queuedReady) deferredSteals.delete(gid);
                            friendRetryAt.delete(friend.gid);
                            markStep();
                        } catch (error: any) {
                            if (error.name !== 'GatewayError' || error.serviceName !== 'gamepb.visitpb.VisitService'
                                || error.methodName !== 'EnterHomestead') throw error;
                            markStep();
                            friendRetryAt.set(friend.gid, Date.now() + FRIEND_ENTRY_RETRY_MS);
                            // 仅在服务端明确给出非好友原因时请求主进程持久化。
                            const nonFriend = error.code === 1002002 && /不是(?:你的)?好友|非好友|(?:没有|不存在)好友关系|\bnot (?:a |your )?friend\b/i.test(error.errorMessage);
                            if (!nonFriend || !postToMaster({ type: 'ranch_friend_blacklist_add', gid: friend.gid, friendName: friend.name })) {
                                log('牧场', `暂不能拜访 ${friend.name}：${error.message}`, { module: 'ranch', event: 'ranch_friend', result: 'skipped' });
                            }
                        }
                        pendingFriend = null;
                        friendVisits++;
                    }
                }
            }
        });
        nextFriendPatrolAt = Date.now() + (options.nextFriendIntervalMs?.() ?? 15000);
        resetFriendCycle();
    } catch (error: any) {
        nextFriendPatrolAt = Date.now() + SCENE_REENTRY_MS;
        if (error.code !== 'RANCH_PATROL_YIELD') {
            resetFriendCycle();
            if (error.code !== 'RANCH_AUTOMATION_DISABLED') {
                log('牧场', `牧场好友巡查失败：${error.message}`, { module: 'ranch', event: 'ranch_friend', result: 'error' });
            }
        }
    }
}

async function run(options: RoutineOptions = {}): Promise<void> {
    if (!isUnlocked()) return;
    const auto: RanchAutomationConfig = getAutomation();
    if (!ownRoutinePending(auto) || Date.now() < nextCheckAt) {
        const deferred = nextDeferredSteal();
        if (deferred && deferred.readyAt <= Date.now()) {
            const { gid, name } = deferred;
            const shouldYield = () => cannotContinue(options);
            const canSteal = () => !shouldYield() && canInteract('steal')
                && !getRanchFriendBlacklist(process.env.FARM_ACCOUNT_ID).includes(Number(gid));
            deferredSteals.delete(gid);
            if (shouldYield()) {
                deferredSteals.set(gid, { name, readyAt: Date.now() + SCENE_REENTRY_MS });
                return;
            }
            if (!canSteal()) return;
            try {
                const result = await interactions.automateFriend(gid, action => action === 'steal' && canSteal(), shouldYield,
                    (outcome: any, nickname: string) => reportFriendOutcome(outcome, nickname || name));
                if (result.yielded) deferredSteals.set(gid, { name, readyAt: Date.now() + SCENE_REENTRY_MS });
            } catch (error: any) {
                if (error.code !== 'RANCH_AUTOMATION_DISABLED') {
                    log('牧场', `暂不能拜访 ${name}：${error.message}`, { module: 'ranch', event: 'ranch_friend', result: 'skipped' });
                }
            }
            return;
        }
        if (Date.now() >= nextFriendPatrolAt && FRIEND_ACTIONS.some(canInteract)) await runFriendPatrol(options);
        return;
    }
    if (!cycleStartedAt) cycleStartedAt = Date.now();
    nextCheckAt = cycleStartedAt + require('../../config/ranch-automation').getRanchPatrolIntervalMs(auto);
    const shedNotifyAtStart = shedNotifyRevision;
    try {
        if (options.canContinue?.() === false || Date.now() >= (options.farmDeadline?.() ?? Infinity)) {
            nextCheckAt = Date.now() + SCENE_REENTRY_MS;
            return;
        }
        await inScene(async (cells: any) => {
            const startedAt = Date.now();
            let steps = 0;
            const markStep = (action?: string) => {
                steps++;
                if (action !== 'harvest' && action !== 'produce') ownRecheckUsed = false;
            };
            const shouldYield = (friendActed = false) => options.canContinue?.() === false
                || Date.now() >= (options.farmDeadline?.() ?? Infinity)
                || (steps > 0 || friendActed) && Date.now() >= startedAt + PATROL_SLICE_MS;
            const checkpoint = (checkDeadline = false) => {
                if (shouldYield(checkDeadline)) {
                    throw Object.assign(new Error('牧场巡查让路'), { code: 'RANCH_PATROL_YIELD' });
                }
            };
            async function phase(name: string, work: () => Promise<any>): Promise<void> {
                if (completedPhases.has(name)) return;
                await work();
                completedPhases.add(name);
            }
            checkpoint();
            let raw = await loadRaw(cells);
            const available = (id: number) => {
                const funds = balance(raw.bag, id);
                return BigInt(funds.total) - BigInt(funds.locked) - BigInt(reservations.forCurrentAccount().reserved(`item:${id}`));
            };
            let nextActionAt = Infinity;
            const updateDeadline = (reopenOwn = false) => {
                const state = snapshot(raw);
                const normalStage = auto.ranch_feed_normal && available(7003) > 0n && auto.ranch_feed_normal_stage;
                const organicStage = auto.ranch_feed_organic && available(7004) > 0n && auto.ranch_feed_organic_stage;
                const timedFeed = normalStage && normalStage !== 'any' || organicStage && organicStage !== 'any';
                const upcoming = state.facilities.flatMap((f: any) => [
                    ...(auto.ranch_harvest || auto.ranch_produce || timedFeed ? (f.ranch?.animals || []).flatMap((a: any) =>
                        [a.nextAtMs, auto.ranch_harvest ? a.deliveringUntilMs : 0]) : []),
                    auto.ranch_upgrade && f.upgradeState ? (f.upgradeEndTime < 100_000_000_000 ? f.upgradeEndTime * 1000 : f.upgradeEndTime) : 0,
                ]);
                if (normalStage === 'near_harvest' || organicStage === 'near_harvest') {
                    for (const facility of raw.cells.facilities) {
                        for (const animal of facility.ranch?.animals || []) {
                            if (animal.stage !== 4 || !animal.can_feed || (organicStage !== 'near_harvest' && animal.limited_can_used)) continue;
                            const harvestAt = Number(animal.mature_ready_at_ms);
                            if (harvestAt > state.serverTime) upcoming.push(Math.max(state.serverTime + 1000, harvestAt - RANCH_NEAR_HARVEST_MS));
                        }
                    }
                }
                const future = upcoming.filter((at: number) => at > state.serverTime);
                nextActionAt = future.length ? Date.now() + Math.min(...future) - state.serverTime : Infinity;
                for (const [action, flag] of [['harvest', 'can_harvest'], ['produce', 'can_deliver']]) {
                    const ready = raw.cells.facilities.some((f: any) => f.ranch?.animals.some((a: any) => a[flag])
                        || action === 'harvest' && f.ranch?.shelves.some((s: any) => s.can_collect));
                    if (ready && enabled(action === 'harvest' ? 'ranch_harvest' : 'ranch_produce')) {
                        if (reopenOwn && completedPhases.delete(action)) {
                            completedSteps.delete(`${action}:{"all":true}`);
                            ownRecheckUsed = true;
                        }
                        nextActionAt = Math.min(nextActionAt, Date.now());
                    }
                }
            };
            // 已完成的产出可以提前复查，随后先给本轮的其他待办一次执行机会。
            updateDeadline(!ownRecheckUsed);
            const affordable = (good: any, wanted: number) => {
                const money = available(good.price.id);
                const count = money > 0n ? money / BigInt(good.price.count) : 0n;
                return Number(count < BigInt(wanted) ? count : BigInt(wanted));
            };
            async function act(key: string, action: string, input: any = {}, currency?: number, progress?: string, expectedRewardId?: number): Promise<boolean> {
                const feedStageKey = action === 'feed'
                    ? input.bucketType === 2 ? 'ranch_feed_normal_stage' : 'ranch_feed_organic_stage'
                    : undefined;
                const feedStage: RanchFeedStage | undefined = feedStageKey ? getAutomation()[feedStageKey] : undefined;
                const canLabel = key === 'ranch_feed_organic' ? '有机罐头'
                    : key === 'ranch_feed_normal' ? (feedStage === 'longest' ? '普通罐头（仅最长阶段）' : '普通罐头') : '';
                const isEnabled = () => enabled(key) && (key !== 'ranch_grass_buy' || enabled('ranch_grass'))
                    && (!feedStageKey || getAutomation()[feedStageKey] === feedStage);
                if (!isEnabled()) return false;
                const step = `${action}:${JSON.stringify(input)}${progress === undefined ? '' : `:${progress}`}`;
                if (completedSteps.has(step)) return false;
                checkpoint(action === 'exchange');
                let label = action;
                try {
                    const quote = await prepareAction(action, input, feedStage);
                    label = quote.label;
                    if (quote.skipped || currency && quote.costItems.some((cost: any) => cost.id !== currency)
                        || expectedRewardId !== undefined && (quote.rewards.length !== 1 || Number(quote.rewards[0].id) !== expectedRewardId)) {
                        if (canLabel) logCanFeed(canLabel, quote.message || '本轮未找到喂养目标', 'skipped');
                        completedSteps.add(step);
                        markStep(action);
                        return false;
                    }
                    if (!isEnabled()) return false;
                    checkpoint(action === 'exchange');
                    const parent = getAmbientSendContext();
                    const result = await runWithSendContext({
                        check: (service: string, method: string) => parent?.check(service, method) || (isEnabled() ? null
                            : Object.assign(new Error('牧场操作设置已变化'), { code: 'RANCH_AUTOMATION_DISABLED' })),
                        onSent: (service: string, method: string) => parent?.onSent(service, method),
                    }, () => operate(action, { ...input, expected: quote.expected }, feedStage));
                    completedSteps.add(step);
                    markStep(action);
                    if (result.status === 'skipped') {
                        if (canLabel) logCanFeed(canLabel, result.notice || '动物状态已变化，本轮未喂养', 'skipped');
                        return false;
                    }
                    cycleChanged = true;
                    if (canLabel) {
                        logCanFeed(canLabel, `喂养完成，目标 ${quote.count} 只，消耗 ${result.costs[0].count} 秒，桶内剩余 ${result.bucketRemainingSeconds} 秒`, 'ok');
                    } else {
                        log('牧场', `${quote.label}${result.notice ? `：${result.notice}` : '完成'}`, { module: 'ranch', event: `ranch_${action}`, result: 'ok' });
                    }
                    raw = await loadRaw();
                    updateDeadline();
                    return true;
                } catch (error: any) {
                    // 状态或余额变化交给下一次巡查重新报价；已发出但结果未知的写入由持久账本保护。
                    const canBucketFull = action === 'useCan' && error.code === 1003002
                        && /罐头容器已(?:达到上限|满)/.test(error.errorMessage ?? error.message);
                    if (canBucketFull || ['INSUFFICIENT_BALANCE', 'RESERVE_PROTECTED', 'PENDING_CONFIRMATION', 'RANCH_OFFER_CHANGED', 'RANCH_EXCHANGE_UNAVAILABLE', 'GOODS_UNAVAILABLE', 'RANCH_STATE_CHANGED'].includes(error.code)) {
                        if (action === 'claimIllustrated' && error.code === 'RANCH_OFFER_CHANGED') pendingBookKinds.add(input.kind);
                        completedSteps.add(step);
                        markStep(action);
                        if (canLabel) logCanFeed(canLabel, `暂未执行：${error.message}`, 'skipped');
                        else log('牧场', `${label} 暂未执行：${error.message}`, { module: 'ranch', event: `ranch_${action}`, result: 'skipped' });
                        return false;
                    }
                    throw error;
                }
            }

            await phase('harvest', async () => {
                if (await act('ranch_harvest', 'harvest', { all: true })) completedPhases.delete('buy');
            });
            await phase('produce', () => act('ranch_produce', 'produce', { all: true }));
            await phase('clean', () => act('ranch_clean', 'clean'));
            await phase('sell', () => act('ranch_sell', 'sell', { all: true }));

            if (isRanchMarketEnabled(auto) && marketCheckPending) completedPhases.delete('market-organic');
            await phase('market-organic', async () => {
                if (!isRanchMarketEnabled(getAutomation())) return;
                const stockReady = MARKET_EXCHANGES.some(({ key, currencyId, minBalance }) => {
                    const stock = available(currencyId);
                    return enabled(key) && stock >= minBalance && stock > (lastMarketBalances.get(currencyId) ?? 0n);
                });
                if (!marketCheckPending && !stockReady && marketIsOpen(lastMarketRotation)) return;
                checkpoint(true);
                const runId = marketRunId;
                const rawRotation = await readMarketRotation();
                let rotation = rawRotation ? marketRotation(rawRotation) : null;
                let current = null;
                if (marketIsOpen(rotation)) {
                    checkpoint(true);
                    current = await market(raw);
                }
                if (current && marketIsOpen(rotation) && current.opened && current.present && sameMarketRound(current, rotation)) {
                    for (const { key, currencyId, rewardPriority } of MARKET_EXCHANGES) {
                        if (!enabled(key)) continue;
                        const goods = current.goods.filter((entry: any) => entry.available && Number(entry.price.id) === currencyId
                            && BigInt(entry.price.count) > 0n && rewardPriority.includes(Number(entry.reward.id)));
                        goods.sort((a: any, b: any) => rewardPriority.indexOf(Number(a.reward.id)) - rewardPriority.indexOf(Number(b.reward.id)));
                        for (const good of goods) {
                            while (enabled(key) && good.remaining !== 0 && marketIsOpen(rotation)) {
                                const stock = available(currencyId);
                                const count = affordable(good, Math.min(good.remaining ?? 2147483647, 2147483647));
                                if (count < 1) break;
                                const exchanged = await act(key, 'exchange', { goodsId: good.id, count, marketRotation: rotation },
                                    currencyId, `${runId}:${good.id}:${stock}`, Number(good.reward.id));
                                if (!exchanged) break;
                                if (good.remaining !== null) good.remaining = Math.max(0, good.remaining - count);
                            }
                        }
                    }
                } else if (current) rotation = null;
                for (const { currencyId } of MARKET_EXCHANGES) lastMarketBalances.set(currencyId, available(currencyId));
                // 旧一轮结束时保留执行期间收到的到访或到账待办。
                if (runId === marketRunId) {
                    lastMarketRotation = rotation;
                    marketCheckPending = false;
                }
            });

            if (enabled('ranch_activate_shed')) {
                const shed = shedAwaitingActivation(raw);
                if (shed) {
                    shedCheckPending = true;
                    if (await act('ranch_activate_shed', 'activateShed', { facilityId: quantity(shed.instance_id) })) shedCheckPending = false;
                } else if (shedNotifyAtStart === shedNotifyRevision) shedCheckPending = false;
            }

            await phase('upgrade', async () => {
                if (enabled('ranch_upgrade')) {
                    for (const facility of snapshot(raw).facilities) {
                        const end = facility.upgradeEndTime < 100_000_000_000 ? facility.upgradeEndTime * 1000 : facility.upgradeEndTime;
                        if (facility.active && facility.upgradeState && (facility.upgradeState === 2 || end <= getServerTimeSec() * 1000)) {
                            await act('ranch_upgrade', 'completeUpgrade', { facilityId: facility.id });
                        } else if (facility.next?.available) {
                            await act('ranch_upgrade', 'upgrade', { facilityId: facility.id }, 1007);
                        }
                    }
                }
            });

            // 成熟动物腾栏后，在补栏前核对一次。让路时保留尚未核对的图鉴。
            for (const kind of ['normal', 'giant'] as const) {
                if (!enabled('ranch_illustrated') || !pendingBookKinds.delete(kind)) continue;
                completedSteps.delete(`claimIllustrated:${JSON.stringify({ kind })}`);
                try {
                    await act('ranch_illustrated', 'claimIllustrated', { kind });
                } catch (cause: any) {
                    if (cause.outcomeUnknown || cause.code === 'RANCH_RESULT_UNKNOWN') pendingBookKinds.delete(kind);
                    else pendingBookKinds.add(kind);
                    throw cause;
                }
            }

            if (enabled('ranch_buy')) {
                if (auto.ranch_strategy === 'illustrated') {
                    // 只读普通图鉴；产物 ID 映射动物，不能将喂养或已放养当作点亮。
                    const book = await require('./book').readNormalBook();
                    if (!Array.isArray(book.list)) throw new Error('牧场普通图鉴列表无效');
                    const missingProducts = new Set(book.list.filter((entry: any) => !entry.unlocked).map((entry: any) => Number(entry.fruit_id)));
                    const pending = new Set<number>([...animalMap.values()].filter((animal: any) => missingProducts.has(animal.product_item.id)).map((animal: any) => animal.id));
                    const active = new Set<number>(raw.cells.facilities.flatMap((facility: any) => (facility.ranch?.animals || []).map((animal: any) => Number(animal.animal_id))));
                    const targets = new Set([...pending].filter(id => !active.has(id)));
                    const room = (id: string) => {
                        const ranch = raw.cells.facilities.find((facility: any) => quantity(facility.instance_id) === id)?.ranch;
                        return ranch ? Math.max(0, ranch.capacity - ranch.animal_count) : 0;
                    };
                    const pens = raw.cells.facilities.filter((facility: any) => facility.state === 1 && facility.ranch);
                    // 先用背包：同一动物即使有普通与巨大幼崽，也只放养一只。
                    for (const pen of pens) {
                        const id = quantity(pen.instance_id);
                        const kind = pen.ranch.husbandry_type === 1 ? '窝' : '棚';
                        const stock = inventory(raw).filter((item: any) => !item.locked && targets.has(item.animalId)
                            && item.husbandryType === kind && BigInt(item.count) > 0n)
                            .sort((a: any, b: any) => (a.requiredLevel ?? Infinity) - (b.requiredLevel ?? Infinity) || a.animalId - b.animalId);
                        for (const item of stock) {
                            if (!room(id)) break;
                            if (!targets.has(item.animalId) || available(item.id) <= 0n) continue;
                            targets.delete(item.animalId);
                            if (!await act('ranch_buy', 'place', { ranchId: id, itemId: item.id, count: 1 }, undefined, `illustrated:${id}:${item.animalId}`)) continue;
                        }
                    }
                    if (pens.some((pen: any) => room(quantity(pen.instance_id)) > 0)) await phase('buy', async () => {
                        checkpoint();
                        const shop = await catalog(raw, 5);
                        for (const pen of pens) {
                            const id = quantity(pen.instance_id);
                            const kind = pen.ranch.husbandry_type === 1 ? '窝' : '棚';
                            const goods = shop.goods.filter((good: any) => good.available && good.animal?.enable_flag
                                && good.animal.husbandry_type === kind && good.price.id === 1007 && BigInt(good.price.count) > 0n);
                            const candidates = goods.filter((good: any) => targets.has(good.animal.id))
                                .sort((a: any, b: any) => Number(a.requiredLevel || 0) - Number(b.requiredLevel || 0) || a.animal.id - b.animal.id);
                            for (const good of candidates) {
                                if (!room(id)) break;
                                if (!targets.has(good.animal.id) || affordable(good, Math.min(1, good.maxCount, good.remaining ?? Infinity)) < 1) continue;
                                targets.delete(good.animal.id);
                                if (!await act('ranch_buy', 'buy', { shopId: 5, goodsId: good.id, count: 1, autoPlace: true }, 1007, `illustrated:${id}:${good.animal.id}`)) continue;
                            }
                            if (!room(id)) continue;
                            if (auto.ranch_bag_fallback === 'bag_priority') {
                                const order: number[] = kind === '窝' ? auto.ranch_coop_cub_priority : auto.ranch_shed_cub_priority;
                                const rank = new Map(order.map((itemId, index) => [itemId, index]));
                                const stock = inventory(raw).filter((item: any) => !item.locked && item.animalId
                                    && item.husbandryType === kind && BigInt(item.count) > 0n)
                                    .sort((a: any, b: any) => (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length) || b.animalId - a.animalId || a.id - b.id);
                                for (const item of stock) {
                                    const count = Number(BigInt(room(id)) < available(item.id) ? BigInt(room(id)) : available(item.id));
                                    if (count > 0 && !await act('ranch_buy', 'place', { ranchId: id, itemId: item.id, count }, undefined, `illustrated-bag:${id}:${available(item.id)}:${room(id)}`)) return;
                                }
                            }
                            if (!room(id)) continue;
                            const fallback = selectAnimal(goods, {
                                ...auto, ranch_strategy: auto.ranch_bag_fallback === 'bag_priority' ? 'level' : auto.ranch_bag_fallback,
                            }, pen.ranch.husbandry_type);
                            if (!fallback) continue;
                            const count = affordable(fallback, Math.min(room(id), fallback.maxCount, fallback.remaining ?? Infinity));
                            if (count > 0) await act('ranch_buy', 'buy', { shopId: 5, goodsId: fallback.id, count, autoPlace: true }, 1007, `illustrated-fallback:${id}:${available(1007)}`);
                        }
                    });
                } else {
                const bagFirst = auto.ranch_strategy === 'bag_priority';
                const pens: any[] = raw.cells.facilities.filter((f: any) => f.state === 1 && f.ranch?.animal_count < f.ranch?.capacity);
                const vacancies = (id: string) => {
                    const ranch = raw.cells.facilities.find((f: any) => quantity(f.instance_id) === id)?.ranch;
                    return ranch ? Math.max(0, ranch.capacity - ranch.animal_count) : 0;
                };
                async function placeCubs(pen: any, animalId?: number): Promise<boolean> {
                    const ranchId = quantity(pen.instance_id);
                    const isCoop = pen.ranch.husbandry_type === 1;
                    const ordered = isCoop ? auto.ranch_coop_cub_priority : auto.ranch_shed_cub_priority;
                    const ranks = new Map(ordered.map((id, index) => [id, index]));
                    const stock = inventory(raw).filter((item: any) => !item.locked && item.animalId && BigInt(item.count) > 0n
                        && cubMap.get(item.id).husbandry_type === (isCoop ? '窝' : '棚') && (bagFirst || item.animalId === animalId));
                    stock.sort((a: any, b: any) => (bagFirst ? (ranks.get(a.id) ?? ordered.length) - (ranks.get(b.id) ?? ordered.length) : 0)
                        || b.animalId - a.animalId || a.id - b.id);
                    for (const item of stock) {
                        const room = BigInt(vacancies(ranchId));
                        if (room === 0n) break;
                        const usable = available(item.id);
                        const count = Number(room < usable ? room : usable);
                        // 库存和空位重新确认后才能续放；已有未决操作时不转去购买同一栏位。
                        if (count > 0 && !await act('ranch_buy', 'place', { ranchId, itemId: item.id, count }, undefined, `${usable}:${room}`)) return false;
                    }
                    return true;
                }

                // 续跑也按最新空位放养。先处理两种设施的背包库存，之后才读取购买备选。
                const purchasePens = [];
                for (const pen of pens) {
                    if ((!bagFirst || await placeCubs(pen)) && vacancies(quantity(pen.instance_id)) > 0) purchasePens.push(pen);
                }
                if (purchasePens.length) await phase('buy', async () => {
                    checkpoint();
                    const shop = await catalog(raw, 5);
                    for (const pen of purchasePens) {
                        const selected = selectAnimal(shop.goods, auto, pen.ranch.husbandry_type);
                        if (!selected || !bagFirst && !await placeCubs(pen, selected.animal.id)) continue;
                        const id = quantity(pen.instance_id);
                        const count = affordable(selected, Math.min(vacancies(id), selected.maxCount, selected.remaining ?? Infinity));
                        if (count > 0) await act('ranch_buy', 'buy', { shopId: 5, goodsId: selected.id, count, autoPlace: true }, 1007, `${id}:${available(1007)}`);
                    }
                });
                }
            }

            await phase('grass', async () => {
                if (enabled('ranch_grass')) {
                    for (const original of raw.cells.facilities.filter((f: any) => f.state === 1 && f.feed_machine)) {
                        const id = quantity(original.instance_id);
                        let room = original.capacity - original.feed_machine.feed_count;
                        if (room <= 0 || original.feed_machine.feed_count * 100 > original.capacity * auto.ranch_grass_threshold_percent) continue;
                        let stock = Math.max(0, Number(available(7001)));
                        if (stock < room && enabled('ranch_grass_buy')) {
                            const shop = await catalog(raw, 6);
                            const good = shop.goods.find((g: any) => g.available && g.reward.id === 7001 && g.reward.count === '1' && g.price.id === 1007 && BigInt(g.price.count) > 0n);
                            if (good) {
                                while (stock < room) {
                                    const count = affordable(good, Math.min(room - stock, good.maxCount, good.remaining ?? Infinity));
                                    // 按已到账库存区分限购批次，续跑时重新读取缺额，沿用农场到期让路。
                                    if (count <= 0 || !await act('ranch_grass_buy', 'buy', { shopId: 6, goodsId: good.id, count }, 1007, `${id}:${stock}`)) break;
                                    if (good.remaining !== null) good.remaining -= count;
                                    const current = raw.cells.facilities.find((f: any) => quantity(f.instance_id) === id);
                                    room = current.capacity - current.feed_machine.feed_count;
                                    stock = Math.max(0, Number(available(7001)));
                                }
                            }
                        }
                        const count = Math.min(room, Number(available(7001)));
                        if (count > 0) await act('ranch_grass', 'addGrass', { facilityId: id, count });
                    }
                }
            });

            await phase('cans', async () => {
                if (enabled('ranch_fill_cans')) {
                    for (const item of inventory(raw).filter((item: any) => item.can && !item.locked)) {
                        const count = Number(BigInt(item.count) < available(item.id) ? BigInt(item.count) : available(item.id));
                        if (count > 0) await act('ranch_fill_cans', 'useCan', { uid: item.uid, count });
                    }
                }
            });

            await phase('feed-normal', async () => {
                if (!enabled('ranch_feed_normal')) return;
                const normalStage = getAutomation().ranch_feed_normal_stage;
                if (available(7003) <= 0n) {
                    logCanFeed(normalStage === 'longest' ? '普通罐头（仅最长阶段）' : '普通罐头', '罐头桶没有可用时长，本轮未喂养', 'skipped');
                    return;
                }
                await act('ranch_feed_normal', 'feed', { all: true, bucketType: 2 });
            });
            await phase('feed-organic', async () => {
                if (!enabled('ranch_feed_organic')) return;
                if (available(7004) <= 0n) {
                    logCanFeed('有机罐头', '罐头桶没有可用时长，本轮未喂养', 'skipped');
                    return;
                }
                await act('ranch_feed_organic', 'feed', { all: true, bucketType: 1 });
            });

            async function claimDailyRewards(): Promise<void> {
                if (cycleChanged && !completedPhases.has('tasks')) daily.markTasksChanged();
                await phase('tasks', async () => { if (enabled('ranch_task') && due(daily.getTaskRoutineState())) { checkpoint(); await daily.claimTasks(); markStep(); } });
                await phase('share', async () => { if (enabled('ranch_share') && due(daily.getShareRoutineState())) { checkpoint(); await daily.claimShare(); markStep(); } });
                await phase('benefit', async () => { if (enabled('ranch_daily_benefit') && due(daily.getBenefitRoutineState())) { checkpoint(); await daily.claimBenefit(); markStep(); } });
            }
            await claimDailyRewards();
            lastCycleEndAt = Date.now();
            const bookDue = enabled('ranch_illustrated') && pendingBookKinds.size > 0;
            const shedDue = enabled('ranch_activate_shed') && shedCheckPending && shedNotifyAtStart !== shedNotifyRevision;
            const nextRoutine = Math.min(nextCheckAt, nextActionAt, cycleChanged ? lastCycleEndAt + 30_000 : Infinity);
            nextCheckAt = Math.max(lastCycleEndAt + SCENE_REENTRY_MS, bookDue || shedDue ? lastCycleEndAt : nextRoutine);
            retryAt = 0;
            resetCycle();
        });
    } catch (error: any) {
        if (error.code === 'RANCH_PATROL_YIELD') {
            nextCheckAt = Date.now() + SCENE_REENTRY_MS;
            return;
        }
        resetCycle();
        if (error.code === 'RANCH_AUTOMATION_DISABLED') return;
        nextCheckAt = Date.now() + Math.max(require('../../config/ranch-automation').getRanchPatrolIntervalMs(auto), 10 * 60_000);
        retryAt = nextCheckAt;
        log('牧场', `日常牧场巡查失败：${error.message}`, { module: 'ranch', event: 'ranch_automation', result: 'error' });
    }
}

module.exports = {
    run, getRoutineState, selectAnimal, requestMarketCheck, noteMarketVisit, noteBookReward, noteRanchFacilities,
    resetFriendSchedule: () => { nextFriendPatrolAt = 0; resetFriendCycle(); },
    resetSchedule: () => {
        requestMarketCheck();
        nextCheckAt = 0;
        lastMarketRotation = null;
        lastMarketBalances.clear();
        friendRetryAt.clear();
        deferredSteals.clear();
        nextFriendPatrolAt = 0;
        resetFriendCycle();
        shedCheckPending = true;
        shedNotifyRevision++;
        retryAt = 0;
        resetCycle();
    },
};
