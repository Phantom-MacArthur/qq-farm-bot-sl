<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import CatalogPanel from '@/components/catalog/CatalogPanel.vue'
import { useCatalogPaging, useImageErrors } from '@/components/catalog/catalogShared'
import CatalogSortButton from '@/components/catalog/CatalogSortButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { useReconnectRefresh } from '@/composables/useReconnectRefresh'
import { useSortToggle } from '@/composables/useSortToggle'
import { vLazySrc } from '@/directives/lazy-src'
import { useToastStore } from '@/stores/toast'

/* 种子详情：效率指标表 + 悬停公式弹窗 + 限定种子识别。
   指标数值全部来自后端 metrics（analytics 单一计算源），这里只做展示与提示文本拼接。 */

const toast = useToastStore()

const loading = ref(false)
const list = ref<any[]>([])
const searchKeyword = ref('')
const scopeFilter = ref('')
const { imageErrors, mark } = useImageErrors()
const { currentPage, pageCount, slice } = useCatalogPaging()

// 默认按等级排序：等级是判断“当前账号能不能种”的首要信息
const SORT_OPTIONS = [
  { value: 'requiredLevel', label: '等级' },
  { value: 'name', label: '名称' },
  { value: 'exp', label: '经验' },
  { value: 'expPerHour', label: '经验/时' },
  { value: 'fertExpPerHour', label: '普通肥经验/时' },
  { value: 'profitPerHour', label: '利润/时' },
  { value: 'fertProfitPerHour', label: '普通肥利润/时' },
]
const { sort, dir, direction, select } = useSortToggle('requiredLevel')
const sortLabel = computed(() => SORT_OPTIONS.find(o => o.value === sort.value)?.label || '排序')

// ============ 指标与公式 ============
interface SeedMetrics {
  seasons: number
  exp: number
  baseGrowTime: number
  firstPhase: number
  fruitCount: number
  fruitPrice: number
  seedPrice: number
  expPerHour: number
  normalFertilizerExpPerHour: number
  incomePerSeason: number
  profitPerHour: number
  normalFertilizerProfitPerHour: number
}

type MetricKind = 'expPerHour' | 'fertExpPerHour' | 'profit' | 'fertProfit'
// 表头展示纯公式（单季/双季各占一行），数据格展示代入数值的同结构公式
const METRIC_FORMULAS: Record<MetricKind, [string, string]> = {
  expPerHour: ['单季：经验÷成熟时间', '双季：经验×2÷(成熟时间×1.5)'],
  fertExpPerHour: ['单季：经验÷(成熟时间-首阶段时间)', '双季：经验×2÷(成熟时间×1.5-2×首阶段时间)'],
  profit: ['单季：(果实售价×季产-种子售价)÷成熟时间', '双季：(果实售价×季产×2-种子售价)÷(成熟时间×1.5)'],
  fertProfit: ['单季：(果实售价×季产-种子售价)÷(成熟时间-首阶段时间)', '双季：(果实售价×季产×2-种子售价)÷(成熟时间×1.5-2×首阶段时间)'],
}

function metricsOf(item: any): SeedMetrics | null {
  return item?.metrics || null
}

function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v)))
    return '-'
  return Math.round(Number(v)).toLocaleString('zh-CN')
}

