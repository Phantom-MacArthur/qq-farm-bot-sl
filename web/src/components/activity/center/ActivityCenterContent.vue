<script setup lang="ts">
import type { ActivityTab } from '@/components/activity/BottomNav.vue'
import type { ActivityDirectoryItemDto, ActivityGameplayKey } from '@/stores/activity-center'
import { useNotification } from 'naive-ui/es/notification'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { resolveActivityGameplay } from '@/components/activity/gameplays'
import { useAccountOffline, useReconnectRefresh } from '@/composables/useReconnectRefresh'
import { useAccountStore } from '@/stores/account'
import { useActivityCenterStore } from '@/stores/activity-center'
import { useAppStore } from '@/stores/app'
import { useFriendStore } from '@/stores/friend'
import ActivityDirectoryPage from './ActivityDirectoryPage.vue'
import AutumnActivityPage from './AutumnActivityPage.vue'
import CharityActivityPage from './CharityActivityPage.vue'
import MilkTeaPage from './MilkTeaPage.vue'
import MugePage from './MugePage.vue'
import PetDiaryPage from './PetDiaryPage.vue'
import QingMeiActivityPage from './QingMeiActivityPage.vue'
import QixiActivityPage from './QixiActivityPage.vue'
import ShareRewardActivity from './ShareRewardActivity.vue'
import StellarActivityPage from './StellarActivityPage.vue'
import WeatherActivityPage from './WeatherActivityPage.vue'
import YishuHuanfuActivityPage from './YishuHuanfuActivityPage.vue'

const props = withDefaults(defineProps<{ space?: 'farm' | 'ranch' }>(), { space: 'farm' })
const route = useRoute()
const router = useRouter()
const notification = useNotification()
const accountStore = useAccountStore()
const activityStore = useActivityCenterStore()
const friendStore = useFriendStore()
const { currentAccountId } = storeToRefs(accountStore)
const { notice, actionError } = storeToRefs(activityStore)
const isDirectoryRoute = computed(() => route.name === (props.space === 'ranch' ? 'ranch-activity-center' : 'activity-center'))
const linkedActivity = computed(() => {
  if (!isDirectoryRoute.value)
    return null
  const activity = route.query.activity
  return activity === 'muge' || (props.space === 'farm' && activity === 'yishuhuanfu') ? activity : null
})
const selectedActivity = ref<ActivityGameplayKey | null>(null)
const selectedInstanceId = ref('')
const isOffline = useAccountOffline()
const appStore = useAppStore()
watch([selectedActivity, isOffline], ([activity, offline]) => {
  appStore.activityUsesCustomLayout = !!activity && !offline && activity !== 'muge' && activity !== 'yishuhuanfu'
}, { immediate: true })
const stellarEntryTab = ref<ActivityTab>('travel')

function accountId() {
  return String(currentAccountId.value || '')
}

async function openActivity(activity: ActivityDirectoryItemDto) {
  const gameplay = resolveActivityGameplay(activity)
  if (!gameplay)
    return
  if (gameplay.module.key === 'stellar')
    stellarEntryTab.value = gameplay.entryTab as ActivityTab

  selectedActivity.value = gameplay.module.key
  selectedInstanceId.value = activity.instanceId || activity.activityIds.find(id => ['2026092501', '2026110104'].includes(id)) || ''
  await loadSelectedActivity()
}

async function loadSelectedActivity() {
  const activity = selectedActivity.value
  const id = accountId()
  if (!activity || !id || isOffline.value || ['pet', 'wish', 'happy', 'milk', 'muge'].includes(activity))
    return
  const detailsLoaded = await activityStore.loadDetails(id, activity)
  if (!detailsLoaded || isOffline.value || id !== accountId() || activity !== selectedActivity.value)
    return
  if (activity === 'qixi')
    await friendStore.fetchFriends(id)
  else if (activity === 'weather')
    void activityStore.loadWeatherFriends(id)
}

function goBack() {
  if (linkedActivity.value) {
    void router.replace({ query: { ...route.query, activity: undefined } })
    return
  }
  if (selectedActivity.value) {
    selectedActivity.value = null
    return
  }
  router.back()
}

watch(linkedActivity, (activity, previous) => {
  if (!activity && !previous)
    return
  selectedActivity.value = activity
  selectedInstanceId.value = ''
  if (activity)
    void loadSelectedActivity()
  else if (props.space === 'farm' && isDirectoryRoute.value)
    void activityStore.refresh(accountId())
}, { immediate: true })

watch(currentAccountId, () => {
  if (linkedActivity.value) {
    void loadSelectedActivity()
    return
  }
  selectedActivity.value = null
  if (props.space === 'farm')
    activityStore.refresh(accountId())
}, { flush: 'post' })

