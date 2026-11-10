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
