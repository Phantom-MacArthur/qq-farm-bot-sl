<script setup lang="ts">
import type { RanchItem } from '@/stores/ranch'
import { NButton } from 'naive-ui/es/button'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { formatCount, formatDuration, useRanchActions, useRanchLoader } from '@/components/ranch/ranch-shared'
import RanchAmountDialog from '@/components/ranch/RanchAmountDialog.vue'
import RanchGate from '@/components/ranch/RanchGate.vue'
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
const SHORT: Record<Exclude<Category, 'all'>, string> = { product: '产物', coop: '窝', shed: '棚', can: '罐头', other: '道具' }
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
const batchLockMode = ref(false)
const selectedUids = ref<string[]>([])

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
}

function actionsFor(item: any): BagAction[] {
  if (item.locked)
    return []
  const actions: BagAction[] = []
  if (item.can)
    actions.push({ key: 'useCan', label: '添加', title: '添加到罐头桶', submit: '添加到罐头桶' })
  else if (item.animalId)
    actions.push({ key: 'place', label: '放养', title: `放养${item.name}`, submit: '放养' })
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
  selectedUids.value = []
})
watch(currentAccountId, () => {
  batchLockMode.value = false
  selectedUids.value = []
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
        <div v-else class="bag-grid">
          <article v-for="item in filtered" :key="item.uid" class="bag-item page-card-surface margin-shell" :class="{ 'bag-item--selected': selected.includes(String(item.uid)) }"><span class="margin-content">
            <input v-if="batchAction" class="bag-item__check" type="checkbox" :aria-label="item.name" :disabled="!eligible(item) || disabled || (selected.length >= 50 && !selected.includes(String(item.uid)))" :checked="selected.includes(String(item.uid))" @change="toggleItem(item)">
            <div class="bag-item__thumb">
              <img v-if="item.image && !failed[item.uid]" :src="item.image" :alt="item.name" loading="lazy" @error="failed[item.uid] = true">
              <span v-else class="bag-item__fallback">{{ (item.name || '物').slice(0, 1) }}</span>
              <span v-if="item.locked" class="bag-item__lock" title="已锁定"><span class="i-carbon-locked" /></span>
            </div>
            <strong class="bag-item__name" :title="item.name">{{ item.name }}</strong>
            <div class="bag-item__meta">
              <span class="bag-type" :class="`bag-type--${categoryOf(item)}`">{{ SHORT[categoryOf(item)] }}</span>
              <span v-if="item.giantCub" class="is-giant">巨大</span>
              <span v-if="item.product?.weightX10">{{ (item.product.weightX10 / 100).toFixed(2).replace(/\.?0+$/, '') }}kg</span>
              <span v-if="item.sellPrices?.[0]" title="单价">{{ formatCount(item.sellPrices[0].count) }}{{ item.sellPrices[0].name }}</span>
              <span v-if="item.locked" class="is-locked">已锁定</span>
            </div>
            <footer class="bag-item__foot divider-top margin-shell"><span class="margin-content">
              <span class="bag-item__qty"><small>×</small>{{ formatCount(item.count) }}</span>
              <div v-if="!batchAction" class="bag-item__actions">
                <NButton
                  v-for="action in actionsFor(item)"
                  :key="action.key"
                  attr-type="button"
                  size="tiny"
                  :type="action.key === 'sell' ? 'default' : 'primary'"
                  secondary
                  :disabled="disabled"
                  :aria-label="action.title"
                  :title="action.title"
                  @click="open(item, action)"
                >
                  {{ action.label }}
                </NButton>
              </div>
            </span></footer>
          </span></article>
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
.bag-item__check {
  position: absolute;
  inset: 8px 8px auto auto;
  accent-color: var(--ui-primary);
}
.bag-item--selected {
  outline: 2px solid var(--ui-primary);
  outline-offset: -2px;
}
.bag-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  grid-auto-rows: 1fr;
  gap: 12px;
  margin: 12px;
}

.bag-item {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  --inset-top: 12px; --inset-right: 0; --inset-bottom: 10px; --inset-left: 0;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-card);
  box-shadow:
    inset 0 1px 0 var(--glass-highlight),
    var(--ui-shadow-sm);
  text-align: center;
}

.bag-item__thumb {
  position: relative;
  display: grid;
  width: 56px;
  height: 56px;
  margin-bottom: 8px;
  place-items: center;
  border-radius: 18px;
}

.bag-item__thumb img {
  max-width: 56px;
  max-height: 56px;
  object-fit: contain;
}

.bag-item__fallback {
  color: var(--ui-subtle);
  font-size: var(--ui-font-size-large-15);
  font-weight: var(--fw-700);
}

.bag-item__lock {
  position: absolute;
  top: -6px;
  left: -6px;
  display: grid;
  width: 22px;
  height: 22px;
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
  font-size: var(--ui-font-size-medium-14);
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
  font-size: var(--ui-content-item-font-height-tiny-12);
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}

.bag-item__meta .is-giant {
  color: #b07a0c;
  font-weight: var(--fw-400);
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

.bag-type--product {
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
}

.bag-type--coop {
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

.bag-type--shed {
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
}

.bag-type--can {
  color: var(--ui-blue);
  background: var(--ui-blue-soft);
}

.bag-type--other {
  color: var(--ui-muted);
  background: var(--ui-surface-soft);
}

.bag-item__foot {
  display: flex;
  width: 100%;
  min-height: 30px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  --inset-top: 10px;
  --inset-left: 8px; --inset-right: 8px;
}

.bag-item__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
  margin-inline-start: auto;
}

.bag-item__qty {
  order: 1;
  margin-inline-start: auto;
  min-width: 0;
  overflow: hidden;
  color: var(--ui-ink);
  font-size: var(--ui-font-size-large-15);
  font-weight: var(--fw-700);
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.bag-item__qty small {
  margin-right: 1px;
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-600);
}

.bag-hint {
  margin: 0;
  color: var(--ui-warning);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

@media (max-width: 520px) {
  .bag-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
}
</style>
