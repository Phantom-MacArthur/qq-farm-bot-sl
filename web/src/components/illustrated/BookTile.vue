<script setup lang="ts">
import { ref, watch } from 'vue'
import { vLazySrc } from '@/directives/lazy-src'

/**
 * 图鉴里的单个条目：固定的方形图位 + 一行名称 + 一行状态。
 * 所有页签（作物、超变、藏品、变异宝典）共用，保证同一网格内卡片等高、文字对齐。
 */
const props = withDefaults(defineProps<{
  name: string
  image?: string
  /** owned 已收藏/已激活；pending 已持有待激活；missing 未获得；plain 仅展示（不区分收藏状态）。 */
  state?: 'owned' | 'pending' | 'missing' | 'plain'
  meta?: string
  metaTone?: 'muted' | 'primary' | 'warning'
  /** 显示左上角“新”标记。 */
  fresh?: boolean
  /** 可点击时渲染为按钮。 */
  interactive?: boolean
  label?: string
}>(), {
  image: '',
  state: 'plain',
  meta: '',
  metaTone: 'muted',
  fresh: false,
  interactive: false,
  label: '',
})

defineEmits<{ select: [] }>()

const failed = ref(false)
watch(() => props.image, () => failed.value = false)
</script>

<template>
  <component
    :is="interactive ? 'button' : 'div'"
    :type="interactive ? 'button' : undefined"
    class="book-tile margin-shell"
    :class="[`is-${state}`, { 'is-interactive': interactive }]"
    :title="name"
    :aria-label="label || undefined"
    @click="interactive && $emit('select')"
  ><span class="margin-content">
    <span class="book-tile__well">
      <img v-if="image && !failed" v-lazy-src="image" alt="" loading="lazy" decoding="async" @error="failed = true">
      <span v-else class="book-tile__fallback i-carbon-image" aria-hidden="true" />
      <span v-if="fresh" class="book-tile__fresh">新</span>
      <slot name="corner" />
    </span>
    <span class="book-tile__name">{{ name }}</span>
    <slot name="extra" />
    <span v-if="meta || $slots.meta" class="book-tile__meta" :class="`is-${metaTone}`">
      <slot name="meta">{{ meta }}</slot>
    </span>
  </span></component>
</template>

<style scoped>
.book-tile {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  --inset-top: 12px; --inset-right: 8px; --inset-bottom: 10px; --inset-left: 8px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  color: var(--ui-ink);
  background: transparent;
  font: inherit;
  text-align: center;
  transition:
    border-color 0.16s ease,
    transform var(--spring-drag-duration) var(--spring-drag);
}

.book-tile.is-interactive {
  cursor: pointer;
}

.book-tile.is-interactive:hover {
  border-color: color-mix(in srgb, var(--tile-accent, var(--ui-primary)) 40%, var(--ui-border));
}

.book-tile.is-interactive:active {
  transform: scale(0.97);
}

.book-tile:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

/* 图位固定为正方形，图片统一占 72%，不同尺寸的素材看起来一样大。 */
.book-tile__well {
  position: relative;
  display: grid;
  width: min(100%, 48px);
  aspect-ratio: 1;
  align-self: center;
  place-items: center;
  margin-bottom: 8px;
  border-radius: 9px;
}

.book-tile__well > img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  transition:
    opacity 0.2s ease,
    filter 0.2s ease;
}

.book-tile__fallback {
  color: var(--ui-subtle);
  font-size: var(--ui-font-size-large-15);
}

.book-tile.is-missing .book-tile__well > img {
  opacity: 0.42;
  filter: grayscale(1);
}

.book-tile.is-missing .book-tile__name {
  color: var(--ui-muted);
}

.book-tile__fresh {
  position: absolute;
  top: 5px;
  left: 5px;
  padding: 0 5px;
  border-radius: 5px;
  color: #fff;
  background: var(--ui-danger-fill);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-600);
  line-height: 16px;
}

.book-tile__name {
  min-width: 0;
  overflow: hidden;
  font-size: var(--ui-font-size-small-13);
  font-weight: var(--fw-600);
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-tile__meta {
  display: flex;
  min-width: 0;
  height: 16px;
  align-items: center;
  justify-content: center;
  gap: 3px;
  overflow: hidden;
  color: var(--ui-subtle);
  font-size: var(--ui-content-item-font-height-tiny-12);
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-tile__meta.is-primary {
  color: var(--ui-primary);
  font-weight: var(--fw-600);
}

.book-tile__meta.is-warning {
  color: var(--ui-warning);
  font-weight: var(--fw-600);
}
</style>

<style scoped>
.book-tile :deep(*) { font-weight: var(--fw-400) !important; }
</style>
