<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import CommerceItemImage from '@/components/commerce/CommerceItemImage.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { formatCompactAmount } from '@/utils/format-number'

// 商城与神秘商人共用的信息栏：左侧货币余额，右侧状态与刷新。
// 货币由后端按固定 ID 与固定顺序下发，换页签时余额栏位不会跳动。
const props = withDefaults(defineProps<{
  // 只有神秘商人会传 status（来访中 + 剩余时间）；商城页已取消刷新倒计时。
  status?: string
  statusTone?: 'muted' | 'violet' | 'warning'
  statusIcon?: string
  currencies?: Array<{ id: number | string, name: string, image: string, amount: number | null }>
  loading?: boolean
  disabled?: boolean
  refreshLabel?: string
}>(), {
  status: '',
  statusTone: 'muted',
  statusIcon: 'i-carbon-time',
  currencies: () => [],
  loading: false,
  disabled: false,
  refreshLabel: '刷新',
})

const emit = defineEmits<{ refresh: [] }>()

/** 只有用户点刷新才让图标转圈；切换账号、页签引起的自动加载不碰按钮，避免图标闪烁。 */
const manualRefreshing = ref(false)

watch(() => props.loading, (loading) => {
  if (!loading)
    manualRefreshing.value = false
})

function refresh() {
  if (props.loading || props.disabled)
    return
  manualRefreshing.value = true
  emit('refresh')
  // 万一调用方没有进入 loading（例如提前返回），下一帧就复位，避免图标一直转。
  void nextTick(() => {
    if (!props.loading)
      manualRefreshing.value = false
  })
}
</script>

<template>
  <header class="shop-bar">
    <!-- 货币始终靠左，并排一行；过长时横向滚动，不换行也不挤掉右侧按钮。 -->
    <div v-if="currencies.length" class="shop-assets" role="list" aria-label="货币余额">
      <span
        v-for="currency in currencies"
        :key="currency.id"
        class="shop-asset"
        role="listitem"
        :title="`${currency.name}：${currency.amount === null ? '余额未确认' : currency.amount.toLocaleString()}`"
      >
        <CommerceItemImage :src="currency.image" :alt="currency.name" size="sm" />
        <b>{{ formatCompactAmount(currency.amount) }}</b>
      </span>
    </div>
    <span v-else />

    <div class="shop-bar__end">
      <p v-if="status" class="shop-bar__status" :class="`is-${statusTone}`">
        <span :class="statusIcon" aria-hidden="true" />
        <span>{{ status }}</span>
      </p>
      <slot name="actions" />
      <!-- 刷新键走全局 .panel-refresh 模板（primary 实底 + 图标 + 文案），图标只在手动刷新时转。 -->
      <RefreshButton
        :title="refreshLabel"
        :loading="manualRefreshing"
        :disabled="disabled || loading"
        @click="refresh"
      />
    </div>
  </header>
</template>

<style scoped>
.shop-bar {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

/* 四个货币各自一个小圆角矩形，与右侧刷新按钮同一套尺寸和圆角：
   高 34px = 按钮高，圆角 10px = --ui-radius-control = 按钮圆角，
   这样一排看过去就是一个控件行，而不是一条胶囊里塞四段文字。 */
.shop-assets {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}

.shop-assets::-webkit-scrollbar {
  display: none;
}

.shop-asset {
  height: 34px;
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 5px;
  padding: 0 10px 0 5px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-control);
  color: var(--ui-ink);
  background: var(--ui-surface);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  /* 宽度跟着内容走：图标 + 数字各自占位，不预留空白，不再为对齐拉宽。 */
  white-space: nowrap;
}

.shop-asset :deep(.item-image) {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 8px;
  background: transparent;
}

.shop-asset b {
  font-weight: var(--fw-650);
  letter-spacing: 0.01em;
}

/* 右侧：刷新按钮始终在最右，状态文案（仅神秘商人）在它左侧。 */
.shop-bar__end {
  display: flex;
  min-width: 0;
  flex: none;
  align-items: center;
  gap: 10px;
}

.shop-bar__status {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--ui-muted);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.shop-bar__status span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shop-bar__status.is-violet {
  color: var(--ui-violet);
  font-weight: var(--fw-600);
}

.shop-bar__status.is-warning {
  color: var(--ui-warning);
  font-weight: var(--fw-600);
}
</style>
