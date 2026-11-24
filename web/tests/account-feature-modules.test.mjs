import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// This repository runs its tests with Node's built-in runner.
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const source = readFileSync(new URL('../src/utils/account-feature-modules.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
const module = { exports: {} }
// eslint-disable-next-line no-new-func
new Function('require', 'module', 'exports', outputText)(require, module, module.exports)
const {
  FEATURE_MODULES,
  MODULE_GATE_KEYS,
  MUGE_REWARD_OPTIONS,
  MYSTERY_SHOP_CURRENCIES,
  applyAllowedMysteryShopCurrency,
  applyModuleEnabled,
  getAllowedMysteryShopCurrency,
  getModuleAutomation,
  getSharedFriendAction,
  isModuleEnabled,
  setSharedFriendAction,
  wereActivityRewardSettingsSaved,
} = module.exports

function createContext(automationOverrides = {}, strategyOverrides = {}, automationTopOverrides = {}) {
  return {
    strategy: {
      plantingStrategy: 'max_exp',
      intervals: { farmMin: 2, farmMax: 5, friendMin: 10, friendMax: 15 },
      friendQuietHours: { enabled: false, start: '23:00', end: '07:00', continueFarm: true },
      ...strategyOverrides,
    },
    automation: {
      automation: {
        farm: false,
        fertilizer: 'none',
        friend: false,
        friend_steal: false,
        mystery_shop_auto_buy: false,
        task: false,
        ...automationOverrides,
      },
      emailClaimHour: 10,
      ...automationTopOverrides,
    },
  }
}

test('each card pauses and resumes without changing its configured actions', () => {
  const ctx = createContext({
    farm: true, fertilizer: 'smart', fertilizer_buy_normal: true, land_upgrade: false,
    friend: false, ranch_friend_steal: true, ranch_buy: false,
    ranch_feed_organic: true, ranch_feed_organic_stage: 'near_harvest',
    task: true, mystery_shop_auto_buy: false, ranch_daily_benefit: true,
  })
  const automation = ctx.automation.automation
  const before = { ...automation }
  assert.equal(FEATURE_MODULES.length, 6)
  for (const { key } of FEATURE_MODULES) {
    assert.equal(isModuleEnabled(key, ctx), true)
    applyModuleEnabled(key, false, ctx)
    assert.equal(isModuleEnabled(key, ctx), false)
    assert.deepEqual(getModuleAutomation(key, automation, true), { [MODULE_GATE_KEYS[key]]: false })
    applyModuleEnabled(key, true, ctx)
    assert.equal(isModuleEnabled(key, ctx), true)
  }
  assert.deepEqual(automation, { ...before, ...Object.fromEntries(Object.values(MODULE_GATE_KEYS).map(gate => [gate, true])) })
})

test('card saves only include that card’s actions and options', () => {
  const automation = {
    ranch_production_enabled: false, ranch_strategy: 'bag_priority', ranch_coop_cub_priority: [1],
    ranch_facilities_enabled: true, ranch_feed_organic_stage: 'near_harvest', ranch_grass_threshold_percent: 25,
    friend: false, ranch_friend_steal: true, task: true, ranch_task: false, fertilizer: 'smart',
    farm_email_rewards: false, farm_daily_share: true, farm_illustrated: true, ranch_market_organic_poop: false,
  }
  assert.deepEqual(getModuleAutomation('ranchProduction', automation), {
    ranch_production_enabled: false, ranch_strategy: 'bag_priority', ranch_coop_cub_priority: [1],
  })
  assert.deepEqual(getModuleAutomation('ranchFacilities', automation), {
    ranch_facilities_enabled: true, ranch_feed_organic_stage: 'near_harvest', ranch_grass_threshold_percent: 25,
  })
  assert.deepEqual(getModuleAutomation('friends', automation), { friend: false, ranch_friend_steal: true })
  assert.deepEqual(getModuleAutomation('activity', automation), {
    task: true, ranch_task: false, farm_email_rewards: false, farm_daily_share: true, farm_illustrated: true, ranch_market_organic_poop: false,
  })
})

test('ranch production saves the second-based patrol range without the legacy minute field', () => {
  const result = getModuleAutomation('ranchProduction', {
    ranch_check_minutes: 5, ranch_check_min_seconds: 10, ranch_check_max_seconds: 20,
  })
  assert.deepEqual(result, { ranch_check_min_seconds: 10, ranch_check_max_seconds: 20 })
})

test('merchant currency maps the single select onto the four backend booleans', () => {
  const a = { mystery_shop_allow_gold: true }
  assert.equal(getAllowedMysteryShopCurrency(a), 'gold')
  applyAllowedMysteryShopCurrency(a, 'diamond')
  assert.equal(a.mystery_shop_allow_gold, false)
  assert.equal(a.mystery_shop_allow_diamond, true)
  assert.equal(getAllowedMysteryShopCurrency(a), 'diamond')
  applyAllowedMysteryShopCurrency(a, '')
  assert.equal(getAllowedMysteryShopCurrency(a), '')
  for (const currency of MYSTERY_SHOP_CURRENCIES)
    assert.equal(a[currency.key], false)
})

test('activity card saves each coupon gift switch independently of free gifts', () => {
  const actions = {
    mall_coupon_gift_buy: true,
    ranch_coupon_gift_buy: false,
    farm_free_gifts: false,
    ranch_daily_benefit: true,
  }
  assert.deepEqual(getModuleAutomation('activity', actions), actions)
})

test('activity card saves all four Muge reward choices', () => {
  const settings = {
    muge_claim_celebration: true,
    muge_claim_friends: false,
    muge_claim_handbook: true,
    muge_claim_personality: false,
  }
  assert.deepEqual(MUGE_REWARD_OPTIONS.map(option => option.key), Object.keys(settings))
  assert.deepEqual(getModuleAutomation('activity', settings), settings)
})

test('a backend must echo the requested reward settings before the activity draft closes', () => {
  const changes = { muge_claim_friends: true, muge_claim_handbook: false, farm_illustrated: true }
  assert.equal(wereActivityRewardSettingsSaved(changes, { task: true, ...changes }), true)
  assert.equal(wereActivityRewardSettingsSaved(changes, { task: true }), false)
  assert.equal(wereActivityRewardSettingsSaved(changes, { ...changes, muge_claim_friends: false }), false)
  assert.equal(wereActivityRewardSettingsSaved(changes, { muge_claim_friends: true, muge_claim_handbook: false }), false)
  assert.equal(wereActivityRewardSettingsSaved({ activity_enabled: false }, undefined), true)
})

test('legacy friend choices stay intact until a shared action is changed', () => {
  const automation = { friend: false, friend_help: true, ranch_friend_clean: false, friend_bad: false, ranch_friend_mosquito: true }
  assert.equal(getSharedFriendAction('patrol', automation), 'mixed')
  assert.equal(getSharedFriendAction('help', automation), 'mixed')
  assert.equal(getSharedFriendAction('mischief', automation), 'mixed')
  assert.equal(getModuleAutomation('friends', automation).ranch_friend_clean, false)

  setSharedFriendAction('patrol', false, automation)
  setSharedFriendAction('help', true, automation)
  setSharedFriendAction('mischief', false, automation)
  const fields = getModuleAutomation('friends', automation)
  assert.deepEqual(fields, {
    friend: false, ranch_friend_patrol: false,
    friend_help: true, ranch_friend_clean: true,
    friend_bad: false, ranch_friend_mosquito: false,
  })
})

test('every module card has a bundled icon so the UI never falls back to a blank image', () => {
  for (const info of FEATURE_MODULES) {
    if (!info.image) {
      assert.match(info.icon || '', /^i-carbon-/)
      continue
    }
    const relative = info.image.replace(/^\//, '')
    const file = new URL(`../public/${relative}`, import.meta.url)
    assert.ok(existsSync(file), `缺少模块图标 ${info.image}`)
    assert.ok(readFileSync(file).length > 0, `模块图标为空 ${info.image}`)
  }
})
