<script setup lang="ts">
import { NButton } from 'naive-ui/es/button'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { BUCKETS, formatCount, formatHours, RANCH_IMAGE, useRanchActions, useRanchClock, useRanchLoader } from '@/components/ranch/ranch-shared'
import { formatCountdown } from '@/utils/format-countdown'
import RanchAnimalCard from '@/components/ranch/RanchAnimalCard.vue'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'
import ConfirmModal from '@/components/ConfirmModal.vue'
import RanchGate from '@/components/ranch/RanchGate.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { formatCompactAmount } from '@/utils/format-number'
import { useRanchStore } from '@/stores/ranch'

const ranch = useRanchStore()
const toast = useToastStore()
const { currentAccountId } = storeToRefs(useAccountStore())
const { state, loading } = storeToRefs(ranch)
const { refresh } = useRanchLoader('animals')
const { disabled, request, requestDirect } = useRanchActions()
const { remainingSeconds } = useRanchClock()

let ranchPanelMounted = true
onBeforeUnmount(() => { ranchPanelMounted = false })
const selecting = ref(false)
const selectedIds = ref<string[]>([])
const selectionBusy = ref(false)
const animalKey = (animal: any) => `${animal.ranchId}:${animal.id}`
function toggleSelection() {
  selecting.value = !selecting.value
  selectedIds.value = []
  if (selecting.value) selectAllTargets()
}
type ToolbarAction = 'feed' | 'harvest' | 'clean' | 'upgrade' | 'all' | 'release'
const toolbarActions: { key: ToolbarAction, label: string, icon: string }[] = [
  { key: 'feed', label: '喂养', icon: 'i-carbon-time' },
  { key: 'harvest', label: '收获', icon: 'i-carbon-wheat' },
  { key: 'clean', label: '清理', icon: 'i-carbon-clean' },
  { key: 'upgrade', label: '升级', icon: 'i-carbon-upgrade' },
  { key: 'all', label: '一键打理', icon: 'i-carbon-flash' },
]
type SelectionAction = Exclude<ToolbarAction, 'all'>
const selectionAction = ref<SelectionAction>('feed')
const selectionOptions = [...toolbarActions.filter(item => item.key !== 'all'), { key: 'release' as const, label: '放生', icon: 'i-carbon-export' }]
const releaseConfirm = ref(false)
const selectingFacilities = computed(() => selectionAction.value === 'clean' || selectionAction.value === 'upgrade')
const eligibleFacilities = computed<any[]>(() => (state.value?.facilities || []).filter((f: any) =>
  [6, 7].includes(Number(f.moduleType)) && f.active
  && (selectionAction.value === 'clean' ? f.ranch?.hazards?.length > 0 : f.next?.available)))
function canSelectAnimal(animal: any) {
  if (selectingFacilities.value) return false
  if (selectionAction.value === 'release') return animal.canRelease
  return selectionAction.value === 'feed' ? animal.canFeed && !animal.limitedCanUsed
    : animal.canHarvest || animal.canProduce
}
const eligibleIds = computed<string[]>(() => selectingFacilities.value
  ? eligibleFacilities.value.map(f => String(f.id))
  : animals.value.filter(({ animal }) => canSelectAnimal(animal)).map(({ animal }) => animalKey(animal)))
