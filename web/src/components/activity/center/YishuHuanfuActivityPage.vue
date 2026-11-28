<script setup lang="ts">
import type { YishuHistory, YishuHuanfuTabKey } from './yishu-huanfu-details'
import { NButton } from 'naive-ui/es/button'
import { NModal } from 'naive-ui/es/modal'
import { NTab } from 'naive-ui/es/tabs'
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import ActivityRulesDialog from '@/components/activity/ActivityRulesDialog.vue'
import { YishuHuanfuTab } from '@/components/activity/gameplays/yishuhuanfu'
import PageTabs from '@/components/PageTabs.vue'
import YishuAutomationFields from '@/components/settings/YishuAutomationFields.vue'
import '@/components/settings/settings-surface.css'
import BaseButton from '@/components/ui/BaseButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import OfflineState from '@/components/ui/OfflineState.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { useAccountOffline } from '@/composables/useReconnectRefresh'
import { useAccountStore } from '@/stores/account'
import { useActivityCenterStore, type YishuHuanfuFriendShopDto } from '@/stores/activity-center'
import { useSettingStore } from '@/stores/setting'
import { yishuAutomationDraft, yishuSellMode } from '@/utils/account-feature-modules'
import { useActivityClock } from './useActivityClock'
import YishuHuanfuFarmStatus from './YishuHuanfuFarmStatus.vue'
import YishuHuanfuHistory from './YishuHuanfuHistory.vue'
import { isYishuSaleTarget, yishuSaleQuota } from './yishu-huanfu-details'

const emit = defineEmits<{ back: [] }>()
const accountStore = useAccountStore()
const activityStore = useActivityCenterStore()
const settingsStore = useSettingStore()
const offline = useAccountOffline()
const { currentAccountId } = storeToRefs(accountStore)
const quoteMode = computed(() => {
  if (settingsStore.loadedAccountId !== currentAccountId.value)
    return null
  const automation = settingsStore.settings.automation
  return automation.activity_enabled === false ? 'off' : yishuSellMode(automation)
})
const {
  yishuHuanfu,
  loading,
  error,
  actionError,
  notice,
  pendingActions,
  yishuHuanfuFriendShops,
  yishuHuanfuFriendShopsLoading,
  yishuHuanfuFriendScanAt,
  yishuHuanfuFriendQuoteDay,
  yishuHuanfuFriendScanNote,
  yishuHuanfuManualPending,
} = storeToRefs(activityStore)
const { remaining, serverNow } = useActivityClock()
const gameDay = computed(() => new Date(serverNow.value + 8 * 3600 * 1000).toISOString().slice(0, 10))
const currentQuoteDay = computed(() => {
  const quoteDay = yishuHuanfuFriendQuoteDay.value
  return quoteDay === null || quoteDay === gameDay.value ? gameDay.value : ''
})
const remainingText = remaining(computed(() => yishuHuanfu.value?.endTime))
const dayEndSeconds = computed(() => {
  const now = Math.floor(serverNow.value / 1000) + 8 * 3600
  return 86400 - now % 86400
})
const settlementCountdown = computed(() => `${Math.floor(dayEndSeconds.value / 3600)} 小时 ${Math.floor(dayEndSeconds.value % 3600 / 60)} 分钟`)
const currentActivity = computed(() => offline.value ? null : yishuHuanfu.value)
const ownPrice = computed(() => Number(currentActivity.value?.shop.estimatedPrice || 0))
const stock = computed(() => Number(currentActivity.value?.sweetPotatoBalance || 0))
const history = ref<YishuHistory | null>(null)
const selectedDay = ref('')
const historyBusy = ref(false)
let historyVersion = 0
const localMessage = ref('')
const tabs = [
  { key: 'shop', label: '今日操作', icon: 'i-carbon-store' },
  { key: 'records', label: '活动日志', icon: 'i-carbon-list' },
  { key: 'store', label: '福币商店', icon: 'i-carbon-gift' },
] as const
const tab = ref<YishuHuanfuTabKey>('shop')
const contentScroll = ref<HTMLElement | null>(null)
const farmRefreshVersion = ref(0)
const rulesOpen = ref(false)
const settingsOpen = ref(false)
const settingsBusy = ref(false)
const draft = ref<Record<string, any>>({})
const compareAt = yishuHuanfuFriendScanAt
const compareShops = computed(() => {
  if (yishuHuanfuFriendQuoteDay.value !== null)
    return currentQuoteDay.value ? yishuHuanfuFriendShops.value : []
  if (compareAt.value && new Date(compareAt.value + 8 * 3600 * 1000).toISOString().slice(0, 10) !== gameDay.value)
    return []
  return yishuHuanfuFriendShops.value
})
const compareStale = computed(() => {
  if (!compareAt.value)
    return false
  const quoteDay = new Date(compareAt.value + 8 * 3600 * 1000).toISOString().slice(0, 10)
  const interval = Number(settingsStore.settings.automation.yishu_scan_interval_minutes) || 30
  return quoteDay !== currentQuoteDay.value || serverNow.value - compareAt.value >= interval * 60 * 1000
})
const bestShop = computed(() => [...compareShops.value].filter(isYishuSaleTarget).sort((left, right) =>
  Number(right.totalPrice) - Number(left.totalPrice) || Number(right.own) - Number(left.own) || Number(right.quota) - Number(left.quota),
)[0])
async function loadHistory(day = selectedDay.value) {
  const id = accountId()
  if (!id)
    return
  const version = ++historyVersion
  historyBusy.value = true
  try {
    const { data } = await api.get('/api/activity-center/yishuhuanfu/history', {
      headers: { 'x-account-id': id }, params: { day: day || undefined }, skipErrorToast: true,
    } as any)
    if (version !== historyVersion)
      return
    if (!data?.ok)
      throw new Error(getApiErrorMessage(data, '读取活动历史失败'))
    history.value = data.data
  } catch (cause) {
    if (version === historyVersion)
      localMessage.value = getApiErrorMessage(cause, '读取活动历史失败')
  } finally {
    if (version === historyVersion)
      historyBusy.value = false
  }
}

