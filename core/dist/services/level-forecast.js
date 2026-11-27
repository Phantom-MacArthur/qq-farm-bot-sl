"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { getPlantById } = require('../config/gameConfig');
const { getServerTimeSec } = require('../utils/utils');
const SNAPSHOT_MAX_AGE_SEC = 180;
// 超过这个时间就算「陈旧」，需要重新拉一次土地快照。
const STALE_SNAPSHOT_SEC = 60;
const HISTORY_MIN_SECONDS = 60;
const num = (value) => Number(value?.toString?.() ?? value) || 0;
const seconds = (value) => num(value) > 1e12 ? Math.floor(num(value) / 1000) : num(value);
// Count each planted footprint once. Only the current season has a server-supplied maturity time.
function buildHarvestEvents(lands, nowSec, getPlant = getPlantById) {
    const events = [];
    const seen = new Set();
    const slaves = new Set();
    for (const land of lands)
        for (const id of land.slave_land_ids || [])
            slaves.add(num(id));
    for (const land of lands) {
        const id = num(land.id);
        const master = num(land.master_land_id);
        if (!id || seen.has(id) || !land.unlocked || slaves.has(id) || (master && master !== id))
            continue;
        seen.add(id);
        const plant = land.plant;
        if (!plant || !Array.isArray(plant.phases))
            continue;
        const phases = plant.phases.filter((phase) => seconds(phase.begin_time) > 0);
        // The protocol sends a suffix beginning with the current phase; clocks do not advance that state.
        const current = plant.phases[0];
        if (current && (num(current.phase) === 7 || num(current.phase) === 0))
            continue;
        const config = getPlant(num(plant.id));
        const configuredPhases = String(config?.grow_phases || '').split(';').filter(Boolean);
        const finalName = configuredPhases.at(-1)?.split(':')[0];
        const explicitMature = phases.find((phase) => [6, 19].includes(num(phase.phase)) || num(phase.phase_id) === 19);
        const finalPhase = phases.at(-1);
        const mature = explicitMature || (['成熟', '盛开'].includes(finalName)
            && plant.phases.length <= configuredPhases.length && num(finalPhase?.phase) === 2 ? finalPhase : null);
        if (!mature)
            continue;
        // Missing server bonus data is unknown, not a zero bonus guessed from the soil colour.
        if (!config || !land.buff || !Number.isFinite(Number(land.buff.plant_exp_bonus)))
            continue;
        const exp = Math.floor(num(config.exp) * (1 + Math.max(0, num(land.buff.plant_exp_bonus)) / 10000));
        if (exp <= 0)
            continue;
        events.push({ landId: id, at: Math.max(nowSec, seconds(mature.begin_time)), exp });
    }
    return events.sort((a, b) => a.at - b.at || a.landId - b.landId);
}
function calculateLevelForecast(options) {
    const { nowSec } = options;
    const remainingExp = Math.max(0, num(options.remainingExp));
    const base = { generatedAt: nowSec * 1000, remainingExp, scheduledExp: 0, plotCount: 0, readyExp: 0,
        estimatedAt: null, source: 'unavailable', automatic: !!options.autoHarvest && !options.quiet };
    if (!options.connected || remainingExp <= 0)
        return base;
    const events = buildHarvestEvents(options.lands || [], nowSec, options.getPlant);
    base.scheduledExp = events.reduce((sum, event) => sum + event.exp, 0);
    base.plotCount = events.length;
    base.readyExp = events.filter(event => event.at <= nowSec).reduce((sum, event) => sum + event.exp, 0);
    let total = 0;
    for (const event of events) {
        total += event.exp;
        if (total >= remainingExp)
            return { ...base, source: event.at <= nowSec ? 'ready' : 'planted', estimatedAt: event.at * 1000 };
    }
    // Do not count the same past farm harvest rate alongside scheduled harvests.
    // Extend the remaining gap only after the last known harvest, as a separate historical estimate.
    const rate = Math.max(0, num(options.historyRate));
    if (rate <= 0 || !base.automatic)
        return base;
    const startAt = events.length ? events[events.length - 1].at : nowSec;
    const estimatedAt = (startAt + Math.ceil((remainingExp - total) / rate * 3600)) * 1000;
    return { ...base, source: events.length ? 'mixed' : 'history', estimatedAt };
}
let revision = 0;
// 自家土地变化后快照内容已过期：旧数据留着展示，但要重新拉一次。
let snapshotDirty = true;
let snapshot = null;
// 收获/种植/施肥后土地已变化，只是在途的新快照还没回来。保留上一份快照用于展示，
// 避免状态同步恰好落在两次刷新之间时种植经验整栏闪烁消失。
function invalidateLandForecast() { revision++; snapshotDirty = true; }
function getLandForecastRevision() { return revision; }
function rememberLandForecast(lands, user, expectedRevision) {
    if (revision !== expectedRevision || !Array.isArray(lands))
        return;
    snapshot = { lands, gid: num(user.gid), exp: num(user.exp), at: getServerTimeSec() };
    snapshotDirty = false;
}
/**
 * 土地快照是否需要重新拉取。
 *
 * 巡田循环只在「农场自动化」开关打开时才会带出 AllLands 快照，所以这里单独给一个判定：
 * 快照缺失、过期或自家土地变动过时都算陈旧，登录后可以立刻补拉，
 * 不再出现「账号已经在线，种植经验却迟迟不出现」的情况。
 */
