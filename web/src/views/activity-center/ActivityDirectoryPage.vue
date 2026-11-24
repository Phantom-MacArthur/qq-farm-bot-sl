<script setup lang="ts">
import type { ActivityDirectoryItemDto } from '@/stores/activity-center'
import { NTab } from 'naive-ui/es/tabs'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api'
import { activityHasGameplay } from '@/components/activity/gameplays'
import PageTabs from '@/components/PageTabs.vue'
import OfflineState from '@/components/ui/OfflineState.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { useReconnectRefresh } from '@/composables/useReconnectRefresh'
import { useAccountStore } from '@/stores/account'
import { normalizeActivityDirectory, useActivityCenterStore } from '@/stores/activity-center'
import PetMascot from './PetMascot.vue'
import { useActivityClock } from './useActivityClock'

type ActivityViewTab = 'active' | 'past'
const props = withDefaults(defineProps<{ offline: boolean, space?: 'farm' | 'ranch' }>(), { space: 'farm' })
const emit = defineEmits<{
  back: []
  open: [activity: ActivityDirectoryItemDto]
}>()
const VIEW_TABS: ActivityViewTab[] = ['active', 'past']
const route = useRoute()
const router = useRouter()
const currentTab = computed<ActivityViewTab>({
  get: () => {
    const tab = route.query.tab as ActivityViewTab | undefined
    return tab && VIEW_TABS.includes(tab) ? tab : 'active'
  },
  set: tab => void router.replace({ query: { ...route.query, tab: tab === 'active' ? undefined : tab } }),
})

const accountStore = useAccountStore()
const activityStore = useActivityCenterStore()
const { currentAccountId } = storeToRefs(accountStore)
const { activities: farmActivities, season, shop, solarTerms, constellation, qixi, qingMei, charity, weather, loading: farmLoading, error: farmError, loadedAccountId: farmLoadedAccountId, serverClockOffset: farmClockOffset } = storeToRefs(activityStore)
const { serverNow: farmNow } = useActivityClock()
const ranchDirectory = ref<ActivityDirectoryItemDto[]>([])
const ranchLoading = ref(false)
const ranchError = ref('')
const ranchLoadedAccountId = ref('')
const ranchClockOffset = ref(0)
let directorySequence = 0
const activities = computed(() => props.space === 'ranch' ? ranchDirectory.value : farmActivities.value)
const loading = computed(() => props.space === 'ranch' ? ranchLoading.value : farmLoading.value)
const error = computed(() => props.space === 'ranch' ? ranchError.value : farmError.value)
const loadedAccountId = computed(() => props.space === 'ranch' ? ranchLoadedAccountId.value : farmLoadedAccountId.value)
const serverNow = computed(() => props.space === 'ranch' ? farmNow.value - farmClockOffset.value + ranchClockOffset.value : farmNow.value)

