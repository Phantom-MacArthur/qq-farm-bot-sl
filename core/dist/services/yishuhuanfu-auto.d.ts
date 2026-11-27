import type { AutomationConfig } from '../types/config';
export declare const YISHU_AUTOMATION_KEYS: readonly ["yishu_claim_seed", "yishu_share", "yishu_auto_sell", "yishu_sell_mode", "yishu_claim_commission", "yishu_plant", "yishu_harvest", "yishu_sell_after_time", "yishu_scan_friend_limit", "yishu_scan_interval_minutes"];
type Settings = Partial<AutomationConfig>;
type Round = {
    plannedAt: number;
    source: 'scheduled' | 'reconnect' | 'settlement';
    slot?: number;
};
type Quote = {
    gid: string;
    name?: string;
    own?: boolean;
    sharedToday?: boolean;
    canSell?: boolean | null;
    totalPrice: string;
    quota: string;
    quotedAt?: number;
    quotePending?: boolean;
};
export declare function isYishuAutomationEnabled(automation?: Settings): boolean;
export declare function nextYishuCheck(seconds: number, scanMinutes?: number, sellAfterTime?: string): number;
export declare function createYishuAutomation(deps: {
    getActivity: (options?: any) => Promise<any>;
    claimSeed: (options?: any) => Promise<any>;
    shareShop: (options?: any) => Promise<any>;
    claimCommission: (options?: any) => Promise<any>;
    getFriendQuotes: () => any;
    queryShop: (gid: string) => Promise<any>;
    sell: (gid: string, count: string, options?: any) => Promise<any>;
    harvest: () => Promise<number>;
    maintainFarm?: () => Promise<{
        planted: number;
        harvested: number;
    }>;
    getServerTimeSec: () => number;
    log: (module: string, message: string, meta?: any) => void;
    delay?: (ms: number) => Promise<void>;
}): {
    runYishuAutomation: (automation: Settings, live: () => Settings, round: Round) => Promise<{
        reason: string;
        status: string;
        type: "round";
        minPrice: number;
        mode?: string;
        ownPrice?: string;
        ownPriceConfirmed?: boolean;
        remaining: string | null;
        luckCoin?: string | null;
        actions: Array<{
            key: string;
            message: string;
            error?: boolean;
        }>;
        trades: any[];
        scan?: any;
        rechecked?: number;
        recheckFailed?: number;
        candidates?: Quote[];
        plannedAt: number;
        source: "scheduled" | "reconnect" | "settlement";
        slot?: number;
    }>;
};
export declare function stopYishuWatchdog(): void;
export declare function startYishuTimer(scheduler: any, isReady: () => boolean): void;
export {};
//# sourceMappingURL=yishuhuanfu-auto.d.ts.map