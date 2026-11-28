<script setup lang="ts">
import { NButton } from 'naive-ui/es/button'
import { NPopover } from 'naive-ui/es/popover'
import { computed, ref, watch } from 'vue'
import { formatDuration } from '@/components/ranch/ranch-shared'
import RanchFeedMenu from '@/components/ranch/RanchFeedMenu.vue'
import { formatCountdown } from '@/utils/format-countdown'

/** 单只动物：与农场土地卡同一套结构（顶部标签 / 图 / 名称 / 状态 / 进度条），可选底部操作。 */
const props = withDefaults(defineProps<{
  animal: any
  /** 所在设施名称，例如“窝”“棚”。 */
  pen?: string
  /** 距离下一阶段的剩余时间文本，由父组件按服务器时钟计算。 */
  remaining?: string
  maturityRemaining?: string
  productionRemainingSeconds?: number | null
  progress?: number | null
  stageRemainingSeconds?: number | null
  actionable?: boolean
  friend?: boolean
  disabled?: boolean
  cropLayout?: boolean
  selecting?: boolean
  selected?: boolean
  buckets?: ReadonlyArray<{ id: number, name: string, seconds?: number | string }>
}>(), { pen: '', remaining: '', actionable: false, friend: false, disabled: false })

const emit = defineEmits<{ produce: [], harvest: [], feed: [bucketType: 1 | 2, produceAfterFeed: boolean], release: [], stroke: [] }>()
const failed = ref(false)
watch(() => props.animal?.image, () => failed.value = false)

const giant = computed(() => !!props.animal?.mutation?.type)
const weight = computed(() => {
  const x10 = Number(props.animal?.mutation?.weightX10) || 0
  return x10 > 0 ? `${(x10 / 100).toFixed(2).replace(/\.?0+$/, '')}kg` : ''
})
const status = computed(() => {
  const a = props.animal
  if (a.canHarvest)
    return { kind: 'ripe', text: '可收获', icon: 'i-carbon-checkmark-filled' }
  if (a.canProduce)
    return { kind: 'produce', text: '可生产', icon: 'i-carbon-circle-dash' }
  if (a.grassBlocked)
    return { kind: 'blocked', text: '缺少牧草', icon: 'i-carbon-warning-alt' }
  return null
})
const rounds = computed(() => {
  const max = Number(props.animal?.maxProduceCount) || 0
  return max > 0 ? { done: Math.min(max, Number(props.animal.produceCount) || 0), max } : null
})
const currentRound = computed(() => rounds.value ? Math.min(rounds.value.max, rounds.value.done + 1) : null)
const productionCountdown = computed(() => {
  const remaining = props.productionRemainingSeconds
  if (remaining == null || remaining <= 0 || status.value || props.animal.deliveringUntilMs) return null
  const duration = Number(props.animal.productionDurationSec)
  const percent = Number.isFinite(duration) && duration > 0
    ? Math.min(100, Math.max(0, Math.round((1 - remaining / duration) * 100))) : null
  const time = `${props.animal.productionEstimated ? '约 ' : ''}${formatCountdown(remaining)}`
  return { percent, time }
})
const maturityCountdown = computed(() => {
  const duration = Number(props.animal.stageDurationSec)
  const remaining = props.stageRemainingSeconds
  const percent = props.progress
  if (!props.maturityRemaining || props.animal.nextAtMs !== props.animal.matureAtMs
    || props.animal.deliveringUntilMs || remaining == null || percent == null || !Number.isFinite(duration) || duration <= 0)
    return null
  return { percent, duration, elapsed: Math.min(duration, Math.max(0, duration - remaining)) }
})
const growthDetails = computed(() => {
  const growth = props.animal?.growth
  return [
    { label: '幼崽期', seconds: Number(growth?.infantSec) },
    { label: '成长期', seconds: Number(growth?.growSec) },
    { label: '成熟期', seconds: Number(growth?.matureSec) },
    { label: '每轮生产', seconds: Number(growth?.productRoundSec) },
    { label: '每份产物耗草', seconds: Number(growth?.grassSecPerItem) },
  ].filter(({ seconds }) => Number.isFinite(seconds) && seconds > 0)
})
function roundProgress(round: number) {
  if (round <= (rounds.value?.done ?? 0)) return 100
  if (round !== currentRound.value) return 0
  return props.animal.canProduce || props.animal.canHarvest ? 100 : props.progress ?? 0
}
</script>

