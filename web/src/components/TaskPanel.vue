<script setup lang="ts">
import { NButton } from 'naive-ui/es/button'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import DailyOverview from '@/components/DailyOverview.vue'
import { useAccountStore } from '@/stores/account'
import { useStatusStore } from '@/stores/status'

const statusStore = useStatusStore()
const accountStore = useAccountStore()
const { status, dailyGifts, realtimeConnected, dailyGiftsLoading, dailyGiftsError, loading: statusLoading } = storeToRefs(statusStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)

const isConnected = computed(() => !!currentAccount.value?.running && status.value?.connection?.connected === true)
const taskEmptyText = computed(() => !currentAccountId.value ? '请先选择账号' : !isConnected.value ? '启动账号后读取任务' : dailyGiftsLoading.value || statusLoading.value ? '正在读取任务…' : '暂无任务详情')

const growth = computed(() => dailyGifts.value?.growth || null)
const growthCurrentTask = computed(() => growth.value?.currentTask || growth.value?.tasks?.[0] || null)

async function refresh() {
  if (currentAccountId.value) {
    const acc = currentAccount.value
    if (!acc)
      return

    if (!realtimeConnected.value) {
      await statusStore.fetchStatus(currentAccountId.value)
    }
    if (acc.running && status.value?.connection?.connected) {
      await statusStore.fetchDailyGifts(currentAccountId.value)
    }
  }
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

onMounted(() => {
  refresh()
})

watch(currentAccountId, () => {
  refresh()
})

function formatTaskProgress(task: any) {
  if (!task)
    return '未开始'
  const rawCurrent = task.progress ?? task.current
  const rawTarget = task.totalProgress ?? task.target

  const current = Number.isFinite(rawCurrent)
    ? rawCurrent
    : (rawCurrent ? Number(rawCurrent) || 0 : 0)

  const target = Number.isFinite(rawTarget)
    ? rawTarget
    : (rawTarget ? Number(rawTarget) || 0 : 0)

  if (!current && !target)
    return '未开始'

  if (target && current >= target)
    return '已完成'

  return `进度：${current}/${target}`
}
</script>

<template>
  <div class="personal-panel">
    <section class="personal-panel__card task-panel-card farm-card rounded-2xl">
      <div class="task-toolbar panel-sticky shrink-0">
        <NButton
          type="primary"
          title="刷新任务"
          aria-label="刷新任务"
          :disabled="!currentAccountId || !isConnected"
          @click="refreshTasksOnDemand"
        >
          <template #icon>
            <span class="i-carbon-renew" :class="{ 'animate-spin': manualRefreshing }" />
          </template>
          <span class="task-action-label">刷新</span>
        </NButton>
      </div>
      <div v-if="dailyGiftsLoading || statusLoading" class="flex justify-center py-12">
        <span class="i-carbon-circle-dash animate-spin text-4xl" />
      </div>
      <template v-else>
        <div v-if="dailyGiftsError" class="task-error flex shrink-0 items-center justify-between gap-3 text-sm" role="alert">
          <span>{{ dailyGiftsError }}</span>
          <button class="shrink-0 text-green-600" :disabled="dailyGiftsLoading || !isConnected" @click="refresh">
            重新加载
          </button>
        </div>
        <DailyOverview :daily-gifts="dailyGifts" :empty-text="taskEmptyText" />

        <section class="task-growth-section">
          <div class="mb-3 flex shrink-0 items-center justify-between gap-3">
            <h3 class="flex items-center gap-2 font-medium" style="color: var(--theme-primary, #22c55e)">
              <span class="i-carbon-growth" />
              <span>成长任务</span>
            </h3>
            <span
              v-if="growth"
              class="rounded-lg bg-blue-50 px-2.5 py-0.5 text-xs text-blue-600 font-bold dark:bg-blue-900/20 dark:text-blue-400"
            >
              {{ growthCurrentTask ? `${growthCurrentTask.progress}/${growthCurrentTask.totalProgress}` : '暂无任务' }}
            </span>
          </div>
          <div class="personal-panel__scroll custom-scrollbar" role="region" aria-label="成长任务列表" tabindex="0">
            <div
              v-if="!currentAccountId"
              class="flex flex-col items-center justify-center gap-3 rounded-xl py-8 text-center"
              style="background: color-mix(in srgb, var(--theme-bg, #fff) 90%, var(--theme-primary, #3b82f6))"
            >
              <div class="i-carbon-user-avatar text-3xl" style="opacity: 0.5" />
              <div>
                <div class="text-sm font-medium" style="color: var(--theme-text, #374151)">
                  未登录账号
                </div>
                <div class="mt-1 text-xs text-gray-400">
                  请先添加农场账号
                </div>
              </div>
            </div>
            <div
              v-else-if="!isConnected"
              class="flex flex-col items-center justify-center gap-3 rounded-xl py-8 text-center"
              style="background: color-mix(in srgb, var(--theme-bg, #fff) 90%, var(--theme-primary, #3b82f6))"
            >
              <div class="i-carbon-connection-signal-off text-3xl" style="opacity: 0.5" />
              <div>
                <div class="text-sm font-medium" style="color: var(--theme-text, #374151)">
                  账号未登录
                </div>
                <div class="mt-1 text-xs text-gray-400">
                  请先运行账号或检查网络连接
                </div>
              </div>
            </div>
            <div
              v-else-if="growth && growth.tasks && growth.tasks.length"
              class="space-y-2"
            >
              <div
                v-for="(task, idx) in growth.tasks"
                :key="task.id || idx"
                class="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span class="min-w-0 break-words" style="color: var(--theme-text, #6b7280); opacity: 0.85">{{ task.desc || task.name }}</span>
                <span class="shrink-0 text-xs text-gray-500">{{ formatTaskProgress(task) }}</span>
              </div>
            </div>
            <div v-else class="text-center text-sm text-gray-400">
              {{ taskEmptyText }}
            </div>
          </div>
        </section>
      </template>
    </section>
  </div>
</template>

<style scoped>
.task-panel-card {
  --task-panel-pad: 16px;
  padding: var(--task-panel-pad);
}

.task-toolbar {
  container-type: inline-size;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  margin: calc(-1 * var(--task-panel-pad)) calc(-1 * var(--task-panel-pad)) 0;
  padding: 16px var(--task-panel-pad);
  border-radius: var(--ui-radius-card) var(--ui-radius-card) 0 0;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-table-head);
}

.task-toolbar :deep(.n-button) {
  width: auto;
  flex: 0 0 auto;
}

.task-toolbar :deep(.n-button__content) {
  gap: 4px;
  white-space: nowrap;
}

.task-action-label {
  white-space: nowrap;
}

.task-error {
  padding: 12px 0;
  border-bottom: 1px solid var(--ui-border);
}

.task-growth-section {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding-top: 16px;
}

@container (max-width: 700px) {
  .task-action-label {
    display: none;
  }
}
</style>