function selectAllTargets() {
  if (!selectionBusy.value) selectedIds.value = [...eligibleIds.value]
}
function chooseSelectionAction(action: ToolbarAction) {
  if (selectionBusy.value || action === 'all') return
  selectionAction.value = action
  selectAllTargets()
}
function toggleAnimal(animal: any) {
  if (disabled.value || selectionBusy.value || !canSelectAnimal(animal)) return
  const id = animalKey(animal)
  selectedIds.value = selectedIds.value.includes(id) ? selectedIds.value.filter(value => value !== id) : [...selectedIds.value, id]
}
watch(currentAccountId, () => { releaseConfirm.value = false; selecting.value = false; selectedIds.value = [] })
async function runToolbarAction(action: ToolbarAction) {
  if (disabled.value || selectionBusy.value || (selecting.value && !selectedIds.value.length))
    return
  const accountId = String(currentAccountId.value || '')
  if (!accountId)
    return
  const accountSessionVersion = ranch.ranchAccountSessionVersion
  const selected = selecting.value ? new Set(selectedIds.value) : null
  selectionBusy.value = true
  const stillCurrent = () => ranchPanelMounted && accountId === String(currentAccountId.value || '')
    && accountSessionVersion === ranch.ranchAccountSessionVersion
  function reportResult(type: 'success' | 'error' | 'info', message: string) {
    if (stillCurrent()) toast[type](message)
  }
  async function executeDirect(kind: 'feed' | 'harvest' | 'produce' | 'clean', input: Record<string, unknown>) {
    const result = await ranch.executeDirect(accountId, kind, input)
    if (!result)
      throw new Error(ranch.error || '操作未完成')
    if (result.sceneRestored === false)
      throw new Error(result.notice || '牧场场景恢复未确认')
    if (result.refreshRequired)
      await ranch.reload(accountId)
    return result
  }
  async function animalOperation(kind: 'feed' | 'harvest' | 'produce') {
    const extra = kind === 'feed' ? { bucketType: 2, produceAfterFeed: false } : {}
    if (!selected) {
      const result = await executeDirect(kind, { all: true, ...extra })
      return result.notice || (result.status === 'skipped' ? '当前无需处理' : '操作完成')
    }
    const targets = animals.value.filter(({ animal }) => selected.has(animalKey(animal))
      && (kind === 'feed' ? animal.canFeed && !animal.limitedCanUsed : kind === 'harvest' ? animal.canHarvest : animal.canProduce))
    const messages: string[] = []
    for (const { animal } of targets) {
      if (!stillCurrent())
        break
      try {
        await executeDirect(kind, { ...target(animal), ...extra })
        messages.push('完成')
      }
      catch (error) {
        messages.push(error instanceof Error ? error.message : '操作失败')
      }
    }
    return messages.length ? messages.join('；') : '所选动物无需处理'
  }
  try {
    if (action === 'release') {
      let completed = 0
      const targets = animals.value.filter(({ animal }) => selected?.has(animalKey(animal)) && animal.canRelease)
      for (const { animal } of targets) {
        if (!stillCurrent()) break
        const input = target(animal)
        const quote = await ranch.quote(accountId, 'release', input)
        if (!stillCurrent()) break
        if (!quote || quote.skipped) {
          reportResult('error', '放生：' + (ranch.error || '当前不可放生'))
          continue
        }
        const ok = await ranch.execute(accountId, 'release', input, quote.expected, { quiet: true })
        if (ok) completed++
        else reportResult('error', '放生：' + (ranch.error || '操作失败'))
        if (stillCurrent()) await ranch.reload(accountId)
      }
      if (stillCurrent()) reportResult('info', '已放生: ' + completed)
      return
    }
    const steps = action === 'all' ? toolbarActions.slice(0, 4) : toolbarActions.filter(item => item.key === action)
    for (const step of steps) {
      if (!stillCurrent())
        break
      try {
        if (step.key === 'feed') {
          reportResult('success', '喂养：' + await animalOperation('feed'))
        }
        else if (step.key === 'harvest') {
          const messages: string[] = []
          for (const kind of ['harvest', 'produce'] as const) {
            if (!stillCurrent())
              break
            try {
              messages.push((kind === 'harvest' ? '收获：' : '生产：') + await animalOperation(kind))
            }
            catch (error) {
              messages.push(error instanceof Error ? error.message : '操作失败')
            }
          }
          reportResult('info', messages.join('；'))
          if (action === 'all' && stillCurrent()) {
            const result = await ranch.executeDirect(accountId, 'restock', {})
            if (!stillCurrent()) break
            if (result) reportResult('info', result.notice || '补栏完成')
            else reportResult('error', '补栏：' + (ranch.error || '操作失败'))
          }

        }
        else if (step.key === 'clean') {
          const ids = selected ? [...selected] : [undefined]
          let completed = 0
          for (const id of ids) {
            if (!stillCurrent()) break
            try {
              const result = await executeDirect('clean', id ? { facilityId: id } : {})
              completed += result.completed ?? 0
            } catch (error) {
              reportResult('error', '清理：' + (error instanceof Error ? error.message : '操作失败'))
            }
          }
          reportResult('success', `已清理: ${completed}`)
        }
        else if (step.key === 'upgrade') {
          const facilities = (state.value?.facilities || []).filter((f: any) => [6, 7].includes(Number(f.moduleType)) && f.active && (!selected || selected.has(String(f.id))))
          const messages: string[] = []
          for (const facility of facilities) {
            if (!stillCurrent())
              break
            if (!facility.next?.available) {
              messages.push(facility.name + '：当前不可升级')
              continue
            }
            const input = { facilityId: facility.id }
            const quote = await ranch.quote(accountId, 'upgrade', input)
            if (!stillCurrent())
              break
            if (!quote || quote.skipped) {
              messages.push(facility.name + '：' + (ranch.error || '当前不可升级'))
              continue
            }
            const ok = await ranch.execute(accountId, 'upgrade', input, quote.expected, { quiet: true })
            messages.push(facility.name + '：' + (ok ? '已开始升级一级' : ranch.error || '升级失败'))
            if (ok && stillCurrent())
              await ranch.reload(accountId)
          }
          reportResult('info', '升级：' + (messages.join('；') || '当前没有可升级设施'))
        }
      }
      catch (error) {
        if (stillCurrent())
          reportResult('error', step.label + '：' + (error instanceof Error ? error.message : '操作失败'))
      }
    }
  }
  finally {
    selectionBusy.value = false
    if (stillCurrent())
      selectedIds.value = []
  }
}
const pens = computed<any[]>(() => (state.value?.facilities || []).filter((f: any) => f.ranch))
const animals = computed(() => pens.value.flatMap(f => (f.ranch.animals || []).map((animal: any) => ({ animal, pen: f.name }))))
watch(eligibleIds, ids => {
  if (!selectionBusy.value) selectedIds.value = selectedIds.value.filter(id => ids.includes(id))
})

