import type { Account } from '@/stores/account'

export type AccountBatchKind = 'start' | 'stop' | 'cleanup'

export interface AccountBatchOutcome {
  ok: boolean
  confirmed?: boolean
  error?: string
}

export interface AccountBatchSummary {
  succeeded: number
  unconfirmed: number
  failed: { id: string, error: string }[]
}

const BATCH_VERBS: Record<AccountBatchKind, string> = {
  start: '启动',
  stop: '停止',
  cleanup: '清理',
}

/**
 * “离线”沿用卡片启动/停止按钮的同一套语义：worker 进程不在就是可启动。
 * online 只表示 worker 已上报上线，进程还在但没连上的账号仍要被“全部停止”停掉。
 */
function isStopped(account: Account) {
  return account.running !== true
}

/**
 * 按动作挑选批量目标；传入 selectedIds 时只在选中范围内挑，
 * 因此多选里的“启动/停止/清理”与全局按钮共用同一套前置判断。
 * 清理只允许已停止的账号，运行中的必须先停止，避免误删正在跑的任务。
 */
export function pickAccountBatchTargets(
  accounts: Account[],
  kind: AccountBatchKind,
  selectedIds?: Iterable<string> | null,
): string[] {
  const list = Array.isArray(accounts) ? accounts : []
  const allowed = selectedIds ? new Set(Array.from(selectedIds, String)) : null
  return list
    .filter((account) => {
      if (allowed && !allowed.has(String(account.id)))
        return false
      return kind === 'stop' ? !isStopped(account) : isStopped(account)
    })
    .map(account => String(account.id))
}

/** 带持久化凭证的微信扫码账号才可能刷 Code；旧 Code 直接启动多半只换来一次 ws_400。 */
export function shouldRefreshCodeBeforeStart(account?: Account | null): boolean {
  return !!account && account.platform === 'wx' && account.hasWxCredential === true
}

export function allAccountIds(accounts: Account[]): string[] {
  return (Array.isArray(accounts) ? accounts : []).map(account => String(account.id))
}

export function invertAccountSelection(accounts: Account[], selectedIds: Iterable<string>): string[] {
  const selected = new Set(Array.from(selectedIds, String))
  return allAccountIds(accounts).filter(id => !selected.has(id))
}

export function toggleSelectedAccountIds(selectedIds: Iterable<string>, id: string): string[] {
  const next = new Set(Array.from(selectedIds, String))
  const key = String(id || '')
  if (!key)
    return Array.from(next)
  if (next.has(key))
    next.delete(key)
  else
    next.add(key)
  return Array.from(next)
}

/**
 * 逐个执行批量动作：取码与拉起 worker 都吃顺序，并发会把登录网关打满，
 * 也让失败无法定位到账号。单个账号失败不中断整批。
 */
export async function runAccountBatch(
  ids: string[],
  runOne: (id: string) => Promise<AccountBatchOutcome>,
): Promise<AccountBatchSummary> {
  const summary: AccountBatchSummary = { succeeded: 0, unconfirmed: 0, failed: [] }
  for (const id of Array.isArray(ids) ? ids : []) {
    let outcome: AccountBatchOutcome
    try {
      outcome = await runOne(id)
    }
    catch (error: any) {
      outcome = { ok: false, error: String(error?.message || error || '操作失败') }
    }
    if (!outcome || outcome.ok !== true) {
      summary.failed.push({ id, error: String(outcome?.error || '操作失败') })
      continue
    }
    summary.succeeded += 1
    // 请求已发出但服务端还没确认到位，不能和真正的成功混为一谈
    if (outcome.confirmed === false)
      summary.unconfirmed += 1
  }
  return summary
}

export function formatAccountBatchSummary(
  kind: AccountBatchKind,
  summary: AccountBatchSummary,
  skipped = 0,
): string {
  const verb = BATCH_VERBS[kind]
  const parts = [`成功${verb} ${summary.succeeded} 个账号`]
  if (summary.unconfirmed > 0)
    parts.push(`${summary.unconfirmed} 个尚未确认到位`)
  if (summary.failed.length > 0)
    parts.push(`${summary.failed.length} 个失败：${summary.failed[0]?.error || '未知错误'}`)
  if (skipped > 0)
    parts.push(`${skipped} 个状态不符已跳过`)
  return parts.join('，')
}
