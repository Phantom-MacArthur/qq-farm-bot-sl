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
  MODULE_SAVE_PARTS,
  MYSTERY_SHOP_CURRENCIES,
  applyAllowedMysteryShopCurrency,
  applyModuleEnabled,
  getAllowedMysteryShopCurrency,
  isModuleEnabled,
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

test('module keys are unique and every module declares its save parts', () => {
  const keys = FEATURE_MODULES.map(item => item.key)
  assert.equal(new Set(keys).size, keys.length)
  for (const key of keys)
    assert.ok(Array.isArray(MODULE_SAVE_PARTS[key]) && MODULE_SAVE_PARTS[key].length > 0, `${key} 缺少保存分组`)
})

test('module switch state reflects the switches the backend actually reads', () => {
  const off = createContext()
  for (const info of FEATURE_MODULES)
    assert.equal(isModuleEnabled(info.key, off), false, `${info.key} 默认应为关闭`)

  const on = createContext({
    farm: true,
    fertilizer: 'normal',
    friend: true,
    friend_steal: true,
    task: true,
  })
  for (const info of FEATURE_MODULES)
    assert.equal(isModuleEnabled(info.key, on), true, `${info.key} 开启后应为开启`)
})

test('the merchant card is gone and its auto-buy switch feeds the activity module', () => {
  assert.equal(FEATURE_MODULES.some(info => info.key === 'merchant'), false)
  assert.equal(isModuleEnabled('activity', createContext({ mystery_shop_auto_buy: true })), true)
})

test('steal is a switch inside the friends module, not its own card', () => {
  assert.equal(FEATURE_MODULES.some(info => info.key === 'steal'), false)
  // 偷菜开关（automation）和偷菜延迟（strategy）都靠保存好友模块写回
  assert.deepEqual(MODULE_SAVE_PARTS.friends, ['strategy', 'automation'])
})

test('closing the friends card leaves the steal switch alone', () => {
  // 后端好友任务入口只看 friend 总开关，子开关保留原值便于重新开启
  const ctx = createContext({ friend: true, friend_steal: true })
  applyModuleEnabled('friends', false, ctx)
  assert.equal(ctx.automation.automation.friend, false)
  assert.equal(ctx.automation.automation.friend_steal, true)
  assert.equal(isModuleEnabled('friends', ctx), false)
})

test('turning fertilizer off forces the strategy to none and stops land upgrades', () => {
  const ctx = createContext({ fertilizer: 'smart', land_upgrade: true })
  assert.equal(isModuleEnabled('fertilizer', ctx), true)
  applyModuleEnabled('fertilizer', false, ctx)
  assert.equal(ctx.automation.automation.fertilizer, 'none')
  assert.equal(ctx.automation.automation.land_upgrade, false)
  assert.equal(isModuleEnabled('fertilizer', ctx), false)
})

test('turning fertilizer back on restores a real strategy instead of leaving none', () => {
  const ctx = createContext({ fertilizer: 'none' })
  applyModuleEnabled('fertilizer', true, ctx)
  assert.notEqual(ctx.automation.automation.fertilizer, 'none')
  assert.equal(isModuleEnabled('fertilizer', ctx), true)
})

test('turning the activity module off also stops the merchant auto buy and its notification', () => {
  const ctx = createContext({ mystery_shop_auto_buy: true, mystery_shop_purchase_notify: true })
  assert.equal(isModuleEnabled('activity', ctx), true)
  applyModuleEnabled('activity', false, ctx)
  assert.equal(ctx.automation.automation.mystery_shop_auto_buy, false)
  assert.equal(ctx.automation.automation.mystery_shop_purchase_notify, false)
  assert.equal(isModuleEnabled('activity', ctx), false)
})

test('turning the activity module off also stops the coupon gift purchase', () => {
  const ctx = createContext({ task: true, mall_coupon_gift_buy: true })
  assert.equal(isModuleEnabled('activity', ctx), true)
  applyModuleEnabled('activity', false, ctx)
  assert.equal(ctx.automation.automation.task, false)
  assert.equal(ctx.automation.automation.mall_coupon_gift_buy, false)
  assert.equal(isModuleEnabled('activity', ctx), false)
})

test('planting module toggle only touches the farm switch', () => {
  const ctx = createContext({ farm: false, sell: true, friend: true })
  applyModuleEnabled('planting', true, ctx)
  assert.equal(ctx.automation.automation.farm, true)
  assert.equal(ctx.automation.automation.sell, true)
  assert.equal(ctx.automation.automation.friend, true)
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

test('every module card has a bundled icon so the UI never falls back to a blank image', () => {
  for (const info of FEATURE_MODULES) {
    const relative = info.image.replace(/^\//, '')
    const file = new URL(`../public/${relative}`, import.meta.url)
    assert.ok(existsSync(file), `缺少模块图标 ${info.image}`)
    assert.ok(readFileSync(file).length > 0, `模块图标为空 ${info.image}`)
  }
})
