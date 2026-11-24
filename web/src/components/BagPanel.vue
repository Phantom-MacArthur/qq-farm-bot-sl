<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { NButton } from 'naive-ui/es/button'
import { NDropdown } from 'naive-ui/es/dropdown'
import { NInputNumber } from 'naive-ui/es/input-number'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { getApiErrorMessage } from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import OfflineState from '@/components/ui/OfflineState.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { useAccountPresence } from '@/composables/useReconnectRefresh'
import { useAccountStore } from '@/stores/account'
import { useFarmStore } from '@/stores/farm'
import { useBagStore } from '@/stores/bag'
import { usePetStore } from '@/stores/pet'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import { formatNumber } from '@/utils/format-number'

const accountStore = useAccountStore()
const bagStore = useBagStore()
const petStore = usePetStore()
const statusStore = useStatusStore()
const toastStore = useToastStore()

const { currentAccountId } = storeToRefs(accountStore)
const { items, loading: bagLoading, originalItems } = storeToRefs(bagStore)
const { snapshot: petSnapshot, activeDog, error: petError } = storeToRefs(petStore)
const { loading: statusLoading, error: statusError, realtimeConnected } = storeToRefs(statusStore)

const presence = useAccountPresence()
const isOffline = computed(() => presence.value === 'offline')
const isConnected = computed(() => presence.value === 'online')

const imageErrors = ref<Record<string, boolean>>({})

type CategoryValue = 'all' | 'fruit' | 'mutant' | 'seed' | 'tool'

const CATEGORY_OPTIONS: { label: string, value: CategoryValue }[] = [
  { label: '全部', value: 'all' },
  { label: '果实', value: 'fruit' },
  { label: '超变果实', value: 'mutant' },
  { label: '种子', value: 'seed' },
  { label: '道具', value: 'tool' },
]

const DOG_FOOD_DURATIONS = new Map<number, number>([
  [90004, 86400],
  [90005, 3 * 86400],
  [90006, 5 * 86400],
])

const selectedCategory = ref<CategoryValue>('all')
const searchKeyword = ref('')

const CATEGORY_SHORT_LABELS: Record<string, string> = {
  fruit: '果实',
  mutant: '超变',
  seed: '种子',
  tool: '道具',
}

type ItemActionKey = 'use' | 'sell' | 'view'

// 主操作排在第一位直接显示，其余收进“更多”菜单，底栏宽度不随操作数量变化。
function itemActions(item: any) {
  const actions: Array<{ key: ItemActionKey, label: string, title: string }> = []
  if (canUse(item))
    actions.push({ key: 'use', label: '使用', title: '选择使用数量' })
  if (canSell(item))
    actions.push({ key: 'sell', label: '出售', title: '出售全部' })
  if (canView(item))
    actions.push({ key: 'view', label: '赠送', title: '查看赠送信息' })
  return actions
}

function runItemAction(key: ItemActionKey, item: any) {
  if (key === 'use')
    handleUseClick(item)
  else if (key === 'sell')
    handleSellClick(item)
  else
    handleViewClick(item)
}

function useSuccessMessage(item: any, count: number, result: any) {
  const rewards = result?.rewards || []
  return [11, 33].includes(Number(item.itemType)) && rewards.length
    ? `获得：${rewards.map((reward: any) => `${reward.name} ×${formatNumber(reward.count)}`).join('、')}`
    : `已使用 ${item.name || `物品${item.id}`} x${count}`
}

function getItemCategory(item: any): CategoryValue {
  const itemType = Number(item?.itemType || 0)
  if (itemType === 6)
    return 'fruit'
  if (itemType === 17)
    return 'mutant'
  if (itemType === 5)
    return 'seed'
  return 'tool'
}

// 分类与名称搜索叠加筛选，与图鉴「道具」页一致；批量操作只作用于当前筛选结果。
const filteredItems = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  return items.value.filter((item: any) => (
    (selectedCategory.value === 'all' || getItemCategory(item) === selectedCategory.value)
    && (!keyword || String(item.name || '').toLowerCase().includes(keyword))
  ))
})

const confirmModal = ref({
  show: false,
  title: '',
  message: '',
  type: 'primary' as 'primary' | 'danger',
  loading: false,
  action: '' as 'sell' | 'use' | 'batchSell' | 'batchLock' | 'batchUnlock' | 'batchUse',
  item: null as any,
  useCount: 1,
  selectedItems: [] as any[],
})

const viewModal = ref({
  show: false,
  item: null as any,
})

function isDogFood(item: any) {
  return DOG_FOOD_DURATIONS.has(Number(item?.id || 0))
}

function isFertilizer(item: any) {
  const interactionType = String(item?.interactionType || '').trim().toLowerCase()
  return interactionType === 'fertilizer' || interactionType === 'fertilizerpro'
}

function dogFoodMaxUseCount(item: any) {
  const inventory = Math.max(0, Math.trunc(Number(item?.count || 0)))
  const duration = DOG_FOOD_DURATIONS.get(Number(item?.id || 0)) || 0
  if (!duration || !petSnapshot.value)
    return inventory
  const currentDuration = Math.max(0, Number(petSnapshot.value.protectDuration || 0))
  const maxDuration = Math.max(currentDuration, Number(petSnapshot.value.maxProtectDuration || 30 * 86400))
  return Math.max(0, Math.min(inventory, Math.floor((maxDuration - currentDuration) / duration)))
}

const maxUseCount = computed(() => {
  const item = confirmModal.value.item
  const count = isDogFood(item) ? dogFoodMaxUseCount(item) : Number(item?.count || 1)
  return Math.max(1, count)
})

function setUseCount(value: unknown) {
  const count = Math.trunc(Number(value) || 1)
  confirmModal.value.useCount = Math.max(1, Math.min(count, maxUseCount.value))
}

type BatchAction = 'sell' | 'lock' | 'unlock' | 'use' | 'plant'

