import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api, { getApiErrorMessage, selectedAccountId } from '@/api'
import { formatAccountBatchSummary, pickAccountBatchTargets, runAccountBatch, shouldRefreshCodeBeforeStart, toAccountBatchOutcome } from '@/utils/account-bulk-actions'
import { useSettingStore } from './setting'
import { useToastStore } from './toast'

export interface Account {
  id: string
  name: string
  nick?: string
  uin?: number
  avatar?: string
  platform?: string
  // worker 进程存在，不代表已经登录成功
  running?: boolean
  // worker 上报的连接状态，即“已确认上线”
  online?: boolean
  // 服务端脱敏后只下发这个标记，页面据此判断账号能否自动刷新 Code
  hasWxCredential?: boolean
  // Add other fields as discovered
}

export interface AccountLog {
  time: string
  action: string
  msg: string
  reason?: string
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

export const useAccountStore = defineStore('account', () => {
  const accounts = ref<Account[]>([])
  const currentAccountId = selectedAccountId
  const loading = ref(false)
  const logs = ref<AccountLog[]>([])
  // 账号 id -> 进行中的启动/停止操作，这一次操作结束前按钮保持不可用
  const pendingActions = ref<Record<string, AccountPendingAction>>({})
  const bulkKind = ref<AccountPendingAction | ''>('')
  const bulkRunning = computed(() => bulkKind.value !== '')
  let accountsRequestSequence = 0
  let stateSyncTimer: ReturnType<typeof setTimeout> | undefined

  const currentAccount = computed(() =>
    accounts.value.find(a => String(a.id) === currentAccountId.value),
  )

  async function fetchAccounts() {
    const sequence = ++accountsRequestSequence
    loading.value = true
    try {
      // api interceptor adds x-account-id
      const res = await api.get('/api/accounts')
      if (sequence !== accountsRequestSequence)
        return
      if (res.data.ok && res.data.data && res.data.data.accounts) {
        accounts.value = res.data.data.accounts

        // Auto-select first account if none selected or selected not found
        if (accounts.value.length > 0) {
          const found = accounts.value.find(a => String(a.id) === currentAccountId.value)
          if (!found && accounts.value[0]) {
            currentAccountId.value = String(accounts.value[0].id)
          }
        }
        else {
          // 如果账号列表为空，清空当前选中的账号ID
          currentAccountId.value = ''
        }
      }
      else {
        // 如果返回数据无效，也清空账号列表和选中状态
        accounts.value = []
        currentAccountId.value = ''
      }
    }
    catch (e) {
      console.error('获取账号失败', e)
      if (sequence !== accountsRequestSequence)
        return
      // 请求失败时也清空状态
      accounts.value = []
      currentAccountId.value = ''
    }
    finally {
      if (sequence === accountsRequestSequence)
        loading.value = false
    }
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

  /**
   * 确认轮询用的刷新：不动 loading、不因单次失败清空列表，
   * 也不占用 fetchAccounts 的序号，避免全量刷新回不来。
   */
  async function refreshAccountsSilently() {
    if (loading.value)
      return accounts.value
    const sequence = accountsRequestSequence
    try {
      const res = await api.get('/api/accounts')
      if (sequence !== accountsRequestSequence)
        return accounts.value
      if (res.data?.ok && res.data.data?.accounts)
        accounts.value = res.data.data.accounts
    }
    catch {
      // 单次轮询失败就保留上一次状态，等下一轮
    }
    return accounts.value
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
    if (stateSyncTimer)
      clearTimeout(stateSyncTimer)
    stateSyncTimer = undefined
  }

  /** 启动/停止后短时间后台刷新列表，让卡片上的在线灯自己跟上，不等它也不影响操作。 */
  function startAccountStateSync() {
    stopAccountStateSync()
    const deadline = Date.now() + STATE_SYNC_WINDOW_MS
    const tick = async () => {
      stateSyncTimer = undefined
      await refreshAccountsSilently()
      if (Date.now() < deadline)
        stateSyncTimer = setTimeout(tick, STATE_SYNC_INTERVAL_MS)
    }
    stateSyncTimer = setTimeout(tick, STATE_SYNC_INTERVAL_MS)
  }

  async function runAccountAction(
    id: string,
    action: AccountPendingAction,
    request: () => Promise<any>,
    confirm?: () => Promise<boolean>,
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
      const confirmed = confirm ? await confirm() : true
      startAccountStateSync()
      return { ok: true, confirmed }
    }
    catch (e: any) {
      // 请求失败时也只静默同步一次列表：拉不到就保留现有数据，不能顺手把账号清空
      await refreshAccountsSilently()
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
      () => waitForAccountState(
        id,
        account => !account || account.running !== true,
        { timeoutMs: options.timeoutMs ?? STOP_CONFIRM_TIMEOUT_MS, intervalMs: options.intervalMs ?? CONFIRM_POLL_INTERVAL_MS },
      ),
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
    const settingStore = useSettingStore()
    const toast = useToastStore()
    bulkKind.value = kind
    try {
      const summary = await runAccountBatch(ids, async (id) => {
        if (kind === 'stop')
          return toAccountBatchOutcome(await stopAccount(id), '停止后进程未退出')
        const account = accounts.value.find(acc => String(acc.id) === id)
        // 已断线的 worker 需要先确认退出，再发起启动。
        if (account?.running && account.online === false) {
          const stopped = await stopAccount(id)
          if (!stopped.ok || !stopped.confirmed)
            return toAccountBatchOutcome(stopped, '停止后进程未退出')
        }
        // 有凭证的微信账号先取新 Code，取码接口同时会重启 worker。
        return shouldRefreshCodeBeforeStart(account)
          ? settingStore.runAutoCodeRefresh(id)
          : startAccount(id)
      })
      // 启动结果由在线状态反映，只在请求失败时提示。
      if (kind !== 'start' || summary.failed.length > 0) {
        const message = formatAccountBatchSummary(kind, summary, skipped)
        if (summary.failed.length > 0)
          toast.error(message)
        else
          toast.success(message)
      }
      await fetchAccounts()
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
    setCurrentAccount,
    syncAccountAvatar,
  }
})
