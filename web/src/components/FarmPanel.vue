<script setup lang="ts">
import type { FertilizerType } from '@/stores/farm'
import type { FriendInteractionItemDto, FriendInteractionResultDto } from '@/stores/friend'
import { useIntervalFn, useResizeObserver } from '@vueuse/core'
import { NButton } from 'naive-ui/es/button'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import ConfirmModal from '@/components/ConfirmModal.vue'
import LandCard from '@/components/FarmLandCard.vue'
import LandDetailModal from '@/components/LandDetailModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import OfflineState from '@/components/ui/OfflineState.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { useAccountPresence } from '@/composables/useReconnectRefresh'
import { useAccountStore } from '@/stores/account'
import { useBagStore } from '@/stores/bag'
import { formatNumber } from '@/utils/format-number'
import { useFarmStore } from '@/stores/farm'
import { useSettingStore } from '@/stores/setting'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import { interactionItemTargetReason } from '@/utils/interaction-item-rules'

const bagStore = useBagStore()
const farmStore = useFarmStore()
const landActionSummary = computed(() => [
  { label: '可收获', kind: 'harvest', icon: 'i-carbon-wheat', count: lands.value.filter(isHarvestCandidate).length },
  { label: '可施普肥', kind: 'normal', icon: 'i-carbon-chemistry', count: lands.value.filter(isNormalFertilizeCandidate).length },
  { label: '可施机肥', kind: 'organic', icon: 'i-carbon-sprout', count: lands.value.filter(isFertilizeCandidate).length },
  { label: '可务农', kind: 'farming', icon: 'i-carbon-clean', count: lands.value.filter(isLandFarmingCandidate).length },
])
const fertilizerStocks = computed(() => [1011, 1012].map(id => {
  const item = bagStore.dashboardItems.find((row: any) => Number(row.id) === id)
  const seconds = item ? Number(item.count) : null
  return { id, label: id === 1011 ? '普肥' : '机肥', hours: seconds === null ? null : seconds / 3600,
    title: seconds === null ? '库存尚未获取' : `${formatNumber(seconds)} 秒（${formatNumber(seconds / 3600)} 小时）` }
}))
const accountStore = useAccountStore()
const settingStore = useSettingStore()
const toast = useToastStore()
let farmPanelMounted = true
function isCurrentFarmPage(accountId: string, sessionVersion: number) {
  return farmPanelMounted && String(currentAccountId.value || '') === String(accountId)
    && farmStore.farmAccountSessionVersion === sessionVersion
}
const route = useRoute()
const {
  lands,
  socialEvents,
  loading,
  loaded,
  error,
  interactionItems,
  interactionItemsLoading,
  interactionItemsError,
  interactionUsePending,
  interactionUseError,
  fertilizePending,
  fertilizeError,
} = storeToRefs(farmStore)
const { currentAccountId } = storeToRefs(accountStore)
watch(() => farmStore.farmRefreshError, message => {
  if (message && farmStore.loaded)
    toast.error(message)
})

const { settings } = storeToRefs(settingStore)
const { status } = storeToRefs(useStatusStore())
const detailLandId = ref<number | null>(null)
const detailLand = computed(() => lands.value.find(land => land.id === detailLandId.value) || null)
const detailUpgradePending = ref(false)
watch(currentAccountId, () => {
  detailLandId.value = null
  detailUpgradePending.value = false
})

const presence = useAccountPresence()
const isOffline = computed(() => presence.value === 'offline')
const currentAccountConnected = computed(() => presence.value === 'online')

const operating = ref(false)
const fertilizerConfirmVisible = ref(false)
const bulkFertilizerType = ref<FertilizerType>('normal')
const bulkFertilizerOptions = [{ label: '普通化肥', value: 'normal' }, { label: '有机化肥', value: 'organic' }]
const bulkFertilizerCount = computed(() => lands.value.filter(land => (
  bulkFertilizerType.value === 'normal'
    ? isNormalFertilizeCandidate(land)
    : isFertilizeCandidate(land)
)).length)
let fertilizerUiSequence = 0
watch(currentAccountId, () => {
  fertilizerUiSequence++
  fertilizerConfirmVisible.value = false
})
const farmingLandId = ref<number | null>(null)
const manualRefreshing = ref(false)

const selectedInteractionItemId = ref<string>()
const lastInteractionResults = ref<Record<string, FriendInteractionResultDto[]>>({})
const interactionConfirmVisible = ref(false)
const interactionConfirmMessage = ref('')

// ---- 选择土地：按操作类型筛选并批量处理目标地块 ----
const showManualFertilizerButtons = computed(() => settings.value.automation?.show_manual_fertilizer !== false)
const selecting = ref(!!route.query.interactionItem)
const selectedIds = ref<string[]>([])
const batchPending = ref(false)
const removeConfirmVisible = ref(false)
const pendingRemoveLandIds = ref<number[]>([])
type BatchAction = FertilizerType | 'harvest' | 'farming' | 'upgrade' | 'remove' | 'item'
const batchAction = ref<BatchAction>(route.query.interactionItem ? 'item' : (showManualFertilizerButtons.value ? 'normal' : 'harvest'))

const selectedInteractionItem = computed<FriendInteractionItemDto | null>(() => (
  interactionItems.value.find(item => String(item.itemId) === selectedInteractionItemId.value) || null
))

const interactionItemPlaceholder = computed(() => {
  if (interactionItemsLoading.value)
    return '正在读取道具…'
  if (interactionItemsError.value)
    return '道具读取失败'
  return interactionItems.value.length ? '选择道具' : '背包暂无可用道具'
})

