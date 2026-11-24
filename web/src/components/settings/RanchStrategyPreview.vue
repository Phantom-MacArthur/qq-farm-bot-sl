<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'

const props = withDefaults(defineProps<{ accountId: string, connected: boolean, title: string, showRefresh?: boolean }>(), { showRefresh: true })
interface AnimalGood {
  available: boolean
  requiredLevel: string | null
  price: { id: number, count: string }
  animal: { id: number, name: string, husbandry_type: string, enable_flag: boolean } | null
}
const goods = ref<AnimalGood[]>([])
const loading = ref(false)
const error = ref('')
const revision = ref(0)
watch([() => props.accountId, () => props.connected, revision], async ([accountId, connected], _, onCleanup) => {
  goods.value = []
  error.value = ''
  loading.value = !!accountId && connected
  if (!accountId || !connected)
    return
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  try {
    const { data } = await api.get('/api/ranch', {
      params: { view: 'shop', shopId: 5 },
      headers: { 'x-account-id': accountId },
      signal: controller.signal,
      timeout: 45000,
      skipErrorToast: true,
    } as any)
    if (controller.signal.aborted)
      return
    if (!data.ok || !data.data?.unlocked)
      error.value = data.error || data.data?.reason || '读取牧场商店失败'
    else
      goods.value = data.data.shop.goods
  }
  catch (cause) {
    if (!controller.signal.aborted)
      error.value = getApiErrorMessage(cause, '读取牧场商店失败')
  }
  finally {
    if (!controller.signal.aborted)
      loading.value = false
  }
}, { immediate: true })
const previews = computed(() => ['窝', '棚'].map((kind) => {
  const best = goods.value.filter(good => good.available && good.animal?.enable_flag
    && good.animal.husbandry_type === kind && good.price.id === 1007 && BigInt(good.price.count) > 0n)
    .sort((a, b) => Number(b.requiredLevel || 0) - Number(a.requiredLevel || 0) || b.animal!.id - a.animal!.id)[0]
  return { kind, text: best ? `${best.animal!.name} · ${best.requiredLevel == null ? '解锁等级未知' : `解锁 Lv.${best.requiredLevel}`}` : '暂无可购买动物' }
}))
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between gap-2">
      <span class="base-field__label">{{ title }}</span>
      <BaseButton v-if="showRefresh" variant="ghost" :disabled="!connected || loading" @click="revision++">刷新预览</BaseButton>
    </div>
    <p v-if="!connected" class="settings-note">账号未在线，暂时无法读取预览</p>
    <p v-else-if="loading" class="settings-note" role="status">正在读取牧场商店…</p>
    <p v-else-if="error" class="settings-error" role="alert">{{ error }}</p>
    <div v-else class="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div v-for="item in previews" :key="item.kind" class="settings-preview" :title="`${item.kind} · ${item.text}`">
        <span class="truncate">{{ item.kind }} · {{ item.text }}</span>
      </div>
    </div>
  </div>
</template>
