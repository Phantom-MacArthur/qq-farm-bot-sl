<script setup lang="ts">
import { NCheckbox } from 'naive-ui/es/checkbox'
import { NInputNumber } from 'naive-ui/es/input-number'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'
import { useStatusStore } from '@/stores/status'

/* 种植策略对比面板：各策略下当前等级可种的最优作物。
   自带数据加载，既可整页展示，也可放进弹窗里预览（设置页「策略预览」）。 */

const accountStore = useAccountStore()
const statusStore = useStatusStore()
const { currentAccountId } = storeToRefs(accountStore)
const { status, currentAccountConnected } = storeToRefs(statusStore)

const loading = ref(false)
const list = ref<any[]>([])
const sortKey = ref('exp')
const imageErrors = ref<Record<string | number, boolean>>({})

const strategyLevel = ref(1)
const excludeUnsellable = ref(false)

watch(() => status.value?.status?.level, (newLevel) => {
  if (newLevel && Number(newLevel) > 0)
    strategyLevel.value = Number(newLevel)
}, { immediate: true })

/* 种子是否“可购买”只认种子商店列表，与作物图鉴的“其他途径获取”判定同源。
   列表读不到时置空，开关不可用，避免把全部作物误判成不可售。 */
const shopSeedIds = ref<Set<number> | null>(null)
let shopSeedRevision = 0
const shopSeedReady = computed(() => (shopSeedIds.value?.size || 0) > 0)
const excludeUnsellableHint = computed(() => shopSeedReady.value
  ? '排除作物图鉴中“其他途径获取”的种子'
  : '账号在线并读取种子商店后可启用')

function isShopSeed(seedId: any) {
  const ids = shopSeedIds.value
  if (!ids)
    return true
  return ids.has(Number(seedId))
}

async function loadShopSeedIds() {
  const accountId = currentAccountId.value
  const revision = ++shopSeedRevision
  if (!accountId || !currentAccountConnected.value) {
    shopSeedIds.value = null
    return
  }
  try {
    const { data } = await api.get('/api/seeds', {
      headers: { 'x-account-id': accountId },
      skipErrorToast: true,
    } as any)
    if (revision !== shopSeedRevision)
      return
    const entries: any[] = data?.ok && Array.isArray(data.data) ? data.data : []
    // 商店请求失败时后端会回退成本地种子列表，此时全部带 unknownMeta，不能当作真实货架。
    const inShop = entries.filter(seed => Number(seed?.goodsId) > 0 && !seed?.unknownMeta)
    shopSeedIds.value = inShop.length > 0 ? new Set(inShop.map(seed => Number(seed.seedId))) : null
  }
  catch {
    if (revision === shopSeedRevision)
      shopSeedIds.value = null
  }
}

watch(shopSeedReady, (ready) => {
  if (!ready)
    excludeUnsellable.value = false
})

const strategies = [
  {
    key: 'level',
    label: '最高等级',
    metric: 'level',
    color: 'rose',
    icon: 'i-carbon-star',
    unit: 'lv.',
    desc: '等级最高的作物',
  },
  {
    key: 'max_exp',
    label: '经验/时',
    metric: 'expPerHour',
    color: 'purple',
    icon: 'i-carbon-chart-line',
    unit: '经验',
    desc: '每小时经验收益最高',
  },
  {
    key: 'max_fert_exp',
    label: '普肥经验/时',
    metric: 'normalFertilizerExpPerHour',
    color: 'blue',
    icon: 'i-carbon-chemistry',
    unit: '经验',
    desc: '使用普通化肥后经验最高',
  },
  {
    key: 'max_profit',
    label: '利润/时',
    metric: 'profitPerHour',
    color: 'amber',
    icon: 'i-carbon-currency-dollar',
    unit: '金币',
    desc: '每小时净利润最高',
  },
  {
    key: 'max_fert_profit',
    label: '普肥利润/时',
    metric: 'normalFertilizerProfitPerHour',
    color: 'green',
    icon: 'i-carbon-money',
    unit: '金币',
    desc: '使用普通化肥后利润最高',
  },
]

