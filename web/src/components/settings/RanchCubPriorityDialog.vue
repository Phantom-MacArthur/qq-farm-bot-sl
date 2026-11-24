<script setup lang="ts">
import type { RanchItem } from '@/stores/ranch'
import type { AutomationConfig } from '@/stores/setting'
import { NButton } from 'naive-ui/es/button'
import { NModal } from 'naive-ui/es/modal'
import { computed, nextTick, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import CommerceItemImage from '@/components/commerce/CommerceItemImage.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { formatCount } from '@/components/ranch/ranch-shared'

const props = defineProps<{ accountId: string, connected: boolean, saving: boolean }>()
const emit = defineEmits<{ save: [] }>()
const show = defineModel<boolean>('show', { required: true })
const automation = defineModel<AutomationConfig>({ required: true })
const groups = [
  { housing: '窝', key: 'ranch_coop_cub_priority' },
  { housing: '棚', key: 'ranch_shed_cub_priority' },
] as const
type PriorityKey = typeof groups[number]['key']
interface CubStack extends RanchItem {
  animalId: number | null
  husbandryType: string | null
  locked: boolean
  requiredLevel: number | null
}

const inventory = ref<CubStack[]>([])
const loading = ref(false)
const error = ref('')
const status = ref('')
const dragging = ref<{ key: PriorityKey, id: number } | null>(null)

watch([show, () => props.accountId, () => props.connected], async ([visible, accountId, connected], _, onCleanup) => {
  if (!visible)
    return
  inventory.value = []
  loading.value = connected && !!accountId
  error.value = ''
  status.value = ''
  dragging.value = null
  if (!accountId || !connected)
    return
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  try {
    const { data } = await api.get('/api/ranch', {
      params: { view: 'bag' },
      headers: { 'x-account-id': accountId },
      signal: controller.signal,
      timeout: 45000,
      skipErrorToast: true,
    } as any)
    if (controller.signal.aborted)
      return
    if (!data.ok || !data.data?.unlocked) {
      error.value = data.error || data.data?.reason || '读取背包失败'
      return
    }
    inventory.value = data.data.bag
  }
  catch (cause) {
    if (!controller.signal.aborted)
      error.value = getApiErrorMessage(cause, '读取背包失败')
  }
  finally {
    if (!controller.signal.aborted)
      loading.value = false
  }
}, { immediate: true })

const sorted = computed(() => {
  const stock = new Map<string, CubStack>()
  for (const item of inventory.value) {
    if (!item.animalId || BigInt(item.count) <= 0n)
      continue
    const key = `${item.id}:${!!item.locked}`
    const count = BigInt(stock.get(key)?.count ?? '0') + BigInt(item.count)
    stock.set(key, { ...item, count: count.toString() })
  }
  return groups.map((group) => {
    const order = automation.value[group.key] ?? []
    const ranks = new Map(order.map((id, index) => [id, index]))
    const cubs = [...stock.values()].filter(item => item.husbandryType === group.housing)
    cubs.sort((a, b) => Number(a.locked) - Number(b.locked) || (ranks.get(a.id) ?? order.length) - (ranks.get(b.id) ?? order.length)
      || b.animalId! - a.animalId! || a.id - b.id)
    return { ...group, cubs }
  })
})

function move(key: PriorityKey, id: number, target: number, control?: EventTarget | null) {
  if (props.saving)
    return
  const cubs = sorted.value.find(group => group.key === key)!.cubs.filter(cub => !cub.locked)
  const from = cubs.findIndex(cub => cub.id === id)
  if (from < 0 || target < 0 || target >= cubs.length || target === from)
    return
  const order = cubs.map(cub => cub.id)
  order.splice(from, 1)
  order.splice(target, 0, id)
  const visible = new Set(order)
  let position = 0
  // 缺货幼崽保留已保存的位置，补货后仍按原优先级放养。
  const merged = (automation.value[key] ?? []).map(item => visible.has(item) ? order[position++]! : item)
  automation.value = { ...automation.value, [key]: [...merged, ...order.slice(position)] }
  status.value = `${cubs[from]!.name}已移到第 ${target + 1} 位`
  if (control instanceof HTMLElement) {
    void nextTick(() => {
      if (control.isConnected)
        control.focus({ preventScroll: true })
    })
  }
}

function startDrag(key: PriorityKey, id: number, event: DragEvent) {
  if (!event.dataTransfer)
    return
  dragging.value = { key, id }
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(id))
}

function dragOver(key: PriorityKey, event: DragEvent) {
  if (dragging.value?.key === key)
    event.preventDefault()
}