/**
 * 按设施分组：窝（6）在前、棚（7）在后。服务器返回的设施顺序不固定，
 * 组内再按栏位、实例编号排序，刷新后位置不变。
 */
const PEN_ORDER: Record<number, number> = { 6: 0, 7: 1 }
const penGroups = computed(() => {
  const groups = new Map<number, { type: number, name: string, animals: any[] }>()
  for (const f of pens.value) {
    const type = Number(f.moduleType)
    const group = groups.get(type) || { type, name: f.name, animals: [] as any[] }
    group.animals.push(...(f.ranch.animals || []))
    groups.set(type, group)
  }
  return [...groups.values()]
    .sort((a, b) => (PEN_ORDER[a.type] ?? 9) - (PEN_ORDER[b.type] ?? 9) || a.type - b.type)
    .map(group => ({ ...group, animals: [...group.animals].sort((a, b) => (Number(a.slot) || 0) - (Number(b.slot) || 0) || Number(a.id) - Number(b.id)) }))
})
const shelves = computed(() => pens.value.flatMap(f => f.ranch.shelves.filter((s: any) => s.canCollect).map((s: any) => ({ ...s, pen: f.name, key: `${f.id}:${s.slot}` }))))
const hazards = computed(() => pens.value.reduce((sum, f) => sum + (f.ranch.hazards?.length || 0), 0))

const buckets = computed(() => BUCKETS.map(bucket => ({
  ...bucket,
  seconds: state.value?.buckets?.find((b: any) => Number(b.id) === bucket.id)?.seconds ?? 0,
})))

// 只在快照仍有在途产物时补读，正常生产响应已经带回上架后的货架。
const deliveryAt = computed(() => Math.max(0, ...animals.value.map(({ animal }) => Number(animal.deliveringUntilMs) || 0)))
let lastDeliveryRead = 0
watch([deliveryAt, disabled], ([deadline, blocked], _, onCleanup) => {
  if (blocked || deadline <= lastDeliveryRead)
    return
  const timer = setTimeout(() => {
    lastDeliveryRead = deadline
    void refresh()
  }, remainingSeconds(deadline) * 1000 + 350)
  onCleanup(() => clearTimeout(timer))
}, { immediate: true })

const summary = computed(() => [
  { key: 'harvest', label: '可收获', icon: 'i-carbon-wheat', value: animals.value.filter(({ animal }) => animal.canHarvest).length },
  { key: 'produce', label: '可生产', icon: 'i-carbon-circle-dash', value: animals.value.filter(({ animal }) => animal.canProduce).length },
  // 数的是「因缺草卡住成长」的动物只数，不是牧草库存，和下方 stock 里的「牧草」不是同一个量。
  { key: 'blocked', label: '缺草', icon: 'i-carbon-warning-alt', value: animals.value.filter(({ animal }) => animal.grassBlocked).length },
  { key: 'clean', label: '待清理', icon: 'i-carbon-clean', value: hazards.value },
].map(item => ({ unit: '', ...item })))
const stock = computed(() => [
  { key: 'grass', label: '牧草', image: RANCH_IMAGE(7001), value: formatCompactAmount(state.value?.grass == null ? null : Number(state.value.grass)) },
  ...buckets.value.map(bucket => ({ key: bucket.id, label: bucket.name, image: bucket.image, value: formatHours(bucket.seconds) })),
])