const selectionBusy = computed(() => batchPending.value || farmStore.farmOperationPending || fertilizePending.value || interactionUsePending.value || operating.value)
const selectionLimit = computed(() => batchAction.value === 'item' ? Math.max(0, Math.floor(Number(selectedInteractionItem.value?.count) || 0)) : Infinity)
const selectionOptions = computed<Array<{ value: BatchAction, label: string, icon: string }>>(() => [
  ...(showManualFertilizerButtons.value
    ? [
        { value: 'normal' as const, label: '普肥', icon: 'i-carbon-chemistry' },
        { value: 'organic' as const, label: '机肥', icon: 'i-carbon-sprout' },
      ]
    : []),
  { value: 'harvest', label: '收获', icon: 'i-carbon-wheat' },
  { value: 'farming', label: '务农', icon: 'i-carbon-clean' },
  { value: 'upgrade', label: '升级', icon: 'i-carbon-upgrade' },
  { value: 'remove', label: '铲除', icon: 'i-carbon-trash-can' },
  { value: 'item', label: '道具', icon: 'i-carbon-game-console' },
])

const cleanableFarmSocialEvents = computed(() => (
  (Array.isArray(socialEvents.value) ? socialEvents.value : []).filter((event: any) => event?.cleanable)
))
const cleanableFarmSocialEventNames = computed(() => cleanableFarmSocialEvents.value
  .map((event: any) => String(event?.itemName || event?.itemId || '').trim())
  .filter(Boolean)
  .join('、'))

function isValidFarmingLand(land: any) {
  return !!land?.unlocked
    && !land?.occupiedByMaster
    && !!String(land?.plantName || '').trim()
    && !['locked', 'empty'].includes(String(land?.status || ''))
}

function isHarvestCandidate(land: any) {
  return !!land?.unlocked
    && !land?.occupiedByMaster
    && String(land?.status || '') === 'harvestable'
}

function isUpgradeCandidate(land: any) {
  return !!land?.unlocked
    && !land?.occupiedByMaster
    && !!land?.couldUpgrade
}

function isRemoveCandidate(land: any) {
  const status = String(land?.status || '')
  return !!land?.unlocked
    && !land?.occupiedByMaster
    && !['locked', 'empty'].includes(status)
    && Boolean(
      String(land?.plantName || '').trim()
      || land?.seedImage
      || Number(land?.matureInSec) > 0
      || ['dead', 'growing', 'harvestable', 'stealable'].includes(status),
    )
}

const socialCleanupLandId = computed(() => {
  if (cleanableFarmSocialEvents.value.length === 0)
    return 0
  return Number(lands.value.find(isValidFarmingLand)?.id) || 0
})

function isLandFarmingCandidate(land: any) {
  if (!isValidFarmingLand(land))
    return false
  return !!land?.needWater
    || !!land?.needWeed
    || !!land?.needBug
    || !!land?.needInteractionCleanup
    || Number(land?.id) === socialCleanupLandId.value
}

/**
 * 批量务农动作（收获/务农/种植/升级/一键打理）直接执行，结果走右上角 toast；
 * 只有铲除这类不可恢复的操作保留二次确认弹窗。
 * 注意：土地卡片上的“务农”同样按全场处理，不限定在当前地块。
 */
const GLOBAL_OP_LABELS: Record<string, string> = {
  harvest: '收获',
  clear: '务农',
  upgrade: '升级',
  all: '一键打理',
}

function describeOperateResult(result: any, label: string) {
  if (typeof result?.message === 'string' && result.message)
    return result.message
  const actions = Array.isArray(result?.actions) ? result.actions.filter(Boolean) : []
  if (!actions.length)
    return ''
  if (label === '务农' && actions.length === 1 && actions[0].startsWith('一键务农: '))
    return actions[0]
  return `${label}完成：${actions.join('，')}`
}

// 一键打理会把后端本轮跑完的 5 个动作（对应工具条上的 5 个按钮）全部汇总，
// 数量是实际处理过的地块数，未干活的也要显式归零，否则只剩一条施肥提示会误判。
const ALL_OP_SUMMARY_FIELDS = [
  { key: 'harvest', label: '收获' },
  { key: 'farming', label: '务农' },
  { key: 'plant', label: '种植' },
  { key: 'upgrade', label: '升级' },
  { key: 'fertilize', label: '施肥' },
] as const

function describeAllOperateSummary(counts: any): string {
  if (!counts || typeof counts !== 'object')
    return ''
  return ALL_OP_SUMMARY_FIELDS
    .map(field => `${field.label}: ${Number(counts[field.key]) || 0}`)
    .join('，')
}

async function runGlobalOperate(opType: string) {
  const accountId = currentAccountId.value
  const accountSessionVersion = farmStore.farmAccountSessionVersion
  const label = GLOBAL_OP_LABELS[opType] || '打理'
  if (!accountId || farmStore.farmOperationPending || operating.value || fertilizePending.value || farmingLandId.value !== null)
    return
  operating.value = true
  try {
    const result = await farmStore.operate(accountId, opType)
    // 中途切号不再回报，避免把上一个账号的结果贴到当前账号上
    if (!isCurrentFarmPage(accountId, accountSessionVersion))
      return
    const summary = opType === 'all' ? describeAllOperateSummary(result?.counts) : ''
    if (summary) {
      if (result?.hadWork)
        toast.success(`${label}：${summary}`)
      else
        toast.info(`${label}：${summary}（本轮无需处理）`)
      return
    }
    const detail = describeOperateResult(result, label)
    if (result?.hadWork && detail)
      toast.success(detail)
    else
      toast.info(`${label}：当前没有需要处理的内容`)
  }
  catch (error) {
    if (isCurrentFarmPage(accountId, accountSessionVersion))
      toast.error(error instanceof Error ? error.message : `${label}失败`)
  }
  finally {
    if (isCurrentFarmPage(accountId, accountSessionVersion)) operating.value = false
  }
}