interface StrategyRow {
  key: string
  name: string
  hint: string
  icon: string
  tone: string
  plant: any
  emptyText: string
  value: StrategyValue
}

/* 种子数据列拆成「前缀 + 数字 + 单位」，只有数字用绿色，其余保持默认文字颜色。 */
interface StrategyValue {
  text: string
  prefix: string
  number: string
  suffix: string
}

function fallbackStrategyValue(text: string): StrategyValue {
  return { text, prefix: '', number: '', suffix: '' }
}

function formatStrategyValue(metric: string | undefined, unit: string | undefined, value: any): StrategyValue {
  if (!metric || value === null || value === undefined || value === '')
    return fallbackStrategyValue('--')
  if (metric === 'level')
    return { text: '', prefix: 'lv.', number: String(value), suffix: '' }
  return { text: '', prefix: '', number: String(value), suffix: `${unit}/时` }
}

/* 策略行：五种策略，列顺序统一为「策略 / 种子 / 种子数据」。 */
const strategyRows = computed<StrategyRow[]>(() => {
  const rows: StrategyRow[] = []

  for (const strategy of strategies) {
    const plant = getStrategyBestPlant(strategy.key)
    rows.push({
      key: strategy.key,
      name: strategy.label,
      hint: strategy.desc,
      icon: strategy.icon,
      tone: strategy.color,
      plant,
      emptyText: '暂无可种植作物',
      value: plant ? formatStrategyValue(strategy.metric, strategy.unit, plant[strategy.metric]) : fallbackStrategyValue('--'),
    })
  }

  return rows
})

function getStrategyBestPlant(strategyKey: string) {
  const strategy = strategies.find(s => s.key === strategyKey)
  if (!strategy)
    return null

  const metric = strategy.metric
  const filtered = list.value.filter((item) => {
    if (excludeUnsellable.value && !isShopSeed(item.seedId))
      return false
    const level = item.level
    if (level === null || level === undefined)
      return true
    return Number(level) <= strategyLevel.value
  })

  if (filtered.length === 0)
    return null

  if (strategyKey === 'level') {
    return [...filtered].sort((a, b) => {
      const av = a.level ?? -1
      const bv = b.level ?? -1
      return bv - av
    })[0]
  }

  return [...filtered].sort((a, b) => {
    const av = Number(a[metric])
    const bv = Number(b[metric])
    if (!Number.isFinite(av) && !Number.isFinite(bv))
      return 0
    if (!Number.isFinite(av))
      return 1
    if (!Number.isFinite(bv))
      return -1
    return bv - av
  })[0]
}

function getColorClass(color: string, type: 'bg' | 'text' | 'border' | 'gradient') {
  const colorMap: Record<string, Record<string, string>> = {
    purple: {
      bg: 'bg-purple-100 dark:bg-purple-900/30',
      text: 'text-purple-600 dark:text-purple-400',
      border: 'border-purple-200 dark:border-purple-800',
      gradient: 'from-purple-500 to-purple-600',
    },
    blue: {
      bg: 'bg-blue-100 dark:bg-blue-900/30',
      text: 'text-blue-600 dark:text-blue-400',
      border: 'border-blue-200 dark:border-blue-800',
      gradient: 'from-blue-500 to-blue-600',
    },
    amber: {
      bg: 'bg-amber-100 dark:bg-amber-900/30',
      text: 'text-amber-600 dark:text-amber-400',
      border: 'border-amber-200 dark:border-amber-800',
      gradient: 'from-amber-500 to-amber-600',
    },
    green: {
      bg: 'bg-green-100 dark:bg-green-900/30',
      text: 'text-green-600 dark:text-green-400',
      border: 'border-green-200 dark:border-green-800',
      gradient: 'from-green-500 to-green-600',
    },
    rose: {
      bg: 'bg-rose-100 dark:bg-rose-900/30',
      text: 'text-rose-600 dark:text-rose-400',
      border: 'border-rose-200 dark:border-rose-800',
      gradient: 'from-rose-500 to-rose-600',
    },
  }
  return colorMap[color]?.[type] || ''
}

