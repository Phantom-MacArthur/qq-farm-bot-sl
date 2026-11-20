<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { useAccountPresence } from '@/composables/useReconnectRefresh'
import { getPlatformLabel, useAccountStore } from '@/stores/account'
import { useBagStore } from '@/stores/bag'
import { useIllustratedStore } from '@/stores/illustrated'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import { formatCompactAmount, formatNumber } from '@/utils/format-number'

const statusStore = useStatusStore()
const accountStore = useAccountStore()
const bagStore = useBagStore()
const toastStore = useToastStore()
const illustratedStore = useIllustratedStore()
const {
  status,
  diamondBalance,
  logs: statusLogs,
  realtimeConnected,
} = storeToRefs(statusStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const presence = useAccountPresence()
const isOnline = computed(() => presence.value === 'online')
const isOffline = computed(() => presence.value === 'offline')
const { dashboardItems } = storeToRefs(bagStore)
const logContainer = ref<HTMLElement | null>(null)
const autoScroll = ref(true)
const lastBagFetchAt = ref(0)
const clearingLogs = ref(false)

/**
 * 方案B：保留上一次有效的种植经验。
 *
 * 土地快照靠 AllLands 刷新，在两次刷新之间可能短暂取不到（好友操作占满连接、网关繁忙等），
 * 这时整行直接消失会让人以为「种植经验丢了」。所以这里缓存上一次的有效值：
 * 只有后端明确给出「快照有效且地里没有作物」时才清掉缓存，其余情况沿用旧值。
 */
const cachedPlantExp = ref<number | null>(null)

watch(
  () => status.value?.levelForecast,
  (forecast: any) => {
    if (!forecast) {
      cachedPlantExp.value = null
      return
    }
    const plotCount = Number(forecast.plotCount || 0)
    const scheduledExp = Number(forecast.scheduledExp || 0)
    if (forecast.snapshotValid === true) {
      // 快照可信：地里确实没作物才清空，否则更新为最新值。
      cachedPlantExp.value = plotCount > 0 ? scheduledExp : null
      return
    }
    // 快照暂时不可用：保留上一次的有效值，不要让整行闪烁消失。
    if (plotCount > 0)
      cachedPlantExp.value = scheduledExp
  },
  { immediate: true },
)

const showPlantExp = computed(() => !!status.value?.connection?.connected && cachedPlantExp.value !== null)
const plantExpValue = computed(() => cachedPlantExp.value ?? 0)

const allLogs = computed(() => {
  return [...(statusLogs.value || [])]
    .slice(-200)
    .sort((a: any, b: any) => a.ts - b.ts)
})

type LogLevel = 'error' | 'warn' | 'success' | 'info'

function getLogLevel(log: any): LogLevel {
  const result = String(log?.meta?.result || '')
  if (log?.tag === '错误' || result === 'error' || result === 'failed')
    return 'error'
  if (log?.isWarn || log?.tag === '警告' || result === 'defer' || result === 'skip')
    return 'warn'
  if (['ok', 'success', 'done', 'resume', 'resumed'].includes(result))
    return 'success'
  return 'info'
}

/**
 * 连续出现、仅数字不同的同类日志合并为一行（×N + 时间范围），保留最新一条的内容，
 * 避免巡查类日志刷屏。
 */
const logGroups = computed(() => {
  const groups: Array<{ key: string, log: any, level: LogLevel, count: number, firstTime: string }> = []
  for (const log of allLogs.value) {
    const signature = `${log.tag}|${log.meta?.event || ''}|${String(log.msg || '').replace(/\d+/g, '#')}`
    const last = groups[groups.length - 1]
    if (last && last.key === signature) {
      last.count += 1
      last.log = log
      continue
    }
    groups.push({ key: signature, log, level: getLogLevel(log), count: 1, firstTime: log.time })
  }
  return groups
})

const filter = reactive({
  module: '',
  event: '',
  keyword: '',
  isWarn: '',
})

const hasActiveLogFilter = computed(() =>
  !!(filter.module || filter.event || filter.keyword || filter.isWarn),
)

const modules = [
  { label: '所有模块', value: '' },
  { label: '农场', value: 'farm' },
  { label: '好友', value: 'friend' },
  { label: '仓库', value: 'warehouse' },
  { label: '任务', value: 'task' },
  { label: '系统', value: 'system' },
]

const events = [
  { label: '所有事件', value: '' },
  { label: '农场巡查', value: 'farm_cycle' },
  { label: '收获作物', value: 'harvest_crop' },
  { label: '清理枯株', value: 'remove_plant' },
  { label: '种植种子', value: 'plant_seed' },
  { label: '施加化肥', value: 'fertilize' },
  { label: '土地推送', value: 'lands_notify' },
  { label: '选择种子', value: 'seed_pick' },
  { label: '购买种子', value: 'seed_buy' },
  { label: '购买化肥', value: 'fertilizer_buy' },
  { label: '开启礼包', value: 'fertilizer_gift_open' },
  { label: '获取任务', value: 'task_scan' },
  { label: '完成任务', value: 'task_claim' },
  { label: '免费礼包', value: 'mall_free_gifts' },
  { label: '分享奖励', value: 'daily_share' },
  { label: '会员礼包', value: 'vip_daily_gift' },
  { label: '月卡礼包', value: 'month_card_gift' },
  { label: '图鉴奖励', value: 'illustrated_rewards' },
  { label: '邮箱领取', value: 'email_rewards' },
  { label: '出售成功', value: 'sell_success' },
  { label: '土地升级', value: 'upgrade_land' },
  { label: '土地解锁', value: 'unlock_land' },
  { label: '好友巡查', value: 'friend_cycle' },
  { label: '访问好友', value: 'visit_friend' },
]

const eventLabelMap: Record<string, string> = Object.fromEntries(
  events.filter(e => e.value).map(e => [e.value, e.label]),
)

function getEventLabel(event: string) {
  return eventLabelMap[event] || event
}

const logs = [
  { label: '所有等级', value: '' },
  { label: '普通', value: 'info' },
  { label: '警告', value: 'warn' },
]

const displayName = computed(() => {
  const account = accountStore.currentAccount

  // Try to use nickname from status (game server)
  const gameName = status.value?.status?.name
  if (gameName) {
    // 如果有备注，显示为“昵称（备注）”
    if (account?.name && account.name !== gameName) {
      return `${gameName} (${account.name})`
    }
    return gameName
  }

  // Check login status
  if (!status.value?.connection?.connected) {
    if (account) {
      // 如果有备注和昵称，显示为“昵称（备注）”
      if (account.name && account.nick && account.name !== account.nick) {
        return `${account.nick} (${account.name})`
      }
      return account.name || account.nick || '未登录'
    }
    return '未登录'
  }

  // Fallback to account name (usually ID) or '未命名'
  if (account) {
    // 如果有备注和昵称，显示为“昵称（备注）”
    if (account.name && account.nick && account.name !== account.nick) {
      return `${account.nick} (${account.name})`
    }
    return account.name || account.nick || '未命名'
  }
  return '未命名'
})

// Fertilizer & Collection
const fertilizerNormal = computed(() => dashboardItems.value.find((i: any) => Number(i.id) === 1011))
const fertilizerOrganic = computed(() => dashboardItems.value.find((i: any) => Number(i.id) === 1012))
// 图鉴等级（对应 origin 的作物图鉴 / 超变图鉴）
const illustratedLevels = computed(() => ({
  crop: Number(illustratedStore.data?.crop?.level) || 0,
  mutant: Number(illustratedStore.data?.mutant?.level) || 0,
}))

function formatBucketTime(item: any) {
  if (!item)
    return '0h'
  if (item.hoursText)
    return `${formatAssetAmount(Number(item.hoursText.replace('小时', '')))}h`
  const count = Number(item.count || 0)
  return `${formatAssetAmount(count / 3600)}h`
}

// Next Check Countdown：农场 / 好友任务 两环倒计时。
// sl 后端将帮助/偷菜统一为一个好友任务循环（helpRemainSec === stealRemainSec），合并为一环。
// 环形进度以「服务端剩余秒数 + 收到时间戳」为锚点本地推算，每 250ms 平滑刷新。
// 旧实现里本地每秒递减与服务端广播重置同时生效，服务端 Math.ceil 在秒边界的
// ±1 抖动会把本地值向上顶回，导致环形在倒计时未结束时提前"复位"。
const nextFarmCheck = ref('--:--:--')
const nextFriendCheck = ref('--:--:--')
const farmRemainNow = ref(0)
const friendRemainNow = ref(0)
const farmCountdownTotal = ref(1)
const friendCountdownTotal = ref(1)
let farmAnchor: { remain: number, at: number } | null = null
let friendAnchor: { remain: number, at: number } | null = null
let farmQuiet = false
let friendQuiet = false

function anchoredRemain(anchor: { remain: number, at: number } | null): number {
  if (!anchor || anchor.remain <= 0)
    return 0
  return Math.max(0, anchor.remain - (Date.now() - anchor.at) / 1000)
}

// 新周期判定：服务端剩余显著高于本地推算值才刷新环的总量；
// 1 秒以内的 ceil 抖动视为同一周期，避免环的"满格值"被中途改小。
function syncCountdownTotal(total: typeof farmCountdownTotal, remain: number, previousRemain: number) {
  if (total.value <= 1 || remain > previousRemain + 1)
    total.value = Math.max(1, remain)
}

function getCountdownProgress(remain: number, total: number) {
  return Math.max(0, Math.min(100, (remain / Math.max(1, total)) * 100))
}

function getCountdownRingStyle(remain: number, total: typeof farmCountdownTotal | number, color: string) {
  const progress = getCountdownProgress(remain, Number(total))
  return {
    background: `conic-gradient(${color} ${progress}%, color-mix(in srgb, ${color} 14%, transparent) 0)`,
  }
}

function updateCountdowns() {
  if (!isOnline.value) {
    nextFarmCheck.value = '--'
    nextFriendCheck.value = '--'
    farmRemainNow.value = 0
    friendRemainNow.value = 0
    return
  }
  farmRemainNow.value = anchoredRemain(farmAnchor)
  friendRemainNow.value = anchoredRemain(friendAnchor)
  if (farmQuiet) {
    nextFarmCheck.value = '静默中'
  }
  else {
    nextFarmCheck.value = farmRemainNow.value > 0
      ? formatDuration(Math.ceil(farmRemainNow.value))
      : '巡查中...'
  }
  if (friendQuiet) {
    nextFriendCheck.value = '静默中'
  }
  else {
    nextFriendCheck.value = friendRemainNow.value > 0
      ? formatDuration(Math.ceil(friendRemainNow.value))
      : '巡查中...'
  }
}

watch(() => status.value?.nextChecks, (nextChecks) => {
  if (nextChecks) {
    const farmRemainSec = nextChecks.farmRemainSec || 0
    // 好友任务：帮助/偷菜在 sl 中共用同一个循环，统一取 friendRemainSec。
    const friendRemainSec = nextChecks.friendRemainSec ?? nextChecks.helpRemainSec ?? nextChecks.stealRemainSec ?? 0
    syncCountdownTotal(farmCountdownTotal, farmRemainSec, anchoredRemain(farmAnchor))
    syncCountdownTotal(friendCountdownTotal, friendRemainSec, anchoredRemain(friendAnchor))
    farmAnchor = { remain: farmRemainSec, at: Date.now() }
    friendAnchor = { remain: friendRemainSec, at: Date.now() }
    farmQuiet = !!nextChecks.farmQuiet
    friendQuiet = nextChecks.friendQuiet ?? nextChecks.helpQuiet ?? nextChecks.stealQuiet ?? false
    updateCountdowns() // Update immediately
  }
}, { immediate: true })

function formatDuration(seconds: number) {
  if (seconds <= 0)
    return '00:00:00'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  const pad = (n: number) => n.toString().padStart(2, '0')

  if (d > 0)
    return `${d}天 ${pad(h)}:${pad(m)}:${pad(s)}`
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

function formatLogTime(timeStr: string) {
  // 传入形如「2024/5/20 12时34分56秒」的日志时间，仅保留时分秒部分。
  // 注意：注释里不要写 hh:mm:ss 样式的冒号字面量，否则会被 UnoCSS attributify 误提取为无效 CSS。
  if (!timeStr)
    return ''
  const parts = timeStr.split(' ')
  return parts.length > 1 ? parts[1] : timeStr
}

// 今日统计的操作元数据：只保留实际展示的 4 项动作计数。
type OperationKey = 'harvest' | 'fertilize' | 'plant' | 'steal'

const OP_META: Record<OperationKey, { label: string, icon: string, color: string }> = {
  harvest: { label: '收获', icon: 'i-carbon-crop-growth', color: 'text-green-500' },
  fertilize: { label: '施肥', icon: 'i-carbon-chemistry', color: 'text-emerald-500' },
  plant: { label: '种植', icon: 'i-carbon-tree', color: 'text-lime-500' },
  steal: { label: '偷菜', icon: 'i-carbon-run', color: 'text-orange-500' },
}

// 后端只统计这 4 项，这里按固定顺序取值，保证格子布局稳定。
const filteredOperations = computed(() => {
  const ops = status.value?.operations || {}
  const result = {} as Record<OperationKey, number>
  for (const key of Object.keys(OP_META) as OperationKey[]) {
    result[key] = Number(ops[key]) || 0
  }
  return result
})

function getOpName(key: string | number) {
  return OP_META[String(key) as OperationKey].label
}

function getOpIcon(key: string | number) {
  return OP_META[String(key) as OperationKey].icon
}

function getOpColor(key: string | number) {
  return OP_META[String(key) as OperationKey].color
}

const platformLabel = computed(() => getPlatformLabel(accountStore.currentAccount?.platform))
const accountAvatar = computed(() => {
  const account = accountStore.currentAccount
  if (!account)
    return ''
  const live = String(status.value?.accountId || '') === String(account.id || '')
    ? String(status.value?.status?.avatarUrl || '').trim()
    : ''
  return live || String(account.avatar || '').trim()
})
const failedAccountAvatar = ref('')

watch(accountAvatar, () => {
  failedAccountAvatar.value = ''
})

function handleAccountAvatarError(event: Event) {
  failedAccountAvatar.value = (event.currentTarget as HTMLImageElement | null)?.getAttribute('src') || ''
}

function getExpPercent(p: any) {
  if (!p || !p.needed)
    return 0
  return Math.min(100, Math.max(0, (p.current / p.needed) * 100))
}

// 概览页资产：统一用紧凑写法展示，悬停时显示完整数值。
const assetBalances = computed(() => ({
  gold: Number(status.value?.status?.gold) || 0,
  coupon: Number(status.value?.status?.coupon) || 0,
  goldBean: Number(status.value?.status?.goldBean) || 0,
  diamond: Number(diamondBalance.value) || 0,
}))

function formatAssetAmount(value: unknown) {
  const amount = Number(value)
  if (!Number.isFinite(amount))
    return '0'
  return Math.max(0, Math.round(amount * 10) / 10).toLocaleString('zh-CN', { maximumFractionDigits: 1 })
}

async function refreshBag(force = false) {
  if (!currentAccountId.value || !isOnline.value)
    return

  const now = Date.now()
  if (!force && now - lastBagFetchAt.value < 2500)
    return
  lastBagFetchAt.value = now
  await bagStore.fetchBag(currentAccountId.value)
}

async function refreshDiamond() {
  if (!currentAccountId.value || !isOnline.value)
    return
  await statusStore.fetchDiamond(currentAccountId.value)
}

async function refreshIllustrated() {
  if (!currentAccountId.value || !isOnline.value)
    return
  await illustratedStore.fetch(currentAccountId.value)
}

async function refresh(forceReloadLogs = false) {
  if (currentAccountId.value) {
    const acc = currentAccount.value
    if (!acc)
      return

    // 首次加载、断线兜底时走 HTTP；连接正常时优先走 WS 实时推送
    if (!realtimeConnected.value) {
      await statusStore.fetchStatus(currentAccountId.value)
    }

    if (forceReloadLogs || hasActiveLogFilter.value || !realtimeConnected.value) {
      await statusStore.fetchLogs(currentAccountId.value, {
        module: filter.module || undefined,
        event: filter.event || undefined,
        keyword: filter.keyword || undefined,
        isWarn: filter.isWarn === 'warn' ? true : filter.isWarn === 'info' ? false : undefined,
      })
    }

    // 仅在账号已运行且连接就绪后拉背包，避免启动阶段触发500
    await refreshBag()
  }
}

function onLogFilterChange() {
  refresh(true)
}

function onLogSearchTrigger() {
  refresh(true)
}

// 今日统计按金币、点券顺序展示今日累计变化（净变化：收入 − 支出，支出为负数，跨天自动清零，账号重启不清零）。
const sessionCurrencyGains = computed(() => [
  {
    key: 'gold',
    label: '金币',
    icon: '/game-config/resource-icons/gold.png',
    value: Number(status.value?.sessionGoldGained) || 0,
  },
  {
    key: 'coupon',
    label: '点券',
    icon: '/game-config/resource-icons/coupon.png',
    value: Number(status.value?.sessionCouponGained) || 0,
  },
])

watch(currentAccountId, async () => {
  diamondBalance.value = 0
  illustratedStore.reset()
  await refresh()
  await refreshDiamond()
  await refreshIllustrated()
  scrollToBottom()
})

// 概览没有刷新键：上线（含重新上线）时重读背包、钻石与图鉴，日志与状态由实时推送补齐
watch(isOnline, (connected) => {
  if (connected) {
    refreshBag(true)
    refreshDiamond()
    refreshIllustrated()
  }
})

function operationsEqual(next: Record<string, unknown> | null | undefined, prev: Record<string, unknown> | null | undefined) {
  const nextOperations = next || {}
  const prevOperations = prev || {}
  const nextKeys = Object.keys(nextOperations)
  const prevKeys = Object.keys(prevOperations)
  return nextKeys.length === prevKeys.length && nextKeys.every(key => nextOperations[key] === prevOperations[key])
}

watch(() => status.value?.operations, (next, prev) => {
  if (!realtimeConnected.value || operationsEqual(next, prev))
    return
  refreshBag()
})

watch(hasActiveLogFilter, (enabled) => {
  statusStore.setRealtimeLogsEnabled(!enabled)
  refresh()
})

function onLogScroll(e: Event) {
  const el = e.target as HTMLElement
  if (!el)
    return
  const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
  autoScroll.value = isNearBottom
}

async function clearLogs() {
  if (!currentAccountId.value)
    return
  clearingLogs.value = true
  try {
    const { data } = await api.delete('/api/logs')
    if (data?.ok) {
      toastStore.success('日志已清空')
      await refresh(true)
    }
    else {
      toastStore.error(`清空失败: ${getApiErrorMessage(data, '未知错误')}`)
    }
  }
  catch (e: any) {
    const msg = getApiErrorMessage(e, '请求失败')
    toastStore.error(`清空失败: ${msg}`)
  }
  finally {
    clearingLogs.value = false
  }
}

let logScrollFrame: number | undefined

function scheduleLogScroll(force = false) {
  nextTick(() => {
    if (!logContainer.value || (!force && !autoScroll.value) || logScrollFrame !== undefined)
      return
    logScrollFrame = window.requestAnimationFrame(() => {
      if (logContainer.value)
        logContainer.value.scrollTop = logContainer.value.scrollHeight
      logScrollFrame = undefined
    })
  })
}

watch(allLogs, () => {
  scheduleLogScroll()
})

function scrollToBottom() {
  scheduleLogScroll(true)
}

onMounted(async () => {
  statusStore.setRealtimeLogsEnabled(!hasActiveLogFilter.value)
  await refresh()
  await refreshDiamond()
  await refreshIllustrated()
  scrollToBottom()
})

onBeforeUnmount(() => {
  if (logScrollFrame !== undefined)
    window.cancelAnimationFrame(logScrollFrame)
})

// Auto refresh fallback every 10s (WS 断开或筛选条件启用时会回退 HTTP)
useIntervalFn(refresh, 10000)
// Countdown ring: 每 250ms 平滑刷新（锚点式推算，见上方 updateCountdowns 注释）
useIntervalFn(updateCountdowns, 250)
</script>

<template>
  <div class="dashboard-page page-stack flex flex-col">
    <!-- Overview -->
    <div class="overview-grid">
      <!-- 账号：身份、在线状态与等级进度 -->
      <section class="ov-card ov-account">
        <div class="ov-account__head">
          <div class="ov-avatar">
            <img v-if="accountAvatar && accountAvatar !== failedAccountAvatar" :key="accountAvatar" :src="accountAvatar" alt="" @error="handleAccountAvatarError">
            <span v-else class="i-carbon-user-avatar" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="ov-account__name-row">
              <strong class="ov-account__name" :title="displayName">{{ displayName }}</strong>
              <span class="ov-level">Lv.{{ status?.status?.level || 0 }}</span>
            </div>
            <div class="ov-presence">
              <span v-if="isOnline || isOffline" class="ov-presence__state" :class="isOnline ? 'is-online' : 'is-offline'">{{ isOnline ? '在线' : '离线' }}</span>
              <span v-if="platformLabel" class="ov-presence__item">{{ platformLabel }}</span>
            </div>
          </div>
        </div>

        <div class="ov-exp">
          <div class="ov-exp__labels">
            <span>经验</span>
            <span class="ov-exp__value">
              {{ formatNumber(status?.levelProgress?.current) }} / {{ status?.levelProgress?.needed ? formatNumber(status.levelProgress.needed) : '?' }}
              <b>{{ Math.floor(getExpPercent(status?.levelProgress)) }}%</b>
            </span>
          </div>
          <div class="ov-exp__track">
            <div class="ov-exp__bar" :style="{ width: `${getExpPercent(status?.levelProgress)}%` }" />
          </div>
        </div>
        <div
          v-if="showPlantExp"
          class="ov-plant-exp"
          title="按当前土地作物和经验加成估算，收获后获得"
        >
          <span>种植经验：</span>
          <b>{{ formatNumber(plantExpValue) }}</b>
        </div>
      </section>

      <!-- 资产与库存：四列两行展示，避免资源项挤在单行 -->
      <section class="ov-card ov-assets">
        <div class="ov-assets__grid">
          <div class="ov-asset">
            <span class="ov-asset__label">
              <img src="/game-config/resource-icons/gold.png" alt="金币">金币
            </span>
            <strong class="ov-asset__value text-gold" :title="`金币 ${formatNumber(assetBalances.gold)}`">
              {{ formatCompactAmount(assetBalances.gold) }}
            </strong>
          </div>
          <div class="ov-asset">
            <span class="ov-asset__label">
              <img src="/game-config/resource-icons/coupon.png" alt="点券">点券
            </span>
            <strong class="ov-asset__value text-coupon" :title="`点券 ${formatNumber(assetBalances.coupon)}`">
              {{ formatCompactAmount(assetBalances.coupon) }}
            </strong>
          </div>
          <div class="ov-asset">
            <span class="ov-asset__label">
              <img src="/game-config/resource-icons/gold-bean.png" alt="金豆豆">金豆豆
            </span>
            <strong class="ov-asset__value text-bean" :title="`金豆豆 ${formatNumber(assetBalances.goldBean)}`">
              {{ formatCompactAmount(assetBalances.goldBean) }}
            </strong>
          </div>
          <div class="ov-asset">
            <span class="ov-asset__label">
              <img src="/game-config/resource-icons/diamond.png" alt="钻石">钻石
            </span>
            <strong class="ov-asset__value text-diamond" :title="`钻石 ${formatNumber(assetBalances.diamond)}`">
              {{ formatCompactAmount(assetBalances.diamond) }}
            </strong>
          </div>
          <div class="ov-asset">
            <span class="ov-asset__label">
              <img src="/game-config/resource-icons/fertilizer-normal.png" alt="普通化肥">普通化肥
            </span>
            <strong class="ov-asset__value">{{ formatBucketTime(fertilizerNormal) }}</strong>
          </div>
          <div class="ov-asset">
            <span class="ov-asset__label">
              <img src="/game-config/resource-icons/fertilizer-organic.png" alt="有机化肥">有机化肥
            </span>
            <strong class="ov-asset__value">{{ formatBucketTime(fertilizerOrganic) }}</strong>
          </div>
          <div class="ov-asset">
            <span class="ov-asset__label">
              <img src="/game-config/resource-icons/illustrated-crop.png" alt="作物图鉴">作物图鉴
            </span>
            <strong class="ov-asset__value">Lv.{{ illustratedLevels.crop }}</strong>
          </div>
          <div class="ov-asset">
            <span class="ov-asset__label">
              <img src="/game-config/resource-icons/illustrated-mutant.png" alt="超变图鉴">超变图鉴
            </span>
            <strong class="ov-asset__value">Lv.{{ illustratedLevels.mutant }}</strong>
          </div>
        </div>
      </section>
    </div>

    <!-- 下次巡查倒计时 + 今日统计（并排展示，位于日志之上） -->
    <div class="overview-followup">
      <!-- Next Checks：两环倒计时（sl 的帮助/偷菜共用同一个好友任务循环，合并为一环） -->
      <div class="overview-followup__countdown flex flex-col page-card-surface rounded-2xl bg-white p-3 shadow-md">
        <h3 class="mb-2 flex items-center gap-2 text-lg font-display font-medium">
          <span class="i-carbon-hourglass" /> <span>下次巡查倒计时</span>
        </h3>
        <div class="grid grid-cols-2 flex-1 items-center gap-2">
          <div class="ov-countdown">
            <div
              class="ov-countdown__ring"
              :style="getCountdownRingStyle(farmRemainNow, farmCountdownTotal, '#22c55e')"
            >
              <div class="ov-countdown__inner">
                <span class="i-carbon-sprout text-xl text-green-500" />
                <span class="ov-countdown__name">农场</span>
              </div>
            </div>
            <div class="ov-countdown__value" :title="nextFarmCheck">
              {{ nextFarmCheck }}
            </div>
          </div>
          <div class="ov-countdown">
            <div
              class="ov-countdown__ring"
              :style="getCountdownRingStyle(friendRemainNow, friendCountdownTotal, '#3b82f6')"
            >
              <div class="ov-countdown__inner">
                <span class="i-carbon-user-multiple text-xl text-blue-500" />
                <span class="ov-countdown__name">好友</span>
              </div>
            </div>
            <div class="ov-countdown__value" :title="nextFriendCheck">
              {{ nextFriendCheck }}
            </div>
          </div>
        </div>
      </div>

      <!-- Operations Grid：今日统计，项目对齐 origin -->
      <div class="page-card-surface rounded-2xl bg-white px-3 pt-3 shadow-md" :class="isOffline ? 'pb-0' : 'pb-3'">
        <h3 class="flex items-center gap-2 text-lg font-display font-medium" :class="{ 'mb-2': !isOffline }">
          <span class="i-carbon-chart-column" /> <span>今日统计</span>
        </h3>
        <div v-if="isOffline" class="flex justify-center py-[12px]">
          <RefreshButton
            label="重新加载账号信息"
            :loading="accountStore.bulkKind === 'start'"
            :disabled="accountStore.bulkRunning"
            @click="accountStore.startAllAccounts()"
          />
        </div>
        <div v-else class="grid grid-cols-3 gap-3">
          <div
            v-for="gain in sessionCurrencyGains"
            :key="gain.key"
            class="ov-stat-tile"
          >
            <div class="min-w-0 flex items-center gap-1.5">
              <img class="size-5 shrink-0 object-contain" :src="gain.icon" alt="">
              <div class="truncate text-xs text-gray-500" :title="gain.label">
                {{ gain.label }}
              </div>
            </div>
            <div
              class="text-sm"
              :class="gain.value < 0 ? 'text-red-500' : ''"
              :title="`${gain.label} ${formatNumber(gain.value)}`"
            >
              {{ formatCompactAmount(gain.value) }}
            </div>
          </div>
          <div
            v-for="(val, key) in filteredOperations"
            :key="key"
            class="ov-stat-tile"
          >
            <div class="min-w-0 flex items-center gap-1.5">
              <span class="select-none text-base" :class="[getOpIcon(key), getOpColor(key)]" />
              <div class="truncate text-xs text-gray-500" :title="getOpName(key)">
                {{ getOpName(key) }}
              </div>
            </div>
            <div class="text-sm">
              {{ val }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 运行日志（页面最下方，整宽展示） -->
    <div class="dashboard-log-card flex flex-col page-card-surface rounded-2xl bg-white p-3 shadow-md">
      <div class="mb-4 flex flex-row items-center justify-between gap-3">
        <h3 class="flex shrink-0 items-center gap-2 whitespace-nowrap text-lg font-bold">
          <span class="i-carbon-document" /> <span>运行日志</span>
        </h3>

        <div class="log-filters">
          <BaseSelect
            v-model="filter.module"
            :options="modules"
            fit-width
            @change="onLogFilterChange"
          />

          <BaseSelect
            v-model="filter.event"
            :options="events"
            fit-width
            @change="onLogFilterChange"
          />

          <BaseSelect
            v-model="filter.isWarn"
            :options="logs"
            fit-width
            @change="onLogFilterChange"
          />

          <BaseInput
            v-model="filter.keyword"
            type="search"
            placeholder="关键词"
            clearable
            @keyup.enter="onLogSearchTrigger"
            @clear="onLogSearchTrigger"
          />

          <div class="log-filters__buttons">
            <BaseButton
              variant="primary"
              class="log-filters__icon"
              title="搜索日志"
              aria-label="搜索日志"
              @click="onLogSearchTrigger"
            >
              <span class="i-carbon-search" />
            </BaseButton>

            <BaseButton
              variant="secondary"
              class="log-filters__icon"
              title="清空日志"
              aria-label="清空日志"
              :loading="clearingLogs"
              @click="clearLogs"
            >
              <template #icon>
                <span class="i-carbon-trash-can" />
              </template>
            </BaseButton>
          </div>
        </div>
      </div>

      <div ref="logContainer" class="log-list flex-1 overflow-y-auto" @scroll="onLogScroll">
        <div v-if="!allLogs.length" class="py-8 text-center text-gray-400">
          暂无日志
        </div>
        <div
          v-for="group in logGroups"
          :key="group.log.ts + group.key"
          class="log-row"
          :class="`log-row--${group.level}`"
        >
          <span class="log-row__time">
            {{ formatLogTime(group.log.time) }}
          </span>
          <span class="log-row__tag">{{ group.log.tag }}</span>
          <span class="log-row__body">
            <span v-if="group.log.meta?.event" class="log-row__event">{{ getEventLabel(group.log.meta.event) }}</span>
            <span class="log-row__msg">{{ group.log.msg }}</span>
            <span v-if="group.count > 1" class="log-row__repeat" :title="`${formatLogTime(group.firstTime)} 起重复 ${group.count} 次`">
              ×{{ group.count }} · {{ formatLogTime(group.firstTime) }} 起
            </span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard-log-card {
  /* 作为页面 flex 子项：flex-basis 0 吃剩余高度（宽屏时撑满、日志列表内滚）。
     不设 min-height: 0，保留自动最小高度（auto = min-content），避免窄屏下卡片
     收缩到内容高度以下、筛选器/按钮溢出白底；日志列表的 contain: size（见 .log-list）
     使日志内容不参与该最小高度计算，卡片高度不足时由页面整体滚动。 */
  flex: 1 1 0;
}

.dashboard-page,
.overview-followup {
  gap: min(var(--page-pad), 12px);
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: min(var(--page-pad), 12px);
}

.overview-grid {
  /* 个人信息卡片占主页面宽度 35%，右侧资产卡片占 65% */
  grid-template-columns: 35% minmax(0, 1fr);
}

.overview-followup {
  /* 与 .overview-grid 控制逻辑一致：左侧卡片占 35%，右侧（今日统计）占 65% */
  display: grid;
  grid-template-columns: 35% minmax(0, 1fr);
}

.overview-followup__countdown {
  min-width: 0;
}

/* 概览四个卡片左上角标题：统一字体族、字号与字重（较原值 18px 减小） */
.overview-followup h3,
.dashboard-log-card h3 {
  font-family: "Microsoft YaHei", "PingFang SC", ui-sans-serif, system-ui, sans-serif;
  font-size: 15px;
  font-weight: var(--fw-600);
}

.ov-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-card);
  background: var(--ui-surface);
  box-shadow:
    inset 0 1px 0 var(--glass-highlight),
    var(--ui-shadow-sm);
}

/* 账号 */
.ov-account__head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.ov-avatar {
  width: 46px;
  height: 46px;
  display: grid;
  flex: none;
  place-items: center;
  border-radius: 16px;
  color: var(--ui-subtle);
  background: var(--ui-surface-soft);
  font-size: 24px;
}

.ov-avatar img {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
}

.ov-account__name-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.ov-account__name {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-ink);
  font-family: "Microsoft YaHei", "PingFang SC", ui-sans-serif, system-ui, sans-serif;
  font-size: 15px;
  font-weight: var(--fw-600);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ov-level {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  color: var(--ui-blue);
  background: var(--ui-blue-soft);
  font-size: 12px;
  font-weight: var(--fw-700);
  line-height: 16px;
  font-variant-numeric: tabular-nums;
}

.ov-presence {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  margin-top: 5px;
  color: var(--ui-muted);
  font-size: 12px;
}

.ov-presence__state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 7px 0 6px;
  border-radius: 999px;
  font-weight: var(--fw-600);
  line-height: 16px;
}