function selectHistoryDay(day: string) {
  selectedDay.value = day
  void loadHistory(day)
}

useIntervalFn(() => {
  if (!historyBusy.value)
    void loadHistory()
}, 20000)

async function openAutomationSettings() {
  const id = accountId()
  if (!id || settingsBusy.value)
    return
  settingsBusy.value = true
  try {
    if (settingsStore.loadedAccountId !== id && !await settingsStore.fetchSettings(id))
      throw new Error('读取账号设置失败')
    if (id !== accountId())
      return
    draft.value = yishuAutomationDraft(settingsStore.settings.automation)
    settingsOpen.value = true
  } catch (cause) {
    localMessage.value = getApiErrorMessage(cause, '读取账号设置失败')
  } finally {
    settingsBusy.value = false
  }
}

async function saveAutomationSettings() {
  const id = accountId()
  settingsBusy.value = true
  try {
    const result = await settingsStore.saveSettings(id, { automation: draft.value as typeof settingsStore.settings.automation })
    if (id !== accountId())
      return
    localMessage.value = result.ok ? '活动自动化已保存'
      : result.saved ? '已保存，运行账号尚未确认应用' : result.error || '保存失败'
    if (result.ok || result.saved)
      settingsOpen.value = false
  } finally {
    settingsBusy.value = false
  }
}

const numberFormatter = new Intl.NumberFormat('zh-CN')
function formatNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined)
    return '—'
  const num = Number(value)
  return Number.isFinite(num) ? numberFormatter.format(num) : String(value)
}

// 「剩余：14天10小时」→「14 天 10 小时」，与牧歌初启页头同一写法。
const headMeta = computed(() => {
  const raw = String(remainingText.value || '').trim()
  if (!raw || raw === '活动已结束')
    return raw
  return raw.replace(/^剩余[：:]\s*/, '').replace(/(\d+)\s*(天|小时|分钟)/g, '$1 $2 ').trim()
})

