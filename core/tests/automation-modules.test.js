const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { effectiveAutomation } = require('../dist/config/automation-modules');
const ranchConfig = require('../dist/config/ranch-automation');
const { normalizeAccountConfig } = require('../dist/models/store/shared-state');

test('saved choices survive pausing and resuming cards across both scenes', () => {
    const saved = normalizeAccountConfig({ automation: {
        ranch_buy: true, ranch_sell: false, ranch_coop_cub_priority: [],
        ranch_grass_buy: true, ranch_grass_threshold_percent: 25, ranch_feed_organic_stage: 'near_harvest',
        ranch_friend_steal: true, friend: true, fertilizer: 'smart', fertilizer_buy_organic: true,
        task: true, farm_illustrated: true, ranch_daily_benefit: true, ranch_market_organic_poop: true,
    } }).automation;
    assert.equal(effectiveAutomation(saved).ranch_buy, true);
    const paused = normalizeAccountConfig({ automation: {
        ranch_production_enabled: false, ranch_facilities_enabled: false,
        friends_enabled: false, fertilizer_enabled: false, activity_enabled: false,
    } }, { ...normalizeAccountConfig({}), automation: saved }).automation;
    const effective = effectiveAutomation(paused);
    for (const key of ['ranch_buy', 'ranch_grass_buy', 'friend', 'ranch_friend_steal', 'fertilizer_buy_organic',
        'task', 'farm_illustrated', 'ranch_daily_benefit', 'ranch_market_organic_poop']) {
        assert.equal(effective[key], false, key);
        assert.equal(paused[key], true, key);
    }
    assert.equal(effective.farm, saved.farm);
    assert.equal(effective.fertilizer, 'none');
    assert.equal(paused.fertilizer, 'smart');
    assert.equal(effective.ranch_grass_threshold_percent, 25);
    assert.equal(effective.ranch_feed_organic_stage, 'near_harvest');
    const resumed = effectiveAutomation({ ...paused, ranch_production_enabled: true });
    assert.equal(resumed.ranch_buy, true);
    assert.equal(resumed.ranch_sell, false);
    assert.equal(resumed.ranch_grass_buy, false);
    assert.equal(normalizeAccountConfig({}).automation.farm_illustrated, false);
    assert.equal(effectiveAutomation({ ...paused, activity_enabled: true, task: false }).farm_illustrated, true);
});

test('free shed unlock is enabled for legacy accounts and follows the facilities gate', () => {
    const saved = normalizeAccountConfig({ automation: {
        ranch_activate_shed: false, ranch_upgrade: false, ranch_buy: false,
    } }).automation;
    assert.equal(saved.ranch_activate_shed, true);
    assert.equal(effectiveAutomation(saved).ranch_activate_shed, true);
    assert.equal(effectiveAutomation({ ...saved, ranch_facilities_enabled: false }).ranch_activate_shed, false);
    assert.equal(normalizeAccountConfig({ automation: { ranch_upgrade: false, ranch_buy: false } }).automation.ranch_activate_shed, true);
});

test('a legacy farm coupon gift setting does not turn on ranch purchases', () => {
    const old = normalizeAccountConfig({ automation: { mall_coupon_gift_buy: true } }).automation;
    assert.equal(old.mall_coupon_gift_buy, true);
    assert.equal(old.ranch_coupon_gift_buy, false);
    const ranchOnly = normalizeAccountConfig({ automation: { mall_coupon_gift_buy: false, ranch_coupon_gift_buy: true } }).automation;
    assert.equal(effectiveAutomation(ranchOnly).ranch_coupon_gift_buy, true);
    assert.equal(effectiveAutomation(ranchOnly).mall_coupon_gift_buy, false);
    assert.equal(effectiveAutomation({ ...ranchOnly, activity_enabled: false }).ranch_coupon_gift_buy, false);
});

