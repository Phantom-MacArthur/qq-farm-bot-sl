import type { Account } from '@/stores/account'

export type AccountBatchKind = 'start' | 'stop' | 'cleanup'

export interface AccountBatchOutcome {
  ok: boolean
  error?: string
}

export interface AccountBatchSummary {
  /** 启动：请求被服务端接受的账号数；停止：已确认进程退出的账号数 */
  succeeded: number
  failed: { id: string, error: string }[]
}

const BATCH_VERBS: Record<AccountBatchKind, string> = {
  start: '启动',
  stop: '停止',
  cleanup: '清理',
}

/**
 * running 表示 worker 进程是否存在，online 表示是否连上游戏。
 */
function isStopped(account: Account) {
  return account.running !== true
}

/**
 * 按动作挑选批量目标；传入 selectedIds 时只在选中范围内挑，
 * 因此多选里的“启动/停止/清理”与全局按钮共用同一套前置判断。
 * 启动包括已停止账号和仍在运行的断线账号；清理只允许已停止的账号。
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
      if (kind === 'start')
        return isStopped(account) || account.online === false
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
 * 把单个账号的操作结果归成成功或失败两种。
 * 启动不再等在线状态，只要请求被接受就算成功；停止还要等到进程真的退出，
 * 等不到就归入失败并给出原因，不再返回“未确认”这种含义不明、又不属于成败任何一种的中间结果。
 */
export function toAccountBatchOutcome(
  result: { ok: boolean, confirmed?: boolean, error?: string },
  unconfirmedError: string,
): AccountBatchOutcome {
  if (!result || result.ok !== true)
    return { ok: false, error: String(result?.error || '操作失败') }
  if (result.confirmed === false)
    return { ok: false, error: unconfirmedError }
  return { ok: true }
}

/**
 * 逐个执行批量动作：取码和拉起 worker 都要排队，同时给多个账号发请求会把登录接口压满，
 * 出错时也分不清是哪个账号。单个账号失败不中断整批。
 */
export async function runAccountBatch(
  ids: string[],
  runOne: (id: string) => Promise<AccountBatchOutcome>,
): Promise<AccountBatchSummary> {
  const summary: AccountBatchSummary = { succeeded: 0, failed: [] }
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
  if (summary.failed.length > 0)
    parts.push(`${summary.failed.length} 个失败：${summary.failed[0]?.error || '未知错误'}`)
  if (skipped > 0)
    parts.push(`${skipped} 个状态不符已跳过`)
  return parts.join('，')
}
