<script setup lang="ts">
import type { MallGoodsDto } from '@/stores/commerce'
import { NButton } from 'naive-ui/es/button'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import CommerceItemImage from '@/components/commerce/CommerceItemImage.vue'
import CommerceShopBar from '@/components/commerce/CommerceShopBar.vue'
import PurchaseDialog from '@/components/commerce/PurchaseDialog.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import OfflineState from '@/components/ui/OfflineState.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { useAccountPresence, useReconnectRefresh } from '@/composables/useReconnectRefresh'
import { useAccountStore } from '@/stores/account'
import { useCommerceStore } from '@/stores/commerce'
import { useToastStore } from '@/stores/toast'
import { getMallLimitLabel, getMallPurchaseAction } from '@/utils/mall-purchase'

type FilterKey = 'all' | 'free' | 'discount' | 'fertilizer' | 'pet' | 'activity'

const { slotType, propsShop = false } = defineProps<{ slotType: 1 | 4 | 5, propsShop?: boolean }>()

const accountStore = useAccountStore()
const commerceStore = useCommerceStore()
const toast = useToastStore()
const route = useRoute()
const { currentAccountId } = storeToRefs(accountStore)
const presence = useAccountPresence()
const isOffline = computed(() => presence.value === 'offline')
const { mall, mallLoading, purchasingGoodsId, error, notice } = storeToRefs(commerceStore)
const selected = ref<MallGoodsDto | null>(null)
const filter = ref<FilterKey>(route.query.category === 'pet-diary' ? 'activity' : 'all')
const query = ref('')
const clock = ref(Date.now())
let timer: number | undefined

const ACTIVITY_ITEM_IDS = new Set([1028, 1029, 1030, 80101, 80102, 80103, 90031, 90032, 90033, 90034, 90041, 29004, 29005, 101305, 101613, 101618, 101619, 6001, 6002, 26030, 90042])

const filters = computed<Array<{ key: FilterKey, label: string }>>(() => {
  const entries: Array<{ key: FilterKey, label: string }> = [
    { key: 'all', label: '全部' },
    { key: 'free', label: '免费' },
    { key: 'discount', label: '折扣' },
  ]
  if (!propsShop) {
    entries.push(
      { key: 'fertilizer', label: '化肥' },
      { key: 'pet', label: '狗粮' },
      { key: 'activity', label: '活动限定' },
    )
  }
  return entries
})

// BaseSelect 要求 { label, value } 结构，把 filters 的 key 映射为 value。
const filterOptions = computed(() => filters.value.map(entry => ({ label: entry.label, value: entry.key })))

const filteredGoods = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return (mall.value?.goods || []).filter((goods) => {
    const names = [goods.name, ...goods.rewards.map(item => item.name)].join(' ').toLowerCase()
    if (keyword && !names.includes(keyword) && !String(goods.id).includes(keyword))
      return false
    if (filter.value === 'free')
      return goods.isFree
    if (filter.value === 'discount')
      return goods.isDiscounted || !!goods.discountText
    if (filter.value === 'fertilizer')
      return names.includes('化肥')
    if (filter.value === 'pet')
      return names.includes('狗粮')
    if (filter.value === 'activity')
      return goods.isDiscounted || goods.rewards.some(item => ACTIVITY_ITEM_IDS.has(Number(item.id)))
    return true
  }).map(goods => ({ ...goods, action: getMallPurchaseAction(goods, slotType === 4 ? mall.value?.membership : null) }))
})

function formatDuration(seconds: number) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0)
    return `${days}天${hours}小时`
  if (hours > 0)
    return `${hours}小时${minutes}分`
  return `${Math.max(1, minutes)}分钟`
}

const currencies = computed(() => (mall.value?.currencies || []).map(currency => ({
  id: currency.id,
  name: currency.name,
  image: currency.image,
  amount: currency.balanceKnown ? currency.count : null,
})))

// 礼包内容完整清单，用于悬停提示与读屏；卡片上一行放不下时右侧淡出，完整内容在购买弹窗中查看。
function rewardSummary(goods: MallGoodsDto) {
  return goods.rewards.map(item => `${item.name} ×${item.count}`).join('\n')
}