<template>
  <article class="pen grid-card selection-card margin-shell" :class="[status ? `pen--${status.kind}` : '', { 'pen--giant': giant, 'pen--crop-layout': cropLayout }]" :title="animal.name"><span class="margin-content">
    <header class="pen__top">
      <span v-if="cropLayout && animal.slot != null" class="pen__slot">#{{ animal.slot }}</span>
      <span v-if="pen" :class="cropLayout ? 'ui-area-badge' : 'pen__chip'">{{ pen }}</span>
      <span v-if="giant" class="pen__giant ui-area-badge" :title="weight ? `巨大 · ${weight}` : '巨大'">巨大<template v-if="weight"> {{ weight }}</template></span>
      <span v-if="selecting" class="pen__check" :class="selected ? 'i-carbon-checkmark-filled' : 'i-carbon-circle-dash'" aria-hidden="true" />
    </header>

    <NPopover v-if="cropLayout && !selecting" trigger="click" placement="top" class="pen-detail-popover" :style="{ padding: 0, borderRadius: 'var(--ui-radius-card)', backgroundColor: 'var(--ui-surface-strong)', boxShadow: 'var(--ui-shadow-md)' }">
      <template #trigger>
        <button type="button" class="pen__animal pen__animal-button" :aria-label="`查看${animal.name}详情`" @click.stop @keydown.stop>
          <img v-if="animal.image && !failed" :src="animal.image" alt="" loading="lazy" @error="failed = true">
          <span v-else class="pen__placeholder i-carbon-pet-image-o" aria-hidden="true" />
        </button>
      </template>
      <div class="pen-detail" role="region" :aria-label="`${animal.name}动物详情`">
        <div class="pen-detail__content">
          <p class="pen-detail__name">
            <template v-if="animal.slot != null">#{{ animal.slot }} · </template>{{ animal.name }}
            <span v-if="rounds" class="pen__stage">({{ currentRound }}/{{ rounds.max }})</span>
          </p>
          <section v-if="productionCountdown" class="pen-detail__section">
            <div class="pen-detail__section-content">
              <div class="pen-detail__row"><span>生产倒计时</span><span class="pen-detail__percent">{{ productionCountdown.percent == null ? productionCountdown.time : `${productionCountdown.percent}%` }}</span></div>
              <div v-if="productionCountdown.percent != null" class="pen-detail__track ui-progress-track" role="progressbar" aria-label="到生产的进度" :aria-valuenow="productionCountdown.percent">
                <span :style="{ width: `${productionCountdown.percent}%` }" />
              </div>
              <p v-if="productionCountdown.percent != null" class="pen-detail__muted">距生产 {{ productionCountdown.time }}</p>
            </div>
          </section>
          <section v-else class="pen-detail__section">
            <div class="pen-detail__section-content">
              <div class="pen-detail__row">
                <span>{{ animal.deliveringUntilMs && remaining ? '交付倒计时' : maturityRemaining ? '成熟倒计时' : '当前状态' }}</span>
                <span v-if="maturityCountdown" class="pen-detail__percent">{{ maturityCountdown.percent }}%</span>
                <span v-else-if="animal.deliveringUntilMs && remaining" class="pen-detail__percent">{{ remaining }}</span>
                <span v-else-if="maturityRemaining" class="pen-detail__percent">{{ maturityRemaining }}</span>
              </div>
              <div v-if="maturityCountdown" class="pen-detail__track ui-progress-track" role="progressbar" aria-label="成熟倒计时进度" :aria-valuenow="maturityCountdown.percent">
                <span :style="{ width: `${maturityCountdown.percent}%` }" />
              </div>
              <div v-if="maturityCountdown" class="pen-detail__row pen-detail__muted">
                <span>已生长 {{ formatCountdown(maturityCountdown.elapsed) }}</span>
                <span>总时长 {{ formatCountdown(maturityCountdown.duration) }}</span>
              </div>
              <div v-else class="pen-detail__row pen-detail__muted">
                <span>当前阶段 {{ animal.stageName || '—' }}</span>
              </div>
            </div>
          </section>
          <section v-if="stageRemainingSeconds != null" class="pen-detail__section">
            <div class="pen-detail__section-content">
              <div class="pen-detail__row"><span>阶段倒计时</span><span v-if="progress != null" class="pen-detail__percent">{{ progress }}%</span></div>
              <div v-if="progress != null" class="pen-detail__track ui-progress-track" role="progressbar" aria-label="当前阶段进度" :aria-valuenow="progress">
                <span :style="{ width: `${progress}%` }" />
              </div>
              <div class="pen-detail__row pen-detail__muted">
                <span>距{{ animal.nextStageLabel || '下一阶段' }} {{ formatCountdown(stageRemainingSeconds) }}</span>
                <span v-if="Number(animal.stageDurationSec) > 0">阶段时长 {{ formatCountdown(animal.stageDurationSec) }}</span>
              </div>
            </div>
          </section>
          <p v-if="giant" class="pen-detail__giant">巨大<template v-if="weight"> · {{ weight }}</template></p>
          <section v-if="growthDetails.length" class="pen-detail__section" aria-label="基础耗时">
            <div class="pen-detail__section-content">
              <p>基础耗时</p>
              <div v-for="detail in growthDetails" :key="detail.label" class="pen-detail__row pen-detail__muted">
                <span>{{ detail.label }}</span>
                <span>{{ formatDuration(detail.seconds) }}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </NPopover>
    <div v-else class="pen__animal">
      <img v-if="animal.image && !failed" :src="animal.image" alt="" loading="lazy" @error="failed = true">
      <span v-else class="pen__placeholder i-carbon-pet-image-o" aria-hidden="true" />
    </div>

    <div class="pen__name">
      {{ animal.name }}
      <span v-if="cropLayout && animal.stageName" class="pen__stage">({{ animal.stageName }})</span>
    </div>

    <div class="pen__time">
      <span v-if="status" class="pen__state" :class="`is-${status.kind}`"><span :class="status.icon" aria-hidden="true" />{{ status.text }}</span>
      <span v-else-if="cropLayout && productionCountdown" class="pen__countdown">距生产 {{ productionCountdown.time }}</span>
      <span v-else-if="remaining" class="pen__countdown"><span v-if="!cropLayout" class="i-carbon-time" aria-hidden="true" />{{ cropLayout ? `${animal.deliveringUntilMs ? '交付' : animal.nextStageLabel || '下一阶段'} ${remaining}` : remaining }}</span>
      <span v-else class="pen__state is-muted">{{ animal.stageName }}</span>
      <span v-if="cropLayout && productionCountdown?.percent != null" class="pen__progress">{{ productionCountdown.percent }}%</span>
      <span v-else-if="cropLayout && !productionCountdown && remaining && !status && !animal.deliveringUntilMs && progress != null" class="pen__progress">{{ progress }}%</span>
    </div>

    <div v-if="rounds" class="pen__rounds" :title="`已生产 ${rounds.done} / ${rounds.max} 轮`" :aria-label="`已生产 ${rounds.done} / ${rounds.max} 轮`" role="img">
      <i v-for="n in rounds.max" :key="n" :class="{ 'is-done': !cropLayout && n <= rounds.done, 'ui-progress-track': cropLayout }">
        <span v-if="cropLayout" :style="{ width: `${roundProgress(n)}%` }" />
      </i>
    </div>
    <div v-else class="pen__rounds" aria-hidden="true" />

    <footer v-if="actionable" class="pen__foot margin-shell" :class="{ 'divider-top': cropLayout }"><span class="margin-content">
      <NButton v-if="friend" size="tiny" type="primary" secondary :disabled="disabled || !animal.canStroke" :aria-label="`抚摸${animal.name}，${pen}第${animal.slot}栏`" @click="emit('stroke')">
        {{ animal.stroked ? '已抚摸' : animal.canStroke ? '抚摸' : '不可抚摸' }}
      </NButton>
      <NButton v-else-if="animal.canHarvest" size="tiny" type="primary" :disabled="disabled" @click="emit('harvest')">
        收获
      </NButton>
      <NButton v-else-if="animal.canProduce" size="tiny" type="primary" secondary :disabled="disabled" @click="emit('produce')">
        生产
      </NButton>
      <RanchFeedMenu v-else-if="animal.canFeed" v-slot="{ unavailable }" :buckets="buckets" :limited-can-used="animal.limitedCanUsed" :disabled="disabled" @feed="(type, produce) => emit('feed', type, produce)">
        <NButton size="tiny" secondary aria-haspopup="menu" :disabled="unavailable" :title="unavailable && !disabled ? '可用罐头不足或本轮已使用' : undefined">
          <span class="i-carbon-flash mr-0.5" aria-hidden="true" />喂养
        </NButton>
      </RanchFeedMenu>
      <span v-else class="pen__idle">成长中</span>
      <NButton v-if="!friend && animal.canRelease" size="tiny" quaternary :disabled="disabled" :aria-label="`放生${animal.name}，${pen}第${animal.slot}栏`" @click="emit('release')">
        放生
      </NButton>
    </span></footer>
  </span></article>
