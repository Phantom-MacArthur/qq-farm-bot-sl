<script setup lang="ts">
import type { ActivityDirectoryItemDto } from '@/stores/activity-center'
import { useNow } from '@vueuse/core'
import { NModal } from 'naive-ui/es/modal'
import { computed, ref, watch } from 'vue'
import api from '@/api'
import { resolveActivityGameplay } from '@/components/activity/gameplays'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { normalizeActivityDirectory } from '@/stores/activity-center'
import { MUGE_REWARD_OPTIONS } from '@/utils/account-feature-modules'

const props = defineProps<{ accountId: string, connected: boolean }>()
const automation = defineModel<Record<string, any>>({ required: true })
const now = useNow({ interval: 1000 })
const sources = [
  '/api/activity-center/activities',
  '/api/activity-center/ranch-activities',
] as const
const directories = ref<Array<{
  items: ActivityDirectoryItemDto[]
  clockOffset: number
}>>([])
const loading = ref(false)
const failed = ref(false)

watch([() => props.accountId, () => props.connected], async ([accountId, connected], _, onCleanup) => {
  directories.value = []
  failed.value = false
  loading.value = false
  if (!accountId || !connected)
    return

  const controller = new AbortController()
  onCleanup(() => controller.abort())
  loading.value = true
  const results = await Promise.allSettled(sources.map(async (path) => {
    const { data } = await api.get(path, {
      headers: { 'x-account-id': accountId },
      signal: controller.signal,
      skipErrorToast: true,
    } as any)
    if (!data?.ok || !Array.isArray(data.data?.activities))
      throw new Error('活动读取失败')
    const serverTime = Number(data.data.serverTime)
    return {
      items: normalizeActivityDirectory(data.data.activities),
      clockOffset: serverTime > 0 ? serverTime * 1000 - Date.now() : 0,
    }
  }))
  if (controller.signal.aborted)
    return
  directories.value = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  failed.value = results.some(result => result.status === 'rejected')
  loading.value = false
}, { immediate: true })

const activeActivities = computed(() => {
  const seen = new Set<string>()
  return directories.value.flatMap(({ items, clockOffset }) => {
    const serverNow = now.value.getTime() + clockOffset
    return items.flatMap((activity) => {
      if (!activity.id || !activity.name || seen.has(activity.id)
        || activity.startTime !== null && serverNow < activity.startTime
        || activity.endTime !== null && serverNow >= activity.endTime)
        return []
      if (resolveActivityGameplay(activity)?.module.key !== 'muge')
        return []
      seen.add(activity.id)
      return [{ id: activity.id, name: activity.name }]
    })
  })
})

type SettingsActivity = typeof activeActivities.value[number]
const selectedActivity = ref<SettingsActivity | null>(null)
const mugeDraft = ref<Record<typeof MUGE_REWARD_OPTIONS[number]['key'], boolean>>({
  muge_claim_celebration: false,
  muge_claim_friends: false,
  muge_claim_handbook: false,
  muge_claim_personality: false,
})
function openSettings(activity: SettingsActivity) {
  for (const { key } of MUGE_REWARD_OPTIONS)
    mugeDraft.value[key] = automation.value[key] === true
  selectedActivity.value = activity
}
function confirmSettings() {
  Object.assign(automation.value, mugeDraft.value)
  selectedActivity.value = null
}
</script>

<template>
  <section class="settings-group space-y-2">
    <h4 class="settings-group__title">活动设置</h4>
    <div v-if="activeActivities.length" class="flex flex-wrap gap-2">
      <BaseButton v-for="activity in activeActivities" :key="activity.id" variant="secondary" size="sm" @click="openSettings(activity)">
        {{ activity.name }}
      </BaseButton>
    </div>
    <p v-if="!connected || loading || failed || !activeActivities.length" :class="connected && !loading && failed ? 'settings-error' : 'settings-note'" role="status">
      {{ !connected ? '账号上线后显示进行中的活动' : loading ? '正在读取活动…' : failed ? (activeActivities.length ? '部分活动读取失败' : '活动读取失败') : '当前没有已适配的进行中活动' }}
    </p>
  </section>
  <NModal
    :show="selectedActivity !== null"
    @update:show="!$event && (selectedActivity = null)"
  >
    <section class="settings-dialog max-w-[480px] w-[92vw]" role="dialog" aria-modal="true" :aria-label="selectedActivity?.name">
      <header class="settings-dialog__header border-b">
        <h3 class="settings-dialog__title">{{ selectedActivity?.name }}</h3>
      </header>
      <div class="settings-dialog__body grid grid-cols-2 gap-2">
        <BaseSwitch v-for="option in MUGE_REWARD_OPTIONS" :key="option.key" v-model="mugeDraft[option.key]" :label="option.label" :aria-label="option.label" />
      </div>
      <footer class="settings-dialog__footer flex justify-end gap-2 border-t">
        <BaseButton size="sm" @click="confirmSettings">保存</BaseButton>
        <BaseButton variant="secondary" size="sm" @click="selectedActivity = null">取消</BaseButton>
      </footer>
    </section>
  </NModal>
</template>