const batchAction = ref<BatchAction | null>(null)
const batchMode = computed(() => batchAction.value !== null)
const multiSelectEnabled = ref(false)
const selectedForBatch = ref<Set<string>>(new Set())
const batchSellResult = ref<{ gold: number, goldBean: number } | null>(null)

const selectedBatchCount = computed(() => {
  return selectedForBatch.value.size
})

const batchActionLabel = computed(() => {
  if (batchAction.value === 'sell')
    return '出售'
  if (batchAction.value === 'lock')
    return '锁定'
  if (batchAction.value === 'unlock')
    return '解锁'
  return '使用'
})

const confirmButtonText = computed(() => {
  if (confirmModal.value.action === 'sell' || confirmModal.value.action === 'batchSell')
    return '确认出售'
  if (confirmModal.value.action === 'batchLock')
    return '确认锁定'
  if (confirmModal.value.action === 'batchUnlock')
    return '确认解锁'
  if (confirmModal.value.action === 'batchUse')
    return '确认使用'
  if (confirmModal.value.action === 'use' && isDogFood(confirmModal.value.item))
    return '确认喂食'
  return '确认使用'
})

function mutantTypeLabel(item: any) {
  const names = Array.isArray(item?.mutantTypeNames) ? item.mutantTypeNames.map(String).filter(Boolean) : []
  if (names.length)
    return names.join(' + ')
  const effects = Array.isArray(item?.mutantEffects) ? item.mutantEffects.map((effect: any) => String(effect?.name || '')).filter(Boolean) : []
  if (effects.length)
    return effects.join(' + ')
  const ids = Array.isArray(item?.mutantTypes) ? item.mutantTypes : []
  return ids.join(' + ')
}

function getPriceClass(item: any) {
  const priceId = Number(item?.priceId || 0)
  if (priceId === 1005)
    return 'text-amber-400 dark:text-amber-300'
  if (priceId === 1002)
    return 'text-sky-400 dark:text-sky-300'
  return 'text-gray-400'
}

function canSell(item: any) {
  return item?.sellable === true && item?.locked !== true
}

// 卡片只提示例外状态；可否出售由底栏有无「出售」操作体现，不再重复写「可出售/不可出售」。
function getSellStatusText(item: any) {
  if (item?.locked === true)
    return '已锁定'
  if (!canSell(item) && item?.sellStatus === 'conditional')
    return '条件出售'
  return ''
}

function canBatchSell(item: any) {
  return canSell(item) && Number(item.count || 0) > 0
}

function canUse(item: any) {
  const itemType = Number(item?.itemType || 0)
  return ([11, 33].includes(itemType) || isDogFood(item) || isFertilizer(item)) && item?.locked !== true
}

function isLockable(item: any) {
  return [17, 6, 5].includes(Number(item?.itemType || 0))
}

function canLock(item: any) {
  return isLockable(item) && item?.locked !== true
}

function canUnlock(item: any) {
  return isLockable(item) && item?.locked === true
}

function canBatchUse(item: any) {
  return canUse(item)
    && Number(item?.count || 0) > 0
    && (!isDogFood(item) || dogFoodMaxUseCount(item) > 0)
}

function isBatchEligible(item: any) {
  if (batchAction.value === 'sell')
    return canBatchSell(item)
  if (batchAction.value === 'lock')
    return canLock(item)
  if (batchAction.value === 'unlock')
    return canUnlock(item)
  if (batchAction.value === 'use')
    return canBatchUse(item)
  return false
}

function canView(item: any) {
  return item?.viewable === true && !!item?.sourceInfo
}

function handleViewClick(item: any) {
  viewModal.value = { show: true, item }
}

function closeViewModal() {
  viewModal.value.show = false
}

function formatSentAt(value: unknown) {
  const timestamp = Number(value || 0)
  if (timestamp <= 0)
    return '未记录'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp * 1000))
}

function viewDescription(item: any) {
  const senderName = String(item?.sourceInfo?.senderName || '好友')
  const description = String(item?.description || '')
  return description ? description.replace('{0}', senderName) : `${senderName}赠送的鹊羽香囊`
}

function sachetMessage(messageTextId: unknown) {
  const id = Number(messageTextId || 0)
  return id > 0 ? `寄语编号 ${id}` : '未记录'
}

function itemKey(item: any) {
  return String(item?.key || item?.groupKey || item?.id || '')
}

function toggleBatchSelection(item: any) {
  if (!isBatchEligible(item))
    return
  const key = itemKey(item)
  if (selectedForBatch.value.has(key))
    selectedForBatch.value.delete(key)
  else
    selectedForBatch.value.add(key)
}

function handleSellClick(item: any) {
  if (batchMode.value) {
    toggleBatchSelection(item)
    return
  }
  const totalPrice = (Number(item.count) || 0) * (Number(item.price) || 0)
  const priceUnit = item.priceUnit || '金'
  const messages = [
    `确定要出售全部${item.name || `物品${item.id}`}吗?`,
    `数量：${item.count || 0}`,
  ]
  if (totalPrice > 0) {
    messages.push(`售出总金币：${totalPrice}${priceUnit}`)
  }
  confirmModal.value = {
    show: true,
    title: '确认出售',
    message: messages.join('\n'),
    type: 'danger',
    loading: false,
    action: 'sell',
    item,
    useCount: 1,
    selectedItems: [],
  }
}

async function handleUseClick(item: any) {
  if (isDogFood(item)) {
    const accountId = String(currentAccountId.value || '')
    const hasCurrentSnapshot = petStore.accountId === accountId && !!petSnapshot.value
    const loaded = hasCurrentSnapshot || await petStore.fetchPetInfo(accountId)
    if (!loaded || !petSnapshot.value) {
      toastStore.error(petError.value || '读取宠物看护时间失败')
      return
    }
    if (!activeDog.value) {
      toastStore.warning('请先在宠物页选择一只已获得的宠物上场')
      return
    }
    if (dogFoodMaxUseCount(item) <= 0) {
      toastStore.warning('当前看护时间已接近 30 天上限，无法再使用这份狗粮')
      return
    }
  }
  confirmModal.value = {
    show: true,
    title: `${isDogFood(item) ? '喂食' : '使用'}${item.name || `物品${item.id}`}`,
    message: '',
    type: 'primary',
    loading: false,
    action: 'use',
    item,
    useCount: 1,
    selectedItems: [],
  }
}