function handleOperate(opType: string) {
  void runGlobalOperate(opType)
}

async function upgradeDetailLand() {
  const accountId = String(currentAccountId.value || '')
  const accountSessionVersion = farmStore.farmAccountSessionVersion
  const land = detailLand.value
  if (!accountId || !land?.couldUpgrade || detailUpgradePending.value)
    return

  detailUpgradePending.value = true
  try {
    const result = await farmStore.operate(accountId, 'upgrade', Number(land.id))
    if (!isCurrentFarmPage(accountId, accountSessionVersion))
      return
    if (result?.hadWork)
      toast.success(`土地#${land.id} 升级完成`)
    else
      toast.info(`土地#${land.id} 当前暂不可升级`)
  }
  catch (error) {
    if (isCurrentFarmPage(accountId, accountSessionVersion))
      toast.error(error instanceof Error ? error.message : '土地升级失败')
  }
  finally {
    detailUpgradePending.value = false
  }
}

// 只有“一键打理”是主操作，其余保持同一层级，避免一排按钮各用一种颜色。
const operations = [
  { type: 'harvest', label: '收获', icon: 'i-carbon-wheat', buttonType: 'default' },
  { type: 'clear', label: '务农', icon: 'i-carbon-clean', buttonType: 'default' },
  { type: 'upgrade', label: '升级', icon: 'i-carbon-upgrade', buttonType: 'default' },
  { type: 'all', label: '一键打理', icon: 'i-carbon-flash', buttonType: 'primary' },
] as const

function interactionSelectionKey(itemId: unknown = selectedInteractionItemId.value) {
  return String(itemId || '')
}

function usedInteractionIdSet(itemId: unknown = selectedInteractionItemId.value) {
  if (!currentAccountId.value || !itemId)
    return new Set<string>()
  return new Set(farmStore.getInteractionUsedLandIds(currentAccountId.value, itemId))
}

function hasConfirmedInteractionEffect(land: any, itemId: unknown = selectedInteractionItemId.value) {
  const normalizedItemId = String(itemId || '')
  return !!normalizedItemId && (Array.isArray(land?.interactionEffects) ? land.interactionEffects : [])
    .some((effect: any) => effect?.confirmed && String(effect?.itemId || '') === normalizedItemId)
}

/** 合种副地代表其主地：勾选、显示都落在主地上。 */
function rootIdOf(land: any) {
  const master = Number(land?.masterLandId) || 0
  return String(land?.occupiedByMaster && master > 0 ? master : land?.id || '')
}

function landByRootId(id: string) {
  return (lands.value || []).find(land => String(land.id) === id)
}

function canSelectLand(land: any) {
  const root = land?.occupiedByMaster ? landByRootId(rootIdOf(land)) : land
  if (!root || !root.unlocked || root.occupiedByMaster)
    return false
  if (batchAction.value === 'harvest')
    return isHarvestCandidate(root)
  if (batchAction.value === 'upgrade')
    return isUpgradeCandidate(root)
  if (batchAction.value === 'remove')
    return isRemoveCandidate(root)
  if (!isValidFarmingLand(root))
    return false
  if (batchAction.value === 'normal')
    return isNormalFertilizeCandidate(root)
  if (batchAction.value === 'organic')
    return isFertilizeCandidate(root)
  if (batchAction.value === 'farming')
    return isLandFarmingCandidate(root)
  const item = selectedInteractionItem.value
  return !!item && item.count > 0 && !interactionItemTargetReason(item.itemId, root)
    && !hasConfirmedInteractionEffect(root, item.itemId) && !usedInteractionIdSet(item.itemId).has(String(root.id))
}

function selectReason(land: any) {
  if (canSelectLand(land))
    return ''
  if (!land?.unlocked)
    return '未解锁'
  const root = landByRootId(rootIdOf(land))
  if (!root)
    return '合种主地状态待同步'
  if (batchAction.value === 'harvest')
    return '当前作物不可收获'
  if (batchAction.value === 'upgrade')
    return '当前土地不可升级'
  if (batchAction.value === 'remove')
    return '当前土地没有可铲除的作物'
  if (!String(land?.plantName || '').trim())
    return '空地无需操作'
  if (batchAction.value === 'normal')
    return isFertilizeCandidate(root) ? '普通肥本季可用次数已用完' : '当前作物无需施肥'
  if (batchAction.value === 'organic')
    return '当前作物无需施肥'
  if (batchAction.value === 'farming')
    return '当前无需务农'
  return selectedInteractionItem.value ? '当前作物不可使用此道具，或已经使用过' : '请先选择道具'
}

function isLandSelected(land: any) {
  return selectedIds.value.includes(rootIdOf(land))
}

function toggleLand(land: any) {
  if (!canSelectLand(land) || selectionBusy.value)
    return
  const id = rootIdOf(land)
  if (!selectedIds.value.includes(id) && selectedIds.value.length >= selectionLimit.value) {
    toast.info(`道具库存为 ${selectionLimit.value} 个，最多选择 ${selectionLimit.value} 株作物`)
    return
  }
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter(item => item !== id)
    : [...selectedIds.value, id].sort((a, b) => Number(a) - Number(b))
}

function selectAllLands() {
  if (selectionBusy.value)
    return
  selectedIds.value = [...new Set((lands.value || []).filter(land => !land.occupiedByMaster && canSelectLand(land)).map(land => String(land.id)))]
    .sort((a, b) => Number(a) - Number(b))
    .slice(0, selectionLimit.value)
}

function clearSelectedLands() {
  if (selectionBusy.value)
    return
  selectedIds.value = []
}