/** 倒计时已到但服务器尚未推进阶段时，显示阶段名而不是“0秒”。 */
function animalRemaining(animal: any) {
  const deadline = animal.deliveringUntilMs || animal.nextAtMs
  const seconds = deadline ? remainingSeconds(deadline) : 0
  return seconds > 0 ? formatCountdown(seconds) : ''
}
function productionRemaining(animal: any) {
  return animal.productionAtMs ? remainingSeconds(animal.productionAtMs) : null
}
function animalProgress(animal: any) {
  const duration = Number(animal.stageDurationSec)
  if (!animal.nextAtMs || !Number.isFinite(duration) || duration <= 0)
    return null
  const remaining = remainingSeconds(animal.nextAtMs)
  return Math.round(Math.min(1, Math.max(0, 1 - remaining / duration)) * 100)
}
function target(animal: any) {
  return { ranchId: animal.ranchId, animalId: animal.id }
}
</script>

<template>
  <div class="panel-fill">
    <div class="ranch-animal-panel page-card-surface farm-card rounded-2xl panel-scroll-layout margin-shell"><span class="!m-0 margin-content">
        <div class="ranch-head panel-titlebar panel-titlebar--flush margin-shell"><span class="margin-content">
          <div class="ranch-actions">
            <NButton v-for="action in (selecting ? [] : toolbarActions)" :key="action.key" :type="action.key === 'all' ? 'primary' : 'default'" :disabled="disabled || selectionBusy" @click="runToolbarAction(action.key)">
              <span :class="action.icon" />{{ action.label }}
            </NButton>
            <NButton class="panel-multiselect-toggle" size="medium" :type="selecting ? 'default' : 'primary'" :secondary="!selecting" :disabled="selectionBusy || ranch.busy" @click="toggleSelection">
              <span class="i-carbon-checkbox-checked" />
              <span class="panel-multiselect-toggle__label">{{ selecting ? '取消' : '多选' }}</span>
            </NButton>
            <RefreshButton size="medium" :loading="loading" :disabled="disabled || selectionBusy" @click="refresh" />
          </div>
        </span></div>

        <div class="panel-scroll-body">
        <RanchGate @retry="refresh">
        <div class="ranch-summary">
          <div class="ranch-summary__states">
            <span v-for="item in summary" :key="item.key" class="ranch-state" :class="`ranch-state--${item.key}`">
              <span :class="item.icon" aria-hidden="true" />{{ item.label }}<b>{{ item.value }}{{ item.unit }}</b>
            </span>
          </div>
          <div class="ranch-summary__stock">
            <span v-for="item in stock" :key="item.key" :title="item.label">
              <img :src="item.image" alt="">{{ item.label }}<b>{{ item.value }}</b>
            </span>
          </div>

        </div>

        <div class="ranch-card-content margin-shell"><span class="margin-content">
          <div v-if="selecting" class="farm-selection-row">
            <div class="farm-mode-switch" role="group" aria-label="多选操作类型">
              <button v-for="option in selectionOptions" :key="option.key" type="button" :aria-pressed="selectionAction === option.key" :disabled="selectionBusy || disabled" @click="chooseSelectionAction(option.key)">
                <span :class="option.icon" />{{ option.label }}
              </button>
            </div>
            <div class="farm-selectbar">
              <div class="farm-selectbar__info" aria-live="polite">
                <span>已选 <b>{{ selectedIds.length }}</b> {{ selectingFacilities ? '个设施' : '只动物' }}</span>
                <span class="farm-selectbar__links">
                  <button type="button" :disabled="selectionBusy || disabled" @click="selectAllTargets">全选</button>
                  <button type="button" :disabled="selectionBusy || disabled" @click="selectedIds = []">清空</button>
                </span>
              </div>
              <NButton type="primary" :disabled="disabled || selectionBusy || !selectedIds.length" @click="selectionAction === 'release' ? releaseConfirm = true : runToolbarAction(selectionAction)">
                {{ selectionOptions.find(item => item.key === selectionAction)?.label }}
              </NButton>
            </div>
          </div>
          <div v-if="selecting && selectingFacilities" class="ranch-facility-selection">
            <button v-for="facility in (state?.facilities || []).filter((f: any) => [6, 7].includes(Number(f.moduleType)))" :key="facility.id"
              type="button" class="selection-card margin-shell" :class="{ 'selection-card--selected': selectedIds.includes(String(facility.id)) }"
              :disabled="disabled || selectionBusy || !eligibleIds.includes(String(facility.id))"
              :aria-pressed="selectedIds.includes(String(facility.id))"
              @click="selectedIds = selectedIds.includes(String(facility.id)) ? selectedIds.filter(id => id !== String(facility.id)) : [...selectedIds, String(facility.id)]"><span class="margin-content margin-content--button">
              {{ facility.name }} Lv.{{ facility.level }}
            </span></button>
          </div>

          <div v-if="!animals.length && !(selecting && selectingFacilities)" class="ranch-empty">
            <span class="i-carbon-pet-image-o" aria-hidden="true" />
            <strong>还没有饲养动物</strong>
            <p>在牧场商店购买幼崽，到背包里放养到窝或棚。</p>
            <BaseButton variant="secondary" size="sm" to="/ranch/game-mall">
              去牧场商店
            </BaseButton>
          </div>
          <template v-else-if="!selecting || !selectingFacilities">
            <section v-for="group in penGroups" :key="group.type" class="ranch-pen" :aria-label="`${group.name}的动物`">
              <div v-if="group.animals.length" class="ranch-grid">
                <div
                  v-for="animal in group.animals"
                  :key="`${animal.ranchId}:${animal.id}`"
                  class="ranch-selectable" :class="{ 'is-unavailable': selecting && !canSelectAnimal(animal) }"
                  :role="selecting ? 'checkbox' : undefined" :aria-checked="selecting ? selectedIds.includes(animalKey(animal)) : undefined"
                  :tabindex="selecting && canSelectAnimal(animal) ? 0 : undefined"
                  @keydown.space.prevent="selecting && toggleAnimal(animal)" @keydown.enter.prevent="selecting && toggleAnimal(animal)"
                  @click="selecting && toggleAnimal(animal)">
                  <RanchAnimalCard
                  :class="{ 'selection-card--selected': selecting && selectedIds.includes(animalKey(animal)) }"
                  :animal="animal"
                  :pen="group.name"
                  crop-layout
                  :selecting="selecting"
                  :selected="selecting && selectedIds.includes(animalKey(animal))"
                  :remaining="animalRemaining(animal)"
                  :production-remaining-seconds="productionRemaining(animal)"
                  :maturity-remaining="animal.matureAtMs ? formatCountdown(remainingSeconds(animal.matureAtMs)) : ''"
                  :progress="animalProgress(animal)"
                  :stage-remaining-seconds="animal.nextAtMs ? remainingSeconds(animal.nextAtMs) : null"
                  :buckets="buckets"
                  :actionable="!selecting"
                  :disabled="disabled || selectionBusy"
                  @produce="requestDirect('produce', target(animal))"
                  @harvest="requestDirect('harvest', target(animal))"
                  @feed="(bucketType, produceAfterFeed) => requestDirect('feed', { ...target(animal), bucketType, produceAfterFeed })"
                  @release="request('release', target(animal))"
                />
                </div>
              </div>
              <p v-else class="ranch-pen__empty">
                {{ group.name }}里还没有动物，可在背包放养或到牧场商店购买幼崽。
              </p>
            </section>
          </template>

          <section v-if="shelves.length" class="ranch-shelves" aria-label="待收产物">
            <h4><span class="i-carbon-box" aria-hidden="true" />待收产物</h4>
            <div class="ranch-shelves__list">
              <template v-for="shelf in shelves" :key="shelf.key">
                <span v-for="product in shelf.products" :key="`${shelf.key}:${product.id}`" class="ranch-product" :title="`${shelf.pen} · 货架 ${shelf.slot}`">
                  <img :src="product.image" alt="">{{ product.name }}<b>×{{ formatCount(product.count) }}</b>
                </span>
              </template>
            </div>
          </section>
        </span></div>
        </RanchGate>
        </div>
    </span></div>
  </div>
  <ConfirmModal :show="releaseConfirm" title="放生所选动物" type="danger"
    :message="`确定放生所选的 ${selectedIds.length} 只动物吗？放生后动物将离开栏舍。`"
    @cancel="releaseConfirm = false" @confirm="releaseConfirm = false; runToolbarAction('release')" />

