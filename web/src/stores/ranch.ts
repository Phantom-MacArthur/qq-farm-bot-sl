import axios from 'axios'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import api, { getApiErrorMessage } from '@/api'

export type RanchView = 'overview' | 'mall' | 'animals' | 'facilities' | 'shop' | 'market' | 'bag' | 'tasks' | 'illustrated' | 'friends' | 'activities' | 'cans'
export interface RanchItem { id: number, name: string, count: string, image: string }
export interface RanchQuote {
  action: string
  label: string
  costs: Array<{ resourceKey: string, amount: string }>
  costItems: RanchItem[]
  rewards: RanchItem[]
  expected: { signature: string }
  skipped: boolean
  count: number
  message?: string
}

export interface RanchOperationResult {
  status: 'confirmed' | 'skipped'
  snapshot?: any
  notice?: string
  completed?: number
  bucketRemainingSeconds?: string
  autoProduced?: number
  autoProductionNotice?: string
  refreshRequired?: boolean
  sceneRestored?: boolean
}

export const useRanchStore = defineStore('ranch', () => {
  const accountStore = useAccountStore()
  const state = ref<any>(null)
  const refreshing = ref(false)
  const loading = computed(() => refreshing.value && !state.value)
  const error = ref('')
  const networkError = ref(false)
  const notice = ref('')
  const receivedAt = ref(0)
  const ranchAccountId = ref('')
  let ranchReadRequestVersion = 0
  const ranchAccountSessionVersion = ref(0)
  let activeReadKey = ''
  let activeReadPromise: Promise<void> | null = null
  let readController: AbortController | null = null
  const pendingAccountOperations = ref<string[]>([])
  const busy = computed(() => pendingAccountOperations.value.includes(String(accountStore.currentAccountId || '')))
  type ViewQuery = { accountId: string, view: RanchView, shopId?: number, hostGid?: string }
  let lastRanchViewQuery: ViewQuery | null = null
  const viewCache = new Map<string, { data: any, receivedAt: number }>()
  const viewKey = (query: ViewQuery) => JSON.stringify([query.accountId, query.view, query.shopId ?? null, query.hostGid ?? null])
  const ownsRanchAccount = (id: string) => !!id && id === ranchAccountId.value
    && id === String(accountStore.currentAccountId || '')
  const isCurrentRanchRead = (id: string, version: number) => ownsRanchAccount(id) && version === ranchReadRequestVersion
  const isCurrentRanchOperation = (id: string, version: number) => ownsRanchAccount(id) && version === ranchAccountSessionVersion.value

  function invalidateRanchReadRequests() {
    ranchReadRequestVersion++
    readController?.abort()
    readController = null
    activeReadKey = ''
    activeReadPromise = null
    refreshing.value = false
  }

  function clearRanchAccountState(accountId = '') {
    invalidateRanchReadRequests()
    ranchAccountSessionVersion.value++
    ranchAccountId.value = accountId
    lastRanchViewQuery = null
    viewCache.clear()
    state.value = null
    error.value = ''
    networkError.value = false
    notice.value = ''
    receivedAt.value = 0
    // Submitted operations remain locked until their requests settle, even across account switches.
  }

  watch(() => String(accountStore.currentAccountId || ''), id => clearRanchAccountState(id), { immediate: true, flush: 'sync' })

  async function load(accountId: string, view: RanchView, shopId?: number, hostGid?: string) {
    if (!accountId || accountId !== String(accountStore.currentAccountId || ''))
      return
    if (ranchAccountId.value !== accountId)
      clearRanchAccountState(accountId)
    const query = { accountId, view, shopId, hostGid }
    const key = viewKey(query)
    if (activeReadKey === key && activeReadPromise)
      return activeReadPromise
    if (busy.value)
      return
    invalidateRanchReadRequests()
    const cached = viewCache.get(key)
    const sameView = lastRanchViewQuery && viewKey(lastRanchViewQuery) === key
    const switchingFriendView = view === 'friends' && lastRanchViewQuery?.view === 'friends'
    if (!sameView && (cached || !switchingFriendView)) {
      state.value = cached?.data ?? null
      receivedAt.value = cached?.receivedAt ?? 0
    }
    lastRanchViewQuery = query
    const version = ranchReadRequestVersion
    const controller = new AbortController()
    readController = controller
    activeReadKey = key
    refreshing.value = true
    error.value = ''
    networkError.value = false
    const request = (async () => {
      try {
        const response = await api.get('/api/ranch', { params: { view, shopId, hostGid },
          headers: { 'x-account-id': accountId }, signal: controller.signal, timeout: 45000, skipErrorToast: true } as any)
        if (!response.data?.ok)
          throw new Error(response.data?.error || '牧场数据读取失败')
        if (isCurrentRanchRead(accountId, version)) {
          const timestamp = Date.now()
          state.value = response.data.data
          receivedAt.value = timestamp
          viewCache.set(key, { data: state.value, receivedAt: timestamp })
        }
      }
      catch (cause) {
        if (isCurrentRanchRead(accountId, version) && !axios.isCancel(cause)) {
          networkError.value = axios.isAxiosError(cause) && (!cause.response || cause.response.status >= 500)
          error.value = getApiErrorMessage(cause, '牧场数据读取失败')
        }
      }
      finally {
        if (isCurrentRanchRead(accountId, version)) {
          refreshing.value = false
          activeReadKey = ''
          activeReadPromise = null
          readController = null
        }
      }
    })()
    activeReadPromise = request
    return request
  }

  async function reload(accountId: string, overrides?: { hostGid?: string }) {
    const query = lastRanchViewQuery
    if (query && query.accountId === accountId)
      await load(query.accountId, query.view, query.shopId, overrides?.hostGid ?? query.hostGid)
  }

  async function runRanchOperation<T>(accountId: string, operation: (version: number) => Promise<T>): Promise<T | null> {
    if (!ownsRanchAccount(accountId) || pendingAccountOperations.value.includes(accountId))
      return null
    invalidateRanchReadRequests()
    const version = ranchAccountSessionVersion.value
    pendingAccountOperations.value = [...pendingAccountOperations.value, accountId]
    error.value = ''
    notice.value = ''
    try {
      return await operation(version)
    }
    catch (cause) {
      if (isCurrentRanchOperation(accountId, version))
        error.value = getApiErrorMessage(cause, '牧场操作未完成，请刷新核对')
      return null
    }
    finally {
      pendingAccountOperations.value = pendingAccountOperations.value.filter(id => id !== accountId)
    }
  }

  async function quote(accountId: string, action: string, input: Record<string, unknown>): Promise<RanchQuote | null> {
    return runRanchOperation(accountId, async version => {
      const response = await api.post(`/api/ranch/${action}/quote`, input, { headers: { 'x-account-id': accountId }, timeout: 45000, skipErrorToast: true } as any)
      if (!response.data?.ok)
        throw new Error(response.data?.error || '操作条件读取失败')
      return isCurrentRanchOperation(accountId, version) ? response.data.data : null
    })
  }

  async function submit(accountId: string, action: string, input: Record<string, unknown>, confirmation: { expected: RanchQuote['expected'] } | { direct: true }, options: { quiet?: boolean }): Promise<RanchOperationResult | null> {
    return runRanchOperation(accountId, async version => {
      const response = await api.post(`/api/ranch/${action}`, { ...input, ...confirmation }, { headers: { 'x-account-id': accountId }, timeout: 45000, skipErrorToast: true } as any)
      if (!response.data?.ok)
        throw new Error(response.data?.error || '牧场操作未完成')
      if (!isCurrentRanchOperation(accountId, version))
        return null
      const result: RanchOperationResult = response.data.data
      viewCache.clear()
      if (result.snapshot) {
        state.value = { ...state.value, ...result.snapshot }
        receivedAt.value = Date.now()
      }
      if (!options.quiet)
        notice.value = result.notice || (result.status === 'skipped' ? '当前没有可操作项目' : '操作完成')
      return result
    })
  }

  async function execute(accountId: string, action: string, input: Record<string, unknown>, expected: RanchQuote['expected'], options: { quiet?: boolean } = {}) {
    return !!(await submit(accountId, action, input, { expected }, options))
  }

  function executeDirect(accountId: string, action: string, input: Record<string, unknown>) {
    return submit(accountId, action, input, { direct: true }, { quiet: true })
  }

  return { state, loading, refreshing, busy, error, networkError, notice, receivedAt, ranchAccountId, ranchAccountSessionVersion, load, reload, quote, execute, executeDirect, invalidateRanchReadRequests, clearRanchAccountState }
})
