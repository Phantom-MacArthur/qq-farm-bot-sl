<script setup lang="ts">
import { computed } from 'vue'
import { formatCompactAmount, formatNumber } from '@/utils/format-number'

/** 官方生涯统计的字段名，和 /api/career、好友土地详情返回的 career 保持一致。 */
export interface CareerHarvestSteal {
  totalHarvestCount?: number
  totalStealCount?: number
}

const props = defineProps<{
  career: CareerHarvestSteal | null | undefined
  compact?: boolean
}>()

const harvest = computed(() => Math.max(0, Number(props.career?.totalHarvestCount) || 0))
const steal = computed(() => Math.max(0, Number(props.career?.totalStealCount) || 0))
const harvestText = computed(() => formatCompactAmount(harvest.value))
const stealText = computed(() => formatCompactAmount(steal.value))
const ratioText = computed(() => {
  if (harvest.value <= 0)
    return steal.value > 0 ? '--' : '0%'
  const percent = steal.value / harvest.value * 100
  return `${percent.toFixed(1).replace(/\.0$/, '')}%`
})
</script>

<template>
  <template v-if="career">
    <template v-if="compact">
      <span class="career-stat" :title="`生涯收获 ${formatNumber(harvest)}`">
        <span class="i-carbon-wheat text-green-600 dark:text-green-400" aria-hidden="true" />
        <span class="career-stat__label">生涯收获</span>
        <b>{{ harvestText }}</b>
      </span>
      <span class="career-stat" :title="`生涯偷菜 ${formatNumber(steal)}`">
        <span class="i-carbon-run text-orange-600 dark:text-orange-400" aria-hidden="true" />
        <span class="career-stat__label">生涯偷菜</span>
        <b>{{ stealText }}</b>
      </span>
      <span class="career-stat" title="生涯偷菜 / 生涯收获">
        <span class="i-carbon-chart-relationship text-sky-600 dark:text-sky-400" aria-hidden="true" />
        <span class="career-stat__label">收偷比</span>
        <b>{{ ratioText }}</b>
      </span>
    </template>
    <template v-else>
      <div class="flex items-center gap-1.5 text-green-700 dark:text-green-300" :title="`生涯收获 ${formatNumber(harvest)}`">
        <div class="i-carbon-wheat" />
        <span class="font-body font-semibold">生涯收获: {{ harvestText }}</span>
      </div>
      <div class="flex items-center gap-1.5 text-orange-700 dark:text-orange-300" :title="`生涯偷菜 ${formatNumber(steal)}`">
        <div class="i-carbon-run" />
        <span class="font-body font-semibold">生涯偷菜: {{ stealText }}</span>
      </div>
      <div class="flex items-center gap-1.5 text-sky-700 dark:text-sky-300">
        <div class="i-carbon-chart-relationship" />
        <span class="font-body font-semibold">收偷比: {{ ratioText }}</span>
      </div>
    </template>
  </template>
</template>

<style scoped>
.career-stat {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ui-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.career-stat b {
  color: var(--ui-ink);
  font-weight: var(--fw-650);
}
</style>
