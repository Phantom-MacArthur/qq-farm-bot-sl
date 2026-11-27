export declare const YISHU_SEED_ID = 20307;
export declare const YISHU_MIN_PRICE = 450;
export declare const YISHU_SCAN_LIMIT = 200;
export declare const YISHU_SCAN_MINUTES = 30;
export declare const YISHU_PLANT_CUTOFF: number;
export declare const YISHU_SELL_CUTOFF: number;
export declare const YISHU_DEFAULT_SELL_AFTER_TIME = "12:00";
export declare const YISHU_START: number;
export declare const YISHU_END: number;
export type YishuSellMode = 'off' | 'scan' | 'auto';
export declare function normalizeYishuMinPrice(value: unknown): number;
export declare function yishuSellMode(input: {
    yishu_sell_mode?: unknown;
    yishu_auto_sell?: boolean;
}): YishuSellMode;
export declare function yishuDayStart(seconds: number): number;
export declare function yishuDate(seconds: number): string;
export declare function confirmedYishuQuoteDay(sample: {
    ms: number;
    nowMs: number;
} | null): string;
export declare function normalizeYishuSellAfterTime(value: unknown): string;
export declare function yishuSellMinutes(afterTime?: string): number[];
export declare function latestYishuSellSlot(seconds: number, afterTime?: string): number | undefined;
export declare function isYishuSaleTime(seconds: number, slot: number, afterTime?: string): boolean;
export declare function estimateYishuMaturity(plantedAt: number, growthSeconds: number, reductionBasisPoints: number): number | null;
export declare function yishuPlantDeadline(seconds: number, end?: number): number;
export declare function observeYishuActivity(active: boolean, end: number): void;
export declare function getYishuActivityEnd(seconds: number): number;
//# sourceMappingURL=yishuhuanfu.d.ts.map