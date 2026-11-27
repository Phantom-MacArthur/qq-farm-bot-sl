import { getFertilizerStrategyGroups, usesImmediateOrganicFertilizer, usesNormalFertilizer, usesRipeningFertilizer } from '../../config/fertilizer-strategy';
import { getYishuActivityEnd, YISHU_SEED_ID } from '../../config/yishuhuanfu';
import { appendYishuHistory } from '../yishuhuanfu-history';
/**
 * 农场循环调度 - 循环管理、可变状态
 */

const { CONFIG, PlantPhase } = require('../../config/config');
const { getPlantById, getItemById } = require('../../config/gameConfig');
const { isAutomationOn, getAutomation, getFertilizerBuyOrganicCount, getFertilizerBuyOrganicThresholdHours, getFertilizerBuyNormalCount, getFertilizerBuyNormalThresholdHours, getFertilizerBuyCheckIntervalMinutes, getFertilizerBuyNormalCheckIntervalMinutes } = require('../../models/store');
const { getUserState, networkEvents } = require('../../utils/network');
const { toNum, toTimeSec, getServerTimeSec, serverTimeToLocalMs, log, logWarn, randomDelay } = require('../../utils/utils');
const { runWithRequestClass } = require('../../utils/request-context');
const { createScheduler } = require('../scheduler');
const { runExclusiveAutomationTask } = require('../automation-lock');
const { recordOperation } = require('../stats');
const {
    getAllLands, harvest, farming, unlockLand, upgradeLand, removePlant,
    isFertilizerContainerEmpty, NORMAL_FERTILIZER_ID, ORGANIC_FERTILIZER_ID,
} = require('./api');
const {
    analyzeLands,
    buildLandDetail,
    getCurrentPhase,
    isExplicitMaturePhase,
    getCleanableFarmSocialEventItemIds,
    getNormalFertilizerTargetsFromLands,
    resolveRemovableHarvestedLands,
    getLandTypeByLevel,
    filterLandIdsByTypes,
    ALL_FERTILIZER_LAND_TYPES,
} = require('./land-analysis');
const { autoPlantEmptyLands, getRemainingPlantDelayMs, runFertilizerByConfig, plantYishuLands } = require('./planting');
const { runRipeningFertilizer } = require('./ripening');
const { checkAndBuyFertilizerBoth } = require('../mall');
// 延迟加载以打破循环依赖: visit-strategy → farm/index → scheduler → visit-strategy
function inFarmQuietHours() {
    return require('../friend/visit-strategy').inFarmQuietHours();
}

// ============ 内部状态 ============
let isCheckingFarm: boolean = false;
let isFirstFarmCheck: boolean = true;
let farmLoopRunning: boolean = false;
let externalSchedulerMode: boolean = false;
let farmLoopGeneration = 0;
let automaticPlantPacing: any = { lastPlantAt: null, defer: true };
const farmScheduler = createScheduler('farm');
const landDeadlines = new Map<number, { at: number; plantId: number }>();
const pendingHarvest = new Map<number, any>();
const lastHarvestAttempt = new Map<number, string>();
let maturityAt = Infinity;
let pushCheckAt = Infinity;
let scheduledAt = Infinity;
let wakeQueued = false;
let nextOrdinaryPushAt = 0;

// ============ 农场循环 ============

function canContinueFarm(generation: number): boolean {
    return generation === farmLoopGeneration
        && !!getUserState().gid && isAutomationOn('farm') && !inFarmQuietHours();
}

function cropKey(land: any): string {
    const plant = land.plant;
    return `${plant.id}:${plant.season}:${plant.phases[0].begin_time}`;
}

function maturePushKey(land: any): string {
    if (!land?.unlocked || !isExplicitMaturePhase(land.plant?.phases?.[0])) return '';
    const master = toNum(land.master_land_id);
    return master && master !== toNum(land.id) ? '' : cropKey(land);
}

function isTiangongCrop(plantId: number): boolean {
    return Number(getItemById(getPlantById(plantId)?.seed_id)?.rarity) === 4;
}

function armFarmWake(): void {
    const at = farmLoopRunning && canContinueFarm(farmLoopGeneration) ? Math.min(maturityAt, pushCheckAt) : Infinity;
    if (wakeQueued || isCheckingFarm || at === scheduledAt) return;
    farmScheduler.clear('farm_push_check');
    scheduledAt = at;
    if (!Number.isFinite(at)) return;
    const generation = farmLoopGeneration;
    farmScheduler.setTimeoutTask('farm_push_check', Math.max(0, at - Date.now()), async () => {
        scheduledAt = Infinity;
        wakeQueued = true;
        try {
            await runExclusiveAutomationTask('farm_push_check', async () => {
                if (generation !== farmLoopGeneration) return;
                if (!canContinueFarm(generation)) { pendingHarvest.clear(); pushCheckAt = Infinity; return; }
                if (Math.min(maturityAt, pushCheckAt) > Date.now()) return;
                await runWithRequestClass('farm', checkFarm);
            }, { detached: true });
        } finally {
            if (generation === farmLoopGeneration) { wakeQueued = false; armFarmWake(); }
        }
    });
}

