<script setup lang="ts">
import { NButton } from 'naive-ui/es/button'
import { computed } from 'vue'

/**
 * 「重新拉取数据」按钮的统一实现：主色实底 + renew 图标 + 文案。
 * 视觉格式定义在全局 style.css 的 .panel-refresh（不要在各页 scoped 里重复）。
 * 图标与文案都放在默认插槽里（不走 naive 的 #icon），窄容器收起文案后图标才能左右等距。
 * 图标只在 loading 时转圈——调用方应只把「用户手动刷新」传成 loading，
 * 自动轮询/切页引起的后台加载不要传，否则图标会一直闪。
 */
const props = withDefaults(defineProps<{
  loading?: boolean
  disabled?: boolean
  /** 按钮文案，缺省同时用作 title / aria-label */
  label?: string
  /** 无障碍与悬浮提示，缺省沿用 label */
  title?: string
  size?: 'tiny' | 'small' | 'medium' | 'large'
  /** 空间紧张处只留图标的圆形键（活动页头部等） */
  iconOnly?: boolean
}>(), {
  loading: false,
  disabled: false,
  label: '刷新',
  size: 'medium',
  iconOnly: false,
})

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void
}>()

const hint = computed(() => props.title || props.label)
</script>

<template>
  <NButton
    class="panel-refresh"
    :class="{ 'panel-refresh--icon-only': iconOnly }"
    type="primary"
    :circle="iconOnly"
    :size="size"
    :disabled="disabled"
    :aria-label="hint"
    :title="hint"
    @click="emit('click', $event)"
  >
    <!-- 图标不用 naive 的 #icon 插槽：naive 给插槽图标挂了 6px margin-right，
         文案被收起后那 6px 变成纯死空间，图标左侧紧、右侧空。图标与文案同在一个内容区，
         间距由全局模板的 gap 控制，文案一收起就自动变回左右对称。 -->
    <span
      class="panel-refresh__icon i-carbon-renew"
      :class="{ 'animate-spin': loading }"
      aria-hidden="true"
    />
    <span v-if="!iconOnly" class="panel-refresh__label">{{ label }}</span>
  </NButton>
</template>
