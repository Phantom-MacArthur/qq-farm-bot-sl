import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { createPinia, disposePinia, setActivePinia } = require('pinia')
const { reactive } = require('vue')
const ts = require('typescript')

function harness(t, name, api) {
  const pinia = createPinia()
  setActivePinia(pinia)
  t.after(() => disposePinia(pinia))
  const account = reactive({ currentAccountId: 'a' })
  const imports = {
    '@/api': { __esModule: true, default: api, getApiErrorMessage: value => value?.error || value?.message || 'failed', normalizeApiErrorMessage: value => value },
    '@/stores/account': { useAccountStore: () => account },
  }
  const source = readFileSync(new URL(`../src/stores/${name}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(id => imports[id] || require(id), module, module.exports)
  const useStore = module.exports[name === 'farm' ? 'useFarmStore' : 'useRanchStore']
  return { store: useStore(pinia), account }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const ok = data => ({ data: { ok: true, data } })

test('farm retains cached lands during refresh, deduplicates reads, and discards a read invalidated by leaving', async t => {
  const reads = []
  const { store } = harness(t, 'farm', { get: () => { const d = deferred(); reads.push(d); return d.promise } })
  const initial = store.fetchLands('a')
  assert.equal(store.loading, true)
  reads[0].resolve(ok({ lands: [{ id: 1, status: 'growing' }] }))
  await initial
  const refresh = store.fetchLands('a')
  const duplicate = store.fetchLands('a')
  assert.equal(reads.length, 2)
  assert.equal(store.loading, false)
  assert.equal(store.refreshing, true)
  assert.equal(store.lands[0].status, 'growing')
  store.invalidateFarmReadRequests()
  reads[1].resolve(ok({ lands: [{ id: 99 }] }))
  await Promise.all([refresh, duplicate])
  assert.equal(store.lands[0].id, 1)
  assert.equal(store.loaded, true)
})

test('farm background refresh failure preserves successful data', async t => {
  let fail = false
  const { store } = harness(t, 'farm', { get: async () => { if (fail) throw new Error('offline'); return ok({ lands: [{ id: 1 }] }) } })
  await store.fetchLands('a')
  fail = true
  assert.equal(await store.fetchLands('a'), false)
  assert.equal(store.lands[0].id, 1)
  assert.equal(store.loaded, true)
  assert.equal(store.error, false)
  assert.match(store.farmRefreshError, /offline/)
})

test('farm rejects old-account reads and old finally does not stop the new account loading', async t => {
  const reads = []
  const { store, account } = harness(t, 'farm', { get: () => { const d = deferred(); reads.push(d); return d.promise } })
  const old = store.fetchLands('a')
  account.currentAccountId = 'b'
  const current = store.fetchLands('b')
  reads[0].reject(new Error('old failure'))
  await old
  assert.equal(store.loading, true)
  assert.equal(store.farmRefreshError, '')
  reads[1].resolve(ok({ lands: [{ id: 2 }] }))
  await current
  assert.equal(store.lands[0].id, 2)
})

test('farm operation lock survives leave and an account round trip; stale interaction cannot mutate state', async t => {
  const pending = deferred()
  let posts = 0
  const { store, account } = harness(t, 'farm', { post: () => { posts++; return pending.promise } })
  const old = store.useInteractionItemBatch('a', '5', ['1'])
  store.invalidateFarmReadRequests()
  assert.equal(store.farmOperationPending, true)
  account.currentAccountId = 'b'
  account.currentAccountId = 'a'
  assert.equal(store.farmOperationPending, true)
  assert.equal(await store.fertilizeAll('a', 'normal'), false)
  assert.equal(posts, 1)
  pending.resolve(ok({ itemId: 5, items: [{ id: 999 }], usedLandIds: ['1'], updatedLands: [{ id: 1 }] }))
  assert.equal(await old, false)
  assert.deepEqual(store.interactionItems, [])
  assert.equal(store.farmOperationPending, false)
})

test('farm successful operation remains successful when its follow-up refresh fails', async t => {
  const { store } = harness(t, 'farm', { post: async () => ok({ hadWork: true }), get: async () => { throw new Error('refresh failed') } })
  const result = await store.operate('a', 'harvest')
  assert.equal(result.hadWork, true)
  assert.equal(store.farmOperationPending, false)
})

test('farm submits one selected-land operation and refreshes the snapshot without delaying its result', async t => {
  const refresh = deferred()
  const posts = []
  const { store } = harness(t, 'farm', {
    post: async (url, payload) => { posts.push({ url, payload }); return ok({ hadWork: true }) },
    get: () => refresh.promise,
  })
  const result = await store.operate('a', 'clear', [1, 3])
  assert.equal(result.hadWork, true)
  assert.deepEqual(posts, [{ url: '/api/farm/operate', payload: { opType: 'clear', landId: [1, 3] } }])
  assert.equal(store.refreshing, true)
  refresh.resolve(ok({ lands: [{ id: 1 }] }))
  await store.fetchLands('a')
  assert.equal(store.lands[0].id, 1)
})

test('ranch caches same-account views separately and shows cache during refresh', async t => {
  const reads = []
  const { store } = harness(t, 'ranch', { get: () => { const d = deferred(); reads.push(d); return d.promise } })
  const initial = store.load('a', 'animals')
  reads[0].resolve(ok({ unlocked: true, marker: 'animals' }))
  await initial
  store.invalidateRanchReadRequests()
  assert.equal(store.state.marker, 'animals')
  const bag = store.load('a', 'bag')
  assert.equal(store.state, null)
  reads[1].resolve(ok({ unlocked: true, marker: 'bag' }))
  await bag
  const again = store.load('a', 'animals')
  assert.equal(store.state.marker, 'animals')
  assert.equal(store.loading, false)
  assert.equal(store.refreshing, true)
  reads[2].resolve(ok({ unlocked: true, marker: 'fresh animals' }))
  await again
})

test('ranch late read cannot overwrite an operation snapshot or clear its busy lock', async t => {
  const read = deferred()
  const write = deferred()
  const { store } = harness(t, 'ranch', { get: () => read.promise, post: () => write.promise })
  const loading = store.load('a', 'animals')
  const operation = store.executeDirect('a', 'clean', {})
  read.resolve(ok({ marker: 'stale' }))
  await loading
  assert.equal(store.busy, true)
  assert.equal(store.state, null)
  store.invalidateRanchReadRequests()
  write.resolve(ok({ status: 'confirmed', snapshot: { marker: 'new' } }))
  assert.equal((await operation).status, 'confirmed')
  assert.equal(store.state.marker, 'new')
  assert.equal(store.busy, false)
})

test('ranch pending operations stay locked through account switches and stale errors stay silent', async t => {
  const write = deferred()
  let posts = 0
  const { store, account } = harness(t, 'ranch', { post: () => { posts++; return write.promise } })
  const old = store.executeDirect('a', 'clean', {})
  account.currentAccountId = 'b'
  account.currentAccountId = 'a'
  assert.equal(store.busy, true)
  assert.equal(await store.executeDirect('a', 'clean', {}), null)
  assert.equal(posts, 1)
  write.reject(new Error('old failure'))
  assert.equal(await old, null)
  assert.equal(store.error, '')
  assert.equal(store.busy, false)
})

test('ranch old response cannot overwrite the new view or stop its refresh', async t => {
  const reads = []
  const { store } = harness(t, 'ranch', { get: () => { const d = deferred(); reads.push(d); return d.promise } })
  const old = store.load('a', 'animals')
  const current = store.load('a', 'bag')
  reads[0].reject(new Error('old failure'))
  await old
  assert.equal(store.refreshing, true)
  assert.equal(store.error, '')
  reads[1].resolve(ok({ marker: 'bag' }))
  await current
  assert.equal(store.state.marker, 'bag')
})

test('ranch background network failure preserves the cached snapshot', async t => {
  let fail = false
  const { store } = harness(t, 'ranch', { get: async () => { if (fail) throw new Error('offline'); return ok({ marker: 'cached' }) } })
  await store.load('a', 'animals')
  fail = true
  await store.reload('a')
  assert.equal(store.state.marker, 'cached')
  assert.equal(store.loading, false)
  assert.equal(store.refreshing, false)
  assert.match(store.error, /offline/)
})
