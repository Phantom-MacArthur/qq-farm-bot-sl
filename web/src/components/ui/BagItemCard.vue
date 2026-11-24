<script setup lang="ts" generic="Action extends { key: string, label: string, title: string, primary?: boolean }">
import { NButton } from 'naive-ui/es/button'
import { NDropdown } from 'naive-ui/es/dropdown'
import { computed } from 'vue'

const props = defineProps<{
  name: string
  image?: string
  imageFailed?: boolean
  locked?: boolean
  categoryLabel: string
  categoryTone: 'danger' | 'warning' | 'primary' | 'blue' | 'neutral'
  detail?: string
  detailTitle?: string
  quantity: string
  duration?: string
  actions: readonly Action[]
  actionsDisabled?: boolean
  selecting?: boolean
  selectable?: boolean
  selectionDisabled?: boolean
  selected?: boolean
}>()

const emit = defineEmits<{
  action: [action: Action]
  toggle: []
  imageError: []
}>()

const canToggle = computed(() => props.selecting && props.selectable && !props.selectionDisabled)
const mainAction = computed(() => props.actions[0])
const moreActions = computed(() => props.actions.slice(1).map(({ key, label }) => ({ key, label })))

function selectAction(key: string) {
  const action = props.actions.find(action => action.key === key)
  if (action && !props.actionsDisabled && !props.selecting)
    emit('action', action)
}

function toggle(event: MouseEvent | KeyboardEvent) {
  if (!canToggle.value)
    return
  event.preventDefault()
  emit('toggle')
}
</script>

<template>
  <article
    class="bag-item margin-shell page-card-surface"
    :class="{
      'bag-item--selectable': canToggle,
      'bag-item--selected': selecting && selected,
      'bag-item--disabled': selecting && !canToggle,
    }"
    :role="selecting && selectable ? 'checkbox' : undefined"
    :aria-label="selecting && selectable ? name : undefined"
    :aria-checked="selecting && selectable ? !!selected : undefined"
    :aria-disabled="selecting && selectable && selectionDisabled ? true : undefined"
    :tabindex="canToggle ? 0 : undefined"
    @click="toggle"
    @keydown.space.self="toggle"
    @keydown.enter.self="toggle"
  >
    <div class="margin-content">
      <span v-if="selecting && selectable" class="bag-item__check" :class="{ 'is-checked': selected }" aria-hidden="true">
        <span v-if="selected" class="i-carbon-checkmark" />
      </span>
      <div class="bag-item__thumb">
        <img v-if="image && !imageFailed" :src="image" :alt="name" loading="lazy" @error="emit('imageError')">
        <span v-else class="bag-item__fallback">{{ (name || '物').slice(0, 1) }}</span>
        <span v-if="locked" class="bag-item__lock" title="已锁定" role="img" aria-label="已锁定"><span class="i-carbon-locked" /></span>
      </div>
      <span class="bag-item__name" :title="name">{{ name }}</span>
      <div class="bag-item__meta">
        <span class="bag-type" :class="`bag-type--${categoryTone}`">{{ categoryLabel }}</span>
        <slot name="meta" />
      </div>
      <div v-if="detail" class="bag-item__line" :title="detailTitle || detail">
        {{ detail }}
      </div>

      <footer class="bag-item__foot divider-top margin-shell">
        <div class="margin-content">
          <span v-if="!selecting && mainAction" class="bag-item__ops" @click.stop>
            <NButton
              size="tiny"
              class="bag-item__action-tiny"
              :type="mainAction.primary ? 'primary' : 'default'"
              secondary
              :disabled="actionsDisabled"
              :title="mainAction.title"
              @click="selectAction(mainAction.key)"
            >
              {{ mainAction.label }}
            </NButton>
            <NDropdown
              v-if="moreActions.length"
              trigger="click"
              placement="bottom-start"
              :options="moreActions"
              :disabled="actionsDisabled"
              @select="selectAction"
            >
              <NButton size="tiny" class="bag-item__action-tiny bag-item__more" quaternary circle :disabled="actionsDisabled" title="更多操作" aria-label="更多操作">
                <template #icon><span class="i-carbon-overflow-menu-horizontal" /></template>
              </NButton>
            </NDropdown>
          </span>
          <span class="bag-item__qty" :class="{ 'is-hours': duration }" :title="duration ? `剩余 ${duration}` : `数量 ${quantity}`">
            {{ duration || `×${quantity}` }}
          </span>
        </div>
      </footer>
    </div>
  </article>
