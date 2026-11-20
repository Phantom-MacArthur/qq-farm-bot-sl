const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 必须在 require 任何间接依赖 seed-price-cache 的模块之前指定，避免用例清理写进 core/data 的真实校准数据。
process.env.SEED_PRICE_CACHE_FILE = path.join(os.tmpdir(), `seed-price-cache-test-${process.pid}.json`);

const CACHE_MODULE = require.resolve('../dist/services/seed-price-cache');
const GAME_CONFIG_MODULE = require.resolve('../dist/config/gameConfig');

// 冬瓜种子：ItemInfo.sells=1001:3360（回收价），商店按颗出售 6720。
const MELON_GOODS = { id: 501, item_id: 20068, price: 6720, item_count: 1 };
// 多颗包样本：一包 8 颗共 48000，单颗应为 6000（口径对齐 docs/shop-protocols.md 抓包记录）。
const PACK_GOODS = { id: 502, item_id: 20099, price: 48000, item_count: 8 };

// 每次取新实例，隔离模块级内存缓存与秒级 stat 节流，让“离线从盘上恢复”可确定性验证。
function freshCache() {
  delete require.cache[CACHE_MODULE];
  return require(CACHE_MODULE);
}

function freshGameConfig() {
  delete require.cache[CACHE_MODULE];
  delete require.cache[GAME_CONFIG_MODULE];
  return require(GAME_CONFIG_MODULE);
}

function cleanup() {
  try { fs.rmSync(process.env.SEED_PRICE_CACHE_FILE, { force: true }); } catch { /* ignore */ }
}

cleanup();
after(cleanup);

test('未校准的种子返回 null，便于上层把利润指标留空', () => {
  assert.equal(freshCache().getCalibratedSeedPrice(20068), null);
});

test('校准价优先于 2×sells 估算，且无 ItemInfo 条目时仍可生效', () => {
  const { getSeedPrice } = freshGameConfig();
  // 冬瓜 sells=3360（回收价），未校准时应按 2×sells=6720 估算购买价，不能直接回退 3360
  assert.equal(getSeedPrice(20068), 6720);
  assert.equal(getSeedPrice(20068, 5040), 5040); // 真实校准价覆盖估算值
  assert.equal(getSeedPrice(20068, null), 6720);
  assert.equal(getSeedPrice(999999999, 123), 123);
  assert.equal(getSeedPrice(999999999), 0);
});

test('商品包价折算为单颗价，无效条目被跳过', () => {
  const cache = freshCache();
  const changed = cache.recordSeedShopCatalog([
    MELON_GOODS,
    PACK_GOODS,
    { id: 503, item_id: 0, price: 100, item_count: 1 }, // 无物品 ID
    { id: 504, item_id: 20077, price: 0, item_count: 1 }, // 无效价格
    { id: 505, item_id: 20088, price: 640, item_count: 0 }, // 数量缺失按 1 颗
  ]);
  assert.equal(changed, 3);
  assert.equal(cache.getCalibratedSeedPrice(20068), 6720);
  assert.equal(cache.getCalibratedSeedPrice(20099), 6000);
  assert.equal(cache.getCalibratedSeedPrice(20088), 640);
  assert.equal(cache.getCalibratedSeedPrice(20077), null);
});

test('目录未变化时不重复计入变更，异常空目录也不清空历史校准', () => {
  const cache = freshCache();
  assert.equal(cache.recordSeedShopCatalog([MELON_GOODS, PACK_GOODS]), 0);
  assert.equal(cache.recordSeedShopCatalog([]), 0);
  assert.equal(cache.recordSeedShopCatalog(undefined), 0);
  assert.equal(cache.getCalibratedSeedPrice(20068), 6720);
});