function accountId() {
  return String(currentAccountId.value || '')
}
const refreshing = ref(false)
async function refreshActivity() {
  const id = accountId()
  if (!id || refreshing.value)
    return
  if (tab.value === 'records' || offline.value)
    return loadHistory()
  refreshing.value = true
  try {
    const ok = await activityStore.loadDetails(id, 'yishuhuanfu')
    if (id === accountId()) {
      farmRefreshVersion.value++
      await Promise.allSettled([
        activityStore.loadYishuHuanfuCatalog(id),
        quoteMode.value && quoteMode.value !== 'off' ? activityStore.loadYishuHuanfuShop(id) : undefined,
        loadHistory(),
      ])
    }
    return ok
  }
  finally {
    refreshing.value = false
  }
}

// 兑换目录（cmd 97）和本人铺子额度（cmd 92）都不在快照里，进页面各拉一次。
function loadCatalog() {
  const id = accountId()
  if (!id || offline.value || !yishuHuanfu.value || yishuHuanfu.value.catalogLoaded)
    return
  activityStore.loadYishuHuanfuCatalog(id)
}

function loadShopQuota() {
  const id = accountId()
  if (!id || offline.value || !yishuHuanfu.value || yishuHuanfu.value.shop.quota !== null
    || !['scan', 'auto'].includes(quoteMode.value ?? ''))
    return
  activityStore.loadYishuHuanfuShop(id)
}

// 账号切换、或详情首次到位时补一次；已有值时不重复请求。
watch(
  () => [currentAccountId.value, quoteMode.value, yishuHuanfu.value?.activityId, yishuHuanfu.value?.catalogLoaded, yishuHuanfu.value?.shop.quota],
  () => {
    loadCatalog()
    loadShopQuota()
  },
  { immediate: true },
)

interface YishuSale {
  gid: string
  name: string
  count: number | string
  price: string
  quota: string | null
  day: string
  clientOrderId?: string
}

const sale = ref<YishuSale | null>(null)
const saleBusy = ref(false)
const saleMessage = ref('')
const quoteNeedsRefresh = ref(false)
let saleRevision = 0
const saleDayChanged = computed(() => !!sale.value && sale.value.day !== currentQuoteDay.value)
const needsRequote = computed(() => quoteNeedsRefresh.value || saleDayChanged.value)
const saleLimit = computed(() => sale.value ? availableSaleCount(sale.value.quota) : 0)
const saleCount = computed(() => Number(sale.value?.count ?? 0))
const saleCountValid = computed(() => Number.isSafeInteger(saleCount.value) && saleCount.value > 0 && saleCount.value <= saleLimit.value)
const saleTotal = computed(() => saleCountValid.value ? saleCount.value * Number(sale.value?.price) : null)

function availableSaleCount(quota: string | null) {
  return quota === null ? stock.value : Math.min(stock.value, Number(quota))
}

function openSale(shop: YishuHuanfuFriendShopDto) {
  const day = currentQuoteDay.value
  if (saleBusy.value || !day || !currentActivity.value?.active || history.value?.pendingOrder || !isYishuSaleTarget(shop))
    return
  const quota = yishuSaleQuota(shop)
  const count = availableSaleCount(quota)
  if (!Number.isSafeInteger(count) || count <= 0)
    return
  sale.value = { gid: shop.gid, name: shop.own ? '自家铺子' : shop.name || shop.gid, count, price: shop.totalPrice, quota, day }
  saleMessage.value = ''
  quoteNeedsRefresh.value = false
}

