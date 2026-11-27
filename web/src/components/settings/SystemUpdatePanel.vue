<script setup lang="ts">
import type { ReleasesSummary, RollbackReleaseItem } from '@/components/settings/ReleaseRollbackPanel.vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import ReleaseRollbackPanel from '@/components/settings/ReleaseRollbackPanel.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useToastStore } from '@/stores/toast'

interface UpdateStatus {
  mode: 'source' | 'docker' | 'binary' | 'unknown'
  branch: string
  upstream: string
  shortCommit: string
  startupCommit: string
  behindCount: number
  aheadCount: number
  dirtyFiles: string[]
  needsApply: boolean
  updateHint: string
  hostMaintenance: string
  unsupportedReason: string
  applySupported: boolean
  applyUnsupportedReason: string
  canCheck: boolean
  canPull: boolean
  canApply: boolean
  deployBusy: boolean
  job: {
    status: 'running' | 'succeeded' | 'failed'
    phase: string
    detail?: string
    error?: string
  } | null
  releases: RollbackReleaseItem[]
  releasesSummary: ReleasesSummary
  keepBackups?: boolean
}

type UpdateAction = 'check' | 'pull' | 'apply'
const actionErrors: Record<UpdateAction, string> = {
  check: '检查更新失败',
  pull: '拉取更新失败',
  apply: '启动在线更新失败',
}

const toast = useToastStore()
const requestConfig = { skipErrorToast: true, timeout: 90_000 }
const status = ref<UpdateStatus | null>(null)
const loading = ref(false)
const action = ref<UpdateAction | null>(null)
const failure = ref('')
const confirmApplyOpen = ref(false)
const deploying = computed(() => !!status.value?.deployBusy || status.value?.job?.status === 'running')
const disabled = computed(() => loading.value || !!action.value || deploying.value)
const unavailableReason = computed(() =>
  status.value?.unsupportedReason || status.value?.applyUnsupportedReason || '',
)
let pollTimer: ReturnType<typeof setTimeout> | undefined
let viewActive = true
let statusRevision = 0

function schedulePoll() {
  clearTimeout(pollTimer)
  if (viewActive && deploying.value) {
    pollTimer = setTimeout(() => {
      void loadStatus(true)
    }, 2000)
  }
}

function acceptStatus(next: UpdateStatus) {
  if (!viewActive)
    return
  statusRevision++
  status.value = next
  schedulePoll()
}

async function loadStatus(silent = false) {
  if (action.value || loading.value || !viewActive)
    return
  const revision = ++statusRevision
  if (!silent) {
    loading.value = true
    failure.value = ''
  }
  try {
    const { data } = await api.get('/api/system/update/status', requestConfig)
    if (revision !== statusRevision)
      return
    if (!data?.ok || !data.data)
      throw new Error(getApiErrorMessage(data, '获取更新状态失败'))
    acceptStatus(data.data)
  }
  catch (error) {
    if (revision === statusRevision && !silent)
      failure.value = getApiErrorMessage(error, '获取更新状态失败')
  }
  finally {
    if (!silent)
      loading.value = false
    schedulePoll()
  }
}

async function runAction(next: UpdateAction) {
  if (disabled.value || !status.value)
    return
  if ((next === 'check' && !status.value.canCheck)
    || (next === 'pull' && !status.value.canPull)
    || (next === 'apply' && !status.value.canApply))
    return
  action.value = next
  failure.value = ''
  statusRevision++
  let refreshAfterFailure = false
  try {
    const { data } = await api.post(
      `/api/system/update/${next}`,
      next === 'apply' ? { pullFirst: status.value.behindCount > 0 } : {},
      requestConfig,
    )
    const nextStatus = next === 'check' ? data?.data : data?.data?.status
    if (!data?.ok || !nextStatus)
      throw new Error(getApiErrorMessage(data, actionErrors[next]))
    acceptStatus(nextStatus)
    if (!viewActive)
      return
    if (next === 'apply')
      toast.info(data.data.job ? '已开始更新，可以在这里查看进度' : '当前版本无需更新')
    if (next === 'pull')
      toast.info(data.data.pulled ? '代码已拉取，可以应用更新' : '当前没有可拉取的提交')
  }
  catch (error) {
    failure.value = getApiErrorMessage(error, actionErrors[next])
    refreshAfterFailure = true
  }
  finally {
    action.value = null
    if (next === 'apply')
      confirmApplyOpen.value = false
    if (refreshAfterFailure)
      void loadStatus(true)
    else
      schedulePoll()
  }
}

