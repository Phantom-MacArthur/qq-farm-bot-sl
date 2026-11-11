export {};

const { getItemById, getItemImageById, getPlantByFruitId } = require('../config/gameConfig');
const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { toLong, toNum, logWarn } = require('../utils/utils');

export interface CareerHarvestItem {
    seedId: number;
    fruitId: number;
    name: string;
    image: string;
    harvestCount: number;
}

export interface CareerInfo {
    gid: number;
    items: CareerHarvestItem[];
    totalHarvestCount: number;
    totalStealCount: number;
    name: string;
    avatar: string;
    level: number;
    exp: number;
    platform: number;
    openId: string;
}

async function getCareerInfo(gid: number): Promise<CareerInfo> {
    const numericGid: number = toNum(gid);
    if (!numericGid) throw new Error('缺少有效的角色 GID');

    const body: Uint8Array = types.CareerInfoGetRequest.encode(types.CareerInfoGetRequest.create({
        gid: toLong(numericGid),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.careerpb.CareerService', 'CareerInfoGet', body);
    const reply: any = types.CareerInfoGetReply.toObject(
        types.CareerInfoGetReply.decode(replyBody),
        { longs: Number, defaults: true },
    );

    const items: CareerHarvestItem[] = (reply.harvest_items || reply.harvestItems || []).map((item: any) => {
        const fruitId: number = toNum(item.fruit_id ?? item.fruitId);
        const config = getItemById(fruitId);
        const plant = getPlantByFruitId(fruitId);
        return {
            seedId: fruitId,
            fruitId,
            name: config?.name || plant?.name || `果实${fruitId}`,
            image: getItemImageById(fruitId),
            harvestCount: toNum(item.harvest_count ?? item.harvestCount),
        };
    });

    return {
        gid: toNum(reply.gid) || numericGid,
        items,
        totalHarvestCount: toNum(reply.total_harvest_count ?? reply.totalHarvestCount),
        totalStealCount: toNum(reply.total_steal_count ?? reply.totalStealCount),
        name: String(reply.name || ''),
        avatar: String((reply.avatar_url ?? reply.avatarUrl) || ''),
        level: toNum(reply.level),
        exp: toNum(reply.exp),
        platform: toNum(reply.platform),
        openId: String((reply.open_id ?? reply.openId) || ''),
    };
}

async function getCareerInfoOrNull(gid: number, propagateErrors: boolean = false): Promise<CareerInfo | null> {
    try {
        return await getCareerInfo(gid);
    } catch (error: any) {
        if (propagateErrors) throw error;
        logWarn('生涯', `查询失败: ${error && error.message ? error.message : error}`);
        return null;
    }
}

module.exports = { getCareerInfo, getCareerInfoOrNull };