async function requoteSale() {
  const order = sale.value
  const id = accountId()
  const revision = saleRevision
  const day = currentQuoteDay.value
  if (!order || !id || !day || offline.value || saleBusy.value || history.value?.pendingOrder)
    return
  saleBusy.value = true
  try {
    const loaded = await activityStore.loadDetails(id, 'yishuhuanfu')
    if (revision !== saleRevision)
      return
    if (!loaded)
      throw new Error('读取库存失败，请稍后重试')
    const quote = await activityStore.queryYishuHuanfuShopQuote(id, order.gid)
    if (revision !== saleRevision)
      return
    if (currentQuoteDay.value !== day || (quote?.quoteDay && quote.quoteDay !== day))
      throw new Error('报价日期已变化，请重新查价')
    if (!isYishuSaleTarget(quote))
      throw new Error('该铺子当前无法收购')
    const quota = yishuSaleQuota(quote)
    const limit = availableSaleCount(quota)
    if (limit <= 0)
      throw new Error('当前没有可出售的蜜薯')
    const count = Number.isSafeInteger(saleCount.value) && saleCount.value > 0 ? Math.min(saleCount.value, limit) : limit
    sale.value = { ...order, day, count, quota, price: quote.totalPrice }
    quoteNeedsRefresh.value = false
    saleMessage.value = '报价已更新，请核对后确认'
  } catch (cause) {
    if (revision === saleRevision) {
      quoteNeedsRefresh.value = true
      saleMessage.value = getApiErrorMessage(cause, '读取新报价失败')
    }
  } finally {
    if (revision === saleRevision)
      saleBusy.value = false
  }
}

async function executeSale() {
  const order = sale.value
  const id = accountId()
  const revision = saleRevision
  if (!order || !id || offline.value || !saleCountValid.value || saleBusy.value || needsRequote.value || history.value?.pendingOrder)
    return
  saleBusy.value = true
  saleMessage.value = ''
  let sold = false
  try {
    order.clientOrderId ||= Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-')
    const { data } = await api.post('/api/activity-center/yishuhuanfu/sell', {
      friendGid: order.gid, count: saleCount.value, expectedPrice: order.price,
      expectedQuota: order.quota ?? undefined, expectedDay: order.day, withSnapshot: false,
      clientOrderId: order.clientOrderId,
    }, { headers: { 'x-account-id': id }, timeout: 45000, skipErrorToast: true } as any)
    if (revision !== saleRevision)
      return
    if (!data?.ok)
      throw new Error(getApiErrorMessage(data, '出售失败'))
    sold = true
    sale.value = null
    localMessage.value = ''
    notice.value = `已向${order.name}出售 ${formatNumber(data.data.count)} 个蜜薯，到账 ${formatNumber(data.data.income)} 福气币`
  } catch (cause) {
    if (revision === saleRevision) {
      quoteNeedsRefresh.value = true
      saleMessage.value = getApiErrorMessage(cause, '出售未确认，请核对后重试')
    }
  } finally {
    if (revision === saleRevision) {
      if (sold)
        await refreshActivity()
      else
        await loadHistory()
      if (revision === saleRevision)
        saleBusy.value = false
    }
  }
}

async function resolvePending(orderId: string) {
  const id = accountId()
  try {
    const { data } = await api.post('/api/activity-center/yishuhuanfu/sell/resolve', { orderId }, { headers: { 'x-account-id': id } })
    if (id !== accountId())
      return
    if (!data?.ok)
      throw new Error(getApiErrorMessage(data, '核对失败'))
    localMessage.value = '已记录你的核对结果'
    await refreshActivity()
  } catch (cause) {
    if (id === accountId())
      localMessage.value = getApiErrorMessage(cause, '核对失败')
  }
}

watch(currentAccountId, () => {
  activityStore.selectYishuHuanfuQuoteAccount(accountId())
  historyVersion++
  saleRevision++
  history.value = null
  sale.value = null
  saleBusy.value = false
  settingsOpen.value = false
  rulesOpen.value = false
  localMessage.value = ''
  selectedDay.value = ''
  void loadHistory()
  const id = accountId()
  if (id && settingsStore.loadedAccountId !== id)
    void settingsStore.fetchSettings(id).catch(() => false)
}, { immediate: true, flush: 'sync' })

watch(tab, (next) => {
  contentScroll.value?.scrollTo({ top: 0 })
  if (next === 'records')
    void loadHistory()
})

const canReadQuotes = computed(() => !!currentAccountId.value && !!currentActivity.value?.active)
function readQuotes() {
  if (canReadQuotes.value)
    void activityStore.scanYishuHuanfuFriendShops(accountId())
}
watch([currentAccountId, canReadQuotes, gameDay], readQuotes, { immediate: true })
useIntervalFn(readQuotes, 5000)

onBeforeUnmount(() => {
  historyVersion++
  saleRevision++
})

</script>

