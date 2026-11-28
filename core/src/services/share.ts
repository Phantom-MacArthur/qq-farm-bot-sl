import { beginDailyCheck, getDailyMark, isDailyComplete, recordDailyMark } from './daily-completion';
/**
 * 每日分享礼包
 */

const { getDailyShareInfo, sendMsgAsync, sendMsgNoReply } = require('../utils/network');
const { types } = require('../utils/proto');
const { log, getSystemDateKey } = require('../utils/utils');
const { describeRewardItems } = require('../utils/reward-items');
const { recordFarmReward } = require('./farm-reward-history');

const DAILY_KEY: string = 'daily_share';
const CHECK_COOLDOWN_MS: number = 10 * 60 * 1000;
const SHARE_REWARD_ALREADY_CLAIMED = 1009001;

type ShareCheckStatus = 'unchecked' | 'entry_available' | 'entry_unavailable' | 'already_claimed' | 'check_failed';

let checkedDateKey: string = '';
let claimedDateKey: string = '';
let lastCheckAt: number = 0;
let lastClaimAt: number = 0;
let checkStatus: ShareCheckStatus = 'unchecked';
let canShare: boolean | null = null;
// 分享礼包领取前无法得知奖励，只记录本次进程内最近一次领到的物品。
let lastRewards: any[] = [];

function isCheckedToday(): boolean {
    return checkedDateKey === getSystemDateKey();
}

function isAlreadyClaimedError(error: any): boolean {
    return Number(error?.code) === SHARE_REWARD_ALREADY_CLAIMED || /\bcode=1009001\b/.test(String(error?.message || error || ''));
}

async function checkCanShare(): Promise<any> {
    const body: Uint8Array = types.CheckCanShareRequest.encode(types.CheckCanShareRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.sharepb.ShareService', 'CheckCanShare', body);
    return types.CheckCanShareReply.decode(replyBody);
}

async function getInviteInfo(): Promise<any> {
    const body: Uint8Array = types.GetInviteInfoRequest.encode(types.GetInviteInfoRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.sharepb.ShareService', 'GetInviteInfo', body);
    return types.GetInviteInfoReply.decode(replyBody);
}

async function reportShare(): Promise<void> {
    const body: Uint8Array = types.ReportShareRequest.encode(types.ReportShareRequest.create({
        field_1: 1,
        field_4: 42,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.sharepb.ShareService', 'ReportShare', body);
    types.ReportShareReply.decode(replyBody);
}

async function claimShareReward(onSent?: () => void): Promise<any> {
    const body: Uint8Array = types.ClaimShareRewardRequest.encode(types.ClaimShareRewardRequest.create({
        field_1: true,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.sharepb.ShareService', 'ClaimShareReward', body, {
        expectedErrorCodes: [SHARE_REWARD_ALREADY_CLAIMED],
        onSent,
    });
    return types.ClaimShareRewardReply.decode(replyBody);
}

async function reportActivityShare(source: number, scene: number): Promise<void> {
    const body: Uint8Array = types.ReportShareRequest.encode(types.ReportShareRequest.create({
        field_1: source,
        field_4: scene,
    })).finish();
    await sendMsgNoReply('gamepb.sharepb.ShareService', 'ReportShare', body);
}

async function checkDailyShareStatus(force: boolean = false): Promise<boolean> {
    const now: number = Date.now();
    if (claimedDateKey === getSystemDateKey() || isDailyComplete('farm_daily_share')) return false;
    if (!force && now - lastCheckAt < CHECK_COOLDOWN_MS) return false;
    lastCheckAt = now;
    const check = beginDailyCheck('farm_daily_share');
    const recorded = getDailyShareInfo?.(1);
    if (check && recorded?.dateKey === check.dateKey && recorded.claimed === true) {
        recordDailyMark(check, 'completed');
        return false;
    }
    if (getDailyMark('farm_daily_share')?.status === 'pending_confirmation') return false;
    try {
        const reply: any = await checkCanShare();
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
        const claimReply: any = await claimShareReward(() => recordDailyMark(check, 'pending_confirmation'));
        const items: any[] = Array.isArray(claimReply?.items) ? claimReply.items : [];
        claimedDateKey = checkedDateKey;
        recordDailyMark(check, 'completed');
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
    } catch (e: any) {
        if (isAlreadyClaimedError(e)) {
            claimedDateKey = getSystemDateKey();
            recordDailyMark(check, 'completed');
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
        if (/^\d+$/.test(String(e?.code || ''))) recordDailyMark(check, 'clear_pending');
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
        doneToday: claimedDateKey === getSystemDateKey() || isDailyComplete('farm_daily_share'),
        lastCheckAt,
        lastClaimAt,
        rewards: claimedDateKey === getSystemDateKey() ? lastRewards : [],
    }),
};
