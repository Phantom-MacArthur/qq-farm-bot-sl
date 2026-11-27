<script setup lang="ts">
import type { ActivityDirectoryItemDto } from '@/stores/activity-center'
import type { RouteLocationRaw } from 'vue-router'
import { useNow } from '@vueuse/core'
import { NModal } from 'naive-ui/es/modal'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import { resolveActivityGameplay } from '@/components/activity/gameplays'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { normalizeActivityDirectory } from '@/stores/activity-center'
import { MUGE_REWARD_OPTIONS, SOLAR_REWARD_OPTIONS, YISHU_ACTIVITY_OPTIONS, yishuAutomationDraft } from '@/utils/account-feature-modules'
import YishuAutomationFields from './YishuAutomationFields.vue'

const props = defineProps<{ accountId: string, connected: boolean }>()
const automation = defineModel<Record<string, any>>({ required: true })
const router = useRouter()
const now = useNow({ interval: 1000 })
const sources = [
  { path: '/api/activity-center/activities', routeName: 'activity-center' },
  { path: '/api/activity-center/ranch-activities', routeName: 'ranch-activity-center' },
] as const
const directories = ref<Partial<Record<typeof sources[number]['routeName'], {
  items: ActivityDirectoryItemDto[]
  clockOffset: number
}>>>({})
const failed = ref(false)

watch([() => props.accountId, () => props.connected], async ([accountId, connected], _, onCleanup) => {
  directories.value = {}
  failed.value = false
  if (!accountId || !connected)
    return

  const controller = new AbortController()
  onCleanup(() => controller.abort())
  await Promise.all(sources.map(async ({ path, routeName }) => {
    try {
      const { data } = await api.get(path, {
        headers: { 'x-account-id': accountId },
        signal: controller.signal,
        skipErrorToast: true,
      } as any)
      if (controller.signal.aborted)
        return
      if (!data?.ok || !Array.isArray(data.data?.activities))
        throw new Error('活动读取失败')
      const serverTime = Number(data.data.serverTime)
      directories.value[routeName] = {
        items: normalizeActivityDirectory(data.data.activities),
        clockOffset: serverTime > 0 ? serverTime * 1000 - Date.now() : 0,
      }
    }
    catch {
      if (!controller.signal.aborted)
        failed.value = true
    }
  }))
}, { immediate: true })

const activeActivities = computed(() => {
  const seen = new Set<string>()
  return sources.flatMap(({ routeName }) => {
    const directory = directories.value[routeName]
    if (!directory)
      return []
    const serverNow = now.value.getTime() + directory.clockOffset
    return directory.items.flatMap((activity) => {
      if (!activity.id || !activity.name || seen.has(activity.id)
        || activity.startTime !== null && serverNow < activity.startTime
        || activity.endTime !== null && serverNow >= activity.endTime)
        return []
      if (resolveActivityGameplay(activity)?.module.key !== 'muge')
        return []
      seen.add(activity.id)
      return [{
        id: activity.id,
        name: activity.name,
        kind: 'muge',
        to: { name: routeName, query: { activity: 'muge' } },
      } satisfies SettingsActivity]
    })
  })
})

const activityOptions = {
  muge: MUGE_REWARD_OPTIONS,
  solar: SOLAR_REWARD_OPTIONS,
  yishu: YISHU_ACTIVITY_OPTIONS,
}
type SettingsActivity = { id: string, name: string, kind: keyof typeof activityOptions, to: RouteLocationRaw }
const calendarSettings: SettingsActivity = { id: 'solar', name: '节令日历', kind: 'solar', to: { name: 'solar-calendar' } }
const yishuSettings: SettingsActivity = {
  id: 'yishu',
  name: '以薯换福',
  kind: 'yishu',
  to: { name: 'activity-center', query: { activity: 'yishuhuanfu' } },
}
const selectedActivity = ref<SettingsActivity | null>(null)
const options = computed(() => selectedActivity.value ? activityOptions[selectedActivity.value.kind] : [])
const switches = ref<Record<string, boolean>>({})
const yishuDraft = ref<Record<string, any>>({})
watch(() => props.accountId, () => { selectedActivity.value = null }, { flush: 'sync' })

function openSettings(activity: SettingsActivity) {
  switches.value = Object.fromEntries(activityOptions[activity.kind].map(({ key }) => [key, automation.value[key] === true]))
  if (activity.kind === 'yishu')
    yishuDraft.value = yishuAutomationDraft(automation.value)
  selectedActivity.value = activity
}
function confirmSettings() {
  if (!selectedActivity.value)
    return
  Object.assign(automation.value, selectedActivity.value.kind === 'yishu' ? yishuDraft.value : switches.value)
  selectedActivity.value = null
}
</script>

<template>
  <section class="settings-group space-y-2">
    <h4 class="settings-group__title">活动设置</h4>
    <div class="flex flex-wrap gap-2">
      <div v-for="activity in [calendarSettings, yishuSettings, ...activeActivities]" :key="activity.id" class="inline-flex items-center gap-1">
        <BaseButton variant="secondary" size="sm" :to="router.resolve(activity.to).fullPath">
          {{ activity.name }}
        </BaseButton>
        <BaseButton variant="ghost" size="sm" :aria-label="`${activity.name}自动化设置`" @click="openSettings(activity)">
          设置
        </BaseButton>
      </div>
    </div>
    <p v-if="!connected || failed" :class="connected ? 'settings-error' : 'settings-note'" role="status">
      {{ !connected ? '账号上线后显示进行中的牧歌活动' : '部分活动目录读取失败' }}
    </p>
  </section>
  <NModal
    :show="selectedActivity !== null"
    @update:show="!$event && (selectedActivity = null)"
  >
    <div class="settings-dialog max-w-[480px] w-[92vw]" role="dialog" aria-modal="true" :aria-label="selectedActivity?.name">
      <header class="settings-dialog__header border-b">
        <h3 class="settings-dialog__title">{{ selectedActivity?.name }}</h3>
      </header>
      <div class="settings-dialog__body space-y-3">
        <YishuAutomationFields v-if="selectedActivity?.kind === 'yishu'" v-model="yishuDraft" />
        <div v-else class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <BaseSwitch v-for="option in options" :key="option.key" v-model="switches[option.key]" :label="option.label" :aria-label="option.label" />
        </div>
      </div>
      <footer class="settings-dialog__footer flex justify-end gap-2 border-t">
        <BaseButton size="sm" @click="confirmSettings">确定</BaseButton>
        <BaseButton variant="secondary" size="sm" @click="selectedActivity = null">取消</BaseButton>
      </footer>
    </div>
  </NModal>
</template>
