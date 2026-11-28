"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fertilizer_strategy_1 = require("../../config/fertilizer-strategy");
const yishuhuanfu_1 = require("../../config/yishuhuanfu");
const yishuhuanfu_history_1 = require("../yishuhuanfu-history");
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
const { getAllLands, harvest, farming, unlockLand, upgradeLand, removePlant, isFertilizerContainerEmpty, NORMAL_FERTILIZER_ID, ORGANIC_FERTILIZER_ID, } = require('./api');
const { analyzeLands, buildLandDetail, getCurrentPhase, isExplicitMaturePhase, getCleanableFarmSocialEventItemIds, getNormalFertilizerTargetsFromLands, resolveRemovableHarvestedLands, getLandTypeByLevel, filterLandIdsByTypes, ALL_FERTILIZER_LAND_TYPES, } = require('./land-analysis');
const { autoPlantEmptyLands, getRemainingPlantDelayMs, runFertilizerByConfig, plantYishuLands } = require('./planting');
const { runRipeningFertilizer } = require('./ripening');
const { checkAndBuyFertilizerBoth } = require('../mall');
// 延迟加载以打破循环依赖: visit-strategy → farm/index → scheduler → visit-strategy
function inFarmQuietHours() {
    return require('../friend/visit-strategy').inFarmQuietHours();
}
// ============ 内部状态 ============
let isCheckingFarm = false;
let isFirstFarmCheck = true;
let farmLoopRunning = false;
let externalSchedulerMode = false;
let farmLoopGeneration = 0;
let automaticPlantPacing = { lastPlantAt: null, defer: true };
const farmScheduler = createScheduler('farm');
const landDeadlines = new Map();
const pendingHarvest = new Map();
const lastHarvestAttempt = new Map();
let maturityAt = Infinity;
let pushCheckAt = Infinity;
let scheduledAt = Infinity;
let wakeQueued = false;
let nextOrdinaryPushAt = 0;
// ============ 农场循环 ============
function canContinueFarm(generation) {
    return generation === farmLoopGeneration
        && !!getUserState().gid && isAutomationOn('farm') && !inFarmQuietHours();
}
function cropKey(land) {
    const plant = land.plant;
    return `${plant.id}:${plant.season}:${plant.phases[0].begin_time}`;
}
function maturePushKey(land) {
    if (!land?.unlocked || !isExplicitMaturePhase(land.plant?.phases?.[0]))
        return '';
    const master = toNum(land.master_land_id);
    return master && master !== toNum(land.id) ? '' : cropKey(land);
}
function isTiangongCrop(plantId) {
    return Number(getItemById(getPlantById(plantId)?.seed_id)?.rarity) === 4;
}
function armFarmWake() {
    const at = farmLoopRunning && canContinueFarm(farmLoopGeneration) ? Math.min(maturityAt, pushCheckAt) : Infinity;
    if (wakeQueued || isCheckingFarm || at === scheduledAt)
        return;
    farmScheduler.clear('farm_push_check');
    scheduledAt = at;
    if (!Number.isFinite(at))
        return;
    const generation = farmLoopGeneration;
    farmScheduler.setTimeoutTask('farm_push_check', Math.max(0, at - Date.now()), async () => {
        scheduledAt = Infinity;
        wakeQueued = true;
        try {
            await runExclusiveAutomationTask('farm_push_check', async () => {
                if (generation !== farmLoopGeneration)
                    return;
                if (!canContinueFarm(generation)) {
                    pendingHarvest.clear();
                    pushCheckAt = Infinity;
                    return;
                }
                if (Math.min(maturityAt, pushCheckAt) > Date.now())
                    return;
                await runWithRequestClass('farm', checkFarm);
            }, { detached: true });
        }
        finally {
            if (generation === farmLoopGeneration) {
                wakeQueued = false;
                armFarmWake();
            }
        }
    });
}
function rememberMaturity(land) {
    const id = toNum(land.id);
    landDeadlines.delete(id);
    const master = toNum(land.master_land_id);
    const phases = land.plant?.phases;
    if (!land.unlocked || (master && master !== id) || !phases || phases.length < 2)
        return;
    const plantId = toNum(land.plant.id);
    const current = getCurrentPhase(phases, false, '', plantId)?.phase;
    if (!current || current === PlantPhase.MATURE || current === PlantPhase.DEAD)
        return;
    const last = phases[phases.length - 1];
    const mature = phases.find(isExplicitMaturePhase)
        || (getCurrentPhase([last], false, '', plantId)?.phase === PlantPhase.MATURE ? last : null);
    if (!mature)
        return;
    const now = Date.now();
    const due = serverTimeToLocalMs(toTimeSec(mature.begin_time) * 1000);
    // 到点仍报生长中时，在成熟时刻后的 300ms 补查一次。
    const at = due > now ? due : due + 300;
    if (at > now)
        landDeadlines.set(id, { at, plantId });
}
function updateMaturityWake() {
    const skipTiangong = getAutomation().farm_harvest_tiangong === false;
    maturityAt = Infinity;
    for (const { at, plantId } of landDeadlines.values()) {
        if (!skipTiangong || !isTiangongCrop(plantId))
            maturityAt = Math.min(maturityAt, at);
    }
    armFarmWake();
}
function observeFarmLands(lands, full = false) {
    if (full) {
        landDeadlines.clear();
        for (const [id, pending] of pendingHarvest) {
            const current = lands.find(land => toNum(land.id) === id);
            if (maturePushKey(current) !== cropKey(pending))
                pendingHarvest.delete(id);
        }
    }
    for (const land of lands) {
        rememberMaturity(land);
        if (!full)
            pendingHarvest.delete(toNum(land.id));
    }
    updateMaturityWake();
}
function schedulePlantContinuation(generation, pacing, delayMs) {
    if (!farmLoopRunning || !canContinueFarm(generation) || pacing !== automaticPlantPacing || !pacing.deferred)
        return;
    farmScheduler.setTimeoutTask('farm_plant_continue', delayMs ?? getRemainingPlantDelayMs(pacing), async () => {
        // 计时器会继承创建时的异步上下文，必须独立入队，不能当作旧锁的重入。
        await runExclusiveAutomationTask('farm_plant_continue', async () => {
            if (!farmLoopRunning || !canContinueFarm(generation) || pacing !== automaticPlantPacing)
                return;
            await checkFarm();
        }, { detached: true });
    });
}
async function checkFarm() {
    const state = getUserState();
    if (isCheckingFarm || !state.gid || !isAutomationOn('farm'))
        return false;
    if (inFarmQuietHours())
        return false;
    const generation = farmLoopGeneration;
    const pacing = automaticPlantPacing;
    farmScheduler.clear('farm_plant_continue');
    pacing.deferred = false;
    isCheckingFarm = true;
    if (pushCheckAt <= Date.now())
        nextOrdinaryPushAt = Date.now() + 500;
    pushCheckAt = Infinity;
    if (maturityAt <= Date.now()) {
        for (const [id, deadline] of landDeadlines)
            if (deadline.at <= Date.now())
                landDeadlines.delete(id);
        updateMaturityWake();
    }
    try {
        // 复用手动操作逻辑
        const result = await runFarmOperation('all', null, false, { generation, pacing });
        isFirstFarmCheck = false;
        return !!(result && result.hadWork);
    }
    catch (err) {
        logWarn('巡田', `检查失败: ${err.message}`);
        return false;
    }
    finally {
        isCheckingFarm = false;
        schedulePlantContinuation(generation, pacing);
        armFarmWake();
    }
}
/** 多季补肥统一返回实际施肥地块数，供一键打理汇总“施肥”计数；actions 传入时同步追加文案。 */
async function runMultiSeasonFertilizer(growingLandIds, propagateErrors = false, actions) {
    if (!isAutomationOn('fertilizer_multi_season'))
        return 0;
    const groups = (0, fertilizer_strategy_1.getFertilizerStrategyGroups)(getAutomation());
    const normalAvailable = !isFertilizerContainerEmpty(NORMAL_FERTILIZER_ID);
    const organicAvailable = !isFertilizerContainerEmpty(ORGANIC_FERTILIZER_ID);
    if (![...groups.keys()].some(mode => (normalAvailable && (0, fertilizer_strategy_1.usesNormalFertilizer)(mode))
        || (organicAvailable && (0, fertilizer_strategy_1.usesImmediateOrganicFertilizer)(mode))))
        return 0;
    const multiSeasonTargets = [...new Set((Array.isArray(growingLandIds) ? growingLandIds : []).map((v) => toNum(v)).filter(Boolean))];
    if (multiSeasonTargets.length === 0)
        return 0;
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
        if (applied > 0 && actions)
            actions.push(`多季补肥${applied}`);
        return applied;
    }
    catch (e) {
        logWarn('施肥', `多季补肥执行失败: ${e.message}`, {
            module: 'farm',
            event: '多季节施肥',
            result: 'error',
        });
        if (propagateErrors)
            throw e;
        return 0;
    }
}
// 收获日志带作物名：QQ 机器人推送要靠它查物品图（事件名后面的小图标）
function firstCropName(lands, ids) {
    for (const land of lands) {
        if (!ids.includes(toNum(land.id)))
            continue;
        const plantId = toNum(land.plant?.id);
        if (!plantId)
            continue;
        const name = String(getPlantById(plantId)?.name || land.plant?.name || '').trim();
        if (name)
            return name;
    }
    return '';
}
function autoHarvestLandIds(status) {
    const automation = getAutomation();
    const excluded = new Set((status.harvestableInfo || [])
        .filter((info) => (automation.farm_harvest_tiangong === false && isTiangongCrop(info.plantId))
        || (automation.yishu_harvest === false && toNum(getPlantById(info.plantId)?.seed_id) === yishuhuanfu_1.YISHU_SEED_ID))
        .map((info) => info.landId));
    return status.harvestable.filter((id) => !excluded.has(id));
}
function isYishuCrop(land) {
    return toNum(getPlantById(toNum(land.plant?.id))?.seed_id) === yishuhuanfu_1.YISHU_SEED_ID;
}
function recordYishuHarvest(lands, harvestedIds) {
    const count = lands.filter(land => harvestedIds.includes(toNum(land.id)) && isYishuCrop(land)).length;
    if (!count)
        return;
    try {
        (0, yishuhuanfu_history_1.appendYishuHistory)(process.env.FARM_ACCOUNT_ID || '', getServerTimeSec(), { type: 'harvest', count });
    }
    catch (error) {
        logWarn('收获', `写入以薯换福活动日志失败：${error.message}`);
    }
}
async function harvestYishuMatureLands() {
    if (getAutomation().yishu_harvest !== true)
        return 0;
    return runExclusiveAutomationTask('yishuhuanfu-harvest', async () => {
        if (!(0, yishuhuanfu_1.getYishuActivityEnd)(getServerTimeSec()) || getAutomation().yishu_harvest !== true)
            return 0;
        const { lands } = await getAllLands();
        const ripe = analyzeLands(lands, false, getUserState().gid).harvestable;
        const ids = lands.filter((land) => isYishuCrop(land) && ripe.includes(toNum(land.id))).map((land) => toNum(land.id));
        if (!ids.length)
            return 0;
        const reply = await harvest(ids, false);
        const confirmed = ids.filter(id => reply.land?.some((land) => toNum(land.id) === id));
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
        crops: lands.filter(isYishuCrop).map((land) => {
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
    if (isAutomationOn('farm') || getAutomation().yishu_plant !== true || !(0, yishuhuanfu_1.getYishuActivityEnd)(getServerTimeSec()))
        return 0;
    const { lands } = await getAllLands();
    const empty = analyzeLands(lands, false, getUserState().gid).empty;
    return (await plantYishuLands(lands, empty, { lastPlantAt: null }))?.planted || 0;
}
/**
 * 催熟施肥后只重查并收获一次，避免形成请求循环。
 * 跟随收获也会走多季补肥：这批作物进入下一季后，主循环里的补肥已经跑完了。
 */
async function harvestMatureOwnLandsOnce(actions, propagateErrors = false, counts) {
    let latest;
    try {
        latest = await getAllLands();
    }
    catch (e) {
        logWarn('收获', `施肥后刷新土地失败: ${e.message}`);
        if (propagateErrors)
            throw e;
        return 0;
    }
    const lands = Array.isArray(latest && latest.lands) ? latest.lands : [];
    if (lands.length === 0)
        return 0;
    const ownGid = toNum(getUserState().gid);
    const harvestable = autoHarvestLandIds(analyzeLands(lands, false, ownGid));
    if (harvestable.length === 0)
        return 0;
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
        if (counts)
            counts.harvest += harvestable.length;
        const followUpFertilized = await runMultiSeasonFertilizer(classified.growing, propagateErrors, actions);
        if (counts)
            counts.fertilize += followUpFertilized;
        return harvestable.length;
    }
    catch (e) {
        logWarn('收获', `施肥后立即收获失败: ${e.message}`, {
            module: 'farm',
            event: '施肥后收获作物',
            result: 'error',
        });
        if (propagateErrors)
            throw e;
        return 0;
    }
}
function createFarmOperationCounts() {
    return { harvest: 0, farming: 0, plant: 0, upgrade: 0, fertilize: 0 };
}
/**
 * 手动/自动执行农场操作
 * @param opType - 'all', 'harvest', 'clear', 'plant_empty', 'upgrade', 'remove'
 */
async function runFarmOperation(opType, targetLandIdInput = null, propagateErrors = false, automatic) {
    if (opType === 'plant')
        throw new Error('独立种植操作已移除，请使用一键打理');
    if (!['all', 'harvest', 'clear', 'plant_empty', 'upgrade', 'remove'].includes(opType)) {
        throw new Error('未知农场操作');
    }
    const batchTargets = Array.isArray(targetLandIdInput)
        ? new Set(targetLandIdInput.map(id => toNum(id))) : null;
    if (batchTargets && (!['clear', 'harvest'].includes(opType) || !batchTargets.size
        || [...batchTargets].some(id => !Number.isSafeInteger(id) || id <= 0))) {
        throw new Error('批量务农或收获需要有效的地块编号');
    }
    const counts = createFarmOperationCounts();
    const actions = [];
    const warnings = [];
    const harvestedLandIds = [];
    const harvestReply = { land: [] };
    const pushedIds = new Set();
    async function collectHarvest(ids, source, isAll) {
        if (!ids.length)
            return;
        for (const land of source) {
            if (land.plant?.phases?.length && ids.includes(toNum(land.id)))
                lastHarvestAttempt.set(toNum(land.id), cropKey(land));
        }
        try {
            const reply = await harvest(ids, isAll);
            const updated = reply.land || [];
            const completed = isAll ? ids : ids.filter(id => updated.some((land) => toNum(land.id) === id));
            if (!completed.length)
                return;
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
        }
        catch (e) {
            logWarn('收获', e.message, { module: 'farm', event: '收获作物', result: 'error' });
            if (propagateErrors)
                throw e;
        }
    }
    if (automatic && pendingHarvest.size) {
        const lands = [...pendingHarvest.values()].filter(land => lastHarvestAttempt.get(toNum(land.id)) !== cropKey(land));
        pendingHarvest.clear();
        if (lands.length && isAutomationOn('farm_push')) {
            const ids = autoHarvestLandIds(analyzeLands(lands, false, getUserState().gid));
            for (const id of ids)
                pushedIds.add(id);
            await collectHarvest(ids, lands, false);
        }
    }
    const landsReply = await getAllLands();
    if (automatic && !canContinueFarm(automatic.generation))
        return { hadWork: actions.length > 0, actions, counts };
    if (!landsReply.lands || landsReply.lands.length === 0) {
        if (opType !== 'all') {
            log('农场', '没有土地数据');
        }
        return { hadWork: actions.length > 0, actions, counts };
    }
    const lands = landsReply.lands;
    let fertilizerSnapshot = lands;
    const state = getUserState();
    const status = analyzeLands(lands, isFirstFarmCheck, state.gid);
    const socialEventItemIds = getCleanableFarmSocialEventItemIds(landsReply);
    const hasTargetLandId = !batchTargets && targetLandIdInput !== null
        && targetLandIdInput !== undefined
        && String(targetLandIdInput).trim() !== '';
    const targetLandId = hasTargetLandId ? toNum(targetLandIdInput) : 0;
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
        if (counts.plant)
            recordOperation('plant', counts.plant);
        return { hadWork: counts.plant > 0, counts, actions: counts.plant ? [`种植${counts.plant}`] : [] };
    }
    // 摘要
    const statusParts = [];
    if (status.harvestable.length)
        statusParts.push(`收:${status.harvestable.length}`);
    const farmingCount = new Set([...status.needWeed, ...status.needBug, ...status.needInteractionCleanup]).size
        + socialEventItemIds.length;
    if (farmingCount > 0)
        statusParts.push(`农:${farmingCount}`);
    if (status.needWater.length)
        statusParts.push(`水:${status.needWater.length}`);
    if (status.dead.length)
        statusParts.push(`枯:${status.dead.length}`);
    if (status.empty.length)
        statusParts.push(`空:${status.empty.length}`);
    if (status.unlockable.length)
        statusParts.push(`解:${status.unlockable.length}`);
    if (status.upgradable.length)
        statusParts.push(`升:${status.upgradable.length}`);
    statusParts.push(`长:${status.growing.length}`);
    const harvestFromRead = async () => {
        const candidates = opType === 'all' ? autoHarvestLandIds(status)
            : hasTargetLandId ? status.harvestable.filter((id) => id === targetLandId) : status.harvestable;
        const ids = candidates.filter(id => !pushedIds.has(id) && (!batchTargets || batchTargets.has(id)));
        if (ids.length) {
            fertilizerSnapshot = undefined;
            await collectHarvest(ids, lands, !hasTargetLandId && !batchTargets && !pushedIds.size && ids.length === status.harvestable.length);
        }
    };
    if (automatic)
        await harvestFromRead();
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
        }
        catch (e) {
            logWarn('铲除', `土地#${targetLandId}铲除失败: ${e.message}`, {
                module: 'farm',
                event: '铲除植物',
                result: 'error',
                landId: targetLandId,
            });
            if (propagateErrors)
                throw e;
        }
    }
    // 执行一键务农 (除草+除虫+浇水) - 串行执行以降低并发压力
    if (opType === 'all' || opType === 'clear') {
        // 检查是否跳过一键务农（仅自动模式生效，手动clear不受影响）
        const skipOwnWeedBug = !!automatic && isAutomationOn('skip_own_weed_bug');
        let farmingLandIds = [...new Set([
                ...status.needWeed,
                ...status.needBug,
                ...status.needWater,
                ...status.needInteractionCleanup,
            ])];
        const validSingleLandIds = new Set([
            ...status.growing,
            ...status.harvestable,
            ...status.dead,
        ]);
        if (batchTargets)
            farmingLandIds = farmingLandIds.filter(id => batchTargets.has(id));
        if (hasTargetLandId) {
            if (!validSingleLandIds.has(targetLandId)) {
                throw new Error(`土地#${targetLandId} 当前不能执行务农`);
            }
            const targetNeedsFarming = farmingLandIds.includes(targetLandId);
            farmingLandIds = targetNeedsFarming || socialEventItemIds.length > 0 ? [targetLandId] : [];
        }
        else if (socialEventItemIds.length > 0 && farmingLandIds.length === 0) {
            // 青蛙属于农场级事件，但 Farming 仍需携带一块有效作物地；官方单点抓包也是该结构。
            const fallbackLandId = [...validSingleLandIds].find(id => !batchTargets || batchTargets.has(id)) || 0;
            if (fallbackLandId > 0)
                farmingLandIds = [fallbackLandId];
        }
        if (!skipOwnWeedBug && farmingLandIds.length > 0) {
            fertilizerSnapshot = undefined;
            try {
                const reply = await farming(farmingLandIds, socialEventItemIds);
                const updatedIds = new Set([
                    ...(reply?.land || []).map((land) => toNum(land.id)),
                    ...(reply?.results || []).map((result) => toNum(result.land_id)),
                ]);
                const confirmed = farmingLandIds.filter(id => updatedIds.has(id));
                const cleanedEvents = new Set((reply?.social_event_rewards || []).map((event) => toNum(event.item_id)));
                const cleanedCount = socialEventItemIds.filter(id => cleanedEvents.has(id)).length;
                if (cleanedCount && !confirmed.length)
                    confirmed.push(farmingLandIds[0]);
                if (confirmed.length < farmingLandIds.length || cleanedCount < socialEventItemIds.length) {
                    warnings.push('部分务农结果未获游戏确认，请核对土地状态');
                }
                const countConfirmed = (ids) => ids.filter(id => confirmed.includes(id)).length;
                const weeds = countConfirmed(status.needWeed);
                const bugs = countConfirmed(status.needBug);
                const water = countConfirmed(status.needWater);
                const items = countConfirmed(status.needInteractionCleanup);
                const parts = [];
                if (weeds)
                    parts.push(`草${weeds}`);
                if (bugs)
                    parts.push(`虫${bugs}`);
                if (water)
                    parts.push(`水${water}`);
                if (items)
                    parts.push(`道具${items}`);
                if (cleanedCount)
                    parts.push(`青蛙${cleanedCount}`);
                if (confirmed.length && hasTargetLandId) {
                    actions.push(`单点务农#${targetLandId}${parts.length ? `(${parts.join('/')})` : ''}`);
                }
                else if (confirmed.length) {
                    actions.push(`一键务农: ${confirmed.length} 块${parts.length ? `（${parts.join('，')}）` : ''}`);
                }
                counts.farming += confirmed.length;
            }
            catch (e) {
                logWarn(hasTargetLandId ? '单点务农' : '一键务农', e.message);
                if (!automatic && opType === 'all' && e.name === 'GatewayError') {
                    warnings.push(`务农失败：${e.errorMessage || e.message}`);
                }
                else if (hasTargetLandId || propagateErrors)
                    throw e;
            }
        }
    }
    // 执行收获
    let postHarvest = null;
    if (!automatic && (opType === 'all' || opType === 'harvest'))
        await harvestFromRead();
    // 执行种植
    if (opType === 'all') {
        const targetLandIds = hasTargetLandId ? [targetLandId] : undefined;
        const allEmptyLands = [...new Set(status.empty)]
            .filter((id) => !hasTargetLandId || id === targetLandId);
        let allDeadLands = [...new Set(status.dead)]
            .filter((id) => !hasTargetLandId || id === targetLandId);
        if (opType === 'all' && harvestedLandIds.length > 0) {
            // 收获后延迟再铲除枯地
            if (automatic)
                await randomDelay(1000, 1500);
            postHarvest = await resolveRemovableHarvestedLands(harvestedLandIds, harvestReply);
            allDeadLands = [...new Set([...allDeadLands, ...postHarvest.removable])];
        }
        if (allDeadLands.length > 0 || allEmptyLands.length > 0) {
            try {
                if (automatic && !canContinueFarm(automatic.generation))
                    return { hadWork: actions.length > 0, actions, counts };
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
                if (deferredCount > 0)
                    actions.push(`预留${deferredCount}`);
            }
            catch (e) {
                logWarn('种植', e.message);
                if (propagateErrors)
                    throw e;
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
            ? status.upgradable.filter((id) => id === targetLandId)
            : status.upgradable;
        if (unlockable.length > 0 || upgradable.length > 0)
            fertilizerSnapshot = undefined;
        if (unlockable.length > 0) {
            let unlocked = 0;
            for (const landId of unlockable) {
                try {
                    await unlockLand(landId, false);
                    log('解锁', `土地#${landId} 解锁成功`, {
                        module: 'farm', event: '解锁土地', result: 'ok', landId
                    });
                    unlocked++;
                }
                catch (e) {
                    logWarn('解锁', `土地#${landId} 解锁失败: ${e.message}`, {
                        module: 'farm', event: '解锁土地', result: 'error', landId
                    });
                    if (propagateErrors)
                        throw e;
                }
                if (automatic || landId !== unlockable.at(-1) || upgradable.length)
                    await randomDelay(1000, 1500);
            }
            if (unlocked > 0) {
                actions.push(`解锁${unlocked}`);
                counts.upgrade += unlocked;
            }
        }
        if (upgradable.length > 0) {
            let upgraded = 0;
            for (const landId of upgradable) {
                try {
                    const reply = await upgradeLand(landId);
                    const newLevel = reply.land ? toNum(reply.land.level) : '?';
                    log('升级', `土地#${landId} 升级成功 → 等级${newLevel}`, {
                        module: 'farm', event: '升级土地', result: 'ok', landId, level: newLevel
                    });
                    upgraded++;
                }
                catch (e) {
                    log('升级', `土地#${landId} 升级失败: ${e.message}`, {
                        module: 'farm', event: '升级土地', result: 'error', landId
                    });
                    if (propagateErrors)
                        throw e;
                }
                if (automatic || landId !== upgradable.at(-1))
                    await randomDelay(1000, 1500);
            }
            if (upgraded > 0) {
                actions.push(`升级${upgraded}`);
                counts.upgrade += upgraded;
            }
        }
    }
    if (opType === 'all') {
        if (automatic && !canContinueFarm(automatic.generation))
            return { hadWork: actions.length > 0, actions, counts };
        const automation = getAutomation();
        const groups = [...(0, fertilizer_strategy_1.getFertilizerStrategyGroups)(automation)];
        const normalAvailable = !isFertilizerContainerEmpty(NORMAL_FERTILIZER_ID);
        const organicAvailable = !isFertilizerContainerEmpty(ORGANIC_FERTILIZER_ID);
        const catchUpLandTypes = groups
            .filter(([mode]) => (normalAvailable && (0, fertilizer_strategy_1.usesNormalFertilizer)(mode)) || (organicAvailable && mode === 'both'))
            .flatMap(([, types]) => types);
        if (isAutomationOn('fertilizer_multi_season') && catchUpLandTypes.length) {
            try {
                const latest = fertilizerSnapshot ?? (await getAllLands())?.lands;
                const latestLands = Array.isArray(latest) ? latest : [];
                fertilizerSnapshot = latestLands;
                let targets = getNormalFertilizerTargetsFromLands(latestLands);
                if (catchUpLandTypes.length < ALL_FERTILIZER_LAND_TYPES.length) {
                    const landTypeById = new Map();
                    for (const land of latestLands) {
                        if (!land)
                            continue;
                        const landId = toNum(land.id);
                        if (!landId)
                            continue;
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
                    if (applied > 0)
                        actions.push(`补肥${applied}`);
                    counts.fertilize += applied;
                }
            }
            catch (e) {
                logWarn('施肥', `巡田补肥失败: ${e.message}`, {
                    module: 'farm',
                    event: '多季节施肥',
                    result: 'error',
                });
                if (propagateErrors)
                    throw e;
            }
        }
        if (groups.some(([mode]) => (0, fertilizer_strategy_1.usesRipeningFertilizer)(mode))) {
            try {
                const count = await runRipeningFertilizer(automation, fertilizerSnapshot, propagateErrors);
                if (count > 0) {
                    actions.push(`催熟${count}`);
                    counts.fertilize += count;
                    await harvestMatureOwnLandsOnce(actions, propagateErrors, counts);
                }
            }
            catch (e) {
                logWarn('施肥', `巡田时施肥失败: ${e.message}`);
                if (propagateErrors)
                    throw e;
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
    return { hadWork: actions.length > 0, actions, counts, ...(warnings.length ? { warnings } : {}) };
}
function scheduleNextFarmCheck(delayMs = CONFIG.farmCheckInterval) {
    if (externalSchedulerMode)
        return;
    if (!farmLoopRunning)
        return;
    farmScheduler.setTimeoutTask('farm_check_loop', Math.max(0, delayMs), async () => {
        if (!farmLoopRunning)
            return;
        await runExclusiveAutomationTask('farm_check_loop', checkFarm);
        if (!farmLoopRunning)
            return;
        scheduleNextFarmCheck(CONFIG.farmCheckInterval);
    });
}
function startFarmCheckLoop(options = {}) {
    if (farmLoopRunning)
        return;
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
function queuePushCheck(urgent, social, count) {
    if (!canContinueFarm(farmLoopGeneration) || (isCheckingFarm && !urgent))
        return;
    const now = Date.now();
    const at = urgent ? now : Math.max(now + 100, nextOrdinaryPushAt);
    if (at >= pushCheckAt)
        return;
    pushCheckAt = at;
    log('农场', social ? `收到农场社交事件推送: ${count}个，检查中...` : `收到推送: ${count}块土地变化，检查中...`, {
        module: 'farm', event: social ? '农场社交事件通知' : '土地推送通知', result: 'trigger_check', count,
    });
    armFarmWake();
}
function onLandsChangedPush(lands, hostGid) {
    const own = !!hostGid && hostGid === getUserState().gid;
    const enabled = isAutomationOn('farm_push') && canContinueFarm(farmLoopGeneration);
    for (const land of lands) {
        const id = toNum(land.id);
        pendingHarvest.delete(id);
        if (!own)
            continue;
        rememberMaturity(land);
        const key = enabled && maturePushKey(land);
        if (key && lastHarvestAttempt.get(id) !== key
            && (getAutomation().farm_harvest_tiangong !== false || !isTiangongCrop(toNum(land.plant.id))))
            pendingHarvest.set(id, land);
    }
    if (own)
        updateMaturityWake();
    if (enabled)
        queuePushCheck(pendingHarvest.size > 0, false, lands.length);
}
function onFarmSocialEventsChangedPush(events) {
    if (isAutomationOn('farm_push'))
        queuePushCheck(false, true, events.length);
}
function stopFarmCheckLoop() {
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
function refreshFarmCheckLoop(delayMs = 200) {
    if (!farmLoopRunning)
        return;
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
const fertilizerBuyTypes = ['organic', 'normal'];
const fertilizerBuyTimers = new Map();
function startFertilizerBuyCheckTimer() {
    for (const type of fertilizerBuyTypes) {
        const task = `fertilizer_buy_check_${type}`;
        if (!isAutomationOn(`fertilizer_buy_${type}`)) {
            farmScheduler.clear(task);
            fertilizerBuyTimers.delete(type);
            continue;
        }
        const intervalMinutes = type === 'organic'
            ? getFertilizerBuyCheckIntervalMinutes() : getFertilizerBuyNormalCheckIntervalMinutes();
        if (fertilizerBuyTimers.get(type)?.intervalMinutes === intervalMinutes && farmScheduler.has(task))
            continue;
        const timer = { intervalMinutes };
        fertilizerBuyTimers.set(type, timer);
        farmScheduler.setIntervalTask(task, intervalMinutes * 60_000, async () => {
            await runExclusiveAutomationTask(task, async () => {
                if (fertilizerBuyTimers.get(type) !== timer)
                    return;
                await checkFertilizerBuyOnce(type);
            });
        });
        log('农场', `${type === 'organic' ? '有机' : '无机'}化肥自动购买检测定时器已启动，间隔 ${intervalMinutes} 分钟`, {
            module: 'farm', event: '购买化肥计时器', result: 'start', type, intervalMinutes,
        });
    }
}
function stopFertilizerBuyCheckTimer() {
    fertilizerBuyTimers.clear();
    for (const type of fertilizerBuyTypes)
        farmScheduler.clear(`fertilizer_buy_check_${type}`);
    log('农场', '化肥自动购买检测定时器已停止', {
        module: 'farm',
        event: '购买化肥计时器',
        result: 'stop',
    });
}
async function checkFertilizerBuyOnce(type) {
    const buyOrganic = type !== 'normal' && isAutomationOn('fertilizer_buy_organic');
    const buyNormal = type !== 'organic' && isAutomationOn('fertilizer_buy_normal');
    if (!buyOrganic && !buyNormal)
        return;
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
    }
    catch (e) {
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
//# sourceMappingURL=scheduler.js.map