async function handleConfirm() {
  const { action, item, selectedItems, useCount } = confirmModal.value
  if (!currentAccountId.value)
    return

  confirmModal.value.loading = true
  try {
    if (action === 'sell' && item) {
      const sellItems = originalItems.value
        .filter((it: any) => itemKey(it) === itemKey(item))
        .map((it: any) => ({ id: it.id, count: it.count, uid: it.uid || 0 }))

      if (sellItems.length === 0) {
        toastStore.error('未找到可出售的物品')
        return
      }

      const res = await bagStore.sellItems(currentAccountId.value, sellItems)
      if (res.ok) {
        toastStore.success(`已出售 ${item.name || `物品${item.id}`}`)
        await loadBag()
      }
      else {
        toastStore.error(`出售失败: ${res.error || '未知错误'}`)
      }
    }
    else if (action === 'batchSell' && selectedItems) {
      const itemsToSell = selectedItems.map((it: any) => ({ id: it.id, count: it.count, uid: it.uid || 0 }))

      if (itemsToSell.length === 0) {
        toastStore.error('未找到可出售的物品')
        return
      }

      const res = await bagStore.sellItems(currentAccountId.value, itemsToSell)
      if (res.ok) {
        let totalGold = 0
        let totalGoldBean = 0
        for (const si of selectedItems) {
          const fi = filteredItems.value.find((f: any) => itemKey(f) === itemKey(si))
          if (fi) {
            const price = Number(fi.price) || 0
            const count = Number(si.count) || 0
            const priceId = Number(fi.priceId) || 0
            if (priceId === 1005) {
              totalGoldBean += price * count
            }
            else {
              totalGold += price * count
            }
          }
        }
        batchSellResult.value = { gold: totalGold, goldBean: totalGoldBean }
        toastStore.success(`已批量出售 ${selectedItems.length} 种物品，获得 ${totalGold} 金币, ${totalGoldBean} 金豆豆`)
        selectedForBatch.value.clear()
        batchAction.value = null
        await loadBag()
      }
      else {
        toastStore.error(`批量出售失败: ${res.error || '未知错误'}`)
      }
    }
    else if ((action === 'batchLock' || action === 'batchUnlock') && selectedItems) {
      const locked = action === 'batchLock'
      const itemUids = selectedItems
        .map((it: any) => Number(it.uid || 0))
        .filter((uid: number) => Number.isSafeInteger(uid) && uid > 0)
      if (itemUids.length === 0) {
        toastStore.error('未找到可操作的物品 UID')
        return
      }
      const res = await bagStore.setItemsLocked(currentAccountId.value, itemUids, locked)
      if (res.ok) {
        toastStore.success(`已${locked ? '锁定' : '解锁'} ${Number(res.data?.changed || itemUids.length)} 种物品`)
        selectedForBatch.value.clear()
        batchAction.value = null
        await loadBag()
      }
      else {
        toastStore.error(`${locked ? '锁定' : '解锁'}失败: ${res.error || '未知错误'}`)
      }
    }
    else if (action === 'batchUse' && selectedItems) {
      let successCount = 0
      let usedItemCount = 0
      const failures: string[] = []
      for (const selectedItem of selectedItems) {
        const count = isDogFood(selectedItem)
          ? dogFoodMaxUseCount(selectedItem)
          : Math.max(0, Math.trunc(Number(selectedItem.count) || 0))
        if (count <= 0) {
          failures.push(`${selectedItem.name || `物品${selectedItem.id}`}: 当前可使用数量为 0`)
          continue
        }
        try {
          if (isDogFood(selectedItem)) {
            const result = await petStore.useDogFood(
              currentAccountId.value,
              Number(selectedItem.id),
              count,
              Number(selectedItem.uid) || 0,
            )
            if (!result) {
              failures.push(`${selectedItem.name || `物品${selectedItem.id}`}: ${petError.value || '使用失败'}`)
              continue
            }
          }
          else {
            const res = await bagStore.useItem(
              currentAccountId.value,
              Number(selectedItem.id),
              count,
              Number(selectedItem.uid) || 0,
            )
            if (!res.ok) {
              failures.push(`${selectedItem.name || `物品${selectedItem.id}`}: ${res.error || '使用失败'}`)
              continue
            }
          }
          successCount++
          usedItemCount += count
        }
        catch (cause: any) {
          failures.push(`${selectedItem.name || `物品${selectedItem.id}`}: ${getApiErrorMessage(cause, '使用失败')}`)
        }
      }

      selectedForBatch.value.clear()
      batchAction.value = null
      await loadBag()
      if (failures.length) {
        const details = failures.slice(0, 3).join('；')
        const remaining = failures.length > 3 ? `；另有 ${failures.length - 3} 种失败` : ''
        toastStore.warning(`成功使用 ${successCount} 种、${usedItemCount} 个；失败 ${failures.length} 种：${details}${remaining}`)
      }
      else {
        toastStore.success(`已批量使用 ${successCount} 种物品，共 ${usedItemCount} 个`)
      }
    }
    else if (action === 'use' && item) {
      const useLimit = isDogFood(item) ? dogFoodMaxUseCount(item) : Number(item.count || 1)
      if (useLimit <= 0) {
        toastStore.warning('当前看护时间已接近 30 天上限，无法再使用这份狗粮')
        return
      }
      const count = Math.max(1, Math.min(Math.trunc(Number(useCount) || 1), useLimit))
      if (isDogFood(item)) {
        const result = await petStore.useDogFood(currentAccountId.value, Number(item.id), count, Number(item.uid) || 0)
        if (result) {
          toastStore.success(`已喂食 ${item.name || `狗粮${item.id}`} x${count}，看护时间已增加`)
          await loadBag()
        }
        else {
          toastStore.error(`喂食失败: ${petError.value || '未知错误'}`)
        }
      }
      else {
        const res = await bagStore.useItem(currentAccountId.value, Number(item.id), count, Number(item.uid) || 0)
        if (res.ok) {
          toastStore.success(useSuccessMessage(item, count, res.data))
          await loadBag()
        }
        else {
          toastStore.error(`使用失败: ${res.error || '未知错误'}`)
        }
      }
    }
  }
  catch (e: any) {
    const message = getApiErrorMessage(e, '未知错误')
    toastStore.error(`操作失败: ${message}`)
  }
  finally {
    confirmModal.value.loading = false
    confirmModal.value.show = false
  }
}