function drop(key: PriorityKey, target: number) {
  if (dragging.value?.key === key)
    move(key, dragging.value.id, target)
  dragging.value = null
}
</script>

<template>
  <NModal v-model:show="show" :auto-focus="false" :mask-closable="!saving" :close-on-esc="!saving">
    <section class="settings-dialog settings-dialog--padded h-[524px] max-h-[calc(100dvh-48px)] w-[464px] max-w-[calc(100vw-24px)] overflow-y-auto" role="dialog" aria-modal="true" aria-label="背包幼崽">
      <div class="cub-priority">
        <div class="flex items-center justify-between gap-2">
          <h5 class="settings-dialog__title">
            背包幼崽优先顺序
          </h5>
          <BaseButton variant="secondary" size="sm" :loading="saving" @click="emit('save')">保存</BaseButton>
        </div>
        <p class="cub-priority__hint cub-priority__state" title="按窝、棚分别排序；锁定幼崽仅展示，不参与自动放养。">按窝、棚分别排序；锁定幼崽仅展示，不参与自动放养。</p>
        <p v-if="!connected" class="cub-priority__state">
          账号未在线，暂时无法读取库存
        </p>
        <p v-else-if="loading" class="cub-priority__state">
          正在读取背包幼崽…
        </p>
        <p v-else-if="error" class="settings-error" role="alert">
          {{ error }}
        </p>
        <div v-else class="cub-priority__cards">
          <p v-if="sorted.every(group => !group.cubs.length)" class="cub-priority__state col-span-4">
              暂无背包幼崽
          </p>
          <template v-for="group in sorted" :key="group.key">
            <ol class="contents m-0 list-none p-0" role="list" :aria-label="`${group.housing}的幼崽优先顺序`">
              <li
                v-for="(cub, index) in group.cubs"
                :key="`${cub.id}:${!!cub.locked}`"
                class="cub-priority__item"
                :class="{ 'opacity-60': dragging?.id === cub.id }"
                :draggable="!saving && !cub.locked && group.cubs.filter(item => !item.locked).length > 1"
                @dragstart="startDrag(group.key, cub.id, $event)"
                @dragend="dragging = null"
                @dragover="!cub.locked && dragOver(group.key, $event)"
                @drop.prevent="!cub.locked && drop(group.key, index)"
              >
                <div class="flex items-center justify-between gap-1 whitespace-nowrap">
                  <span class="cub-priority__index" aria-hidden="true">{{ cub.locked ? '—' : `#${index + 1}` }}</span>
                  <span class="cub-priority__state">{{ group.housing }} Lv.{{ cub.requiredLevel ?? '?' }}</span>
                  <NButton
                    quaternary circle size="tiny"
                    class="bag-item__action-tiny cub-priority__top"
                    :disabled="saving || cub.locked || index === 0"
                    :aria-label="`置顶${cub.name}`"
                    :title="cub.locked ? '已锁定' : index === 0 ? '已置顶' : '置顶'"
                    @click.stop="move(group.key, cub.id, 0, $event.currentTarget)"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
                      <path d="M5 4h14M12 20V8m-5 5 5-5 5 5" />
                    </svg>
                  </NButton>
                </div>
                <div class="min-w-0 flex flex-col items-center gap-px">
                  <CommerceItemImage :src="cub.image" :alt="cub.name" size="sm" class="cub-priority__image" />
                  <div class="w-full truncate text-center text-[13px] font-medium" :title="cub.name">{{ cub.name }}</div>
                  <div class="cub-priority__state">×{{ formatCount(cub.count) }}<span v-if="cub.locked" class="i-carbon-locked ml-1 inline-block" title="已锁定" role="img" aria-label="已锁定" /></div>
                </div>
              </li>
            </ol>
          </template>
        </div>
        <p class="sr-only" role="status">
          {{ status }}
        </p>
      </div>
    </section>
  </NModal>
</template>

<style scoped>
.cub-priority {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cub-priority__item {
  min-width: 0;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
}
.cub-priority__hint {
  height: 18px;
  line-height: 18px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.cub-priority__cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-auto-rows: 104px;
  align-content: start;
  height: 434px;
  overflow-y: auto;
  gap: 6px;
}

.cub-priority__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  background: var(--ui-surface-soft);
}

.cub-priority__image { width: 28px; height: 28px; }
.cub-priority__top { --n-height: 20px !important; --n-width: 20px !important; margin: 0; padding: 0; }

.cub-priority__item[draggable='true'] {
  cursor: grab;
}

.cub-priority__item :deep(button[aria-disabled='true']) {
  opacity: 0.35;
  cursor: default;
}

.cub-priority__index,
.cub-priority__state {
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-variant-numeric: tabular-nums;
}
</style>
