<script setup lang="ts">
import type { YishuHuanfuActivityDto, YishuHuanfuCatalogEntryDto, YishuHuanfuFriendShopDto } from '@/stores/activity-center'
import type { YishuHuanfuTabKey } from './center/yishu-huanfu-details'
import { computed, ref } from 'vue'
import { isYishuSaleTarget } from './center/yishu-huanfu-details'

const props = defineProps<{
  tab: YishuHuanfuTabKey
  activity: YishuHuanfuActivityDto | null
  pendingSell: boolean
  pendingExchange: boolean
  friendShops: YishuHuanfuFriendShopDto[]
  friendShopsLoading: boolean
  friendScanNote: string
  manualPending: number
}>()

const emit = defineEmits<{
  sell: [shop: YishuHuanfuFriendShopDto]
  exchange: [index: number, count: number]
  scanFriends: [force: boolean]
}>()

const busy = computed(() => props.pendingSell || props.pendingExchange)
const activity = computed(() => props.activity)
const sweetPotatoCount = computed(() => Number(activity.value?.sweetPotatoBalance || '0'))
const luckCoin = computed(() => Number(activity.value?.luckCoinBalance ?? '0'))
const canSell = computed(() => !!activity.value?.actions.sell.enabled && sweetPotatoCount.value > 0)
const catalog = computed(() => activity.value?.catalog || [])
const canExchange = computed(() => !!activity.value?.actions.exchange.enabled)
const comparedCount = computed(() => props.friendShops.filter(shop => !shop.quotePending).length)
// 兑换数量是逐档独立选择的：cmd 96 的 params 里本来就带 count，服务端按 count × 单价扣币。
// 兑换数量不再放在卡片上内联调整——卡片只留一个「兑换」按钮，
// 点开弹窗再填数量（参考同类工具的做法：避免误触一换就是多份）。
const exchangeTarget = ref<YishuHuanfuCatalogEntryDto | null>(null)
const exchangeQty = ref(1)

// 上限取「本档剩余可兑」和「福气币够买几次」的较小值；余额为 0 时仍然允许 1，交给服务端裁决。
function maxCountOf(entry: { index: number, price: string, limit: string }) {
  const price = Number(entry.price || '0')
  const limit = Number(entry.limit || '0')
  const byBalance = price > 0 ? Math.floor(luckCoin.value / price) : 1
  const byLimit = limit > 0 ? limit : Number.POSITIVE_INFINITY
  const max = Math.min(Number.isFinite(byBalance) ? byBalance : 1, byLimit)
  return Math.max(1, Number.isFinite(max) ? Math.floor(max) : 1)
}

const exchangeMax = computed(() => (exchangeTarget.value ? maxCountOf(exchangeTarget.value) : 1))
const exchangeCost = computed(() => {
  const entry = exchangeTarget.value
  if (!entry)
    return 0
  return Math.max(0, Math.floor(exchangeQty.value || 0)) * Number(entry.price || '0')
})
const exchangeBalance = computed(() => Math.max(0, luckCoin.value - exchangeCost.value))

function openExchange(entry: YishuHuanfuCatalogEntryDto) {
  if (busy.value || !canExchange.value || !canExchangeEntry(entry))
    return
  exchangeTarget.value = entry
  exchangeQty.value = 1
}

function closeExchange() {
  if (busy.value)
    return
  exchangeTarget.value = null
}

function stepExchange(delta: number) {
  const current = Math.max(1, Math.floor(exchangeQty.value || 1))
  exchangeQty.value = Math.min(exchangeMax.value, Math.max(1, current + delta))
}

function confirmExchange() {
  const entry = exchangeTarget.value
  if (!entry)
    return
  const qty = Math.min(exchangeMax.value, Math.max(1, Math.floor(exchangeQty.value || 1)))
  emit('exchange', entry.index, qty)
  exchangeTarget.value = null
}

function canExchangeEntry(entry: { index: number, price: string, limit: string, exchangeable: boolean }) {
  if (!entry.exchangeable)
    return false
  // 余额没读到时不要一棍子打死：放行到下单接口，由后端按真实余额给出准话。
  if (activity.value?.luckCoinBalance === null || activity.value?.luckCoinBalance === undefined)
    return true
  return Number(entry.price || '0') <= luckCoin.value
}

