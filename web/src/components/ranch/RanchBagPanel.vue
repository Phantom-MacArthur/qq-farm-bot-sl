<script setup lang="ts">
import type { RanchItem } from '@/stores/ranch'
import { NButton } from 'naive-ui/es/button'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { formatCount, formatDuration, useRanchActions, useRanchLoader } from '@/components/ranch/ranch-shared'
import RanchAmountDialog from '@/components/ranch/RanchAmountDialog.vue'
import RanchGate from '@/components/ranch/RanchGate.vue'
import BagItemCard from '@/components/ui/BagItemCard.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { useAccountStore } from '@/stores/account'
import { useRanchStore } from '@/stores/ranch'

/** 幼崽按适用设施分成窝、棚两类，窝在前，不混在一起。 */
type Category = 'all' | 'product' | 'coop' | 'shed' | 'can' | 'other'
const CATEGORIES: Array<{ value: Category, label: string, icon: string }> = [
  { value: 'all', label: '全部', icon: 'i-carbon-list-boxes' },
  { value: 'product', label: '产物', icon: 'i-carbon-wheat' },
  { value: 'coop', label: '窝幼崽', icon: 'i-carbon-home' },
  { value: 'shed', label: '棚幼崽', icon: 'i-carbon-building' },
  { value: 'can', label: '罐头', icon: 'i-carbon-flash' },
  { value: 'other', label: '其他', icon: 'i-carbon-box' },
]
const CATEGORY_APPEARANCE = {
  product: { categoryLabel: '产物', categoryTone: 'danger' },
  coop: { categoryLabel: '窝幼崽', categoryTone: 'primary' },
  shed: { categoryLabel: '棚幼崽', categoryTone: 'warning' },
  can: { categoryLabel: '罐头', categoryTone: 'blue' },
  other: { categoryLabel: '道具', categoryTone: 'neutral' },
} as const
const RANK: Record<Exclude<Category, 'all'>, number> = { product: 0, coop: 1, shed: 2, can: 3, other: 4 }
/** 设施类型：窝 6、棚 7，放养时只列出适用的设施。 */
const PEN_TYPE: Record<string, number> = { 窝: 6, 棚: 7 }

const { state, loading } = storeToRefs(useRanchStore())
const { currentAccountId } = storeToRefs(useAccountStore())
const { refresh } = useRanchLoader('bag')
const { disabled, request } = useRanchActions()

const items = computed<any[]>(() => state.value?.bag || [])
const pens = computed<any[]>(() => (state.value?.facilities || []).filter((f: any) => f.ranch && f.state !== 2))
const category = ref<Category>('all')
const failed = ref<Record<string, boolean>>({})

function categoryOf(item: any): Exclude<Category, 'all'> {
  if (item.can)
    return 'can'
  if (item.animalId)
    return item.husbandryType === '棚' ? 'shed' : 'coop'
  if (item.product || [106, 107].includes(Number(item.type)))
    return 'product'
  return 'other'
}
const counts = computed(() => {
  const result: Record<Category, number> = { all: items.value.length, product: 0, coop: 0, shed: 0, can: 0, other: 0 }
  for (const item of items.value)
    result[categoryOf(item)]++
  return result
})
/** 服务器返回的顺序不固定：按分类排列，幼崽高等级在前，其余按编号，刷新后位置不变。 */
const sorted = computed(() => [...items.value].sort((a, b) => RANK[categoryOf(a)] - RANK[categoryOf(b)]
  || (Number(b.animalId) || 0) - (Number(a.animalId) || 0)
  || Number(a.id) - Number(b.id)
  || String(a.uid).localeCompare(String(b.uid))))
