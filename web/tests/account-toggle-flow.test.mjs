import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'

const require = createRequire(import.meta.url)
const { createPinia, disposePinia, setActivePinia } = require('pinia')
const ts = require('typescript')
const vue = require('vue')

function loadSource(path, imports = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } })
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', outputText)(id => imports[id] || require(id), module, module.exports)
  return module.exports
}

function makePresenceHarness(t) {
  const messages = []
  const apiModule = loadSource('../src/api/index.ts', {
    '@vueuse/core': { useStorage: (_key, defaultValue) => vue.ref(defaultValue) },
    '@/stores/toast': { useToastStore: () => ({ error: message => messages.push(message) }) },
  })
  const account = vue.reactive({ currentAccountId: apiModule.selectedAccountId, currentAccount: { running: true } })
  const status = vue.reactive({ status: null })
  const { useReconnectRefresh } = loadSource('../src/composables/useReconnectRefresh.ts', {
    '@/api': apiModule,
    '@/stores/account': { useAccountStore: () => account },
    '@/stores/status': { useStatusStore: () => status },
  })
  let refreshes = 0
  const scope = vue.effectScope()
  t.after(() => scope.stop())
  const presence = scope.run(() => useReconnectRefresh(() => refreshes++))
  function connect(id, response) {
    status.status = { accountId: id, connection: { connected: true } }
    apiModule.confirmAccountConnection(id, true, response)
  }
  return { account, status, api: apiModule.default, presence, messages, connect, refreshes: () => refreshes }
}

test('account offline responses replace the toast and reconnect refreshes the current page once', async (t) => {
  const { account, status, api, presence, messages, connect, refreshes } = makePresenceHarness(t)
  account.currentAccountId = 'a'
  assert.equal(presence.value, 'unknown')
  account.currentAccount.running = false
  assert.equal(presence.value, 'offline')
  account.currentAccount.running = true
  connect('a')
  await vue.nextTick()
  assert.equal(presence.value, 'online')
  assert.equal(refreshes(), 0)

  const failedRequest = (code, status = 200) => api.get('/api/test', {
    adapter: async (config) => {
      const response = { config, status, data: { ok: false, errorCode: code, error: 'test error' } }
      if (status !== 200)
        throw Object.assign(new Error('test error'), { response, config })
      return response
    },
  })
  await failedRequest(123)
  assert.equal(presence.value, 'online')
  assert.deepEqual(messages, ['test error'])
  await failedRequest('ACCOUNT_OFFLINE')
  assert.equal(presence.value, 'offline')
  await assert.rejects(failedRequest('GAME_OFFLINE', 503))
  assert.deepEqual(messages, ['test error'])
  status.status.connection.connected = false
  await vue.nextTick()
  connect('a')
  await vue.nextTick()
  assert.equal(presence.value, 'online')
  assert.equal(refreshes(), 1)
})

test('offline responses from previous selections, canceled requests, and pre-reconnect requests are ignored', async (t) => {
  const { account, api, presence, messages, connect } = makePresenceHarness(t)
  account.currentAccountId = 'a'
  connect('a')
  function pendingRequest(options = {}) {
    let finish
    const result = api.get('/api/test', {
      ...options,
      adapter: config => new Promise((resolve) => {
        finish = () => resolve({ config, status: 200, data: { ok: false, errorCode: 'GAME_OFFLINE' } })
      }),
    })
    return { result, finish: () => finish() }
  }

  const expired = pendingRequest()
  account.currentAccountId = 'b'
  assert.equal(presence.value, 'unknown')
  account.currentAccountId = 'a'
  connect('a')
  expired.finish()
  await expired.result
  const other = pendingRequest({ headers: { 'x-account-id': 'b' } })
  other.finish()
  await other.result
  const controller = new AbortController()
  const canceled = pendingRequest({ signal: controller.signal })
  controller.abort()
  canceled.finish()
  await assert.rejects(canceled.result, { code: 'ERR_CANCELED' })
  assert.equal(presence.value, 'online')

  const late = pendingRequest()
  const statusAdapter = async config => ({ config, status: 200, data: { ok: true } })
  const oldStatus = api.get('/api/status', { adapter: statusAdapter })
  const offline = pendingRequest()
  offline.finish()
  await offline.result
  assert.equal(presence.value, 'offline')
  connect('a', await oldStatus)
  assert.equal(presence.value, 'offline')
  connect('a', await api.get('/api/status', { adapter: statusAdapter }))
  late.finish()
  await late.result
  assert.equal(presence.value, 'online')
  assert.deepEqual(messages, [])
})

