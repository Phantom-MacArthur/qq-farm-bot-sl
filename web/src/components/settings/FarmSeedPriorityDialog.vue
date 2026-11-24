<script setup lang="ts">
import type { BagSeedPriorityItemSeed } from './BagSeedPriorityItem.vue'
import { NModal } from 'naive-ui/es/modal'
import { ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import BagSeedPriorityItem from './BagSeedPriorityItem.vue'

const show = defineModel<boolean>('show', { required: true })
const props = defineProps<{
  seeds: BagSeedPriorityItemSeed[]
  landTypes: Record<string, string[]>
  landTypeOptions: Array<{ label: string, value: string, short?: string }>
  orphanRestrictedSeeds: Array<{ seedId: number, name: string, scope: string }>
  loading: boolean
  error: string | null
  saving: boolean
}>()
const emit = defineEmits<{
  save: []
  refresh: []
  reorder: [order: number[]]
  setLandTypes: [seedId: number, types: string[]]
}>()

const draggingBagSeedId = ref<number | null>(null)
watch(show, (visible) => {
  if (!visible)
    draggingBagSeedId.value = null
})

function toTopBagSeed(seedId: number) {
  if (props.saving)
    return
  const nextOrder = props.seeds.map(seed => seed.seedId)
  const index = nextOrder.indexOf(seedId)
  if (index <= 0)
    return
  nextOrder.splice(index, 1)
  nextOrder.unshift(seedId)
  emit('reorder', nextOrder)
}

function startBagSeedDrag(seedId: number, event: DragEvent) {
  if (props.saving) {
    event.preventDefault()
    return
  }
  draggingBagSeedId.value = seedId
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(seedId))
  }
}

function endBagSeedDrag() {
  draggingBagSeedId.value = null
}

function dragOverBagSeed(event: DragEvent) {
  if (draggingBagSeedId.value === null)
    return
  event.preventDefault()
  if (event.dataTransfer)
    event.dataTransfer.dropEffect = 'move'
}

function dropBagSeed(seedId: number, event: DragEvent) {
  event.preventDefault()
  const sourceSeedId = draggingBagSeedId.value ?? Number(event.dataTransfer?.getData('text/plain') || '')
  if (props.saving || !sourceSeedId || sourceSeedId === seedId) {
    endBagSeedDrag()
    return
  }

  const nextOrder = props.seeds.map(seed => seed.seedId)
  const sourceIndex = nextOrder.indexOf(sourceSeedId)
  const targetIndex = nextOrder.indexOf(seedId)
  if (sourceIndex < 0 || targetIndex < 0) {
    endBagSeedDrag()
    return
  }

  // 与目标直接交换位置（origin 同款拖拽语义），避免“插入到目标之前”导致向右拖动时几乎不换位的观感。
  const source = nextOrder[sourceIndex]!
  nextOrder[sourceIndex] = nextOrder[targetIndex]!
  nextOrder[targetIndex] = source
  emit('reorder', nextOrder)
  endBagSeedDrag()
}
</script>

<template>
  <NModal v-model:show="show" :auto-focus="false" :mask-closable="!saving" :close-on-esc="!saving">
    <section class="settings-dialog settings-dialog--padded bag-seeds-dialog max-h-[calc(100dvh-48px)] w-[464px] max-w-[calc(100vw-24px)] flex flex-col gap-2" role="dialog" aria-modal="true" aria-labelledby="bag-seeds-dialog-title">
      <header class="flex shrink-0 items-center justify-between gap-2">
        <h5 id="bag-seeds-dialog-title" class="settings-dialog__title">背包种子优先顺序</h5>
        <BaseButton variant="secondary" size="sm" :loading="saving" @click="emit('save')">保存</BaseButton>
      </header>
      <div class="bag-seeds-dialog__body min-h-0 overflow-y-auto space-y-2" :inert="saving">
        <div v-if="loading" class="settings-note py-3 text-center">
          加载中...
        </div>
        <div v-else-if="error" class="settings-error py-3 text-center">
          {{ error }}
          <RefreshButton label="重新读取" @click="emit('refresh')" />
        </div>
        <div v-else-if="seeds.length === 0" class="settings-note py-3 text-center">
          背包中暂无 1x1 / 2x2 种子
        </div>
        <div v-else class="bag-seeds-dialog__grid">
          <BagSeedPriorityItem
            v-for="(seed, index) in seeds"
            :key="seed.seedId"
            :seed="seed"
            :index="index"
            :land-types="landTypes[String(seed.seedId)]"
            :land-type-options="landTypeOptions"
            :dragging="draggingBagSeedId === seed.seedId"
            @to-top="toTopBagSeed(seed.seedId)"
            @update:land-types="emit('setLandTypes', seed.seedId, $event)"
            @drag-start="startBagSeedDrag(seed.seedId, $event)"
            @drag-end="endBagSeedDrag"
            @drag-over="dragOverBagSeed"
            @drop="dropBagSeed(seed.seedId, $event)"
          />
        </div>
        <div v-if="orphanRestrictedSeeds.length > 0" class="border-t border-gray-200 pt-2 dark:border-gray-700">
          <div class="settings-note">
            未持有但已配限制
          </div>
          <p class="settings-note mt-1">
            这些种子当前不在背包中，限制已保留，重新入库后仍生效。
          </p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <span
              v-for="item in orphanRestrictedSeeds"
              :key="item.seedId"
              class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-[11px] text-gray-700 dark:bg-gray-700 dark:text-gray-200"
            >
              {{ item.name }} · {{ item.scope }}
              <button
                type="button"
                class="i-carbon-close text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                :title="`清除 ${item.name} 的土地限制`"
                :aria-label="`清除 ${item.name} 的土地限制`"
                @click="emit('setLandTypes', item.seedId, [])"
              />
            </span>
          </div>
        </div>
      </div>
    </section>
  </NModal>
</template>

<style scoped>
.bag-seeds-dialog {
  --seed-card-height: 112px;
  --seed-card-gap: 6px;
}

.bag-seeds-dialog__body {
  max-height: calc(4 * var(--seed-card-height) + 3 * var(--seed-card-gap));
}

.bag-seeds-dialog__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-rows: var(--seed-card-height);
  gap: var(--seed-card-gap);
}
</style>