function exitSelecting() {
  if (selectionBusy.value)
    return
  selecting.value = false
  selectedIds.value = []
}

function enterSelecting() {
  if (selectionBusy.value)
    return
  selecting.value = true
  if (batchAction.value !== 'item')
    selectAllLands()
}

function chooseBatchAction(action: BatchAction) {
  if (selectionBusy.value)
    return
  batchAction.value = action
  if (action !== 'item')
    selectAllLands()
}

const selectedLands = computed(() => selectedIds.value.map(landByRootId).filter(Boolean) as any[])
const normalTargets = computed(() => selectedLands.value.filter(isNormalFertilizeCandidate))
const organicTargets = computed(() => selectedLands.value.filter(isFertilizeCandidate))
const harvestTargets = computed(() => selectedLands.value.filter(isHarvestCandidate))
const farmingTargets = computed(() => selectedLands.value.filter(isLandFarmingCandidate))
const upgradeTargets = computed(() => selectedLands.value.filter(isUpgradeCandidate))
const removeTargets = computed(() => selectedLands.value.filter(isRemoveCandidate))
const removeConfirmMessage = computed(() => `确定铲除选中的 ${pendingRemoveLandIds.value.length} 块土地上的作物吗？此操作不可恢复。`)
// 道具：只取所选土地中对当前道具有效、未使用过的，按编号取前“库存”个。
const itemTargets = computed(() => {
  const item = selectedInteractionItem.value
  if (!item || item.count < 1)
    return [] as any[]
  const used = usedInteractionIdSet(item.itemId)
  return selectedLands.value
    .filter(land => !interactionItemTargetReason(item.itemId, land) && !hasConfirmedInteractionEffect(land, item.itemId) && !used.has(String(land.id)))
    .slice(0, item.count)
})

const selectedPlotCount = computed(() => lands.value.filter(isLandSelected).length)
const activeTargets = computed(() => ({
  normal: normalTargets.value,
  organic: organicTargets.value,
  harvest: harvestTargets.value,
  farming: farmingTargets.value,
  upgrade: upgradeTargets.value,
  remove: removeTargets.value,
  item: itemTargets.value,
})[batchAction.value])
const applyLabel = computed(() => ({
  normal: '施肥',
  organic: '施肥',
  harvest: '收获',
  farming: '务农',
  upgrade: '升级',
  remove: '铲除',
  item: '使用',
})[batchAction.value])

watch([lands, batchAction, selectedInteractionItem, selectionBusy, showManualFertilizerButtons], () => {
  if (selectionBusy.value)
    return
  if (!selectionOptions.value.some(option => option.value === batchAction.value))
    batchAction.value = selectionOptions.value[0]!.value
  selectedIds.value = selectedIds.value.filter(id => canSelectLand(landByRootId(id))).slice(0, selectionLimit.value)
}, { deep: true })

async function applySelection() {
  if (selectionBusy.value || !currentAccountConnected.value || !activeTargets.value.length)
    return
  if (batchAction.value === 'normal' || batchAction.value === 'organic')
    await fertilizeSelected(batchAction.value)
  else if (batchAction.value === 'farming')
    await farmSelected()
  else if (batchAction.value === 'remove')
    requestRemoveSelected()
  else if (batchAction.value === 'harvest' || batchAction.value === 'upgrade')
    await operateSelected(batchAction.value, activeTargets.value)
  else
    requestUseInteractionItem()
}

function requestRemoveSelected() {
  const landIds = removeTargets.value.map(land => Number(land.id)).filter(Boolean)
  if (!currentAccountId.value || !landIds.length)
    return
  pendingRemoveLandIds.value = landIds
  removeConfirmVisible.value = true
}

function cancelRemoveSelected() {
  removeConfirmVisible.value = false
  pendingRemoveLandIds.value = []
}

async function executeRemoveSelected() {
  const landIds = [...pendingRemoveLandIds.value]
  removeConfirmVisible.value = false
  pendingRemoveLandIds.value = []
  await operateSelected('remove', landIds.map(id => ({ id })))
}

function selectedInteractionIds() {
  return itemTargets.value.map(land => String(land.id))
}

function interactionFailures() {
  const results = lastInteractionResults.value[interactionSelectionKey()] || []
  return results.filter(result => !result.ok)
}

// 列数取土地数量的因数，让每一行都排满：24 块地可排成 8×3、6×4、4×6 等。
// 在卡片宽度落在合适区间的因数里取最大的；没有合适的因数（比如质数块数）时按宽度自然换行。
const gridEl = ref<HTMLElement | null>(null)
const gridWidth = ref(0)
let gridResizeFrame = 0
useResizeObserver(gridEl, ([entry]) => {
  window.cancelAnimationFrame(gridResizeFrame)
  if (!entry || entry.contentRect.width === gridWidth.value)
    return
  // 列数会改变网格高度，放到下一帧更新，避免在尺寸观察回调中再次触发布局通知。
  gridResizeFrame = window.requestAnimationFrame(() => {
    gridWidth.value = entry.contentRect.width
    gridResizeFrame = 0
  })
})
const GRID_GAP = 12
const CARD_MIN = 180
const CARD_MAX = 250
const gridColumns = computed(() => {
  const width = gridWidth.value
  const count = (lands.value || []).length
  if (!width || !count)
    return 2
  const fits = (cols: number) => (width - GRID_GAP * (cols - 1)) / cols
  const maxCols = Math.max(1, Math.floor((width + GRID_GAP) / (CARD_MIN + GRID_GAP)))
  for (let cols = Math.min(maxCols, count); cols >= 2; cols--) {
    if (count % cols === 0 && fits(cols) <= CARD_MAX)
      return cols
  }
  return maxCols
})

