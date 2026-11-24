<script setup lang="ts">
import type { RanchItem } from '@/stores/ranch'
import { NButton } from 'naive-ui/es/button'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import CommerceItemImage from '@/components/commerce/CommerceItemImage.vue'
import CommerceShopBar from '@/components/commerce/CommerceShopBar.vue'
import { formatCount, useRanchActions, useRanchLoader } from '@/components/ranch/ranch-shared'
import PurchaseDialog from '@/components/commerce/PurchaseDialog.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import RanchGate from '@/components/ranch/RanchGate.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useAccountStore } from '@/stores/account'
import { useRanchStore } from '@/stores/ranch'
import { useToastStore } from '@/stores/toast'
import { purchaseMaxCount } from '@/utils/purchase-count'

const props = defineProps<{ tab: 'shop' | 'market' | 'cans' }>()
const { state, loading } = storeToRefs(useRanchStore())
const { currentAccountId } = storeToRefs(useAccountStore())
const { disabled, request } = useRanchActions()
const toast = useToastStore()

const shopId = ref<number | 'all'>('all')
const query = ref('')
const canSlot = ref<number | 'all'>('all')
const shelf = ref<number | 'all'>('all')
const { refresh } = useRanchLoader(props.tab, () => ({ shopId: props.tab === 'market' ? undefined : 0 }))

const ACTION = { shop: 'buy', market: 'exchange', cans: 'buyMall' } as const
const VERB = { shop: '购买', market: '兑换', cans: '购买' } as const

const segments = computed(() => {
  if (props.tab === 'shop')
    return [{ key: 'all' as const, label: '全部' }, { key: 5, label: '幼崽' }, { key: 6, label: '饲料' }]
  if (props.tab === 'cans')
    return [{ key: 'all' as const, label: '全部' }, { key: 6, label: '礼包商城' }, { key: 7, label: '特惠商城' }]
  const shelves = [...(state.value?.market?.shelves || [])].sort((a: any, b: any) => a.sort - b.sort)
  return [{ key: 'all' as const, label: '全部' }, ...shelves.map((s: any) => ({ key: s.id as number, label: s.name }))]
})
const segment = computed(() => props.tab === 'shop' ? shopId.value : props.tab === 'cans' ? canSlot.value : shelf.value)
const category = computed({
  get: () => segment.value,
  set: (key: number | 'all') => {
    if (props.tab === 'shop')
      shopId.value = key
    else if (props.tab === 'cans')
      canSlot.value = key
    else if (props.tab === 'market')
      shelf.value = key
  },
})
const categoryOptions = computed(() => segments.value.map(({ key, label }) => ({ value: key, label })))

interface RanchGood {
  id: string
  name?: string
  reward: RanchItem
  rewards?: RanchItem[]
  price: RanchItem & { balance?: string | null }
  available: boolean
  free?: boolean
  maxCount?: number
  remaining?: number | null
  requiredLevel?: string | null
  shelfId?: number
  shopId?: number
  slotType?: number
  animal?: { husbandry_type: string } | null
}

const allGoods = computed<RanchGood[]>(() => {
  if (props.tab === 'shop')
    return state.value?.shop?.goods || []
  if (props.tab === 'cans')
    return state.value?.mall?.goods || []
  return state.value?.market?.goods || []
})
const goods = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return allGoods.value.filter((good) => {
    if (props.tab === 'shop' && shopId.value !== 'all' && good.shopId !== shopId.value)
      return false
    if (props.tab === 'cans' && canSlot.value !== 'all' && good.slotType !== canSlot.value)
      return false
    if (props.tab === 'market' && shelf.value !== 'all' && good.shelfId !== shelf.value)
      return false
    return (good.name || good.reward.name).toLowerCase().includes(keyword)
  })
})
const marketAbsent = computed(() => props.tab === 'market' && state.value?.market?.present === false)
/** 余额栏只列当前商品实际用到的货币（集市同时用便便和松果，罐头商城可能用钻石）。 */
const currencies = computed(() => {
  const result = new Map<number, { id: number, name: string, image: string, amount: number | null }>()
  for (const good of allGoods.value) {
    const id = Number(good.price?.id)
    if (good.free || !id || result.has(id))
      continue
    const owned = state.value?.currencies?.find((c: any) => Number(c.id) === id)
    const balance = good.price.balance ?? owned?.count
    result.set(id, { id, name: good.price.name, image: good.price.image, amount: balance === null || balance === undefined ? null : Number(balance) })
  }
  return [...result.values()]
})
function maxCount(good: RanchGood) {
  return purchaseMaxCount({
    cap: Number(good.maxCount ?? 999),
    limitRemaining: good.remaining ?? null,
    costs: good.free ? [] : [{ count: good.price.count, balance: balanceOf(good) }],
  })
}
function balanceOf(good: RanchGood) {
  return good.price.balance ?? state.value?.currencies?.find((c: any) => Number(c.id) === Number(good.price.id))?.count
}
function unavailableReason(good: RanchGood) {
  if (good.available)
    return ''
  if (good.remaining === 0)
    return '已售罄'
  if (good.requiredLevel && Number(state.value?.level) < Number(good.requiredLevel))
    return `需牧场 ${good.requiredLevel} 级`
  if (props.tab === 'market' && !state.value?.market?.present)
    return '未到访'
  return '暂不可购买'
}