watch([notice, actionError], ([successMessage, failureMessage]) => {
  if (!selectedActivity.value)
    return

  if (failureMessage) {
    notification.error({
      title: '操作失败',
      content: failureMessage,
      duration: 5000,
      keepAliveOnHover: true,
    })
  }
  else if (successMessage) {
    notification.success({
      title: '操作成功',
      content: successMessage,
      duration: 3500,
      keepAliveOnHover: true,
    })
  }
  else {
    return
  }

  activityStore.clearActionMessages()
})

useReconnectRefresh(() => selectedActivity.value ? loadSelectedActivity() : activityStore.refresh(accountId()))

onMounted(() => {
  if (props.space === 'farm' && !linkedActivity.value)
    activityStore.refresh(accountId())
})
onBeforeUnmount(() => {
  appStore.activityUsesCustomLayout = false
})
</script>

<template>
  <ActivityDirectoryPage
    v-if="!selectedActivity || (isOffline && selectedActivity !== 'yishuhuanfu')"
    :offline="isOffline"
    :space="space"
    @back="goBack"
    @open="openActivity"
  />
  <MugePage v-else-if="selectedActivity === 'muge'" @back="goBack" />
  <MilkTeaPage v-else-if="selectedActivity === 'milk'" @back="goBack" />
  <ShareRewardActivity v-else-if="selectedActivity === 'happy'" :activity-id="selectedInstanceId" @back="goBack" />
  <AutumnActivityPage
    v-else-if="selectedActivity === 'wish'"
    kind="wish"
    @back="goBack"
  />
  <StellarActivityPage
    v-else-if="selectedActivity === 'stellar'"
    :entry-tab="stellarEntryTab"
    @back="goBack"
  />
  <QixiActivityPage
    v-else-if="selectedActivity === 'qixi'"
    @back="goBack"
  />
  <QingMeiActivityPage
    v-else-if="selectedActivity === 'qingmei'"
    @back="goBack"
  />
  <CharityActivityPage
    v-else-if="selectedActivity === 'charity'"
    @back="goBack"
  />
  <WeatherActivityPage
    v-else-if="selectedActivity === 'weather'"
    @back="goBack"
  />
  <PetDiaryPage v-else-if="selectedActivity === 'pet'" @back="goBack" />
  <YishuHuanfuActivityPage v-else-if="selectedActivity === 'yishuhuanfu'" @back="goBack" />
</template>

<style>
/* 目录页不再包一层带边框的大卡片：与「个人」页一样直接坐在页面底色上，
   卡片才能与页面左右留白对齐，不被额外的 24px 内边距向内推。 */
.activity-picker {
  position: relative;
  width: 100%;
  color: var(--ui-ink);
}

/* 卡片与状态样式由 ActivityDirectoryPage 自己维护（scoped），这里不再重复定义，
   避免两套同名规则互相覆盖。 */
.activity-center {
  position: relative;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.activity-content {
  position: absolute;
  inset: 110px 24px 24px 260px;
  overflow-x: hidden;
  overflow-y: auto;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-card);
  background: rgba(255, 255, 255, 0.54);
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(67, 141, 99, 0.35) transparent;
}

.activity-message {
  position: absolute;
  z-index: 25;
  top: 102px;
  right: 36px;
  left: 272px;
  min-height: 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  border: 1px solid rgba(201, 95, 102, 0.2);
  border-radius: 10px;
  color: #9a4048;
  background: rgba(250, 233, 234, 0.94);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.activity-message.success {
  border-color: rgba(67, 141, 99, 0.2);
  color: #2e714b;
  background: rgba(228, 241, 231, 0.94);
}

.activity-message button {
  flex: none;
  padding: 3px 8px;
  border: 1px solid currentcolor;
  border-radius: 8px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.activity-state {
  position: absolute;
  z-index: 5;
  inset: 110px 24px 24px 260px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--ui-ink);
  text-align: center;
}

.activity-state strong {
  margin-top: 12px;
  font-size: var(--ui-font-size-large-15);
}

.activity-state span {
  margin-top: 4px;
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.activity-spinner {
  width: 43px;
  height: 43px;
  border: 3px solid rgba(67, 141, 99, 0.18);
  border-top-color: var(--ui-primary);
  border-radius: 50%;
  animation: spin 0.85s linear infinite;
}

.gameplay-content {
  inset: 86px 0 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  border: 0;
  border-radius: 0;
  background: transparent;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
}

.detail-state {
  inset: 86px 0 0;
  border-radius: 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
