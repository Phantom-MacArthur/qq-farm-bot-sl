<script setup lang="ts">
import type { ButtonProps } from 'naive-ui'
import { NButton } from 'naive-ui/es/button'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

const props = defineProps<{
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'outline' | 'text' | 'soft' | 'soft-success' | 'soft-danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  disabled?: boolean
  block?: boolean
  to?: string
  href?: string
  type?: 'button' | 'submit' | 'reset'
}>()

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void
}>()

const naiveSize = computed<ButtonProps['size']>(() => {
  if (props.size === 'sm')
    return 'small'
  if (props.size === 'lg')
    return 'large'
  return 'medium'
})

const buttonType = computed<ButtonProps['type']>(() => {
  if (props.variant === 'danger' || props.variant === 'soft-danger')
    return 'error'
  if (props.variant === 'success' || props.variant === 'soft-success')
    return 'success'
  if (!props.variant || props.variant === 'primary')
    return 'primary'
  return 'default'
})

// soft* 是带类型色的浅底按钮：卡片里需要“有背景但不到实心”的动作入口
const isSecondary = computed(() => props.variant === 'secondary'
  || props.variant === 'soft'
  || props.variant === 'soft-success'
  || props.variant === 'soft-danger')

function handleClick(event: MouseEvent) {
  if (!props.disabled && !props.loading)
    emit('click', event)
}

function handleRouterClick(event: MouseEvent, navigate: (event?: MouseEvent) => void) {
  if (props.disabled || props.loading)
    return
  emit('click', event)
  navigate(event)
}
</script>

<template>
  <NButton
    v-if="!to"
    class="base-button"
    :tag="href ? 'a' : 'button'"
    :href="href"
    :attr-type="type || 'button'"
    :type="buttonType"
    :size="naiveSize"
    :loading="loading"
    :disabled="disabled"
    :block="block"
    :secondary="isSecondary"
    :quaternary="variant === 'ghost'"
    :ghost="variant === 'outline'"
    :text="variant === 'text'"
    @click="handleClick"
  >
    <template v-if="$slots.icon" #icon>
      <slot name="icon" />
    </template>
    <slot />
  </NButton>
  <RouterLink v-else v-slot="{ href: routerHref, navigate }" :to="to" custom>
    <NButton
      class="base-button"
      tag="a"
      :href="routerHref"
      :type="buttonType"
      :size="naiveSize"
      :loading="loading"
      :disabled="disabled"
      :block="block"
      :secondary="isSecondary"
      :quaternary="variant === 'ghost'"
      :ghost="variant === 'outline'"
      :text="variant === 'text'"
      @click="handleRouterClick($event, navigate)"
    >
      <template v-if="$slots.icon" #icon>
        <slot name="icon" />
      </template>
      <slot />
    </NButton>
  </RouterLink>
</template>