.ov-presence__state::before {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  content: '';
}

.ov-presence__state.is-online {
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

.ov-presence__state.is-offline {
  color: var(--ui-muted);
  background: var(--ui-surface-soft);
}

.ov-presence__item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-variant-numeric: tabular-nums;
}

.ov-exp__labels {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 7px;
  color: var(--ui-muted);
  font-size: 12px;
}

.ov-exp__value {
  font-variant-numeric: tabular-nums;
}

.ov-exp__value b {
  margin-left: 6px;
  color: var(--ui-ink);
  font-weight: var(--fw-700);
}

.ov-exp__track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--ui-surface-soft);
}

.ov-exp__bar {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #5c9fd0, #4b86c5);
  transition: width 0.5s ease;
}

.ov-plant-exp {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ui-muted);
  font-size: 12px;
}

.ov-plant-exp b {
  color: var(--ui-ink);
  font-weight: var(--fw-700);
  font-variant-numeric: tabular-nums;
}

/* 资产与库存：四列两行 */
.ov-assets {
  --ov-asset-gap: 12px;
  justify-content: center;
  /* 资源格子到外框 12px，与其余卡片的内边距一致 */
  padding: 12px;
}

.ov-assets__grid {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-auto-rows: minmax(0, 1fr);
  gap: var(--ov-asset-gap);
}

