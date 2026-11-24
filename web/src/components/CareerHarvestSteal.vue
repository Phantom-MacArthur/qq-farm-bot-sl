<script setup lang="ts">
import { computed } from 'vue'
import { formatCompactAmount, formatNumber } from '@/utils/format-number'

export interface CareerHarvestSteal {
  totalHarvestCount?: number
  totalStealCount?: number
}

const props = defineProps<{
  career: CareerHarvestSteal | null | undefined
}>()

const harvest = computed(() => Math.max(0, Number(props.career?.totalHarvestCount) || 0))
const steal = computed(() => Math.max(0, Number(props.career?.totalStealCount) || 0))
const ratio = computed(() => {
  if (!harvest.value)
    return steal.value ? '--' : '0%'
  return `${Number((steal.value / harvest.value * 100).toFixed(1))}%`
})
</script>

<template>
  <span v-if="career" class="career-stats">
    <span class="career-stat" :title="`收获 ${formatNumber(harvest)}`">
      <span class="career-stat-content"><span class="i-carbon-wheat text-green-600 dark:text-green-400" aria-hidden="true" />收获 {{ formatCompactAmount(harvest) }}</span>
    </span>
    <span class="career-stat" :title="`偷菜 ${formatNumber(steal)}`">
      <span class="career-stat-content"><span class="i-carbon-run text-orange-600 dark:text-orange-400" aria-hidden="true" />偷菜 {{ formatCompactAmount(steal) }}</span>
    </span>
    <span class="career-stat" title="偷菜数量 / 收获数量">
      <span class="career-stat-content"><span class="i-carbon-chart-relationship text-sky-600 dark:text-sky-400" aria-hidden="true" />收偷比 {{ ratio }}</span>
    </span>
  </span>
</template>

<style scoped>
.career-stats {
  display: inline-flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 2px 8px;
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: normal;
  font-variant-numeric: tabular-nums;
}

.career-stat {
  display: inline-flex;
  border-radius: 4px;
  background: var(--ui-surface-soft);
  line-height: 16px;
}

.career-stat-content {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 2px 6px;
  white-space: nowrap;
}
</style>
