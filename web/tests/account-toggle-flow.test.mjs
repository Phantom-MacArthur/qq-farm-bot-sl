import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'

const require = createRequire(import.meta.url)
const { createPinia, disposePinia, setActivePinia } = require('pinia')
const ts = require('typescript')
const vue = require('vue')

function loadAccountStore(api, pinia) {
  const source = readFileSync(new URL('../src/stores/account.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } })
  const module = { exports: {} }
  const imports = {
    '@/api': { __esModule: true, default: api, getApiErrorMessage: value => value?.response?.data?.error || value?.error || value?.message || '请求失败' },
    '@vueuse/core': { useStorage: (_key, defaultValue) => vue.ref(defaultValue) },
  }
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', outputText)(id => imports[id] || require(id), module, module.exports)
  return module.exports.useAccountStore(pinia)
}

function createHarness(t, api) {
  const pinia = createPinia()
  setActivePinia(pinia)
  t.after(() => disposePinia(pinia))
  return { store: loadAccountStore(api, pinia) }
}

function accountState({ running = false, online = false } = {}) {
  return { data: { ok: true, data: { accounts: [{ id: '7', name: 'acc', running, online }] } } }
}

test('启动只在上报上线后算确认，确认期间按钮状态保持进行中', async (t) => {
  const calls = []
  let store
  const states = [
    accountState({ running: true, online: false }),
    accountState({ running: true, online: false }),
    accountState({ running: true, online: true }),
  ]
  const api = {
    get: async () => states.shift() || accountState({ running: true, online: true }),
    post: async (url, _body, config) => {
      calls.push({ url, timeout: config?.timeout })
      // 请求返回时结果还没确认，按钮必须仍处于不可用状态
      assert.equal(store.pendingActions['7'], 'start')
      return { data: { ok: true } }
    },
  }
  store = createHarness(t, api).store

  const result = await store.startAccount('7', { timeoutMs: 500, intervalMs: 1 })

  assert.deepEqual(result, { ok: true, confirmed: true })
  // 启动请求自带长超时，不会被默认 10s 超时误杀
  assert.deepEqual(calls, [{ url: '/api/accounts/7/start', timeout: 60000 }])
  assert.deepEqual(store.pendingActions, {})
  assert.equal(store.accounts[0].online, true)
})

test('上线确认超时只报告未确认，不会把按钮卡在进行中', async (t) => {
  const { store } = createHarness(t, {
    get: async () => accountState({ running: true, online: false }),
    post: async () => ({ data: { ok: true } }),
  })

  const result = await store.startAccount('7', { timeoutMs: 30, intervalMs: 5 })

  assert.deepEqual(result, { ok: true, confirmed: false })
  assert.deepEqual(store.pendingActions, {})
  // 进程还在但没上线，页面应按离线展示
  assert.equal(store.accounts[0].running, true)
  assert.equal(store.accounts[0].online, false)
})

test('停止等到进程消失才算确认，账号被删除也算已停止', async (t) => {
  let store
  const api = {
    get: async () => accountState({ running: false, online: false }),
    post: async () => {
      assert.equal(store.pendingActions['7'], 'stop')
      return { data: { ok: true } }
    },
  }
  store = createHarness(t, api).store

  assert.deepEqual(await store.stopAccount('7', { timeoutMs: 500, intervalMs: 1 }), { ok: true, confirmed: true })

  const emptyStore = createHarness(t, {
    get: async () => ({ data: { ok: true, data: { accounts: [] } } }),
    post: async () => ({ data: { ok: true } }),
  }).store

  assert.deepEqual(await emptyStore.stopAccount('7', { timeoutMs: 500, intervalMs: 1 }), { ok: true, confirmed: true })
})

test('启动失败会带回错误原因并立刻释放按钮', async (t) => {
  const httpError = Object.assign(new Error('Request failed'), { response: { data: { error: 'Code 已失效' } } })
  const errors = [
    { api: { get: async () => accountState(), post: async () => { throw httpError } }, expected: 'Code 已失效' },
    { api: { get: async () => accountState(), post: async () => ({ data: { ok: false, error: '账号未找到' } }) }, expected: '账号未找到' },
  ]

  for (const { api, expected } of errors) {
    const { store } = createHarness(t, api)
    const result = await store.startAccount('7', { timeoutMs: 50, intervalMs: 1 })

    assert.equal(result.ok, false)
    assert.equal(result.confirmed, false)
    assert.equal(result.error, expected)
    assert.deepEqual(store.pendingActions, {})
  }
})

test('启动失败且列表接口也拉不到时保留现有账号列表', async (t) => {
  const store = createHarness(t, {
    get: async () => { throw new Error('服务离线') },
    post: async () => { throw new Error('启动失败') },
  }).store
  store.accounts = [{ id: '7', name: 'acc', running: false, online: false }]

  const result = await store.startAccount('7', { timeoutMs: 50, intervalMs: 1 })

  assert.equal(result.ok, false)
  assert.equal(result.error, '启动失败')
  assert.equal(store.accounts.length, 1)
  assert.deepEqual(store.pendingActions, {})
})

test('同一账号的启动停止不会并发执行', async (t) => {
  let releasePost = null
  const { store } = createHarness(t, {
    get: async () => accountState({ running: true, online: true }),
    post: async () => new Promise((resolve) => {
      releasePost = resolve
    }),
  })

  const first = store.startAccount('7', { timeoutMs: 500, intervalMs: 1 })
  await Promise.resolve()
  assert.equal(store.pendingActions['7'], 'start')

  const second = await store.stopAccount('7', { timeoutMs: 500, intervalMs: 1 })
  assert.equal(second.ok, false)
  assert.equal(second.error, '该账号已有进行中的操作')

  releasePost({ data: { ok: true } })
  assert.deepEqual(await first, { ok: true, confirmed: true })
  assert.deepEqual(store.pendingActions, {})

  const empty = await store.startAccount('', { timeoutMs: 50, intervalMs: 1 })
  assert.deepEqual(empty, { ok: false, confirmed: false, error: '未选择账号' })
})

test('轮询期间的单次失败不清空账号列表', async (t) => {
  let failed = false
  const { store } = createHarness(t, {
    get: async () => {
      if (!failed) {
        failed = true
        throw new Error('临时网络错误')
      }
      return accountState({ running: true, online: true })
    },
    post: async () => ({ data: { ok: true } }),
  })

  const result = await store.startAccount('7', { timeoutMs: 200, intervalMs: 1 })

  assert.deepEqual(result, { ok: true, confirmed: true })
  assert.equal(store.accounts.length, 1)
})