</template>

<style scoped>
.ranch-card-content { --inset-top: var(--ui-card-content-padding); --inset-right: var(--ui-card-content-padding); --inset-bottom: var(--ui-card-content-padding); --inset-left: var(--ui-card-content-padding); }
.farm-selection-row { margin-bottom: 16px; }
.ranch-facility-selection { display: flex; flex-wrap: wrap; gap: 12px; }
.ranch-facility-selection button { --inset-top: 12px; --inset-right: 12px; --inset-bottom: 12px; --inset-left: 12px; background: var(--ui-surface); }
.ranch-facility-selection button:disabled, .ranch-selectable.is-unavailable { opacity: 0.55; }
.ranch-animal-panel.farm-card { --inset-top: 0; --inset-right: 0; --inset-bottom: 0; --inset-left: 0; }
.ranch-summary, .ranch-summary * { font-weight: 400; }
.ranch-head { flex-direction: column; align-items: stretch; gap: 12px; }
.ranch-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 100%;
  flex-wrap: nowrap;
  justify-content: flex-start;
  overflow-y: hidden;
  overflow-x: auto;
  scrollbar-width: none;
}
.ranch-actions :deep(.n-button) { flex: 0 0 auto; width: auto; }
.ranch-actions::-webkit-scrollbar { display: none; }
.ranch-actions :deep(.n-button__content) {
  gap: 4px;
}

