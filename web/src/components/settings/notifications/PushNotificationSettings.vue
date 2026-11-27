<script setup lang="ts">
import type { OfflineConfig } from '@/stores/setting'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAccountStore } from '@/stores/account'
import { useSettingStore } from '@/stores/setting'
import { useToastStore } from '@/stores/toast'
import NotificationFields from './NotificationFields.vue'
import OfflineReminderCard from './OfflineReminderCard.vue'
import QqBotPushSettings from './QqBotPushSettings.vue'

const { currentAccountId } = storeToRefs(useAccountStore())
const settingStore = useSettingStore()
const { settings, loadedAccountId, loading } = storeToRefs(settingStore)
const toast = useToastStore()
const draft = ref<OfflineConfig | null>(null)
const messages = computed({
  get: () => ({ offline: draft.value?.msg || '', mysteryArrival: '', mysteryPurchase: '', ...draft.value?.mysteryMessages }),
  set: ({ offline, mysteryArrival, mysteryPurchase }) => {
    if (draft.value) {
      draft.value.msg = offline
      draft.value.mysteryMessages = { mysteryArrival, mysteryPurchase }
    }
  },
})

const hasDefault = ref(false)
const loadingDefault = ref(true)
const showApplyDefault = ref(false)
type Action = 'save' | 'test' | 'set-default' | 'apply-default'
const pending = ref<Action | ''>('')
const controlsDisabled = computed(() => !draft.value || !!pending.value)

watch([currentAccountId, loadedAccountId, () => settings.value.offlineReminder], ([accountId, loaded, saved]) => {
  if (!accountId || loaded !== accountId) {
    draft.value = null
    return
  }
  draft.value = { ...JSON.parse(JSON.stringify(saved)) as OfflineConfig, title: '' }
}, { immediate: true })
watch(currentAccountId, () => { showApplyDefault.value = false })

onMounted(async () => {
  try {
    hasDefault.value = (await settingStore.fetchOfflineDefault()).exists
  }
  finally {
    loadingDefault.value = false
  }
})

async function run(action: Action, execute: (config: OfflineConfig, accountId: string) => Promise<{ ok: boolean, error?: string }>, success: string) {
  const accountId = currentAccountId.value
  if (!draft.value || !accountId || accountId !== loadedAccountId.value || pending.value)
    return
  pending.value = action
  try {
    const result = await execute(draft.value, accountId)
    if (currentAccountId.value !== accountId)
      return
    if (result.ok)
      toast.success(success)
    else
      toast.error(result.error || '操作失败')
  }
  catch (error) {
    if (currentAccountId.value === accountId)
      toast.error(getApiErrorMessage(error, '操作失败'))
  }
  finally {
    pending.value = ''
  }
}

function save() {
  return run('save', settingStore.saveOfflineConfig, '推送通知已保存')
}

function testNotification() {
  return run('test', async (config, accountId) => {
    const { data } = await api.post('/api/settings/offline-reminder/test', config, { headers: { 'x-account-id': accountId } })
    return data?.ok ? { ok: true } : { ok: false, error: getApiErrorMessage(data, '发送测试通知失败') }
  }, '三类测试通知均发送成功')
}

function saveDefault() {
  return run('set-default', async (config) => {
    const result = await settingStore.saveOfflineDefault(config)
    if (result.ok)
      hasDefault.value = true
    return result
  }, '通知默认设置已保存')
}

function applyDefault() {
  showApplyDefault.value = false
  return run('apply-default', (_config, accountId) => settingStore.applyOfflineDefault(accountId), '通知默认设置已应用到当前账号')
}
</script>

<template>
  <SettingsPanel>
    <BaseButton variant="secondary" :loading="pending === 'set-default'" :disabled="controlsDisabled || loadingDefault" @click="saveDefault">
      <span class="i-carbon-bookmark" />
      <span>设为默认设置</span>
    </BaseButton>
    <BaseButton variant="secondary" :loading="pending === 'apply-default'" :disabled="controlsDisabled || loadingDefault || !hasDefault" @click="showApplyDefault = true">
      <span class="i-carbon-checkmark" />
      <span>应用默认设置</span>
    </BaseButton>
    <BaseButton variant="primary" :loading="pending === 'save'" :disabled="controlsDisabled" @click="save">
      <span class="i-carbon-save" />
      <span>保存</span>
    </BaseButton>
    <BaseButton variant="success" class="toolbar-control ml-auto !w-auto !min-w-0" :loading="pending === 'test'" :disabled="controlsDisabled" @click="testNotification">
      测试全部通知
    </BaseButton>

    <template #body>
      <div v-if="draft" class="space-y-3">
        <OfflineReminderCard v-model:config="draft" :disabled="!!pending" />
        <NotificationFields v-model:types="draft.notificationTypes" v-model:messages="messages" :disabled="!!pending" />
      </div>
      <p v-else-if="!currentAccountId" class="text-sm text-gray-500" role="status">请先选择账号</p>
      <p v-else-if="loading" class="text-sm text-gray-500" role="status">读取中…</p>
      <BaseButton v-else variant="secondary" size="sm" @click="settingStore.fetchSettings(currentAccountId)">重新读取</BaseButton>
      <QqBotPushSettings />
    </template>
  </SettingsPanel>

  <ConfirmModal
    :show="showApplyDefault"
    title="应用通知默认设置"
    message="将用已保存的通知默认设置覆盖当前账号的推送通知配置，确认应用？"
    type="danger"
    confirm-text="确认应用"
    :loading="pending === 'apply-default'"
    @confirm="applyDefault"
    @close="showApplyDefault = false"
    @cancel="showApplyDefault = false"
  />
</template>
