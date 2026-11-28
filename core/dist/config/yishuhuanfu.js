"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.YISHU_END = exports.YISHU_START = exports.YISHU_DEFAULT_SELL_AFTER_TIME = exports.YISHU_SELL_CUTOFF = exports.YISHU_PLANT_CUTOFF = exports.YISHU_SCAN_MINUTES = exports.YISHU_SCAN_LIMIT = exports.YISHU_MIN_PRICE = exports.YISHU_SEED_ID = void 0;
exports.normalizeYishuMinPrice = normalizeYishuMinPrice;
exports.yishuSellMode = yishuSellMode;
exports.yishuDayStart = yishuDayStart;
exports.yishuDate = yishuDate;
exports.confirmedYishuQuoteDay = confirmedYishuQuoteDay;
exports.normalizeYishuSellAfterTime = normalizeYishuSellAfterTime;
exports.yishuSellMinutes = yishuSellMinutes;
exports.latestYishuSellSlot = latestYishuSellSlot;
exports.isYishuSaleTime = isYishuSaleTime;
exports.estimateYishuMaturity = estimateYishuMaturity;
exports.yishuPlantDeadline = yishuPlantDeadline;
exports.observeYishuActivity = observeYishuActivity;
exports.getYishuAutomationWindow = getYishuAutomationWindow;
exports.isYishuAutomationInWindow = isYishuAutomationInWindow;
exports.getYishuActivityEnd = getYishuActivityEnd;
exports.YISHU_SEED_ID = 20307;
exports.YISHU_MIN_PRICE = 450;
exports.YISHU_SCAN_LIMIT = 200;
exports.YISHU_SCAN_MINUTES = 30;
exports.YISHU_PLANT_CUTOFF = 23 * 60 + 30;
exports.YISHU_SELL_CUTOFF = 23 * 60 + 55;
exports.YISHU_DEFAULT_SELL_AFTER_TIME = '12:00';
exports.YISHU_START = Date.parse('2026-11-25T00:00:00+08:00') / 1000;
exports.YISHU_END = Date.parse('2026-12-10T00:00:00+08:00') / 1000;
const DAY_SECONDS = 86_400;
const BEIJING_OFFSET = 8 * 3600;
let observedActivityEnd = 0;
let observedWindow;
function normalizeYishuMinPrice(value) {
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim()))
        return exports.YISHU_MIN_PRICE;
    const price = Number(value);
    return Number.isSafeInteger(price) && price >= 0 ? price : exports.YISHU_MIN_PRICE;
}
function yishuSellMode(input) {
    const mode = input.yishu_sell_mode;
    if (mode === 'confirm')
        return 'scan';
    if (mode === 'off' || mode === 'manual' || mode === 'scan' || mode === 'auto')
        return mode;
    return input.yishu_auto_sell === false ? 'off' : 'auto';
}
function yishuDayStart(seconds) {
    return Math.floor((seconds + BEIJING_OFFSET) / DAY_SECONDS) * DAY_SECONDS - BEIJING_OFFSET;
}
function yishuDate(seconds) {
    return new Date((yishuDayStart(seconds) + BEIJING_OFFSET) * 1000).toISOString().slice(0, 10);
}
function confirmedYishuQuoteDay(sample) {
    if (!sample || !Number.isFinite(sample.ms) || !Number.isFinite(sample.nowMs))
        return '';
    const confirmed = sample.ms / 1000;
    const now = sample.nowMs / 1000;
    if (!isYishuAutomationInWindow(confirmed) || !isYishuAutomationInWindow(now))
        return '';
    // 零点到了但还没有新一天的服务端授时，先暂停使用报价，等服务端确认再切桶。
    const day = yishuDate(confirmed);
    return yishuDate(now) === day ? day : '';
}
function normalizeYishuSellAfterTime(value) {
    if (typeof value !== 'string')
        return exports.YISHU_DEFAULT_SELL_AFTER_TIME;
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
    if (!match || Number(match[1]) * 60 + Number(match[2]) >= exports.YISHU_SELL_CUTOFF)
        return exports.YISHU_DEFAULT_SELL_AFTER_TIME;
    return match[0];
}
function yishuSellMinutes(afterTime) {
    const [hours, minutes] = normalizeYishuSellAfterTime(afterTime).split(':').map(Number);
    const slots = [];
    for (let minute = hours * 60 + minutes; minute < exports.YISHU_SELL_CUTOFF; minute += 30)
        slots.push(minute);
    return slots;
}
function latestYishuSellSlot(seconds, afterTime) {
    const start = yishuDayStart(seconds);
    if (seconds >= start + exports.YISHU_SELL_CUTOFF * 60)
        return undefined;
    return yishuSellMinutes(afterTime).map(minute => start + minute * 60).filter(slot => slot <= seconds).at(-1);
}
function isYishuSaleTime(seconds, slot, afterTime) {
    return latestYishuSellSlot(seconds, afterTime) === slot;
}
function estimateYishuMaturity(plantedAt, growthSeconds, reductionBasisPoints) {
    if (![plantedAt, growthSeconds, reductionBasisPoints].every(Number.isFinite)
        || growthSeconds <= 0 || reductionBasisPoints < 0 || reductionBasisPoints >= 10_000)
        return null;
    return plantedAt + Math.ceil(growthSeconds * (10_000 - reductionBasisPoints) / 10_000);
}
function yishuPlantDeadline(seconds, end = exports.YISHU_END) {
    return Math.min(yishuDayStart(seconds) + exports.YISHU_PLANT_CUTOFF * 60, end);
}
function observeYishuActivity(active, end, start) {
    if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end > start) {
        observedWindow = { start, end };
    }
    observedActivityEnd = active && Number.isFinite(end) && end > 0 ? end : 0;
}
function getYishuAutomationWindow() {
    return observedWindow ?? { start: exports.YISHU_START, end: exports.YISHU_END };
}
function isYishuAutomationInWindow(seconds) {
    const { start, end } = getYishuAutomationWindow();
    return seconds >= start && seconds < end;
}
function getYishuActivityEnd(seconds) {
    return seconds < observedActivityEnd ? observedActivityEnd : 0;
}
//# sourceMappingURL=yishuhuanfu.js.map