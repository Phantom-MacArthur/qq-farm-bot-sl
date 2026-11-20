<script setup lang="ts">
import type { CollectionItem } from '@/stores/collections'
import { NButton } from 'naive-ui/es/button'
import { NCard } from 'naive-ui/es/card'
import { NModal } from 'naive-ui/es/modal'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import BookOverview from '@/components/illustrated/BookOverview.vue'
import BookTile from '@/components/illustrated/BookTile.vue'
import BookToolbar from '@/components/illustrated/BookToolbar.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import OfflineState from '@/components/ui/OfflineState.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { useAccountPresence } from '@/composables/useReconnectRefresh'
import { vLazySrc } from '@/directives/lazy-src'
import { useAccountStore } from '@/stores/account'
import { useCollectionsStore } from '@/stores/collections'
import { useToastStore } from '@/stores/toast'

const { currentAccountId } = storeToRefs(useAccountStore())
const presence = useAccountPresence()
const isOffline = computed(() => presence.value === 'offline')
const isConnected = computed(() => presence.value === 'online')
const store = useCollectionsStore()
const { data, loading, error, pending } = storeToRefs(store)
const toast = useToastStore()
const seriesId = ref(0)
const search = ref('')
const status = ref('all')
const selected = ref<CollectionItem | null>(null)
const rewardsOpen = ref(false)
const upgradeConfirmation = ref<CollectionItem | null>(null)

/** 稀有度色标：普通、稀有、珍品、天工。 */
const RARITY_COLORS: Record<number, string> = { 1: 'var(--ui-primary)', 2: 'var(--ui-blue)', 3: 'var(--ui-violet)', 4: 'var(--ui-warning)' }
function rarityColor(rarity: number) {
  return RARITY_COLORS[rarity] || 'var(--ui-primary)'
}

function itemStatus(item: CollectionItem) {
  return item.activated ? 'active' : Number(item.ownCount) > 0 ? 'pending' : 'missing'
}
function itemState(item: CollectionItem) {
  return { active: '已激活', pending: '待激活', missing: '未获得' }[itemStatus(item)]
}
function itemMeta(item: CollectionItem) {
  if (item.activated)
    return `${item.score.toLocaleString()} 分`
  return Number(item.ownCount) > 0 ? `待激活 · 持有 ${item.ownCount}` : '未获得'
}

const allItems = computed(() => (data.value?.series || []).flatMap(series => series.items))
const statusFilters = computed(() => {
  const counts = { active: 0, pending: 0, missing: 0 }
  for (const item of allItems.value)
    counts[itemStatus(item)]++
  return [
    { value: 'all', label: '全部', count: allItems.value.length },
    { value: 'active', label: '已激活', count: counts.active },
    { value: 'pending', label: '待激活', count: counts.pending },
    { value: 'missing', label: '未获得', count: counts.missing },
  ]
})
const seriesOptions = computed(() => [{ label: '全部系列', value: 0 }, ...(data.value?.series || []).map(series => ({ label: series.name, value: series.id }))])
const visibleItems = computed(() => {
  const keyword = search.value.trim()
  return (data.value?.series || []).filter(series => !seriesId.value || series.id === seriesId.value).flatMap(series => series.items
    .filter(item => (!keyword || `${item.name} ${series.name}`.includes(keyword))
      && (status.value === 'all' || itemStatus(item) === status.value))
    .map(item => ({ item, accent: rarityColor(series.rarity) })))
})
const progress = computed(() => data.value?.nextRewardScore ? Math.min(100, data.value.score / data.value.nextRewardScore * 100) : 100)
const selectedSeries = computed(() => data.value?.series.find(series => series.items.some(item => item.id === selected.value?.id)))

async function refresh() {
  if (currentAccountId.value && isConnected.value && !pending.value)
    await store.fetch(currentAccountId.value)
}

async function operate(action: 'upgrade' | 'claim' | 'display', input: Record<string, unknown>, message: string) {
  const result = await store.operate(String(currentAccountId.value || ''), action, input)
  if (result.stale)
    return
  if (result.ok)
    toast.success(result.data?.skipped ? '当前状态已更新，无需重复操作' : message)
  else
    toast.error(result.error || '藏品操作失败')
}

async function upgrade() {
  const item = upgradeConfirmation.value
  if (!item)
    return
  await operate('upgrade', {
    collectionId: item.id,
    expectedStarLevel: item.starLevel,
    expectedCosts: item.nextStarCosts.map(cost => ({ itemId: cost.itemId, count: cost.count })),
  }, item.activated ? `${item.name}已升至 ${item.starLevel + 1} 星` : `${item.name}已激活`)
  if (upgradeConfirmation.value === item)
    upgradeConfirmation.value = null
}