function isFertilizeCandidate(land: any) {
  return !!land?.unlocked
    && !land?.occupiedByMaster
    && String(land?.status || '') === 'growing'
    && Number(land?.matureInSec) > 0
}

function canNormalFertilize(land: any) {
  const left = land?.leftInorcFertTimes
  return left != null && Number(left) > 0
}

function isNormalFertilizeCandidate(land: any) {
  return isFertilizeCandidate(land) && canNormalFertilize(land)
}

function formatFertilizerRemaining(sec: number) {
  const remaining = Number(sec) || 0
  if (remaining <= 0)
    return ''
  return `剩余 ${(remaining / 3600).toFixed(1)}h`
}

async function fertilizeSelected(fertilizerType: FertilizerType) {
  const targets = fertilizerType === 'organic' ? organicTargets.value : normalTargets.value
  if (!currentAccountId.value || fertilizePending.value || batchPending.value || !targets.length)
    return
  const typeName = fertilizerType === 'organic' ? '有机化肥' : '普通化肥'
  const sequence = ++fertilizerUiSequence
  const result = await farmStore.fertilizeAll(currentAccountId.value, fertilizerType, targets.map(land => Number(land.id)))
  if (sequence !== fertilizerUiSequence)
    return
  if (!result) {
    toast.error(fertilizeError.value || `${typeName}使用失败，请刷新土地确认最新状态`)
    return
  }
  if (!result.successCount) {
    toast.info('所选土地当前都无需施肥')
    return
  }
  const skipped = result.skippedCount ? `，${result.skippedCount} 株未施肥` : ''
  const remaining = formatFertilizerRemaining(Number(result.fertilizerRemainingSec || 0))
  toast.success(`已为 ${result.successCount} 株作物施${typeName}${skipped}${remaining ? `，${remaining}` : ''}`)
}

async function fertilizeFromCard(land: any) {
  const accountId = currentAccountId.value
  if (!accountId || !currentAccountConnected.value || selectionBusy.value || farmingLandId.value !== null || !isNormalFertilizeCandidate(land))
    return
  const sequence = ++fertilizerUiSequence
  const result = await farmStore.fertilizeLand(accountId, Number(land.id), 'normal')
  if (sequence !== fertilizerUiSequence || accountId !== currentAccountId.value)
    return
  if (result)
    toast.success(`已为第 ${land.id} 块地施普通肥`)
  else
    toast.error(fertilizeError.value || '施肥失败，请刷新土地确认最新状态')
}

async function handleFertilizeAll() {
  if (!currentAccountId.value || !currentAccountConnected.value || fertilizePending.value || operating.value)
    return
  if (!bulkFertilizerCount.value) {
    fertilizerConfirmVisible.value = false
    toast.info('当前没有可施肥的作物')
    return
  }
  const sequence = ++fertilizerUiSequence
  const result = await farmStore.fertilizeAll(currentAccountId.value, bulkFertilizerType.value)
  if (sequence !== fertilizerUiSequence)
    return
  fertilizerConfirmVisible.value = false
  if (!result) {
    toast.error(fertilizeError.value || '施肥失败，请刷新土地确认最新状态')
    return
  }
  if (!result.successCount) {
    toast.info('当前没有可施肥的作物')
    return
  }
  const skipped = result.skippedCount ? `，${result.skippedCount} 株未施肥` : ''
  const remaining = formatFertilizerRemaining(Number(result.fertilizerRemainingSec || 0))
  toast.success(`已为 ${result.successCount} 株作物施肥${skipped}${remaining ? `，${remaining}` : ''}`)
}

/** 逐块务农，前一块结束再处理下一块；任一失败不影响其余地块。 */
async function farmSelected() {
  const targets = farmingTargets.value.map(land => Number(land.id)).filter(Boolean)
  if (!currentAccountId.value || batchPending.value || operating.value || !targets.length)
    return
  const accountId = currentAccountId.value
  const accountSessionVersion = farmStore.farmAccountSessionVersion
  batchPending.value = true
  let done = 0
  let idle = 0
  let failed = 0
  try {
    for (const landId of targets) {
      if (!isCurrentFarmPage(accountId, accountSessionVersion)) return
      farmingLandId.value = landId
      try {
        const result = await farmStore.operate(accountId, 'clear', landId)
        if (result?.hadWork)
          done++
        else
          idle++
      }
      catch {
        failed++
      }
      if (!isCurrentFarmPage(accountId, accountSessionVersion))
        return
    }
  }
  finally {
    farmingLandId.value = null
    batchPending.value = false
  }
  const parts = [done && `${done} 块务农完成`, idle && `${idle} 块无需处理`, failed && `${failed} 块失败`].filter(Boolean).join('，')
  if (failed)
    toast.warning(parts)
  else
    toast.success(parts || '所选土地无需务农')
}

async function operateSelected(opType: 'harvest' | 'upgrade' | 'remove', targets: any[]) {
  const landIds = targets.map(land => Number(land.id)).filter(Boolean)
  if (!currentAccountId.value || batchPending.value || operating.value || !landIds.length)
    return
  const accountId = currentAccountId.value
  const accountSessionVersion = farmStore.farmAccountSessionVersion
  const actionLabel = { harvest: '收获', upgrade: '升级', remove: '铲除' }[opType]
  batchPending.value = true
  let done = 0
  let idle = 0
  let failed = 0
  const isOperationCandidate = {
    harvest: isHarvestCandidate,
    upgrade: isUpgradeCandidate,
    remove: isRemoveCandidate,
  }[opType]
  try {
    for (const landId of landIds) {
      if (!isCurrentFarmPage(accountId, accountSessionVersion)) return
      const land = lands.value.find(item => Number(item.id) === landId)
      if (!land || !isOperationCandidate(land)) {
        idle++
        continue
      }
      try {
        const result = await farmStore.operate(accountId, opType, landId)
        if (result?.hadWork)
          done++
        else
          idle++
      }
      catch {
        failed++
      }
      if (!isCurrentFarmPage(accountId, accountSessionVersion))
        return
    }
  }
  finally {
    batchPending.value = false
  }
  const parts = [done && `${done} 块${actionLabel}完成`, idle && `${idle} 块无需${actionLabel}`, failed && `${failed} 块失败`].filter(Boolean).join('，')
  if (failed)
    toast.warning(parts)
  else
    toast.success(parts || `所选土地无需${actionLabel}`)
}

