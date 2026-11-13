<script setup lang="ts">
import { NInput } from 'naive-ui/es/input'
import { NInputNumber } from 'naive-ui/es/input-number'
import { computed, useAttrs } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  type?: string
  placeholder?: string
  label?: string
  // 标签与控件同行显示，用于同一行里的窄字段，避免标签自己占掉一行
  inlineLabel?: boolean
  // 数字步进按钮：“vertical” 把横向 “-+” 换成右侧竖向上下箭头，供窄数字框使用
  controls?: 'native' | 'vertical'
  disabled?: boolean
  clearable?: boolean
  min?: string | number
  max?: string | number
  step?: string | number
}>()

const emit = defineEmits<{
  (e: 'clear'): void
}>()

const attrs = useAttrs()
const model = defineModel<string | number>()

const textValue = computed({
  get: () => model.value === undefined || model.value === null ? '' : String(model.value),
  set: (value: string) => {
    model.value = value
  },
})

const numberValue = computed<number | null>({
  get: () => {
    if (model.value === undefined || model.value === null || model.value === '')
      return null
    const value = Number(model.value)
    return Number.isFinite(value) ? value : null
  },
  set: (value) => {
    model.value = value === null ? '' : value
  },
})

// 竖向步进：自己算步长和上下限，因为 naive 内置的 “-+” 已经被隐藏。
// 空值按下限起步，与 naive 的加减按钮行为保持一致；保留一位小数精度防止浮点漂移。
const stepperStep = computed(() => {
  const step = Number(props.step)
  return Number.isFinite(step) && step > 0 ? step : 1
})
const stepperMin = computed(() => {
  const min = Number(props.min)
  return Number.isFinite(min) ? min : null
})
const stepperMax = computed(() => {
  const max = Number(props.max)
  return Number.isFinite(max) ? max : null
})
const stepperBase = computed(() => numberValue.value ?? stepperMin.value ?? 0)
const canStepUp = computed(() => stepperMax.value === null || stepperBase.value < stepperMax.value)
const canStepDown = computed(() => stepperMin.value === null || stepperBase.value > stepperMin.value)

function stepNumber(delta: number) {
  let next = Math.round((stepperBase.value + delta * stepperStep.value) * 1e6) / 1e6
  if (stepperMin.value !== null)
    next = Math.max(stepperMin.value, next)
  if (stepperMax.value !== null)
    next = Math.min(stepperMax.value, next)
  numberValue.value = next
}
</script>

<template>
  <div class="base-field" :class="{ 'base-field--inline': inlineLabel }">
    <label v-if="label" class="base-field__label" :for="String(attrs.id || '')">
      {{ label }}
    </label>
    <NInputNumber
      v-if="type === 'number'"
      v-model:value="numberValue"
      v-bind="attrs"
      class="w-full"
      :class="{ 'base-field__number--inset': controls === 'vertical' }"
      :placeholder="placeholder"
      :disabled="disabled"
      :clearable="clearable"
      :min="min"
      :max="max"
      :step="step"
      :show-button="controls !== 'vertical'"
      @clear="emit('clear')"
    >
      <!-- showButton 关掉后 naive 会把 suffix 插槽直接透传给 Input，
           箭头于是走官方槽位嵌在框内，不需要绝对定位。 -->
      <template v-if="controls === 'vertical'" #suffix>
        <div class="base-field__stepper">
          <button
            type="button"
            aria-label="增加"
            :disabled="disabled || !canStepUp"
            @click="stepNumber(1)"
          >
            <span class="i-carbon-chevron-up" />
          </button>
          <button
            type="button"
            aria-label="减少"
            :disabled="disabled || !canStepDown"
            @click="stepNumber(-1)"
          >
            <span class="i-carbon-chevron-down" />
          </button>
        </div>
      </template>
    </NInputNumber>
    <NInput
      v-else
      v-model:value="textValue"
      v-bind="attrs"
      :type="type === 'password' ? 'password' : 'text'"
      :placeholder="placeholder"
      :disabled="disabled"
      :clearable="clearable"
      :show-password-on="type === 'password' ? 'click' : undefined"
      @clear="emit('clear')"
    />
  </div>
</template>