async function toggleDisplay() {
  const item = selected.value
  if (!item)
    return
  await operate('display', {
    collectionId: item.id,
    displayed: !item.displayed,
    expectedDisplayItemId: data.value?.display?.itemId || '0',
  }, item.displayed ? '已取消展示' : `正在展示${item.name}`)
}

watch(data, () => {
  if (selected.value)
    selected.value = allItems.value.find(item => item.id === selected.value?.id) || null
})
// 切号或重新上线时都会执行刷新键的 refresh
watch([currentAccountId, isConnected], () => {
  store.reset()
  selected.value = null
  rewardsOpen.value = false
  upgradeConfirmation.value = null
  void refresh()
}, { immediate: true })
onBeforeUnmount(() => store.reset())
</script>

<template>
  <div class="book-page panel-fill">
    <EmptyState v-if="!currentAccountId" title="请先选择账号" description="在左侧选择账号后查看藏品" icon="i-carbon-user-avatar" />
    <OfflineState v-else-if="isOffline" />
    <div v-else-if="presence === 'unknown' || (loading && !data)" class="book-loading" role="status" aria-label="正在读取藏品">
      <span class="i-svg-spinners-90-ring-with-bg" />
    </div>
    <EmptyState v-else-if="error" title="藏品读取失败" :description="error" tone="error" icon="i-carbon-warning-alt">
      <NButton secondary :loading="loading" @click="refresh">
        重新读取
      </NButton>
    </EmptyState>
    <template v-else-if="data">
      <BookToolbar v-model:filter="status" v-model:query="search" :filters="statusFilters" label="藏品筛选" placeholder="输入名称搜索">
        <template #overview>
          <BookOverview
            embedded
            title="蓝晶藏品"
            icon="i-carbon-trophy"
            :badge-value="data.activatedCount"
            badge-label="已激活"
            :caption="`共 ${data.totalCount} 款 · 总评分 ${data.score.toLocaleString()}`"
            :progress-text="data.nextRewardScore === null ? '' : `${data.score.toLocaleString()} / ${data.nextRewardScore.toLocaleString()}`"
            :percent="progress"
            :hint="data.nextRewardScore === null ? '评分奖励已全部领取' : '距下一档评分奖励'"
          >
            <template #actions>
              <NButton secondary @click="rewardsOpen = true">
                评分奖励
              </NButton>
            </template>
            <template v-if="data.currentBuffs.length">
              <span class="book-chip-label">当前加成</span>
              <span v-for="buff in data.currentBuffs" :key="buff.id" class="book-chip">{{ buff.description }}</span>
            </template>
          </BookOverview>
        </template>
        <BaseSelect v-model="seriesId" :options="seriesOptions" fit-width aria-label="藏品系列" />
        <template #actions>
          <RefreshButton :loading="loading" :disabled="loading || !!pending" @click="refresh" />
        </template>
        <!-- 所有藏品平铺在标题栏同一张卡片里，不再按系列分组；稀有度色标挂在各自的卡片上 -->
        <template #body>
          <div v-if="visibleItems.length" class="book-grid">
            <BookTile
              v-for="{ item, accent } in visibleItems"
              :key="item.id"
              :style="{ '--tile-accent': accent }"
              :name="item.name"
              :image="item.image"
              :state="item.activated ? 'owned' : Number(item.ownCount) > 0 ? 'pending' : 'missing'"
              :fresh="item.isNew"
              :meta="itemMeta(item)"
              :meta-tone="!item.activated && Number(item.ownCount) > 0 ? 'warning' : 'muted'"
              interactive
              :label="`${item.name}，${itemState(item)}，查看详情`"
              @select="selected = item"
            >
              <template v-if="item.displayed" #corner>
                <span class="tile-display" title="展示中"><span class="i-carbon-view" aria-hidden="true" />展示</span>
              </template>
              <template #extra>
                <span class="tile-stars" :aria-label="`${item.starLevel} 星，共 ${item.maxStarLevel || 5} 星`">
                  <span v-for="star in item.maxStarLevel || 5" :key="star" class="i-carbon-star-filled" :class="{ 'is-lit': star <= item.starLevel }" />
                </span>
              </template>
            </BookTile>
          </div>
          <EmptyState v-else bare title="没有符合条件的藏品" description="换个系列、状态或搜索词试试" icon="i-carbon-search" />
        </template>
      </BookToolbar>
    </template>

    <NModal :show="!!selected" @update:show="show => { if (!show) selected = null }">
      <NCard v-if="selected" class="max-w-md w-[calc(100vw-32px)]" :title="selected.name" closable @close="selected = null">
        <div class="collection-detail" :style="{ '--tile-accent': rarityColor(selectedSeries?.rarity || 1) }">
          <div class="collection-detail__hero">
            <span class="collection-detail__well" :class="{ 'is-missing': itemStatus(selected) === 'missing' }">
              <img v-if="selected.image" :src="selected.image" :alt="selected.name">
            </span>
            <div class="collection-detail__heading">
              <span class="collection-detail__series"><b>{{ selectedSeries?.rarityName }}</b>{{ selectedSeries?.name }}</span>
              <span class="tile-stars is-large" :aria-label="`${selected.starLevel} 星，共 ${selected.maxStarLevel || 5} 星`">
                <span v-for="star in selected.maxStarLevel || 5" :key="star" class="i-carbon-star-filled" :class="{ 'is-lit': star <= selected.starLevel }" />
              </span>
              <p v-if="selected.description">
                {{ selected.description }}
              </p>
            </div>
          </div>
          <dl class="collection-detail__stats">
            <div><dt>状态</dt><dd>{{ itemState(selected) }}</dd></div>
            <div><dt>持有</dt><dd>{{ selected.ownCount }}</dd></div>
            <div><dt>评分</dt><dd>{{ selected.score.toLocaleString() }}</dd></div>
          </dl>
          <div class="collection-detail__block">
            <strong>{{ selected.nextStarCosts.length ? (selected.activated ? '升至下一星需要' : '激活需要') : '已达最高星级' }}</strong>
            <div v-if="selected.nextStarCosts.length" class="collection-detail__costs">
              <span v-for="cost in selected.nextStarCosts" :key="cost.itemId">
                <img v-if="cost.image" :src="cost.image" alt="">{{ cost.name }}<b>×{{ Number(cost.count).toLocaleString() }}</b>
              </span>
            </div>
          </div>
          <ul v-if="selected.requirements.length" class="collection-detail__requirements">
            <li v-for="requirement in selected.requirements" :key="requirement">
              {{ requirement }}
            </li>
          </ul>
          <div class="flex justify-end gap-2">
            <NButton v-if="selected.activated" secondary :disabled="!!pending || loading" :loading="pending === 'display'" @click="toggleDisplay">
              {{ selected.displayed ? '取消展示' : '展示' }}
            </NButton>
            <NButton
              v-if="selected.starLevel < selected.maxStarLevel"
              type="primary"
              :disabled="!!pending || loading || !selected.canUpgrade"
              :loading="pending === 'upgrade'"
              :title="!selected.unlocked ? '未满足解锁条件' : !selected.canUpgrade ? '藏品副本不足' : ''"
              @click="upgradeConfirmation = selected"
            >
              {{ selected.activated ? '升星' : '激活' }}
            </NButton>
          </div>
        </div>
      </NCard>
    </NModal>

    <NModal v-model:show="rewardsOpen">
      <NCard class="max-w-xl w-[calc(100vw-32px)]" title="藏品评分奖励" closable @close="rewardsOpen = false">
        <div class="milestone-list custom-scrollbar">
          <div v-for="milestone in data?.milestones" :key="milestone.level" class="milestone" :class="{ 'is-claimed': milestone.claimed, 'is-reached': milestone.reached && !milestone.claimed }">
            <div class="milestone__score">
              <b>{{ milestone.score.toLocaleString() }}</b><small>评分</small>
            </div>
            <div class="milestone__rewards">
              <span v-for="buff in milestone.buffs" :key="buff.id" class="milestone__buff">{{ buff.description }}</span>
              <span v-for="reward in milestone.rewards" :key="reward.itemId">
                <img v-if="reward.image" v-lazy-src="reward.image" alt="" loading="lazy" decoding="async">{{ reward.name }} ×{{ reward.count }}
              </span>
            </div>
            <NButton v-if="milestone.reached && !milestone.claimed" size="small" type="primary" :loading="pending === 'claim'" :disabled="!!pending || loading" title="领取全部已达标奖励" @click="operate('claim', {}, '已领取全部达标评分奖励')">
              领取
            </NButton>
            <span v-else class="milestone__state">
              <span v-if="milestone.claimed" class="i-carbon-checkmark" aria-hidden="true" />{{ milestone.claimed ? '已领取' : milestone.reached ? '可领取' : '未达成' }}
            </span>
          </div>
        </div>
      </NCard>
    </NModal>
    <ConfirmModal
      :show="!!upgradeConfirmation"
      :title="upgradeConfirmation?.activated ? '确认升星' : '确认激活'"
      :message="upgradeConfirmation ? `${upgradeConfirmation.name} → ${upgradeConfirmation.starLevel + 1} 星\n消耗：${upgradeConfirmation.nextStarCosts.map(cost => `${cost.name} ×${Number(cost.count).toLocaleString()}`).join('、')}` : ''"
      :loading="pending === 'upgrade'"
      @confirm="upgrade"
      @cancel="upgradeConfirmation = null"
    />
  </div>