function requestUseInteractionItem() {
  const item = selectedInteractionItem.value
  if (!currentAccountId.value || !item || selectedInteractionIds().length === 0)
    return
  const count = selectedInteractionIds().length
  const saleConditionWarning = item.saleConditionSatisfiedCount > 0
    ? `该道具库存中有 ${item.saleConditionSatisfiedCount} 个已满足游戏配置的出售条件，可能已过活动或有效期，`
    : ''
  interactionConfirmMessage.value = `${saleConditionWarning}将在自己农场的 ${count} 块土地上按编号依次使用“${item.name}”。若期间作物状态发生变化，部分地块可能使用失败；是否继续？`
  interactionConfirmVisible.value = true
}

async function executeUseInteractionItem() {
  const accountId = currentAccountId.value
  const accountSessionVersion = farmStore.farmAccountSessionVersion
  const item = selectedInteractionItem.value
  interactionConfirmVisible.value = false
  if (!accountId || !item)
    return
  const landIds = selectedInteractionIds()
  if (landIds.length === 0)
    return

  const result = await farmStore.useInteractionItemBatch(accountId, item.itemId, landIds)
  if (!isCurrentFarmPage(accountId, accountSessionVersion))
    return
  if (!result) {
    toast.error(interactionUseError.value || `${item.name}使用失败`)
    return
  }
  lastInteractionResults.value = {
    ...lastInteractionResults.value,
    [interactionSelectionKey(item.itemId)]: result.results || [],
  }
  const used = new Set((result.usedLandIds || []).map(String))
  selectedIds.value = selectedIds.value.filter(landId => !used.has(landId))
  const successCount = Number(result.successCount || 0)
  const failureCount = Number(result.failureCount || 0)
  if (successCount > 0 && failureCount === 0)
    toast.success(result.message || `已按顺序使用 ${successCount} 个${item.name}`)
  else if (successCount > 0)
    toast.warning(result.message || `成功 ${successCount} 块，跳过 ${failureCount} 块`)
  else
    toast.warning(result.message || `所选地块当前均不可使用${item.name}`)
}

async function refreshFarmData(readLands = true) {
  const accountId = currentAccountId.value
  if (!accountId || !currentAccountConnected.value)
    return
  await Promise.all([
    readLands ? farmStore.fetchLands(accountId) : undefined,
    farmStore.fetchInteractionItems(accountId),
    settingStore.fetchSettings(accountId),
    bagStore.fetchBag(accountId),
  ])
}

/** 只有用户点击才走这个入口：仅驱动图标自己转圈，不让 Naive UI 替换 #icon 插槽。 */
async function refreshFarm() {
  if (manualRefreshing.value)
    return

  manualRefreshing.value = true
  try {
    await refreshFarmData()
  }
  finally {
    manualRefreshing.value = false
  }
}

watch(currentAccountId, () => {
  farmStore.clearFarmAccountState()
  farmingLandId.value = null
  selectedInteractionItemId.value = undefined
  selecting.value = false
  selectedIds.value = []
  lastInteractionResults.value = {}
})

watch(interactionItems, (items) => {
  const first = items[0]
  if (!first) {
    selectedInteractionItemId.value = undefined
    return
  }
  const requestedItemId = String(route.query.interactionItem || '')
  if (requestedItemId && items.some(item => String(item.itemId) === requestedItemId)) {
    selectedInteractionItemId.value = requestedItemId
    return
  }
  if (!items.some(item => String(item.itemId) === selectedInteractionItemId.value))
    selectedInteractionItemId.value = String(first.itemId)
})

// 首次确认在线、切到在线账号或重连后，都重读土地；不依赖旧请求是否留有错误。
watch([currentAccountId, presence], ([, next]) => {
  if (next === 'offline')
    farmStore.clearFarmAccountState()
  else if (next === 'online')
    void refreshFarmData()
}, { immediate: true })

const { pause, resume } = useIntervalFn(() => {
  for (const land of lands.value || []) {
    if (land.matureInSec > 0)
      land.matureInSec--
  }
}, 1000)

const { pause: pauseRefresh, resume: resumeRefresh } = useIntervalFn(() => refreshFarmData(!error.value), 60000)

onMounted(() => {
  resume()
  resumeRefresh()
})

onUnmounted(() => {
  farmPanelMounted = false
  fertilizerUiSequence++
  farmStore.invalidateFarmReadRequests()
  window.cancelAnimationFrame(gridResizeFrame)
  pause()
  pauseRefresh()
})
</script>