</template>

<style scoped>
.pen.pen--crop-layout {
  --inset-bottom: var(--ui-card-content-bottom-margin);
  font-weight: var(--fw-400);
}
.pen--crop-layout.grid-card:hover {
  transform: none;
}
.pen--crop-layout .pen__top {
  height: auto;
  min-height: 24px;
  font-size: var(--ui-content-item-font-height-tiny-12);
}
.pen__check { margin-inline-start: auto; color: var(--ui-primary); }
.pen--crop-layout .pen__animal {
  width: 44px;
  height: 44px;
}
.pen__animal-button {
  flex: none;
  align-self: center;
  box-sizing: border-box;
  padding: 0;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}
.pen__animal-button:is(:hover, :focus-visible) {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--ui-primary);
}
.pen.pen--crop-layout .pen__name {
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-400);
}
.pen__stage { color: var(--ui-muted); }
.pen.pen--crop-layout .pen__foot {
  width: calc(100% + 20px);
  margin-inline: -10px;
  --inset-left: 10px;
  --inset-right: 10px;
  border-top: 1px solid var(--ui-border);
}
.pen-detail {
  display: flow-root;
  width: min(280px, calc(100vw - 24px));
  border: 1px solid var(--ui-border-strong);
  border-radius: var(--ui-radius-card);
}
.pen-detail__content {
  display: grid;
  gap: var(--ui-content-vertical-gap);
  margin: 12px;
  color: var(--ui-ink);
  font-size: var(--ui-content-item-font-height-tiny-12);
}
.pen-detail__content p { margin: 0; }
.pen-detail__name { font-size: var(--ui-font-size-small-13); }
.pen-detail__section {
  display: flow-root;
  border-radius: 9px;
  background: var(--ui-surface-soft);
}
.pen-detail__section-content {
  display: grid;
  gap: var(--ui-content-vertical-gap);
  margin: var(--ui-content-vertical-gap);
}
.pen-detail__row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.pen-detail__percent { color: var(--ui-primary); }
.pen-detail__muted { color: var(--ui-muted); }
.pen-detail__track {
  --ui-progress-track-bg: color-mix(in srgb, var(--ui-ink) 24%, var(--ui-surface-soft));
  flex: 1;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
}
.pen-detail__track > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--ui-primary);
}
/* 卡面用干草色，与农场普通土地同一色系；巨大动物换成金色。 */
.pen {
  --pen-bg: #fbf8f1;
  --pen-line: #e6dbc2;
  --pen-ink: #86642e;
  --pen-chip: #f1e7d2;
  --grid-card-border: var(--pen-line);
  --grid-card-bg: var(--pen-bg);

  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  --inset-top: 8px; --inset-right: 10px; --inset-bottom: 10px; --inset-left: 10px;
  color: var(--ui-ink);
}