<template>
  <section class="yshf-view page-stack">
    <PageTabs v-model:value="tab" aria-label="以薯换福玩法">
      <NTab v-for="entry in tabs" :key="entry.key" :name="entry.key">
        <span class="yshf-tab-label inline-flex items-center gap-2"><span :class="entry.icon" aria-hidden="true" />{{ entry.label }}</span>
      </NTab>
    </PageTabs>

    <section class="yshf-panel-shell page-card-surface panel-scroll-layout margin-shell"><div class="margin-content">
      <header class="yshf-heading panel-titlebar panel-titlebar--flush margin-shell"><div class="margin-content">
        <div class="yshf-heading__lead">
          <NButton quaternary circle title="返回活动列表" aria-label="返回活动列表" @click="emit('back')">
            <template #icon><span class="i-carbon-arrow-left" /></template>
          </NButton>
          <img src="/activity-assets/yishuhuanfu/icon.png" alt="" width="32" height="32">
          <h1>{{ yishuHuanfu?.name || '以薯换福' }}</h1>
          <span v-if="headMeta" class="yshf-heading__period">
            <span class="i-carbon-time" aria-hidden="true" />{{ headMeta }}
          </span>
        </div>
        <div class="page-toolbar__actions">
          <NButton secondary :disabled="!currentActivity" @click="rulesOpen = true">
            <template #icon><span class="i-carbon-information" /></template>
            活动说明
          </NButton>
          <BaseButton variant="secondary" :disabled="!currentAccountId" :loading="settingsBusy" @click="openAutomationSettings">
            <template #icon><span class="i-carbon-settings-adjust" /></template>
            自动化设置
          </BaseButton>
          <RefreshButton
            :title="tab === 'records' ? '刷新活动日志' : '刷新活动数据'"
            :loading="refreshing || (tab === 'records' && historyBusy)"
            :disabled="loading || refreshing || !currentAccountId || (tab === 'records' ? historyBusy : offline)"
            @click="refreshActivity"
          />
        </div>
      </div></header>

      <section v-if="currentActivity" class="yshf-wallet margin-shell" aria-label="活动背包">
        <div class="margin-content">
          <div class="yshf-wallet__item" role="group" aria-label="福气币" title="福气币">
            <img v-if="currentActivity.luckCoin.image" :src="currentActivity.luckCoin.image" alt="">
            <span v-else class="yshf-wallet__icon i-carbon-currency" aria-hidden="true" />
            <span>{{ formatNumber(currentActivity.luckCoinBalance) }}</span>
          </div>
          <div class="yshf-wallet__item" role="group" aria-label="蜜薯" title="蜜薯">
            <img v-if="currentActivity.sweetPotato.image" :src="currentActivity.sweetPotato.image" alt="">
            <span v-else class="yshf-wallet__icon i-carbon-wheat" aria-hidden="true" />
            <span>{{ formatNumber(currentActivity.sweetPotatoBalance) }}</span>
          </div>
          <div class="yshf-wallet__item" role="group" aria-label="红薯种子" title="红薯种子">
            <img v-if="currentActivity.seed.image" :src="currentActivity.seed.image" alt="">
            <span v-else class="yshf-wallet__icon i-carbon-sprout" aria-hidden="true" />
            <span>{{ formatNumber(currentActivity.seedBalance) }}<span v-if="Number(currentActivity.daily.seedReceivedToday) > 0" class="yshf-muted" title="今日领取的种子">(+{{ formatNumber(currentActivity.daily.seedReceivedToday) }})</span></span>
          </div>
          <YishuHuanfuFarmStatus
            :account-id="accountId()"
            :active="currentActivity.active"
            :refresh-version="farmRefreshVersion"
          />
        </div>
      </section>
      <div ref="contentScroll" class="panel-scroll-body">
        <div class="yshf-content">
          <div
            v-if="localMessage || (!offline && (error || actionError || notice))"
            class="yshf-view__message"
            :class="{ success: notice && !error && !actionError }"
            role="status"
          >
            <span>{{ localMessage || actionError || error || notice }}</span>
          </div>
          <EmptyState v-if="!currentAccountId" bare title="请先选择账号" icon="i-carbon-user-avatar" />
          <OfflineState v-else-if="offline && tab !== 'records'" />
          <div v-else-if="loading && !currentActivity && tab !== 'records'" class="yshf-loading" role="status" aria-label="正在读取活动">
            <span class="i-svg-spinners-90-ring-with-bg" aria-hidden="true" />
          </div>
          <EmptyState v-else-if="!currentActivity && tab !== 'records'" bare title="暂未获取到活动数据" icon="i-carbon-calendar" />

          <template v-else>
            <div v-if="currentActivity && tab === 'shop'" class="yshf-overview margin-shell">
              <dl class="margin-content" aria-label="行情与日终结算">
                <div>
                  <dt>自家收购价</dt>
                  <dd v-if="currentActivity.shop.priceKnown">
                    {{ formatNumber(currentActivity.shop.estimatedPrice ?? currentActivity.shop.price) }}<span class="yshf-muted">(基础{{ formatNumber(currentActivity.shop.price) }}+加成{{ formatNumber(currentActivity.shop.bonus) }})</span>
                  </dd>
                  <dd v-else>—</dd>
                </div>
                <div>
                  <dt>接收额度</dt>
                  <dd v-if="currentActivity.shop.quota !== null">
                    {{ formatNumber(currentActivity.shop.quota) }} <span class="yshf-muted">/ {{ formatNumber(currentActivity.shop.quotaCap) }}</span>
                  </dd>
                  <dd v-else>—</dd>
                </div>
                <div>
                  <dt>最高已查可售价</dt>
                  <dd>{{ bestShop ? formatNumber(bestShop.totalPrice) : '—' }} <span v-if="bestShop && compareStale" class="yshf-muted">已过期</span></dd>
                </div>
                <div>
                  <dt>日终预计收入</dt>
                  <dd>{{ ownPrice > 0 && currentActivity.sweetPotatoBalanceKnown ? formatNumber(stock * ownPrice) : '—' }} <span class="yshf-muted">福气币</span></dd>
                </div>
                <div v-if="currentActivity.active">
                  <dt title="每日 24:00 按最终收购价结算剩余蜜薯">距 24:00 结算</dt>
                  <dd>{{ settlementCountdown }}</dd>
                </div>
              </dl>
            </div>
            <YishuHuanfuTab
              :key="currentAccountId"
              :tab="tab"
              :activity="currentActivity"
              :pending-sell="pendingActions.sellYishuHuanfuSweetPotato || saleBusy || !!history?.pendingOrder"
              :pending-exchange="pendingActions.exchangeYishuHuanfuGoods"
              :friend-shops="compareShops"
              :friend-shops-loading="yishuHuanfuFriendShopsLoading"
              :manual-pending="yishuHuanfuManualPending"
              :quote-mode="quoteMode"
              :friend-scan-note="yishuHuanfuFriendScanNote"
              @sell="openSale"
              @exchange="(index, count) => activityStore.exchangeYishuHuanfuGoods(accountId(), index, count)"
              @scan-friends="(force) => !offline && activityStore.scanYishuHuanfuFriendShops(accountId(), force)"
            >
              <template #history>
                <YishuHuanfuHistory
                  :history="history"
                  :busy="historyBusy"
                  :own-gid="currentActivity?.shop.gid"
                  :shops="compareShops"
                  @date="selectHistoryDay"
                  @resolve="resolvePending"
                />
              </template>
            </YishuHuanfuTab>
          </template>
        </div>
      </div>
    </div></section>

    <ActivityRulesDialog :open="rulesOpen" :rules="currentActivity?.rules" title="以薯换福 · 活动说明" @close="rulesOpen = false" />
    <NModal :show="settingsOpen" :mask-closable="!settingsBusy" @update:show="!$event && !settingsBusy && (settingsOpen = false)">
      <div class="settings-dialog yshf-settings" role="dialog" aria-modal="true" aria-labelledby="yshf-settings-title">
        <header class="settings-dialog__header">
          <span class="yshf-settings__icon i-carbon-settings-adjust" aria-hidden="true" />
          <h2 id="yshf-settings-title" class="settings-dialog__title">以薯换福自动化设置</h2>
          <button type="button" class="settings-dialog__close" aria-label="关闭" :disabled="settingsBusy" @click="settingsOpen = false">
            <span class="i-carbon-close text-lg" aria-hidden="true" />
          </button>
        </header>
        <div class="settings-dialog__body modal-scroll"><YishuAutomationFields v-model="draft" /></div>
        <footer class="settings-dialog__footer">
          <BaseButton variant="secondary" :disabled="settingsBusy" @click="settingsOpen = false">取消</BaseButton>
          <BaseButton :loading="settingsBusy" @click="saveAutomationSettings">保存设置</BaseButton>
        </footer>
      </div>
    </NModal>
    <NModal :show="sale !== null" :mask-closable="!saleBusy" @update:show="!$event && !saleBusy && (sale = null)">
      <section v-if="sale" class="settings-dialog yshf-sale-dialog" role="dialog" aria-labelledby="yshf-sale-title">
        <header class="settings-dialog__header">
          <h3 id="yshf-sale-title" class="settings-dialog__title">确认出售</h3>
          <span class="yshf-muted">{{ sale.name }}</span>
        </header>
        <div class="settings-dialog__body">
          <dl class="yshf-sale-details">
            <div>
              <dt><label for="yshf-sale-count">出售数量</label></dt>
              <dd>
                <input id="yshf-sale-count" v-model.number="sale.count" type="number" min="1" :max="saleLimit" :disabled="saleBusy">
                <span class="yshf-muted">个</span>
              </dd>
            </div>
            <div>
              <dt>剩余额度</dt>
              <dd>{{ sale.quota === null ? '不限' : `${formatNumber(sale.quota)} 个` }}</dd>
            </div>
            <div>
              <dt>单价</dt>
              <dd>{{ formatNumber(sale.price) }} 福气币 / 个</dd>
            </div>
            <div>
              <dt>总售价</dt>
              <dd>{{ saleTotal === null ? '—' : `${formatNumber(saleTotal)} 福气币` }}</dd>
            </div>
          </dl>
          <p v-if="saleDayChanged || saleMessage" class="yshf-sale-message" role="status">
            {{ saleDayChanged ? '已跨报价日，请重新查价' : saleMessage }}
          </p>
          <p v-else-if="saleCount > saleLimit" class="yshf-sale-message" role="status">最多可出售 {{ formatNumber(saleLimit) }} 个</p>
        </div>
        <footer class="settings-dialog__footer">
          <BaseButton size="sm" variant="secondary" :disabled="saleBusy" @click="sale = null">取消</BaseButton>
          <BaseButton v-if="needsRequote" size="sm" :loading="saleBusy" :disabled="offline || !currentQuoteDay || !!history?.pendingOrder" @click="requoteSale">重新查价</BaseButton>
          <BaseButton v-else size="sm" :loading="saleBusy" :disabled="offline || !saleCountValid || !!history?.pendingOrder" @click="executeSale">确认出售</BaseButton>
        </footer>
      </section>
    </NModal>
  </section>
