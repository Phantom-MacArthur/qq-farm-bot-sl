import type { FarmActivityEvent } from '../config/notification-types';
import { EventEmitter } from 'node:events';

export const farmActivityEvents = new EventEmitter<{ activity: [FarmActivityEvent, string] }>();

export function emitFarmReward(name: string, rewards: { name?: string; count?: string | number }[]): void {
    if (!rewards.length) return;
    const items = rewards.filter(item => item.name).map(item => `${item.name} ×${item.count}`);
    farmActivityEvents.emit('activity', 'reward', `已领取${name}${items.length ? `：${items.join('、')}` : ''}`);
}