async function loadAnalytics() {
  if (!currentAccountId.value)
    return
  loading.value = true
  try {
    const res = await api.get(`/api/analytics`, {
      params: { sort: sortKey.value },
      headers: { 'x-account-id': currentAccountId.value },
    })
    const data = res.data.data
    if (Array.isArray(data)) {
      list.value = data
    }
    else {
      list.value = []
    }
  }
  catch (e) {
    console.error(e)
    list.value = []
  }
  finally {
    loading.value = false
  }
}

function isLevelKnown(level: any) {
  return !(level === null || level === undefined || level === '' || Number(level) < 0)
}

function formatLv(level: any) {
  if (level === null || level === undefined || level === '' || Number(level) < 0)
    return '未知'
  return String(level)
}

onMounted(() => {
  loadAnalytics()
  loadShopSeedIds()
})

watch([currentAccountId, sortKey], loadAnalytics)

watch([currentAccountId, currentAccountConnected], loadShopSeedIds)
</script>

<template>
  <section class="strategy-panel page-card-surface rounded-2xl">
    <header class="strategy-bar">
      <h3 class="strategy-bar__title">
        策略对比
      </h3>
      <div class="strategy-bar__actions">
        <span class="strategy-bar__level">参考等级:</span>
        <NInputNumber
          v-model:value="strategyLevel"
          class="strategy-bar__level-input"
          :min="1"
          :max="200"
          :show-button="false"
          size="small"
        />
        <span class="strategy-bar__exclude" :title="excludeUnsellableHint">
          <NCheckbox
            v-model:checked="excludeUnsellable"
            size="small"
            :disabled="!shopSeedReady"
          >
            排除不可售种子
          </NCheckbox>
        </span>
      </div>
    </header>

    <ul class="strategy-list">
      <li
        v-for="row in strategyRows"
        :key="row.key"
        class="strategy-row"
        :title="row.hint"
      >
        <div class="strategy-row__name">
          <span class="strategy-row__icon bg-gradient-to-br" :class="getColorClass(row.tone, 'gradient')">
            <span :class="row.icon" />
          </span>
          <span class="strategy-row__name-text">{{ row.name }}</span>
        </div>
        <div class="strategy-row__seed">
          <template v-if="row.plant">
            <span class="strategy-row__thumb">
              <img
                v-if="row.plant.image && !imageErrors[row.plant.seedId]"
                :src="row.plant.image"
                :alt="row.plant.name"
                loading="lazy"
                @error="imageErrors[row.plant.seedId] = true"
              >
              <span v-else class="i-carbon-sprout" />
            </span>
            <span class="strategy-row__seed-name">{{ row.plant.name }}</span>
            <span class="strategy-row__seed-level">
              <template v-if="isLevelKnown(row.plant.level)">lv.<span class="strategy-num">{{ formatLv(row.plant.level) }}</span></template>
              <template v-else>lv.未知</template>
            </span>
          </template>
          <span v-else-if="row.emptyText" class="strategy-row__empty">{{ row.emptyText }}</span>
        </div>
        <div class="strategy-row__value">
          <span v-if="row.value.number" class="strategy-row__value-body" :class="{ 'is-level': row.value.prefix === 'lv.' }">
            <span v-if="row.value.prefix" class="strategy-row__value-prefix">{{ row.value.prefix }}</span>
            <span class="strategy-row__value-num">{{ row.value.number }}</span>
            <span v-if="row.value.suffix" class="strategy-row__value-suffix">{{ row.value.suffix }}</span>
          </span>
          <span v-else>{{ row.value.text }}</span>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
/* 策略面板：照搬「宠物」名册的结构 —— 出血标题栏 + 行间细分隔线，
   行内不再套圆角卡；信息层级靠列宽和字重区分，文字不做逐行着色。
   标题栏与策略行共用一份高度与内边距，保证六行与标题栏齐平。 */
.strategy-panel {
  --strategy-row-height: 56px;
  --strategy-row-pad-y: 14px;
  --strategy-row-pad-x: 18px;
  /* 最长策略名「普肥经验/时」约为 6 字 + 图标，留出余量保证不换行 */
  --strategy-name-col: 130px;

  container-type: inline-size;

  display: flex;
  overflow: hidden;
  flex-direction: column;
  padding: 16px;
}