</template>

<style scoped>
.yshf-view {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
}

.yshf-panel-shell {
  overflow: clip;
  background: var(--ui-surface-solid) !important;
}

.yshf-panel-shell > .margin-content {
  margin: 0;
}

.yshf-heading > .margin-content {
  justify-content: space-between;
}

.yshf-heading__lead {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}

.yshf-heading__lead img {
  flex: none;
  object-fit: contain;
}

.yshf-heading h1 {
  margin: 0;
  color: var(--ui-ink);
  font-weight: var(--fw-500);
  white-space: nowrap;
}

.yshf-heading__period {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ui-muted);
  font-size: var(--ui-font-size-small-13);
}

.yshf-tab-label,
.yshf-wallet,
.yshf-content {
  font-weight: var(--fw-400);
}

.yshf-wallet,
.yshf-content {
  color: var(--ui-ink);
  font-size: var(--ui-font-size-small-13);
  line-height: 1.5;
  --ui-disabled-button-weight: var(--fw-400);
}

.yshf-content :deep(.empty-state__title) {
  font-size: inherit;
  font-weight: inherit;
}

.yshf-content {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.yshf-wallet {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
  --inset-top: 8px;
  --inset-right: 16px;
  --inset-bottom: 8px;
  --inset-left: 16px;
  border-bottom: 1px solid var(--ui-border);
}
.yshf-wallet__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-variant-numeric: tabular-nums;
}