function rememberMaturity(land: any): void {
    const id = toNum(land.id);
    landDeadlines.delete(id);
    const master = toNum(land.master_land_id);
    const phases = land.plant?.phases;
    if (!land.unlocked || (master && master !== id) || !phases || phases.length < 2) return;
    const plantId = toNum(land.plant.id);
    const current = getCurrentPhase(phases, false, '', plantId)?.phase;
    if (!current || current === PlantPhase.MATURE || current === PlantPhase.DEAD) return;
    const last = phases[phases.length - 1];
    const mature = phases.find(isExplicitMaturePhase)
        || (getCurrentPhase([last], false, '', plantId)?.phase === PlantPhase.MATURE ? last : null);
    if (!mature) return;
    const now = Date.now();
    const due = serverTimeToLocalMs(toTimeSec(mature.begin_time) * 1000);
    // 到点仍报生长中时，在成熟时刻后的 300ms 补查一次。
    const at = due > now ? due : due + 300;
    if (at > now) landDeadlines.set(id, { at, plantId });
}

function updateMaturityWake(): void {
    const skipTiangong = getAutomation().farm_harvest_tiangong === false;
    maturityAt = Infinity;
    for (const { at, plantId } of landDeadlines.values()) {
        if (!skipTiangong || !isTiangongCrop(plantId)) maturityAt = Math.min(maturityAt, at);
    }
    armFarmWake();
}

function observeFarmLands(lands: any[], full = false): void {
    if (full) {
        landDeadlines.clear();
        for (const [id, pending] of pendingHarvest) {
            const current = lands.find(land => toNum(land.id) === id);
            if (maturePushKey(current) !== cropKey(pending)) pendingHarvest.delete(id);
        }
    }
    for (const land of lands) {
        rememberMaturity(land);
        if (!full) pendingHarvest.delete(toNum(land.id));
    }
    updateMaturityWake();
}

function schedulePlantContinuation(generation: number, pacing: any, delayMs?: number): void {
    if (!farmLoopRunning || !canContinueFarm(generation) || pacing !== automaticPlantPacing || !pacing.deferred) return;
    farmScheduler.setTimeoutTask('farm_plant_continue', delayMs ?? getRemainingPlantDelayMs(pacing), async () => {
        // 计时器会继承创建时的异步上下文，必须独立入队，不能当作旧锁的重入。
        await runExclusiveAutomationTask('farm_plant_continue', async () => {
            if (!farmLoopRunning || !canContinueFarm(generation) || pacing !== automaticPlantPacing) return;
            await checkFarm();
        }, { detached: true });
    });
}

async function checkFarm(): Promise<boolean> {
    const state = getUserState();
    if (isCheckingFarm || !state.gid || !isAutomationOn('farm')) return false;
    if (inFarmQuietHours()) return false;
    const generation = farmLoopGeneration;
    const pacing = automaticPlantPacing;
    farmScheduler.clear('farm_plant_continue');
    pacing.deferred = false;
    isCheckingFarm = true;
    if (pushCheckAt <= Date.now()) nextOrdinaryPushAt = Date.now() + 500;
    pushCheckAt = Infinity;
    if (maturityAt <= Date.now()) {
        for (const [id, deadline] of landDeadlines) if (deadline.at <= Date.now()) landDeadlines.delete(id);
        updateMaturityWake();
    }

    try {
        // 复用手动操作逻辑
        const result = await runFarmOperation('all', null, false, { generation, pacing });
        isFirstFarmCheck = false;
        return !!(result && result.hadWork);
    } catch (err: any) {
        logWarn('巡田', `检查失败: ${err.message}`);
        return false;
    } finally {
        isCheckingFarm = false;
        schedulePlantContinuation(generation, pacing);
        armFarmWake();
    }
}

/** 多季补肥统一返回实际施肥地块数，供一键打理汇总“施肥”计数；actions 传入时同步追加文案。 */
async function runMultiSeasonFertilizer(
    growingLandIds: any[],
    propagateErrors: boolean = false,
    actions?: string[],
): Promise<number> {
    if (!isAutomationOn('fertilizer_multi_season')) return 0;
    const groups = getFertilizerStrategyGroups(getAutomation());
    const normalAvailable = !isFertilizerContainerEmpty(NORMAL_FERTILIZER_ID);
    const organicAvailable = !isFertilizerContainerEmpty(ORGANIC_FERTILIZER_ID);
    if (![...groups.keys()].some(mode =>
        (normalAvailable && usesNormalFertilizer(mode))
        || (organicAvailable && usesImmediateOrganicFertilizer(mode)))) return 0;
    const multiSeasonTargets: number[] = [...new Set(
        (Array.isArray(growingLandIds) ? growingLandIds : []).map((v: any) => toNum(v)).filter(Boolean),
    )];
    if (multiSeasonTargets.length === 0) return 0;

    log('施肥', `检测到多季作物进入后续季，准备执行多季补肥，目标地块 ${multiSeasonTargets.length} 块`, {
        module: 'farm',
        event: '多季节施肥',
        result: 'trigger',
        count: multiSeasonTargets.length,
        landIds: multiSeasonTargets,
    });
    try {
        const result = await runFertilizerByConfig(multiSeasonTargets, { reason: 'multi_season', propagateErrors });
        const applied = toNum(result?.normal) + toNum(result?.organic);
        if (applied > 0 && actions) actions.push(`多季补肥${applied}`);
        return applied;
    } catch (e: any) {
        logWarn('施肥', `多季补肥执行失败: ${e.message}`, {
            module: 'farm',
            event: '多季节施肥',
            result: 'error',
        });
        if (propagateErrors) throw e;
        return 0;
    }
}