.pen--giant {
  --pen-bg: #fffae8;
  --pen-line: #ead57f;
  --pen-ink: #946600;
  --pen-chip: #f9e9a8;
}

.pen--ripe {
  --grid-card-border: color-mix(in srgb, var(--ui-primary) 55%, var(--pen-line));
}

.pen--blocked {
  --grid-card-border: color-mix(in srgb, var(--ui-warning) 60%, var(--pen-line));
}

.pen__top {
  display: flex;
  width: 100%;
  height: 20px;
  align-items: center;
  gap: 4px;
}

.pen__chip {
  padding: 0 6px;
  border-radius: 999px;
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-700);
  line-height: 16px;
  white-space: nowrap;
}

.pen__chip {
  color: var(--pen-ink);
  background: var(--pen-chip);
}

.pen__giant {
  --ui-area-badge-tint: #c08a12;
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-400);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.pen__giant,
.pen-detail__giant {
  color: var(--ui-warning);
}

.pen__animal {
  width: 52px;
  height: 52px;
  display: grid;
  margin-top: 2px;
  place-items: center;
}

.pen__animal img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.12));
}

.pen__placeholder {
  color: color-mix(in srgb, var(--pen-ink) 40%, transparent);
  font-size: var(--ui-font-size-large-15);
}

