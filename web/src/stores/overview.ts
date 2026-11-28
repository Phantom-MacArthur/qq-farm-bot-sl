import type { Ref } from 'vue'
import { defineStore } from 'pinia'
import { ref, shallowRef, watch } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'
import { useBagStore } from '@/stores/bag'

type OverviewResource = 'ranch' | 'diamond' | 'fertilizer'

export const useOverviewStore = defineStore('overview', () => {
  const accountStore = useAccountStore()
  const bagStore = useBagStore()
  const ranch = shallowRef<any>(null)
  const diamond = ref<number | null>(null)
  const fertilizerItems = shallowRef<Array<{ id: number, count: number }>>([])
  const pendingReads = new Map<OverviewResource, Promise<void>>()
  const lastStarted = new Map<OverviewResource, number>()
  let accountReads = new AbortController()

  watch(() => accountStore.currentAccountId, () => {
    accountReads.abort()
    accountReads = new AbortController()
    pendingReads.clear()
    lastStarted.clear()
    ranch.value = null
    diamond.value = null
    fertilizerItems.value = []
  }, { flush: 'sync' })

  function refresh<T>(
    accountId: string,
    resource: OverviewResource,
    minInterval: number,
    target: Ref<T>,
    read: (signal: AbortSignal) => Promise<T | undefined>,
  ) {
    if (!accountId || accountId !== String(accountStore.currentAccountId || ''))
      return
    if (pendingReads.has(resource))
      return pendingReads.get(resource)
    const now = Date.now()
    if (now - (lastStarted.get(resource) ?? -Infinity) < minInterval)
      return

    lastStarted.set(resource, now)
    const { signal } = accountReads
    const request = read(signal).then((value) => {
      if (!signal.aborted && value !== undefined)
        target.value = value
    }).catch(() => {
      // Keep the last successful snapshot on a transient error.
    }).finally(() => {
      if (!signal.aborted)
        pendingReads.delete(resource)
    })
    pendingReads.set(resource, request)
    return request
  }

  function refreshRanch(accountId: string, minInterval = 30000) {
    return refresh(accountId, 'ranch', minInterval, ranch, async (signal) => {
      const { data } = await api.get('/api/ranch', {
        params: { view: 'dashboard' },
        headers: { 'x-account-id': accountId },
        signal,
        timeout: 45000,
        skipErrorToast: true,
      } as any)
      if (data?.ok && data.data)
        return data.data
    })
  }

  function refreshDiamond(accountId: string, minInterval = 30000) {
    return refresh(accountId, 'diamond', minInterval, diamond, async (signal) => {
      const { data } = await api.get('/api/diamond', {
        headers: { 'x-account-id': accountId },
        signal,
        skipErrorToast: true,
      } as any)
      if (!data?.ok || data.data?.diamond == null)
        return
      const balance = Number(data.data.diamond)
      if (Number.isFinite(balance))
        return Math.max(0, balance)
    })
  }

  function refreshFertilizer(accountId: string, minInterval = 10000) {
    return refresh(accountId, 'fertilizer', minInterval, fertilizerItems, () => bagStore.fetchBag(accountId))
  }

  return { ranch, diamond, fertilizerItems, refreshRanch, refreshDiamond, refreshFertilizer }
})