// 收获日志带作物名：QQ 机器人推送要靠它查物品图（事件名后面的小图标）
function firstCropName(lands: any[], ids: number[]): string {
    for (const land of lands) {
        if (!ids.includes(toNum(land.id))) continue;
        const plantId = toNum(land.plant?.id);
        if (!plantId) continue;
        const name = String(getPlantById(plantId)?.name || land.plant?.name || '').trim();
        if (name) return name;
    }
    return '';
}

function autoHarvestLandIds(status: any): number[] {
    const automation = getAutomation();
    const excluded = new Set((status.harvestableInfo || [])
        .filter((info: any) => (automation.farm_harvest_tiangong === false && isTiangongCrop(info.plantId))
            || (automation.yishu_harvest === false && toNum(getPlantById(info.plantId)?.seed_id) === YISHU_SEED_ID))
        .map((info: any) => info.landId));
    return status.harvestable.filter((id: number) => !excluded.has(id));
}

function isYishuCrop(land: any): boolean {
    return toNum(getPlantById(toNum(land.plant?.id))?.seed_id) === YISHU_SEED_ID;
}

function recordYishuHarvest(lands: any[], harvestedIds: number[]): void {
    const count = lands.filter(land => harvestedIds.includes(toNum(land.id)) && isYishuCrop(land)).length;
    if (!count) return;
    try {
        appendYishuHistory(process.env.FARM_ACCOUNT_ID || '', getServerTimeSec(), { type: 'harvest', count });
    } catch (error: any) {
        logWarn('收获', `写入以薯换福活动日志失败：${error.message}`);
    }
}

async function harvestYishuMatureLands(): Promise<number> {
    if (getAutomation().yishu_harvest !== true) return 0;
    return runExclusiveAutomationTask('yishuhuanfu-harvest', async () => {
        if (!getYishuActivityEnd(getServerTimeSec()) || getAutomation().yishu_harvest !== true) return 0;
        const { lands } = await getAllLands();
        const ripe: number[] = analyzeLands(lands, false, getUserState().gid).harvestable;
        const ids = lands.filter((land: any) => isYishuCrop(land) && ripe.includes(toNum(land.id))).map((land: any) => toNum(land.id));
        if (!ids.length) return 0;
        const reply = await harvest(ids, false);
        const confirmed = ids.filter(id => reply.land?.some((land: any) => toNum(land.id) === id));
        if (confirmed.length) {
            recordYishuHarvest(lands, confirmed);
            recordOperation('harvest', confirmed.length);
            networkEvents.emit('farmHarvested', { count: confirmed.length, landIds: confirmed, opType: 'yishuhuanfu' });
        }
        return confirmed.length;
    });
}

async function getYishuFarmStatus() {
    const { lands } = await getAllLands();
    const seconds = getServerTimeSec();
    const { harvestable } = analyzeLands(lands, false, getUserState().gid);
    return {
        crops: lands.filter(isYishuCrop).map((land: any) => {
            const detail = buildLandDetail(land, { nowSec: seconds });
            return {
                landId: toNum(land.id),
                ready: harvestable.includes(toNum(land.id)),
                matureAt: detail.matureInSec > 0 ? seconds + detail.matureInSec : null,
            };
        }),
    };
}

async function plantYishuWhenFarmPaused() {
    if (isAutomationOn('farm') || getAutomation().yishu_plant !== true || !getYishuActivityEnd(getServerTimeSec())) return 0;
    const { lands } = await getAllLands();
    const empty = analyzeLands(lands, false, getUserState().gid).empty;
    return (await plantYishuLands(lands, empty, { lastPlantAt: null }))?.planted || 0;
}

/**
 * 催熟施肥后只重查并收获一次，避免形成请求循环。
 * 跟随收获也会走多季补肥：这批作物进入下一季后，主循环里的补肥已经跑完了。
 */
async function harvestMatureOwnLandsOnce(
    actions: string[],
    propagateErrors: boolean = false,
    counts?: FarmOperationCounts,
): Promise<number> {
    let latest: any;
    try {
        latest = await getAllLands();
    } catch (e: any) {
        logWarn('收获', `施肥后刷新土地失败: ${e.message}`);
        if (propagateErrors) throw e;
        return 0;
    }

    const lands = Array.isArray(latest && latest.lands) ? latest.lands : [];
    if (lands.length === 0) return 0;

    const ownGid = toNum(getUserState().gid);
    const harvestable = autoHarvestLandIds(analyzeLands(lands, false, ownGid));
    if (harvestable.length === 0) return 0;

    try {
        const harvestReply = await harvest(harvestable);
        recordYishuHarvest(lands, harvestable);
        actions.push(`施肥后收获${harvestable.length}`);
        recordOperation('harvest', harvestable.length);
        networkEvents.emit('farmHarvested', {
            count: harvestable.length,
            landIds: [...harvestable],
            opType: 'fertilizer_followup',
        });
        log('收获', `施肥后立即收获 ${harvestable.length} 块土地`, {
            module: 'farm',
            event: '施肥后收获作物',
            result: 'ok',
            count: harvestable.length,
            landIds: [...harvestable],
            itemName: firstCropName(lands, harvestable),
        });
        const classified = await resolveRemovableHarvestedLands(harvestable, harvestReply);
        if (counts) counts.harvest += harvestable.length;
        const followUpFertilized = await runMultiSeasonFertilizer(classified.growing, propagateErrors, actions);
        if (counts) counts.fertilize += followUpFertilized;
        return harvestable.length;
    } catch (e: any) {
        logWarn('收获', `施肥后立即收获失败: ${e.message}`, {
            module: 'farm',
            event: '施肥后收获作物',
            result: 'error',
        });
        if (propagateErrors) throw e;
        return 0;
    }
}

