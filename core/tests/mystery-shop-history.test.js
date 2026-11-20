const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getDataFile } = require('../dist/config/runtime-paths');
const mysteryShop = require('../dist/services/mystery-shop');

const ACCOUNT_ID = `hist-test-${process.pid}`;
const HISTORY_FILE = path.join(getDataFile('mystery_shop_history'), `${ACCOUNT_ID}.json`);

function cleanup() {
  try { fs.rmSync(HISTORY_FILE, { force: true }); } catch { /* ignore */ }
}

const offer = {
  id: 42,
  reward: { id: 9001, name: '神秘种子', count: 3, image: '/img/9001.png' },
  price: { id: 1002, name: '点券', count: 500 },
  originalPrice: 800,
  discountPercent: 62,
};

test('appendMysteryShopHistory maps the normalized offer into a record', () => {
  cleanup();
  const record = mysteryShop.appendMysteryShopHistory(ACCOUNT_ID, offer, { reward: offer.reward }, 'auto');
  assert.equal(record.npcId, 42);
  assert.equal(record.source, 'auto');
  assert.equal(record.itemId, 9001);
  assert.equal(record.itemName, '神秘种子');
  assert.equal(record.itemCount, 3);
  assert.equal(record.currencyId, 1002);
  assert.equal(record.price, 500);
  assert.equal(record.originalPrice, 800);
  assert.equal(record.discountPercent, 62);
});

test('getMysteryShopHistory returns newest-first and defaults to an empty list', () => {
  cleanup();
  assert.deepEqual(mysteryShop.getMysteryShopHistory(ACCOUNT_ID), []);
  const first = mysteryShop.appendMysteryShopHistory(ACCOUNT_ID, offer, null, 'manual');
  const second = mysteryShop.appendMysteryShopHistory(ACCOUNT_ID, { ...offer, id: 43 }, null, 'manual');
  const records = mysteryShop.getMysteryShopHistory(ACCOUNT_ID);
  assert.equal(records.length, 2);
  assert.equal(records[0].npcId, second.npcId);
  assert.equal(records[1].npcId, first.npcId);
  cleanup();
});

test('source defaults to manual and unknown ids raise', () => {
  cleanup();
  const record = mysteryShop.appendMysteryShopHistory(ACCOUNT_ID, offer);
  assert.equal(record.source, 'manual');
  assert.throws(() => mysteryShop.appendMysteryShopHistory('', offer), /缺少账号 ID/);
  cleanup();
});

function mockMysteryPurchase(t, getReply, sendBuy) {
  const previousAccountId = process.env.FARM_ACCOUNT_ID;
  process.env.FARM_ACCOUNT_ID = ACCOUNT_ID;
  cleanup();
  t.after(() => {
    cleanup();
    fs.rmSync(path.join(getDataFile('mystery_shop_submissions'), ACCOUNT_ID), { recursive: true, force: true });
    if (previousAccountId === undefined) delete process.env.FARM_ACCOUNT_ID;
    else process.env.FARM_ACCOUNT_ID = previousAccountId;
  });
  const warehouse = require('../dist/services/warehouse');
  t.mock.method(warehouse, 'getBag', async () => [{ id: 1001, count: 100000 }]);
  t.mock.method(warehouse, 'getBagItems', items => items);
  t.mock.method(require('../dist/services/pay'), 'getDiamondBalance', async () => 0);
  t.mock.method(mysteryShop, 'getActiveNPC', async () => getReply());
  const buy = t.mock.method(mysteryShop, 'buy', sendBuy);
  return { buy, purchase: require('../dist/services/commerce').purchaseMysteryOffer };
}

function reply(activeTime, count = 3) {
  const time = Math.floor(Date.now() / 1000);
  return {
    is_active: true,
    active_time: activeTime,
    expire_time: time + 3600,
    npc: { npc_id: 42, reward_item_id: 9001, reward_count: count, currency_item_id: 1001, price: 500 },
  };
}

test('concurrent purchases send only once and a new visit can be purchased', async (t) => {
  let visit = Math.floor(Date.now() / 1000) - 10;
  let count = 3;
  const { buy, purchase } = mockMysteryPurchase(t, () => reply(visit, count), async () => { count = 1; });
  const results = await Promise.allSettled([purchase(42), purchase(42)]);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected']);
  assert.equal(buy.mock.callCount(), 1);
  assert.equal(mysteryShop.getMysteryShopHistory(ACCOUNT_ID).length, 1);

  visit += 1;
  count = 3;
  await purchase(42);
  assert.equal(buy.mock.callCount(), 2);
  assert.equal(mysteryShop.getMysteryShopHistory(ACCOUNT_ID).length, 2);
});

test('disappearance after submit is not success, and reloading does not submit again', async (t) => {
  const visit = Math.floor(Date.now() / 1000) - 10;
  let visible = true;
  const { buy, purchase } = mockMysteryPurchase(t, () => visible ? reply(visit) : {}, async () => { visible = false; });
  await assert.rejects(purchase(42));
  assert.deepEqual(mysteryShop.getMysteryShopHistory(ACCOUNT_ID), []);
  assert.equal(buy.mock.callCount(), 1);

  visible = true;
  const serviceId = require.resolve('../dist/services/commerce');
  const shopId = require.resolve('../dist/services/mystery-shop');
  const originalService = require.cache[serviceId];
  const originalShop = require.cache[shopId];
  delete require.cache[serviceId];
  delete require.cache[shopId];
  try {
    const reloaded = require(shopId);
    t.mock.method(reloaded, 'getActiveNPC', async () => reply(visit));
    const secondBuy = t.mock.method(reloaded, 'buy', async () => {});
    await assert.rejects(require(serviceId).purchaseMysteryOffer(42));
    assert.equal(secondBuy.mock.callCount(), 0);
  } finally {
    require.cache[serviceId] = originalService;
    require.cache[shopId] = originalShop;
  }
});