.pen__name {
  width: 100%;
  margin-top: 4px;
  overflow: hidden;
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-650);
  line-height: 16px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pen__time {
  display: flex;
  max-width: 100%;
  height: 20px;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
}

.pen__countdown {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--ui-warning);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-700);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.pen--crop-layout .pen__time {
  width: 100%;
  justify-content: space-between;
  gap: 4px;
}
.pen--crop-layout .pen__countdown {
  display: block;
  min-width: 0;
  overflow: hidden;
  font-weight: var(--fw-400);
  text-overflow: ellipsis;
}
.pen__progress {
  flex: none;
  color: var(--ui-subtle);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-400);
  font-variant-numeric: tabular-nums;
}

.pen__state {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 3px;
  overflow: hidden;
  padding: 0 7px;
  border-radius: 999px;
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-700);
  line-height: 18px;
  white-space: nowrap;
}

.pen__state.is-ripe {
  color: #fff;
  background: var(--ui-primary-fill);
}

.pen__state.is-produce {
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

.pen__state.is-blocked {
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
}

.pen__state.is-muted {
  padding: 0;
  color: var(--ui-subtle);
  font-weight: var(--fw-500);
}

/* 生产轮次：一轮一格，替代土地卡的成长进度条。 */
.pen__rounds {
  display: flex;
  width: 100%;
  height: 4px;
  gap: 3px;
  margin-top: 6px;
}

.pen__rounds i {
  flex: 1;
  border-radius: 999px;
  background: color-mix(in srgb, var(--pen-ink) 14%, transparent);
}

.pen__rounds i.is-done {
  background: linear-gradient(90deg, #9fd17d, var(--ui-primary));
}
.pen--crop-layout .pen__rounds i { overflow: hidden; min-width: 0; }
.pen--crop-layout .pen__rounds i > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #9fd17d, var(--ui-primary));
}

.pen__foot {
  display: flex;
  width: 100%;
  min-height: 28px;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  justify-content: center;
  margin-top: 8px;
  --inset-top: 6px;
  border-top: 1px dashed color-mix(in srgb, var(--pen-ink) 22%, transparent);
}

.pen__foot :deep(.n-button) {
  min-width: 48px;
  min-height: var(--ui-content-item-control-height-30);
}

.pen__idle {
  color: var(--ui-subtle);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.dark .pen {
  --pen-tint: #c9a867;
  --pen-bg: #1d2228;
  --pen-line: color-mix(in srgb, var(--pen-tint) 28%, transparent);
}

.dark .pen--giant {
  --pen-tint: #e6c35a;
  --pen-bg: #292519;
  --pen-line: color-mix(in srgb, var(--pen-tint) 38%, transparent);
}

.dark .pen--ripe {
  --grid-card-border: color-mix(in srgb, var(--ui-primary) 55%, transparent);
}

.dark .pen--blocked {
  --grid-card-border: color-mix(in srgb, var(--ui-warning) 55%, transparent);
}

.dark .pen__chip {
  color: var(--pen-tint);
  background: color-mix(in srgb, var(--pen-tint) 15%, transparent);
}

.dark .pen__rounds i {
  background: rgba(255, 255, 255, 0.08);
}

.dark .pen__rounds i.is-done {
  background: linear-gradient(90deg, #6fae5a, var(--ui-primary));
}

.dark .pen__foot {
  border-top-color: rgba(255, 255, 255, 0.08);
}
</style>