onMounted(() => loadStatus())
onBeforeUnmount(() => {
  viewActive = false
  statusRevision++
  clearTimeout(pollTimer)
})
</script>

<template>
  <div class="min-w-0 space-y-3">
    <section class="page-card-surface rounded-lg p-4 space-y-3" aria-labelledby="system-update-title">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="system-update-title" class="text-sm font-semibold">
          助手程序版本
        </h2>
        <div v-if="status" class="flex flex-wrap gap-2">
          <BaseButton size="sm" variant="secondary" :disabled="disabled || !status.canCheck" :loading="action === 'check'" @click="runAction('check')">
            检查更新
          </BaseButton>
          <BaseButton
            v-if="status.behindCount > 0 && status.canPull"
            size="sm"
            variant="secondary"
            :disabled="disabled"
            :loading="action === 'pull'"
            @click="runAction('pull')"
          >
            仅拉取代码
          </BaseButton>
          <BaseButton
            v-if="status.applySupported"
            size="sm"
            variant="primary"
            :disabled="disabled || !status.canApply"
            :loading="action === 'apply'"
            @click="confirmApplyOpen = true"
          >
            {{ status.behindCount > 0 ? '拉取并更新' : '应用更新' }}
          </BaseButton>
        </div>
      </div>

      <p v-if="loading && !status" role="status">正在读取版本状态…</p>
      <div v-if="status" class="space-y-2">
        <dl class="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div><dt class="inline text-[var(--ui-muted)]">运行版本</dt> <dd class="inline font-mono">{{ status.startupCommit?.slice(0, 7) || '未知' }}</dd></div>
          <div><dt class="inline text-[var(--ui-muted)]">本地代码</dt> <dd class="inline font-mono">{{ status.shortCommit || '未知' }}</dd></div>
          <div v-if="status.branch"><dt class="inline text-[var(--ui-muted)]">分支</dt> <dd class="inline">{{ status.branch }}</dd></div>
          <div v-if="status.upstream"><dt class="inline text-[var(--ui-muted)]">跟踪分支</dt> <dd class="inline">{{ status.upstream }}</dd></div>
        </dl>
        <p v-if="status.behindCount > 0" class="text-sm">有 {{ status.behindCount }} 个提交可更新。</p>
        <p v-if="status.needsApply && !status.behindCount" class="text-sm">{{ status.updateHint }}</p>
        <p v-if="status.dirtyFiles.length || status.aheadCount > 0" class="text-sm text-amber-700 dark:text-amber-300">
          本地有未提交的修改或未推送的提交，自动更新受限。
        </p>
        <p v-if="unavailableReason" class="text-sm text-[var(--ui-muted)]">{{ unavailableReason }}</p>
        <p v-if="status.hostMaintenance" class="text-sm text-[var(--ui-muted)]">{{ status.hostMaintenance }}</p>
        <p v-if="status.job || deploying" role="status" class="text-sm">
          {{ status.job?.phase || '正在更新或回滚' }}
          <span v-if="status.job?.error || status.job?.detail"> · {{ status.job.error || status.job.detail }}</span>
        </p>
      </div>
      <p v-if="failure" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ failure }}</p>
      <BaseButton v-if="!loading && !status" size="sm" variant="secondary" @click="loadStatus()">重新读取</BaseButton>
    </section>

    <ReleaseRollbackPanel
      v-if="status"
      class="page-card-surface rounded-lg p-4"
      :releases="status.releases"
      :summary="status.releasesSummary"
      :mode="status.mode"
      :apply-supported="status.applySupported"
      :apply-unsupported-reason="status.applyUnsupportedReason"
      :deploy-busy="deploying"
      :keep-backups="status.keepBackups"
      :manage-backups="false"
      :disabled="loading || !!action"
      @status-updated="acceptStatus"
    />

    <ConfirmModal
      :show="confirmApplyOpen"
      :loading="action === 'apply'"
      title="确认更新助手"
      message="开始后台更新后，切换版本时面板可能短暂断开。"
      confirm-text="开始更新"
      type="primary"
      @cancel="!action && (confirmApplyOpen = false)"
      @confirm="runAction('apply')"
    />
  </div>
</template>