</template>

<style>
.bag-item-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 112px), 1fr));
  gap: 12px;
}
</style>

<style scoped>
.bag-item {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  --inset-top: 12px;
  --inset-right: 8px;
  --inset-bottom: var(--ui-card-content-bottom-margin);
  --inset-left: 8px;
  text-align: center;
  background: transparent !important;
  transition: opacity 0.15s ease;
}

.bag-item :deep(*) {
  font-weight: var(--fw-400) !important;
}

.bag-item__thumb {
  position: relative;
  display: grid;
  width: 46px;
  height: 46px;
  margin-bottom: 8px;
  place-items: center;
}

.bag-item__thumb img {
  max-width: 46px;
  max-height: 46px;
  object-fit: contain;
}

.bag-item__fallback {
  color: var(--ui-subtle);
  font-size: var(--ui-font-size-large-15);
}

.bag-item__lock {
  position: absolute;
  top: -6px;
  left: -6px;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 999px;
  color: #fff;
  background: var(--ui-warning-fill);
  box-shadow: 0 0 0 2px var(--ui-surface-strong);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.bag-item__name,
.bag-item__line {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bag-item__name {
  width: 100%;
  color: var(--ui-ink);
  font-size: var(--ui-font-size-small-13);
  line-height: 1.35;
}

.bag-item__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px 8px;
  color: var(--ui-muted);
  line-height: 18px;
}

.bag-item__line {
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.bag-item__meta:has(+ .bag-item__foot),
.bag-item__line {
  margin-block-end: max(0px, calc(var(--ui-content-vertical-gap) - 4px));
}

.bag-type {
  padding: 0 6px;
  border-radius: 5px;
  white-space: nowrap;
}

.bag-type--danger {
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
}
.bag-type--warning {
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
}
.bag-type--primary {
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}
.bag-type--blue {
  color: var(--ui-blue);
  background: var(--ui-blue-soft);
}
.bag-type--neutral {
  color: var(--ui-muted);
  background: var(--ui-surface-soft);
}

.bag-item__foot {
  display: flex;
  width: calc(100% + 16px);
  min-height: 30px;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-block-start: auto;
  margin-inline: -8px;
  --inset-top: 8px;
  --inset-left: 8px;
  --inset-right: 8px;
}

.bag-item__qty {
  max-width: 100%;
  margin-inline-start: auto;
  overflow: hidden;
  color: var(--ui-ink);
  font-size: var(--ui-font-size-small-13);
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.bag-item__qty.is-hours {
  color: var(--ui-blue);
}

.bag-item__ops {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 2px;
}

.bag-item__more.n-button--circle {
  --n-width: var(--n-height) !important;
}

.bag-item--selectable {
  cursor: pointer;
}

.bag-item--selectable:hover,
.bag-item--selectable:focus-visible {
  outline: 1px solid color-mix(in srgb, var(--ui-primary) 65%, transparent);
  outline-offset: -1px;
}

.bag-item--selected,
.bag-item--selected:hover,
.bag-item--selected:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: -1px;
}

.bag-item--disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.bag-item__check {
  position: absolute;
  top: 8px;
  right: 8px;
  display: grid;
  width: 16px;
  height: 16px;
  place-items: center;
  border: 1.5px solid var(--ui-border-strong);
  border-radius: 50%;
  color: #fff;
  background: var(--ui-surface-strong);
  font-size: var(--ui-content-item-font-height-tiny-12);
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.bag-item__check.is-checked {
  border-color: var(--ui-primary);
  background: var(--ui-primary-fill);
}
</style>
