"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * 月卡礼包
 */
const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { log, toNum, getSystemDateKey } = require('../utils/utils');
const { describeRewardItems } = require('../utils/reward-items');
const { recordFarmReward } = require('./farm-reward-history');
const DAILY_KEY = 'month_card_gift';
const CHECK_COOLDOWN_MS = 10 * 60 * 1000;
// doneDateKey 只表示「今天查过了、不用再轮询」，不等于已领取；是否领到看 claimedDateKey。
let doneDateKey = '';
let claimedDateKey = '';
let lastCheckAt = 0;
let lastClaimAt = 0;
let lastResult = '';
let lastHasCard = null;
let lastHasClaimable = null;
let lastRewards = [];
function markDoneToday() {
    doneDateKey = getSystemDateKey();
}
function isDoneToday() {
    return doneDateKey === getSystemDateKey();
}
function isClaimedToday() {
    return claimedDateKey === getSystemDateKey();
}
function getRewardSummary(items) {
    const list = Array.isArray(items) ? items : [];
    const summary = [];
    for (const it of list) {
        const id = toNum(it.id);
        const count = toNum(it.count);
        if (count <= 0)
            continue;
        if (id === 1 || id === 1001)
            summary.push(`金币${count}`);
        else if (id === 2 || id === 1101)
            summary.push(`经验${count}`);
        else if (id === 1002)
            summary.push(`点券${count}`);
        else
            summary.push(`物品#${id}x${count}`);
    }
    return summary.join('/');
}
async function getMonthCardInfos() {
    const body = types.GetMonthCardInfosRequest.encode(types.GetMonthCardInfosRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.mallpb.MallService', 'GetMonthCardInfos', body);
    return types.GetMonthCardInfosReply.decode(replyBody);
}
async function claimMonthCardReward(goodsId) {
    const body = types.ClaimMonthCardRewardRequest.encode(types.ClaimMonthCardRewardRequest.create({
        goods_id: Number(goodsId) || 0,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.mallpb.MallService', 'ClaimMonthCardReward', body);
    return types.ClaimMonthCardRewardReply.decode(replyBody);
}
async function performDailyMonthCardGift(force = false) {
    const now = Date.now();
    if (!force && isDoneToday())
        return false;
    if (!force && now - lastCheckAt < CHECK_COOLDOWN_MS)
        return false;
    lastCheckAt = now;
    try {
        const rep = await getMonthCardInfos();
        const infos = Array.isArray(rep && rep.infos) ? rep.infos : [];
        const claimable = infos.filter((x) => x && x.can_claim && Number(x.goods_id || 0) > 0);
        // 服务器对没买月卡的账号也会返回月卡条目（can_claim=false），条目存在不代表已开通；
        // 只有能领或今天领过才能确认有卡，否则无法区分「未开通」和「已在游戏内领过」。
        lastHasCard = infos.length === 0 ? false : (claimable.length > 0 || isClaimedToday() ? true : null);
        lastHasClaimable = claimable.length > 0;
        if (claimable.length > 0)
            lastRewards = describeRewardItems(claimable.map((x) => x.reward));
        else if (!isClaimedToday())
            lastRewards = [];
        if (!infos.length) {
            markDoneToday();
            lastResult = 'none';
            log('月卡', '当前没有月卡或已过期', {
                module: 'task',
                event: DAILY_KEY,
                result: 'none',
            });
            return false;
        }
        if (!claimable.length) {
            markDoneToday();
            lastResult = 'none';
            log('月卡', '今日暂无可领取月卡礼包', {
                module: 'task',
                event: DAILY_KEY,
                result: 'none',
            });
            return false;
        }
        let claimed = 0;
        const claimedItems = [];
        for (const info of claimable) {
            try {
                const ret = await claimMonthCardReward(Number(info.goods_id || 0));
                const items = Array.isArray(ret && ret.items) ? ret.items : [];
                recordFarmReward(DAILY_KEY, describeRewardItems(items), '月卡礼包');
                claimedItems.push(...items);
                const reward = getRewardSummary(items);
                log('月卡', reward ? `领取成功 → ${reward}` : '领取成功', {
                    module: 'task',
                    event: DAILY_KEY,
                    result: 'ok',
                    goodsId: Number(info.goods_id || 0),
                });
                claimed += 1;
            }
            catch (e) {
                log('月卡', `领取失败(gid=${Number(info.goods_id || 0)}): ${e.message}`, {
                    module: 'task',
                    event: DAILY_KEY,
                    result: 'error',
                    goodsId: Number(info.goods_id || 0),
                });
            }
        }
        if (claimed > 0) {
            lastClaimAt = Date.now();
            markDoneToday();
            claimedDateKey = getSystemDateKey();
            lastHasClaimable = false;
            if (claimedItems.length > 0)
                lastRewards = describeRewardItems(claimedItems);
            lastResult = 'ok';
            return true;
        }
        log('月卡', '本次未成功领取月卡礼包', {
            module: 'task',
            event: DAILY_KEY,
            result: 'none',
        });
        lastResult = 'none';
        return false;
    }
    catch (e) {
        lastResult = 'error';
        log('月卡', `查询月卡礼包失败: ${e.message}`, {
            module: 'task',
            event: DAILY_KEY,
            result: 'error',
        });
        return false;
    }
}
module.exports = {
    performDailyMonthCardGift,
    getMonthCardDailyState: () => ({
        key: DAILY_KEY,
        doneToday: isClaimedToday(),
        checkedToday: isDoneToday(),
        lastCheckAt,
        lastClaimAt,
        result: lastResult,
        hasCard: lastHasCard,
        hasClaimable: lastHasClaimable,
        rewards: lastRewards,
    }),
};
//# sourceMappingURL=monthcard.js.map