test('ranch friend work follows the shared quiet-hours check without pausing own ranch work', () => {
    let quiet = true;
    const automation = { ranch_friend_steal: true };
    const filename = require.resolve('../dist/services/ranch/automation');
    const module = { exports: {} };
    const dependencies = {
        '../../config/ranch-automation': ranchConfig,
        '../../models/store': { getAutomation: () => automation },
        '../friend/visit-strategy': { inFriendQuietHours: () => quiet },
        './transport': { isUnlocked: () => true },
        './friends': { getInteractionQuotaResetAt: () => 0 },
    };
    const { getRoutineState } = vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nmodule.exports', {
        exports: module.exports, module, require: name => dependencies[name] || {},
    }, { filename });
    const paused = getRoutineState();
    assert.equal(paused.doneToday, true);
    assert.ok(Number.isFinite(paused.nextCheckAt));
    automation.ranch_harvest = true;
    assert.equal(getRoutineState().doneToday, false);
    automation.ranch_harvest = false;
    quiet = false;
    assert.equal(getRoutineState().doneToday, false);
});

test('pausing friend patrol preserves ranch actions and still allows own ranch work and friend requests', () => {
    const saved = normalizeAccountConfig({ automation: {
        friend: false, ranch_friend_patrol: false, ranch_friend_clean: true,
        ranch_friend_steal: true, ranch_friend_mosquito: true, ranch_stroke: true,
        ranch_harvest: true, friend_auto_accept: true,
    } }).automation;
    const paused = effectiveAutomation(saved);
    assert.equal(paused.friend, false);
    assert.equal(paused.ranch_friend_clean, false);
    assert.equal(paused.ranch_friend_steal, false);
    assert.equal(paused.ranch_friend_mosquito, false);
    assert.equal(paused.ranch_stroke, false);
    assert.equal(paused.ranch_harvest, true);
    assert.equal(paused.friend_auto_accept, true);
    const resumed = effectiveAutomation({ ...saved, friend: true, ranch_friend_patrol: true });
    assert.equal(resumed.friend, true);
    assert.equal(resumed.ranch_friend_clean, true);
});

test('ranch friend patrol uses the shared interval and enables production with stroking', async () => {
    let now = 1000;
    const automation = {
        ranch_friend_steal: true, ranch_friend_clean: true, ranch_stroke: false,
        ranch_friend_produce: true, ranch_check_minutes: 60,
    };
    const visits = [];
    const filename = require.resolve('../dist/services/ranch/automation');
    const module = { exports: {} };
    const dependencies = {
        '../../config/ranch-automation': ranchConfig,
        '../../models/store': {
            getAutomation: () => automation, getRanchFriendBlacklist: () => [], getStealDelaySeconds: () => 0,
        },
        '../friend/visit-strategy': { inFriendQuietHours: () => false },
        './friend-roster': {
            getRanchFriendList: async () => [{ gid: 1, statusAtMs: now, canSteal: true, canHelp: true }],
        },
        './transport': { isUnlocked: () => true, inScene: run => run() },
        './friends': {
            getInteractionQuotaResetAt: () => 0,
            automateFriend: async (_gid, enabled) => {
                visits.push(['steal', 'stroke', 'produceFriend', 'cleanFriend'].filter(enabled));
                return { times: {} };
            },
        },
    };
    const { run, getRoutineState } = vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nmodule.exports', {
        exports: module.exports, module, require: name => dependencies[name] || {},
        Date: { now: () => now }, process: { env: {} },
    }, { filename });
    const options = { nextFriendIntervalMs: () => 7000 };
    await run(options);
    assert.deepEqual(visits, [['steal', 'cleanFriend']]);
    assert.equal(getRoutineState().nextCheckAt, 8000);
    await run(options);
    assert.equal(visits.length, 1);
    now = 8000;
    automation.ranch_friend_steal = false;
    automation.ranch_stroke = true;
    automation.ranch_friend_produce = false;
    await run(options);
    assert.deepEqual(visits[1], ['stroke', 'produceFriend', 'cleanFriend']);
    assert.equal(getRoutineState().nextCheckAt, 15000);
});

test('independent stroke settings take priority over the legacy stealing setting', () => {
    assert.equal(normalizeAccountConfig({ automation: { ranch_friend_steal: false } }).automation.ranch_stroke, false);
    assert.equal(normalizeAccountConfig({ automation: { ranch_friend_steal: false, ranch_stroke: true } }).automation.ranch_stroke, true);
});
