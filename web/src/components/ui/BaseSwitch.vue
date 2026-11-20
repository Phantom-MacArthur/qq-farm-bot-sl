<script setup lang="ts">
import { NSwitch } from 'naive-ui/es/switch'

// attrs 要落到真正的 role="switch" 节点上，否则 aria-label 挂在外层 div 上读屏无效。
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  label?: string
  disabled?: boolean
}>()

const model = defineModel<boolean>()

function toggleFromLabel() {
  if (!props.disabled)
    model.value = !model.value
}
</script>

<template>
  <div class="base-switch">
    <NSwitch v-bind="$attrs" v-model:value="model" :disabled="disabled" size="small" />
    <button
      v-if="label"
      type="button"
      class="base-switch__label"
      :disabled="disabled"
      @click="toggleFromLabel"
    >
      {{ label }}
    </button>
  </div>
</template>