.yshf-wallet__item img {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.yshf-wallet__icon {
  color: var(--ui-muted);
  font-size: var(--ui-font-size-medium-14);
}

.yshf-muted {
  color: var(--ui-muted);
}

.yshf-overview {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px 16px;
  --inset-top: 12px;
  --inset-right: 16px;
  --inset-bottom: 12px;
  --inset-left: 16px;
  border-bottom: 1px solid var(--ui-border);
}

.yshf-overview > .margin-content {
  grid-template-columns: repeat(auto-fit, minmax(min(142px, 100%), 1fr));
}

.yshf-overview dt {
  color: var(--ui-muted);
}

.yshf-overview dd {
  margin: 2px 0 0;
  font-variant-numeric: tabular-nums;
}
.yshf-settings {
  display: flex;
  width: min(600px, calc(100vw - 28px));
  max-height: calc(100dvh - 32px);
  flex-direction: column;
  border-color: var(--ui-border-strong);
  box-shadow: 0 18px 64px rgb(0 0 0 / 35%);
}

.yshf-settings .settings-dialog__header,
.yshf-settings .settings-dialog__footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 20px;
}

.yshf-settings .settings-dialog__header {
  border-bottom: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-card) var(--ui-radius-card) 0 0;
  background: var(--ui-surface-soft);
}

