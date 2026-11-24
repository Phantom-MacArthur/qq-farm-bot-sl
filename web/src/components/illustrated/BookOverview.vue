<script setup lang="ts">
import { Comment, computed, useSlots } from 'vue'

/** 图鉴概览：等级（或评分）徽章、进度条与操作按钮，四个页签共用。 */
const props = withDefaults(defineProps<{
  title: string
  icon: string
  badgeValue: string | number
  badgeLabel: string
  /** 进度条上方左侧说明，例如“已收藏 32 / 120”。 */
  caption?: string
  /** 进度条上方右侧数值，例如“860 / 1000”。 */
  progressText?: string
  /** 0–100；为 null 时不显示进度条。 */
  percent?: number | null
  hint?: string
  /** 嵌入图鉴标题栏：去掉自身的卡片描边、底色与留白，由标题栏统一提供。 */
  embedded?: boolean
}>(), { caption: '', progressText: '', percent: null, hint: '', embedded: false })

const slots = useSlots()
/** 父组件用 v-if 关闭附加区时插槽只剩注释节点，此时不渲染分隔线和留白。 */
function hasExtra() {
  return !!slots.default?.().some(node => node.type !== Comment)
}

const width = computed(() => `${Math.max(0, Math.min(100, props.percent ?? 0))}%`)
</script>

<template>
  <section class="book-overview" :class="{ 'book-overview--embedded': embedded }">
    <div class="book-overview__badge" aria-hidden="true">
      <b>{{ badgeValue }}</b><small>{{ badgeLabel }}</small>
    </div>
    <div class="book-overview__main">
      <div class="book-overview__heading">
        <h3><span :class="icon" />{{ title }}</h3>
        <span v-if="caption" class="book-overview__caption">{{ caption }}</span>
      </div>
      <template v-if="percent !== null">
        <div
          class="book-overview__track ui-progress-track"
          role="progressbar"
          :aria-label="`${title}进度`"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="Math.round(percent)"
          :aria-valuetext="progressText || undefined"
        >
          <span :style="{ width }" />
        </div>
        <div class="book-overview__foot">
          <span>{{ hint }}</span><b v-if="progressText">{{ progressText }}</b>
        </div>
      </template>
    </div>
    <div v-if="$slots.actions" class="book-overview__actions">
      <slot name="actions" />
    </div>
    <div v-if="hasExtra()" class="book-overview__extra">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.book-overview {
  display: grid;
  /* 徽章 + 进度条 + 操作按钮：始终一行三列，宽度不够时由进度条那一列让步，不换行 */
  grid-template-columns: 56px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px 16px;
  padding: 16px 18px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-card);
  background: var(--ui-surface);
  box-shadow:
    inset 0 1px 0 var(--glass-highlight),
    var(--ui-shadow-sm);
}

.book-overview--embedded {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.book-overview__badge {
  display: flex;
  width: 56px;
  height: 56px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

/* 标题栏底色与浅绿接近，嵌入时改用白色卡面 + 主色描边，徽章才能从底色里跳出来 */
.book-overview--embedded .book-overview__badge {
  border: 1px solid color-mix(in srgb, var(--ui-primary) 45%, var(--ui-border));
  background: var(--ui-surface);
}

.book-overview__badge b {
  font-size: var(--ui-font-size-large-15);
  font-weight: var(--fw-700);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.book-overview__badge small {
  margin-top: 2px;
  font-size: var(--ui-content-item-font-height-tiny-12);
  opacity: 0.8;
}

.book-overview__main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
}

.book-overview__heading {
  display: flex;
  min-width: 0;
  align-items: baseline;
  /* 标题与统计同行：放不下时由统计文案省略，不把标题栏顶高 */
  flex-wrap: nowrap;
  gap: 4px 12px;
}

.book-overview__heading h3 {
  display: inline-flex;
  /* 标题不参与压缩：整行放不下时先省略统计文案，标题自身不折行把栏顶高 */
  flex: none;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--ui-ink);
  font-size: var(--ui-font-size-large-15);
  font-weight: var(--fw-650);
  line-height: 1.3;
  white-space: nowrap;
}

.book-overview__heading h3 > span {
  color: var(--ui-primary);
  font-size: var(--ui-font-size-large-15);
}

.book-overview__caption {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-variant-numeric: tabular-nums;
}

.book-overview__track {
  --ui-progress-track-bg: color-mix(in srgb, var(--ui-ink) 24%, var(--ui-surface-soft));
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
}

.book-overview__track > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--ui-primary);
  transition: width var(--spring-drag-duration) var(--spring-drag);
}

.book-overview__foot {
  display: flex;
  min-width: 0;
  justify-content: space-between;
  gap: 12px;
  color: var(--ui-subtle);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

/* 说明文字先省略，右侧数值（如 860 / 1000）始终完整 */
.book-overview__foot span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-overview__foot b {
  color: var(--ui-muted);
  font-weight: var(--fw-600);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.book-overview__actions {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
}

.book-overview__extra {
  display: flex;
  grid-column: 1 / -1;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--ui-border);
}

/* 嵌入标题栏时分隔线向左、右出血 16px（BookToolbar 概览区的内边距），与卡片等宽 */
.book-overview--embedded .book-overview__extra {
  margin-inline: -16px;
  padding-inline: 16px;
}

:slotted(.book-chip) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
  font-size: var(--ui-content-item-font-height-tiny-12);
  line-height: 18px;
}

:slotted(.book-chip-label) {
  margin-right: 2px;
  color: var(--ui-subtle);
  font-size: var(--ui-content-item-font-height-tiny-12);
  line-height: 24px;
}
</style>