function handleCancel() {
  confirmModal.value.show = false
}

function toggleBatchMode(action: BatchAction) {
  batchAction.value = action
  selectedForBatch.value.clear()
  batchSellResult.value = null
  selectAllEligible()
}

function toggleMultiSelect() {
  multiSelectEnabled.value = !multiSelectEnabled.value
  selectedForBatch.value.clear()
  batchSellResult.value = null
  batchAction.value = multiSelectEnabled.value ? 'use' : null
  if (multiSelectEnabled.value)
    selectAllEligible()
}

const batchEligibleCount = computed(() => filteredItems.value.filter((item: any) => isBatchEligible(item)).length)
function selectAllEligible() {
  selectedForBatch.value.clear()
  for (const item of filteredItems.value) {
    if (isBatchEligible(item)) {
      selectedForBatch.value.add(itemKey(item))
    }
  }
}

function handleBatchSellClick() {
  const sellableItems = filteredItems.value.filter((item: any) => canBatchSell(item))
  if (sellableItems.length === 0) {
    toastStore.warning('没有可批量出售的物品')
    return
  }
  const selectedList = Array.from(selectedForBatch.value)
  if (selectedList.length === 0) {
    toastStore.warning('请先选择要出售的物品')
    return
  }

  const itemsToSell = originalItems.value
    .filter((it: any) => selectedList.includes(itemKey(it)))

  let totalGold = 0
  let totalGoldBean = 0
  for (const it of itemsToSell) {
    const item = filteredItems.value.find((f: any) => itemKey(f) === itemKey(it))
    if (item) {
      const price = Number(item.price) || 0
      const count = Number(it.count) || 0
      const priceId = Number(item.priceId) || 0
      if (priceId === 1005) {
        totalGoldBean += price * count
      }
      else {
        totalGold += price * count
      }
    }
  }

  const messages = [
    `确定要批量出售选中的 ${selectedList.length} 种物品吗?`,
  ]
  if (totalGold > 0) {
    messages.push(`金币：${totalGold}`)
  }
  if (totalGoldBean > 0) {
    messages.push(`金豆豆：${totalGoldBean}`)
  }

  confirmModal.value = {
    show: true,
    title: '批量出售',
    message: messages.join('\n'),
    type: 'danger',
    loading: false,
    action: 'batchSell',
    item: null,
    useCount: 1,
    selectedItems: itemsToSell,
  }
}

function handleBatchLockClick(locked: boolean) {
  const selectedList = Array.from(selectedForBatch.value)
  if (selectedList.length === 0) {
    toastStore.warning(`请先选择要${locked ? '锁定' : '解锁'}的物品`)
    return
  }
  const selectedItems = filteredItems.value.filter((item: any) => (
    selectedList.includes(itemKey(item)) && (locked ? canLock(item) : canUnlock(item))
  ))
  if (selectedItems.length === 0) {
    toastStore.warning(`没有可${locked ? '锁定' : '解锁'}的物品`)
    return
  }
  confirmModal.value = {
    show: true,
    title: `批量${locked ? '锁定' : '解锁'}`,
    message: `确定要${locked ? '锁定' : '解锁'}选中的 ${selectedItems.length} 种物品吗?`,
    type: 'primary',
    loading: false,
    action: locked ? 'batchLock' : 'batchUnlock',
    item: null,
    useCount: 1,
    selectedItems,
  }
}

async function handleBatchUseClick() {
  const selectedList = Array.from(selectedForBatch.value)
  if (selectedList.length === 0) {
    toastStore.warning('请先选择要使用的物品')
    return
  }
  const selectedItems = filteredItems.value.filter((item: any) => (
    selectedList.includes(itemKey(item)) && canBatchUse(item)
  ))
  if (selectedItems.length === 0) {
    toastStore.warning('没有可使用的物品')
    return
  }

  const dogFoodItems = selectedItems.filter(isDogFood)
  if (dogFoodItems.length) {
    const accountId = String(currentAccountId.value || '')
    const hasCurrentSnapshot = petStore.accountId === accountId && !!petSnapshot.value
    const loaded = hasCurrentSnapshot || await petStore.fetchPetInfo(accountId)
    if (!loaded || !petSnapshot.value) {
      toastStore.error(petError.value || '读取宠物看护时间失败')
      return
    }
    if (!activeDog.value) {
      toastStore.warning('请先在宠物页选择一只已获得的宠物上场')
      return
    }
    if (dogFoodItems.some(item => dogFoodMaxUseCount(item) <= 0)) {
      toastStore.warning('当前看护时间已接近 30 天上限，无法使用所选狗粮')
      return
    }
  }

  const totalCount = selectedItems.reduce((sum: number, item: any) => {
    const count = isDogFood(item) ? dogFoodMaxUseCount(item) : Number(item.count || 0)
    return sum + Math.max(0, Math.trunc(count))
  }, 0)
  confirmModal.value = {
    show: true,
    title: '批量使用',
    message: `确定逐项使用选中的 ${selectedItems.length} 种物品吗？共使用最多 ${totalCount} 个；狗粮受 30 天看护时长上限限制。`,
    type: 'primary',
    loading: false,
    action: 'batchUse',
    item: null,
    useCount: 1,
    selectedItems,
  }
}

const planting = ref(false)
const farmStore = useFarmStore()