</template>

<style scoped>
.book-page {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 16px;
}

.book-page:not(:has(> .offline-state)) {
  padding-bottom: 16px;
}

.book-loading {
  display: grid;
  min-height: 240px;
  place-items: center;
  color: var(--ui-primary);
  font-size: 28px;
}

/* 固定最小列宽自动排列：同一行卡片等宽等高，与作物图鉴的条目网格一致。 */
.book-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 10px;
}

.tile-display {
  position: absolute;
  bottom: 5px;
  left: 50%;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 6px;
  border-radius: 999px;
  color: var(--tile-accent);
  background: var(--ui-surface-strong);
  box-shadow: var(--ui-shadow-sm);
  font-size: 10px;
  line-height: 16px;
  transform: translateX(-50%);
}

.tile-stars {
  display: flex;
  height: 12px;
  justify-content: center;
  gap: 1px;
  color: var(--ui-border-strong);
  font-size: 10px;
}

.tile-stars .is-lit {
  color: var(--ui-warning);
}

.tile-stars.is-large {
  height: 16px;
  justify-content: flex-start;
  font-size: 13px;
}

.collection-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.collection-detail__hero {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.collection-detail__well {
  display: grid;
  width: 96px;
  height: 96px;
  flex: none;
  place-items: center;
  border-radius: 14px;
  background: color-mix(in srgb, var(--tile-accent) 10%, var(--ui-surface-soft));
}

.collection-detail__well img {
  width: 76%;
  height: 76%;
  object-fit: contain;
}

.collection-detail__well.is-missing img {
  opacity: 0.45;
  filter: grayscale(1);
}

.collection-detail__heading {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.collection-detail__series {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-muted);
  font-size: 12px;
}

.collection-detail__series b {
  padding: 0 6px;
  border-radius: 5px;
  color: var(--tile-accent);
  background: color-mix(in srgb, var(--tile-accent) 13%, transparent);
  font-size: 11px;
  font-weight: var(--fw-600);
  line-height: 18px;
}

.collection-detail__heading p {
  margin: 0;
  color: var(--ui-muted);
  font-size: 13px;
  line-height: 1.6;
}

.collection-detail__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
}

