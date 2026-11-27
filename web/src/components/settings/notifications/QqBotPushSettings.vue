<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

interface BotState {
  enabled: boolean
  appId: string
  appSecretConfigured: boolean
  openid: string
  offlineNotify: boolean
  status: { connected: boolean, connecting: boolean, lastError: string, users: { openid: string, nickname: string }[] } | null
}

const endpoint = '/api/settings/qq-bot-push'
const state = ref<BotState | null>(null)
const draft = ref({ enabled: false, appId: '', appSecret: '', openid: '', offlineNotify: true })
const pending = ref(false)
const feedback = ref('')
const failed = ref(false)

async function run(action: 'read' | 'save' | 'capture' | 'test') {
  if (pending.value)
    return
  pending.value = true
  feedback.value = ''
  failed.value = false
  try {
    const { data } = action === 'read' ? await api.get(endpoint)
      : action === 'save' ? await api.post(endpoint, draft.value)
        : await api.post(`${endpoint}/${action}`, {})
    if (!data?.ok)
      throw new Error(getApiErrorMessage(data, '操作失败'))
    if (action !== 'test') {
      const previous = state.value
      state.value = data.data as BotState
      if (action === 'save' || !previous) {
        const { enabled, appId, openid, offlineNotify } = state.value
        draft.value = { enabled, appId, openid, offlineNotify, appSecret: '' }
      }
    }
    if (action === 'save')
      feedback.value = 'QQ 机器人设置已保存'
    if (action === 'capture')
      feedback.value = '请从要接收通知的 QQ 给机器人发一条私聊，再点「刷新接收人」。'
    if (action === 'test')
      feedback.value = '测试通知已发送'
  }
  catch (error) {
    failed.value = true
    feedback.value = getApiErrorMessage(error, 'QQ 机器人操作失败')
  }
  finally {
    pending.value = false
  }
}

onMounted(() => void run('read'))
</script>

<template>
  <section class="settings-group space-y-3">
    <div class="settings-group__title">QQ 机器人私聊</div>
    <div v-if="state" class="space-y-3">
      <BaseSwitch v-model="draft.enabled" label="发送重要农场动态" :disabled="pending" />
      <BaseSwitch v-if="draft.enabled" v-model="draft.offlineNotify" label="同时发送掉线提醒" :disabled="pending" />
      <div class="grid gap-2 sm:grid-cols-2">
        <BaseInput v-model="draft.appId" label="AppID" :disabled="pending" />
        <BaseInput v-model="draft.appSecret" label="AppSecret" type="password" :disabled="pending" :placeholder="state.appSecretConfigured ? '已保存，留空可沿用' : ''" />
        <BaseInput v-model="draft.openid" label="接收人 OpenID" :disabled="pending" />
        <BaseSelect
          v-if="state.status?.users.length"
          label="选择已发现的接收人"
          :model-value="draft.openid"
          :disabled="pending"
          :options="state.status.users.map(user => ({ value: user.openid, label: user.nickname || user.openid }))"
          @change="value => draft.openid = String(value)"
        />
      </div>
      <div class="flex flex-wrap gap-2">
        <BaseButton variant="primary" :disabled="pending" @click="run('save')">保存 QQ 机器人</BaseButton>
        <BaseButton variant="secondary" :disabled="pending || !state.enabled" @click="run('capture')">监听接收人</BaseButton>
        <BaseButton variant="secondary" :disabled="pending" @click="run('read')">刷新接收人</BaseButton>
        <BaseButton variant="secondary" :disabled="pending || !state.enabled || !state.openid" @click="run('test')">发送测试</BaseButton>
      </div>
      <p v-if="state.enabled && state.status?.lastError" class="settings-note" role="status">{{ state.status.lastError }}</p>
    </div>
    <BaseButton v-else-if="failed" variant="secondary" :disabled="pending" @click="run('read')">重新读取 QQ 机器人设置</BaseButton>
    <p v-if="feedback" class="settings-note" :role="failed ? 'alert' : 'status'">{{ feedback }}</p>
  </section>
</template>