async function plantEmptyLands() {
  const accountId = currentAccountId.value
  if (!accountId || planting.value || !isConnected.value) return
  planting.value = true
  try {
    const result = await farmStore.operate(accountId, 'plant_empty')
    if (accountId === currentAccountId.value) {
      if (result?.hadWork) toastStore.success(`已种植 ${result.counts.plant} 块土地`)
      else toastStore.info('当前没有可按策略种植的空地')
      await bagStore.fetchBag(accountId)
    }
  }
  catch (error) {
    if (accountId === currentAccountId.value)
      toastStore.error(getApiErrorMessage(error, '种植失败'))
  }
  finally {
    planting.value = false
  }
}

function handleBatchActionClick() {
  if (batchAction.value === 'sell')
    handleBatchSellClick()
  else if (batchAction.value === 'lock')
    handleBatchLockClick(true)
  else if (batchAction.value === 'unlock')
    handleBatchLockClick(false)
  else if (batchAction.value === 'use')
    void handleBatchUseClick()
}

async function loadBag() {
  const accountId = currentAccountId.value
  if (!accountId)
    return
  if (!realtimeConnected.value)
    await statusStore.fetchStatus(accountId)
  if (accountId === currentAccountId.value && isConnected.value) {
    imageErrors.value = {}
    await bagStore.fetchBag(accountId)
  }
}

/** 只有用户点击刷新才让图标转圈；动作后的自动重载和 60 秒轮询不碰按钮，避免刷新图标闪烁。 */
const manualRefreshing = ref(false)

async function refreshBagOnDemand() {
  if (manualRefreshing.value)
    return

  manualRefreshing.value = true
  try {
    await loadBag()
  }
  finally {
    manualRefreshing.value = false
  }
}

function loadStatusIfNeeded() {
  const id = currentAccountId.value
  if (id && !realtimeConnected.value)
    void statusStore.fetchStatus(id)
}

onMounted(loadStatusIfNeeded)

watch(currentAccountId, () => {
  bagStore.clearBag()
  multiSelectEnabled.value = false
  batchAction.value = null
  selectedForBatch.value.clear()
  loadStatusIfNeeded()
})

// 首次确认在线或重连时直接读背包，不等轮询。
watch([currentAccountId, presence], ([id, next]) => {
  if (next === 'online') {
    imageErrors.value = {}
    void bagStore.fetchBag(id)
  }
}, { immediate: true })

// 筛选结果变化时重置批量选择，避免被搜索隐藏的物品仍留在已选集合里被一并处理。
watch([selectedCategory, searchKeyword], () => {
  selectedForBatch.value.clear()
  batchAction.value = multiSelectEnabled.value ? (batchAction.value || 'sell') : null
  if (multiSelectEnabled.value)
    selectAllEligible()
})

useIntervalFn(loadBag, 60000)
</script>