/**
 * 一键打理需要把 5 个操作按钮各自“实际处理的地块数”汇总给前端，
 * actions 是展示文案，处理地块数单独累加。
 * 字段与按钮对应：farming=务农，fertilize=施肥。
 */
type FarmOperationCounts = { harvest: number; farming: number; plant: number; upgrade: number; fertilize: number };

function createFarmOperationCounts(): FarmOperationCounts {
    return { harvest: 0, farming: 0, plant: 0, upgrade: 0, fertilize: 0 };
}

/**
 * 手动/自动执行农场操作
 * @param opType - 'all', 'harvest', 'clear', 'plant', 'upgrade', 'remove'
 */
async function runFarmOperation(
    opType: string,
    targetLandIdInput: unknown = null,
    propagateErrors: boolean = false,
    automatic?: { generation: number; pacing: any },
): Promise<{ hadWork: boolean; actions: string[]; counts: FarmOperationCounts }> {
    if (opType === 'plant') throw new Error('独立种植操作已移除，请使用一键打理');
    const counts = createFarmOperationCounts();
    const actions: string[] = [];
    const harvestedLandIds: number[] = [];
    const harvestReply: { land: any[] } = { land: [] };
    const pushedIds = new Set<number>();
    async function collectHarvest(ids: number[], source: any[], isAll: boolean): Promise<void> {
        if (!ids.length) return;
        for (const land of source) {
            if (land.plant?.phases?.length && ids.includes(toNum(land.id))) lastHarvestAttempt.set(toNum(land.id), cropKey(land));
        }
        try {
            const reply = await harvest(ids, isAll);
            const updated = reply.land || [];
            const completed = isAll ? ids : ids.filter(id => updated.some((land: any) => toNum(land.id) === id));
            if (!completed.length) return;
            recordYishuHarvest(source, completed);
            harvestedLandIds.push(...completed);
            harvestReply.land.push(...updated);
            const count = completed.length;
            log('收获', `收获完成 ${count} 块土地`, {
                module: 'farm',
                event: '收获作物',
                result: 'ok',
                count,
                landIds: completed,
                itemName: firstCropName(source, completed),
            });
            actions.push(`收获${count}`);
            recordOperation('harvest', count);
            counts.harvest += count;
            networkEvents.emit('farmHarvested', { count, landIds: completed, opType });
        } catch (e: any) {
            logWarn('收获', e.message, { module: 'farm', event: '收获作物', result: 'error' });
            if (propagateErrors) throw e;
        }
    }
    if (automatic && pendingHarvest.size) {
        const lands = [...pendingHarvest.values()].filter(land => lastHarvestAttempt.get(toNum(land.id)) !== cropKey(land));
        pendingHarvest.clear();
        if (lands.length && isAutomationOn('farm_push')) {
            const ids = autoHarvestLandIds(analyzeLands(lands, false, getUserState().gid));
            for (const id of ids) pushedIds.add(id);
            await collectHarvest(ids, lands, false);
        }
    }
    const landsReply = await getAllLands();
    if (automatic && !canContinueFarm(automatic.generation)) return { hadWork: actions.length > 0, actions, counts };
    if (!landsReply.lands || landsReply.lands.length === 0) {
        if (opType !== 'all') {
            log('农场', '没有土地数据');
        }
        return { hadWork: actions.length > 0, actions, counts };
    }

    const lands = landsReply.lands;
    let fertilizerSnapshot: any[] | undefined = lands;

    const state = getUserState();
    const status = analyzeLands(lands, isFirstFarmCheck, state.gid);
    const socialEventItemIds: number[] = getCleanableFarmSocialEventItemIds(landsReply);
    const hasTargetLandId = targetLandIdInput !== null
        && targetLandIdInput !== undefined
        && String(targetLandIdInput).trim() !== '';
    const targetLandId = toNum(targetLandIdInput);
    if (hasTargetLandId && (!Number.isSafeInteger(targetLandId) || targetLandId <= 0)) {
        throw new Error('地块编号无效');
    }
    if (opType === 'remove' && !hasTargetLandId) {
        throw new Error('铲除操作必须指定地块');
    }
    if (hasTargetLandId && !['clear', 'harvest', 'upgrade', 'remove'].includes(opType)) {
        throw new Error('指定地块仅支持务农、收获、升级或铲除');
    }
    if (hasTargetLandId && opType === 'harvest' && !status.harvestable.includes(targetLandId)) {
        throw new Error(`土地#${targetLandId} 当前不能收获`);
    }
    if (hasTargetLandId && opType === 'upgrade' && !status.upgradable.includes(targetLandId)) {
        throw new Error(`土地#${targetLandId} 当前不能升级`);
    }
    if (hasTargetLandId && opType === 'remove'
        && ![...status.growing, ...status.harvestable, ...status.dead].includes(targetLandId)) {
        throw new Error(`土地#${targetLandId} 当前没有可铲除的作物`);
    }

    if (opType === 'plant_empty') {
        const result = await autoPlantEmptyLands([], status.empty, {
            propagateErrors, knownLands: lands, pacing: { lastPlantAt: null, delaySeconds: 0 },
        });
        counts.plant = result?.plantedLands?.length || 0;
        if (counts.plant) recordOperation('plant', counts.plant);
        return { hadWork: counts.plant > 0, counts, actions: counts.plant ? [`种植${counts.plant}`] : [] };
    }

    // 摘要
    const statusParts: string[] = [];
    if (status.harvestable.length) statusParts.push(`收:${status.harvestable.length}`);
    const farmingCount = new Set([...status.needWeed, ...status.needBug, ...status.needInteractionCleanup]).size
        + socialEventItemIds.length;
    if (farmingCount > 0) statusParts.push(`农:${farmingCount}`);
    if (status.needWater.length) statusParts.push(`水:${status.needWater.length}`);
    if (status.dead.length) statusParts.push(`枯:${status.dead.length}`);
    if (status.empty.length) statusParts.push(`空:${status.empty.length}`);
    if (status.unlockable.length) statusParts.push(`解:${status.unlockable.length}`);
    if (status.upgradable.length) statusParts.push(`升:${status.upgradable.length}`);
    statusParts.push(`长:${status.growing.length}`);

    const harvestFromRead = async () => {
        const candidates: number[] = opType === 'all' ? autoHarvestLandIds(status)
            : hasTargetLandId ? status.harvestable.filter((id: number) => id === targetLandId) : status.harvestable;
        const ids = candidates.filter(id => !pushedIds.has(id));
        if (ids.length) {
            fertilizerSnapshot = undefined;
            await collectHarvest(ids, lands, !hasTargetLandId && !pushedIds.size && ids.length === status.harvestable.length);
        }
    };
    if (automatic) await harvestFromRead();

    if (opType === 'remove') {
        try {
            await removePlant([targetLandId]);
            log('铲除', `已铲除土地#${targetLandId}上的作物`, {
                module: 'farm',
                event: '铲除植物',
                result: 'ok',
                count: 1,
                landId: targetLandId,
            });
            actions.push('铲除1');
        } catch (e: any) {
            logWarn('铲除', `土地#${targetLandId}铲除失败: ${e.message}`, {
                module: 'farm',
                event: '铲除植物',
                result: 'error',
                landId: targetLandId,
            });
            if (propagateErrors) throw e;
        }
    }

    // 执行一键务农 (除草+除虫+浇水) - 串行执行以降低并发压力
    if (opType === 'all' || opType === 'clear') {
        // 检查是否跳过一键务农（仅自动模式生效，手动clear不受影响）
        const skipOwnWeedBug = opType === 'all' && isAutomationOn('skip_own_weed_bug');
        let farmingLandIds = [...new Set([
            ...status.needWeed,
            ...status.needBug,
            ...status.needWater,
            ...status.needInteractionCleanup,
        ])];

        const validSingleLandIds = new Set<number>([
            ...status.growing,
            ...status.harvestable,
            ...status.dead,
        ]);
        if (hasTargetLandId) {
            if (!validSingleLandIds.has(targetLandId)) {
                throw new Error(`土地#${targetLandId} 当前不能执行务农`);
            }
            const targetNeedsFarming = farmingLandIds.includes(targetLandId);
            farmingLandIds = targetNeedsFarming || socialEventItemIds.length > 0 ? [targetLandId] : [];
        } else if (socialEventItemIds.length > 0 && farmingLandIds.length === 0) {
            // 青蛙属于农场级事件，但 Farming 仍需携带一块有效作物地；官方单点抓包也是该结构。
            const fallbackLandId = status.growing[0] || status.harvestable[0] || status.dead[0] || 0;
            if (fallbackLandId > 0) farmingLandIds = [fallbackLandId];
        }

        if (!skipOwnWeedBug && farmingLandIds.length > 0) {
            fertilizerSnapshot = undefined;
            try {
                await farming(farmingLandIds, socialEventItemIds);
                const parts: string[] = [];
                if (status.needWeed.length) parts.push(`草${status.needWeed.length}`);
                if (status.needBug.length) parts.push(`虫${status.needBug.length}`);
                if (status.needWater.length) parts.push(`水${status.needWater.length}`);
                if (status.needInteractionCleanup.length) parts.push(`道具${status.needInteractionCleanup.length}`);
                if (socialEventItemIds.length) parts.push(`青蛙${socialEventItemIds.length}`);
                if (hasTargetLandId) {
                    actions.push(`单点务农#${targetLandId}${parts.length ? `(${parts.join('/')})` : ''}`);
                } else {
                    const tended = new Set([...status.needWeed, ...status.needBug]).size;
                    const summary = [
                        tended ? `农${tended}` : '',
                        status.needWater.length ? `水${status.needWater.length}` : '',
                        status.needInteractionCleanup.length ? `道具${status.needInteractionCleanup.length}` : '',
                        socialEventItemIds.length ? `青蛙${socialEventItemIds.length}` : '',
                    ].filter(Boolean);
                    actions.push(`一键务农: ${summary.join('，')}`);
                }
                counts.farming += farmingLandIds.length;
            } catch (e: any) {
                logWarn(hasTargetLandId ? '单点务农' : '一键务农', e.message);
                if (hasTargetLandId || propagateErrors) throw e;
            }
        }
    }

    // 执行收获
    let postHarvest: any = null;
    if (!automatic && (opType === 'all' || opType === 'harvest')) await harvestFromRead();

    // 执行种植
    if (opType === 'all') {
        const targetLandIds = hasTargetLandId ? [targetLandId] : undefined;
        const allEmptyLands: number[] = [...new Set(status.empty)]
            .filter((id: number) => !hasTargetLandId || id === targetLandId) as number[];
        let allDeadLands: number[] = [...new Set(status.dead)]
            .filter((id: number) => !hasTargetLandId || id === targetLandId) as number[];

        if (opType === 'all' && harvestedLandIds.length > 0) {
            // 收获后延迟再铲除枯地
            await randomDelay(1000, 1500);
            postHarvest = await resolveRemovableHarvestedLands(harvestedLandIds, harvestReply);
            allDeadLands = [...new Set([...allDeadLands, ...postHarvest.removable])];
        }
        if (allDeadLands.length > 0 || allEmptyLands.length > 0) {
            try {
                if (automatic && !canContinueFarm(automatic.generation)) return { hadWork: actions.length > 0, actions, counts };
                fertilizerSnapshot = undefined;
                const plantResult = await autoPlantEmptyLands(allDeadLands, allEmptyLands, {
                    propagateErrors, knownLands: lands,
                    targetLandIds,
                    pacing: automatic ? automatic.pacing : { lastPlantAt: null, delaySeconds: 0 },
                });
                const plantedCount = Array.isArray(plantResult?.plantedLands) ? plantResult.plantedLands.length : 0;
                const deferredCount = Array.isArray(plantResult?.deferredLandIds) ? plantResult.deferredLandIds.length : 0;
                if (plantedCount > 0) {
                    actions.push(`种植${plantedCount}`);
                    recordOperation('plant', plantedCount);
                    counts.plant += plantedCount;
                }
                if (deferredCount > 0) actions.push(`预留${deferredCount}`);
            } catch (e: any) {
                logWarn('种植', e.message);
                if (propagateErrors) throw e;
            }
        }
    }
    if (opType === 'all' && postHarvest && Array.isArray(postHarvest.growing) && postHarvest.growing.length > 0) {
        counts.fertilize += await runMultiSeasonFertilizer(postHarvest.growing, propagateErrors, actions);
    }

    // 执行土地解锁/升级（手动 upgrade 总是执行；自动 all 受开关控制）
    const shouldAutoUpgrade = opType === 'all' && isAutomationOn('land_upgrade');
    if (shouldAutoUpgrade || opType === 'upgrade') {
        const unlockable = hasTargetLandId ? [] : status.unlockable;
        const upgradable = hasTargetLandId
            ? status.upgradable.filter((id: number) => id === targetLandId)
            : status.upgradable;
        if (unlockable.length > 0 || upgradable.length > 0) fertilizerSnapshot = undefined;
        if (unlockable.length > 0) {
            let unlocked: number = 0;
            for (const landId of unlockable) {
                try {
                    await unlockLand(landId, false);
                    log('解锁', `土地#${landId} 解锁成功`, {
                        module: 'farm', event: '解锁土地', result: 'ok', landId
                    });
                    unlocked++;
                } catch (e: any) {
                    logWarn('解锁', `土地#${landId} 解锁失败: ${e.message}`, {
                        module: 'farm', event: '解锁土地', result: 'error', landId
                    });
                    if (propagateErrors) throw e;
                }
                await randomDelay(1000, 1500);
            }
            if (unlocked > 0) {
                actions.push(`解锁${unlocked}`);
                counts.upgrade += unlocked;
            }
        }

        if (upgradable.length > 0) {
            let upgraded: number = 0;
            for (const landId of upgradable) {
                try {
                    const reply = await upgradeLand(landId);
                    const newLevel = reply.land ? toNum(reply.land.level) : '?';
                    log('升级', `土地#${landId} 升级成功 → 等级${newLevel}`, {
                        module: 'farm', event: '升级土地', result: 'ok', landId, level: newLevel
                    });
                    upgraded++;
                } catch (e: any) {
                    log('升级', `土地#${landId} 升级失败: ${e.message}`, {
                        module: 'farm', event: '升级土地', result: 'error', landId
                    });
                    if (propagateErrors) throw e;
                }
                await randomDelay(1000, 1500);
            }
            if (upgraded > 0) {
                actions.push(`升级${upgraded}`);
                counts.upgrade += upgraded;
            }
        }
    }

    if (opType === 'all') {
        if (automatic && !canContinueFarm(automatic.generation)) return { hadWork: actions.length > 0, actions, counts };
        const automation = getAutomation();
        const groups = [...getFertilizerStrategyGroups(automation)];
        const normalAvailable = !isFertilizerContainerEmpty(NORMAL_FERTILIZER_ID);
        const organicAvailable = !isFertilizerContainerEmpty(ORGANIC_FERTILIZER_ID);
        const catchUpLandTypes = groups
            .filter(([mode]) => (normalAvailable && usesNormalFertilizer(mode)) || (organicAvailable && mode === 'both'))
            .flatMap(([, types]) => types);
        if (isAutomationOn('fertilizer_multi_season') && catchUpLandTypes.length) {
            try {
                const latest = fertilizerSnapshot ?? (await getAllLands())?.lands;
                const latestLands = Array.isArray(latest) ? latest : [];
                fertilizerSnapshot = latestLands;
                let targets = getNormalFertilizerTargetsFromLands(latestLands);
                if (catchUpLandTypes.length < ALL_FERTILIZER_LAND_TYPES.length) {
                    const landTypeById = new Map<number, string>();
                    for (const land of latestLands) {
                        if (!land) continue;
                        const landId = toNum(land.id);
                        if (!landId) continue;
                        landTypeById.set(landId, getLandTypeByLevel(land.level));
                    }
                    targets = landTypeById.size > 0
                        ? filterLandIdsByTypes(targets, landTypeById, catchUpLandTypes)
                        : [];
                }
                if (targets.length > 0) {
                    log('施肥', `巡田补肥：检测到 ${targets.length} 块地可补肥`, {
                        module: 'farm',
                        event: '多季节施肥',
                        result: 'trigger',
                        count: targets.length,
                        landIds: targets,
                    });
                    // 补肥复用本次地块，后续催熟重新读取施肥后的状态。
                    fertilizerSnapshot = undefined;
                    const result = await runFertilizerByConfig(targets, { reason: 'multi_season', propagateErrors, lands: latestLands });
                    const applied = toNum(result.normal) + toNum(result.organic);
                    if (applied > 0) actions.push(`补肥${applied}`);
                    counts.fertilize += applied;
                }
            } catch (e: any) {
                logWarn('施肥', `巡田补肥失败: ${e.message}`, {
                    module: 'farm',
                    event: '多季节施肥',
                    result: 'error',
                });
                if (propagateErrors) throw e;
            }
        }
        if (groups.some(([mode]) => usesRipeningFertilizer(mode))) {
            try {
                const count = await runRipeningFertilizer(automation, fertilizerSnapshot, propagateErrors);
                if (count > 0) {
                    actions.push(`催熟${count}`);
                    counts.fertilize += count;
                    await harvestMatureOwnLandsOnce(actions, propagateErrors, counts);
                }
            } catch (e: any) {
                logWarn('施肥', `巡田时施肥失败: ${e.message}`);
                if (propagateErrors) throw e;
            }
        }
    }
    // 日志
    const actionStr = actions.length > 0 ? ` → ${actions.join('/')}` : '';
    if (actions.length > 0) {
         log('农场', `[${statusParts.join(' ')}]${actionStr}`, {
             module: 'farm', event: '农场循环', opType, actions
         });
    }
    return { hadWork: actions.length > 0, actions, counts };
}