const keyword = ref('')
const categoryOptions = computed(() => CATEGORIES.map(cat => ({ value: cat.value, label: `${cat.label} (${counts.value[cat.value]})` })))
const filtered = computed(() => sorted.value.filter(item =>
  (category.value === 'all' || categoryOf(item) === category.value)
  && String(item.name || '').toLowerCase().includes(keyword.value.trim().toLowerCase()),
))
const batchActions = [
  { key: 'useCan', label: '使用', submit: '使用选中' },
  { key: 'place', label: '放养', submit: '放养选中' },
  { key: 'lockBag', label: '锁定', submit: '锁定选中' },
  { key: 'unlockBag', label: '解锁', submit: '解锁选中' },
  { key: 'sell', label: '出售', submit: '出售选中' },
] as const
type BatchAction = typeof batchActions[number]['key']
const batchAction = ref<BatchAction | null>(null)
const selected = ref<string[]>([])
function eligible(item: any) {
  if (batchAction.value === 'unlockBag') return !!item.locked
  if (item.locked) return false
  if (batchAction.value === 'useCan') return !!item.can
  if (batchAction.value === 'place') return !!item.animalId
  if (batchAction.value === 'sell') return !!item.canSell
  return batchAction.value === 'lockBag'
}
const eligibleUids = computed(() => filtered.value.filter(eligible).map(item => String(item.uid)))
watch([category, keyword, batchAction], () => { selected.value = [] })
watch(eligibleUids, ids => { selected.value = selected.value.filter(id => ids.includes(id)) })
function toggleItem(item: any) {
  if (!batchAction.value || !eligible(item) || disabled.value) return
  const uid = String(item.uid)
  selected.value = selected.value.includes(uid) ? selected.value.filter(id => id !== uid)
    : selected.value.length < 50 ? [...selected.value, uid] : selected.value
}
function submitBatch() {
  if (batchAction.value && selected.value.length)
    void request('bagBatch', { operation: batchAction.value, uids: [...selected.value] })
}

interface BagAction {
  key: 'useCan' | 'place' | 'sell'
  label: string
  title: string
  submit: string
  primary?: boolean
}

function actionsFor(item: any): BagAction[] {
  if (item.locked)
    return []
  const actions: BagAction[] = []
  if (item.can)
    actions.push({ key: 'useCan', label: '添加', title: '添加到罐头桶', submit: '添加到罐头桶', primary: true })
  else if (item.animalId)
    actions.push({ key: 'place', label: '放养', title: `放养${item.name}`, submit: '放养', primary: true })
  if (item.canSell)
    actions.push({ key: 'sell', label: '出售', title: `出售${item.name}`, submit: '下一步' })
  return actions
}

const active = ref<{ item: any, action: BagAction } | null>(null)
watch(currentAccountId, () => {
  batchAction.value = null
  selected.value = []
  active.value = null
})
const destination = ref<string>('')
const activeAction = computed(() => active.value?.action)
const activeItem = computed(() => active.value?.item)
const activeMax = computed(() => {
  const item = activeItem.value
  if (!item)
    return 1
  const owned = Math.min(2147483647, Number(item.count) || 1)
  if (activeAction.value?.key !== 'place')
    return owned
  const pen = pens.value.find(f => f.id === destination.value)
  return pen ? Math.max(1, Math.min(owned, pen.ranch.capacity - pen.ranch.count)) : owned
})
const penOptions = computed(() => pens.value.filter(f => !activeItem.value?.husbandryType || Number(f.moduleType) === PEN_TYPE[activeItem.value.husbandryType]).map(f => ({
  label: `${f.name}（${f.ranch.count} / ${f.ranch.capacity}）`,
  value: f.id,
  disabled: f.ranch.count >= f.ranch.capacity,
})))

function open(item: any, action: BagAction) {
  active.value = { item, action }
  destination.value = penOptions.value.find(option => !option.disabled)?.value || ''
}
function submit(count: number) {
  const selection = active.value
  active.value = null
  if (selection) {
    const { item, action } = selection
    void request(action.key, { uid: item.uid, itemId: item.id, ranchId: action.key === 'place' ? destination.value : undefined, count })
  }
}
function caption(item: any) {
  if (!item)
    return ''
  if (item.can?.speed_up_secs)
    return `每个可加速 ${formatDuration(item.can.speed_up_secs)} · 库存 ${formatCount(item.count)}`
  const prices = item.sellPrices?.map((price: RanchItem) => `${formatCount(price.count)} ${price.name}`).join(' + ')
  return prices ? `单价 ${prices} · 库存 ${formatCount(item.count)}` : `库存 ${formatCount(item.count)}`
}
watch(category, () => {
  failed.value = {}
})
</script>

