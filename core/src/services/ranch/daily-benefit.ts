import { beginDailyCheck, isDailyComplete, recordDailyMark } from '../daily-completion';

const { rpc, inScene } = require('./transport');
const { quantity, itemDto, signature, error } = require('./model');
const reservations = require('./operation-state');
const { recordFarmReward } = require('../farm-reward-history');
const GOODS_ID = '2001';
let cached: any = null;
const dateKey = () => require('./daily-share').getState().dateKey;

async function read(): Promise<any> {
    const check = beginDailyCheck('ranch_daily_benefit');
    const reply = await rpc('canShop', { slot_type: 6, is_manual_open: true, global_scene_id: 2 });
    const good = reply.goods_list.find((entry: any) => quantity(entry.goods_id) === GOODS_ID);
    const limit = good?.purchase_limit;
    const claimed = !!limit && limit.limit_type === 1 && quantity(limit.limit_count) === '1' && BigInt(quantity(limit.bought_count)) >= 1n;
    const available = !!good && good.is_free && !!good.price && BigInt(quantity(good.price.count)) === 0n
        && limit?.limit_type === 1 && quantity(limit.limit_count) === '1'
        && good.is_available && !good.is_owned && !good.ad_only && !good.share?.share_only && good.reward_items.length > 0;
    cached = { dateKey: dateKey(), claimed, available: available && !claimed, hasGift: !!good, rewards: (good?.reward_items || []).map(itemDto) };
    if (claimed) recordDailyMark(check, 'completed');
    return cached;
}

async function claim(): Promise<any> {
    if (isDailyComplete('ranch_daily_benefit')) return { skipped: true, claimed: true, rewards: [] };
    return inScene(() => reservations.forCurrentAccount().withLock(async () => {
        if (isDailyComplete('ranch_daily_benefit')) return { skipped: true, claimed: true, rewards: [] };
        const check = beginDailyCheck('ranch_daily_benefit');
        const state = await read();
        if (state.claimed || !state.available) return { skipped: true, claimed: state.claimed, rewards: [] };
        return reservations.forCurrentAccount().spend({ target: `ranch:dailyBenefit:${state.dateKey}`, label: '领取牧场每日福利', costs: [], balances: [] }, async () => {
            const reply = await rpc('buyCan', { goods_id: GOODS_ID, count: 1 }, true);
            if (!reply.success || quantity(reply.goods_id) !== GOODS_ID || signature(reply.reward_items) !== signature(state.rewards)
                || reply.purchase_limit?.limit_type !== 1 || quantity(reply.purchase_limit.bought_count) !== '1') {
                throw error('RANCH_RESULT_UNKNOWN', '每日福利领取回包未能确认，请刷新核对，勿重复提交');
            }
            cached = { ...state, claimed: true, available: false };
            recordDailyMark(check, 'completed');
            const rewards = reply.reward_items.map(itemDto);
            recordFarmReward('ranch_daily_benefit', rewards, '每日福利');
            return { skipped: false, claimed: true, rewards };
        });
    }));
}

function getCachedState(): any {
    return cached?.dateKey === dateKey() ? cached : null;
}

module.exports = { read, claim, getCachedState };