.ranch-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ui-border);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.ranch-summary__states {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ranch-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 6px;
  color: var(--state-color);
  background: color-mix(in srgb, var(--state-color) 12%, transparent);
  font-variant-numeric: tabular-nums;
}
.ranch-state b { color: inherit; font-weight: 400; }
.ranch-state--harvest { --state-color: var(--ui-warning); }
.ranch-state--produce { --state-color: var(--ui-primary); }
.ranch-state--blocked { --state-color: #649cdb; }
.ranch-state--clean { --state-color: #a080cc; }

.ranch-summary__stock {
  margin-inline-start: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  color: var(--ui-muted);
}

.ranch-summary__stock > span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-variant-numeric: tabular-nums;
}

.ranch-summary__stock img {
  width: 16px;
  height: 16px;
  object-fit: contain;
}

.ranch-summary__stock b {
  margin-left: 2px;
  color: var(--ui-primary);
  font-weight: 400;
}

.ranch-pen + .ranch-pen {
  margin-top: var(--ui-card-grid-gap);
}

/* 分组标题：与图鉴分组同一种色标 + 名称 + 计数。 */
.ranch-pen__empty {
  margin: 0;
  padding: 14px;
  border: 1px dashed var(--ui-border-strong);
  border-radius: 12px;
  color: var(--ui-subtle);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.ranch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: var(--ui-card-grid-gap);
}

.ranch-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 36px 16px;
  color: var(--ui-muted);
  text-align: center;
}

.ranch-empty > span {
  margin-bottom: 4px;
  color: var(--ui-subtle);
  font-size: var(--ui-font-size-large-15);
}

.ranch-empty strong {
  color: var(--ui-ink);
  font-size: var(--ui-font-size-large-15);
}

.ranch-empty p {
  margin: 0 0 8px;
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.ranch-shelves {
  margin-top: var(--ui-card-grid-gap);
  padding-top: 16px;
  border-top: 1px dashed var(--ui-border-strong);
}

.ranch-shelves h4 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 10px;
  color: var(--ui-ink);
  font-size: var(--ui-font-size-medium-14);
  font-weight: 400;
}

.ranch-shelves__list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ranch-product {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px 4px 4px;
  border-radius: 10px;
  color: var(--ui-muted);
  background: var(--ui-surface-soft);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.ranch-product img {
  width: 28px;
  height: 28px;
  object-fit: contain;
}

.ranch-product b {
  color: var(--ui-ink);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 639px) {
  .ranch-head,
  .ranch-summary {
    --inset-left: 16px; --inset-right: 16px;
  }

  .ranch-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--ui-card-grid-gap);
  }
}

@media (max-width: 400px) {
  .ranch-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
