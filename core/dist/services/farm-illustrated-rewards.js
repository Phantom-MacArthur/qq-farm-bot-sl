"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimFarmIllustratedRewards = claimFarmIllustratedRewards;
const farm_reward_history_1 = require("./farm-reward-history");
const { describeRewardItems } = require('../utils/reward-items');
const { log, logWarn } = require('../utils/utils');
async function claimFarmIllustratedRewards(canContinue) {
    const automation = { canContinue };
    const books = [
        { name: '作物图鉴', claim: () => require('./illustrated').claimIllustratedRewards(1, automation) },
        { name: '超变图鉴', claim: () => require('./illustrated').claimIllustratedRewards(2, automation) },
        { name: '藏品图鉴', claim: () => require('./collections').claimCollectionRewards(automation) },
    ];
    for (const { name, claim } of books) {
        if (!canContinue())
            return;
        try {
            const result = await claim();
            if (!result)
                continue;
            const rewards = describeRewardItems(result.rewards.map((item) => ({
                id: item.itemId ?? item.id,
                count: item.count,
            })));
            (0, farm_reward_history_1.recordFarmReward)('illustrated_rewards', rewards, `${name}奖励`);
            const summary = rewards.map((item) => `${item.name} ×${item.count}`).join('、');
            log('图鉴', `已领取${name}奖励${summary ? `：${summary}` : ''}`, { module: 'task', event: '图鉴奖励', result: 'ok' });
        }
        catch (error) {
            if (canContinue())
                logWarn('图鉴', `${name}自动领取失败：${error.message}`, { module: 'task', event: '图鉴奖励', result: 'error' });
        }
    }
}
//# sourceMappingURL=farm-illustrated-rewards.js.map