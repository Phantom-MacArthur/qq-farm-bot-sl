import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api, { getApiErrorMessage, selectedAccountId } from '@/api'
import { formatAccountBatchSummary, pickAccountBatchTargets, runAccountBatch, toAccountBatchOutcome } from '@/utils/account-bulk-actions'
import { useToastStore } from './toast'
import { isAccountActive } from '@/utils/account-runtime'
import { createRequestGuard } from '@/utils/request-guard'

export interface Account {
  id: string
  name: string
  nick?: string
  uin?: number | string
  avatar?: string
  platform?: string
  // worker 进程存在，不代表已经登录成功
  running?: boolean
  // worker 上报的连接状态，即“已确认上线”
  online?: boolean
  // 服务端脱敏后只下发这个标记，页面据此判断账号能否自动刷新 Code
  hasWxCredential?: boolean
  runtimeState?: 'logging_in' | 'relogin_waiting' | 'running' | 'offline' | 'stopping' | 'stopped'
  reloginAt?: number | null
  runtimeUpdatedAt?: number
  /** 微信 openid（续期微信授权用）。 */
  wxid?: string
  /** 后端判定的「wxid + refreshtoken 齐备、可免扫码续期」标记；接口不下发凭证明文。 */
  wxPreflightSupported?: boolean
  /**
   * 后端判定的「掉线后能免扫码恢复」标记：在 refreshtoken 之外还包含只有
   * loginBuffer 的账号（滚不了 token，但能直接换 Code）。
   * 自动续期账本按这个字段决定是否展示；缺失代表服务尚未更新。
   */
  wxCanRecover?: boolean
  /** 自动续期账本快照：只有时间戳与次数，无任何凭证内容；字段缺失代表服务尚未更新。 */
  wxPreflightStats?: {
    date?: string
    lastSuccessAt?: number
    lastFailureAt?: number
    successesToday?: number
    failuresToday?: number
  }
  /** 微信授权到期信息，用于展示剩余时间。 */
  expires_at?: number
  expires_in?: number
  wxCredentialRefreshedAt?: number
  wxCredentialLastAttemptAt?: number
  wxCredentialRefreshError?: string
  // Add other fields as discovered
}

export interface AccountLog {
  time: string
  action: string
  msg: string
  reason?: string
}

/** 账号 Code 自动监听快照，字段与 core/services/code-watch.ts 对齐。 */
export interface CodeHealthItem {
  accountId: string
  name: string
  platform: string
  level: 'ok' | 'unknown' | 'expiring' | 'expired' | 'refresh_failed' | 'offline'
  reason: string
  autoFixable: boolean
  needsManual: boolean
  remainingMs: number
  latestLogAction: string
}

export function getPlatformLabel(p?: string) {
  if (p === 'qq')
    return 'QQ'
  if (p === 'wx')
    return '微信'
  return ''
}

export function getPlatformClass(p?: string) {
  if (p === 'qq')
    return 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
  if (p === 'wx')
    return 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
  return ''
}

export type AccountPendingAction = 'start' | 'stop'

// 启动发出请求就算完成，不等待也不判定结果：每多等一秒，“全部启动”里后面的账号就被多压一秒。
// 停止要等子进程真的退出，进程回收本身有延迟，只能继续轮询。
const STOP_CONFIRM_TIMEOUT_MS = 15000
const CONFIRM_POLL_INTERVAL_MS = 800
// 微信账号的启动请求本身就要经过一次取码，默认的 10s 请求超时会把正常启动误报成失败
const START_REQUEST_TIMEOUT_MS = 60000
// 卡片上的在线灯只在账号列表刷新时才会变。启动不再等结果，这里在后台把列表多刷几秒，
// 只负责让灯自己跟上，不判成败、不锁按钮、也不弹提示。
const STATE_SYNC_INTERVAL_MS = 1000
const STATE_SYNC_WINDOW_MS = 8000
/** 轮询去抖：账号列表内容没变时不替换数组（每项字段级比较，数量小开销可忽略）。 */
function accountsEqual(a: Account[], b: Account[]) {
  if (a === b)
    return true
  if (a.length !== b.length)
    return false
  return a.every((item, index) => JSON.stringify(item) === JSON.stringify(b[index]))
}

