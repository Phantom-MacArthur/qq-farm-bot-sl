<script setup lang="ts">
import { NSelect } from 'naive-ui/es/select'
import { computed, useAttrs } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  label?: string
  options?: { label: string, value: string | number, disabled?: boolean }[]
  disabled?: boolean
  placeholder?: string
  clearable?: boolean
  filterable?: boolean
  // 宽度贴合最长选项：不写死宽度，避免白留空间或把长选项裁切
  fitWidth?: boolean
}>()

const emit = defineEmits<{
  (e: 'change', value: string | number): void
}>()

const attrs = useAttrs()
const model = defineModel<string | number>()
const selectValue = computed(() => model.value ?? null)

// 所有候选文案叠放在同一个隐藏网格中，由浏览器按真实字体确定最长宽度。
const fitLabels = computed(() => [
  props.placeholder || '请选择',
  ...(props.options || []).map(option => String(option.label)),
])

function updateValue(value: string | number | null) {
  if (value === null)
    return
  model.value = value
  emit('change', value)
}
</script>

<template>
  <div class="base-field" :class="{ 'base-field--fit': fitWidth }">
    <label v-if="label" class="base-field__label">
      {{ label }}
    </label>
    <div :class="{ 'toolbar-fit toolbar-fit--select': fitWidth }" :data-control-size="attrs.size || 'medium'">
      <span v-if="fitWidth" class="toolbar-fit__measure" aria-hidden="true">
        <span v-for="(text, index) in fitLabels" :key="index">{{ text }}</span>
      </span>
      <NSelect
        v-bind="attrs"
        :class="{ 'toolbar-fit__control': fitWidth }"
        :value="selectValue"
        :options="options || []"
        :disabled="disabled"
        :placeholder="placeholder || '请选择'"
        :clearable="clearable"
        :filterable="filterable"
        @update:value="updateValue"
      />
    </div>
  </div>
</template>