type ActivityStatus = 'active' | 'upcoming' | 'ended'

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const accountDataLoaded = computed(() => !!currentAccountId.value && loadedAccountId.value === String(currentAccountId.value))
const stellarDetailsAvailable = computed(() => !!(season.value || shop.value || constellation.value || solarTerms.value))
const displayActivities = computed<ActivityDirectoryItemDto[]>(() => {
  const entries: ActivityDirectoryItemDto[] = activities.value.length > 0
    ? [...activities.value]
    : props.space === 'farm' && stellarDetailsAvailable.value
      ? [{
        id: season.value?.pass?.activityId || season.value?.id || 'stellar',
        activityIds: [season.value?.pass?.activityId || season.value?.id || 'stellar'],
        name: season.value?.title || '千星游记',
        startTime: season.value?.startTime || null,
        endTime: season.value?.endTime || null,
        gameplayKey: 'stellar',
        gameplayTargets: ['travel', 'constellation', 'shop', 'solar'],
        detailTarget: season.value?.pass ? 'travel' : constellation.value ? 'constellation' : shop.value ? 'shop' : 'solar',
      } satisfies ActivityDirectoryItemDto]
      : []

  const appendDetailEntry = (entry: ActivityDirectoryItemDto) => {
    if (props.space === 'farm' && !entries.some(item => item.activityIds.some(id => entry.activityIds.includes(id))))
      entries.push(entry)
  }
  if (qixi.value) {
    appendDetailEntry({
      id: qixi.value.groupId || qixi.value.activityId,
      activityIds: [qixi.value.groupId, qixi.value.bridgeActivityId, qixi.value.giftActivityId].filter(Boolean),
      name: qixi.value.title,
      startTime: qixi.value.startTime,
      endTime: qixi.value.endTime,
      gameplayKey: 'qixi',
      gameplayTargets: ['qixi'],
      detailTarget: 'qixi',
    })
  }
  if (qingMei.value) {
    appendDetailEntry({
      id: qingMei.value.activityId,
      activityIds: [qingMei.value.dailyActivityId, qingMei.value.activityId].filter(Boolean),
      name: qingMei.value.title,
      startTime: qingMei.value.startTime,
      endTime: qingMei.value.endTime,
      gameplayKey: 'qingmei',
      gameplayTargets: ['qingmei'],
      detailTarget: 'qingmei',
    })
  }
  if (charity.value) {
    appendDetailEntry({
      id: charity.value.groupId || charity.value.activityId,
      activityIds: [charity.value.groupId, charity.value.activityId].filter(Boolean),
      name: charity.value.title,
      startTime: charity.value.startTime,
      endTime: charity.value.endTime,
      gameplayKey: 'charity',
      gameplayTargets: ['charity'],
      detailTarget: 'charity',
    })
  }
  if (weather.value) {
    appendDetailEntry({
      id: weather.value.groupId || weather.value.activityId,
      activityIds: [weather.value.groupId, weather.value.catalogActivityId, weather.value.taskActivityId, weather.value.researchActivityId].filter(Boolean),
      name: weather.value.title,
      startTime: weather.value.startTime,
      endTime: weather.value.endTime,
      gameplayKey: 'weather',
      gameplayTargets: ['weather'],
      detailTarget: 'weather',
    })
  }

  const statusRank: Record<ActivityStatus, number> = { active: 0, upcoming: 1, ended: 2 }
  return entries.sort((left, right) => {
    const leftStatus = activityStatus(left)
    const rightStatus = activityStatus(right)
    if (leftStatus !== rightStatus)
      return statusRank[leftStatus] - statusRank[rightStatus]
    if (leftStatus === 'ended')
      return (right.endTime || 0) - (left.endTime || 0)
    return (left.startTime || 0) - (right.startTime || 0)
  })
})
const hasActivities = computed(() => displayActivities.value.length > 0)

function accountId() {
  return String(currentAccountId.value || '')
}
async function load(force = false) {
  if (props.space === 'ranch') {
    if (props.offline) {
      directorySequence++
      ranchLoading.value = false
      return false
    }
    const id = accountId()
    const version = ++directorySequence
    if (ranchLoadedAccountId.value !== id)
      ranchDirectory.value = []
    ranchError.value = ''
    ranchLoading.value = !!id
    if (!id) {
      ranchLoadedAccountId.value = ''
      ranchLoading.value = false
      return false
    }
    try {
      const response = await api.get('/api/activity-center/ranch-activities', { headers: { 'x-account-id': id }, skipErrorToast: true } as any)
      if (version !== directorySequence || id !== accountId())
        return false
      if (!response.data?.ok)
        throw new Error(response.data?.error || '读取牧场活动失败')
      ranchDirectory.value = normalizeActivityDirectory(response.data.data.activities)
      ranchClockOffset.value = response.data.data.serverTime * 1000 - Date.now()
      ranchLoadedAccountId.value = id
      return true
    }
    catch (cause: any) {
      if (version === directorySequence && id === accountId())
        ranchError.value = cause?.message || '读取牧场活动失败'
      return false
    }
    finally {
      if (version === directorySequence && id === accountId())
        ranchLoading.value = false
    }
  }
  return force ? activityStore.refresh(accountId()) : activityStore.lazyLoad(accountId())
}

