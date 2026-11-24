import { recordFarmReward } from './farm-reward-history';

const { describeRewardItems } = require('../utils/reward-items');
const { log, logWarn } = require('../utils/utils');

export async function claimFarmIllustratedRewards(canContinue: () => boolean): Promise<void> {
    const automation = { canContinue };
    const books = [
        { name: '作物图鉴', claim: () => require('./illustrated').claimIllustratedRewards(1, automation) },
        { name: '超变图鉴', claim: () => require('./illustrated').claimIllustratedRewards(2, automation) },
        { name: '藏品图鉴', claim: () => require('./collections').claimCollectionRewards(automation) },
    ];
    for (const { name, claim } of books) {
        if (!canContinue()) return;
        try {
            const result = await claim();
            if (!result) continue;
            const rewards = describeRewardItems(result.rewards.map((item: { itemId?: number; id?: number; count: number | string }) => ({
                id: item.itemId ?? item.id,
                count: item.count,
            })));
            recordFarmReward('illustrated_rewards', rewards, `${name}奖励`);
            const summary = rewards.map((item: { name: string; count: number }) => `${item.name} ×${item.count}`).join('、');
            log('图鉴', `已领取${name}奖励${summary ? `：${summary}` : ''}`, { module: 'task', event: '图鉴奖励', result: 'ok' });
        } catch (error: any) {
            if (canContinue()) logWarn('图鉴', `${name}自动领取失败：${error.message}`, { module: 'task', event: '图鉴奖励', result: 'error' });
        }
    }
}
