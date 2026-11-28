"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const daily_completion_1 = require("./daily-completion");
/**
 * 每日分享礼包
 */
const { getDailyShareInfo, sendMsgAsync, sendMsgNoReply } = require('../utils/network');
const { types } = require('../utils/proto');
const { log, getSystemDateKey } = require('../utils/utils');
const { describeRewardItems } = require('../utils/reward-items');
const { recordFarmReward } = require('./farm-reward-history');
const DAILY_KEY = 'daily_share';
const CHECK_COOLDOWN_MS = 10 * 60 * 1000;
const SHARE_REWARD_ALREADY_CLAIMED = 1009001;
let checkedDateKey = '';
let claimedDateKey = '';
let lastCheckAt = 0;
let lastClaimAt = 0;
let checkStatus = 'unchecked';
let canShare = null;
// 分享礼包领取前无法得知奖励，只记录本次进程内最近一次领到的物品。
let lastRewards = [];
function isCheckedToday() {
    return checkedDateKey === getSystemDateKey();
}
function isAlreadyClaimedError(error) {
    return Number(error?.code) === SHARE_REWARD_ALREADY_CLAIMED || /\bcode=1009001\b/.test(String(error?.message || error || ''));
}
async function checkCanShare() {
    const body = types.CheckCanShareRequest.encode(types.CheckCanShareRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.sharepb.ShareService', 'CheckCanShare', body);
    return types.CheckCanShareReply.decode(replyBody);
}
async function getInviteInfo() {
    const body = types.GetInviteInfoRequest.encode(types.GetInviteInfoRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.sharepb.ShareService', 'GetInviteInfo', body);
    return types.GetInviteInfoReply.decode(replyBody);
}
async function reportShare() {
    const body = types.ReportShareRequest.encode(types.ReportShareRequest.create({
        field_1: 1,
        field_4: 42,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.sharepb.ShareService', 'ReportShare', body);
    types.ReportShareReply.decode(replyBody);
}
async function claimShareReward(onSent) {
    const body = types.ClaimShareRewardRequest.encode(types.ClaimShareRewardRequest.create({
        field_1: true,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.sharepb.ShareService', 'ClaimShareReward', body, {
        expectedErrorCodes: [SHARE_REWARD_ALREADY_CLAIMED],
        onSent,
    });
    return types.ClaimShareRewardReply.decode(replyBody);
}
async function reportActivityShare(source, scene) {
    const body = types.ReportShareRequest.encode(types.ReportShareRequest.create({
        field_1: source,
        field_4: scene,
    })).finish();
    await sendMsgNoReply('gamepb.sharepb.ShareService', 'ReportShare', body);
}
async function checkDailyShareStatus(force = false) {
    const now = Date.now();
    if (claimedDateKey === getSystemDateKey() || (0, daily_completion_1.isDailyComplete)('farm_daily_share'))
        return false;
    if (!force && now - lastCheckAt < CHECK_COOLDOWN_MS)
        return false;
    lastCheckAt = now;
    const check = (0, daily_completion_1.beginDailyCheck)('farm_daily_share');
    const recorded = getDailyShareInfo?.(1);
    if (check && recorded?.dateKey === check.dateKey && recorded.claimed === true) {
        (0, daily_completion_1.recordDailyMark)(check, 'completed');
        return false;
    }
    if ((0, daily_completion_1.getDailyMark)('farm_daily_share')?.status === 'pending_confirmation')
        return false;
    try {
        const reply = await checkCanShare();
        canShare = !!(reply && reply.can_share);
        checkStatus = canShare ? 'entry_available' : 'entry_unavailable';
        checkedDateKey = getSystemDateKey();
        if (!canShare) {
            log('分享', '分享入口暂不可用', {
                module: 'task',
                event: DAILY_KEY,
                result: 'checked',
                canShare,
            });
            return true;
        }
        await reportShare();
        const claimReply = await claimShareReward(() => (0, daily_completion_1.recordDailyMark)(check, 'pending_confirmation'));
        const items = Array.isArray(claimReply?.items) ? claimReply.items : [];
        claimedDateKey = checkedDateKey;
        (0, daily_completion_1.recordDailyMark)(check, 'completed');
        lastClaimAt = Date.now();
        lastRewards = describeRewardItems(items);
        recordFarmReward('daily_share', lastRewards);
        log('分享', `分享礼包领取成功${items.length > 0 ? `，获得 ${items.length} 种物品` : ''}`, {
            module: 'task',
            event: DAILY_KEY,
            result: 'ok',
            canShare,
            items,
        });
        return true;
    }
    catch (e) {
        if (isAlreadyClaimedError(e)) {
            claimedDateKey = getSystemDateKey();
            (0, daily_completion_1.recordDailyMark)(check, 'completed');
            checkedDateKey = claimedDateKey;
            lastClaimAt = Date.now();
            checkStatus = 'already_claimed';
            log('分享', '分享礼包今日已领取', {
                module: 'task',
                event: DAILY_KEY,
                result: 'already_claimed',
            });
            return true;
        }
        if (/^\d+$/.test(String(e?.code || '')))
            (0, daily_completion_1.recordDailyMark)(check, 'clear_pending');
        canShare = null;
        checkStatus = 'check_failed';
        log('分享', `状态检查失败: ${e.message}`, {
            module: 'task',
            event: DAILY_KEY,
            result: 'error',
        });
        return false;
    }
}
module.exports = {
    checkDailyShareStatus,
    reportActivityShare,
    getInviteInfo,
    getShareDailyState: () => ({
        key: DAILY_KEY,
        mode: 'auto_claim',
        checkedToday: isCheckedToday(),
        checkStatus,
        canShare,
        doneToday: claimedDateKey === getSystemDateKey() || (0, daily_completion_1.isDailyComplete)('farm_daily_share'),
        lastCheckAt,
        lastClaimAt,
        rewards: claimedDateKey === getSystemDateKey() ? lastRewards : [],
    }),
};
//# sourceMappingURL=share.js.map