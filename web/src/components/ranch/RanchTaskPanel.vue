<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, watch } from 'vue'
import RewardHistory from '@/components/RewardHistory.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import DailyOverview from '@/components/DailyOverview.vue'
import { useRanchLoader } from '@/components/ranch/ranch-shared'
import RanchGate from '@/components/ranch/RanchGate.vue'
import { useAccountStore } from '@/stores/account'
import { useRanchStore } from '@/stores/ranch'
import { useStatusStore } from '@/stores/status'

/**
 * 牧场“我的任务”：与农场同一套展示，奖励由每日例程自动领取，这里只显示状态。
 * 每日任务、分享礼包是牧场自己的；邮箱、会员、月卡按账号与农场共用。
 */
const SHARED_GIFTS = ['email_rewards', 'vip_daily_gift', 'month_card_gift']

const statusStore = useStatusStore()
const { dailyGifts, dailyGiftsLoading, currentAccountConnected: isConnected } = storeToRefs(statusStore)
const { currentAccountId } = storeToRefs(useAccountStore())
const { state, loading } = storeToRefs(useRanchStore())
const { refresh: refreshRanch } = useRanchLoader('tasks')

const tasks = computed<any[]>(() => state.value?.tasks || [])
const dailyTasks = computed(() => tasks.value.filter(task => task.category === 'daily'))
const growthTasks = computed(() => tasks.value.filter(task => task.category === 'growth'))
const growthDone = computed(() => growthTasks.value.filter(task => task.claimed).length)

const overview = computed(() => {
  const auto = (key: string): Record<string, any> => dailyGifts.value?.ranch?.gifts?.find(gift => gift.key === key) || {}
  const shared = (key: string) => dailyGifts.value?.gifts?.find((gift: any) => gift.key === key)
  const daily = dailyTasks.value
  const claimed = daily.filter(task => task.claimed).length
  const taskGift = {
    ...auto('task_claim'),
    key: 'task_claim',
    label: '每日任务',
    doneToday: daily.length > 0 && claimed === daily.length,
    completedCount: claimed,
    totalCount: daily.length,
  }
  const shareAuto = auto('daily_share')
  const shareGift = {
    enabled: true,
    mode: 'auto_claim',
    ...shareAuto,
    key: 'daily_share',
    label: '分享礼包',
    doneToday: !!state.value?.dailyShare?.claimed || !!shareAuto.doneToday,
  }
  const [email, vip, month] = SHARED_GIFTS.map(shared)
  const benefit = { enabled: true, ...auto('mall_free_gifts'), key: 'mall_free_gifts', label: '每日福利', doneToday: !!state.value?.dailyBenefit?.claimed || !!auto('mall_free_gifts').doneToday }
  const current = growthTasks.value.find(task => !task.claimed && task.canClaim)
    || growthTasks.value.find(task => !task.claimed && task.unlocked)
    || growthTasks.value.find(task => !task.claimed)
  return {
    growth: growthTasks.value.length ? {
      showOverallProgress: true,
      completedCount: growthDone.value,
      totalCount: growthTasks.value.length,
      currentTask: current ? {
        desc: current.desc,
        progress: current.progress,
        totalProgress: current.total,
        isCompleted: current.canClaim,
        isLocked: !current.unlocked,
        rewards: current.rewards,
      } : null,
    } : null,
    timeZone: dailyGifts.value?.timeZone,
    gifts: [taskGift, benefit, email, shareGift, vip, month].filter(Boolean),
  }
})

async function refreshGifts() {
  const id = String(currentAccountId.value || '')
  if (id && isConnected.value)
    await statusStore.fetchDailyGifts(id)
}
function refresh() {
  void refreshRanch()
  void refreshGifts()
}

watch([currentAccountId, isConnected], refreshGifts, { immediate: true })
</script>

<template>
  <section class="ranch-reward-panel panel-fill page-card-surface panel-scroll-layout">
    <header class="panel-titlebar panel-titlebar--flush shrink-0">
      <div class="ranch-reward-toolbar page-toolbar__actions">
        <RewardHistory />
        <RefreshButton
          title="刷新奖励"
          :loading="loading || dailyGiftsLoading"
          :disabled="!isConnected"
          @click="refresh"
        />
      </div>
    </header>

    <div class="panel-scroll-body">
      <RanchGate @retry="refreshRanch">
        <DailyOverview :daily-gifts="overview" plain-rewards />
      </RanchGate>
    </div>
  </section>
</template>

<style scoped>
.ranch-reward-panel {
  margin: 0;
  overflow: clip;
}
.ranch-reward-toolbar {
  justify-content: flex-end;
  margin-block: 16px;
  margin-right: 16px;
}
</style>
