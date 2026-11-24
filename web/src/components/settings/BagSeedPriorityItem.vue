<script setup lang="ts">
import { NButton } from 'naive-ui/es/button'
import { NCheckbox, NCheckboxGroup } from 'naive-ui/es/checkbox'
import { NPopover } from 'naive-ui/es/popover'
import { computed, ref, watch } from 'vue'

export interface BagSeedPriorityItemSeed {
  seedId: number
  name: string
  count: number
  requiredLevel: number
  plantSize: number
  image?: string
}

const props = defineProps<{
  seed: BagSeedPriorityItemSeed
  index: number
  landTypes?: string[]
  landTypeOptions: Array<{ label: string, value: string, short?: string }>
  dragging: boolean
}>()

const emit = defineEmits<{
  'toTop': []
  'update:landTypes': [value: string[]]
  'dragStart': [event: DragEvent]
  'dragEnd': []
  'dragOver': [event: DragEvent]
  'drop': [event: DragEvent]
}>()

const imageFailed = ref(false)
const editing = ref(false)

// 勾满全部类型和一个都不勾都等价于不限制，不在界面上保留这两种中间态。
const restricted = computed(() => {
  const count = props.landTypes?.length ?? 0
  return count > 0 && count < props.landTypeOptions.length
})

const restrictionLabel = computed(() => {
  if (!restricted.value)
    return '不限制'
  const labels = props.landTypeOptions
    .filter(option => props.landTypes?.includes(option.value))
    .map(option => option.short ?? option.label)
  return labels.join('/')
})

watch(restricted, (value) => {
  if (!value)
    editing.value = false
})

function handleLandTypesChange(value: (string | number)[]) {
  const next = value.map(String)
  emit('update:landTypes', next.length === props.landTypeOptions.length ? [] : next)
}
</script>

<template>
  <div
    class="seed-priority-card"
    :class="{ 'opacity-60': dragging }"
    draggable="true"
    @dragstart="emit('dragStart', $event)"
    @dragend="emit('dragEnd')"
    @dragover.prevent="emit('dragOver', $event)"
    @drop="emit('drop', $event)"
  >
    <div class="seed-priority-card__meta flex items-center justify-between gap-0.5 whitespace-nowrap">
      <span>#{{ index + 1 }}</span>
      <span class="min-w-0 truncate" :title="`等级 ${seed.requiredLevel}`">Lv.{{ seed.requiredLevel }}</span>
      <NButton
        quaternary circle size="tiny"
        class="bag-item__action-tiny seed-priority-card__top"
        :disabled="index === 0"
        :aria-label="`置顶${seed.name}`"
        :title="index === 0 ? '已置顶' : '置顶'"
        @click.stop="emit('toTop')"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
          <path d="M5 4h14M12 20V8m-5 5 5-5 5 5" />
        </svg>
      </NButton>
    </div>

    <!-- 主体：居中展示图标、名称与库存 -->
    <div class="flex min-w-0 flex-col items-center gap-px">
      <div class="grid h-7 w-7 place-items-center overflow-hidden">
        <img
          v-if="seed.image && !imageFailed"
          :src="seed.image"
          :alt="`${seed.name}种子`"
          class="h-7 w-7 object-contain"
          loading="lazy"
          draggable="false"
          @error="imageFailed = true"
        >
        <span v-else class="i-carbon-sprout text-2xl text-gray-400" />
      </div>
      <div class="w-full truncate text-center text-[13px] leading-4 font-medium" :title="seed.name">
        {{ seed.name }}
      </div>
      <div class="seed-priority-card__meta w-full flex items-center justify-center gap-1 leading-4">
        <span class="min-w-0 truncate" :title="`库存 ${seed.count}`">×{{ seed.count }}</span>
        <span class="shrink-0 rounded bg-emerald-100 px-1 text-[10px] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{{ seed.plantSize }}×{{ seed.plantSize }}</span>
      </div>
    </div>

    <div class="seed-priority-card__restriction" @mousedown.stop>
      <NPopover
        trigger="click"
        placement="top"
        :show="editing"
        @update:show="editing = $event"
      >
        <template #trigger>
          <button
            type="button"
            class="seed-priority-card__land-button text-emerald-700 dark:text-emerald-400"
            :aria-expanded="editing"
            :aria-label="`${seed.name}的适用土地：${restrictionLabel}`"
            :title="`点击选择土地（当前：${restrictionLabel}）`"
          >
            <span class="min-w-0 truncate">土地：{{ restrictionLabel }}</span>
            <span class="i-carbon-chevron-down shrink-0" aria-hidden="true" />
          </button>
        </template>
        <div class="w-44">
          <NCheckboxGroup
            :value="landTypes ?? []"
            @update:value="handleLandTypesChange"
          >
            <div class="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <NCheckbox
                v-for="option in landTypeOptions"
                :key="option.value"
                :value="option.value"
                size="small"
              >
                <span class="text-xs">{{ option.label }}</span>
              </NCheckbox>
            </div>
          </NCheckboxGroup>
          <p class="mt-2 text-[11px] text-[var(--ui-muted)]">
            不勾或勾满即为不限制。
          </p>
        </div>
      </NPopover>
    </div>
  </div>
</template>

<style scoped>
.seed-priority-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  padding: 3px 4px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-surface-soft);
  cursor: grab;
}

.seed-priority-card__meta {
  color: var(--ui-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.seed-priority-card__top {
  --n-height: 20px !important;
  --n-width: 20px !important;
  flex-shrink: 0;
  margin: 0;
  padding: 0;
}

.seed-priority-card__restriction {
  margin-top: auto;
}

.seed-priority-card__land-button {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--ui-primary-soft);
  cursor: pointer;
  font-size: 11px;
  line-height: 16px;
  text-align: start;
}

.seed-priority-card__land-button:hover,
.seed-priority-card__land-button[aria-expanded='true'] {
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-primary-soft));
}

.seed-priority-card__land-button:focus-visible {
  outline: 1px solid currentColor;
  outline-offset: 1px;
}
</style>
