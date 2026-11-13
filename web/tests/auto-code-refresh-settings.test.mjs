import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'

const require = createRequire(import.meta.url)
const { createPinia, disposePinia } = require('pinia')
const ts = require('typescript')

function loadSettingStore(api, pinia) {
  const source = readFileSync(new URL('../src/stores/setting.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } })
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', outputText)(id => id === '@/api'
    ? { __esModule: true, default: api, getApiErrorMessage: value => value?.error }
    : require(id), module, module.exports)
  return module.exports.useSettingStore(pinia)
}

test('微信code定时刷新设置按全局接口读写，不依赖当前账号头', async (t) => {
  const pinia = createPinia()
  t.after(() => disposePinia(pinia))
  const calls = []
  const api = {
    get: async (url) => {
      calls.push({ method: 'get', url })
      return { data: { ok: true, data: { enabled: false, intervalMinutes: 7 } } }
    },
    post: async (url, body, options) => {
      calls.push({ method: 'post', url, body, headers: options?.headers })
      return { data: { ok: true, data: { ...body, maxRetries: 9 } } }
    },
  }
  const store = loadSettingStore(api, pinia)

  assert.deepEqual(store.autoCodeRefresh, { enabled: true, intervalMinutes: 2, maxRetries: 8 })

  assert.deepEqual(await store.fetchAutoCodeRefresh(), { ok: true })
  // 缺省字段必须回落到默认值，不能留下 undefined
  assert.deepEqual(store.autoCodeRefresh, { enabled: false, intervalMinutes: 7, maxRetries: 8 })
  assert.equal(store.autoCodeRefreshLoading, false)

  assert.deepEqual(await store.saveAutoCodeRefresh({ enabled: true, intervalMinutes: 7, maxRetries: 9 }), { ok: true })
  assert.deepEqual(calls[1], {
    method: 'post',
    url: '/api/settings/auto-code-refresh',
    body: { enabled: true, intervalMinutes: 7, maxRetries: 9 },
    headers: undefined,
  })
  assert.deepEqual(store.autoCodeRefresh, { enabled: true, intervalMinutes: 7, maxRetries: 9 })
})

test('立即刷新只在服务端确认成功时报成功，且必须带账号头', async (t) => {
  const pinia = createPinia()
  t.after(() => disposePinia(pinia))
  const calls = []
  let runResult = { ok: true }
  const api = {
    get: async () => ({ data: { ok: true, data: {} } }),
    post: async (url, body, options) => {
      calls.push({ url, headers: options?.headers })
      return { data: { ok: true, data: runResult } }
    },
  }
  const store = loadSettingStore(api, pinia)

  assert.deepEqual(await store.runAutoCodeRefresh(''), { ok: false, error: '未选择账号' })
  assert.equal(calls.length, 0)

  assert.deepEqual(await store.runAutoCodeRefresh('12'), { ok: true })
  assert.deepEqual(calls[0], { url: '/api/settings/auto-code-refresh/run', headers: { 'x-account-id': '12' } })

  // 外层 ok 只代表请求送达，内层 ok=false 仍是刷新失败
  runResult = { ok: false }
  assert.equal((await store.runAutoCodeRefresh('12')).ok, false)
})

test('刷新设置读取失败时返回错误并保留上一次可用配置', async (t) => {
  const pinia = createPinia()
  t.after(() => disposePinia(pinia))
  const api = {
    get: async () => ({ data: { ok: false, error: '后端离线' } }),
    post: async () => ({ data: { ok: true, data: {} } }),
  }
  const store = loadSettingStore(api, pinia)

  await store.saveAutoCodeRefresh({ enabled: true, intervalMinutes: 30, maxRetries: 3 })
  const before = { ...store.autoCodeRefresh }

  assert.deepEqual(await store.fetchAutoCodeRefresh(), { ok: false, error: '后端离线' })
  assert.deepEqual(store.autoCodeRefresh, before)
  assert.equal(store.autoCodeRefreshLoading, false)
})