const activeId = ref<string | null>(null)
function goodKey(good: RanchGood) {
  return `${good.shopId ?? good.slotType ?? ''}:${good.id}`
}
const active = computed(() => allGoods.value.find(good => goodKey(good) === activeId.value) ?? null)
const activeVerb = computed(() => active.value?.free ? '领取' : VERB[props.tab])
const dialogGoods = computed(() => {
  const good = active.value
  if (!good)
    return null
  const balance = balanceOf(good)
  return {
    id: goodKey(good),
    name: good.name || good.reward.name,
    rewards: good.rewards || [good.reward],
    price: { ...good.price, balance: balance ?? null },
    isFree: !!good.free,
    limit: good.remaining == null ? null : { remaining: good.remaining },
    purchasable: good.available && !disabled.value,
  }
})
watch([currentAccountId, segment], () => activeId.value = null)

function input(good: RanchGood, count: number) {
  return { goodsId: good.id, count, shopId: good.shopId, slotType: good.slotType }
}

function buy(good: RanchGood) {
  if (disabled.value || !good.available)
    return
  if (maxCount(good) < 1) {
    toast.error(balanceOf(good) == null ? '余额未确认，请刷新商品' : `${good.price.name}余额不足`)
    return
  }
  activeId.value = goodKey(good)
}

function scaled(item: RanchItem, count: number): RanchItem {
  return { ...item, count: (BigInt(item.count) * BigInt(count)).toString() }
}

function submit(count: number) {
  const good = active.value
  if (!good?.available || disabled.value || count > maxCount(good))
    return
  activeId.value = null
  void request(ACTION[props.tab], input(good, count), {
    costItems: good.free ? [] : [scaled(good.price, count)],
    rewards: (good.rewards || [good.reward]).map(reward => scaled(reward, count)),
  })
}

</script>

<template>
  <div class="panel-fill">
    <section class="mall-card page-card-surface rounded-2xl panel-scroll-layout margin-shell"><span class="margin-content">
      <div class="panel-titlebar shrink-0 margin-shell"><span class="margin-content">
        <CommerceShopBar
          class="mall-shopbar"
          :currencies="currencies"
          :loading="loading"
          :disabled="disabled"
          refresh-label="刷新商品"
          @refresh="refresh"
        >
          <template #actions>
            <BaseInput v-model="query" type="search" placeholder="输入名称搜索" />
            <BaseSelect v-model="category" :options="categoryOptions" fit-width aria-label="商品分类" />
          </template>
        </CommerceShopBar>
      </span></div>
      <div class="mall-body panel-scroll-body">
        <RanchGate @retry="refresh">
          <EmptyState v-if="marketAbsent" title="仓鼠驿站当前未到访" icon="i-carbon-store" />
          <EmptyState v-else-if="!goods.length && !loading" title="没有匹配的商品" description="换个分类或关键词试试" icon="i-carbon-search-locate" />

          <section v-else class="goods-grid" aria-live="polite">
            <article v-for="good in goods" :key="goodKey(good)" class="goods-card margin-shell" :class="{ 'is-unavailable': !good.available }"><span class="margin-content">
              <div class="goods-card__visual">
                <CommerceItemImage :src="good.reward.image" :alt="good.reward.name" size="md" />
              </div>
              <div class="goods-card__main">
                <div class="goods-card__title">
                  <h3 class="goods-card__name" :title="good.name || good.reward.name">
                    {{ good.name || good.reward.name }}
                  </h3>
                  <span v-if="good.animal?.husbandry_type" class="goods-card__housing">
                    {{ good.animal.husbandry_type }}
                  </span>
                </div>
                <div v-if="good.rewards && good.rewards.length > 1" class="goods-card__rewards">
                  <span class="reward-total">{{ good.rewards.length }}件</span>
                  <div class="goods-card__reward-track">
                    <span v-for="reward in good.rewards" :key="reward.id" class="reward-chip" :title="reward.name">
                      <CommerceItemImage :src="reward.image" :alt="reward.name" size="sm" /><b>×{{ formatCount(reward.count) }}</b>
                    </span>
                  </div>
                </div>
                <div v-else class="goods-card__single">
                  {{ good.reward.name }} <b>×{{ formatCount(good.reward.count) }}</b>
                </div>
                <div class="goods-card__meta">
                  <span v-if="good.remaining !== null && good.remaining !== undefined">剩余 {{ good.remaining }}</span>
                  <span v-if="!good.available" class="is-warn">{{ unavailableReason(good) }}</span>
                  <span v-else-if="good.requiredLevel && Number(good.requiredLevel) > 1">牧场 {{ good.requiredLevel }} 级</span>
                </div>
              </div>
              <div class="goods-card__buy">
                <div class="goods-price">
                  <strong v-if="good.free" class="goods-price__free">免费</strong>
                  <template v-else>
                    <CommerceItemImage :src="good.price.image" :alt="good.price.name" size="sm" />
                    <strong :title="good.price.name">{{ formatCount(good.price.count) }}</strong>
                  </template>
                </div>
                <NButton
                  size="small"
                  :type="maxCount(good) > 0 ? 'primary' : 'default'"
                  :secondary="!good.free"
                  :disabled="disabled || !good.available || maxCount(good) < 1"
                  @click="buy(good)"
                >
                  {{ good.free ? '领取' : VERB[tab] }}
                </NButton>
              </div>
            </span></article>
          </section>
        </RanchGate>
      </div>
    </span></section>

    <PurchaseDialog
      mall-typography
      :open="!!active"
      :goods="dialogGoods"
      :quantity-cap="active ? maxCount(active) : 0"
      :confirm-label="`确认${activeVerb}`"
      show-currency-name
      @close="activeId = null"
      @confirm="submit"
    />
  </div>
</template>

<style scoped src="../commerce/mall-goods.css"></style>

<style scoped>
.mall-card,
.mall-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mall-shopbar {
  flex: 1;
  min-width: 0;
}

.goods-card {
  --inset-top: 14px;
  --inset-right: 16px;
  --inset-bottom: 14px;
  --inset-left: 16px;
}

.goods-card__housing {
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
}
</style>
