<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { NTooltip } from 'naive-ui/es/tooltip'
import { computed, ref, watch } from 'vue'
import RunLogPanel from '@/components/RunLogPanel.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { useAccountPresence } from '@/composables/useReconnectRefresh'
import { useAccountStore } from '@/stores/account'
import { useOverviewStore } from '@/stores/overview'
import { useStatusStore } from '@/stores/status'
import { formatCompactAmount, formatNumber } from '@/utils/format-number'

const statusStore = useStatusStore()
const accountStore = useAccountStore()
const overviewStore = useOverviewStore()
const {
  status,
  realtimeConnected,
} = storeToRefs(statusStore)
const { currentAccountId } = storeToRefs(accountStore)
const { ranch: activeRanch, diamond: diamondBalance, fertilizerItems } = storeToRefs(overviewStore)
const presence = useAccountPresence()
const isOnline = computed(() => presence.value === 'online')
const isOffline = computed(() => presence.value === 'offline')

/**
 * 方案B：保留上一次有效的种植经验。
 *
 * 土地快照靠 AllLands 刷新，在两次刷新之间可能短暂取不到（好友操作占满连接、网关繁忙等），
 * 这时整行直接消失会让人以为「种植经验丢了」。所以这里缓存上一次的有效值：
 * 只有后端明确给出「快照有效且地里没有作物」时才清掉缓存，其余情况沿用旧值。
 */
const cachedPlantExp = ref<number | null>(null)

watch(
  () => status.value?.levelForecast,
  (forecast: any) => {
    if (!forecast) {
      cachedPlantExp.value = null
      return
    }
    const plotCount = Number(forecast.plotCount || 0)
    const scheduledExp = Number(forecast.scheduledExp || 0)
    if (forecast.snapshotValid === true) {
      // 快照可信：地里确实没作物才清空，否则更新为最新值。
      cachedPlantExp.value = plotCount > 0 ? scheduledExp : null
      return
    }
    // 快照暂时不可用：保留上一次的有效值，不要让整行闪烁消失。
    if (plotCount > 0)
      cachedPlantExp.value = scheduledExp
  },
  { immediate: true },
)

const showPlantExp = computed(() => !!status.value?.connection?.connected && cachedPlantExp.value !== null)
const plantExpValue = computed(() => cachedPlantExp.value ?? 0)