.strategy-bar {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  min-height: var(--strategy-row-height);
  margin: -16px -16px 0;
  padding: var(--strategy-row-pad-y) var(--strategy-row-pad-x);
  border-bottom: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-card) var(--ui-radius-card) 0 0;
  background: var(--ui-table-head);
}

.strategy-bar__title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  margin: 0;
  color: var(--ui-primary);
  font-size: 14px;
  font-weight: var(--fw-650);
  white-space: nowrap;
}

/* 参考等级靠右，与宠物工具栏按钮组同一套对齐规则 */
.strategy-bar__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.strategy-bar__level {
  color: var(--ui-muted);
  font-size: 13px;
}

/* 参考等级只需放下 4 位数字，省出的宽度留给右侧的排除开关 */
.strategy-bar__level-input {
  width: 68px;
}

.strategy-bar__exclude {
  display: inline-flex;
  align-items: center;
}

.strategy-bar__exclude :deep(.n-checkbox__label) {
  color: var(--ui-muted);
  font-size: 13px;
}

/* 列表向左、右、下出血到面板边缘，由 page-card-surface 的圆角裁切 */
.strategy-list {
  margin: 0 -16px -16px;
  padding: 0;
  list-style: none;
}

/* 三列各自约束，保证各行种子名起点一致且互不重叠：
   每一行是独立 grid，第一列必须固定宽度（不能按内容自适应），
   否则策略名长短不一会让各行的种子名起点错开。
   第二列最小宽度取最长种子名，保证完整显示，余下空间由它吸收；
   第三列按数值定宽。列间 12px 间距把三块内容隔开。 */
.strategy-row {
  display: grid;
  grid-template-columns: var(--strategy-name-col) minmax(max-content, 1fr) max-content;
  gap: 12px;
  align-items: center;
  min-height: var(--strategy-row-height);
  padding: var(--strategy-row-pad-y) var(--strategy-row-pad-x);
  color: var(--ui-ink);
  font-size: 13px;
}

.strategy-row + .strategy-row {
  border-top: 1px solid var(--ui-border);
}

.strategy-row__name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: var(--fw-400);
}

/* 只有图标保留策略配色，文字一律同一字号同一色 */
.strategy-row__icon {
  display: grid;
  flex: none;
  width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
}

/* 第一列宽度固定，策略名超宽时裁切，避免溢出到种子列造成重叠 */
.strategy-row__name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 种子名与 lv. 前缀保持常规体，只有等级数字单独叠加绿色粗体 */
.strategy-row__seed {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: var(--fw-400);
}

.strategy-row__thumb {
  display: grid;
  flex: none;
  width: 26px;
  height: 26px;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface-soft);
}

.strategy-row__thumb img {
  width: 84%;
  height: 84%;
  object-fit: contain;
}

.strategy-row__thumb .i-carbon-sprout {
  width: 15px;
  height: 15px;
  color: var(--ui-muted);
}

/* 种子名完整显示，不截断、不省略 */
.strategy-row__seed-name {
  white-space: nowrap;
}

/* 数字与作物图鉴表格同口径：14px、常规字重令牌（深色自动减），绿色 + 等宽数字 */
.strategy-num,
.strategy-row__value-num {
  color: var(--ui-primary);
  font-size: 14px;
  font-weight: var(--fw-500);
  font-variant-numeric: tabular-nums;
}

.strategy-row__seed-level,
.strategy-row__empty {
  flex: none;
}

.strategy-row__value {
  justify-self: end;
  text-align: right;
  font-weight: var(--fw-400);
  white-space: nowrap;
}

/* 前缀、数字、单位之间用一个英文空格宽度间隔。
   等级列写的是 lv.100，前缀自带句点，中间不能再留空格。 */
.strategy-row__value-body {
  display: inline-flex;
  align-items: baseline;
  column-gap: 0.25em;
}

.strategy-row__value-body.is-level {
  column-gap: 0;
}

@container (max-width: 520px) {
  .strategy-panel {
    --strategy-row-pad-x: 14px;
    --strategy-name-col: 112px;
  }

  .strategy-row {
    gap: 8px;
  }
}
</style>
