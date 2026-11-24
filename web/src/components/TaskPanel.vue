<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import RewardHistory from '@/components/RewardHistory.vue'
import DailyOverview from '@/components/DailyOverview.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import OfflineState from '@/components/ui/OfflineState.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { useAccountPresence } from '@/composables/useReconnectRefresh'
import { useAccountStore } from '@/stores/account'
import { useStatusStore } from '@/stores/status'

const statusStore = useStatusStore()
const accountStore = useAccountStore()
const { dailyGifts, dailyGiftsLoading, dailyGiftsError, status, loading: statusLoading, realtimeConnected } = storeToRefs(statusStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)

const presence = useAccountPresence()
const isOffline = computed(() => presence.value === 'offline')
const isConnected = computed(() => presence.value === 'online')
const displayedGifts = computed(() => {
  const overview = dailyGifts.value
  const snapshot = status.value?.farmGiftRewards
  if (!overview || !snapshot || snapshot.date !== overview.date
    || String(status.value.accountId || '') !== String(currentAccountId.value || ''))
    return overview

  return {
    ...overview,
    gifts: overview.gifts.map((gift) => {
      if (gift.key !== 'mall_free_gifts' && gift.key !== 'daily_share')
        return gift
      const receipt = snapshot[gift.key]
      return receipt?.doneToday && receipt.lastAt > 0 && receipt.rewards?.length && receipt.lastAt >= (gift.lastAt || 0)
        ? { ...gift, ...receipt }
        : gift
    }),
  }
})

async function refresh() {
  if (isConnected.value)
    await statusStore.fetchDailyGifts(currentAccountId.value)
}

/** 只有用户点击刷新才让图标转圈；挂载和账号切换引起的自动加载不碰按钮，避免刷新图标闪烁。 */
const manualRefreshing = ref(false)

async function refreshTasksOnDemand() {
  if (manualRefreshing.value)
    return

  manualRefreshing.value = true
  try {
    await refresh()
  }
  finally {
    manualRefreshing.value = false
  }
}

function loadStatusIfNeeded() {
  const id = currentAccountId.value
  if (id && !realtimeConnected.value)
    void statusStore.fetchStatus(id)
}

onMounted(loadStatusIfNeeded)
watch(currentAccountId, loadStatusIfNeeded)
watch([currentAccountId, presence], ([id, next], [prevId]) => {
  if (id !== prevId)
    dailyGifts.value = null
  if (next === 'online')
    void refresh()
}, { immediate: true })
</script>

<template>
    <section class="min-w-0 flex flex-col task-panel-card page-card-surface rounded-2xl panel-scroll-layout margin-shell"><span class="margin-content">
      <div class="task-toolbar panel-titlebar shrink-0 margin-shell"><span class="margin-content">
        <!-- 按钮组走全局 .page-toolbar__actions 推到最右，与宠物页一致 -->
        <div class="page-toolbar__actions">
          <RewardHistory />
          <RefreshButton
            title="刷新任务"
            :loading="manualRefreshing"
            :disabled="!isConnected"
            @click="refreshTasksOnDemand"
          />
        </div>
      </span></div>
      <div class="panel-scroll-body panel-scroll-body--bleed">
        <EmptyState v-if="!currentAccountId" bare title="请先选择账号" icon="i-carbon-user-avatar" />
        <OfflineState v-else-if="isOffline" />
        <div v-else-if="dailyGiftsLoading || statusLoading || presence === 'unknown'" class="flex justify-center py-12">
          <span class="i-carbon-circle-dash animate-spin text-4xl" />
        </div>
        <template v-else>
          <div v-if="dailyGiftsError" class="task-error flex shrink-0 items-center justify-between gap-3 text-sm" role="alert">
            <span>{{ dailyGiftsError }}</span>
            <button class="shrink-0 text-green-600" @click="refresh">
              重新加载
            </button>
          </div>
          <!-- 成长任务与每日礼包合并为同一列表 -->
          <DailyOverview :daily-gifts="displayedGifts" :platform="currentAccount?.platform" plain-rewards />
        </template>
      </div>
    </span></section>

</template>

<style scoped>
.task-panel-card {
  --panel-pad: 16px;
  --inset-top: var(--panel-pad); --inset-right: var(--panel-pad); --inset-bottom: 0px; --inset-left: var(--panel-pad);
}

.task-error {
  padding: 12px var(--panel-pad);
  border-bottom: 1px solid var(--ui-border);
}

.task-error > span {
  min-width: 0;
  overflow-wrap: anywhere;
}

@container (max-width: 700px) {
  /* 刷新键只负责收起文案，图标等距、宽度由全局 .panel-refresh 模板算。
     容器查询命中不到 .panel-titlebar 自身，所以写在按钮这个后代上。 */
  .task-toolbar :deep(.panel-refresh) {
    --refresh-label: none;
  }
}
</style>