const facilitySummaries = computed(() => [6, 7, 8].map((type) => {
  const facility = activeRanch.value?.facilities?.find((item: any) => Number(item.moduleType) === type)
  return {
    type, label: type === 6 ? '窝' : type === 7 ? '棚' : '牧草机',
    level: facility?.level ?? '--',
    count: facility ? (type === 8 ? facility.feed?.count : facility.ranch?.count ?? (facility.active ? null : 0)) ?? '--' : '--',
    capacity: facility ? (type === 8 ? facility.capacity : facility.ranch?.capacity ?? (facility.active ? null : 0)) ?? '--' : '--',
  }
}))
const ranchOccupancy = computed(() => {
  const pens = facilitySummaries.value.slice(0, 2).filter(f => f.level !== '--')
  if (!pens.length)
    return '--/--'
  return `${pens.reduce((sum, f) => sum + Number(f.count), 0)}/${pens.reduce((sum, f) => sum + Number(f.capacity), 0)}`
})
const productionExp = computed(() => {
  if (!activeRanch.value?.unlocked)
    return null
  const animals = (activeRanch.value.facilities || []).flatMap((f: any) => f.ranch?.animals || [])
  if (animals.some((animal: any) => animal.harvestExp == null))
    return null
  return animals.reduce((sum: number, animal: any) => sum + Number(animal.harvestExp), 0)
})
const experienceRows = computed(() => [
  { key: 'farm', label: '农场', level: status.value?.status?.level ?? '--', current: status.value?.levelProgress?.current ?? null, needed: status.value?.levelProgress?.needed ?? null },
  { key: 'ranch', label: '牧场', level: activeRanch.value?.unlocked ? activeRanch.value.level : '--', current: activeRanch.value?.unlocked ? activeRanch.value.currentExp : null, needed: activeRanch.value?.neededExp ?? null },
])
function experienceHint(row: { current: number | null, needed: number | null }) {
  if (row.current === null)
    return '经验数据尚未获取'
  return row.needed === null
    ? `经验：${formatNumber(row.current)}，已满级`
    : `经验：${formatNumber(row.current)} / ${formatNumber(row.needed)}，还差${formatNumber(Math.max(0, row.needed - row.current))}经验升级`
}
// 后端 todayAssetGains 按当前账号、当日持久化基线计算；缺失字段不显示，绝不以前端首见余额代替。
const todayAssetGains = computed<Record<string, number | null>>(() => {
  const id = String(currentAccountId.value || '')
  const farm = String(status.value?.accountId || '') === id ? status.value?.todayAssetGains : null
  const ranch = activeRanch.value?.todayAssetGains
  const ranchKeys = ['ranchCoupon', 'pinecone', 'grass', 'dung', 'canNormal', 'canOrganic']
  return { ...farm, ...Object.fromEntries(ranchKeys.filter(key => ranch?.[key] !== null && ranch?.[key] !== undefined).map(key => [key, ranch[key]])) }
})
const assetTiles = computed(() => {
  const farm = String(status.value?.accountId || '') === String(currentAccountId.value || '') ? status.value?.status : null
  const ranch = activeRanch.value
  const currency = (id: number) => ranch?.unlocked ? ranch.currencies?.find((item: any) => Number(item.id) === id)?.count : null
  const bucket = (id: number) => ranch?.unlocked ? ranch.buckets?.find((item: any) => Number(item.id) === id)?.seconds : null
  const fertilizer = (id: number) => fertilizerItems.value.find(item => Number(item.id) === id)?.count
  return [
    { key: 'gold', label: '金币', icon: '/game-config/resource-icons/gold.png', raw: farm?.gold },
    { key: 'coupon', label: '点券', icon: '/game-config/resource-icons/coupon.png', raw: farm?.coupon },
    { key: 'goldBean', label: '金豆', icon: '/game-config/resource-icons/gold-bean.png', raw: farm?.goldBean },
    { key: 'ranchCoupon', label: '金券', icon: '/game-config/seed_images_named/seed_images/1007.png', raw: currency(1007) },
    { key: 'pinecone', label: '松果', icon: '/game-config/seed_images_named/seed_images/1008.png', raw: currency(1008) },
    { key: 'grass', label: '牧草', icon: '/game-config/seed_images_named/seed_images/7001.png', raw: ranch?.unlocked ? ranch.grass : null },
    { key: 'dung', label: '便便', icon: '/game-config/seed_images_named/seed_images/7002.png', raw: currency(7002) },
    { key: 'diamond', label: '钻石', icon: '/game-config/resource-icons/diamond.png', raw: diamondBalance.value },
    { key: 'fertilizerNormal', label: '普肥', icon: '/game-config/resource-icons/fertilizer-normal.png', raw: fertilizer(1011), hours: true },
    { key: 'fertilizerOrganic', label: '机肥', icon: '/game-config/resource-icons/fertilizer-organic.png', raw: fertilizer(1012), hours: true },
    { key: 'canNormal', label: '普罐', icon: '/game-config/seed_images_named/seed_images/80021.png', raw: bucket(7003), hours: true },
    { key: 'canOrganic', label: '机罐', icon: '/game-config/seed_images_named/seed_images/80031.png', raw: bucket(7004), hours: true },
  ].map(item => {
    const amount = item.raw === null || item.raw === undefined || item.raw === '' ? null : Number(item.raw)
    return { ...item, amount: amount !== null && Number.isFinite(amount) ? (item.hours ? amount / 3600 : amount) : null }
  })
})
function assetText(amount: number | null, hours?: boolean) {
  return amount === null ? '--' : `${formatCompactAmount(amount)}${hours ? 'h' : ''}`
}