<template>
  <div class="panel-fill">
    <!-- 标题栏始终渲染，离线/出错只替换下方内容，与任务页、宠物页一致 -->
    <div class="min-w-0 flex flex-col bag-panel-card page-card-surface rounded-2xl panel-scroll-layout margin-shell"><span class="margin-content">
      <div class="bag-toolbar panel-titlebar shrink-0 margin-shell"><span class="margin-content">
        <BaseInput v-model="searchKeyword" type="search" clearable placeholder="输入名称搜索" />
        <BaseSelect v-model="selectedCategory" :options="CATEGORY_OPTIONS" fit-width aria-label="背包分类" />
        <div class="page-toolbar__actions bag-toolbar__actions">
          <NButton
            class="panel-multiselect-toggle"
            size="medium"
            :type="multiSelectEnabled ? 'default' : 'primary'"
            :secondary="!multiSelectEnabled"
            :disabled="!isConnected"
            :aria-label="multiSelectEnabled ? '取消' : '多选'"
            :title="multiSelectEnabled ? '取消' : '多选'"
            @click="toggleMultiSelect"
          >
            <span class="i-carbon-checkbox-checked" />
            <span class="panel-multiselect-toggle__label">{{ multiSelectEnabled ? '取消' : '多选' }}</span>
          </NButton>
          <RefreshButton
            title="刷新背包"
            size="medium"
            :loading="manualRefreshing"
            :disabled="!isConnected"
            @click="refreshBagOnDemand"
          />
        </div>
      </span></div>

      <div class="panel-scroll-body">
        <EmptyState v-if="!currentAccountId" bare title="请先选择账号" icon="i-carbon-user-avatar" />
        <OfflineState v-else-if="isOffline" />
        <div v-else-if="statusError && !statusLoading" class="bag-status-error" role="alert">
          <div class="mb-2 text-lg font-bold">
            获取数据失败
          </div>
          <div class="text-sm">
            {{ statusError }}
          </div>
          <NButton secondary @click="refreshBagOnDemand">
            重新读取
          </NButton>
        </div>

      <div v-else-if="bagLoading || statusLoading || presence === 'unknown'" class="flex justify-center py-12">
        <span class="i-carbon-circle-dash animate-spin text-4xl" />
      </div>

      <div v-else-if="items.length === 0 && !multiSelectEnabled" class="page-card-surface rounded-xl text-center text-gray-500 margin-shell"><span class="margin-content !m-8">
        无可展示物品
      </span></div>

      <template v-else>
        <div v-if="multiSelectEnabled" class="farm-selection-setup">
          <div class="farm-selection-row">
            <div class="farm-mode-switch" role="group" aria-label="多选操作类型">
              <button type="button" :aria-pressed="batchAction === 'use'" @click="toggleBatchMode('use')">
                <span class="i-carbon-play" aria-hidden="true" />使用</button>
              <button type="button" :aria-pressed="batchAction === 'plant'" @click="toggleBatchMode('plant')">
                <span class="i-carbon-sprout" aria-hidden="true" />种植
              </button>
              <button type="button" :aria-pressed="batchAction === 'lock'" @click="toggleBatchMode('lock')">
                <span class="i-carbon-locked" aria-hidden="true" />锁定</button>
              <button type="button" :aria-pressed="batchAction === 'unlock'" @click="toggleBatchMode('unlock')">
                <span class="i-carbon-unlocked" aria-hidden="true" />解锁</button>
              <button type="button" :aria-pressed="batchAction === 'sell'" @click="toggleBatchMode('sell')">
                <span class="i-carbon-shopping-cart-arrow-down" aria-hidden="true" />出售</button>
            </div>
            <NButton v-if="batchAction === 'plant'" type="primary" :loading="planting" @click="plantEmptyLands">
              按策略种植空地
            </NButton>
            <div v-else-if="batchMode" class="farm-selectbar" role="toolbar" aria-label="所选物品操作">
              <div class="farm-selectbar__info" role="status" aria-live="polite">
                <span>已选 <b>{{ selectedBatchCount }}/{{ batchEligibleCount }}</b></span>
                <span class="farm-selectbar__links">
                  <button type="button" @click="selectAllEligible">全选</button>
                  <button type="button" @click="selectedForBatch.clear()">清空</button>
                </span>
              </div>
              <NButton
                :type="batchAction === 'sell' ? 'error' : 'primary'"
                :disabled="selectedBatchCount === 0"
                @click="handleBatchActionClick"
              >
                <span v-if="batchAction === 'sell'" class="i-carbon-shopping-cart-arrow-down" />
                <span v-else-if="batchAction === 'lock'" class="i-carbon-locked" />
                <span v-else-if="batchAction === 'unlock'" class="i-carbon-unlocked" />
                <span v-else class="i-carbon-play" />
                {{ batchActionLabel }}
              </NButton>
            </div>
          </div>
        </div>

        <div :key="selectedCategory" role="region" aria-label="背包物品列表" tabindex="0">
          <EmptyState v-if="!filteredItems.length" bare :title="searchKeyword.trim() ? '没有匹配的物品' : '这个分类暂无物品'" icon="i-carbon-box" />
          <div v-else class="bag-grid" :class="{ 'is-selecting': batchMode }">
            <article
              v-for="item in filteredItems"
              :key="itemKey(item)"
              class="bag-item page-card-surface margin-shell"
              :class="batchMode ? {
                'bag-item--selectable': isBatchEligible(item),
                'bag-item--selected': selectedForBatch.has(itemKey(item)),
                'bag-item--disabled': !isBatchEligible(item),
              } : null"
              :role="batchMode && isBatchEligible(item) ? 'checkbox' : undefined"
              :aria-checked="batchMode && isBatchEligible(item) ? selectedForBatch.has(itemKey(item)) : undefined"
              @click="batchMode && toggleBatchSelection(item)"
            ><span class="margin-content">
              <!-- 右上角仅显示可选项的选择状态。 -->
              <template v-if="batchMode">
                <span
                  v-if="isBatchEligible(item)"
                  class="bag-check bag-item__cue"
                  :class="{ 'is-checked': selectedForBatch.has(itemKey(item)) }"
                  aria-hidden="true"
                >
                  <span v-if="selectedForBatch.has(itemKey(item))" class="i-carbon-checkmark" />
                </span>
              </template>

              <!-- 数量以角标形式贴在图标右下角，与游戏背包的习惯一致 -->
              <div class="bag-item__thumb thumb-wrap" :data-fallback="(item.name || '物').slice(0, 1)">
                <img
                  v-if="item.image && !imageErrors[itemKey(item)]"
                  :src="item.image"
                  :alt="item.name"
                  loading="lazy"
                  @error="imageErrors[itemKey(item)] = true"
                >
                <span v-else class="bag-item__fallback">{{ (item.name || '物').slice(0, 1) }}</span>
                <span v-if="item.locked" class="bag-item__lock" title="已锁定"><span class="i-carbon-locked" /></span>
              </div>

              <span class="bag-item__name" :title="item.name">{{ item.name || `物品${item.id}` }}</span>

              <div class="bag-item__meta">
                <span class="bag-type" :class="`bag-type--${getItemCategory(item)}`">{{ CATEGORY_SHORT_LABELS[getItemCategory(item)] }}</span>
                <span v-if="item.price > 0" :class="getPriceClass(item)" title="单价">{{ item.price }}{{ item.priceUnit || '金' }}</span>
                <span
                  v-if="getSellStatusText(item)"
                  :class="{ 'is-locked': item.locked }"
                  :title="item.sellCondition || ''"
                >{{ getSellStatusText(item) }}</span>
              </div>
              <div v-if="mutantTypeLabel(item)" class="bag-item__line" :title="`变异类型：${mutantTypeLabel(item)}`">
                变异 · {{ mutantTypeLabel(item) }}
              </div>

              <!-- 每张卡都有底栏：左侧操作，右侧数量。卡片结构一致，因此等高；数量不再压在图标上。 -->
              <footer class="bag-item__foot divider-top margin-shell"><span class="margin-content">
                <span v-if="!batchMode && itemActions(item).length" class="bag-item__ops" @click.stop>
                  <NButton
                    size="tiny"
                    class="bag-item__action-tiny"
                    :type="itemActions(item)[0]!.key === 'use' ? 'primary' : 'default'"
                    secondary
                    :title="itemActions(item)[0]!.title"
                    @click="runItemAction(itemActions(item)[0]!.key, item)"
                  >
                    {{ itemActions(item)[0]!.label }}
                  </NButton>
                  <NDropdown
                    v-if="itemActions(item).length > 1"
                    trigger="click"
                    placement="bottom-start"
                    :options="itemActions(item).slice(1).map(action => ({ key: action.key, label: action.label }))"
                    @select="(key: ItemActionKey) => runItemAction(key, item)"
                  >
                    <NButton size="tiny" quaternary circle title="更多操作" aria-label="更多操作">
                      <template #icon>
                        <span class="i-carbon-overflow-menu-horizontal" />
                      </template>
                    </NButton>
                  </NDropdown>
                </span>
                <span class="bag-item__qty" :class="{ 'is-hours': !!item.hoursText }" :title="item.hoursText ? `剩余 ${item.hoursText}` : `数量 ${formatNumber(item.count)}`">
                  <template v-if="item.hoursText">{{ item.hoursText }}</template>
                  <template v-else>×{{ formatNumber(item.count) }}</template>
                </span>
              </span></footer>
            </span></article>
          </div>
        </div>
      </template>
      </div>
    </span></div>

    <ConfirmModal
      :show="confirmModal.show"
      :title="confirmModal.title"
      :message="confirmModal.message"
      :type="confirmModal.type"
      :loading="confirmModal.loading"
      :confirm-text="confirmButtonText"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    >
      <div v-if="confirmModal.action === 'use' && confirmModal.item" class="use-quantity-hint">
        <template v-if="isDogFood(confirmModal.item)">
          <span>受 30 天上限影响，本次最多可喂食</span>
          <strong>{{ maxUseCount }}</strong>
          <span>个</span>
        </template>
        <template v-else>
          <span>当前拥有</span>
          <strong>{{ maxUseCount }}</strong>
          <span>个，请选择本次使用数量</span>
        </template>
      </div>
      <div v-if="confirmModal.action === 'use' && confirmModal.item" class="use-quantity">
        <span>使用数量</span>
        <div class="use-stepper">
          <NInputNumber
            :value="confirmModal.useCount"
            :min="1"
            :max="maxUseCount"
            :disabled="confirmModal.loading"
            @update:value="value => setUseCount(value ?? 1)"
          />
          <NButton size="small" :disabled="confirmModal.loading || confirmModal.useCount >= maxUseCount" @click="setUseCount(maxUseCount)">
            全部
          </NButton>
        </div>
      </div>
    </ConfirmModal>

    <ConfirmModal
      :show="viewModal.show"
      title="香囊寄语"
      :message="viewDescription(viewModal.item)"
      confirm-text="关闭"
      is-alert
      @confirm="closeViewModal"
      @cancel="closeViewModal"
    >
      <div v-if="viewModal.item?.sourceInfo" class="sachet-detail">
        <div class="sachet-detail__row">
          <span>赠送人</span>
          <strong>{{ viewModal.item.sourceInfo.senderName || '未知好友' }}</strong>
        </div>
        <div class="sachet-detail__row">
          <span>赠送时间</span>
          <strong>{{ formatSentAt(viewModal.item.sourceInfo.sentAt) }}</strong>
        </div>
        <div class="sachet-detail__message">
          <span>好友寄语</span>
          <strong>{{ sachetMessage(viewModal.item.sourceInfo.messageTextId) }}</strong>
        </div>
      </div>
    </ConfirmModal>
  </div>
