export {};
/**
 * 种子商店购买价校准缓存。
 *
 * 官方新版 ItemInfo 不再下发种子购买价（sells 是回收价），购买价权威来源是
 * 种子商店协议 GoodsInfo.price —— 单位为“一个商品包”（含 item_count 颗），
 * 这里折算成单颗价，与 analytics 的单颗果实收入模型保持同一口径。
 *
 * 商店目录为全服标准目录，任一在线账号拉取即可供全部账号离线使用；
 * 记录寄生在 planting.getAvailableSeeds 的常规商店拉取上，另有 admin 手动校准入口。
 * 本模块只依赖 runtime-paths / json-db，可被 config 层安全引用（无循环依赖）。
 */

const fs = require('node:fs');
const { getDataFile } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('./json-db');

// 测试可用 SEED_PRICE_CACHE_FILE 指向临时文件，避免用例清理影响真实校准数据。
const CACHE_FILE = process.env.SEED_PRICE_CACHE_FILE || getDataFile('seed_price_cache.json');
// fork 模式下 worker 是独立进程写盘，主进程按此间隔感知更新；thread 模式共享实例不受影响。
const RESTAT_INTERVAL_MS = 1000;

interface SeedPriceEntry {
    price: number;
    packagePrice: number;
    itemCount: number;
    goodsId: number;
    updatedAt: number;
}

let cache: Record<string, SeedPriceEntry> | null = null;
// 已拉取的普通种子商店目录中出现过的种子 item_id 集合。目录外（活动/解锁卡/神秘商人等
// 限定渠道）的种子不会出现在这里，据此区分“尚未校准”与“确实买不到”的限定种子。
let catalog: Record<string, number> = {};
let cacheMtimeMs = 0;
let lastStatAt = 0;

function statMtime(): number {
    try {
        return fs.statSync(CACHE_FILE).mtimeMs;
    } catch {
        return 0;
    }
}

// 进程内缓存 + mtime 失效，避免常驻 watchFile 定时器；文件缺失或损坏时退化为空缓存。
function ensureFresh(): void {
    const now = Date.now();
    if (cache && now - lastStatAt < RESTAT_INTERVAL_MS) return;
    lastStatAt = now;
    const mtime = statMtime();
    if (cache && mtime === cacheMtimeMs) return;
    const data = mtime ? readJsonFile(CACHE_FILE, () => ({ seeds: {}, catalog: {} })) : null;
    const seeds: any = data && data.seeds;
    cache = seeds && typeof seeds === 'object' ? seeds : {};
    const catalogData: any = data && data.catalog;
    if (catalogData && typeof catalogData === 'object') {
        catalog = catalogData;
    } else {
        // 兼容旧格式（只有 seeds、没有 catalog）：凡是能校准出购买价的种子都来自商店目录，
        // 直接以 seeds 的键作为目录成员，避免升级后要等账号重新拉取才显示“限定”。
        catalog = Object.keys(cache).reduce<Record<string, number>>((acc, key) => {
            acc[key] = 1;
            return acc;
        }, {});
    }
    cacheMtimeMs = mtime;
}

function persist(next: Record<string, SeedPriceEntry>, nextCatalog: Record<string, number>): void {
    cache = next;
    catalog = nextCatalog;
    cacheMtimeMs = statMtime();
    lastStatAt = Date.now();
    try {
        writeJsonFileAtomic(CACHE_FILE, { seeds: next, catalog: nextCatalog });
    } catch { /* 写盘失败时仅内存生效，下次记录再试 */ }
}

// goodsList = ShopService.ShopInfo(2) 返回的 GoodsInfo 数组（含锁定商品，目录全服一致）。
// 返回本次发生变化的种子数量；目录异常为空时不覆盖任何条目，防止清掉历史校准。
function recordSeedShopCatalog(goodsList: any[]): number {
    ensureFresh();
    const next: Record<string, SeedPriceEntry> = { ...cache! };
    const nextCatalog: Record<string, number> = { ...catalog };
    let changed = 0;
    let catalogChanged = false;
    for (const goods of Array.isArray(goodsList) ? goodsList : []) {
        const seedId = Number(goods && goods.item_id) || 0;
        if (seedId <= 0) continue;
        // 目录成员与“目录里能买到的价格”分开记录：价格无效的商品仍在目录内。
        const catalogKey = String(seedId);
        if (!nextCatalog[catalogKey]) {
            nextCatalog[catalogKey] = 1;
            catalogChanged = true;
        }
        const packagePrice = Number(goods && goods.price) || 0;
        const itemCount = Math.max(1, Number(goods && goods.item_count) || 1);
        if (packagePrice <= 0) continue;
        const entry: SeedPriceEntry = {
            // 单颗价可能非整数（多颗包），保留两位小数避免累计误差
            price: Math.round((packagePrice / itemCount) * 100) / 100,
            packagePrice,
            itemCount,
            goodsId: Number(goods && goods.id) || 0,
            updatedAt: Date.now(),
        };
        const key = String(seedId);
        const prev = next[key];
        if (prev && prev.packagePrice === packagePrice && prev.itemCount === itemCount) continue;
        next[key] = entry;
        changed += 1;
    }
    if (changed > 0 || catalogChanged) persist(next, nextCatalog);
    return changed;
}

// 单颗种子的商店购买价（金币）；未校准返回 null，由调用方决定回退或留空。
function getCalibratedSeedPrice(seedId: number): number | null {
    ensureFresh();
    const entry = cache![String(Number(seedId) || 0)];
    return entry && Number(entry.price) > 0 ? Number(entry.price) : null;
}

function getSeedPriceCalibrationSummary(): { count: number; catalogCount: number; updatedAt: number; file: string } {
    ensureFresh();
    let updatedAt = 0;
    let count = 0;
    for (const entry of Object.values(cache!)) {
        count += 1;
        updatedAt = Math.max(updatedAt, Number((entry as any).updatedAt) || 0);
    }
    return { count, catalogCount: Object.keys(catalog).length, updatedAt, file: CACHE_FILE };
}

// 该种子是否出现在已拉取的普通种子商店目录中。
// 目录尚未拉取过时（catalog 为空）一律返回 false，避免把“还没校准”误判为“限定”。
function isSeedInCatalog(seedId: number): boolean {
    ensureFresh();
    return !!catalog[String(Number(seedId) || 0)];
}

// 是否已经成功拉取过商店目录；只有拉取过才能据此判定限定种子。
function isCatalogLoaded(): boolean {
    ensureFresh();
    return Object.keys(catalog).length > 0;
}

module.exports = {
    CACHE_FILE,
    recordSeedShopCatalog,
    getCalibratedSeedPrice,
    getSeedPriceCalibrationSummary,
    isSeedInCatalog,
    isCatalogLoaded,
};