// 代入公式的数值：整数原样输出，有小数时保留 1 位小数
function numText(v: number): string {
  const n = Number(v)
  if (!Number.isFinite(n))
    return '0'
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

// 时长换算为小时（保留 1 位小数），与“经验/时、利润/时”的口径一致
function hoursText(seconds: number): string {
  return (Number(seconds) / 3600).toFixed(1)
}

// 时长文案：不足 1 分钟用秒，不足 1 小时用分；小时取 1 位小数，整数小时不带小数点
function durationText(seconds: number): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  if (total < 60)
    return `${total} 秒`
  const minutes = Math.round(total / 60)
  if (minutes < 60)
    return `${minutes} 分`
  const hours = total / 3600
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} 小时`
}

// 限定种子：确认不在普通种子商店目录（活动/解锁卡/神秘商人等），永远拿不到购买价
function isLimited(item: any): boolean {
  return !!item?.limited
}

// 列展示值：利润两列依赖成本校准，未校准留空；确认为限定渠道的填“限定”，区分于“还没校准”
function metricDisplay(item: any, kind: MetricKind): string {
  const m = metricsOf(item)
  if (!m)
    return '-'
  if (kind === 'expPerHour')
    return fmtInt(m.expPerHour)
  if (kind === 'fertExpPerHour')
    return fmtInt(m.normalFertilizerExpPerHour)
  if (!item.calibrated)
    return isLimited(item) ? '限定' : '-'
  if (kind === 'profit')
    return fmtInt(m.profitPerHour)
  if (kind === 'fertProfit')
    return fmtInt(m.normalFertilizerProfitPerHour)
  return '-'
}

// 数据格悬停：只显示该作物所属季数的公式（代入数值，结果直接取表格里的数值）
function metricFormulaText(item: any, kind: MetricKind): string {
  const m = metricsOf(item)
  if ((kind === 'profit' || kind === 'fertProfit') && isLimited(item))
    return '限定渠道：无公开购买价，无法计算利润'
  const two = Number(item.seasons ?? m?.seasons) === 2
  if (!m)
    return `${two ? '双季' : '单季'}：${two ? METRIC_FORMULAS[kind][1] : METRIC_FORMULAS[kind][0]}`
  const mature = hoursText(m.baseGrowTime)
  const first = hoursText(m.firstPhase)
  const exp = numText(m.exp)
  const fruitSale = numText(m.fruitPrice)
  const harvest = numText(m.fruitCount)
  const seedSale = numText(m.seedPrice)
  const tag = two ? '双季' : '单季'
  let expr = ''
  if (kind === 'expPerHour')
    expr = two ? `${exp}×2÷(${mature}×1.5)h` : `${exp}÷${mature}h`
  else if (kind === 'fertExpPerHour')
    expr = two ? `${exp}×2÷(${mature}×1.5-2×${first})h` : `${exp}÷(${mature}-${first})h`
  else if (kind === 'profit')
    expr = two ? `(${fruitSale}×${harvest}×2-${seedSale})÷(${mature}×1.5)h` : `(${fruitSale}×${harvest}-${seedSale})÷${mature}h`
  else
    expr = two ? `(${fruitSale}×${harvest}×2-${seedSale})÷(${mature}×1.5-2×${first})h` : `(${fruitSale}×${harvest}-${seedSale})÷(${mature}-${first})h`
  const result = metricDisplay(item, kind)
  return result === '-' || result === '限定' ? `${tag}：${expr}` : `${tag}：${expr} = ${result}`
}

// ============ 悬停详情行 ============
const GOLD_ICON = '/game-config/resource-icons/gold.png'
interface SeedInfoLine {
  label: string
  value: string
  icon?: string
  wrap?: boolean
}

// 按“成熟时间→季数→季产→果实售价→种子售价→收入/季”排列；
// 限定渠道没有公开购买价，直接不展示种子售价行
function seedInfoLines(item: any): SeedInfoLine[] {
  const m = metricsOf(item)
  const lines: SeedInfoLine[] = [
    { label: '成熟时间', value: m ? durationText(m.baseGrowTime) : '-' },
    { label: '季数', value: Number(item.seasons ?? m?.seasons) === 2 ? '双季' : '单季' },
    { label: '季产', value: m ? numText(m.fruitCount) : '-' },
    { label: '果实售价', value: m ? numText(m.fruitPrice) : '-', icon: GOLD_ICON },
  ]
  if (!isLimited(item))
    lines.push({ label: '种子售价', value: m ? numText(m.seedPrice) : '-', icon: GOLD_ICON })
  lines.push({ label: '收入/季', value: m ? fmtInt(m.incomePerSeason) : '-', icon: GOLD_ICON })
  const mutations: string[] = []
  for (const effect of Array.isArray(item.mutationEffects) ? item.mutationEffects : []) {
    const name = String(effect?.name ?? '').trim()
    if (name)
      mutations.push(Number.isFinite(effect.probabilityPercent) ? `${name} ${effect.probabilityPercent}%` : name)
  }
  if (mutations.length)
    lines.push({ label: '可变异', value: mutations.join('、'), wrap: true })
  return lines
}

// 排序取值：利润类指标依赖真实成本，未校准与限定种子没有可信值，返回 null 始终排在最后
function sortValue(item: any, key: string): number | string | null {
  const m = metricsOf(item)
  switch (key) {
    case 'name':
      return String(item.name || '')
    case 'requiredLevel':
      return Number(item.requiredLevel) || 0
    case 'exp':
      return Number(m?.exp ?? item.exp) || 0
    case 'expPerHour':
      return Number(m?.expPerHour) || 0
    case 'fertExpPerHour':
      return Number(m?.normalFertilizerExpPerHour) || 0
    case 'profitPerHour':
      return item.calibrated ? (Number(m?.profitPerHour) || 0) : null
    case 'fertProfitPerHour':
      return item.calibrated ? (Number(m?.normalFertilizerProfitPerHour) || 0) : null
    default:
      return 0
  }
}

// 作物范围选项直接带数量，省掉工具栏右侧单独的「xx 条」文本
const scopeOptions = computed(() => {
  const normal = list.value.filter((s: any) => !isLimited(s)).length
  const limited = list.value.filter((s: any) => isLimited(s)).length
  return [
    { value: '', label: `全部作物 (${list.value.length})` },
    { value: 'normal', label: `仅普通作物 (${normal})` },
    { value: 'limited', label: `仅限定作物 (${limited})` },
  ]
})

const filtered = computed(() => {
  let result = list.value
  if (searchKeyword.value) {
    const kw = searchKeyword.value.toLowerCase()
    result = result.filter((s: any) => s.name?.toLowerCase().includes(kw))
  }
  if (scopeFilter.value === 'normal')
    result = result.filter((s: any) => !isLimited(s))
  else if (scopeFilter.value === 'limited')
    result = result.filter((s: any) => isLimited(s))
  const key = sort.value
  const d = direction.value
  return [...result].sort((a: any, b: any) => {
    const va = sortValue(a, key)
    const vb = sortValue(b, key)
    // 无可信值的行始终排在最后，不因翻转方向而跳到最前
    if (va === null && vb === null)
      return 0
    if (va === null)
      return 1
    if (vb === null)
      return -1
    if (typeof va === 'number' && typeof vb === 'number')
      return (va - vb) * d
    return String(va).localeCompare(String(vb)) * d
  })
})

const paginated = computed(() => slice(filtered.value))
const totalPages = computed(() => pageCount(filtered.value.length))

// 列宽：先给每列能完整容纳标题的最小宽度，剩余宽度按标题长度比例摊分铺满一行
const SEED_COLUMNS = [
  { label: '种子', min: 124 },
  { label: '等级', min: 52 },
  { label: '经验', min: 52 },
  { label: '经验/时', min: 64 },
  { label: '普通肥经验/时', min: 100 },
  { label: '利润/时', min: 64 },
  { label: '普通肥利润/时', min: 108 },
]
const seedColumnWidths = computed(() => {
  const totalMin = SEED_COLUMNS.reduce((sum, col) => sum + col.min, 0)
  const totalWeight = SEED_COLUMNS.reduce((sum, col) => sum + col.label.length, 0)
  return SEED_COLUMNS.map((col) => {
    const ratio = (col.label.length / totalWeight).toFixed(4)
    return `max(${col.min}px, calc(${col.min}px + (100% - ${totalMin}px) * ${ratio}))`
  })
})

// ============ 悬停浮窗 ============

type TipContent = string | string[] | SeedInfoLine[]
const tipVisible = ref(false)
const tipLeft = ref(0)
const tipTop = ref(0)
const tipElement = ref<HTMLElement | null>(null)
const tipLines = ref<SeedInfoLine[]>([])

function showTip(e: MouseEvent, content: TipContent) {
  const lines: SeedInfoLine[] = (Array.isArray(content) ? content : [{ label: '', value: content }])
    .map((line: any) => (typeof line === 'string' ? { label: '', value: line } : line))
    .filter(line => !!line.value)
  if (lines.length === 0)
    return
  tipLines.value = lines
  moveTip(e)
  tipVisible.value = true
  void nextTick(() => {
    if (tipVisible.value)
      moveTip(e)
  })
}
function moveTip(e: MouseEvent) {
  const width = tipElement.value?.offsetWidth ?? 0
  const height = tipElement.value?.offsetHeight ?? 0
  const right = e.clientX + 14
  const left = right + width <= window.innerWidth - 8 ? right : e.clientX - width - 14
  tipLeft.value = Math.max(8, Math.min(left, window.innerWidth - width - 8))
  tipTop.value = Math.max(8, Math.min(e.clientY + 18, window.innerHeight - height - 8))
}
function hideTip() {
  tipVisible.value = false
}

// ============ 数据加载与校准 ============
async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/api/config/seeds')
    if (data?.ok)
      list.value = data.data || []
  }
  catch { /* ignore */ }
  finally { loading.value = false }
}

// 手动校准：先拉取在线账号商店目录（校准购买价），再刷新列表
const manualRefreshing = ref(false)
async function handleCalibrate() {
  if (manualRefreshing.value)
    return
  manualRefreshing.value = true
  try {
    const { data } = await api.post('/api/config/seeds/calibrate')
    if (data?.ok) {
      const d = data.data || {}
      toast.success(`校准完成：已由账号「${d.accountName || d.accountId || '在线账号'}」同步 ${d.count ?? 0} 个种子购买价`)
    }
    else {
      toast.error(getApiErrorMessage(data, '校准失败'))
    }
  }
  catch (e: any) {
    toast.error(getApiErrorMessage(e, '校准请求失败'))
  }
  finally {
    await load()
    manualRefreshing.value = false
  }
}

watch([searchKeyword, scopeFilter, sort, dir], () => {
  currentPage.value = 1
})
watch(totalPages, (pages) => {
  currentPage.value = Math.min(currentPage.value, pages)
})

onMounted(load)
// 重新上线时按一次刷新键（同步服务器数据）
useReconnectRefresh(handleCalibrate)
</script>

<template>
  <CatalogPanel v-model:page="currentPage" :loading="loading" :page-count="totalPages">
    <template #toolbar>
      <BaseInput v-model="searchKeyword" type="search" clearable placeholder="输入名称搜索" />
      <div class="catalog-tools">
        <BaseSelect v-model="scopeFilter" :options="scopeOptions" fit-width />
        <div class="ml-auto" />
        <div class="catalog-tools__actions">
          <CatalogSortButton
            :options="SORT_OPTIONS"
            :current="sort"
            :dir="dir"
            :label="sortLabel"
            @select="select"
          />
          <RefreshButton
            label="同步服务器数据"
            title="用在线账号拉取种子商店目录校准购买价，并刷新列表"
            :loading="manualRefreshing"
            :disabled="manualRefreshing"
            @click="handleCalibrate"
          />
        </div>
      </div>
    </template>

    <div v-if="filtered.length === 0" class="catalog-empty">
      {{ searchKeyword ? '没有匹配的种子' : '暂无种子数据' }}
    </div>
    <div v-else class="catalog-table-scroll overflow-x-auto">
      <table class="catalog-table seed-table w-full table-fixed whitespace-nowrap text-center text-sm">
        <colgroup>
          <col v-for="(width, i) in seedColumnWidths" :key="i" :style="{ width }">
        </colgroup>
        <thead class="border-b bg-gray-50 text-xs text-gray-500 uppercase dark:border-gray-700 dark:bg-gray-700/50 dark:text-gray-400">
          <tr>
            <th class="sticky left-0 z-2 px-3 py-3 font-medium">
              种子
            </th>
            <th class="px-3 py-3 font-medium">
              等级
            </th>
            <th
              class="px-3 py-3 font-medium"
              @mouseenter="showTip($event, '单季：经验÷成熟时间，双季：经验×2÷(成熟时间×1.5)')"
              @mousemove="moveTip"
              @mouseleave="hideTip"
            >
              经验
            </th>
            <th
              class="px-3 py-3 font-medium"
              @mouseenter="showTip($event, METRIC_FORMULAS.expPerHour)"
              @mousemove="moveTip"
              @mouseleave="hideTip"
            >
              经验/时
            </th>
            <th
              class="px-3 py-3 font-medium"
              @mouseenter="showTip($event, METRIC_FORMULAS.fertExpPerHour)"
              @mousemove="moveTip"
              @mouseleave="hideTip"
            >
              普通肥经验/时
            </th>
            <th
              class="px-3 py-3 font-medium"
              @mouseenter="showTip($event, METRIC_FORMULAS.profit)"
              @mousemove="moveTip"
              @mouseleave="hideTip"
            >
              利润/时
            </th>
            <th
              class="px-3 py-3 font-medium"
              @mouseenter="showTip($event, METRIC_FORMULAS.fertProfit)"
              @mousemove="moveTip"
              @mouseleave="hideTip"
            >
              普通肥利润/时
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
          <tr v-for="item in paginated" :key="item.seedId">
            <td
              class="sticky left-0 z-1 px-3 py-3 text-left"
              @mouseenter="showTip($event, seedInfoLines(item))"
              @mousemove="moveTip"
              @mouseleave="hideTip"
            >
              <div class="flex items-center gap-2">
                <div class="h-8 w-8 flex shrink-0 items-center justify-center">
                  <img
                    v-if="item.image && !imageErrors[item.seedId]"
                    v-lazy-src="item.image"
                    class="h-8 w-8 object-contain"
                    loading="lazy"
                    decoding="async"
                    @error="mark(item.seedId)"
                  >
                  <div v-else class="i-carbon-sprout text-xl text-gray-400" />
                </div>
                <span class="text-gray-900 font-bold dark:text-gray-100">{{ item.name }}</span>
              </div>
            </td>
            <td class="px-3 py-2 text-gray-500 dark:text-gray-400">
              Lv.{{ item.requiredLevel }}
            </td>
            <td class="px-3 py-2 text-emerald-600 font-medium dark:text-emerald-400">
              {{ item.exp || '-' }}
            </td>
            <td
              class="px-3 py-2 text-emerald-600 font-medium dark:text-emerald-400"
              @mouseenter="showTip($event, metricFormulaText(item, 'expPerHour'))"
              @mousemove="moveTip"
              @mouseleave="hideTip"
            >
              {{ metricDisplay(item, 'expPerHour') }}
            </td>
            <td
              class="px-3 py-2 text-emerald-600 font-medium dark:text-emerald-400"
              @mouseenter="showTip($event, metricFormulaText(item, 'fertExpPerHour'))"
              @mousemove="moveTip"
              @mouseleave="hideTip"
            >
              {{ metricDisplay(item, 'fertExpPerHour') }}
            </td>
            <td
              class="px-3 py-2 text-emerald-600 font-medium dark:text-emerald-400"
              @mouseenter="showTip($event, metricFormulaText(item, 'profit'))"
              @mousemove="moveTip"
              @mouseleave="hideTip"
            >
              <span :class="isLimited(item) && !item.calibrated ? 'text-gray-400 dark:text-gray-500' : ''">{{ metricDisplay(item, 'profit') }}</span>
            </td>
            <td
              class="px-3 py-2 text-emerald-600 font-medium dark:text-emerald-400"
              @mouseenter="showTip($event, metricFormulaText(item, 'fertProfit'))"
              @mousemove="moveTip"
              @mouseleave="hideTip"
            >
              <span :class="isLimited(item) && !item.calibrated ? 'text-gray-400 dark:text-gray-500' : ''">{{ metricDisplay(item, 'fertProfit') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 跟随鼠标的浮窗：公式行为纯文本，种子详情行带货币图标 -->
    <div
      v-if="tipVisible"
      ref="tipElement"
      class="metric-tip"
      :style="{ left: `${tipLeft}px`, top: `${tipTop}px` }"
    >
      <div v-for="(line, i) in tipLines" :key="i" class="metric-tip__line" :class="{ 'metric-tip__line--wrap': line.wrap }">
        <span v-if="line.label">{{ line.label }}：</span>
        <img v-if="line.icon" :src="line.icon" class="metric-tip__icon" alt="">
        <span>{{ line.value }}</span>
      </div>
    </div>
  </CatalogPanel>
</template>

<style scoped>
.catalog-empty {
  padding: 64px 16px;
  text-align: center;
  color: var(--ui-subtle);
}

/* 浮窗固定在视口坐标，不能放在有 overflow 裁切的容器里 */
.metric-tip {
  position: fixed;
  z-index: 60;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(17, 24, 39, 0.92);
  color: #fff;
  font-size: var(--ui-content-item-font-height-tiny-12);
  line-height: 1.5;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
}

.metric-tip__line {
  display: flex;
  align-items: center;
  white-space: nowrap;
}

.metric-tip__line--wrap {
  align-items: baseline;
  max-width: min(26rem, calc(100vw - 36px));
  white-space: normal;
}

.metric-tip__line--wrap > :first-child {
  flex: none;
}

.metric-tip__icon {
  width: 13px;
  height: 13px;
  margin: 0 4px 0 2px;
  object-fit: contain;
  vertical-align: middle;
}
</style>
