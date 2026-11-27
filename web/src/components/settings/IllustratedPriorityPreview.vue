<script setup lang="ts">
import { NModal } from 'naive-ui/es/modal'
import { NPopover } from 'naive-ui/es/popover'
import { computed, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import CommerceItemImage from '@/components/commerce/CommerceItemImage.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'

const props = defineProps<{ kind: 'farm' | 'ranch', accountId: string, connected: boolean, asFallback?: boolean }>()
interface Target {
  id: number
  name: string
  image: string
  level: number | null
  limited: boolean
  housing: string
  unlocked: boolean
  active: boolean
}
const targets = ref<Target[]>([])
const loading = ref(false)
const error = ref('')
const completionFilter = ref('missing')
const completionOptions = [
  { label: '全部', value: 'all' },
  { label: '未点亮', value: 'missing' },
  { label: '已点亮', value: 'completed' },
]
const show = ref(false)
const strategyHelp = computed(() => {
  const explanation = '每种先安排一份，优先使用背包，缺货时按商店条件购买；已有同类时等待收获，以服务端点亮状态为准。'
  return explanation + (props.asFallback ? '剩余空地用买得起的最低价种子补种。' : '剩余空位按第二策略正常安排。')
})
const missing = computed(() => targets.value.filter(item => !item.unlocked))
const activeCount = computed(() => missing.value.filter(item => item.active).length)
const visible = computed(() => targets.value.filter(item => completionFilter.value === 'all'
  || (completionFilter.value === 'completed' ? item.unlocked : !item.unlocked))
  .slice().sort((a, b) => Number(a.unlocked) - Number(b.unlocked) || (a.level ?? Infinity) - (b.level ?? Infinity) || a.id - b.id))
watch([() => props.accountId, () => props.connected, () => props.kind, show], async ([accountId, connected, kind, opened], _, onCleanup) => {
  targets.value = []
  error.value = ''
  loading.value = !!accountId && connected && opened
  if (!accountId || !connected || !opened)
    return
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  async function read(url: string, params?: Record<string, unknown>) {
    const { data } = await api.get(url, { params, headers: { 'x-account-id': accountId }, signal: controller.signal, timeout: 45000, skipErrorToast: true } as any)
    if (!data?.ok)
      throw new Error(getApiErrorMessage(data, '图鉴预览读取失败'))
    return data.data
  }
  try {
    let result: Target[]
    // 串行读取，避免与自动巡查争抢请求队列。
    if (kind === 'farm') {
      const book = await read('/api/illustrated')
      const lands = await read('/api/lands')
      const growing = new Set<number>(lands.lands.map((land: any) => Number(land.seedId)))
      result = book.crop.items.map((item: any) => {
        const seed = item.shopSeed
        return {
          id: Number(item.seedId), name: item.name, image: seed?.image || item.image,
          level: seed?.requiredLevel ?? null, limited: !!item.limited, housing: '',
          unlocked: !!item.unlocked, active: growing.has(Number(item.seedId)),
        }
      })
    }
    else {
      const state = await read('/api/ranch', { view: 'illustrated' })
      if (!state.unlocked)
        throw new Error(state.reason || '牧场尚未解锁')
      const active = new Set<number>(state.facilities.flatMap((facility: any) => (facility.ranch?.animals || []).map((animal: any) => Number(animal.animalId))))
      result = state.book.animals.filter((item: any) => item.animalId).map((item: any) => {
        return {
          id: Number(item.animalId), name: item.animalName, image: item.image, level: item.requiredLevel,
          limited: false, housing: item.husbandryType || '',
          unlocked: !!item.unlocked, active: active.has(Number(item.animalId)),
        }
      })
    }
    if (!controller.signal.aborted)
      targets.value = result
  }
  catch (cause) {
    if (!controller.signal.aborted)
      error.value = getApiErrorMessage(cause, '图鉴预览读取失败')
  }
  finally {
    if (!controller.signal.aborted)
      loading.value = false
  }
}, { immediate: true })
</script>

<template>
  <NPopover trigger="hover" style="max-width: 320px" :keep-alive-on-hover="true">
    <template #trigger>
      <BaseButton
        variant="secondary"
        class="illustrated-target-trigger w-full self-end"
        :title="strategyHelp"
        aria-label="查看图鉴"
        @click="show = true"
      >
        <span class="col-start-2 truncate text-center">查看图鉴</span>
        <span class="i-carbon-information col-start-3 justify-self-end text-base text-gray-400" aria-hidden="true" />
      </BaseButton>
    </template>
    <span class="settings-note">{{ strategyHelp }}</span>
  </NPopover>
  <NModal v-model:show="show" :auto-focus="false" :mask-closable="true" :close-on-esc="true">
  <section class="settings-dialog settings-dialog--padded illustrated-target-dialog" role="dialog" aria-modal="true" aria-labelledby="illustrated-target-title">
    <div class="illustrated-target-header">
      <h5 id="illustrated-target-title" class="settings-dialog__title min-w-0 truncate">普通图鉴补齐目标</h5>
      <div class="flex gap-2">
        <BaseSelect v-model="completionFilter" :options="completionOptions" class="w-24" aria-label="图鉴点亮状态" />
        <BaseButton variant="secondary" size="sm" @click="show = false">关闭</BaseButton>
      </div>
    </div>
    <p v-if="!connected" class="settings-note">账号未在线，暂时无法读取图鉴。</p>
    <p v-else-if="loading" class="settings-note" role="status">正在读取图鉴与当前种养状态…</p>
    <p v-else-if="error" class="settings-error" role="alert">{{ error }}</p>
    <template v-else>
      <p class="illustrated-target-summary settings-note">待点亮 {{ missing.length }} 种 · 进行中 {{ activeCount }} 种 · 已点亮 {{ targets.length - missing.length }} 种</p>
      <div class="illustrated-target-grid">
        <article v-for="item in visible" :key="item.id" class="illustrated-target-card border-gray-200 dark:border-gray-700" :class="{ 'illustrated-target-card--locked': !item.unlocked }" :title="`${item.name}${item.unlocked ? ' · 已点亮' : ''}`">
          <div class="whitespace-nowrap text-[11px] text-gray-500">{{ item.housing }} {{ item.level == null ? '等级未知' : `Lv.${item.level}` }}<span v-if="item.limited"> (限定)</span></div>
          <CommerceItemImage :src="item.image" :alt="item.name" size="sm" class="illustrated-target-image" />
          <div class="w-full truncate text-center text-[13px]" :title="item.name">{{ item.name }}</div>
        </article>
      </div>
    </template>
  </section>
  </NModal>
</template>

<style scoped>
.illustrated-target-trigger {
  height: var(--ui-content-item-control-height-30);
  --n-color-focus: var(--n-color) !important;
  --n-text-color-focus: var(--n-text-color) !important;
  --n-border-focus: var(--n-border) !important;
}
.illustrated-target-trigger :deep(.n-button__content) {
  display: grid;
  width: 100%;
  grid-template-columns: 1rem minmax(0, 1fr) 1rem;
  align-items: center;
  column-gap: 4px;
}
.illustrated-target-dialog {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 464px;
  height: 412px;
  max-width: calc(100vw - 24px);
  max-height: calc(100dvh - 48px);
  overflow: auto;
}
.illustrated-target-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-auto-rows: 76px;
  height: 322px;
  flex-shrink: 0;
  overflow-y: auto;
  align-content: start;
  gap: 6px;
}
.illustrated-target-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 3px;
  border-width: 1px;
  border-style: solid;
  border-radius: 6px;
}
.illustrated-target-image { width: 28px; height: 28px; }
.illustrated-target-card--locked { color: var(--ui-subtle); }
.illustrated-target-card--locked .illustrated-target-image { filter: grayscale(1); opacity: 0.6; }
.illustrated-target-summary { height: 18px; flex-shrink: 0; line-height: 18px; }
.illustrated-target-header { display: flex; height: 30px; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 8px; }
</style>