function formatNumber(value: string | number) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric))
    return String(value)
  return numeric.toLocaleString('zh-CN')
}

function formatPrice(value: string) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0)
    return value
  if (numeric >= 10000)
    return `${(numeric / 10000).toFixed(numeric % 10000 === 0 ? 0 : 1)}万`
  return numeric.toLocaleString('zh-CN')
}

function goodsTitle(entry: { index: number, name: string, nameKnown: boolean }) {
  return entry.nameKnown && entry.name ? entry.name : `兑换项 ${entry.index}`
}

</script>

<template>
  <div class="yshf-page">

    <template v-if="tab === 'shop'">
      <section aria-label="好友比价">
        <div class="compare-toolbar margin-shell">
          <div class="margin-content">
            <span class="compare-count">已比价 {{ comparedCount }} 家</span>
            <div class="compare-actions">
              <button type="button" class="yshf-button ghost compact" :disabled="friendShopsLoading || manualPending > 0 || busy" title="刷新基础价或加成为 0 的已查铺子" @click="emit('scanFriends', true)">
                {{ manualPending > 0 ? '刷新中…' : '重新比价' }}
              </button>
            </div>
          </div>
        </div>

        <ol v-if="friendShops.length" class="panel-list has-divider" role="list">
          <li v-for="(shop, index) in friendShops" :key="shop.gid" class="compare-row margin-shell">
            <div class="margin-content">
              <span class="compare-number" aria-hidden="true">{{ index + 1 }}</span>
              <div class="compare-name">
                <span class="compare-shop" :title="shop.name || shop.gid">{{ shop.name || shop.gid }}</span>
                <span v-if="shop.own" class="compare-meta">当前账号</span>
                <span v-else-if="shop.via === 'account'" class="compare-meta">已登录</span>
              </div>
              <span v-if="shop.quotePending" class="compare-quote">待查价</span>
              <span v-else class="compare-quote">
                <span class="compare-price">{{ formatNumber(shop.totalPrice) }}</span>（基础{{ formatNumber(shop.price) }}+加成{{ formatNumber(shop.bonus) }}），{{ shop.own ? '不限量' : `还可收 ${formatNumber(shop.canSell === false ? 0 : shop.quota)}` }}
              </span>
              <button
                type="button"
                class="catalog-buy"
                :aria-label="`出售给${shop.name || shop.gid}`"
                :disabled="busy || !canSell || !isYishuSaleTarget(shop)"
                @click="emit('sell', shop)"
              >
                出售
              </button>
            </div>
          </li>
        </ol>
        <p v-else-if="!friendShopsLoading" class="yshf-empty">{{ friendScanNote || '暂无报价。' }}</p>
      </section>
    </template>

    <section v-else-if="tab === 'store'" aria-label="福币商店">
      <div v-if="catalog.length" class="panel-list has-divider">
        <article v-for="entry in catalog" :key="entry.index" class="catalog-row margin-shell">
          <div class="margin-content">
            <span class="catalog-thumb">
              <img v-if="entry.image" :src="entry.image" alt="">
              <span v-else class="i-carbon-gift" aria-hidden="true" />
            </span>
            <span class="catalog-name">{{ goodsTitle(entry) }}</span>
            <span class="catalog-limit">限购 {{ entry.limit }}</span>
            <span class="catalog-price">{{ formatPrice(entry.price) }} 福气币 / 次</span>
            <button
              type="button"
              class="catalog-buy"
              :disabled="busy || !canExchange || !canExchangeEntry(entry)"
              @click="openExchange(entry)"
            >
              {{ canExchangeEntry(entry) ? '兑换' : (entry.exchangeable ? '福气币不足' : '暂不可兑') }}
            </button>
          </div>
        </article>
      </div>
      <p v-else class="yshf-empty">暂无兑换商品。</p>
    </section>

    <section v-else-if="tab === 'records'" aria-label="活动日志">
      <slot name="history" />
    </section>
  </div>

  <!-- 兑换数量弹窗：点卡片上的「兑换」才弹出，填完数量再提交，避免误触一换就是多份。 -->
  <Teleport to="body">
    <div v-if="exchangeTarget" class="exchange-mask" @click.self="closeExchange">
      <section class="exchange-dialog" role="dialog" aria-label="填写兑换数量">
        <header class="exchange-head">
          <div class="exchange-title">
            <img v-if="exchangeTarget.image" :src="exchangeTarget.image" :alt="goodsTitle(exchangeTarget)">
            <div>
              <span>{{ goodsTitle(exchangeTarget) }}</span>
              <span class="exchange-meta">{{ formatPrice(exchangeTarget.price) }} 福气币 / 个 · 限购 {{ exchangeTarget.limit }}</span>
            </div>
          </div>
          <button type="button" class="exchange-close" aria-label="关闭" @click="closeExchange">×</button>
        </header>

        <div class="exchange-qty">
          <label for="yshf-exchange-qty">兑换数量</label>
          <div class="exchange-stepper">
            <button type="button" :disabled="exchangeQty <= 1" aria-label="减少数量" @click="stepExchange(-1)">−</button>
            <input
              id="yshf-exchange-qty"
              v-model.number="exchangeQty"
              type="number"
              min="1"
              :max="exchangeMax"
              inputmode="numeric"
            >
            <button type="button" :disabled="exchangeQty >= exchangeMax" aria-label="增加数量" @click="stepExchange(1)">+</button>
            <button type="button" class="exchange-all" :disabled="exchangeMax <= 1" @click="exchangeQty = exchangeMax">
              全部
            </button>
          </div>
          <p class="exchange-hint">
            最多可兑 {{ exchangeMax }} 个（受剩余限购与福气币余额限制）
          </p>
        </div>

        <div class="exchange-summary">
          <span>合计</span>
          <span class="exchange-total">{{ formatNumber(exchangeCost) }} 福气币</span>
          <span class="exchange-balance">兑换后余额 {{ formatNumber(exchangeBalance) }}</span>
        </div>

        <footer class="exchange-actions">
          <button type="button" class="ghost" @click="closeExchange">取消</button>
          <button
            type="button"
            class="primary"
            :disabled="busy || exchangeQty < 1 || exchangeCost > luckCoin"
            @click="confirmExchange"
          >
            {{ busy ? '兑换中…' : `确认兑换 ${exchangeQty} 个` }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.yshf-page,
.exchange-mask {
  --yshf-accent: var(--ui-primary);
  --yshf-accent-fill: var(--ui-primary-fill);
}

:global(.dark) .yshf-button.ghost:hover:not(:disabled) {
  background: var(--ui-surface-strong);
}

.yshf-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  container-type: inline-size;
}