function scheduleNextFarmCheck(delayMs: number = CONFIG.farmCheckInterval): void {
    if (externalSchedulerMode) return;
    if (!farmLoopRunning) return;
    farmScheduler.setTimeoutTask('farm_check_loop', Math.max(0, delayMs), async () => {
        if (!farmLoopRunning) return;
        await runExclusiveAutomationTask('farm_check_loop', checkFarm);
        if (!farmLoopRunning) return;
        scheduleNextFarmCheck(CONFIG.farmCheckInterval);
    });
}

function startFarmCheckLoop(options: { externalScheduler?: boolean } = {}): void {
    if (farmLoopRunning) return;
    farmLoopGeneration++;
    externalSchedulerMode = !!options.externalScheduler;
    farmLoopRunning = true;
    networkEvents.on('ownFarmLandsUpdated', observeFarmLands);
    networkEvents.on('landsChanged', onLandsChangedPush);
    networkEvents.on('farmSocialEventsChanged', onFarmSocialEventsChangedPush);
    if (!externalSchedulerMode) {
        scheduleNextFarmCheck(2000);
    }
    // 启动化肥自动购买检测定时器
    startFertilizerBuyCheckTimer();
}

function queuePushCheck(urgent: boolean, social: boolean, count: number): void {
    if (!canContinueFarm(farmLoopGeneration) || (isCheckingFarm && !urgent)) return;
    const now = Date.now();
    const at = urgent ? now : Math.max(now + 100, nextOrdinaryPushAt);
    if (at >= pushCheckAt) return;
    pushCheckAt = at;
    log('农场', social ? `收到农场社交事件推送: ${count}个，检查中...` : `收到推送: ${count}块土地变化，检查中...`, {
        module: 'farm', event: social ? '农场社交事件通知' : '土地推送通知', result: 'trigger_check', count,
    });
    armFarmWake();
}