<template>
  <div class="panel-fill">
    <div class="min-w-0 flex flex-col cartoon-card page-card-surface rounded-2xl bg-white shadow-lg dark:bg-gray-800 panel-scroll-layout margin-shell"><span class="!m-0 margin-content">
      <div class="farm-head panel-titlebar panel-titlebar--flush shrink-0 margin-shell"><span class="margin-content">
        <div class="farm-actions">
          <NButton
            v-if="!selecting"
            aria-label="施肥"
            title="施肥"
            :disabled="operating || fertilizePending || farmingLandId !== null || !currentAccountConnected || !loaded || !!error || !lands.some(isFertilizeCandidate)"
            @click="fertilizerConfirmVisible = true"
          >
            <span class="i-carbon-soil-moisture" />
            <span class="farm-action-label">施肥</span>
          </NButton>
          <NButton
            v-for="op in (selecting ? [] : operations)"
            :key="op.type"
            :type="op.buttonType"
            :disabled="operating || fertilizePending || farmingLandId !== null || !currentAccountConnected"
            :aria-label="op.label"
            :title="op.label"
            @click="handleOperate(op.type)"
          >
            <span :class="op.icon" />
            <span class="farm-action-label">{{ op.label }}</span>
          </NButton>
          <NButton
            class="panel-multiselect-toggle"
            size="medium"
            :type="selecting ? 'default' : 'primary'"
            :secondary="!selecting"
            :aria-label="selecting ? '取消' : '多选'"
            :title="selecting ? '取消' : '多选'"
            :disabled="selectionBusy || !currentAccountConnected"
            @click="selecting ? exitSelecting() : enterSelecting()"
          >
            <span class="i-carbon-checkbox-checked" />
            <span class="panel-multiselect-toggle__label">{{ selecting ? '取消' : '多选' }}</span>
          </NButton>
          <RefreshButton
            class="farm-refresh"
            size="medium"
            :loading="manualRefreshing"
            :disabled="selectionBusy || !currentAccountId || !currentAccountConnected || !!error"
            @click="refreshFarm"
          />
        </div>
      </span></div>

      <div class="panel-scroll-body">
        <div v-if="currentAccountConnected && loaded && !error" class="farm-action-summary">
          <div class="farm-action-summary__states">
            <span v-for="item in landActionSummary" :key="item.label" class="farm-action-state" :class="`farm-action-state--${item.kind}`"><i :class="item.icon" aria-hidden="true" />{{ item.label }} <span>{{ item.count }}</span></span>
          </div>
          <div class="farm-action-summary__stock">
            <span v-for="item in fertilizerStocks" :key="item.id" :title="item.title"><i :class="item.id === 1011 ? 'i-carbon-chemistry' : 'i-carbon-sprout'" aria-hidden="true" />{{ item.label }} <span>{{ item.hours === null ? '--' : item.hours.toFixed(1) }}{{ item.hours === null ? '' : 'h' }}</span></span>
          </div>
        </div>


      <!-- Grid -->
      <div class="min-w-0 flex flex-col px-4" :class="{ 'py-4': !isOffline && !error }">
        <div v-if="loading || !currentAccountId || !currentAccountConnected || error || !loaded || !lands?.length" role="region" aria-label="土地状态" tabindex="0">
          <EmptyState v-if="!currentAccountId" bare title="请先选择账号" description="添加并选择账号后查看土地" icon="i-carbon-user-avatar" />

          <OfflineState v-else-if="isOffline" />

          <div v-else-if="loading || presence === 'unknown'" class="flex justify-center py-12">
            <div class="i-svg-spinners-90-ring-with-bg text-4xl text-green-500" />
          </div>

          <OfflineState v-else-if="error" />

          <EmptyState v-else-if="!loaded" bare title="尚未读取土地" icon="i-carbon-data-view-alt">
            <NButton secondary @click="refreshFarm">
              立即读取
            </NButton>
          </EmptyState>

          <EmptyState v-else-if="!lands || lands.length === 0" bare title="没有可展示的土地" description="可重新读取确认" icon="i-carbon-sprout">
            <NButton secondary @click="refreshFarm">
              重新读取
            </NButton>
          </EmptyState>
        </div>

        <div v-else class="min-w-0 flex flex-col">
          <div v-if="selecting" class="farm-selection-setup">
            <div class="farm-selection-row">
              <div class="farm-mode-switch" role="group" aria-label="多选操作类型">
                <button v-for="option in selectionOptions" :key="option.value" type="button" :aria-pressed="batchAction === option.value" :disabled="selectionBusy" @click="chooseBatchAction(option.value)">
                  <span :class="option.icon" aria-hidden="true" />{{ option.label }}
                </button>
              </div>
              <div class="farm-selectbar" role="toolbar" aria-label="所选土地操作">
                <div class="farm-selectbar__info" aria-live="polite">
                  <span>已选 <b>{{ selectedIds.length }}</b> 株<span v-if="selectedPlotCount > selectedIds.length" class="farm-selectbar__coverage"> · {{ selectedPlotCount }} 块地</span></span>
                  <span class="farm-selectbar__links">
                    <button type="button" @click="selectAllLands">全选</button>
                    <button type="button" @click="clearSelectedLands">清空</button>
                  </span>
                </div>
                <NButton type="primary" :disabled="selectionBusy || !currentAccountConnected || !activeTargets.length" :loading="selectionBusy" @click="applySelection">
                  {{ applyLabel }}
                </NButton>
              </div>
            </div>
            <div v-if="batchAction === 'item'" class="farm-item-picker">
              <BaseSelect
                v-model="selectedInteractionItemId"
                :options="interactionItems.map(item => ({ label: `${item.name}（库存 ${item.count}）`, value: String(item.itemId) }))"
                :disabled="selectionBusy || interactionItemsLoading || !interactionItems.length"
                :placeholder="interactionItemPlaceholder"
                aria-label="选择道具"
              />
              <span v-if="interactionItemsError" class="farm-item-error">{{ interactionItemsError }}<button type="button" @click="currentAccountId && farmStore.fetchInteractionItems(currentAccountId)">重试</button></span>
              <p v-else-if="selectedInteractionItem?.description">
                {{ selectedInteractionItem.description }}
              </p>
              <p v-if="selectedInteractionItem && selectedInteractionItem.saleConditionSatisfiedCount > 0" class="farm-item-error">
                部分道具可能已过活动或有效期，使用时可能失败。
              </p>
              <details v-if="interactionFailures().length" class="farm-item-error">
                <summary>{{ interactionFailures().length }} 块土地未成功使用</summary>
                <p v-for="result in interactionFailures()" :key="result.landId">
                  #{{ result.landId }}：{{ result.message }}
                </p>
              </details>
            </div>
          </div>

          <div role="region" aria-label="土地列表" tabindex="0">
            <div v-if="cleanableFarmSocialEvents.length > 0" class="mb-4 flex flex-wrap items-center justify-between gap-2 border border-emerald-200 rounded-xl bg-emerald-50/85 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100">
              <span class="flex items-center gap-2">
                <span class="i-carbon-pedestrian-child" />
                好友放置了 {{ cleanableFarmSocialEventNames }}，可一键务农，或选择土地后务农清理。
              </span>
            </div>
            <div ref="gridEl" class="farm-grid" :class="{ 'is-selecting': selecting }" :style="{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }">
              <LandCard
                v-for="land in lands"
                :key="land.id"
                :land="land"
                openable
                :selectable="selecting"
                :selected="isLandSelected(land)"
                :selection-disabled="!canSelectLand(land)"
                :selection-label="selectReason(land)"
                :farm-disabled="operating || fertilizePending || farmingLandId !== null || !currentAccountConnected"
                @open="detailLandId = $event.id"
                @select="toggleLand(land)"
                @farm="handleOperate('clear')"
                @fertilize="fertilizeFromCard"
              />
            </div>
          </div>
        </div>
      </div>
      </div>
    </span></div>

    <LandDetailModal
      :land="detailLand"
      :player="status?.status"
      :connected="currentAccountConnected"
      :upgrade-pending="detailUpgradePending"
      @upgrade="upgradeDetailLand"
      @close="detailLandId = null"
    />

    <ConfirmModal
      :show="fertilizerConfirmVisible"
      title="施肥"
      message="将为所有生长中的作物施用一次所选化肥，确认施肥吗？"
      confirm-text="确认施肥"
      :loading="fertilizePending"
      @confirm="handleFertilizeAll"
      @cancel="fertilizerConfirmVisible = false"
    >
      <BaseSelect v-model="bulkFertilizerType" label="化肥类型" :options="bulkFertilizerOptions" :disabled="fertilizePending" />
      <p class="mt-3 text-sm text-gray-500">
        可施肥 {{ bulkFertilizerCount }} 株作物
      </p>
    </ConfirmModal>

    <ConfirmModal
      :show="removeConfirmVisible"
      title="确认铲除"
      :message="removeConfirmMessage"
      confirm-text="确认铲除"
      type="danger"
      :loading="batchPending"
      @confirm="executeRemoveSelected"
      @cancel="cancelRemoveSelected"
    />

    <ConfirmModal
      :show="interactionConfirmVisible"
      title="确认使用互动道具"
      :message="interactionConfirmMessage"
      :loading="interactionUsePending"
      @confirm="executeUseInteractionItem"
      @cancel="interactionConfirmVisible = false"
    />
  </div>