<template>
  <section class="panel-fill page-card-surface panel-scroll-layout ranch-bag">
    <header class="panel-titlebar panel-titlebar--flush shrink-0">
      <div class="bag-toolbar">
        <BaseInput v-model="keyword" type="search" clearable placeholder="输入名称搜索" />
        <BaseSelect v-model="category" :options="categoryOptions" fit-width aria-label="背包分类" />
        <div class="page-toolbar__actions">
          <NButton secondary class="panel-multiselect-toggle" :disabled="disabled" @click="batchAction = batchAction ? null : 'useCan'">
            <span class="i-carbon-checkbox-checked" aria-hidden="true" />
            <span class="panel-multiselect-toggle__label">{{ batchAction ? '取消' : '多选' }}</span>
          </NButton>
          <RefreshButton title="刷新背包" :loading="loading" @click="refresh" />
        </div>
      </div>
    </header>
    <div class="panel-scroll-body">
      <RanchGate @retry="refresh">
        <div v-if="batchAction" class="bag-batch">
          <div class="farm-mode-switch" role="group" aria-label="多选操作类型">
            <button v-for="action in batchActions" :key="action.key" type="button" :aria-pressed="batchAction === action.key" @click="batchAction = action.key">
              {{ action.label }}
            </button>
          </div>
          <div class="farm-selectbar">
            <span aria-live="polite">已选 {{ selected.length }}/{{ eligibleUids.length }}（每批最多 50 项）</span>
            <span v-if="batchAction === 'useCan' || batchAction === 'place'">每个选中批次处理 1 件</span>
            <span class="farm-selectbar__links">
              <button type="button" @click="selected = eligibleUids.slice(0, 50)">全选</button>
              <button type="button" @click="selected = []">清空</button>
            </span>
            <NButton v-if="selected.length" :type="batchAction === 'sell' ? 'error' : 'primary'" :disabled="disabled" @click="submitBatch">
              {{ batchActions.find(action => action.key === batchAction)?.submit }}
            </NButton>
          </div>
        </div>
        <EmptyState v-if="!filtered.length" bare title="这个分类暂无物品" icon="i-carbon-box" />
        <div v-else class="bag-item-grid" role="region" aria-label="牧场背包物品列表">
          <BagItemCard
            v-for="item in filtered"
            :key="item.uid"
            v-bind="CATEGORY_APPEARANCE[categoryOf(item)]"
            :name="item.name || `物品${item.id}`"
            :image="item.image"
            :image-failed="failed[item.uid]"
            :locked="item.locked"
            :quantity="formatCount(item.count)"
            :actions="actionsFor(item)"
            :actions-disabled="disabled"
            :selecting="!!batchAction"
            :selectable="eligible(item)"
            :selection-disabled="disabled || (selected.length >= 50 && !selected.includes(String(item.uid)))"
            :selected="selected.includes(String(item.uid))"
            @action="open(item, $event)"
            @toggle="toggleItem(item)"
            @image-error="failed[item.uid] = true"
          >
            <template #meta>
              <span v-if="item.giantCub" class="is-giant">巨大</span>
              <span v-if="item.product?.weightX10" title="重量">{{ (item.product.weightX10 / 100).toFixed(2).replace(/\.?0+$/, '') }}kg</span>
              <span v-if="item.sellPrices?.[0]" title="单价">{{ formatCount(item.sellPrices[0].count) }}{{ item.sellPrices[0].name }}</span>
            </template>
          </BagItemCard>
        </div>
      </RanchGate>
    </div>

    <RanchAmountDialog
      :show="!!active"
      :title="activeAction?.title || ''"
      :name="activeItem?.name || ''"
      :image="activeItem?.image"
      :caption="caption(activeItem)"
      :max="activeMax"
      :ready="activeAction?.key !== 'place' || !!destination"
      :submit-text="activeAction?.submit"
      @close="active = null"
      @submit="submit"
    >
      <BaseSelect v-if="activeAction?.key === 'place'" v-model="destination" label="放养到" :options="penOptions" placeholder="选择窝或棚" />
      <p v-if="activeAction?.key === 'place' && !penOptions.some(option => !option.disabled)" class="bag-hint">
        {{ activeItem?.husbandryType || '窝和棚' }}已住满，先收获或升级设施。
      </p>
    </RanchAmountDialog>
  </section>
</template>

<style scoped>
.ranch-bag {
  overflow: clip;
}
.bag-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1;
  min-width: 0;
  margin: 16px;
}
.bag-batch {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px;
}
.bag-item-grid {
  margin: 12px;
}

.is-giant {
  color: var(--ui-warning);
}

.bag-hint {
  margin: 0;
  color: var(--ui-warning);
  font-size: var(--ui-content-item-font-height-tiny-12);
}
</style>