const accountApiError = value => value?.response?.data?.error || value?.error || value?.message || '请求失败'
const bulkActions = loadSource('../src/utils/account-bulk-actions.ts')

function loadAccountStore(api, pinia) {
  const apiModule = { __esModule: true, default: api, getApiErrorMessage: accountApiError, selectedAccountId: vue.ref('') }
  const { useAccountStore } = loadSource('../src/stores/account.ts', {
    '@/api': apiModule,
    '@/utils/account-bulk-actions': bulkActions,
    './setting': loadSource('../src/stores/setting.ts', { '@/api': apiModule }),
    './toast': loadSource('../src/stores/toast.ts'),
  })
  return useAccountStore(pinia)
}

function createHarness(t, api) {
  const pinia = createPinia()
  setActivePinia(pinia)
  t.after(() => disposePinia(pinia))
  const store = loadAccountStore(api, pinia)
  // 启动后的后台列表刷新是定时任务，不关掉会把测试进程多拖几秒
  t.after(() => store.stopAccountStateSync())
  return { store }
}

function accountState({ running = false, online = false } = {}) {
  return { data: { ok: true, data: { accounts: [{ id: '7', name: 'acc', running, online }] } } }
}

test('全部启动串行处理已停止账号，并拦住重复提交', async (t) => {
  const calls = []
  const accounts = [
    { id: '1', platform: 'wx', hasWxCredential: true, running: false },
    { id: '2', platform: 'qq', running: false },
    { id: '3', running: true, online: false },
  ]
  const response = { data: { ok: true, data: { accounts } } }
  let finishRefresh
  const refresh = new Promise((resolve) => {
    finishRefresh = resolve
  })
  const { store } = createHarness(t, {
    get: async () => {
      calls.push('get-accounts')
      return response
    },
    post: async (url, _body, config) => {
      calls.push([url, config?.headers?.['x-account-id']])
      if (url === '/api/settings/auto-code-refresh/run')
        await refresh
      return { data: { ok: true } }
    },
  })
  store.accounts = accounts
  const batch = store.startAllAccounts()
  assert.equal(store.bulkKind, 'start')
  await store.startAllAccounts()
  assert.deepEqual(calls, [['/api/settings/auto-code-refresh/run', '1']])
  finishRefresh()
  await batch
  assert.deepEqual(calls, [
    ['/api/settings/auto-code-refresh/run', '1'],
    ['/api/accounts/2/start', undefined],
    'get-accounts',
  ])
  assert.equal(store.bulkRunning, false)
})

test('启动发出请求就结束，不为了等上线去轮账号列表', async (t) => {
  const calls = []
  let store
  const api = {
    get: async () => {
      calls.push('get-accounts')
      return accountState({ running: true, online: false })
    },
    post: async (url, _body, config) => {
      calls.push({ url, timeout: config?.timeout })
      // 请求还没返回时按钮仍锁着，不能提前放开
      assert.equal(store.pendingActions['7'], 'start')
      return { data: { ok: true } }
    },
  }
  store = createHarness(t, api).store

  const result = await store.startAccount('7')

  assert.deepEqual(result, { ok: true, confirmed: true })
  // 启动请求自带长超时，不会被默认 10s 超时误杀；除此之外没有别的调用
  assert.deepEqual(calls, [{ url: '/api/accounts/7/start', timeout: 60000 }])
  assert.deepEqual(store.pendingActions, {})
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
    const result = await store.startAccount('7')

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

  const result = await store.startAccount('7')

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

  const first = store.startAccount('7')
  await Promise.resolve()
  assert.equal(store.pendingActions['7'], 'start')

  const second = await store.stopAccount('7', { timeoutMs: 500, intervalMs: 1 })
  assert.equal(second.ok, false)
  assert.equal(second.error, '该账号已有进行中的操作')

  releasePost({ data: { ok: true } })
  assert.deepEqual(await first, { ok: true, confirmed: true })
  assert.deepEqual(store.pendingActions, {})

  const empty = await store.startAccount('')
  assert.deepEqual(empty, { ok: false, confirmed: false, error: '未选择账号' })
})

test('停止轮询期间的单次失败不清空账号列表', async (t) => {
  let failed = false
  const { store } = createHarness(t, {
    get: async () => {
      if (!failed) {
        failed = true
        throw new Error('临时网络错误')
      }
      return accountState({ running: false, online: false })
    },
    post: async () => ({ data: { ok: true } }),
  })
  store.accounts = [{ id: '7', name: 'acc', running: true, online: false }]

  const result = await store.stopAccount('7', { timeoutMs: 200, intervalMs: 1 })

  assert.deepEqual(result, { ok: true, confirmed: true })
  assert.equal(store.accounts.length, 1)
})