function isLandForecastStale(user) {
    if (!snapshot)
        return true;
    if (user && snapshot.gid !== num(user.gid))
        return true;
    const nowSec = getServerTimeSec();
    if (nowSec < snapshot.at)
        return true;
    return snapshotDirty || nowSec - snapshot.at >= STALE_SNAPSHOT_SEC;
}
function getLevelForecast(user, progress, stats, automation, quiet) {
    const nowSec = getServerTimeSec();
    // 只校验账号归属与时效：经验值随收获实时变化，用它做土地快照的新鲜度代理会让
    // 每次收获后种植经验消失到下次 AllLands 回来为止。
    const valid = !!(snapshot && snapshot.gid === num(user.gid)
        && nowSec >= snapshot.at && nowSec - snapshot.at <= SNAPSHOT_MAX_AGE_SEC);
    const connected = !!stats.connection?.connected;
    const sessionSeconds = Math.max(0, num(stats.sessionElapsedSeconds));
    const forecast = calculateLevelForecast({ lands: valid ? snapshot.lands : [], nowSec,
        remainingExp: progress ? num(progress.needed) - num(progress.current) : 0,
        historyRate: sessionSeconds >= HISTORY_MIN_SECONDS ? Math.max(0, num(stats.sessionExpGained)) / sessionSeconds * 3600 : 0,
        connected, autoHarvest: !!automation?.farm, quiet });
    // snapshotValid 用来区分「确实没有在田作物」和「快照暂时不可用」：
    // 前者要清掉前端缓存，后者要沿用上一次的有效值。
    const lands = valid && connected ? snapshot.lands.filter((land) => land.unlocked) : null;
    const occupiedIds = new Set();
    for (const land of lands || []) {
        const phase = num(land.plant?.phases?.[0]?.phase);
        if (!land.plant || phase === 0 || phase === 7)
            continue;
        occupiedIds.add(num(land.id));
        for (const id of land.slave_land_ids || [])
            occupiedIds.add(num(id));
    }
    return { ...forecast, snapshotValid: valid && connected,
        plantedLandCount: lands ? lands.filter((land) => occupiedIds.has(num(land.id))).length : null,
        unlockedLandCount: lands ? lands.length : null };
}
module.exports = { buildHarvestEvents, calculateLevelForecast, invalidateLandForecast, getLandForecastRevision, rememberLandForecast, isLandForecastStale, getLevelForecast };
//# sourceMappingURL=level-forecast.js.map