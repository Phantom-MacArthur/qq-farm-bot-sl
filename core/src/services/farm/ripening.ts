import type { FertilizerSettings } from '../../config/fertilizer-strategy';
import type { FertilizerMode } from '../../types/config';
import { getFertilizerStrategyGroups, usesRipeningFertilizer } from '../../config/fertilizer-strategy';

const {
    getAllLands, fertilizeBatch, fertilizeOrganicLoop, isFertilizerContainerEmpty,
    isFertilizerStockError, logFertilizerStockSkip, NORMAL_FERTILIZER_ID, ORGANIC_FERTILIZER_ID,
} = require('./api');
const {
    filterLandIdsByTypes,
    getFastMatureLands,
    getLandTypeByLevel,
    getNormalFertilizerTargetsFromLands,
} = require('./land-analysis');
const { log, toNum } = require('../../utils/utils');
const { recordOperation } = require('../stats');

export function isRipeningOnlyMode(mode: FertilizerMode): boolean {
    return mode === 'normal_ripen' || mode === 'organic_ripen';
}

export async function runRipeningFertilizer(
    automation: FertilizerSettings,
    lands?: any[],
    propagateErrors = false,
): Promise<number> {
    const groups = [...getFertilizerStrategyGroups(automation)].filter(([mode]) =>
        usesRipeningFertilizer(mode) && !isFertilizerContainerEmpty(ripeningFertilizerId(mode)));
    if (!groups.length) return 0;
    const snapshot = lands ?? (await getAllLands())?.lands;
    if (!Array.isArray(snapshot)) return 0;
    const roots = snapshot.filter(land => {
        const masterId = toNum(land?.master_land_id);
        return land && (!masterId || masterId === toNum(land.id));
    });
    const typesById = new Map<number, string>(roots.map(land => [toNum(land.id), getLandTypeByLevel(land.level)]));
    const fastMature = getFastMatureLands(roots, automation.fertilizer_smart_seconds);
    let total = 0;
    for (const [mode, landTypes] of groups) {
        const targets = [...new Set<number>(filterLandIdsByTypes(fastMature, typesById, landTypes))];
        total += await fertilizeRipeningTargets(mode, targets, roots, propagateErrors);
    }
    return total;
}

function ripeningFertilizerId(mode: FertilizerMode): number {
    return mode === 'normal_ripen' ? NORMAL_FERTILIZER_ID : ORGANIC_FERTILIZER_ID;
}

async function fertilizeRipeningTargets(mode: FertilizerMode, candidates: number[], roots: any[], propagateErrors: boolean): Promise<number> {
    let targets = candidates;
    const normal = mode === 'normal_ripen';
    const fertilizerId = ripeningFertilizerId(mode);
    if (isFertilizerContainerEmpty(fertilizerId)) return 0;
    if (normal) {
        const eligible = new Set<number>(getNormalFertilizerTargetsFromLands(roots));
        targets = targets.filter(landId => eligible.has(landId));
    }
    if (targets.length === 0) return 0;

    let count: number;
    if (mode === 'smart') {
        count = await fertilizeOrganicLoop(targets, propagateErrors);
    } else {
        let reply: any;
        try {
            reply = await fertilizeBatch(targets, fertilizerId);
        } catch (error) {
            if (!isFertilizerStockError(error)) throw error;
            logFertilizerStockSkip(error);
            return 0;
        }
        const updated = new Set<number>((Array.isArray(reply?.land) ? reply.land : []).map(land => toNum(land?.id)));
        count = targets.filter(landId => updated.has(landId)).length;
    }
    if (count > 0) {
        recordOperation('fertilize', count);
        log('施肥', `临熟催熟：${normal ? '普通化肥' : '有机化肥'}已施 ${count} 次`, {
            module: 'farm', event: '临熟催熟', result: 'ok', type: normal ? 'normal' : 'organic', count,
        });
    }
    return count;
}