function limitLabel(goods: MallGoodsDto) {
  return propsShop ? '限购' : getMallLimitLabel(goods.limit?.type)
}

// 只有一种奖励且与商品同名时，名称已经说明内容，只补数量。
function isSingleReward(goods: MallGoodsDto) {
  return goods.rewards.length === 1
}

function discountRemaining(goods: MallGoodsDto) {
  if (!goods.discountEndTime)
    return ''
  const end = goods.discountEndTime > 1e12 ? goods.discountEndTime : goods.discountEndTime * 1000
  const seconds = Math.floor((end - clock.value) / 1000)
  return seconds > 0 ? `剩 ${formatDuration(seconds)}` : ''
}

function load() {
  commerceStore.fetchMall(String(currentAccountId.value || ''), slotType, propsShop)
}

function choose(goods: MallGoodsDto) {
  if (getMallPurchaseAction(goods, slotType === 4 ? mall.value?.membership : null).enabled)
    selected.value = goods
}

async function purchase(count: number) {
  if (!selected.value)
    return
  const goods = selected.value
  const succeeded = await commerceStore.purchaseMall(String(currentAccountId.value || ''), goods, count)
  if (succeeded) {
    toast.success(`购买成功：${goods.name} x${count}`)
    selected.value = null
  }
  else if (!isOffline.value && selected.value === goods) {
    toast.error(error.value || `购买失败：${goods.name}`)
  }
}

watch(() => [slotType, propsShop], () => {
  selected.value = null
  filter.value = 'all'
  load()
})
watch(currentAccountId, () => {
  selected.value = null
  load()
})
watch(isOffline, (offline) => {
  if (offline)
    selected.value = null
})
// 重新上线时按一次刷新键
useReconnectRefresh(load)
watch(mall, () => {
  if (selected.value)
    selected.value = mall.value?.goods.find(goods => goods.id === selected.value?.id) || null
})
onMounted(() => {
  load()
  timer = window.setInterval(() => clock.value = Date.now(), 1000)
})
onUnmounted(() => {
  if (timer)
    window.clearInterval(timer)
})
</script>