.yshf-settings .settings-dialog__title {
  flex: 1;
  margin: 0;
}

:is(.yshf-settings, .yshf-sale-dialog) .settings-dialog__title {
  font-size: var(--ui-font-size-large-15);
  font-weight: var(--fw-500);
}

.yshf-sale-dialog {
  width: min(380px, calc(100vw - 28px));
}

.yshf-sale-dialog .settings-dialog__header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px 12px;
  border-bottom: 1px solid var(--ui-border);
}

.yshf-sale-dialog .settings-dialog__title {
  margin: 0;
}

.yshf-sale-dialog .settings-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid var(--ui-border);
  border-radius: 0 0 var(--ui-radius-card) var(--ui-radius-card);
}

.yshf-sale-details {
  display: grid;
  gap: 9px;
  margin: 0;
}

.yshf-sale-details > div,
.yshf-sale-details dd {
  display: flex;
  align-items: center;
  gap: 6px 12px;
}

.yshf-sale-details > div {
  justify-content: space-between;
}

.yshf-sale-details dt,
.yshf-sale-message {
  color: var(--ui-muted);
}

.yshf-sale-details dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.yshf-sale-details input {
  width: 9ch;
  padding: 4px 8px;
  border: 1px solid var(--ui-border-strong);
  border-radius: var(--ui-radius-control);
  background: var(--ui-surface-soft);
  color: var(--ui-ink);
  font: inherit;
}

.yshf-sale-message {
  margin: 10px 0 0;
}

.yshf-settings :deep(.yishu-field-group h3),
.yshf-settings :deep(.yishu-field-note) {
  font-size: inherit;
  font-weight: var(--fw-400);
}

.yshf-settings__icon {
  flex: none;
  color: var(--ui-primary);
  font-size: 18px;
}

.yshf-settings .settings-dialog__body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px 20px;
}

.yshf-settings .settings-dialog__footer {
  justify-content: flex-end;
  border-top: 1px solid var(--ui-border);
  border-radius: 0 0 var(--ui-radius-card) var(--ui-radius-card);
}

.yshf-loading {
  display: grid;
  min-height: 130px;
  place-items: center;
  color: var(--ui-primary);
  font-size: var(--ui-font-size-large-15);
}

.yshf-view__message {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 8px 16px;
  padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--ui-danger) 26%, transparent);
  border-radius: 10px;
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
}

.yshf-view__message.success {
  border-color: color-mix(in srgb, var(--ui-primary) 26%, transparent);
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

</style>