</template>

<style scoped>
.bag-grid {
  display: grid;
  /* 最窄布局（内容区 780px，卡片内宽约 746px）下正好放下 6 列：6 × 112 + 5 × 12 = 732；窗口更宽时自动增列 */
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  align-items: start;
  gap: 12px;
}

/* 物品卡片：图标 + 数量角标为视觉焦点，其余信息依次减弱。 */
.bag-item {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  --bag-item-gap: 4px;
  gap: var(--bag-item-gap);
  --inset-top: 12px; --inset-right: 8px; --inset-bottom: var(--ui-card-content-bottom-margin); --inset-left: 8px;
  text-align: center;
  background: transparent !important;
  transition:
    opacity 0.15s ease;
}

.bag-item__cue {
  position: absolute;
  top: 8px;
  right: 8px;
}

.bag-item__thumb {
  position: relative;
  width: 46px;
  height: 46px;
  display: grid;
  margin-bottom: 8px;
  place-items: center;
  border-radius: 16px;
}

.bag-item__thumb img {
  max-width: 46px;
  max-height: 46px;
  object-fit: contain;
}

.bag-item__fallback {
  color: var(--ui-subtle);
  font-size: var(--ui-font-size-large-15);
  font-weight: var(--fw-700);
}

/* 底栏：操作在左，数量靠右；无操作或多选模式下数量同样靠右。 */
.bag-item__foot {
  display: flex;
  width: 100%;
  min-height: 30px;
  align-items: center;
  gap: 4px;
  margin-top: calc(var(--ui-content-vertical-gap) - var(--bag-item-gap));
  --inset-top: 8px;
}

