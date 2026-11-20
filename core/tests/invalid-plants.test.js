const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getAllSeeds, getAllPlants, getItemById, getPlantBySeedId, getPlantByFruitId } = require('../dist/config/gameConfig');
const { isInvalidPlant, isInvalidSeedId, filterInvalidPlants } = require('../dist/config/invalid-plants');

// 官方配置表残留的调试作物：成熟仅 2 秒的白萝卜（plant 2020002 / seed 29999）。
const INVALID_PLANT_ID = 2020002;
const INVALID_SEED_ID = 29999;
// 正常条目：白萝卜 20002（60 秒）、油菜 20099（4 小时）。
const VALID_SEED_IDS = [20002, 20099];

test('无效作物与其种子在配置中不可见', () => {
  const seeds = getAllSeeds();
  assert.equal(seeds.some((s) => Number(s.seedId) === INVALID_SEED_ID), false);
  assert.equal(getAllPlants().some((p) => Number(p.id) === INVALID_PLANT_ID), false);
  assert.equal(getPlantBySeedId(INVALID_SEED_ID), undefined);
  assert.equal(getItemById(INVALID_SEED_ID), undefined);
});

test('正常种子与作物不受影响', () => {
  for (const seedId of VALID_SEED_IDS) {
    assert.equal(isInvalidSeedId(seedId), false);
    assert.ok(getPlantBySeedId(seedId), `种子 ${seedId} 应仍然存在`);
    assert.ok(getItemById(seedId), `种子物品 ${seedId} 应仍然存在`);
  }
});

test('白萝卜果实仍由正常条目承载', () => {
  const plant = getPlantByFruitId(40002);
  assert.ok(plant);
  assert.equal(Number(plant.id), 1020002);
});

test('黑名单判定与过滤工具', () => {
  assert.equal(isInvalidSeedId(INVALID_SEED_ID), true);
  assert.equal(isInvalidPlant({ id: INVALID_PLANT_ID }), true);
  assert.equal(isInvalidPlant({ id: 1, seed_id: INVALID_SEED_ID }), true);
  assert.equal(isInvalidPlant({ id: 1, seed_id: 20002 }), false);
  assert.equal(isInvalidPlant(null), false);

  const kept = filterInvalidPlants([{ id: 1, seed_id: 20002 }, { id: INVALID_PLANT_ID, seed_id: INVALID_SEED_ID }]);
  assert.equal(kept.length, 1);
  assert.equal(Number(kept[0].id), 1);
});