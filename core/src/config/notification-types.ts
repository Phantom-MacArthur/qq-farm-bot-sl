export interface NotificationTypes {
    offline: boolean;
    mysteryArrival: boolean;
    mysteryPurchase: boolean;
    farmActivity: boolean;
}

export type MysteryNotificationMessages = Record<'mysteryArrival' | 'mysteryPurchase', string>;

export const FARM_ACTIVITY_LABELS = {
    cropHarvest: '收获作物',
    animalHarvest: '收获动物',
    sale: '出售成功',
    reward: '领取奖励',
} as const;

export type FarmActivityEvent = keyof typeof FARM_ACTIVITY_LABELS;

export type PushNotification = {
    title: string;
    content: string;
} & ({ type: Exclude<keyof NotificationTypes, 'farmActivity'> } | { type: 'farmActivity'; activity: FarmActivityEvent });

export function normalizeFarmActivityEvents(input: unknown): FarmActivityEvent[] {
    const events = Object.keys(FARM_ACTIVITY_LABELS) as FarmActivityEvent[];
    return Array.isArray(input) ? events.filter(event => input.includes(event)) : events;
}

// 旧配置只在账号内选择商人提醒，全局默认放行以保留原有选择。
export function normalizeNotificationTypes(input?: Partial<NotificationTypes>): NotificationTypes {
    return {
        offline: input?.offline !== false,
        mysteryArrival: input?.mysteryArrival !== false,
        mysteryPurchase: input?.mysteryPurchase !== false,
        farmActivity: input?.farmActivity === true,
    };
}
