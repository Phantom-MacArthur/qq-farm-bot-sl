<script setup lang="ts">
import { computed, useSlots } from 'vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'

/** 图鉴卡片：顶部是套用全局 .panel-titlebar 的标题栏，整体吸顶。
    标题栏上半部分是概览（#overview，可省略），全宽分割线下方左侧搜索 + 下拉筛选（默认插槽可追加筛选框），
    右侧是操作区（#actions，刷新键放最后）。传入 #body 时条目直接放在同一卡片里，
    再用一条全宽分割线与标题栏隔开，此时只有标题栏吸顶。 */
const props = defineProps<{
  filters: Array<{ value: string, label: string, count?: number }>
  placeholder: string
  label: string
}>()

const filter = defineModel<string>('filter', { required: true })
const query = defineModel<string>('query', { default: '' })
const slots = useSlots()
const hasBody = computed(() => !!slots.body)

// 选项直接带数量，与「种子详情」的作物范围下拉框一致
const filterOptions = computed(() => props.filters.map(entry => ({
  value: entry.value,
  label: entry.count === undefined ? entry.label : `${entry.label} (${entry.count})`,
})))
</script>

<template>
  <!-- 吸顶元素只能在父元素范围内停留：没有 #body 时卡片只有标题栏那么高，吸顶挂在卡片上 -->
  <section class="book-card" :class="{ 'panel-sticky': !hasBody, 'panel-scroll-layout': hasBody }" :aria-label="label">
    <div class="book-toolbar panel-titlebar panel-titlebar--flush margin-shell"><span class="margin-content">
      <div v-if="$slots.overview" class="book-toolbar__overview">
        <slot name="overview" />
      </div>
      <div class="book-toolbar__row">
        <BaseInput v-model="query" type="search" clearable :placeholder="placeholder" />
        <BaseSelect v-model="filter" :options="filterOptions" fit-width :aria-label="`${label}状态`" />
        <slot />
        <div v-if="$slots.actions" class="page-toolbar__actions">
          <slot name="actions" />
        </div>
      </div>
    </span></div>
    <div v-if="hasBody" class="book-card__body panel-scroll-body">
      <slot name="body" />
    </div>
  </section>
</template>

<style scoped>
/* 标题栏不在 page-card-surface 里：卡片补四边描边与整圆角。overflow: clip 只裁圆角、不形成滚动容器，
   不影响内部标题栏吸顶；吸顶后标题栏是直角，下方条目不会从圆角缺口露出来。 */
.book-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  overflow: clip;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-card);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-sm);
}

/* 分割线都贴卡片左右边缘：留白挪到概览和筛选行自身，标题栏只保留全局的底部分割线 */
.book-toolbar {
  flex-direction: column;
  flex-wrap: nowrap;
  align-items: stretch;
  gap: 0;
  --inset-top: 0; --inset-right: 0; --inset-bottom: 0; --inset-left: 0;
  border-radius: 0;
}

.book-toolbar:last-child {
  border-bottom: 0;
}

.book-toolbar__overview {
  padding: 16px;
  border-bottom: 1px solid var(--ui-border);
}

.book-toolbar__row {
  display: flex;
  min-width: 0;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  padding: 16px;
}

.book-card__body {
  min-width: 0;
  padding: 16px;
}
</style>
