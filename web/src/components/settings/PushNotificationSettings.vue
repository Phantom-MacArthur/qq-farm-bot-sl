<script setup lang="ts">
import type { PushChannelChange, PushSettings } from '@/utils/push-notifications'
import { onMounted, ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import PushChannelsManager from '@/components/settings/PushChannelsManager.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useToastStore } from '@/stores/toast'
import { normalizePushSettings } from '@/utils/push-notifications'

const endpoint = '/api/settings/push-notifications'
const toast = useToastStore()
const config = ref(normalizePushSettings())
const form = ref({ title: '', msg: '', notificationTypes: { ...config.value.notificationTypes } })
const loading = ref(true)
const loaded = ref(false)
const saving = ref(false)

async function load() {
  loading.value = true
  try {
    const { data } = await api.get(endpoint)
    if (!data?.ok) throw new Error(getApiErrorMessage(data, '推送设置读取失败'))
    config.value = normalizePushSettings(data.data)
    const { title, msg, notificationTypes } = config.value
    form.value = { title, msg, notificationTypes: { ...notificationTypes } }
    loaded.value = true
  }
  catch (error) {
    toast.error(getApiErrorMessage(error, '推送设置读取失败'))
  }
  finally {
    loading.value = false
  }
}

async function save(update: Partial<PushSettings> | PushChannelChange) {
  if (saving.value) return false
  saving.value = true
  try {
    const { data } = await api.post(endpoint, update)
    if (!data?.ok) throw new Error(getApiErrorMessage(data, '推送设置保存失败'))
    config.value = normalizePushSettings(data.data)
    return true
  }
  catch (error) {
    toast.error(getApiErrorMessage(error, '推送设置保存失败'))
    return false
  }
  finally {
    saving.value = false
  }
}

async function saveChannel(change: PushChannelChange, onDone: (ok: boolean) => void) {
  onDone(await save(change))
}

async function saveForm() {
  if (await save(form.value))
    toast.success('推送设置已保存')
}

onMounted(load)
</script>

<template>
  <section class="page-card-surface rounded-lg margin-shell">
    <div class="margin-content !m-3 space-y-3">
      <div v-if="loading" class="text-sm text-gray-500" role="status">读取中…</div>
      <BaseButton v-else-if="!loaded" size="sm" variant="secondary" @click="load">重新读取</BaseButton>
      <template v-else>
        <PushChannelsManager :config="config" :supports-channels="true" :saving="saving" @save-channel="saveChannel" />
        <div class="flex flex-wrap gap-3">
          <BaseSwitch v-model="form.notificationTypes.offline" label="账号下线" />
          <BaseSwitch v-model="form.notificationTypes.mysteryArrival" label="神秘商店到访" />
          <BaseSwitch v-model="form.notificationTypes.mysteryPurchase" label="神秘商店购买" />
        </div>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <BaseInput v-model="form.title" label="下线通知标题" placeholder="默认使用账号备注" />
          <BaseInput v-model="form.msg" label="下线通知内容" placeholder="默认使用农场下线" />
        </div>
        <div class="flex justify-end">
          <BaseButton size="sm" variant="primary" :loading="saving" @click="saveForm">保存</BaseButton>
        </div>
      </template>
    </div>
  </section>
</template>
