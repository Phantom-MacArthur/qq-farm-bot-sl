import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function historyPath(accountId = process.env.FARM_ACCOUNT_ID) {
    if (!accountId) return null;
    const directory = process.env.FARM_DATA_DIR || path.join(__dirname, '../../data');
    return path.join(directory, 'farm-reward-history', `${Buffer.from(accountId).toString('hex')}.json`);
}

export function getFarmRewardHistory(accountId?: string): any[] {
    const file = historyPath(accountId);
    if (!file) return [];
    try {
        const records = JSON.parse(readFileSync(file, 'utf8'));
        return Array.isArray(records) ? records.slice(0, 100) : [];
    } catch {
        return [];
    }
}

export function recordFarmReward(key: string, rewards: any[], name?: string) {
    const file = historyPath();
    if (!file) return;
    try {
        const records = [{ id: randomUUID(), key, name, rewards, claimedAt: Date.now() }, ...getFarmRewardHistory()].slice(0, 100);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(`${file}.tmp`, JSON.stringify(records), 'utf8');
        renameSync(`${file}.tmp`, file);
    } catch (error) {
        require('../utils/utils').logWarn('农场奖励', `保存领取记录失败: ${String(error)}`);
    }
}