watch([currentAccountId, () => props.space, () => props.offline], () => {
  if (props.space === 'ranch')
    void load(true)
}, { immediate: true })
onUnmounted(() => directorySequence++)
function validActivityTime(value: unknown): number | null {
  const timestamp = Number(value)
  return Number.isFinite(timestamp) && Number.isFinite(new Date(timestamp).getTime()) ? timestamp : null
}
function activityStatus(activity: ActivityDirectoryItemDto): ActivityStatus {
  const startTime = validActivityTime(activity.startTime)
  const endTime = validActivityTime(activity.endTime)
  if (endTime !== null && serverNow.value >= endTime)
    return 'ended'
  if (startTime !== null && serverNow.value < startTime)
    return 'upcoming'
  return 'active'
}
function activityStatusLabel(activity: ActivityDirectoryItemDto) {
  return { active: '进行中', upcoming: '未开始', ended: '已结束' }[activityStatus(activity)]
}
function isNewbieActivity(activity: ActivityDirectoryItemDto) {
  return activity.activityIds.some(id => id === '2026092200' || id === '2026092201')
}
const LONG_TERM_MS = 365 * 24 * 60 * 60 * 1000
/**
 * 常驻条目：新手福利，或开放期超过一年且工具没有对应玩法的条目。
 * 目录里的日期只是全局开放期，不代表账号有资格，所以不和限时活动混排，也不显示“进行中”。
 */
function isStandingActivity(activity: ActivityDirectoryItemDto) {
  if (activityStatus(activity) === 'ended')
    return false
  if (isNewbieActivity(activity))
    return true
  const startTime = validActivityTime(activity.startTime)
  const endTime = validActivityTime(activity.endTime)
  return !activityHasGameplay(activity) && startTime !== null && endTime !== null && endTime - startTime > LONG_TERM_MS
}
const timedActivities = computed(() => displayActivities.value.filter(activity => !isStandingActivity(activity)))
const standingActivities = computed(() => displayActivities.value.filter(isStandingActivity))
/** 进行中与即将开始的限时活动用大卡片；已结束的折叠到往期列表。 */
const currentActivities = computed(() => timedActivities.value.filter(activity => activityStatus(activity) !== 'ended'))
interface PastActivityRow { key: string, name: string, activity: ActivityDirectoryItemDto }
/**
 * 往期活动：同名同时段的多个内部 ID（groupId 与 activityId）合并成一行。
 * 内部 ID 对用户无意义，不往外展示；顺序沿用目录排序：结束越晚越靠前。
 * 不再按月份分组，统一交给列表按行展示（与「宠物管理」的宠物列表一致）。
 */
const pastActivities = computed(() => {
  const rows = new Map<string, PastActivityRow>()
  for (const activity of timedActivities.value) {
    if (activityStatus(activity) !== 'ended')
      continue
    const name = activityDisplayName(activity)
    const key = `${name}|${activity.startTime ?? ''}|${activity.endTime ?? ''}`
    if (!rows.has(key))
      rows.set(key, { key, name, activity })
  }
  return [...rows.values()]
})
/**
 * 同名活动通常是同一玩法在不同时期复办。按“名称 + 起止时间”去重后统计期数，
 * 只统计当前目录里能看到的期次（包括进行中的那一期）。
 */
const editionCounts = computed(() => {
  const periods = new Map<string, Set<string>>()
  for (const activity of timedActivities.value) {
    const name = activityDisplayName(activity)
    const set = periods.get(name) || new Set<string>()
    set.add(`${activity.startTime ?? ''}|${activity.endTime ?? ''}`)
    periods.set(name, set)
  }
  return new Map([...periods].map(([name, set]) => [name, set.size]))
})
/** 进行中页签的卡片：限时活动在前，常驻条目紧随其后。 */
const activeCards = computed(() => [...currentActivities.value, ...standingActivities.value])
/** 标题栏计数：按当前页签切换口径，「进行中」统计页签内的活动数，「往期活动」统计已结束数。 */
const activitySummary = computed(() => currentTab.value === 'past'
  ? `已结束的活动：${pastActivities.value.length}`
  : `进行中的活动：${activeCards.value.length}`)
