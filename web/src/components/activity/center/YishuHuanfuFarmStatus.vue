<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import api from '@/api'
import { yishuTime } from './yishu-huanfu-details'

interface YishuCrop {
  matureAt: number | null
  ready: boolean
}

const props = defineProps<{ accountId: string, active: boolean, refreshVersion: number }>()
const crops = ref<YishuCrop[] | null>(null)
const ready = computed(() => crops.value?.filter(crop => crop.ready).length ?? 0)
const maturityRange = computed(() => {
  const times = (crops.value ?? []).flatMap(crop => !crop.ready && crop.matureAt !== null ? [crop.matureAt] : [])
  return times.length ? { earliest: Math.min(...times), latest: Math.max(...times) } : null
})

watch(() => [props.accountId, props.active, props.refreshVersion] as const, async ([accountId, active], previous, onCleanup) => {
  if (accountId !== previous?.[0] || active !== previous?.[1])
    crops.value = null
  if (!accountId || !active)
    return

  const controller = new AbortController()
  onCleanup(() => controller.abort())
  try {
    const { data } = await api.get('/api/activity-center/yishuhuanfu/farm', {
      headers: { 'x-account-id': accountId },
      signal: controller.signal,
    })
    if (!controller.signal.aborted && data?.ok && Array.isArray(data.data?.crops))
      crops.value = data.data.crops
  } catch {
    // A failed refresh leaves the last successful reading visible.
  }
}, { immediate: true })
</script>

<template>
  <span v-if="ready || maturityRange" class="yishu-farm-status">
    <template v-if="ready">已成熟 {{ ready }} 块</template>
    <template v-if="maturityRange">
      <template v-if="ready"> · </template>最早 {{ yishuTime(maturityRange.earliest) }} 成熟 · 最晚 {{ yishuTime(maturityRange.latest) }} 成熟
    </template>
  </span>
</template>

<style scoped>
.yishu-farm-status {
  color: var(--ui-muted);
}
</style>