function assetGain(key: string, amount: number | null, hours?: boolean) {
  const raw = todayAssetGains.value[key]
  if (amount === null || raw === null || raw === undefined || !Number.isFinite(Number(raw)) || Number(raw) === 0)
    return ''
  const difference = hours ? Number(raw) / 3600 : Number(raw)
  const value = hours && Math.abs(difference) < 1
    ? `${Number(Math.abs(difference).toFixed(6))}h`
    : `${formatCompactAmount(Math.abs(difference))}${hours ? 'h' : ''}`
  return `(${difference > 0 ? '+' : '-'}${value})`
}

function getExpPercent(p: any) {
  if (p?.current == null)
    return 0
  if (p.needed === null)
    return 100
  if (!p.needed)
    return 0
  return Math.min(100, Math.max(0, (p.current / p.needed) * 100))
}

function refreshStatus() {
  const accountId = String(currentAccountId.value || '')
  if (accountId && !realtimeConnected.value)
    void statusStore.fetchStatus(accountId)
}

watch(currentAccountId, () => {
  cachedPlantExp.value = null
})

watch([currentAccountId, isOnline], ([accountId, online], [previousAccountId]) => {
  if (accountId !== previousAccountId)
    refreshStatus()
  if (!accountId || !online)
    return
  const id = String(accountId)
  const minInterval = accountId === previousAccountId ? 0 : undefined
  void overviewStore.refreshRanch(id, minInterval)
  void overviewStore.refreshDiamond(id, minInterval)
  void overviewStore.refreshFertilizer(id, minInterval)
}, { immediate: true })

function operationsEqual(next: Record<string, unknown> | null | undefined, prev: Record<string, unknown> | null | undefined) {
  const nextOperations = next || {}
  const prevOperations = prev || {}
  const nextKeys = Object.keys(nextOperations)
  const prevKeys = Object.keys(prevOperations)
  return nextKeys.length === prevKeys.length && nextKeys.every(key => nextOperations[key] === prevOperations[key])
}

watch(() => status.value?.operations, (next, prev) => {
  if (isOnline.value && realtimeConnected.value && !operationsEqual(next, prev))
    void overviewStore.refreshFertilizer(String(currentAccountId.value), 2500)
})

useIntervalFn(() => {
  refreshStatus()
  if (isOnline.value)
    void overviewStore.refreshFertilizer(String(currentAccountId.value))
}, 10000)
useIntervalFn(() => {
  if (!isOnline.value)
    return
  const id = String(currentAccountId.value)
  void overviewStore.refreshRanch(id)
  if (diamondBalance.value === null)
    void overviewStore.refreshDiamond(id)
}, 30000)
</script>

