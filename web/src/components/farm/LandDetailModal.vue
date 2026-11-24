<script setup lang="ts">
import { NCard } from 'naive-ui/es/card'
import { NModal } from 'naive-ui/es/modal'
import { computed, nextTick, ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'

const props = defineProps<{ land: any, player: any, connected: boolean, upgradePending?: boolean }>()
const emit = defineEmits<{ close: [], upgrade: [] }>()
const info = computed(() => props.land?.landInfo)
const detailContent = ref<HTMLElement | null>(null)
const measuredWidth = ref<number | null>(null)
watch(() => props.land, () => { measuredWidth.value = null })
async function measureDialogWidth() {
  measuredWidth.value = null
  await nextTick()
  const images = detailContent.value?.querySelectorAll<HTMLImageElement>('.land-detail-soil img')
  if (!images || images.length < 2) return
  const firstWidth = images[0]!.offsetWidth
  const lastWidth = images[images.length - 1]!.offsetWidth
  const button = detailContent.value?.querySelector<HTMLElement>('.land-detail-upgrade')
  const buttonWidth = button?.offsetWidth ?? 0
  if (firstWidth > 0 && lastWidth > 0 && buttonWidth > 0)
    measuredWidth.value = firstWidth + lastWidth + buttonWidth + 4 * 12
}
const metrics = [
  { key: 'yieldBonus', label: '产量加成', unit: '%' },
  { key: 'growthReduction', label: '成长提速', unit: '%' },
  { key: 'expBonus', label: '经验加成', unit: '%' },
  { key: 'mutantMultiplier', label: '变异概率', unit: '倍' },
  { key: 'resonanceBonus', label: '共鸣加成', unit: '%' },
]
function metric(level: any, key: string, unit: string) {
  if (!level)
    return '—'
  const value = Number(level[key]) || 0
  return key === 'mutantMultiplier' && !value ? '无' : `${value}${unit}`
}
function integer(value: unknown): bigint | null {
  const text = String(value ?? '')
  return /^\d+$/.test(text) ? BigInt(text) : null
}
const balances = computed(() => ({ 1001: props.player?.gold, 1002: props.player?.coupon, 1005: props.player?.goldBean }))
const costs = computed(() => (info.value?.costs || []).map((cost: any) => {
  const balance = props.connected ? integer(balances.value[cost.id as keyof typeof balances.value]) : null
  const required = integer(cost.count) ?? 0n
  return { ...cost, available: balance, missing: balance === null ? null : required > balance ? required - balance : 0n }
}))
const levelMet = computed(() => props.connected && Number(props.player?.level) >= Number(info.value?.needLevel))
function format(value: unknown) {
  const parsed = integer(value)
  return parsed === null ? '—' : parsed.toLocaleString('zh-CN')
}
function compact(value: unknown) {
  const parsed = integer(value)
  if (parsed === null) return '—'
  const unit = parsed >= 100000000n ? 100000000n : parsed >= 10000n ? 10000n : 1n
  if (unit === 1n) return format(parsed)
  const tenths = (parsed * 10n + unit / 2n) / unit
  if (unit === 10000n && tenths >= 100000n) {
    const yi = (parsed * 10n + 50000000n) / 100000000n
    return `${yi / 10n}${yi % 10n ? `.${yi % 10n}` : ''}亿`
  }
  return `${tenths / 10n}${tenths % 10n ? `.${tenths % 10n}` : ''}${unit === 10000n ? '万' : '亿'}`
}
function costTitle(cost: any) {
  return `${cost.name}：当前余额 ${format(cost.available)}，所需 ${format(cost.count)}${cost.missing === null ? '，余额待同步' : cost.missing > 0n ? `，还差 ${format(cost.missing)}` : '，余额充足'}`
}
</script>

<template>
  <NModal :show="!!land" @after-enter="measureDialogWidth" @update:show="!$event && emit('close')">
    <NCard class="land-detail-modal" :class="{ 'land-detail-modal--measured': measuredWidth !== null }" :style="measuredWidth !== null ? { width: `${measuredWidth}px` } : undefined" content-style="padding: 0; min-width: 0" header-style="padding: 0" :bordered="false" closable role="dialog" aria-modal="true" aria-label="土地详情" @close="emit('close')">
      <template #header>
        <span class="font-display">土地详情 <span class="land-detail-number land-detail-number--id">#{{ land?.id }}</span></span>
      </template>
      <div v-if="info" ref="detailContent" class="land-detail-scroll dialog-scroll">
        <div class="land-detail-levels" :class="{ 'land-detail-levels--compare': info.next && info.current }">
          <div v-if="info.current" class="land-detail-soil">
            <img :src="info.current.image" :alt="info.current.name" width="84" height="70">
            <strong>{{ info.current.name }}</strong>
          </div>
          <BaseButton
            v-if="info.next && info.current"
            variant="secondary"
            class="land-detail-upgrade control-fit-content"
            :loading="upgradePending"
            :disabled="!connected || !land?.couldUpgrade || upgradePending"
            :aria-label="upgradePending ? '土地升级中' : '升级土地'"
            :title="land?.couldUpgrade ? '升级土地' : '当前暂不可升级'"
            @click="emit('upgrade')"
          >
            <template #icon><span class="i-carbon-upgrade" aria-hidden="true" /></template>
            <span>{{ upgradePending ? '升级中' : '升级' }}</span>
          </BaseButton>
          <div v-if="info.next" class="land-detail-soil">
            <img :src="info.next.image" :alt="info.next.name" width="84" height="70">
            <strong>{{ info.next.name }}</strong>
          </div>
        </div>
        <table class="land-detail-metrics">
          <thead>
            <tr>
              <th><span>土地加成</span></th><th><span>{{ info.current ? '当前' : '解锁后' }}</span></th><th v-if="info.current && info.next">
                <span>升级后</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in metrics" :key="row.key">
              <th><span>{{ row.label }}</span></th>
              <td><span class="land-detail-number">{{ metric(info.current || info.next, row.key, row.unit) }}</span></td>
              <td v-if="info.current && info.next" :class="{ 'land-detail-improved': info.next[row.key] > info.current[row.key] }">
                <span class="land-detail-number">{{ metric(info.next, row.key, row.unit) }}{{ info.next[row.key] > info.current[row.key] ? ' ↑' : '' }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="info.mode === 'max'" class="land-detail-max">
          <span>当前已满级</span>
        </div>
        <section v-else class="land-detail-requirements">
          <h3>{{ info.mode === 'unlock' ? '解锁条件' : '升级条件' }}</h3>
          <div v-if="info.needLevel !== null" class="land-detail-condition">
            <span>种植等级达到 <b class="land-detail-number">{{ info.needLevel }}</b> 级</span>
            <strong class="land-detail-number" :class="levelMet ? 'land-detail-improved' : 'land-detail-missing'">{{ connected ? player?.level ?? '—' : '—' }} / {{ info.needLevel }}</strong>
          </div>
          <div v-if="info.prerequisite" class="land-detail-condition">
            <span>解锁第 <b class="land-detail-number">{{ info.prerequisite.landId }}</b> 块土地</span>
            <strong :class="info.prerequisite.met ? 'land-detail-improved' : 'land-detail-missing'">{{ info.prerequisite.met ? '已满足' : '未满足' }}</strong>
          </div>
          <div v-if="info.precedingLands" class="land-detail-condition">
            <span>{{ info.precedingLands.name }}及以上达到 <b class="land-detail-number">{{ info.precedingLands.required }}</b> 块</span>
            <strong class="land-detail-number" :class="info.precedingLands.met === true ? 'land-detail-improved' : 'land-detail-missing'">{{ info.precedingLands.owned ?? '—' }} / {{ info.precedingLands.required }}</strong>
          </div>
          <div v-if="info.current && info.next" class="land-detail-condition">
            <span>当前地块为{{ info.current.name }}</span><span class="land-detail-improved">已满足</span>
          </div>
          <div v-for="cost in costs" :key="cost.id" class="land-detail-cost">
            <div class="land-detail-cost-name">
              <img v-if="cost.image" :src="cost.image" alt="" width="28" height="28"><span>{{ cost.name }}</span>
            </div>
            <div class="land-detail-cost-amount resource-amount" :title="costTitle(cost)" :class="cost.missing === null ? 'land-detail-muted' : cost.missing === 0n ? 'land-detail-improved' : 'land-detail-missing'">
              <span class="land-detail-number">{{ compact(cost.available) }} / {{ compact(cost.count) }}</span>
            </div>
          </div>
          <p v-if="info.unknown" class="land-detail-missing">
            部分条件暂未获取
          </p>
          <p v-else-if="info.serverAllowed && connected" class="land-detail-improved">
            当前可{{ info.mode === 'unlock' ? '解锁' : '升级' }}
          </p>
        </section>
      </div>
      <p v-else>
        土地详情暂未获取，请刷新农场。
      </p>
    </NCard>
  </NModal>
</template>

<style scoped>
.land-detail-modal {
  --n-padding-left: 0px !important;
  --n-padding-right: 0px !important;
  --n-padding-top: 0px !important;
  --n-padding-bottom: 0px !important;
  box-sizing: content-box;
  width: max-content;
  max-width: calc(100vw - 24px);
  height: auto;
  max-height: calc(100dvh - 24px);
  overflow-x: auto;
  overflow-y: auto;
  border-radius: 16px;
  font-family: inherit;
  font-size: var(--ui-font-size-small-13);
}
.land-detail-modal :deep(*) {
  box-sizing: border-box;
}
.land-detail-modal :deep(.n-card-header) {
  padding: 0;
}
.land-detail-modal :deep(.n-card-header__main) {
  margin: var(--ui-content-vertical-gap) 0 var(--ui-content-vertical-gap) 12px;
  font-size: var(--ui-content-titlebar-font-height-large-15);
}
.land-detail-modal :deep(.n-card-header__close) {
  margin-right: 16px;
}
.land-detail-modal :deep(.n-card__content) {
  padding: 0;
}
.land-detail-number {
  font-family: inherit;
  font-size: inherit;
  font-variant-numeric: tabular-nums;
  font-weight: var(--fw-400);
  white-space: nowrap;
}
.land-detail-number--id {
  margin-left: 4px;
  font-size: var(--ui-font-size-small-13);
  opacity: 0.65;
}
.land-detail-modal :deep(.n-card-content) {
  display: flex;
  min-height: 0;
  flex-direction: column;
}
.land-detail-scroll {
  display: flow-root;
  margin: 0;
  font-size: var(--ui-font-size-small-13);
  padding: 0;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: auto;
}
.land-detail-scroll :deep(*) {
  font-weight: var(--fw-400) !important;
}
.land-detail-levels {
  display: grid;
  justify-content: center;
  align-items: center;
  gap: var(--ui-content-vertical-gap) 12px;
  margin: 0 12px var(--ui-content-vertical-gap);
}
.land-detail-levels--compare {
  grid-template-columns: 64px max-content 64px;
}
.land-detail-modal--measured .land-detail-levels--compare {
  grid-template-columns: 64px max-content 64px;
}
.land-detail-soil {
  display: contents;
}
.land-detail-soil img {
  grid-column: 1;
  grid-row: 1;
  justify-self: center;
  width: 64px;
  height: 54px;
  object-fit: contain;
}
.land-detail-soil strong {
  grid-column: 1;
  grid-row: 2;
  justify-self: center;
  font-size: var(--ui-font-size-small-13);
  font-weight: var(--fw-400);
}
.land-detail-upgrade {
  grid-column: 2;
  grid-row: 1;
  align-self: center;
  justify-self: center;
}
.land-detail-levels--compare .land-detail-soil:last-child > * {
  grid-column: 3;
}
.land-detail-metrics {
  width: 100%;
  border-collapse: collapse;
}
.land-detail-metrics th,
.land-detail-metrics td {
  padding: 0;
  text-align: right;
}
.land-detail-metrics :is(th, td) > span:first-child {
  display: inline-block;
  /* 相邻两行各承担一半外距，总间距为模板的 8px。 */
  margin: calc(var(--ui-content-vertical-gap) / 2) 12px;
}
.land-detail-metrics th:first-child {
  text-align: left;
  font-weight: var(--fw-400);
}
.land-detail-metrics thead {
  font-size: var(--ui-font-size-small-13);
  border-bottom: 1px solid var(--n-border-color);
}
.land-detail-requirements {
  display: flow-root;
  margin-top: var(--ui-content-vertical-gap);
  border-top: 1px solid var(--n-border-color);
}
.land-detail-requirements h3 {
  margin: var(--ui-content-vertical-gap) 12px;
  font-size: var(--ui-font-size-small-13);
  font-weight: var(--fw-400);
}
.land-detail-condition {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: nowrap;
  gap: var(--ui-content-vertical-gap) 12px;
  margin: var(--ui-content-vertical-gap) 12px;
}
.land-detail-condition > :first-child {
  min-width: 0;
  overflow-wrap: anywhere;
}
.land-detail-condition > :last-child {
  flex: none;
}
.land-detail-cost {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: var(--ui-content-vertical-gap) 12px;
}
.land-detail-cost-name {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: var(--ui-font-size-small-13);
  font-weight: var(--fw-400);
}
.land-detail-cost-name img {
  width: 18px;
  height: 18px;
  object-fit: contain;
}
.land-detail-cost-amount {
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: right;
}
.land-detail-cost-amount span {
  font-size: var(--ui-font-size-small-13);
}
.land-detail-improved {
  color: var(--ui-primary);
}
.land-detail-missing {
  color: var(--ui-warning);
}
.land-detail-muted {
  color: var(--ui-muted);
}
.land-detail-max {
  margin: var(--ui-content-vertical-gap) 12px;
  display: flow-root;
  text-align: center;
  border-radius: 12px;
  background: rgba(69, 155, 93, 0.12);
  color: var(--ui-primary);
  font-weight: var(--fw-400);
}
.land-detail-max > span {
  display: block;
  margin: var(--ui-content-vertical-gap) 12px;
}
.land-detail-requirements > p {
  margin: var(--ui-content-vertical-gap) 12px;
}
.land-detail-requirements > :last-child {
  margin-bottom: 12px;
}
</style>