function onLandsChangedPush(lands: any[], hostGid?: number): void {
    const own = !!hostGid && hostGid === getUserState().gid;
    const enabled = isAutomationOn('farm_push') && canContinueFarm(farmLoopGeneration);
    for (const land of lands) {
        const id = toNum(land.id);
        pendingHarvest.delete(id);
        if (!own) continue;
        rememberMaturity(land);
        const key = enabled && maturePushKey(land);
        if (key && lastHarvestAttempt.get(id) !== key
            && (getAutomation().farm_harvest_tiangong !== false || !isTiangongCrop(toNum(land.plant.id)))) pendingHarvest.set(id, land);
    }
    if (own) updateMaturityWake();
    if (enabled) queuePushCheck(pendingHarvest.size > 0, false, lands.length);
}

function onFarmSocialEventsChangedPush(events: any[]): void {
    if (isAutomationOn('farm_push')) queuePushCheck(false, true, events.length);
}

function stopFarmCheckLoop(): void {
    farmLoopRunning = false;
    farmLoopGeneration++;
    automaticPlantPacing = { lastPlantAt: null, defer: true };
    externalSchedulerMode = false;
    landDeadlines.clear();
    pendingHarvest.clear();
    lastHarvestAttempt.clear();
    maturityAt = pushCheckAt = scheduledAt = Infinity;
    nextOrdinaryPushAt = 0;
    wakeQueued = false;
    farmScheduler.clearAll();
    networkEvents.removeListener('ownFarmLandsUpdated', observeFarmLands);
    networkEvents.removeListener('landsChanged', onLandsChangedPush);
    networkEvents.removeListener('farmSocialEventsChanged', onFarmSocialEventsChangedPush);
    // 停止化肥自动购买检测定时器
    stopFertilizerBuyCheckTimer();
}