<template>
  <div class="dashboard-page page-stack flex flex-col">
    <div class="overview-grid">
      <section class="ov-card ov-account margin-shell"><span class="margin-content">
        <div v-if="isOffline" class="ov-account__head">
          <RefreshButton
            label="重新加载账号信息"
            :loading="accountStore.bulkKind === 'start'"
            :disabled="accountStore.bulkRunning || !currentAccountId"
            @click="accountStore.reloadCurrentAccount()"
          />
        </div>
        <template v-for="row in experienceRows" :key="row.key">
          <hr v-if="row.key === 'ranch'" class="ov-exp__divider">
          <div class="ov-exp" :class="{ 'ov-exp--ranch': row.key === 'ranch' }">
            <div class="ov-exp__labels">
              <span><span class="ui-area-badge" :class="{ 'ui-area-badge--ranch': row.key === 'ranch' }">{{ row.label }}</span> <span class="ov-data">Lv.{{ row.level }}</span></span>
              <span v-if="row.key === 'farm'">种植 <span class="ov-data">{{ status?.levelForecast?.plantedLandCount ?? '--' }}/{{ status?.levelForecast?.unlockedLandCount ?? '--' }}</span></span>
              <span v-else>饲养 <span class="ov-data">{{ ranchOccupancy }}</span></span>
            </div>
            <div class="ov-exp__numbers">
              <span v-if="row.key === 'farm'" :title="showPlantExp ? `预计收获经验：${formatNumber(plantExpValue)}` : '经验数据尚未获取'">种植经验 <span class="ov-data">{{ formatCompactAmount(showPlantExp ? plantExpValue : null) }}</span></span>
              <span v-else :title="productionExp === null ? '经验数据尚未获取' : `预计收获经验：${formatNumber(productionExp)}`">饲养经验 <span class="ov-data">{{ formatCompactAmount(productionExp) }}</span></span>
              <NTooltip>
                <template #trigger>
                  <span class="ov-exp__value" tabindex="0">
                    <span class="ov-data">{{ formatCompactAmount(row.current) }} / {{ formatCompactAmount(row.needed) }}</span> 经验
                  </span>
                </template>
                {{ experienceHint(row) }}
              </NTooltip>
            </div>
            <NTooltip>
              <template #trigger>
                <div class="ov-exp__track ui-progress-track" tabindex="0" :aria-label="`${row.label}经验：${experienceHint(row)}`">
                  <div class="ov-exp__bar" :class="{ 'ov-exp__bar--ranch': row.key === 'ranch' }" :style="{ width: `${getExpPercent({ current: row.current, needed: row.needed })}%` }" />
                </div>
              </template>
              {{ experienceHint(row) }}
            </NTooltip>
            <div v-if="row.key === 'ranch'" class="ov-account__summary">
              <span v-for="facility in facilitySummaries" :key="facility.type">{{ facility.label }} <span class="ov-data">Lv.{{ facility.level }} {{ facility.count }}/{{ facility.capacity }}</span></span>
            </div>
          </div>
        </template>
      </span></section>

      <section class="ov-card ov-assets">
        <div class="ov-assets__grid">
          <div v-for="item in assetTiles" :key="item.key" class="ov-asset margin-shell"><span class="margin-content">
            <span class="ov-asset__label"><img :src="item.icon" :alt="item.label">{{ item.label }}</span>
            <span class="ov-asset__figures" :title="item.amount === null ? `${item.label} --` : `${item.label} ${formatNumber(item.amount)}${item.hours ? 'h' : ''}`">
              <strong class="ov-asset__value ov-data">{{ assetText(item.amount, item.hours) }}</strong>
              <small v-if="assetGain(item.key, item.amount, item.hours)" class="asset-daily-change ov-data">{{ assetGain(item.key, item.amount, item.hours) }}</small>
            </span>
          </span></div>
        </div>
      </section>
    </div>

    <!-- 运行日志（页面最下方，整宽展示） -->
    <section class="dashboard-log-card panel-scroll-layout page-card-surface margin-shell" aria-label="运行日志"><span class="margin-content">
      <RunLogPanel default-module="farm" :max-logs="200" list-class="min-h-0 flex-1" />
    </span></section>
  </div>
</template>

<style scoped>
.dashboard-page {
  flex: 1 1 auto;
  min-height: 0;
  gap: 12px;
  /* 外层默认留白不足 12px 时补足日志底部间距。 */
  padding-bottom: max(0px, calc(12px - var(--page-pad-bottom, var(--page-pad, 16px))));
}

.dashboard-log-card {
  flex: 1 1 120px;
  min-height: 180px;
  overflow: clip;
  --inset-top: 0; --inset-right: 0; --inset-bottom: 0; --inset-left: 0;
}

.overview-grid {
  --ov-asset-columns: 4;
  --ov-font-size: var(--ui-content-item-font-height-tiny-12);
  display: grid;
  grid-template-columns: minmax(min(100%, 340px), 40%) minmax(0, 1fr);
  gap: 8px;
}

@media (max-width: 900px) {
  .overview-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.ov-card {
  --ov-card-padding: 8px;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
  --inset-top: var(--ov-card-padding); --inset-right: var(--ov-card-padding); --inset-bottom: var(--ov-card-padding); --inset-left: var(--ov-card-padding);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-card);
  background: var(--ui-surface);
  box-shadow:
    inset 0 1px 0 var(--glass-highlight),
    var(--ui-shadow-sm);
}

