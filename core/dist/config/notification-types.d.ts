export interface NotificationTypes {
    offline: boolean;
    mysteryArrival: boolean;
    mysteryPurchase: boolean;
    farmActivity: boolean;
}
export type MysteryNotificationMessages = Record<'mysteryArrival' | 'mysteryPurchase', string>;
export declare const FARM_ACTIVITY_LABELS: {
    readonly cropHarvest: "收获作物";
    readonly animalHarvest: "收获动物";
    readonly sale: "出售成功";
    readonly reward: "领取奖励";
};
export type FarmActivityEvent = keyof typeof FARM_ACTIVITY_LABELS;
export type PushNotification = {
    title: string;
    content: string;
} & ({
    type: Exclude<keyof NotificationTypes, 'farmActivity'>;
} | {
    type: 'farmActivity';
    activity: FarmActivityEvent;
});
export declare function normalizeFarmActivityEvents(input: unknown): FarmActivityEvent[];
export declare function normalizeNotificationTypes(input?: Partial<NotificationTypes>): NotificationTypes;
//# sourceMappingURL=notification-types.d.ts.map