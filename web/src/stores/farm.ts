import type { CareerHarvestSteal } from '@/components/CareerHarvestSteal.vue'
import type {
  FriendInteractionBatchDto,
  FriendInteractionEffectDto,
  FriendInteractionItemDto,
} from '@/stores/friend'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import api, { getApiErrorMessage, normalizeApiErrorMessage } from '@/api'

export type FertilizerType = 'normal' | 'organic'

export interface Land {
  id: number
  plantName?: string
  phaseName?: string
  seedImage?: string
  status: string
  matureInSec: number
  needWater?: boolean
  needWeed?: boolean
  needBug?: boolean
  leftInorcFertTimes?: number | null
  [key: string]: any
}

export interface FertilizeLandResult {
  landId: number
  fertilizerType: FertilizerType
  fertilizerRemainingSec: number
  updatedLand?: Land | null
}

export interface FertilizeAllResult {
  fertilizerType: FertilizerType
  requestedCount: number
  successCount: number
  skippedCount: number
  fertilizerConsumedSec: number | null
  fertilizerRemainingSec: number | null
  updatedLands: Land[]
}

function userFacingFertilizeError(raw: unknown, fallback = '施肥失败') {
  return getApiErrorMessage(raw, fallback)
}

// UseReply.land 是刚成功操作后的权威快照，短期内不允许被随后的 AllLands 旧快照覆盖。
const FARM_LAND_OVERLAY_TTL_MS = 60 * 1000