.collection-detail__stats > div {
  padding: 8px 12px;
}

.collection-detail__stats > div + div {
  border-left: 1px solid var(--ui-border);
}

.collection-detail__stats dt {
  color: var(--ui-subtle);
  font-size: 11px;
}

.collection-detail__stats dd {
  margin: 2px 0 0;
  color: var(--ui-ink);
  font-size: 14px;
  font-weight: var(--fw-600);
  font-variant-numeric: tabular-nums;
}

.collection-detail__block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.collection-detail__block > strong {
  color: var(--ui-ink);
  font-size: 13px;
  font-weight: var(--fw-600);
}

.collection-detail__costs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.collection-detail__costs > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px 4px 6px;
  border-radius: 999px;
  color: var(--ui-muted);
  background: var(--ui-surface-soft);
  font-size: 12px;
}

.collection-detail__costs b {
  color: var(--ui-ink);
  font-weight: var(--fw-600);
  font-variant-numeric: tabular-nums;
}

.collection-detail__costs img {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.collection-detail__requirements {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  color: var(--ui-muted);
  background: var(--ui-surface-soft);
  font-size: 12px;
  line-height: 1.6;
}

.milestone-list {
  display: flex;
  max-height: 65vh;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}

.milestone {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) 64px;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  font-size: 12px;
}

.milestone.is-reached {
  border-color: color-mix(in srgb, var(--ui-primary) 45%, var(--ui-border));
  background: var(--ui-primary-soft);
}

.milestone.is-claimed {
  opacity: 0.55;
}

.milestone__score {
  display: flex;
  flex-direction: column;
}

.milestone__score b {
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.milestone__score small {
  color: var(--ui-subtle);
  font-size: 11px;
}

.milestone__rewards {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 4px 12px;
  color: var(--ui-muted);
}

.milestone__rewards > span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.milestone__rewards img {
  width: 22px;
  height: 22px;
  object-fit: contain;
}

.milestone__buff {
  color: var(--ui-primary);
}

.milestone__state {
  color: var(--ui-subtle);
  text-align: right;
  white-space: nowrap;
}

.milestone.is-reached .milestone__state {
  color: var(--ui-primary);
  font-weight: var(--fw-600);
}
</style>