test('调价原地覆盖，且新进程（离线账号）能从本地文件恢复校准结果', () => {
  const cache = freshCache();
  assert.equal(cache.recordSeedShopCatalog([{ ...MELON_GOODS, price: 7000 }]), 1);
  assert.equal(cache.getCalibratedSeedPrice(20068), 7000);

  const summary = cache.getSeedPriceCalibrationSummary();
  assert.equal(summary.count, 3);
  assert.ok(summary.updatedAt > 0);

  // 模拟另一个账号/主进程冷启动：只读文件，不联网
  const reloaded = freshCache();
  assert.equal(reloaded.getCalibratedSeedPrice(20068), 7000);
  assert.equal(reloaded.getCalibratedSeedPrice(20099), 6000);
  const persisted = JSON.parse(fs.readFileSync(reloaded.CACHE_FILE, 'utf8'));
  assert.equal(persisted.seeds['20068'].packagePrice, 7000);
  assert.equal(persisted.seeds['20099'].itemCount, 8);
});

test('校准价经 getAllSeeds 透出，与 2×sells=6720 估算值区分，调价同步生效', () => {
  const cache = freshCache();
  cache.recordSeedShopCatalog([{ ...MELON_GOODS, price: 8400 }]); // 校准价 8400，明显不同于 2×sells 的 6720
  assert.equal(freshGameConfig().getAllSeeds().find(s => s.seedId === 20068).price, 8400);
  cache.recordSeedShopCatalog([{ ...MELON_GOODS, price: 5040 }]); // 官方调价 → 原地覆盖
  assert.equal(freshGameConfig().getAllSeeds().find(s => s.seedId === 20068).price, 5040);
});

test('缓存文件缺失时退化为空缓存而不是报错', () => {
  cleanup();
  const cache = freshCache();
  assert.equal(cache.getCalibratedSeedPrice(20068), null);
  assert.equal(cache.getSeedPriceCalibrationSummary().count, 0);
});

test('未拉取目录时不判定限定，拉取后可按目录成员区分限定种子', () => {
  cleanup();
  let cache = freshCache();
  // 目录从未拉取：不能把“还没校准”当成“限定”
  assert.equal(cache.isCatalogLoaded(), false);
  assert.equal(cache.isSeedInCatalog(20068), false);
  assert.equal(cache.isSeedInCatalog(21135), false);

  cache = freshCache();
  cache.recordSeedShopCatalog([MELON_GOODS, PACK_GOODS]);
  assert.equal(cache.isCatalogLoaded(), true);
  assert.equal(cache.isSeedInCatalog(20068), true);
  assert.equal(cache.isSeedInCatalog(20099), true);
  // 艾草 21135 是神秘商人商品，不在普通种子商店目录
  assert.equal(cache.isSeedInCatalog(21135), false);
  assert.equal(cache.getSeedPriceCalibrationSummary().catalogCount, 2);
});

test('目录成员与可校准价格分开记录：价格无效的目录商品仍算目录内但无价', () => {
  cleanup();
  const cache = freshCache();
  // 限购/未解锁商品价格可能为 0，它是目录成员，但拿不到购买价
  cache.recordSeedShopCatalog([{ id: 506, item_id: 20066, price: 0, item_count: 1 }]);
  assert.equal(cache.isSeedInCatalog(20066), true);
  assert.equal(cache.getCalibratedSeedPrice(20066), null);
});

test('旧格式缓存（只有 seeds）升级后以 seeds 键作为目录成员', () => {
  cleanup();
  // 模拟升级前的文件：没有 catalog 字段
  fs.writeFileSync(process.env.SEED_PRICE_CACHE_FILE, JSON.stringify({
    seeds: { 20068: { price: 6720, packagePrice: 6720, itemCount: 1, goodsId: 501, updatedAt: Date.now() } },
  }));
  const cache = freshCache();
  assert.equal(cache.isCatalogLoaded(), true);
  assert.equal(cache.isSeedInCatalog(20068), true);
  assert.equal(cache.isSeedInCatalog(21135), false);
  cleanup();
});