<template>
  <div class="mall-catalog panel-fill">
    <section class="mall-card page-card-surface rounded-2xl panel-scroll-layout margin-shell"><span class="margin-content">
      <div class="mall-head panel-titlebar shrink-0 margin-shell"><span class="margin-content">
        <CommerceShopBar
          class="mall-shopbar"
          :currencies="currencies"
          :loading="mallLoading"
          :disabled="!currentAccountId"
          refresh-label="刷新商城"
          @refresh="load"
        >
          <template #actions>
            <BaseInput v-model="query" type="search" placeholder="输入名称搜索" />
            <BaseSelect
              v-model="filter"
              :options="filterOptions"
              fit-width
              placeholder="全部分类"
            />
          </template>
        </CommerceShopBar>
      </span></div>

      <div class="mall-body panel-scroll-body">
        <div v-if="!isOffline && ((error && mall) || notice)" class="shop-message" :class="{ 'is-success': !!notice && !error }" role="status">
          <span>{{ error || notice }}</span>
          <RefreshButton v-if="error" label="重新读取" size="small" @click="load" />
          <button type="button" title="关闭消息" aria-label="关闭消息" @click="commerceStore.clearMessages">
            <span class="i-carbon-close" />
          </button>
        </div>

        <EmptyState v-if="!currentAccountId" title="请先选择账号" description="商城商品与余额按当前账号读取" icon="i-carbon-user-avatar" />
        <OfflineState v-else-if="isOffline" />
        <div v-else-if="mallLoading && !mall" class="shop-loading">
          <span class="i-svg-spinners-90-ring-with-bg" />
        </div>
        <EmptyState v-else-if="!mall && error" title="商城读取失败" :description="error" tone="error" bare>
          <RefreshButton label="重新读取" :loading="mallLoading" @click="load" />
        </EmptyState>
        <EmptyState v-else-if="filteredGoods.length === 0" title="没有匹配的商品" description="换个分类或关键词试试" icon="i-carbon-search-locate" />

        <section v-else class="goods-grid" aria-live="polite">
          <article
            v-for="goods in filteredGoods"
            :key="goods.id"
            class="goods-card"
            :class="{ 'is-unavailable': !goods.action.enabled }"
          >
            <div class="goods-card__visual">
              <CommerceItemImage :src="goods.rewards[0]?.image" :alt="goods.rewards[0]?.name || goods.name" size="md" />
            </div>

            <div class="goods-card__main">
              <div class="goods-card__title">
                <h3 class="goods-card__name" :title="`${goods.name} #${goods.id}`">
                  {{ goods.name }}
                </h3>
                <span v-if="!goods.isFree && goods.discountText" class="goods-tag">{{ goods.discountText }}</span>
              </div>
              <div v-if="isSingleReward(goods)" class="goods-card__single">
                {{ goods.rewards[0]?.name }} <b>×{{ goods.rewards[0]?.count.toLocaleString() }}</b>
              </div>
              <div v-else class="goods-card__rewards" :title="rewardSummary(goods)" :aria-label="`礼包内容：${rewardSummary(goods).replace(/\n/g, '，')}`">
                <span class="reward-total">{{ goods.rewards.length }}件</span>
                <span class="goods-card__reward-track">
                  <span v-for="reward in goods.rewards" :key="reward.id" class="reward-chip">
                    <CommerceItemImage :src="reward.image" :alt="reward.name" size="sm" />
                    <b>×{{ reward.count.toLocaleString() }}</b>
                  </span>
                </span>
              </div>
              <div v-if="goods.limit || discountRemaining(goods)" class="goods-card__meta">
                <span v-if="goods.limit">{{ limitLabel(goods) }} {{ goods.limit.bought }}/{{ goods.limit.max }}</span>
                <span v-if="discountRemaining(goods)" class="is-warn">{{ discountRemaining(goods) }}</span>
              </div>
            </div>

            <div class="goods-card__buy">
              <div class="goods-price">
                <strong v-if="goods.isFree" class="goods-price__free">免费</strong>
                <template v-else>
                  <CommerceItemImage :src="goods.price.image" :alt="goods.price.name" size="sm" />
                  <strong :title="goods.price.name">{{ goods.price.count.toLocaleString() }}</strong>
                  <del v-if="goods.originalPrice">{{ goods.originalPrice.toLocaleString() }}</del>
                </template>
              </div>
              <NButton
                size="small"
                :type="goods.action.enabled ? 'primary' : 'default'"
                :secondary="!goods.action.enabled"
                :title="goods.action.reason"
                :disabled="!goods.action.enabled || purchasingGoodsId !== null"
                @click="choose(goods)"
              >
                {{ goods.action.label }}
              </NButton>
            </div>
          </article>
        </section>
      </div>
    </span></section>

    <PurchaseDialog
      mall-typography
      :open="!isOffline && !!selected"
      :goods="selected"
      :limit-label="selected ? limitLabel(selected) : undefined"
      :pending="purchasingGoodsId === selected?.id"
      @close="selected = null"
      @confirm="purchase"
    />
  </div>
</template>

<style scoped>
.mall-catalog {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 卡片外壳：标题栏（货币栏+刷新）走全局 .panel-titlebar 出血贴顶边，正文与标题栏用 gap 分隔。 */
.mall-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mall-shopbar {
  flex: 1;
  min-width: 0;
}

.mall-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.shop-loading {
  display: grid;
  min-height: 240px;
  place-items: center;
  color: var(--ui-primary);
  font-size: var(--ui-font-size-large-15);
}

.goods-card {
  padding: 14px 16px;
}

.shop-message {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--ui-radius-control);
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
  font-size: var(--ui-font-size-small-13);
}

.shop-message.is-success {
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

.shop-message button {
  display: grid;
  place-items: center;
  color: inherit;
}
</style>

<style scoped src="./mall-goods.css"></style>
