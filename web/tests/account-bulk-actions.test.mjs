import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// This repository runs its tests with Node's built-in runner.
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const source = readFileSync(new URL('../src/utils/account-bulk-actions.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
const module = { exports: {} }
new Function('require', 'module', 'exports', outputText)(require, module, module.exports)
const {
  allAccountIds,
  formatAccountBatchSummary,
  invertAccountSelection,
  pickAccountBatchTargets,
  runAccountBatch,
  shouldRefreshCodeBeforeStart,
  toAccountBatchOutcome,
  toggleSelectedAccountIds,
} = module.exports

const accounts = [
  { id: '1', platform: 'wx', hasWxCredential: true, running: true, online: true },
  { id: '2', platform: 'wx', hasWxCredential: true, running: false, online: false },
  { id: '3', platform: 'qq', running: false, online: false },
  { id: '4', platform: 'wx', hasWxCredential: false, running: true, online: false },
]

test('批量目标按卡片启动/停止按钮的同一套语义挑选', () => {
  assert.deepEqual(pickAccountBatchTargets(accounts, 'start'), ['2', '3', '4'])
  assert.deepEqual(pickAccountBatchTargets(accounts, 'stop'), ['1', '4'])
  // 清理只允许已停止的账号，运行中的必须先停止才不会被误删
  assert.deepEqual(pickAccountBatchTargets(accounts, 'cleanup'), ['2', '3'])
  assert.deepEqual(pickAccountBatchTargets([], 'start'), [])
})

test('选中范围过滤让多选按钮与全局按钮共用前置判断', () => {
  assert.deepEqual(pickAccountBatchTargets(accounts, 'start', ['2', '4']), ['2', '4'])
  assert.deepEqual(pickAccountBatchTargets(accounts, 'stop', new Set(['2', '4'])), ['4'])
  assert.deepEqual(pickAccountBatchTargets(accounts, 'cleanup', ['1']), [])
  // 未知 id 不会混进批次
  assert.deepEqual(pickAccountBatchTargets(accounts, 'start', ['9', '3']), ['3'])
})

test('只有带持久化凭证的微信账号需要刷新 Code', () => {
  assert.equal(shouldRefreshCodeBeforeStart(accounts[0]), true)
  assert.equal(shouldRefreshCodeBeforeStart(accounts[1]), true)
  assert.equal(shouldRefreshCodeBeforeStart(accounts[2]), false)
  assert.equal(shouldRefreshCodeBeforeStart(accounts[3]), false)
  assert.equal(shouldRefreshCodeBeforeStart(null), false)

  // 批量启动逐个判定分流：只有微信凭证账号会被送去刷 Code
  const targets = pickAccountBatchTargets(accounts, 'start')
  assert.deepEqual(
    targets.map(id => shouldRefreshCodeBeforeStart(accounts.find(item => item.id === id))),
    [true, false, false],
  )
})

test('选择集支持单选切换、全选清单与反选', () => {
  assert.deepEqual(allAccountIds(accounts), ['1', '2', '3', '4'])
  assert.deepEqual(toggleSelectedAccountIds(['1'], '2').sort(), ['1', '2'])
  assert.deepEqual(toggleSelectedAccountIds(['1', '2'], '1'), ['2'])
  assert.deepEqual(toggleSelectedAccountIds(['1'], ''), ['1'])
  assert.deepEqual(invertAccountSelection(accounts, ['1', '3']), ['2', '4'])
  assert.deepEqual(invertAccountSelection(accounts, []), ['1', '2', '3', '4'])
})

test('批量执行保持串行，单个账号失败不中断整批', async () => {
  const order = []
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const summary = await runAccountBatch(['1', '2', '3'], async (id) => {
    order.push(`begin:${id}`)
    // 并发实现会先把三个 begin 全部打出来，因此顺序本身就是串行的证据
    await sleep(2)
    order.push(`end:${id}`)
    if (id === '2')
      return { ok: false, error: 'Code 已失效' }
    if (id === '3')
      throw new Error('服务离线')
    return { ok: true }
  })

  assert.deepEqual(order, ['begin:1', 'end:1', 'begin:2', 'end:2', 'begin:3', 'end:3'])
  assert.deepEqual(summary, {
    succeeded: 1,
    failed: [
      { id: '2', error: 'Code 已失效' },
      { id: '3', error: '服务离线' },
    ],
  })
})

test('停止只有等到进程退出才算成功，接口报错时保留真正原因', () => {
  assert.deepEqual(toAccountBatchOutcome({ ok: true, confirmed: true }, '停止后进程未退出'), { ok: true })
  assert.deepEqual(toAccountBatchOutcome({ ok: true, confirmed: false }, '停止后进程未退出'), { ok: false, error: '停止后进程未退出' })
  // 接口报错时不被“未退出”覆盖，否则用户看不出是网络问题还是进程问题
  assert.deepEqual(toAccountBatchOutcome({ ok: false, confirmed: false, error: '服务离线' }, '停止后进程未退出'), { ok: false, error: '服务离线' })
  assert.deepEqual(toAccountBatchOutcome({ ok: false }, '停止后进程未退出'), { ok: false, error: '操作失败' })
})

test('批量结果文案覆盖成功、失败与跳过', () => {
  assert.equal(
    formatAccountBatchSummary('start', { succeeded: 3, failed: [] }),
    '成功启动 3 个账号',
  )
  assert.equal(
    formatAccountBatchSummary('stop', { succeeded: 3, failed: [{ id: '4', error: '进程未退出' }] }, 1),
    '成功停止 3 个账号，1 个失败：进程未退出，1 个状态不符已跳过',
  )
  assert.equal(
    formatAccountBatchSummary('cleanup', { succeeded: 0, failed: [] }, 2),
    '成功清理 0 个账号，2 个状态不符已跳过',
  )
})

// 回归：两个账号曾经被报成“成功 1，未确认 1，失败 1”三项，因为同一个账号被算了两次。
// 现在一个账号只能归入成功或失败其中一种，文案里的数量加起来等于账号总数。
test('成功和失败不重复计数，文案总和不超账号数', async () => {
  const summary = await runAccountBatch(['1', '2'], async id => (id === '1'
    ? { ok: true }
    : { ok: false, error: '登录凭证已失效' }))
  const text = formatAccountBatchSummary('start', summary)
  assert.equal(text, '成功启动 1 个账号，1 个失败：登录凭证已失效')
  assert.equal(summary.succeeded + summary.failed.length, 2)
})
