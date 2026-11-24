<script setup lang="ts">
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
    class="flex flex-col gap-2 border rounded-lg bg-gray-50 p-2.5 transition-colors dark:bg-gray-800"
    :class="dragging
      ? 'border-[var(--theme-primary)] opacity-60 ring-2 ring-[var(--theme-primary)]'
      : 'border-gray-200 dark:border-gray-700'"
    draggable="true"
    @dragstart="emit('dragStart', $event)"
    @dragend="emit('dragEnd')"
    @dragover.prevent="emit('dragOver', $event)"
    @drop="emit('drop', $event)"
  >
    <!-- 序号行：左序号、中种子等级（等级: xx）、右置顶 -->
    <div class="flex items-center justify-between gap-1 whitespace-nowrap">
      <span class="text-xs text-gray-500 tabular-nums">#{{ index + 1 }}</span>
      <span class="text-xs text-gray-500 tabular-nums">等级: {{ seed.requiredLevel }}</span>
      <button
        type="button"
        class="grid h-[var(--ui-content-item-control-height-30)] w-7 shrink-0 cursor-pointer place-items-center rounded text-[var(--theme-primary)] disabled:cursor-default hover:bg-gray-200 disabled:text-gray-400 disabled:opacity-40 dark:hover:bg-gray-700"
        :disabled="index === 0"
        :aria-label="`置顶${seed.name}`"
        :title="index === 0 ? '已置顶' : '置顶'"
        @click.stop="emit('toTop')"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
          <path d="M5 4h14M12 20V8m-5 5 5-5 5 5" />
        </svg>
      </button>
    </div>

    <!-- 主体：居中展示图标、名称与库存 -->
    <div class="flex flex-col items-center gap-1">
      <div class="grid h-10 w-10 place-items-center overflow-hidden">
        <img
          v-if="seed.image && !imageFailed"
          :src="seed.image"
          :alt="`${seed.name}种子`"
          class="h-10 w-10 object-contain"
          loading="lazy"
          draggable="false"
          @error="imageFailed = true"
        >
        <span v-else class="i-carbon-sprout text-2xl text-gray-400" />
      </div>
      <div class="w-full truncate text-center text-sm font-medium" :title="seed.name">
        {{ seed.name }}
      </div>
      <div class="flex items-center justify-center gap-1.5 text-xs text-gray-500">
        <span>库存 {{ seed.count }}</span>
        <span class="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700 ring-1 ring-emerald-300/70 font-bold dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30">{{ seed.plantSize }}x{{ seed.plantSize }}</span>
      </div>
    </div>

    <!-- 土地限制（本分支特有）：整行可点开浮动下拉（teleport，不改卡片高度），说明文本置于弹窗底部 -->
    <div class="border-t border-gray-100 pt-2 dark:border-gray-700" @mousedown.stop>
      <NPopover
        trigger="click"
        placement="top"
        :show="editing"
        @update:show="editing = $event"
      >
        <template #trigger>
          <div class="w-full flex cursor-pointer items-center gap-1.5">
            <span class="min-w-0 flex-1 truncate text-left text-xs text-emerald-600 font-bold dark:text-emerald-400">土地：{{ restrictionLabel }}</span>
          </div>
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
          <p class="mt-2 border-t border-gray-100 pt-1.5 text-[11px] text-gray-400 dark:border-gray-700 dark:text-gray-500">
            不勾或勾满即为不限制。
          </p>
        </div>
      </NPopover>
    </div>
  </div>
</template>