function refreshFarmCheckLoop(delayMs: number = 200): void {
    if (!farmLoopRunning) return;
    startFertilizerBuyCheckTimer();
    if (!canContinueFarm(farmLoopGeneration) || !isAutomationOn('farm_push')) {
        pendingHarvest.clear();
        pushCheckAt = Infinity;
    }
    updateMaturityWake();
    if (farmScheduler.has('farm_plant_continue')) {
        farmScheduler.clear('farm_plant_continue');
        schedulePlantContinuation(farmLoopGeneration, automaticPlantPacing, delayMs);
    }
    scheduleNextFarmCheck(delayMs);
}

// ============ 化肥自动购买定时检测 ============
const fertilizerBuyTypes = ['organic', 'normal'] as const;
type FertilizerBuyType = typeof fertilizerBuyTypes[number];
const fertilizerBuyTimers = new Map<FertilizerBuyType, { intervalMinutes: number }>();

function startFertilizerBuyCheckTimer(): void {
    for (const type of fertilizerBuyTypes) {
        const task = `fertilizer_buy_check_${type}`;
        if (!isAutomationOn(`fertilizer_buy_${type}`)) {
            farmScheduler.clear(task);
            fertilizerBuyTimers.delete(type);
            continue;
        }
        const intervalMinutes: number = type === 'organic'
            ? getFertilizerBuyCheckIntervalMinutes() : getFertilizerBuyNormalCheckIntervalMinutes();
        if (fertilizerBuyTimers.get(type)?.intervalMinutes === intervalMinutes && farmScheduler.has(task)) continue;

        const timer = { intervalMinutes };
        fertilizerBuyTimers.set(type, timer);
        farmScheduler.setIntervalTask(task, intervalMinutes * 60_000, async () => {
            await runExclusiveAutomationTask(task, async () => {
                if (fertilizerBuyTimers.get(type) !== timer) return;
                await checkFertilizerBuyOnce(type);
            });
        });

        log('农场', `${type === 'organic' ? '有机' : '无机'}化肥自动购买检测定时器已启动，间隔 ${intervalMinutes} 分钟`, {
            module: 'farm', event: '购买化肥计时器', result: 'start', type, intervalMinutes,
        });
    }
}