export const useAccountStore = defineStore('account', () => {
  const accounts = ref<Account[]>([])
  const currentAccountId = selectedAccountId
  const loading = ref(false)
  const logs = ref<AccountLog[]>([])
  // 账号 id -> 进行中的启动/停止操作，这一次操作结束前按钮保持不可用
  const pendingActions = ref<Record<string, AccountPendingAction>>({})
  const bulkKind = ref<AccountPendingAction | ''>('')
  const bulkRunning = computed(() => bulkKind.value !== '')
  let accountRead: Promise<Account[]> | undefined
  let stateSyncVersion = 0
  const runtimeClockOffset = ref(0)
  let codeHealthRead: Promise<CodeHealthItem[]> | undefined
  let stateSyncTimer: ReturnType<typeof setTimeout> | undefined
  const codeHealth = ref<CodeHealthItem[]>([])
  const codeHealthLoaded = ref(false)
  const accountsGuard = createRequestGuard()

  const currentAccount = computed(() =>
    accounts.value.find(a => String(a.id) === currentAccountId.value),
  )

  function syncClock(serverTime: unknown) {
    if (typeof serverTime === 'number' && Number.isFinite(serverTime))
      runtimeClockOffset.value = serverTime - Date.now()
  }

  function loadAccounts(visible: boolean) {
    const ticket = accountsGuard.next()
    if (visible)
      loading.value = true
    const pending = Promise.resolve().then(async () => {
      try {
        const { data } = await api.get('/api/accounts')
        if (accountsGuard.isStale(ticket))
          return accounts.value
        if (data?.ok && Array.isArray(data.data?.accounts)) {
          const nextAccounts: Account[] = data.data.accounts
          syncClock(data.data.serverTime)
          if (!accountsEqual(accounts.value, nextAccounts))
            accounts.value = nextAccounts
          if (!accounts.value.some(account => String(account.id) === currentAccountId.value))
            currentAccountId.value = String(accounts.value[0]?.id ?? '')
        }
      }
      catch (error) {
        if (visible && !accountsGuard.isStale(ticket))
          console.error('获取账号失败', error)
      }
      return accounts.value
    }).finally(() => {
      if (accountRead === pending)
        accountRead = undefined
      if (!accountsGuard.isStale(ticket))
        loading.value = false
    })
    accountRead = pending
    return pending
  }

  function fetchAccounts() {
    return loadAccounts(true)
  }

  function applyRuntimeSnapshot(id: string, data: any) {
    const account = findAccount(id)
    const runtime = data?.runtime
    if (!account || String(runtime?.id ?? '') !== id || !runtime.runtimeState)
      return
    if ((account.runtimeUpdatedAt ?? 0) > (runtime.runtimeUpdatedAt ?? 0))
      return
    syncClock(data.serverTime)
    if (account.runtimeUpdatedAt === runtime.runtimeUpdatedAt && account.runtimeState === runtime.runtimeState
      && account.running === runtime.running && account.online === runtime.online && account.reloginAt === runtime.reloginAt)
      return
    accountsGuard.invalidate()
    accountRead = undefined
    loading.value = false
    Object.assign(account, runtime)
  }

  function selectAccount(id: string) {
    currentAccountId.value = id
  }

  function setCurrentAccount(acc: Account) {
    selectAccount(acc.id)
  }

  function syncAccountAvatar(id: string, avatar: string) {
    const account = accounts.value.find(item => String(item.id) === String(id))
    if (account && avatar) {
      account.avatar = avatar
    }
  }

  /** 批量停止与列表轮询共享在途的状态读取。 */
  function refreshAccountsSilently() {
    return accountRead ?? loadAccounts(false)
  }

  function findAccount(id: string) {
    return accounts.value.find(acc => String(acc.id) === String(id))
  }

  function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms))
  }

  /** 反复刷账号列表，直到达到目标状态或超时；返回是否真正确认。 */
  async function waitForAccountState(
    id: string,
    isConfirmed: (account?: Account) => boolean,
    { timeoutMs, intervalMs }: { timeoutMs: number, intervalMs: number },
  ) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      await refreshAccountsSilently()
      if (isConfirmed(findAccount(id)))
        return true
      if (Date.now() >= deadline)
        return false
      await sleep(intervalMs)
    }
  }

  function stopAccountStateSync() {
    stateSyncVersion++
    if (stateSyncTimer)
      clearTimeout(stateSyncTimer)
    stateSyncTimer = undefined
  }

  /** 启动/停止后短时间后台刷新列表，让卡片上的在线灯自己跟上，不等它也不影响操作。 */
  function startAccountStateSync() {
    stopAccountStateSync()
    const version = stateSyncVersion
    const deadline = Date.now() + STATE_SYNC_WINDOW_MS
    const tick = async () => {
      stateSyncTimer = undefined
      await refreshAccountsSilently()
      if (version === stateSyncVersion && Date.now() < deadline)
        stateSyncTimer = setTimeout(tick, STATE_SYNC_INTERVAL_MS)
    }
    stateSyncTimer = setTimeout(tick, STATE_SYNC_INTERVAL_MS)
  }

  async function runAccountAction(
    id: string,
    action: AccountPendingAction,
    request: () => Promise<any>,
    confirm?: (runtime?: Account) => Promise<boolean>,
  ): Promise<{ ok: boolean, confirmed: boolean, error?: string }> {
    const accountId = String(id || '')
    if (!accountId)
      return { ok: false, confirmed: false, error: '未选择账号' }
    // 同一账号的启动/停止不得并发，否则先后两次确认会互相覆盖
    if (pendingActions.value[accountId])
      return { ok: false, confirmed: false, error: '该账号已有进行中的操作' }

    pendingActions.value = { ...pendingActions.value, [accountId]: action }
    try {
      const res = await request()
      // 软错会以 HTTP 200 + ok:false 下发，不能当成成功
      if (res?.data && res.data.ok === false)
        throw new Error(getApiErrorMessage(res.data))
      // 没传 confirm 的动作（启动）只看请求是否被接受
      applyRuntimeSnapshot(accountId, res?.data?.data)
      const confirmed = confirm ? await confirm(res?.data?.data?.runtime) : true
      startAccountStateSync()
      return { ok: true, confirmed }
    }
    catch (e: any) {
      applyRuntimeSnapshot(accountId, e?.response?.data?.data)
      void refreshAccountsSilently()
      return { ok: false, confirmed: false, error: getApiErrorMessage(e) }
    }
    finally {
      const next = { ...pendingActions.value }
      delete next[accountId]
      pendingActions.value = next
    }
  }

  /** 启动只负责把请求发出去：结果交给卡片上的在线灯，不等待也不弹提示。 */
  async function startAccount(id: string) {
    return runAccountAction(
      id,
      'start',
      () => api.post(`/api/accounts/${id}/start`, undefined, { timeout: START_REQUEST_TIMEOUT_MS }),
    )
  }

  async function stopAccount(id: string, options: { timeoutMs?: number, intervalMs?: number } = {}) {
    return runAccountAction(
      id,
      'stop',
      () => api.post(`/api/accounts/${id}/stop`),
      // 账号被删除也算已停：卡片都消失了，不该再报失败
      async (runtime) => {
        if (String(runtime?.id ?? '') === String(id) && runtime?.runtimeState === 'stopped'
          && runtime.running === false && !isAccountActive(findAccount(id) ?? runtime))
          return true
        return waitForAccountState(
          id,
          account => !account || !isAccountActive(account),
          { timeoutMs: options.timeoutMs ?? STOP_CONFIRM_TIMEOUT_MS, intervalMs: options.intervalMs ?? CONFIRM_POLL_INTERVAL_MS },
        )
      },
    )
  }

  async function deleteAccount(id: string) {
    await api.delete(`/api/accounts/${id}`)
    if (currentAccountId.value === id) {
      currentAccountId.value = ''
    }
    await fetchAccounts()
  }

  async function runAccountBatchAction(kind: AccountPendingAction, ids: string[], skipped = 0) {
    if (bulkRunning.value || ids.length === 0)
      return
    const toast = useToastStore()
    bulkKind.value = kind
    try {
      const summary = await runAccountBatch(ids, async (id) => {
        if (kind === 'stop')
          return toAccountBatchOutcome(await stopAccount(id), '停止后进程未退出')
        const account = accounts.value.find(acc => String(acc.id) === id)
        // 已断线的 worker 需要先确认退出，再发起启动。
        if (account?.running && (account.runtimeState === 'offline' || (!account.runtimeState && account.online === false))) {
          const stopped = await stopAccount(id)
          if (!stopped.ok || !stopped.confirmed)
            return toAccountBatchOutcome(stopped, '停止后进程未退出')
        }
        return startAccount(id)
      }, 2)
      // 启动结果由在线状态反映，只在请求失败时提示。
      if (kind !== 'start' || summary.failed.length > 0) {
        const message = formatAccountBatchSummary(kind, summary, skipped)
        if (summary.failed.length > 0)
          toast.error(message)
        else
          toast.success(message)
      }
      void refreshAccountsSilently()
    }
    finally {
      bulkKind.value = ''
    }
  }

  function startAllAccounts() {
    return runAccountBatchAction('start', pickAccountBatchTargets(accounts.value, 'start'))
  }

  async function reloadCurrentAccount() {
    const id = currentAccountId.value
    if (!id || bulkRunning.value)
      return
    await refreshAccountsSilently()
    return runAccountBatchAction('start', pickAccountBatchTargets(accounts.value, 'start', [id]))
  }

  async function fetchLogs() {
    try {
      const res = await api.get('/api/account-logs?limit=100')
      if (Array.isArray(res.data)) {
        logs.value = res.data
      }
    }
    catch (e) {
      console.error('获取账号日志失败', e)
    }
  }

  async function addAccount(payload: any) {
    try {
      await api.post('/api/accounts', payload)
      await fetchAccounts()
    }
    catch (e) {
      console.error('添加账号失败', e)
      throw e
    }
  }

  /** 续期全部微信账号授权（后端逐账号刷新并写回新 Code）。 */
  async function refreshWxCodes() {
    const res = await api.post('/api/accounts/refresh-wx-credentials')
    await fetchAccounts()
    return res.data
  }

  function fetchCodeHealth() {
    if (!codeHealthRead) {
      codeHealthRead = Promise.resolve().then(async () => {
        try {
          const res = await api.get('/api/accounts/code-health')
          const items = res.data?.data?.items
          if (Array.isArray(items)) {
            codeHealth.value = items
            codeHealthLoaded.value = true
          }
        }
        catch {
          // 保留上一份已确认的健康快照。
        }
        return codeHealth.value
      }).finally(() => {
        codeHealthRead = undefined
      })
    }
    return codeHealthRead
  }

  /** 自动补 Code（微信免扫码换码 / QQ 尽力重签），并同步刷新账号与快照。 */
  async function autoFixCode(id: string) {
    const res = await api.post(`/api/accounts/${id}/auto-fix-code`)
    await fetchAccounts()
    await fetchCodeHealth()
    return res.data
  }

  async function updateAccount(id: string, payload: any) {
    try {
      // core uses POST /api/accounts for both add and update (if id is present)
      await api.post('/api/accounts', { ...payload, id })
      await fetchAccounts()
    }
    catch (e) {
      console.error('更新账号失败', e)
      throw e
    }
  }

  return {
    accounts,
    currentAccountId,
    currentAccount,
    loading,
    logs,
    pendingActions,
    bulkKind,
    bulkRunning,
    runAccountBatchAction,
    startAllAccounts,
    reloadCurrentAccount,
    codeHealth,
    codeHealthLoaded,
    runtimeClockOffset,
    applyRuntimeSnapshot,
    fetchAccounts,
    refreshAccountsSilently,
    selectAccount,
    startAccount,
    stopAccount,
    stopAccountStateSync,
    deleteAccount,
    fetchLogs,
    addAccount,
    updateAccount,
    refreshWxCodes,
    fetchCodeHealth,
    autoFixCode,
    setCurrentAccount,
    syncAccountAvatar,
  }
})