</template>

<style scoped>
.farm-card { --inset-top: 0; --inset-right: 0; --inset-bottom: 0; --inset-left: 0; }
.farm-action-summary, .farm-action-summary * { font-weight: 400; }
.farm-action-summary__stock > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.farm-action-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ui-border);
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
}
.farm-action-summary__states,
.farm-action-summary__stock {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.farm-action-summary__states {
  gap: 6px;
}
.farm-action-summary__stock {
  margin-inline-start: auto;
}
.farm-action-summary__stock span > span {
  color: var(--ui-primary);
  font-variant-numeric: tabular-nums;
}

.farm-action-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 6px;
  color: var(--state-color);
  background: color-mix(in srgb, var(--state-color) 12%, transparent);
  font-variant-numeric: tabular-nums;
}
.farm-action-state--harvest { --state-color: var(--ui-warning); }
.farm-action-state--normal { --state-color: #649cdb; }
.farm-action-state--organic { --state-color: var(--ui-primary); }
.farm-action-state--farming { --state-color: #a080cc; }

.farm-grid {
  display: grid;
  gap: var(--ui-card-grid-gap);
}

.farm-grid.is-selecting {
  padding-bottom: 8px;
}

.farm-selection-setup {
  display: grid;
  gap: 12px;
  margin-bottom: 12px;
}

.farm-item-picker {
  display: grid;
  max-width: 420px;
  gap: 8px;
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
  line-height: 1.6;
}

.farm-item-picker :deep(.n-base-selection) {
  --n-placeholder-color: var(--ui-muted) !important;
  --n-placeholder-color-disabled: var(--ui-muted) !important;
}

.farm-item-picker p {
  margin: 0;
}

.farm-item-error {
  color: var(--ui-warning);
}

.farm-item-error button {
  margin-left: 8px;
  color: var(--ui-primary);
}

/* 标题栏格式（底色/分隔线/圆角/留白）全部走全局 .panel-titlebar + --flush；
   这里只留农场工具栏自己的多行排布。 */
.farm-head {
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
}

.farm-actions {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: nowrap;
  gap: 8px;
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.farm-actions::-webkit-scrollbar {
  display: none;
}

.farm-actions :deep(.n-button) {
  flex: 0 0 auto;
  width: auto;
}

.farm-actions :deep(.n-button__content) {
  gap: 4px;
  white-space: nowrap;
}

.farm-refresh {
  flex: 0 0 auto;
}

</style>
