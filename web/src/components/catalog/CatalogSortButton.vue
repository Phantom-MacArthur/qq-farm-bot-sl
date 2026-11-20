<script setup lang="ts">
import type { SortOption } from '@/composables/useSortToggle'
import { NButton } from 'naive-ui/es/button'
import { NDropdown } from 'naive-ui/es/dropdown'

/* 排序按钮：白底 + 文字靠左 + 箭头贴右，点击展开排序菜单。
   再选一次当前项即翻转升降序，箭头同步显示 ↑/↓（与「种子详情」一致）。
   种子/果实/道具三个页签共用这一个控件，不再各写一份 NDropdown。 */

defineProps<{
  options: SortOption[]
  current: string
  dir: 'asc' | 'desc'
  label: string
}>()

const emit = defineEmits<{
  (e: 'select', key: string): void
}>()
</script>

<template>
  <NDropdown
    trigger="click"
    :options="options.map(o => ({ key: o.value, label: () => o.label }))"
    @select="key => emit('select', String(key))"
  >
    <NButton size="medium" class="catalog-sort toolbar-sort">
      <span class="toolbar-sort__labels">
        <span v-for="option in options" :key="option.value" class="toolbar-sort__measure" aria-hidden="true">{{ option.label }}</span>
        <span>{{ label }}</span>
      </span>
      <span class="toolbar-sort__arrow" :class="dir === 'asc' ? 'i-carbon-arrow-up' : 'i-carbon-arrow-down'" aria-hidden="true" />
    </NButton>
  </NDropdown>
</template>

<style scoped>
/* 宽度与图标布局复用全局 toolbar-sort 模板，这里仅保留排序按钮的配色。 */
.catalog-sort {
  font-weight: 400;
  background-color: var(--ui-surface-solid) !important;
  border-color: var(--ui-border) !important;
}
</style>
