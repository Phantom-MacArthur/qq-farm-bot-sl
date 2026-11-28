<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  description?: string
  icon?: string
  tone?: 'default' | 'error'
  /** 嵌在卡片里使用时去掉边框与背景。 */
  bare?: boolean
}>(), { icon: 'i-carbon-information', tone: 'default', bare: false })
</script>

<template>
  <div class="empty-state" :class="{ 'empty-state--bare': bare, 'empty-state--error': tone === 'error' }" role="status">
    <span class="empty-state__badge" aria-hidden="true">
      <span class="empty-state__icon" :class="icon" />
    </span>
    <strong class="empty-state__title">{{ title }}</strong>
    <p v-if="description" class="empty-state__description">
      {{ description }}
    </p>
    <div v-if="$slots.default" class="empty-state__actions">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
}

.empty-state__badge {
  display: grid;
  width: 56px;
  height: 56px;
  margin-bottom: 8px;
  place-items: center;
  border-radius: 18px;
  color: var(--ui-muted);
  background: var(--ui-surface-soft);
}

.empty-state__icon {
  font-size: var(--ui-font-size-large-15);
}

.empty-state--error .empty-state__badge {
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
}

.empty-state__title {
  color: var(--ui-ink);
  font-size: var(--ui-font-size-large-15);
  font-weight: var(--fw-600);
}

.empty-state__description {
  max-width: 420px;
  margin: 0;
  color: var(--ui-muted);
  font-size: var(--ui-font-size-small-13);
  line-height: 1.6;
}

.empty-state__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 10px;
}
</style>
