export const YISHU_SEED_ID = 20307;
export const YISHU_MIN_PRICE = 450;
export const YISHU_SCAN_LIMIT = 200;
export const YISHU_SCAN_MINUTES = 30;
export const YISHU_PLANT_CUTOFF = 23 * 60 + 30;
export const YISHU_SELL_CUTOFF = 23 * 60 + 55;
export const YISHU_DEFAULT_SELL_AFTER_TIME = '12:00';
export const YISHU_START = Date.parse('2026-11-25T00:00:00+08:00') / 1000;
export const YISHU_END = Date.parse('2026-12-10T00:00:00+08:00') / 1000;
const DAY_SECONDS = 86_400;
const BEIJING_OFFSET = 8 * 3600;
let observedActivityEnd = 0;
let observedWindow: { start: number; end: number } | undefined;

export type YishuSellMode = 'off' | 'manual' | 'scan' | 'auto';

export function normalizeYishuMinPrice(value: unknown): number {
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return YISHU_MIN_PRICE;
    const price = Number(value);
    return Number.isSafeInteger(price) && price >= 0 ? price : YISHU_MIN_PRICE;
}

export function yishuSellMode(input: { yishu_sell_mode?: unknown; yishu_auto_sell?: boolean }): YishuSellMode {
    const mode = input.yishu_sell_mode;
    if (mode === 'confirm') return 'scan';
    if (mode === 'off' || mode === 'manual' || mode === 'scan' || mode === 'auto') return mode;
    return input.yishu_auto_sell === false ? 'off' : 'auto';
}

export function yishuDayStart(seconds: number): number {
    return Math.floor((seconds + BEIJING_OFFSET) / DAY_SECONDS) * DAY_SECONDS - BEIJING_OFFSET;
}

export function yishuDate(seconds: number): string {
    return new Date((yishuDayStart(seconds) + BEIJING_OFFSET) * 1000).toISOString().slice(0, 10);
}

export function confirmedYishuQuoteDay(sample: { ms: number; nowMs: number } | null): string {
    if (!sample || !Number.isFinite(sample.ms) || !Number.isFinite(sample.nowMs)) return '';
    const confirmed = sample.ms / 1000;
    const now = sample.nowMs / 1000;
    if (!isYishuAutomationInWindow(confirmed) || !isYishuAutomationInWindow(now)) return '';
    // 零点到了但还没有新一天的服务端授时，先暂停使用报价，等服务端确认再切桶。
    const day = yishuDate(confirmed);
    return yishuDate(now) === day ? day : '';
}

export function normalizeYishuSellAfterTime(value: unknown): string {
    if (typeof value !== 'string') return YISHU_DEFAULT_SELL_AFTER_TIME;
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
    if (!match || Number(match[1]) * 60 + Number(match[2]) >= YISHU_SELL_CUTOFF) return YISHU_DEFAULT_SELL_AFTER_TIME;
    return match[0];
}

export function yishuSellMinutes(afterTime?: string): number[] {
    const [hours, minutes] = normalizeYishuSellAfterTime(afterTime).split(':').map(Number);
    const slots: number[] = [];
    for (let minute = hours * 60 + minutes; minute < YISHU_SELL_CUTOFF; minute += 30) slots.push(minute);
    return slots;
}

export function latestYishuSellSlot(seconds: number, afterTime?: string): number | undefined {
    const start = yishuDayStart(seconds);
    if (seconds >= start + YISHU_SELL_CUTOFF * 60) return undefined;
    return yishuSellMinutes(afterTime).map(minute => start + minute * 60).filter(slot => slot <= seconds).at(-1);
}

export function isYishuSaleTime(seconds: number, slot: number, afterTime?: string): boolean {
    return latestYishuSellSlot(seconds, afterTime) === slot;
}

export function estimateYishuMaturity(plantedAt: number, growthSeconds: number, reductionBasisPoints: number): number | null {
    if (![plantedAt, growthSeconds, reductionBasisPoints].every(Number.isFinite)
        || growthSeconds <= 0 || reductionBasisPoints < 0 || reductionBasisPoints >= 10_000) return null;
    return plantedAt + Math.ceil(growthSeconds * (10_000 - reductionBasisPoints) / 10_000);
}

export function yishuPlantDeadline(seconds: number, end = YISHU_END): number {
    return Math.min(yishuDayStart(seconds) + YISHU_PLANT_CUTOFF * 60, end);
}

export function observeYishuActivity(active: boolean, end: number, start: number): void {
    if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end > start) {
        observedWindow = { start, end };
    }
    observedActivityEnd = active && Number.isFinite(end) && end > 0 ? end : 0;
}

export function getYishuAutomationWindow() {
    return observedWindow ?? { start: YISHU_START, end: YISHU_END };
}

export function isYishuAutomationInWindow(seconds: number): boolean {
    const { start, end } = getYishuAutomationWindow();
    return seconds >= start && seconds < end;
}

export function getYishuActivityEnd(seconds: number): number {
    return seconds < observedActivityEnd ? observedActivityEnd : 0;
}