function activityDisplayName(activity: ActivityDirectoryItemDto) {
  return activity.gameplayKey === 'pet' ? '萌宠日记' : activity.name
}
function activityIconSrc(activity: ActivityDirectoryItemDto) {
  if (activity.gameplayKey === 'muge')
    return '/activity-assets/muge/icon.png'
  if (activity.activityIds.some(id => ['2026111800', '2026111801'].includes(id)))
    return '/activity-assets/friend-recall/icon.png'
  if (activity.gameplayKey === 'pet')
    return '/activity-assets/pet-diary/S3Open_dog_1.png'
  if (activity.gameplayKey === 'milk')
    return '/activity-assets/milk-tea/logo.png'
  if (activity.gameplayKey === 'wish' || activity.gameplayKey === 'happy')
    return `/activity-assets/autumn/${activity.gameplayKey}.png`
  return ''
}
function standingPeriod(activity: ActivityDirectoryItemDto) {
  const endTime = validActivityTime(activity.endTime)
  if (activityStatus(activity) === 'active' && (endTime === null || endTime - serverNow.value > LONG_TERM_MS))
    return '长期开放'
  return formatActivityPeriod(activity)
}
function activityCanOpen(activity: ActivityDirectoryItemDto) {
  return activityHasGameplay(activity) && activityStatus(activity) === 'active'
}
function formatActivityPeriod(activity: ActivityDirectoryItemDto) {
  const startTime = validActivityTime(activity.startTime)
  const endTime = validActivityTime(activity.endTime)
  const start = startTime === null ? '' : dateFormatter.format(startTime)
  const end = endTime === null ? '' : dateFormatter.format(endTime)
  if (start && end)
    return `${start} - ${end}`
  if (start)
    return `${start} 开始`
  if (end)
    return `${end} 结束`
  return '活动时间待定'
}
function openActivity(activity: ActivityDirectoryItemDto) {
  if (activityCanOpen(activity))
    emit('open', activity)
}
// 重新上线时按一次刷新键
useReconnectRefresh(() => load(true))
</script>

