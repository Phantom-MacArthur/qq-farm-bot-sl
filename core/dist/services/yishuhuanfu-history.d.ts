export interface YishuHistoryEntry {
    at: number;
    day: string;
    type: 'round' | 'sale' | 'order' | 'resolved' | 'settlement' | 'plant' | 'harvest';
    slot?: number;
    status?: string;
    orderId?: string;
    [key: string]: unknown;
}
export declare function readYishuHistory(accountId: string): YishuHistoryEntry[];
export declare function appendYishuHistory(accountId: string, seconds: number, entry: Omit<YishuHistoryEntry, 'day' | 'at'>): void;
export declare function pendingYishuOrder(history: YishuHistoryEntry[]): YishuHistoryEntry | undefined;
export declare function beginYishuOrder(accountId: string, seconds: number, order: Record<string, unknown>): string;
//# sourceMappingURL=yishuhuanfu-history.d.ts.map