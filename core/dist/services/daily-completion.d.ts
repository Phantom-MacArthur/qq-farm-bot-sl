declare const DAILY: readonly ["farm_daily_share", "farm_free_gifts", "farm_month_card_gift", "farm_vip_gift", "ranch_share", "ranch_daily_benefit"];
declare const ACTIVITY: readonly ["yishu_claim_seed", "yishu_share"];
export type DailyAction = typeof DAILY[number] | typeof ACTIVITY[number];
type Result = 'completed' | 'pending_confirmation';
type Mark = {
    status: Result;
    at: number;
    count?: string;
};
type Context = {
    file: string;
    dateKey: string;
};
type Ticket = Context & {
    action: DailyAction;
};
type Options = {
    item?: string;
    count?: string;
};
export declare function beginDailyCheck(action: DailyAction): Ticket | null;
export declare function getDailyMark(action: DailyAction, item?: string): Mark | undefined;
export declare function isDailyComplete(action: DailyAction, item?: string): boolean;
export declare function recordDailyMark(ticket: Ticket | null, status: Result | 'clear_pending', { item, count }?: Options): void;
export declare function getDailyCompletionSnapshot(): {
    daily: {
        [k: string]: {
            items: {
                [k: string]: Mark;
            };
            count?: string;
            dateKey: string;
            status: string;
            at: number;
        };
    };
    activity: {
        [k: string]: {
            items: {
                [k: string]: Mark;
            };
            count?: string;
            dateKey: string;
            status: string;
            at: number;
        };
    };
};
export {};
//# sourceMappingURL=daily-completion.d.ts.map