<template>
  <section class="activity-picker page-stack">
    <!-- 页签样式与「图鉴」一致：透明底、只保留文字与下划线。 -->
    <PageTabs v-model:value="currentTab">
      <NTab name="active">
        <span class="inline-flex items-center gap-2"><span class="i-carbon-play-filled-alt" />进行中</span>
      </NTab>
      <NTab name="past">
        <span class="inline-flex items-center gap-2"><span class="i-carbon-time" />往期活动</span>
      </NTab>
    </PageTabs>

    <!-- 标题栏与列表同在一个卡片内，外壳对齐「个人 → 农场」的 page-card-surface；
         卡片本身不设内边距，由各行自己带水平边距，分割线才能铺满整张卡。 -->
    <div class="activity-card panel-scroll-layout">
      <div class="activity-toolbar panel-titlebar panel-titlebar--flush margin-shell"><span class="margin-content">
        <span class="activity-toolbar__summary">{{ activitySummary }}</span>
        <RefreshButton
          title="刷新活动"
          :loading="loading"
          :disabled="!currentAccountId || offline"
          @click="load(true)"
        />
      </span></div>
      <div class="panel-scroll-body">
        <OfflineState v-if="offline" />
        <div v-else-if="!currentAccountId" class="picker-state">
        <div class="i-carbon-user-avatar" />
        <strong>请先选择账号</strong>
        <span>选择账号后查看当前活动</span>
      </div>
      <div v-else-if="loading && !accountDataLoaded" class="picker-state">
        <div class="activity-spinner picker-spinner" />
        <strong>正在加载活动</strong>
      </div>
      <div v-else-if="error && !hasActivities" class="picker-state">
        <div class="i-carbon-warning-alt" />
        <strong>活动加载失败</strong>
        <span>{{ error }}</span>
        <button type="button" :disabled="loading" @click="load(true)">
          重新加载
        </button>
      </div>
      <div v-else-if="accountDataLoaded && !loading && !hasActivities" class="picker-state empty-activities">
        <div class="i-carbon-calendar" />
        <strong>当前无活动</strong>
        <span>服务器暂未返回活动配置</span>
        <button type="button" @click="load(true)">
          刷新活动
        </button>
      </div>
      <div v-else class="picker-sections">
        <!-- 进行中：限时活动与常驻条目统一用卡片；常驻用橙黄描边区分。 -->
        <section v-if="currentTab === 'active'" class="picker-section" aria-label="进行中活动">
          <div v-if="activeCards.length" class="picker-list">
            <button
              v-for="activity in activeCards"
              :key="activity.id"
              type="button"
              class="activity-entry"
              :class="[
                `activity-entry--${activityStatus(activity)}`,
                {
                  'activity-entry--supported': activityCanOpen(activity),
                  'activity-entry--standing': isStandingActivity(activity),
                },
              ]"
              :disabled="!activityCanOpen(activity)"
              @click="openActivity(activity)"
            >
              <span class="activity-entry__topline">
                <span class="activity-entry__ident">
                  <span class="activity-entry__icon"><PetMascot v-if="activity.gameplayKey === 'pet'" stage="puppy" class="activity-entry__pet" /><img v-else-if="activityIconSrc(activity)" :src="activityIconSrc(activity)" alt="" width="36" height="36" style="object-fit: contain"><span v-else class="i-carbon-calendar" /></span>
                  <strong class="activity-entry__name">{{ activityDisplayName(activity) }}</strong>
                </span>
                <span class="activity-entry__status">{{ isStandingActivity(activity) ? '常驻' : activityStatusLabel(activity) }}</span>
              </span>
              <span class="activity-entry__period">
                <span class="activity-entry__period-text">{{ isStandingActivity(activity) ? standingPeriod(activity) : formatActivityPeriod(activity) }}</span>
                <span class="activity-entry__hint">
                  <span v-if="activityCanOpen(activity)">查看详情 <span class="i-carbon-arrow-right" /></span>
                  <span v-else-if="activityStatus(activity) === 'upcoming'">活动未开始 <span class="i-carbon-locked" /></span>
                  <span v-else>暂未支持详情 <span class="i-carbon-locked" /></span>
                </span>
              </span>
            </button>
          </div>
          <p v-else class="picker-section__empty">
            当前没有进行中的活动
          </p>
        </section>

        <!-- 往期活动：与「宠物管理」的宠物列表同款行式列表，不再按月份分组。 -->
        <section v-else class="picker-section" aria-label="往期活动">
          <ul v-if="pastActivities.length" id="past-activities-list" class="past-list">
            <li v-for="row in pastActivities" :key="row.key" class="past-row">
              <div class="past-row__identity">
                <span class="past-row__avatar"><img v-if="activityIconSrc(row.activity)" :src="activityIconSrc(row.activity)" alt=""><span v-else class="i-carbon-calendar" /></span>
                <strong class="past-row__name">{{ row.name }}</strong>
                <div class="past-row__meta">
                  <span class="past-row__status">已结束</span>
                  <span v-if="(editionCounts.get(row.name) || 0) > 1" class="past-row__edition" title="目录中同名活动的不同期次数">共 {{ editionCounts.get(row.name) }} 期</span>
                </div>
              </div>
              <div class="past-row__period">
                <small>活动时间</small>
                <p>{{ formatActivityPeriod(row.activity) }}</p>
              </div>
            </li>
          </ul>
          <p v-else class="picker-section__empty">
            当前没有往期活动
          </p>
        </section>
      </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.activity-picker {
  width: 100%;
  min-width: 0;
  color: var(--ui-ink);
}