.bag-item__qty {
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  color: var(--ui-ink);
  font-size: var(--ui-font-size-small-13);
  font-weight: var(--fw-400);
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.bag-item__qty.is-hours {
  color: var(--ui-blue);
  font-size: var(--ui-font-size-small-13);
}

.bag-item__ops {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 2px;
}

.bag-item__lock {
  position: absolute;
  top: -6px;
  left: -6px;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  color: #fff;
  background: var(--ui-warning-fill);
  box-shadow: 0 0 0 2px var(--ui-surface-strong);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.bag-item__name {
  width: 100%;
  overflow: hidden;
  color: var(--ui-ink);
  font-size: var(--ui-font-size-small-13);
  font-weight: var(--fw-400);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bag-item__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px 8px;
  color: var(--ui-muted);
  line-height: 18px;
}

.bag-item__meta .is-locked {
  color: var(--ui-warning);
  font-weight: var(--fw-600);
}

.bag-type {
  padding: 0 6px;
  border-radius: 5px;
  font-weight: var(--fw-600);
}

.bag-type--fruit {
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
}

.bag-type--mutant {
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
}

.bag-type--seed {
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

.bag-type--tool {
  color: var(--ui-blue);
  background: var(--ui-blue-soft);
}

.bag-item__line {
  max-width: 100%;
  overflow: hidden;
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bag-panel-card {
  --bag-panel-pad: 16px;
  --inset-top: var(--bag-panel-pad); --inset-right: var(--bag-panel-pad); --inset-bottom: var(--bag-panel-pad); --inset-left: var(--bag-panel-pad);
}

.bag-grid.is-selecting {
  padding-bottom: 8px;
}

.farm-selection-setup {
  display: grid;
  gap: 12px;
  margin-bottom: 12px;
}

.farm-selection-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.farm-mode-switch {
  display: flex;
  width: fit-content;
  max-width: 100%;
  min-width: 0;
  flex: 0 1 auto;
  flex-wrap: wrap;
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-surface-soft);
}

.farm-mode-switch button {
  display: inline-flex;
  width: 76px;
  min-width: 0;
  flex: 0 0 76px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 6px;
  border-radius: 9px;
  color: var(--ui-muted);
  font-size: var(--ui-font-size-small-13);
  line-height: 18px;
  white-space: nowrap;
}

.farm-mode-switch button[aria-pressed='true'] {
  color: var(--ui-primary);
  background: var(--ui-surface-strong);
  box-shadow: 0 1px 4px rgba(32, 58, 43, 0.08);
  font-weight: var(--fw-650);
}

.farm-mode-switch button:focus-visible,
.farm-selectbar__links button:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.farm-selectbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
  margin-left: auto;
}

.farm-selectbar__info {
  display: flex;
  min-width: 0;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--ui-muted);
  font-size: var(--ui-font-size-small-13);
  white-space: nowrap;
}

.farm-selectbar__info b {
  color: var(--ui-ink);
  font-weight: var(--fw-700);
  font-variant-numeric: tabular-nums;
}

.farm-selectbar__links {
  display: inline-flex;
  flex: none;
  gap: 14px;
}

.farm-selectbar__links button {
  color: var(--ui-primary);
  font-size: var(--ui-content-item-font-height-tiny-12);
  transition:
    transform 120ms ease,
    color 120ms ease;
}

.farm-selectbar__links button:active {
  transform: scale(0.92);
}

.farm-mode-switch button:disabled,
.farm-selectbar__links button:disabled {
  color: var(--ui-subtle);
  cursor: not-allowed;
}

.farm-selectbar :deep(.n-button) {
  min-width: 64px;
  height: var(--ui-content-item-control-height-30);
  flex: none;
  border-radius: 10px;
}

/* 格式走全局 .panel-titlebar：左侧搜索与分类筛选（同图鉴「道具」页），
   按钮组走全局 .page-toolbar__actions 推到最右（与宠物页一致），刷新键排在最后。 */
.bag-toolbar {
  flex-wrap: nowrap;
}

/* 标题栏下方留白：原先由分类按钮行撑开，现在由紧邻的内容块自己补上。 */
.bag-toolbar + * {
  margin-top: 16px;
}

.bag-toolbar + .panel-scroll-body:has(> .offline-state) {
  margin-top: 0;
}

.bag-toolbar__actions {
  flex: none;
  flex-wrap: nowrap;
}

.bag-status-error {
  padding: 32px;
  border: 2px solid rgba(239, 68, 68, 0.2);
  border-radius: 12px;
  color: rgb(239, 68, 68);
  background: rgba(239, 68, 68, 0.06);
  text-align: center;
}

.bag-toolbar__actions :deep(.n-button) {
  width: auto;
  flex: 0 0 auto;
}

.bag-toolbar__actions :deep(.n-button__content) {
  gap: 4px;
  white-space: nowrap;
}

@container (max-width: 700px) {
  /* 刷新键只负责收起文案，图标等距、宽度由全局 .panel-refresh 模板算 */
  .bag-toolbar__actions {
    --refresh-label: none;
  }
}

/* 批量选择：选中用 outline，避免被卡片的全局阴影覆盖。 */
.bag-item--selectable {
  cursor: pointer;
}

.bag-item--selectable:hover {
  outline: 1px solid color-mix(in srgb, var(--ui-primary) 45%, transparent);
}

.bag-item--selected,
.bag-item--selected:hover {
  outline: 2px solid var(--ui-primary);
  outline-offset: -1px;
}

.bag-item--disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* 多选勾选框全站统一：16px 圆形（对齐「作物图鉴」图标右上角的 .book-tile__check）。 */
.bag-check {
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  border: 1.5px solid var(--ui-border-strong);
  border-radius: 50%;
  color: #fff;
  background: var(--ui-surface-strong);
  font-size: var(--ui-content-item-font-height-tiny-12);
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.bag-check.is-checked {
  border-color: var(--ui-primary);
  background: var(--ui-primary-fill);
}

.thumb-wrap.fallback img {
  display: none;
}

.thumb-wrap.fallback::after {
  content: attr(data-fallback);
  font-size: 1.5rem;
  font-weight: var(--fw-700);
  color: #9ca3af;
  text-transform: uppercase;
}

.use-quantity {
  margin: 1rem 0 1.5rem;
  padding: 14px;
  border: 1px solid var(--n-border-color);
  border-radius: 8px;
  background: var(--n-color);
}

.use-quantity-hint {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
  margin: 0.9rem 0 0;
  color: var(--n-text-color-2);
  font-size: var(--ui-font-size-small-13);
  line-height: 1.5;
  text-align: center;
}

.use-quantity-hint strong {
  color: var(--theme-primary, #438d63);
  font-size: var(--ui-font-size-large-15);
  line-height: 1;
}

.use-quantity > span {
  display: block;
  margin-bottom: 8px;
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-700);
}

.use-stepper {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.sachet-detail {
  display: grid;
  gap: 10px;
  margin: 0.75rem 0 1.25rem;
}

.sachet-detail__row {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  align-items: baseline;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--n-border-color);
}

.sachet-detail__row span,
.sachet-detail__message span {
  color: var(--n-text-color-3);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-700);
}

.sachet-detail__row strong {
  min-width: 0;
  overflow-wrap: anywhere;
}

.sachet-detail__message {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--theme-primary, #3b82f6) 28%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--theme-primary, #3b82f6) 7%, var(--n-color));
}

.sachet-detail__message strong {
  color: var(--n-text-color);
  font-size: var(--ui-font-size-large-15);
  line-height: 1.55;
}
</style>

<style scoped>
/* 分割线贴齐卡片边缘，底栏内容仍与卡片正文对齐。 */
.bag-item__foot {
  width: calc(100% + 16px);
  margin-inline: -8px;
  --inset-left: 8px;
  --inset-right: 8px;
}
</style>

<style scoped>
.bag-item :deep(*) { font-weight: var(--fw-400) !important; }
</style>
