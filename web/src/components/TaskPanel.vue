<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import DailyOverview from '@/components/DailyOverview.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import OfflineState from '@/components/ui/OfflineState.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { useAccountPresence } from '@/composables/useReconnectRefresh'
import { useAccountStore } from '@/stores/account'
import { useStatusStore } from '@/stores/status'

const statusStore = useStatusStore()
const accountStore = useAccountStore()
const { dailyGifts, dailyGiftsLoading, dailyGiftsError, loading: statusLoading, realtimeConnected } = storeToRefs(statusStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)

const presence = useAccountPresence()
const isOffline = computed(() => presence.value === 'offline')
const isConnected = computed(() => presence.value === 'online')

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
  <div class="personal-panel">
    <section class="personal-panel__card task-panel-card page-card-surface rounded-2xl panel-scroll-layout">
      <div class="task-toolbar panel-titlebar shrink-0">
        <!-- 按钮组走全局 .page-toolbar__actions 推到最右，与宠物页一致 -->
        <div class="page-toolbar__actions">
          <RefreshButton
            title="刷新任务"
            :loading="manualRefreshing"
            :disabled="!isConnected"
            @click="refreshTasksOnDemand"
          />
        </div>
      </div>
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
          <DailyOverview :daily-gifts="dailyGifts" :platform="currentAccount?.platform" />
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.task-panel-card {
  --panel-pad: 16px;
  padding: var(--panel-pad);
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