/* 卡片外壳对齐「个人 → 农场」的 page-card-surface；padding 为 0，
   水平内边距下放给标题栏与每一行，这样行间分割线能铺满整张卡。
   底色用不透明的 --ui-surface-solid，与「图鉴」的 CatalogPanel 一致：
   沿用半透的 --glass-card 会透出页面底色，内容区看起来发灰。
   overflow: clip 只裁内容贴合圆角、不形成滚动容器，
   不会把标题栏的吸顶困死在卡片内（同 BookToolbar .book-card 的做法）。 */
.activity-card {
  width: 100%;
  min-width: 0;
  overflow: clip;
  border: 1px solid var(--glass-border);
  border-radius: var(--ui-radius-card);
  background: var(--ui-surface-solid);
  box-shadow:
    inset 0 1px 0 var(--glass-highlight),
    var(--ui-shadow-sm);
}

/* 列表区需要一点内边距，但左右由各行自己提供，
   这里只给上下，确保卡片边缘与首尾内容不贴死。 */
.picker-sections {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 16px;
  padding-block: 16px;
}

/* 往期列表自己不留顶部空白：首行不再比其余行多出 16px 上边距，
   与后续行一样只靠行间细线分隔；底部留白仍由这里给。 */
.picker-sections:has(.past-list) {
  padding-block: 0 16px;
}

.picker-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.picker-section__empty {
  /* 空态框与卡片边缘留白，与列表行一致 */
  margin: 0 16px;
  padding: 18px 16px;
  border: 1px dashed var(--ui-border-strong);
  border-radius: var(--ui-radius-card);
  color: var(--ui-muted);
  font-size: var(--ui-font-size-small-13);
  text-align: center;
}

/* 标题栏格式走全局 .panel-titlebar + --flush（卡片本身无内边距，不做出血）；
   这里只保留计数文案的字号色阶和左右分推。 */
.activity-toolbar {
  justify-content: space-between;
}

/* 左侧计数文案：放大字号并加粗，与 farm-summary 同字号色阶，不与刷新键抢视觉重心。 */
.activity-toolbar__summary {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-ink);
  font-size: var(--ui-font-size-large-15);
  font-weight: var(--fw-650);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 往期活动：与「宠物管理」的宠物列表同款行式列表。
   列表本身不再包一层边框卡片，行直接铺在页内卡片上，只靠行间分隔线保持结构。 */
.past-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.past-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px 14px;
  padding: 6px 16px;
}

.past-row + .past-row {
  border-top: 1px solid var(--ui-border);
}

/* 身份块：头像与名称同一行，状态与期数在名称下方 */
.past-row__identity {
  display: grid;
  min-width: 0;
  grid-template-columns: 40px minmax(0, 1fr);
  grid-template-rows: auto auto;
  column-gap: 10px;
  row-gap: 0;
  align-items: center;
}

.past-row__avatar {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  grid-row: 1 / span 2;
  border-radius: 12px;
  color: var(--ui-subtle);
  background: var(--ui-surface-soft);
  font-size: var(--ui-font-size-large-15);
}

.past-row__avatar img {
  width: 90%;
  height: 90%;
  object-fit: contain;
  filter: saturate(0.6);
}