.ov-asset {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  /* 格子内边距固定 8px，不随卡片间距变量放大，保持紧凑 */
  padding: 8px;
  border-radius: 12px;
  background: var(--ui-surface-soft);
}

.ov-asset__label {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: var(--ui-muted);
  font-size: 12px;
  white-space: nowrap;
}

.ov-asset__label img {
  flex: none;
  width: 18px;
  height: 18px;
  object-fit: contain;
}

.ov-asset__value {
  overflow: hidden;
  color: var(--ui-ink);
  font-size: 14px;
  font-weight: var(--fw-400);
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ov-asset__value.text-gold {
  color: #b45309;
}

.ov-asset__value.text-coupon {
  color: #10b981;
}

.ov-asset__value.text-bean {
  color: #f59e0b;
}

.ov-asset__value.text-diamond {
  color: #0891b2;
}

/* 倒计时环（仿 origin） */
.ov-countdown {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.ov-countdown__ring {
  display: grid;
  height: 52px;
  width: 52px;
  place-items: center;
  padding: 4px;
  border-radius: 999px;
}

.ov-countdown__inner {
  display: flex;
  height: 100%;
  width: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--ui-surface-strong, #fff);
}

.ov-countdown__name {
  margin-top: 2px;
  color: var(--ui-muted);
  font-size: 12px;
  line-height: 1.2;
}

.ov-countdown__value {
  width: 100%;
  overflow: hidden;
  margin-top: 4px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 今日统计格（仿 origin） */
.ov-stat-tile {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  border-radius: 12px;
  background: var(--ui-surface-soft);
  padding: 6px 12px;
  transition: background 0.2s ease;
}

.ov-stat-tile:hover {
  background: color-mix(in srgb, var(--ui-primary) 6%, var(--ui-surface-soft));
}

.log-filters {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.log-filters__buttons {
  display: flex;
  grid-column: 1 / -1;
  justify-content: flex-end;
  gap: 8px;
}

.log-filters__icon {
  width: 38px;
  min-width: 38px;
  height: 38px;
  padding: 0 !important;
}

.log-filters {
  grid-template-columns: repeat(4, max-content) auto;
  align-items: center;
}

.log-filters__buttons {
  grid-column: auto;
}

.log-list {
  /* contain: size：日志行内容不参与卡片的内在高度计算，否则卡片最小高度会被
     全部日志内容撑开（页面变成几千 px 长、内滚也失效）。给 120px 下限保证
     短视口下日志区始终可见，剩余高度由 flex 分配、超出部分列表内部滚动。 */
  contain: size;
  min-height: 120px;
  padding: 6px;
  border-radius: var(--ui-radius-control);
  background: var(--ui-surface-soft);
  font-size: 13px;
  line-height: 1.55;
}

.log-row {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: baseline;
  gap: 10px;
  padding: 5px 8px 5px 10px;
  border-left: 3px solid transparent;
  border-radius: 6px;
  content-visibility: auto;
  contain-intrinsic-size: auto 28px;
}

.log-row + .log-row {
  margin-top: 2px;
}

.log-row__time {
  color: var(--ui-subtle);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  white-space: nowrap;
  user-select: none;
}

.log-row__tag {
  min-width: 2.5em;
  color: var(--ui-muted);
  font-size: 12px;
  font-weight: var(--fw-600);
  white-space: nowrap;
}

.log-row__body {
  min-width: 0;
  color: var(--ui-ink);
  overflow-wrap: anywhere;
}

.log-row__event {
  margin-right: 6px;
  color: var(--ui-muted);
  font-size: 12px;
}

.log-row__event::after {
  margin-left: 6px;
  color: var(--ui-subtle);
  content: '·';
}

.log-row__repeat {
  display: inline-block;
  margin-left: 8px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ui-surface-strong);
  color: var(--ui-muted);
  font-size: 11px;
  white-space: nowrap;
}

.log-row--success {
  border-left-color: var(--ui-primary);
}

.log-row--warn {
  border-left-color: var(--ui-warning);
  background: color-mix(in srgb, var(--ui-warning-soft) 70%, transparent);
}

.log-row--warn .log-row__tag {
  color: var(--ui-warning);
}

.log-row--error {
  border-left-color: var(--ui-danger);
  background: color-mix(in srgb, var(--ui-danger-soft) 80%, transparent);
}

.log-row--error .log-row__tag,
.log-row--error .log-row__msg {
  color: var(--ui-danger);
}
</style>
