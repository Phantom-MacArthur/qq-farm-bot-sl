<script setup lang="ts">
import { NPagination } from 'naive-ui/es/pagination'

/* 图鉴/分析类列表页的统一外壳：单个农场面板，标题栏与内容区都出血贴边。
   各页签只往 slot 里塞自己的工具栏和内容，不再共用一个塞满条件渲染的上帝组件。
   面板与表格样式集中在这里，避免三个页签各写一遍。 */

defineProps<{
  loading?: boolean
  pageCount?: number
}>()

const page = defineModel<number>('page', { default: 1 })
</script>

<template>
  <section class="catalog-panel page-card-surface rounded-2xl panel-scroll-layout">
    <!-- 标题栏：各页签自己的搜索与筛选控件 -->
    <div class="catalog-toolbar panel-titlebar">
      <slot name="toolbar" />
    </div>

    <div v-if="loading" class="flex justify-center py-16">
      <div class="i-svg-spinners-90-ring-with-bg text-4xl text-green-500" />
    </div>
    <div v-else class="catalog-body panel-scroll-body">
      <slot />
    </div>

    <div v-if="!loading && (pageCount || 1) > 1" class="catalog-pagination">
      <NPagination v-model:page="page" :page-count="pageCount || 1" :page-slot="5" />
    </div>
  </section>
</template>

<style scoped>
/* 面板：padding 16px 作基准，标题栏和内容区用负 margin 出血贴边。
   必须铺不透明白底——沿用半透的 --glass-card 会透出页面底色发灰。
   overflow: clip 只裁出血内容贴合圆角、不形成滚动容器，
   否则会把标题栏的吸顶困死在面板内（同 BookToolbar .book-card 的做法）。 */
.catalog-panel {
  display: flex;
  flex-direction: column;
  overflow: clip;
  padding: 16px;
  background: var(--ui-surface-solid) !important;
}

/* 标题栏格式走全局 .panel-titlebar；卡片 padding 16px 作基准，内容区用负 margin 出血贴边。 */
/* 内容区左右贴边，纵向和横向滚动都交给同一个表格容器。 */
.catalog-body {
  display: flex;
  flex-direction: column;
  overflow: clip;
  margin: 0 -16px;
  background: var(--ui-surface-solid);
}

/* 与 .catalog-body 一样左右出血到卡片边缘：让顶部分割线与上方种子/道具表等宽；
   翻页按钮本身仍由 padding 收在内容区内。卡片 overflow: clip 负责圆角裁切。 */
.catalog-pagination {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  margin: 0 -16px;
  padding: 12px 16px;
  border-top: 1px solid var(--ui-border);
}

/* 标题栏固定单行，控件宽度由全局内容适配模板负责，不再在页面中估算文案宽度。 */
.catalog-toolbar {
  flex-wrap: nowrap;
}

:deep(.catalog-tools) {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
}

:deep(.catalog-tools__actions) {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}

/* 果实/道具表的内框；种子表直接贴边，不加这一层 */
:deep(.catalog-table-frame) {
  overflow: hidden;
  margin: 0 16px 16px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  isolation: isolate;
}

:deep(.catalog-table-scroll) {
  --catalog-table-head-height: 42px;
  min-height: 0;
  overflow: auto;
  overscroll-behavior-x: contain;
}

:deep(.catalog-table-scroll::-webkit-scrollbar-track:vertical) {
  margin-top: var(--catalog-table-head-height);
}

:deep(.catalog-table) {
  border-collapse: separate;
  border-spacing: 0;
}

:deep(.catalog-table thead) {
  position: sticky;
  z-index: 2;
  top: 0;
}

:deep(.catalog-table th) {
  height: var(--catalog-table-head-height, 42px);
  border-bottom: 1px solid var(--ui-border);
  color: var(--ui-muted);
  background: var(--ui-table-head);
}

:deep(.catalog-table td) {
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-surface-solid);
}

:deep(.catalog-table tbody tr:last-child td) {
  border-bottom: 0;
}

:deep(.catalog-table td:first-child) {
  background: var(--ui-surface-solid);
}

:deep(.catalog-table tbody tr:hover td:first-child) {
  background: var(--ui-bg-soft);
}

/* 种子表 / 道具表：按标题宽度排布，内容超长时裁切，不让相邻单元格文本叠压 */
:deep(.seed-table th),
:deep(.seed-table td),
:deep(.item-table th),
:deep(.item-table td) {
  overflow: hidden;
  text-overflow: ellipsis;
}

:deep(.seed-table),
:deep(.item-table) {
  background: var(--ui-surface-solid);
}

/* 种子表 / 道具表悬停不变色（含固定在左侧的首列）：整行保持原底色 */
:deep(.catalog-table.seed-table tbody tr:hover td),
:deep(.catalog-table.item-table tbody tr:hover td) {
  background: var(--ui-surface-solid);
}

:deep(.catalog-table.seed-table tbody tr:hover td:first-child),
:deep(.catalog-table.item-table tbody tr:hover td:first-child) {
  background: var(--ui-surface-solid);
}
</style>
