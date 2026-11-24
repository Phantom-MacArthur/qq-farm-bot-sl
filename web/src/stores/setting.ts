import { defineStore } from 'pinia'
import { ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'

type RanchFeedStage = 'any' | 'longest' | 'to_production' | 'near_harvest'

export interface AutomationConfig {
  ranch_harvest?: boolean
  ranch_produce?: boolean
  ranch_buy?: boolean
  ranch_upgrade?: boolean
  ranch_activate_shed?: boolean
  ranch_sell?: boolean
  ranch_market_organic?: boolean
  ranch_market_organic_poop?: boolean
  ranch_market_organic_pinecone?: boolean
  ranch_grass?: boolean
  ranch_grass_buy?: boolean
  ranch_grass_threshold_percent?: number
  ranch_fill_cans?: boolean
  ranch_feed_normal?: boolean
  ranch_feed_normal_stage?: RanchFeedStage
  ranch_feed_organic?: boolean
  ranch_feed_organic_stage?: RanchFeedStage
  ranch_clean?: boolean
  ranch_stroke?: boolean
  ranch_friend_steal?: boolean
  ranch_friend_clean?: boolean
  ranch_friend_mosquito?: boolean
  ranch_task?: boolean
  ranch_illustrated?: boolean
  ranch_share?: boolean
  ranch_daily_benefit?: boolean
  ranch_check_minutes?: number
  ranch_strategy?: string
  ranch_bag_fallback?: string
  ranch_coop_animal?: number
  ranch_shed_animal?: number
  ranch_coop_cub_priority?: number[]
  ranch_shed_cub_priority?: number[]
  farm?: boolean
  farm_harvest_tiangong?: boolean
  farm_push?: boolean
  land_upgrade?: boolean
  friend?: boolean
  friend_auto_accept?: boolean
  task?: boolean
  sell?: boolean
  fertilizer?: string
  fertilizer_multi_season?: boolean
  fertilizer_land_types?: string[]
  fertilizer_smart_seconds?: number
  friend_steal?: boolean
  friend_help?: boolean
  friend_bad?: boolean
  friend_help_exp_limit?: boolean
  friend_help_protect_dog_ignore_exp_limit?: boolean
  fertilizer_gift?: boolean
  fertilizer_buy_organic?: boolean
  fertilizer_buy_normal?: boolean
  mystery_shop_auto_buy?: boolean
  mystery_shop_allow_gold?: boolean
  mystery_shop_allow_coupon?: boolean
  mystery_shop_allow_gold_bean?: boolean
  mystery_shop_allow_diamond?: boolean
  mystery_shop_arrival_notify?: boolean
  mystery_shop_purchase_notify?: boolean
  mall_coupon_gift_buy?: boolean
  skip_own_weed_bug?: boolean
  show_manual_fertilizer?: boolean
}

export interface IntervalsConfig {
  farm?: number
  friend?: number
  farmMin?: number
  farmMax?: number
  friendMin?: number
  friendMax?: number
  helpMin?: number
  helpMax?: number
  stealMin?: number
  stealMax?: number
}

export interface FriendQuietHoursConfig {
  enabled?: boolean
  start?: string
  end?: string
  continueFarm?: boolean
}

export interface OfflineChannelCredential {
  token: string
  wxPusherUid: string
}

export interface OfflineConfig {
  channel: string
  endpoint: string
  token: string
  secret: string
  wxPusherUid: string
  channelCredentials: Record<string, OfflineChannelCredential>
  title: string
  msg: string
}

export interface UIConfig {
  theme?: string
}

export interface AutoCodeRefreshConfig {
  enabled: boolean
  intervalMinutes: number
  maxRetries: number
}

export interface SettingsState {
  plantingStrategy: string
  preferredSeedId: number
  bagSeedPriority: number[]
  bagSeedMultiLandReservationEnabled: boolean
  bagSeedLandTypes: Record<string, string[]>
  bagSeedFallbackStrategy: string
  intervals: IntervalsConfig
  friendQuietHours: FriendQuietHoursConfig
  automation: AutomationConfig
  ui: UIConfig
  offlineReminder: OfflineConfig
  stealDelaySeconds: number
  plantDelaySeconds: number
  fertilizerBuyOrganicCount: number
  fertilizerBuyOrganicThresholdHours: number
  fertilizerBuyNormalCount: number
  fertilizerBuyNormalThresholdHours: number
  fertilizerBuyCheckIntervalMinutes: number
  emailClaimHour: number
  autoAcceptFriendMinLevel: number
  autoAcceptRequireOwnLevel: boolean
}

type SaveableSettingsKey
  = | 'plantingStrategy'
    | 'preferredSeedId'
    | 'bagSeedPriority'
    | 'bagSeedMultiLandReservationEnabled'
    | 'bagSeedLandTypes'
    | 'bagSeedFallbackStrategy'
    | 'intervals'
    | 'friendQuietHours'
    | 'automation'
    | 'stealDelaySeconds'
    | 'plantDelaySeconds'
    | 'fertilizerBuyOrganicCount'
    | 'fertilizerBuyOrganicThresholdHours'
    | 'fertilizerBuyNormalCount'
    | 'fertilizerBuyNormalThresholdHours'
    | 'fertilizerBuyCheckIntervalMinutes'
    | 'emailClaimHour'
    | 'autoAcceptFriendMinLevel'
    | 'autoAcceptRequireOwnLevel'

export type SettingsSavePayload = Partial<Pick<SettingsState, SaveableSettingsKey>>

const SAVEABLE_SETTINGS_KEYS: SaveableSettingsKey[] = [
  'plantingStrategy',
  'preferredSeedId',
  'bagSeedPriority',
  'bagSeedMultiLandReservationEnabled',
  'bagSeedLandTypes',
  'bagSeedFallbackStrategy',
  'intervals',
  'friendQuietHours',
  'automation',
  'stealDelaySeconds',
  'plantDelaySeconds',
  'fertilizerBuyOrganicCount',
  'fertilizerBuyOrganicThresholdHours',
  'fertilizerBuyNormalCount',
  'fertilizerBuyNormalThresholdHours',
  'fertilizerBuyCheckIntervalMinutes',
  'emailClaimHour',
  'autoAcceptFriendMinLevel',
  'autoAcceptRequireOwnLevel',
]

function createDefaultSettings(): SettingsState {
  return {
    plantingStrategy: 'max_exp',
    preferredSeedId: 0,
    bagSeedPriority: [],
    bagSeedMultiLandReservationEnabled: false,
    bagSeedLandTypes: {},
    bagSeedFallbackStrategy: 'level',
    intervals: {},
    friendQuietHours: { enabled: false, start: '23:00', end: '07:00', continueFarm: true },
    automation: {},
    ui: {},
    offlineReminder: {
      channel: 'wxpusher',
      endpoint: '',
      token: '',
      secret: '',
      wxPusherUid: '',
      channelCredentials: {
        qmsg: { token: '', wxPusherUid: '' },
        wxpusher: { token: '', wxPusherUid: '' },
        wxpusher_wechat: { token: '', wxPusherUid: '' },
        bark: { token: '', wxPusherUid: '' },
      },
      title: '',
      msg: '农场下线',
    },
    stealDelaySeconds: 0,
    plantDelaySeconds: 0,
    fertilizerBuyOrganicCount: 10,
    fertilizerBuyOrganicThresholdHours: 10,
    fertilizerBuyNormalCount: 10,
    fertilizerBuyNormalThresholdHours: 10,
    fertilizerBuyCheckIntervalMinutes: 30,
    emailClaimHour: 10,
    autoAcceptFriendMinLevel: 0,
    autoAcceptRequireOwnLevel: false,
  }
}

function createDefaultAutoCodeRefresh(): AutoCodeRefreshConfig {
  return {
    enabled: true,
    intervalMinutes: 2,
    maxRetries: 8,
  }
}

function cloneValue<T>(value: T): T {
  if (value === undefined || value === null)
    return value
  return JSON.parse(JSON.stringify(value))
}

export const useSettingStore = defineStore('setting', () => {
  const settings = ref<SettingsState>(createDefaultSettings())
  const loading = ref(false)
  const loadedAccountId = ref('')
  const autoCodeRefresh = ref<AutoCodeRefreshConfig>(createDefaultAutoCodeRefresh())
  const autoCodeRefreshLoading = ref(false)
  let pendingRequests = 0
  let fetchRevision = 0
  let latestRequestedAccountId = ''

  function beginRequest() {
    pendingRequests++
    loading.value = true
  }

  function endRequest() {
    pendingRequests = Math.max(0, pendingRequests - 1)
    loading.value = pendingRequests > 0
  }

  function applyFetchedSettings(data: any) {
    const defaults = createDefaultSettings()
    settings.value = {
      plantingStrategy: data.strategy || defaults.plantingStrategy,
      preferredSeedId: data.preferredSeed || defaults.preferredSeedId,
      bagSeedPriority: cloneValue(data.bagSeedPriority ?? defaults.bagSeedPriority),
      bagSeedMultiLandReservationEnabled: data.bagSeedMultiLandReservationEnabled ?? defaults.bagSeedMultiLandReservationEnabled,
      bagSeedLandTypes: cloneValue(data.bagSeedLandTypes ?? defaults.bagSeedLandTypes),
      bagSeedFallbackStrategy: data.bagSeedFallbackStrategy ?? defaults.bagSeedFallbackStrategy,
      intervals: cloneValue(data.intervals || defaults.intervals),
      friendQuietHours: {
        ...defaults.friendQuietHours,
        ...(cloneValue(data.friendQuietHours) || {}),
      },
      automation: cloneValue(data.automation || defaults.automation),
      ui: cloneValue(data.ui || defaults.ui),
      offlineReminder: {
        ...defaults.offlineReminder,
        ...(cloneValue(data.offlineReminder) || {}),
        channelCredentials: {
          ...defaults.offlineReminder.channelCredentials,
          ...((cloneValue(data.offlineReminder) || {}).channelCredentials || {}),
        },
      },
      stealDelaySeconds: data.stealDelaySeconds ?? defaults.stealDelaySeconds,
      plantDelaySeconds: data.plantDelaySeconds ?? defaults.plantDelaySeconds,
      fertilizerBuyOrganicCount: data.fertilizerBuyOrganicCount ?? defaults.fertilizerBuyOrganicCount,
      fertilizerBuyOrganicThresholdHours: data.fertilizerBuyOrganicThresholdHours ?? defaults.fertilizerBuyOrganicThresholdHours,
      fertilizerBuyNormalCount: data.fertilizerBuyNormalCount ?? defaults.fertilizerBuyNormalCount,
      fertilizerBuyNormalThresholdHours: data.fertilizerBuyNormalThresholdHours ?? defaults.fertilizerBuyNormalThresholdHours,
      fertilizerBuyCheckIntervalMinutes: data.fertilizerBuyCheckIntervalMinutes ?? defaults.fertilizerBuyCheckIntervalMinutes,
      emailClaimHour: data.emailClaimHour ?? defaults.emailClaimHour,
      autoAcceptFriendMinLevel: data.autoAcceptFriendMinLevel ?? defaults.autoAcceptFriendMinLevel,
      autoAcceptRequireOwnLevel: data.autoAcceptRequireOwnLevel ?? defaults.autoAcceptRequireOwnLevel,
    }
  }

  function applySavedSettings(payload: SettingsSavePayload, data: any) {
    const normalized = data && typeof data === 'object' ? data : {}
    for (const key of SAVEABLE_SETTINGS_KEYS) {
      if (Object.prototype.hasOwnProperty.call(payload, key))
        (settings.value as any)[key] = cloneValue(payload[key])
      if (Object.prototype.hasOwnProperty.call(normalized, key))
        (settings.value as any)[key] = cloneValue(normalized[key])
    }

    if (normalized.strategy !== undefined)
      settings.value.plantingStrategy = normalized.strategy || 'max_exp'
    if (normalized.preferredSeed !== undefined)
      settings.value.preferredSeedId = normalized.preferredSeed || 0
  }

  async function fetchSettings(accountId: string) {
    if (!accountId)
      return false
    const requestRevision = ++fetchRevision
    latestRequestedAccountId = accountId
    loadedAccountId.value = ''
    beginRequest()
    try {
      const { data } = await api.get('/api/settings', {
        headers: { 'x-account-id': accountId },
      })
      if (requestRevision !== fetchRevision)
        return false
      if (data && data.ok && data.data) {
        applyFetchedSettings(data.data)
        loadedAccountId.value = accountId
        return true
      }
      return false
    }
    finally {
      endRequest()
    }
  }

  async function saveSettings(accountId: string, newSettings: SettingsSavePayload) {
    if (!accountId)
      return { ok: false, error: '未选择账号' }

    const payload: SettingsSavePayload = {}
    for (const key of SAVEABLE_SETTINGS_KEYS) {
      if (Object.prototype.hasOwnProperty.call(newSettings, key))
        (payload as any)[key] = cloneValue(newSettings[key])
    }

    if (Object.keys(payload).length === 0)
      return { ok: false, error: '没有需要保存的设置' }

    beginRequest()
    try {
      const { data } = await api.post('/api/settings/save', payload, {
        headers: { 'x-account-id': accountId },
        timeout: 15000,
      })
      if (!data?.ok) {
        if (data?.saved && (!latestRequestedAccountId || latestRequestedAccountId === accountId)) {
          loadedAccountId.value = accountId
          applySavedSettings(payload, data.data)
        }
        return {
          ok: false,
          saved: !!data?.saved,
          unconfirmed: !!data?.unconfirmed,
          data: data?.data,
          error: getApiErrorMessage(data, '保存失败'),
        }
      }

      if (!latestRequestedAccountId || latestRequestedAccountId === accountId) {
        loadedAccountId.value = accountId
        applySavedSettings(payload, data.data)
      }
      return { ok: true, data: data.data }
    }
    catch (error: any) {
      return { ok: false, error: getApiErrorMessage(error, '保存失败') }
    }
    finally {
      endRequest()
    }
  }

  /** 刷新设置是全局的，不依当前账号，所以不能用带账号头的 loading。 */
  async function fetchAutoCodeRefresh() {
    autoCodeRefreshLoading.value = true
    try {
      const { data } = await api.get('/api/settings/auto-code-refresh')
      if (!data?.ok)
        return { ok: false, error: getApiErrorMessage(data, '读取失败') }
      autoCodeRefresh.value = {
        ...createDefaultAutoCodeRefresh(),
        ...(data.data || {}),
      }
      return { ok: true }
    }
    catch (error: any) {
      return { ok: false, error: getApiErrorMessage(error, '读取失败') }
    }
    finally {
      autoCodeRefreshLoading.value = false
    }
  }

  async function saveAutoCodeRefresh(config: AutoCodeRefreshConfig) {
    autoCodeRefreshLoading.value = true
    try {
      const { data } = await api.post('/api/settings/auto-code-refresh', config)
      if (data && data.ok) {
        autoCodeRefresh.value = {
          ...createDefaultAutoCodeRefresh(),
          ...(data.data || config),
        }
        return { ok: true }
      }
      return { ok: false, error: getApiErrorMessage(data, '保存失败') }
    }
    catch (error: any) {
      return { ok: false, error: getApiErrorMessage(error, '保存失败') }
    }
    finally {
      autoCodeRefreshLoading.value = false
    }
  }

  async function runAutoCodeRefresh(accountId: string) {
    if (!accountId)
      return { ok: false, error: '未选择账号' }
    try {
      const { data } = await api.post('/api/settings/auto-code-refresh/run', {}, {
        headers: { 'x-account-id': accountId },
        timeout: 60000,
      })
      if (data && data.ok && data.data?.ok !== false)
        return { ok: true }
      return { ok: false, error: getApiErrorMessage(data, '刷新失败') }
    }
    catch (error: any) {
      return { ok: false, error: getApiErrorMessage(error, '刷新失败') }
    }
  }

  async function saveOfflineConfig(config: OfflineConfig) {
    beginRequest()
    try {
      const { data } = await api.post('/api/settings/offline-reminder', config)
      if (data && data.ok) {
        settings.value.offlineReminder = cloneValue(config)
        return { ok: true }
      }
      return { ok: false, error: '保存失败' }
    }
    catch (error: any) {
      return { ok: false, error: getApiErrorMessage(error, '保存失败') }
    }
    finally {
      endRequest()
    }
  }

  async function fetchOfflineDefault(): Promise<{ ok: boolean, exists: boolean, config: OfflineConfig | null }> {
    try {
      const { data } = await api.get('/api/settings/offline-reminder/default')
      if (data && data.ok) {
        return { ok: true, exists: data.data?.exists === true, config: data.data?.config || null }
      }
      return { ok: false, exists: false, config: null }
    }
    catch {
      return { ok: false, exists: false, config: null }
    }
  }

  async function saveOfflineDefault(config: OfflineConfig) {
    try {
      const { data } = await api.put('/api/settings/offline-reminder/default', { config })
      if (data && data.ok) {
        const next: OfflineConfig = {
          ...cloneValue(config),
          ...(data.data?.config || {}),
        }
        settings.value.offlineReminder = next
        return { ok: true }
      }
      return { ok: false, error: getApiErrorMessage(data, '保存失败') }
    }
    catch (error: any) {
      return { ok: false, error: getApiErrorMessage(error, '保存失败') }
    }
  }

  async function applyOfflineDefault() {
    try {
      const { data } = await api.post('/api/settings/offline-reminder/default/apply', {})
      if (data && data.ok && data.data) {
        settings.value.offlineReminder = {
          ...settings.value.offlineReminder,
          ...cloneValue(data.data),
        }
        return { ok: true, config: data.data as OfflineConfig }
      }
      return { ok: false, error: getApiErrorMessage(data, '应用失败') }
    }
    catch (error: any) {
      return { ok: false, error: getApiErrorMessage(error, '应用失败') }
    }
  }

  return {
    settings,
    loading,
    loadedAccountId,
    autoCodeRefresh,
    autoCodeRefreshLoading,
    fetchSettings,
    saveSettings,
    saveOfflineConfig,
    fetchOfflineDefault,
    saveOfflineDefault,
    applyOfflineDefault,
    fetchAutoCodeRefresh,
    saveAutoCodeRefresh,
    runAutoCodeRefresh,
  }
})