.yshf-page .panel-list,
.yshf-page :is(button, input) {
  font-size: inherit;
  font-weight: inherit;
}

.yshf-button {
  border-radius: var(--ui-radius-control);
  border: 1px solid var(--ui-border);
  color: var(--ui-ink);
  cursor: pointer;
  white-space: nowrap;
}

.yshf-button.ghost {
  background: var(--ui-surface-soft);
}

.catalog-buy:not(:disabled):hover,
.yshf-button.ghost:not(:disabled):hover {
  border-color: var(--ui-primary);
}

.exchange-actions .primary:not(:disabled):hover {
  background: color-mix(in srgb, var(--yshf-accent-fill) 88%, var(--ui-ink));
}

.yshf-button.compact {
  min-height: 30px;
  padding: 4px 10px;
}

.compare-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--ui-border);
  --inset-top: 10px;
  --inset-right: 16px;
  --inset-bottom: 10px;
  --inset-left: 16px;
}

.compare-count {
  flex: none;
}

.compare-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.panel-list > .catalog-row,
.panel-list > .compare-row {
  display: grid;
  align-items: center;
  min-width: 0;
  column-gap: 12px;
  row-gap: 4px;
  --inset-right: 16px;
  --inset-left: 16px;
}

.panel-list > .catalog-row {
  grid-template-columns: 32px minmax(0, 1fr) minmax(60px, auto) minmax(112px, auto) 82px;
  --inset-top: 9px;
  --inset-bottom: 9px;
}

.catalog-thumb {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: var(--ui-radius-control);
  background: var(--ui-surface-soft);
  color: var(--ui-muted);
}

.catalog-thumb img {
  width: 27px;
  height: 27px;
  object-fit: contain;
}