.past-row__name {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-ink);
  font-size: var(--ui-font-size-small-13);
  font-weight: var(--fw-650);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.past-row__meta {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.past-row__status {
  color: var(--ui-subtle);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.past-row__edition {
  flex: none;
  padding: 0 6px;
  border-radius: 5px;
  color: var(--ui-blue);
  background: var(--ui-blue-soft);
  font-size: var(--ui-content-item-font-height-tiny-12);
  line-height: 16px;
}

/* 右侧活动时间：标签与时间值同排一行，标签在左 */
.past-row__period {
  display: flex;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
}

.past-row__period small {
  color: var(--ui-subtle);
  font-size: var(--ui-font-size-small-13);
}

.past-row__period p {
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-variant-numeric: tabular-nums;
}

.picker-list {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
  /* 卡片自身无内边距，网格靠这里与卡片边缘留白 */
  padding-inline: 16px;
}

.picker-state {
  width: 100%;
  min-height: 300px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 0 auto;
  /* 卡片自身无内边距，状态区自己带水平留白 */
  padding: 30px 16px;
  color: var(--ui-muted);
  text-align: center;
}

.picker-state > div {
  font-size: var(--ui-font-size-large-15);
}

.picker-state strong {
  color: var(--ui-ink);
  font-size: var(--ui-font-size-large-15);
}

.picker-state span {
  max-width: 420px;
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.picker-state button {
  min-height: var(--ui-content-item-control-height-30);
  margin-top: 8px;
  padding: 0 15px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  color: var(--ui-primary);
  background: var(--ui-surface);
  font-weight: var(--fw-700);
  cursor: pointer;
}

.picker-state button:disabled {
  opacity: 0.55;
  cursor: wait;
}

.picker-state .picker-spinner {
  width: 42px;
  height: 42px;
  font-size: 0;
}

.activity-entry {
  position: relative;
  min-height: 92px;
  display: flex;
  overflow: hidden;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 0;
  padding: 12px;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  color: var(--ui-ink);
  text-align: left;
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-sm);
  cursor: pointer;
  appearance: none;
}

.activity-entry--supported:hover {
  border-color: rgba(67, 141, 99, 0.3);
  box-shadow: var(--ui-shadow-md);
  transform: translateY(-1px);
}

.activity-entry--upcoming {
  border-color: rgba(186, 125, 27, 0.3);
}

.activity-entry--ended {
  border-color: rgba(89, 102, 97, 0.18);
  background: color-mix(in srgb, var(--ui-surface-soft) 70%, transparent);
}

/* 常驻条目与限时活动共用同一套卡片，只把边框和标记换成橙黄以示区分。
   这条要放在 upcoming/ended 之后，才能覆盖它们对边框色的设置。 */
.activity-entry--standing {
  border: 1.5px solid var(--ui-warning);
  background: color-mix(in srgb, var(--ui-warning-soft) 40%, var(--ui-surface));
}

.activity-entry--standing.activity-entry--supported:hover {
  border-color: color-mix(in srgb, var(--ui-warning) 82%, #000);
}

.activity-entry--standing .activity-entry__icon,
.activity-entry--standing .activity-entry__status {
  border-color: color-mix(in srgb, var(--ui-warning) 26%, transparent);
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
}

.activity-entry:disabled {
  cursor: default;
  opacity: 1;
}

.activity-entry__topline {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

/* 图标与活动名同处左侧一组：名称紧贴图标右侧，右端留给状态标签。 */
.activity-entry__ident {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.activity-entry__topline {
  margin-bottom: 10px;
}

.activity-entry__icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

.activity-entry__icon > span {
  font-size: var(--ui-font-size-large-15);
}

/* 图标图片限制在图标框内，避免溢出后贴到右侧活动名。 */
.activity-entry__icon img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.activity-entry__status {
  flex: none;
  padding: 3px 8px;
  border: 1px solid rgba(67, 141, 99, 0.18);
  border-radius: 999px;
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-700);
}

.activity-entry--upcoming .activity-entry__icon,
.activity-entry--upcoming .activity-entry__status {
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
}

.activity-entry--ended .activity-entry__icon,
.activity-entry--ended .activity-entry__status {
  color: var(--ui-muted);
  background: var(--ui-bg-soft);
}

.activity-entry__name {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-ink);
  font-size: var(--ui-font-size-large-15);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 日期与状态提示同一行：日期在左，提示在右。 */
.activity-entry__period {
  width: 100%;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.activity-entry__period-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 状态提示：与日期同行，靠右。 */
.activity-entry__hint {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.activity-entry__hint > span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-700);
}

.activity-entry--supported .activity-entry__hint > span {
  color: var(--ui-primary);
}

.activity-entry__hint .i-carbon-arrow-right,
.activity-entry__hint .i-carbon-locked {
  font-size: var(--ui-font-size-small-13);
}

.activity-entry__icon .activity-entry__pet {
  width: 26px;
  height: 26px;
}
</style>
