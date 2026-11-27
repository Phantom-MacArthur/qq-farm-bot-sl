export {};
type FriendInteraction = {
    action: 'stroke';
    ranchId: string;
    animalId: number;
} | {
    action: 'putMosquito';
    ranchId: string;
    remaining: number;
};
export interface FriendPatrolProgress {
    stealChecked?: boolean;
    stealReadyAt?: number;
    produceChecked?: boolean;
    cleanChecked?: boolean;
    pending?: FriendInteraction[];
}
//# sourceMappingURL=friends.d.ts.map