.catalog-name,
.compare-shop {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.catalog-limit,
.yshf-empty,
.compare-meta,
.compare-quote,
.compare-number {
  color: var(--ui-muted);
}

.catalog-buy {
  min-height: 26px;
  padding: 3px 8px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-control);
  background: var(--ui-surface-soft);
  color: var(--ui-ink);
  white-space: nowrap;
  cursor: pointer;
}

.catalog-buy:disabled,
.yshf-button:disabled {
  opacity: 0.45;
  cursor: default;
}

.yshf-empty {
  margin: 12px 16px;
}

.panel-list > .compare-row {
  grid-template-columns: 3ch minmax(0, 1fr) minmax(180px, auto) 52px;
  --inset-top: 4px;
  --inset-bottom: 4px;
}

.compare-name {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 6px;
}

.compare-meta {
  flex: none;
  white-space: nowrap;
}

.compare-number,
.compare-quote,
.catalog-price {
  font-variant-numeric: tabular-nums;
}

.compare-price,
.catalog-price {
  color: var(--ui-ink);
}

@container (max-width: 500px) {
  .panel-list > .catalog-row {
    grid-template-columns: 32px minmax(0, 1fr) auto;
  }

  .catalog-limit,
  .catalog-price {
    grid-column: 2;
  }

  .catalog-row .catalog-buy {
    grid-column: 3;
    grid-row: 1;
  }

  .panel-list > .compare-row {
    grid-template-columns: 3ch minmax(0, 1fr) 52px;
  }

  .compare-quote {
    grid-column: 2;
  }

  .compare-row .catalog-buy {
    grid-column: 3;
    grid-row: 1 / 3;
  }
}
/* 兑换数量弹窗 */
.exchange-mask {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(32, 22, 12, 0.42);
  backdrop-filter: blur(2px);
  color: var(--ui-ink);
  font-size: var(--ui-font-size-small-13);
  font-weight: var(--fw-400);
  --ui-disabled-button-weight: var(--fw-400);
}

.exchange-mask :is(button, input) {
  font: inherit;
}

.exchange-dialog {
  width: min(420px, 100%);
  padding: 18px 20px 16px;
  border-radius: 18px;
  background: var(--ui-surface-strong);
  box-shadow: var(--ui-shadow-lg, 0 24px 60px rgba(0, 0, 0, 0.28));
  border: 1px solid var(--ui-border-strong);
}

.exchange-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.exchange-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.exchange-title img {
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 12px;
  object-fit: contain;
  background: var(--ui-surface-soft);
}

.exchange-title div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.exchange-meta {
  color: var(--ui-muted);
}

.exchange-close {
  flex: none;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: var(--ui-surface-soft);
  color: var(--ui-muted);
  line-height: 1;
  cursor: pointer;
}

.exchange-qty {
  margin-top: 16px;
}

.exchange-qty > label {
  color: var(--ui-muted);
}

.exchange-stepper {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}

.exchange-stepper button {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 10px;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface-solid);
  color: var(--ui-ink);
  cursor: pointer;
}

.exchange-stepper button:disabled {
  color: var(--ui-muted);
  cursor: not-allowed;
}

.exchange-stepper input {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface-solid);
  color: var(--ui-ink);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.exchange-stepper input:focus {
  outline: 2px solid var(--yshf-accent);
  outline-offset: 1px;
}

.exchange-stepper .exchange-all {
  width: auto;
  padding: 0 12px;
}

.exchange-hint {
  margin: 8px 0 0;
  color: var(--ui-muted);
}

.exchange-summary {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--ui-surface-soft);
  border: 1px solid var(--ui-border);
}

.exchange-summary > :first-child,
.exchange-balance {
  color: var(--ui-muted);
}

.exchange-total {
  font-variant-numeric: tabular-nums;
}

.exchange-balance {
  margin-left: auto;
}

.exchange-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.exchange-actions button {
  flex: 1;
  height: 38px;
  border-radius: var(--ui-radius-control);
  cursor: pointer;
}

.exchange-actions .ghost {
  border: 1px solid var(--ui-border);
  background: var(--ui-surface-solid);
  color: var(--ui-muted);
}

.exchange-actions .primary {
  border: 1px solid var(--yshf-accent-fill);
  background: var(--yshf-accent-fill);
  color: #fff;
}

.exchange-actions .primary:disabled {
  border-color: var(--ui-border);
  background: var(--ui-surface-soft);
  color: var(--ui-muted);
  cursor: not-allowed;
}
</style>