export const useFarmStore = defineStore('farm', () => {
  const lands = ref<Land[]>([])
  const seeds = ref<any[]>([])
  const socialEvents = ref<any[]>([])
  const career = ref<CareerHarvestSteal | null>(null)
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref(false)
  const farmRefreshError = ref('')
  const interactionItems = ref<FriendInteractionItemDto[]>([])
  const interactionItemsLoading = ref(false)
  const interactionItemsError = ref('')
  const interactionUsePending = ref(false)
  const interactionUseError = ref('')
  const interactionItemsAccountId = ref('')
  const interactionUsedLandIds = ref<Record<string, string[]>>({})
  const fertilizePending = ref(false)
  const fertilizeError = ref('')
  let farmReadRequestVersion = 0
  let farmFertilizerRequestVersion = 0
  let farmInteractionReadVersion = 0
  let landOverlay: { lands: any[], effects: FriendInteractionEffectDto[], updatedAt: number } | null = null

  const accountStore = useAccountStore()
  const farmAccountId = ref('')
  const refreshing = ref(false)
  const farmAccountSessionVersion = ref(0)
  let farmSeedRequestVersion = 0
  let farmReadPromise: Promise<boolean> | null = null
  const pendingFarmAccounts = ref<string[]>([])
  const farmOperationPending = computed(() => pendingFarmAccounts.value.includes(String(accountStore.currentAccountId || '')))
  const ownsFarmAccount = (accountId: string) => !!accountId && farmAccountId.value === accountId
    && String(accountStore.currentAccountId || '') === accountId
  function invalidateFarmReadRequests() {
    farmReadRequestVersion++
    farmInteractionReadVersion++
    farmSeedRequestVersion++
    farmReadPromise = null
    refreshing.value = false
    loading.value = false
    interactionItemsLoading.value = false
  }
  async function runFarmWrite(accountId: string, operation: (isCurrentFarmOperation: () => boolean) => Promise<any>): Promise<any> {
    if (!ownsFarmAccount(accountId) || pendingFarmAccounts.value.includes(accountId))
      return false
    invalidateFarmReadRequests()
    const version = farmAccountSessionVersion.value
    const isCurrentFarmOperation = () => ownsFarmAccount(accountId) && farmAccountSessionVersion.value === version
    pendingFarmAccounts.value = [...pendingFarmAccounts.value, accountId]
    try {
      const result = await operation(isCurrentFarmOperation)
      return isCurrentFarmOperation() ? result : false
    }
    catch (cause) {
      if (isCurrentFarmOperation()) throw cause
      return false
    }
    finally {
      pendingFarmAccounts.value = pendingFarmAccounts.value.filter(id => id !== accountId)
    }
  }
  watch(() => String(accountStore.currentAccountId || ''), id => clearFarmAccountState(id), { immediate: true, flush: 'sync' })

  function normalizeLandId(value: unknown) {
    const text = String(value ?? '').trim()
    return /^\d+$/.test(text) && text !== '0' ? text : ''
  }

  function mergeLandUpdateList(landsInput: any[], updatesInput: any[]) {
    const current = Array.isArray(landsInput) ? landsInput : []
    const updates = Array.isArray(updatesInput) ? updatesInput.filter(Boolean) : []
    if (updates.length === 0)
      return current

    const byId = new Map(current.map(land => [normalizeLandId(land?.id), land]))
    for (const update of updates) {
      const updateId = normalizeLandId(update?.id)
      if (!updateId)
        continue
      const existing = byId.get(updateId)
      if (!existing)
        continue
      byId.set(updateId, { ...existing, ...update, id: existing.id })
    }
    return current.map(land => byId.get(normalizeLandId(land?.id)) || land)
  }

  function applyLandOverlay(landsInput: any[]) {
    if (landOverlay && Date.now() - landOverlay.updatedAt > FARM_LAND_OVERLAY_TTL_MS)
      landOverlay = null
    if (!landOverlay)
      return Array.isArray(landsInput) ? landsInput : []

    let merged = mergeLandUpdateList(landsInput, landOverlay.lands)
    const effects = landOverlay.effects
    if (effects.length === 0)
      return merged

    merged = merged.map((land: any) => {
      const landId = normalizeLandId(land?.id)
      const occupiedIds = new Set([
        landId,
        ...(Array.isArray(land?.occupiedLandIds) ? land.occupiedLandIds.map(normalizeLandId) : []),
        normalizeLandId(land?.masterLandId),
      ].filter(Boolean))
      const visibleEffects = effects.filter(effect => occupiedIds.has(normalizeLandId(effect?.landId)))
      if (visibleEffects.length === 0)
        return land
      const existing = Array.isArray(land?.interactionEffects) ? land.interactionEffects : []
      const seen = new Set(existing.map((effect: any) => `${effect?.itemId}:${effect?.landId}:${effect?.usedAt || ''}`))
      const mergedEffects = [...existing]
      for (const effect of visibleEffects) {
        const key = `${effect.itemId}:${effect.landId}:${effect.usedAt || ''}`
        if (!seen.has(key)) {
          seen.add(key)
          mergedEffects.push(effect)
        }
      }
      return { ...land, interactionEffects: mergedEffects }
    })
    return merged
  }

  function recordLandUpdates(updatedLandsInput: any[], effectsInput: FriendInteractionEffectDto[] = []) {
    const updatedLands = Array.isArray(updatedLandsInput) ? updatedLandsInput.filter(Boolean) : []
    const effects = Array.isArray(effectsInput) ? effectsInput.filter(effect => !!effect?.confirmed) : []
    if (updatedLands.length === 0 && effects.length === 0)
      return
    landOverlay = {
      lands: mergeLandUpdateList(landOverlay?.lands || [], updatedLands),
      effects: [...(landOverlay?.effects || []), ...effects],
      updatedAt: Date.now(),
    }
    lands.value = applyLandOverlay(mergeLandUpdateList(lands.value, updatedLands))
  }

  async function fetchLands(accountId: string, afterOperation = false): Promise<boolean> {
    if (!ownsFarmAccount(accountId) || (pendingFarmAccounts.value.includes(accountId) && !afterOperation))
      return false
    if (farmReadPromise)
      return farmReadPromise
    const version = ++farmReadRequestVersion
    const isCurrentFarmRead = () => ownsFarmAccount(accountId) && version === farmReadRequestVersion
    refreshing.value = true
    loading.value = !loaded.value
    error.value = false
    farmRefreshError.value = ''
    const request = (async () => {
      try {
        const { data } = await api.get('/api/lands', { headers: { 'x-account-id': accountId }, skipErrorToast: true } as any)
        if (!isCurrentFarmRead())
          return false
        if (data?.ok) {
          lands.value = applyLandOverlay(data.data.lands || [])
          socialEvents.value = Array.isArray(data.data.socialEvents) ? data.data.socialEvents : []
          career.value = data.data.career || null
          loaded.value = true
          return true
        }
        error.value = !loaded.value
        farmRefreshError.value = '土地数据刷新失败'
        return false
      }
      catch (cause) {
        if (isCurrentFarmRead()) {
          error.value = !loaded.value
          farmRefreshError.value = getApiErrorMessage(cause, '土地数据刷新失败')
        }
        return false
      }
      finally {
        if (isCurrentFarmRead()) {
          loading.value = false
          refreshing.value = false
          farmReadPromise = null
        }
      }
    })()
    farmReadPromise = request
    return request
  }

  function clearFarmAccountState(accountId = String(accountStore.currentAccountId || '')) {
    invalidateFarmReadRequests()
    farmAccountSessionVersion.value++
    farmRefreshError.value = ''
    farmAccountId.value = accountId
    seeds.value = []
    farmFertilizerRequestVersion++
    lands.value = []
    socialEvents.value = []
    career.value = null
    loading.value = false
    loaded.value = false
    error.value = false
    landOverlay = null
    fertilizePending.value = false
    fertilizeError.value = ''
    clearFarmInteractionState()
  }

  function interactionUsageKey(accountId: string, itemId: unknown) {
    return `${String(accountId || '')}:${String(itemId || '')}`
  }

  function getInteractionUsedLandIds(accountId: string, itemId: unknown) {
    return interactionUsedLandIds.value[interactionUsageKey(accountId, itemId)] || []
  }

  function clearFarmInteractionState() {
    farmInteractionReadVersion++
    interactionItems.value = []
    interactionItemsLoading.value = false
    interactionItemsError.value = ''
    interactionUseError.value = ''
    interactionItemsAccountId.value = ''
    interactionUsedLandIds.value = {}
  }

  /** 读取背包中可对自己农场使用的特殊互动道具（服务端已按白名单过滤）。 */
  async function fetchInteractionItems(accountId: string) {
    const requestedAccountId = String(accountId || '').trim()
    if (!ownsFarmAccount(requestedAccountId) || pendingFarmAccounts.value.includes(requestedAccountId))
      return false
    const sequence = ++farmInteractionReadVersion
    if (interactionItemsAccountId.value !== requestedAccountId) {
      interactionItems.value = []
      interactionItemsAccountId.value = requestedAccountId
    }
    interactionItemsLoading.value = true
    interactionItemsError.value = ''
    try {
      const res = await api.get('/api/farm/interaction-items', {
        headers: { 'x-account-id': requestedAccountId },
        skipErrorToast: true,
      } as any)
      if (sequence !== farmInteractionReadVersion || !ownsFarmAccount(requestedAccountId))
        return false
      if (!res.data?.ok) {
        interactionItems.value = []
        interactionItemsError.value = getApiErrorMessage(res.data, '无法读取可用的互动道具')
        return false
      }
      interactionItems.value = Array.isArray(res.data?.data?.items) ? res.data.data.items : []
      return true
    }
    catch (cause: any) {
      if (sequence !== farmInteractionReadVersion || !ownsFarmAccount(requestedAccountId))
        return false
      interactionItems.value = []
      interactionItemsError.value = getApiErrorMessage(cause, '无法读取可用的互动道具')
      return false
    }
    finally {
      if (sequence === farmInteractionReadVersion && ownsFarmAccount(requestedAccountId))
        interactionItemsLoading.value = false
    }
  }

  async function useInteractionItemBatch(accountId: string, itemId: string, landIds: string[]) {
    return runFarmWrite(accountId, async (isCurrentFarmOperation) => {
      if (!accountId || !itemId || !Array.isArray(landIds) || landIds.length === 0)
        return false
      if (interactionUsePending.value)
        return false
      interactionUsePending.value = true
      interactionUseError.value = ''
      try {
        const res = await api.post('/api/farm/interaction-items/use-batch', {
          itemId,
          landIds,
        }, {
          headers: { 'x-account-id': accountId },
          skipErrorToast: true,
        } as any)
        if (!isCurrentFarmOperation())
          return false
        if (!res.data?.ok) {
          interactionUseError.value = getApiErrorMessage(res.data, '互动道具使用失败')
          return false
        }
        const result = res.data.data as FriendInteractionBatchDto
        if (result && typeof result.message === 'string')
          result.message = normalizeApiErrorMessage(result.message)
        for (const item of result?.results || []) {
          if (item && typeof item.message === 'string')
            item.message = normalizeApiErrorMessage(item.message)
        }
        if (Array.isArray(result?.items))
          interactionItems.value = result.items
        const key = interactionUsageKey(accountId, result.itemId)
        const used = new Set(interactionUsedLandIds.value[key] || [])
        for (const landId of result.usedLandIds || [])
          used.add(String(landId))
        interactionUsedLandIds.value = {
          ...interactionUsedLandIds.value,
          [key]: [...used].sort((left, right) => Number(left) - Number(right)),
        }
        recordLandUpdates(result?.updatedLands || [], result?.interactionEffects || [])
        return result
      }
      catch (cause: any) {
        if (!isCurrentFarmOperation())
          return false
        interactionUseError.value = getApiErrorMessage(cause, '互动道具使用失败')
        return false
      }
      finally {
        if (isCurrentFarmOperation())
        interactionUsePending.value = false
      }
    })
  }

  async function fetchSeeds(accountId: string) {
    const version = ++farmSeedRequestVersion
    if (!ownsFarmAccount(accountId) || pendingFarmAccounts.value.includes(accountId))
      return
    const { data } = await api.get('/api/seeds', {
      headers: { 'x-account-id': accountId },
    })
    if (data && data.ok && ownsFarmAccount(accountId) && version === farmSeedRequestVersion)
      seeds.value = data.data || []
  }

  async function fertilizeLand(accountId: string, landId: number, fertilizerType: FertilizerType) {
    return runFarmWrite(accountId, async (isCurrentFarmOperation) => {
      if (!accountId || !landId || fertilizePending.value)
        return false
      fertilizePending.value = true
      const sequence = ++farmFertilizerRequestVersion
      fertilizeError.value = ''
      try {
        const res = await api.post('/api/farm/fertilize', {
          landId,
          fertilizerType,
        }, {
          headers: { 'x-account-id': accountId },
          skipErrorToast: true,
        } as any)
        if (sequence !== farmFertilizerRequestVersion || !isCurrentFarmOperation())
          return false
        if (!res.data?.ok) {
          fertilizeError.value = userFacingFertilizeError(res.data)
          return false
        }
        const result = res.data.data as FertilizeLandResult
        if (result?.updatedLand)
          recordLandUpdates([result.updatedLand])
        else
          await fetchLands(accountId, true)
        return result
      }
      catch (cause: any) {
        if (!isCurrentFarmOperation())
          return false
        if (sequence !== farmFertilizerRequestVersion || !isCurrentFarmOperation())
          return false
        fertilizeError.value = userFacingFertilizeError(cause)
        return false
      }
      finally {
        if (sequence === farmFertilizerRequestVersion && isCurrentFarmOperation())
          fertilizePending.value = false
      }
    })
  }

  async function fertilizeAll(accountId: string, fertilizerType: FertilizerType, landIds?: number[]) {
    return runFarmWrite(accountId, async (isCurrentFarmOperation) => {
      if (!accountId || fertilizePending.value)
        return false
      const sequence = ++farmFertilizerRequestVersion
      fertilizePending.value = true
      fertilizeError.value = ''
      try {
        const res = await api.post('/api/farm/fertilize-all', landIds ? { fertilizerType, landIds } : { fertilizerType }, {
          headers: { 'x-account-id': accountId },
          skipErrorToast: true,
        } as any)
        if (sequence !== farmFertilizerRequestVersion || !isCurrentFarmOperation())
          return false
        if (!res.data?.ok) {
          fertilizeError.value = userFacingFertilizeError(res.data)
          return false
        }
        const result = res.data.data as FertilizeAllResult
        recordLandUpdates(result.updatedLands || [])
        return result
      }
      catch (cause: any) {
        if (!isCurrentFarmOperation())
          return false
        if (sequence !== farmFertilizerRequestVersion || !isCurrentFarmOperation())
          return false
        fertilizeError.value = userFacingFertilizeError(cause)
        return false
      }
      finally {
        if (sequence === farmFertilizerRequestVersion && isCurrentFarmOperation())
          fertilizePending.value = false
      }
    })
  }

  async function operate(accountId: string, opType: string, landId: number | null = null) {
    return runFarmWrite(accountId, async (isCurrentFarmOperation) => {
      if (!accountId)
        return false
      const res = await api.post('/api/farm/operate', { opType, landId }, {
        headers: { 'x-account-id': accountId }, skipErrorToast: true,
      } as any)
      if (!isCurrentFarmOperation())
        return false
      if (!res.data?.ok) {
        throw new Error(getApiErrorMessage(res.data, '农场操作失败'))
      }
      landOverlay = null
      await fetchLands(accountId, true)
      const result = res.data?.data || { hadWork: false, actions: [] }
      if (result && typeof result.message === 'string')
        result.message = normalizeApiErrorMessage(result.message)
      return result
    })
  }

  return {
    lands,
    socialEvents,
    career,
    seeds,
    loading,
    loaded,
    error,
    interactionItems,
    interactionItemsLoading,
    interactionItemsError,
    interactionUsePending,
    interactionUseError,
    fertilizePending,
    fertilizeError,
    fetchLands,
    clearFarmAccountState,
    invalidateFarmReadRequests,
    farmAccountId,
    refreshing,
    farmOperationPending,
    farmAccountSessionVersion,
    farmRefreshError,
    fetchSeeds,
    operate,
    fetchInteractionItems,
    useInteractionItemBatch,
    getInteractionUsedLandIds,
    clearFarmInteractionState,
    fertilizeLand,
    fertilizeAll,
  }
})