.ov-account > .margin-content > .ov-exp {
  display: grid;
  flex: 3 1 0;
  grid-auto-rows: 1fr;
  align-items: center;
}

.ov-account > .margin-content > .ov-exp--ranch {
  flex-grow: 4;
}

.ov-exp__divider {
  flex-shrink: 0;
}

.ov-account__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--ui-ink);
  font-size: var(--ui-font-size-large-15);
}

.ov-account__summary {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  overflow-x: auto;
  white-space: nowrap;
  color: var(--ui-muted);
  font-size: var(--ov-font-size);
}

.ov-account__summary > span {
  flex: none;
}

.overview-grid .ov-data {
  color: var(--ui-success, #258044);
  font-weight: 400;
}

.ov-account,
.ov-account :deep(*),
.ov-assets,
.ov-assets :deep(*) {
  font-weight: 400;
}

.ov-exp__numbers {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 4px 12px;
  color: var(--ui-muted);
  font-size: var(--ov-font-size);
  font-variant-numeric: tabular-nums;
}

.ov-exp__divider {
  margin: 0 calc(-1 * var(--ov-card-padding));
  border: 0;
  border-top: 1px solid var(--ui-border);
}

.ov-exp__labels {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  color: var(--ui-muted);
  font-size: var(--ov-font-size);
}

.ov-exp__value {
  font-variant-numeric: tabular-nums;
}

.ov-exp__track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
}

.ov-exp__bar {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #5c9fd0, #4b86c5);
  transition: width 0.5s ease;
}

.ov-exp__bar--ranch {
  background: linear-gradient(90deg, #65c38b, #28a86f);
}

/* 资产与库存：四列三行 */
.ov-assets {
  --inset-top: 0; --inset-right: 0; --inset-bottom: 0; --inset-left: 0;
  overflow: hidden;
}

.ov-assets__grid {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(var(--ov-asset-columns), minmax(0, 1fr));
  grid-auto-rows: 1fr;
  gap: 1px;
  overflow: clip;
}

.ov-asset {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  --inset-top: var(--ov-card-padding); --inset-right: var(--ov-card-padding); --inset-bottom: var(--ov-card-padding); --inset-left: var(--ov-card-padding);
}

.ov-asset::before {
  position: absolute;
  inset: -1px 0 0 -1px;
  border-block-start: 1px solid var(--ui-border);
  border-inline-start: 1px solid var(--ui-border);
  pointer-events: none;
  content: '';
}

@media (width > 900px) {
  .ov-asset:nth-child(4n + 1) {
    padding-inline-start: var(--ov-card-padding);
  }

  .ov-asset:nth-child(4n) {
    --inset-right: var(--ov-card-padding);
  }

  .ov-asset:nth-child(-n + 4) {
    padding-block-start: var(--ov-card-padding);
  }

  .ov-asset:nth-last-child(-n + 4) {
    padding-block-end: var(--ov-card-padding);
  }
}

@media (width <= 900px) {
  .ov-asset:nth-child(4n + 1) {
    padding-inline-start: var(--ov-card-padding);
  }

  .ov-asset:nth-child(4n) {
    --inset-right: var(--ov-card-padding);
  }

  .ov-asset:nth-child(-n + 4) {
    padding-block-start: var(--ov-card-padding);
  }

  .ov-asset:nth-last-child(-n + 4) {
    padding-block-end: var(--ov-card-padding);
  }
}

.ov-asset__label {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: var(--ui-muted);
  font-size: var(--ui-font-size-small-13);
  white-space: nowrap;
}

.ov-asset__label img {
  flex: none;
  width: 18px;
  height: 18px;
  object-fit: contain;
}

.ov-asset__value {
  color: var(--ui-ink);
  font-size: var(--ov-font-size);
  font-weight: 400;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.ov-asset__figures {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
}

.ov-asset__figures .asset-daily-change {
  font-size: var(--ov-font-size);
}

</style>