function stopFertilizerBuyCheckTimer(): void {
    fertilizerBuyTimers.clear();
    for (const type of fertilizerBuyTypes) farmScheduler.clear(`fertilizer_buy_check_${type}`);
    log('农场', '化肥自动购买检测定时器已停止', {
        module: 'farm',
        event: '购买化肥计时器',
        result: 'stop',
    });
}

async function checkFertilizerBuyOnce(type?: FertilizerBuyType): Promise<void> {
    const buyOrganic = type !== 'normal' && isAutomationOn('fertilizer_buy_organic');
    const buyNormal = type !== 'organic' && isAutomationOn('fertilizer_buy_normal');
    if (!buyOrganic && !buyNormal) return;

    try {
        const options = {
            buyOrganic,
            buyNormal,
            organicCount: getFertilizerBuyOrganicCount(),
            organicThresholdHours: getFertilizerBuyOrganicThresholdHours(),
            normalCount: getFertilizerBuyNormalCount(),
            normalThresholdHours: getFertilizerBuyNormalThresholdHours(),
        };

        await checkAndBuyFertilizerBoth(options);
    } catch (e: any) {
        logWarn('农场', `化肥自动购买检测失败: ${e.message}`, {
            module: 'farm',
            event: 'fertilizer_auto_buy',
            result: 'error',
            error: e.message,
        });
    }
}

module.exports = {
    getYishuFarmStatus,
    plantYishuWhenFarmPaused,
    harvestYishuMatureLands,
    checkFarm,
    runFarmOperation,
    scheduleNextFarmCheck,
    startFarmCheckLoop,
    onLandsChangedPush,
    onFarmSocialEventsChangedPush,
    stopFarmCheckLoop,
    refreshFarmCheckLoop,
    startFertilizerBuyCheckTimer,
    stopFertilizerBuyCheckTimer,
    checkFertilizerBuyOnce,
};
