<script setup lang="ts">
import type { MysteryShopHistoryRecord } from '@/stores/commerce'
import { NButton } from 'naive-ui/es/button'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import CommerceItemImage from '@/components/commerce/CommerceItemImage.vue'
import CommerceShopBar from '@/components/commerce/CommerceShopBar.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import OfflineState from '@/components/ui/OfflineState.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { useAccountPresence, useReconnectRefresh } from '@/composables/useReconnectRefresh'
import { useAccountStore } from '@/stores/account'
import { useCommerceStore } from '@/stores/commerce'
import { formatCompactAmount } from '@/utils/format-number'

const accountStore = useAccountStore()
const commerceStore = useCommerceStore()
const { currentAccountId } = storeToRefs(accountStore)
const presence = useAccountPresence()
const isOffline = computed(() => presence.value === 'offline')
const { mystery, mysteryLoading, mysteryPurchasing, mysteryHistory, error, notice } = storeToRefs(commerceStore)
const clock = ref(Date.now())
const purchaseDialogOpen = ref(false)
let timer: number | undefined

const remaining = computed(() => {
  const end = mystery.value?.expireTime || 0
  const diff = Math.max(0, end - clock.value)
  if (!end || diff === 0)
    return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  const hours = Math.floor(diff / 3600000)
  const minutes = Math.floor((diff % 3600000) / 60000)
  const seconds = Math.floor((diff % 60000) / 1000)
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
})

const shopStatus = computed(() => {
  // 状态文案常驻标题栏、刷新键左侧：未到访/来访中/已离开三态都在这一行读。
  if (!mystery.value?.active || !mystery.value.npc)
    return '神秘商人暂未来访'
  return remaining.value ? `神秘商人来访中 · ${remaining.value} 后离开` : '神秘商人已离开'
})

// 四种货币由后端固定下发（金币、点券、金豆豆、钻石），与商人要用哪种货币付款无关。
const currencies = computed(() => (mystery.value?.currencies || []).map(currency => ({
  id: currency.id,
  name: currency.name,
  image: currency.image,
  amount: currency.balanceKnown ? currency.count : null,
})))

const discountLabel = computed(() => {
  const percent = mystery.value?.npc?.discountPercent || 0
  return percent > 0 ? `${(percent / 10).toFixed(percent % 10 ? 1 : 0)}折` : ''
})

const canPurchase = computed(() => {
  const npc = mystery.value?.npc
  return !!npc && npc.reward.count > 0 && (npc.price.balance === null || npc.price.balance >= npc.price.count)
})

const purchaseHint = computed(() => {
  const npc = mystery.value?.npc
  return npc && npc.price.balance !== null && npc.price.balance < npc.price.count ? '当前货币余额不足。' : ''
})

const buttonLabel = computed(() => mysteryPurchasing.value ? '购买中' : canPurchase.value ? '购买' : '暂不可购买')

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp)
}

// 折扣只在确有优惠时显示，避免每条记录都挂一个「10折」。
function recordDiscountLabel(record: MysteryShopHistoryRecord) {
  return record.discountPercent > 0 && record.discountPercent < 100
    ? `${(record.discountPercent / 10).toFixed(record.discountPercent % 10 ? 1 : 0)}折`
    : ''
}

// 商人状态与购买历史一起刷新：两者互不依赖，历史读失败也不影响当前货品展示。
function load() {
  const accountId = String(currentAccountId.value || '')
  void commerceStore.fetchMystery(accountId)
  void commerceStore.fetchMysteryHistory(accountId)
}

function purchase() {
  const npc = mystery.value?.npc
  if (!npc || !canPurchase.value || mysteryPurchasing.value)
    return
  purchaseDialogOpen.value = true
}

async function confirmPurchase() {
  const npc = mystery.value?.npc
  if (!npc || !canPurchase.value || mysteryPurchasing.value)
    return
  const succeeded = await commerceStore.purchaseMystery(String(currentAccountId.value || ''), npc.id)
  if (succeeded)
    purchaseDialogOpen.value = false
}

watch(currentAccountId, () => {
  purchaseDialogOpen.value = false
  mysteryHistory.value = []
  load()
})
watch(isOffline, (offline) => {
  if (offline)
    purchaseDialogOpen.value = false
})
// 重新上线时按一次刷新键
useReconnectRefresh(load)
onMounted(() => {
  mysteryHistory.value = []
  load()
  timer = window.setInterval(() => clock.value = Date.now(), 1000)
})
onUnmounted(() => {
  if (timer)
    window.clearInterval(timer)
})
</script>

<template>
  <div class="mystery-panel panel-fill">
    <section class="mystery-card page-card-surface rounded-2xl panel-scroll-layout margin-shell"><span class="margin-content">
      <div class="mystery-head panel-titlebar shrink-0 margin-shell"><span class="margin-content">
        <CommerceShopBar
          class="mystery-shopbar"
          :status="!isOffline && mystery ? shopStatus : undefined"
          :status-tone="mystery?.active && mystery.npc && remaining ? 'violet' : 'muted'"
          status-icon="i-carbon-hourglass"
          :currencies="currencies"
          :loading="mysteryLoading"
          :disabled="!currentAccountId || mysteryPurchasing"
          refresh-label="刷新神秘商人"
          @refresh="load"
        />
      </span></div>

      <div class="mystery-body panel-scroll-body panel-scroll-body--bleed">
        <div v-if="!isOffline && ((error && mystery) || notice)" class="shop-message" :class="{ 'is-success': !!notice && !error }" role="status">
          <span>{{ error || notice }}</span>
          <RefreshButton v-if="error" label="重新读取" size="small" @click="commerceStore.fetchMystery(currentAccountId)" />
        </div>

        <EmptyState v-if="!currentAccountId" title="请先选择账号" description="神秘商人按当前账号读取" icon="i-carbon-user-avatar" />
        <OfflineState v-else-if="isOffline" />
        <div v-else-if="mysteryLoading && !mystery" class="shop-loading">
          <span class="i-svg-spinners-90-ring-with-bg" />
        </div>
        <EmptyState v-else-if="error && !mystery" title="神秘商人读取失败" :description="error" tone="error" bare>
          <RefreshButton label="重新读取" :loading="mysteryLoading" @click="commerceStore.fetchMystery(currentAccountId)" />
        </EmptyState>

        <!-- 商人未在访时不再放空态占位，正文位置交给购买历史；未到访状态由标题栏文案说明。 -->
        <article v-else-if="mystery?.active && mystery.npc" class="merchant-card" aria-label="神秘商人商品">
          <!-- 来访状态条：标题栏已删，状态行同时承担折扣徽标。 -->
          <div class="merchant-status" role="status">
            <span class="merchant-status__icon i-carbon-hourglass" aria-hidden="true" />
            <span class="merchant-status__text">{{ shopStatus }}</span>
            <span v-if="discountLabel" class="merchant-discount">{{ discountLabel }}</span>
          </div>

          <div class="merchant-offer">
            <div class="merchant-offer__visual">
              <CommerceItemImage :src="mystery.npc.reward.image" :alt="mystery.npc.reward.name" size="md" />
            </div>
            <div class="merchant-offer__info">
              <h3 :title="`${mystery.npc.reward.name} #${mystery.npc.reward.id}`">
                <span class="merchant-offer__name">{{ mystery.npc.reward.name }}</span>
                <span class="merchant-offer__qty">×{{ mystery.npc.reward.count.toLocaleString() }}</span>
              </h3>
              <!-- 价格只保留下方带图标的一行：单价与总价重复，纯文本价格已去掉。 -->
              <div class="merchant-price">
                <CommerceItemImage :src="mystery.npc.price.image" :alt="mystery.npc.price.name" size="sm" />
                <strong :title="mystery.npc.price.name">{{ mystery.npc.price.count.toLocaleString() }}</strong>
                <del v-if="mystery.npc.originalPrice > mystery.npc.price.count">{{ mystery.npc.originalPrice.toLocaleString() }}</del>
              </div>
            </div>
            <div class="merchant-offer__buy">
              <NButton type="primary" :loading="mysteryPurchasing" :disabled="!canPurchase || mysteryPurchasing" @click="purchase">
                {{ buttonLabel }}
              </NButton>
            </div>
          </div>

          <p v-if="purchaseHint" class="merchant-hint" role="status">
            <span class="i-carbon-information" aria-hidden="true" />{{ purchaseHint }}
          </p>
        </article>

        <!-- 购买历史：商人未在访时占正文位置，在访时接在货品卡下方；超出高度在列表内部滚动。 -->
        <template v-if="currentAccountId && (mystery || mysteryHistory.length)">
          <p v-if="!mysteryHistory.length" class="history-empty">
            暂无购买记录，手动和自动购买都会记录在这里。
          </p>
          <ul v-else class="history-list panel-list has-divider" aria-label="购买历史">
            <li v-for="record in mysteryHistory" :key="record.id" class="history-row margin-shell"><span class="margin-content">
              <CommerceItemImage :src="record.itemImage" :alt="record.itemName" size="sm" fit-visible-pixels />
              <div class="history-row__main">
                <div class="history-row__name" :title="`${record.itemName} #${record.itemId}`">
                  {{ record.itemName }} <b>×{{ record.itemCount.toLocaleString() }}</b>
                </div>
                <div class="history-row__meta">
                  {{ formatTime(record.purchasedAt) }} · {{ record.source === 'auto' ? '自动购买' : '手动购买' }}
                </div>
              </div>
              <div class="history-row__cost">
                <div class="history-row__price">
                  {{ formatCompactAmount(record.price) }} {{ record.currencyName }}
                </div>
                <div v-if="recordDiscountLabel(record)" class="history-row__discount">
                  {{ recordDiscountLabel(record) }}
                </div>
              </div>
            </span></li>
          </ul>
        </template>
      </div>
    </span></section>

    <Teleport to="body">
      <Transition name="merchant-dialog">
        <div v-if="!isOffline && purchaseDialogOpen && mystery?.npc" class="purchase-overlay" role="presentation" @click.self="!mysteryPurchasing && (purchaseDialogOpen = false)">
          <section class="purchase-dialog mall-typography" role="dialog" aria-modal="true" aria-labelledby="mystery-purchase-title">
            <button class="dialog-close" type="button" aria-label="关闭" :disabled="mysteryPurchasing" @click="purchaseDialogOpen = false">
              <div class="i-carbon-close" />
            </button>
            <span class="dialog-kicker">神秘商人交易确认</span>
            <h2 id="mystery-purchase-title">
              确认购买这批商品？
            </h2>
            <div class="dialog-goods">
              <CommerceItemImage :src="mystery.npc.reward.image" :alt="mystery.npc.reward.name" size="lg" />
              <div><strong>{{ mystery.npc.reward.name }}</strong><span>获得 x{{ mystery.npc.reward.count }}</span></div>
            </div>
            <dl class="dialog-summary">
              <div><dt>需支付</dt><dd>{{ mystery.npc.price.count.toLocaleString() }} {{ mystery.npc.price.name }}</dd></div>
              <div><dt>支付后余额</dt><dd>{{ mystery.npc.price.balance === null ? '--' : Math.max(0, mystery.npc.price.balance - mystery.npc.price.count).toLocaleString() }}</dd></div>
            </dl>
            <div class="dialog-actions">
              <button type="button" :disabled="mysteryPurchasing" @click="purchaseDialogOpen = false">
                取消
              </button>
              <button type="button" class="dialog-confirm" :disabled="mysteryPurchasing || !canPurchase" @click="confirmPurchase">
                <div v-if="mysteryPurchasing" class="i-carbon-circle-dash animate-spin" />
                <div v-else class="i-carbon-shopping-cart-plus" />
                {{ mysteryPurchasing ? '购买中' : '确认购买' }}
              </button>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* 面板撑满页签内容区：卡片内上半是货币栏与货品，剩余高度交给购买历史列表。
   min-height: 0 必须保留，否则历史列表无法在内部滚动而会把页面整体顶高。 */
.mystery-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.mystery-card {
  gap: 14px;
}

.mystery-card:has(.history-list) {
  --inset-bottom: 0px;
}

.mystery-card:has(.history-list:first-child) {
  gap: 0;
}

.mystery-shopbar {
  flex: 1;
  min-width: 0;
}

/* 正文吃掉标题栏以下的剩余高度：货品卡按内容收缩，其余空间全给购买历史。 */
.mystery-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}

.mystery-body > :not(.history-list) {
  margin-inline: var(--panel-pad, 16px);
}

.mystery-body:has(.history-list) {
  gap: 0;
}

.mystery-body:has(.history-list) > :not(.history-list) + :not(.history-list) {
  margin-block-start: 14px;
}

.shop-loading {
  display: grid;
  min-height: 240px;
  place-items: center;
  color: var(--ui-primary);
  font-size: var(--ui-font-size-large-15);
}

.shop-message {
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

/* 来访状态条：样式沿用原标题行的底色与分隔线，去掉头像与标题后高度收窄。 */
.merchant-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--ui-border);
  background: linear-gradient(90deg, var(--ui-violet-soft), transparent 75%);
}

.merchant-status__icon {
  flex: none;
  color: var(--ui-violet);
  font-size: var(--ui-font-size-medium-14);
}

.merchant-status__text {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.merchant-discount {
  margin-left: auto;
  flex: none;
  padding: 2px 10px;
  border-radius: 999px;
  color: #fff;
  background: var(--ui-danger-fill);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-700);
  line-height: 20px;
}

.merchant-offer {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  padding: 18px;
}

.merchant-offer__visual {
  position: relative;
}

.merchant-offer__visual :deep(.item-image) {
  width: 84px;
  height: 84px;
  border: 0;
  border-radius: 20px;
}

.history-row :deep(.item-image) {
  width: 44px;
  height: 44px;
  border: 0;
}

.history-row :deep(.item-image img) {
  width: 100%;
  height: 100%;
}

.merchant-offer__qty {
  flex: none;
  color: var(--ui-muted);
  font-size: var(--ui-font-size-large-15);
  font-weight: var(--fw-700);
  font-variant-numeric: tabular-nums;
}

.merchant-offer__info {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.merchant-offer__info h3 {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  color: var(--ui-ink);
  font-size: var(--ui-font-size-large-15);
  font-weight: var(--fw-700);
}

.merchant-offer__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.merchant-offer__info p {
  margin: 0;
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-variant-numeric: tabular-nums;
}

.merchant-offer__info del,
.merchant-price del {
  margin-left: 6px;
  color: var(--ui-subtle);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.merchant-price {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  color: var(--ui-warning);
  font-size: var(--ui-font-size-large-15);
  font-variant-numeric: tabular-nums;
}

.merchant-price :deep(.item-image) {
  width: 24px;
  height: 24px;
  border: 0;
  background: transparent;
}

.merchant-offer__buy :deep(.n-button) {
  min-width: 96px;
}

.merchant-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  padding: 10px 18px 14px;
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.merchant-hint span {
  flex: none;
  margin-top: 3px;
}

/* 来访商人卡：与购买历史同在正文里，按内容收缩不参与弹性高度分配。 */
.merchant-card {
  width: 100%;
  min-width: 0;
  flex: none;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ui-violet) 22%, var(--ui-border));
  border-radius: var(--ui-radius-card);
  background: var(--ui-surface);
  box-shadow:
    inset 0 1px 0 var(--glass-highlight),
    var(--ui-shadow-sm);
}

/* 购买历史铺满正文宽度，分割线走全局 .has-divider 模板，超出高度在列表内部滚动。 */
.history-list {
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.history-empty {
  display: grid;
  flex: 1 1 auto;
  min-height: 0;
  place-items: center;
  margin-block: 12px;
  color: var(--ui-muted);
  font-size: var(--ui-font-size-small-13);
  text-align: center;
}

.history-row {
  display: flex;
  align-items: center;
  gap: 12px;
  --inset-right: 18px;
}

.history-row__main {
  min-width: 0;
  flex: 1;
}

.history-row__name {
  overflow: hidden;
  color: var(--ui-ink);
  font-size: var(--ui-font-size-small-13);
  font-weight: var(--fw-600);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-row__name b {
  color: var(--ui-muted);
  font-weight: var(--fw-600);
  font-variant-numeric: tabular-nums;
}

.history-row__meta {
  margin-top: 2px;
  color: var(--ui-subtle);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-variant-numeric: tabular-nums;
}

.history-row__cost {
  flex: none;
  text-align: right;
}

.history-row__price {
  color: var(--ui-ink);
  font-size: var(--ui-font-size-small-13);
  font-weight: var(--fw-600);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.history-row__discount {
  margin-top: 2px;
  color: var(--ui-warning);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.purchase-overlay {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(35, 47, 38, 0.32);
  -webkit-backdrop-filter: blur(5px);
  backdrop-filter: blur(5px);
}
.purchase-dialog {
  position: relative;
  width: min(420px, 100%);
  padding: 24px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  color: var(--ui-ink);
  background: var(--ui-surface-strong);
  box-shadow: var(--ui-shadow-lg);
}
.dialog-close {
  position: absolute;
  top: 14px;
  right: 14px;
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 9px;
  color: var(--ui-muted);
  background: var(--ui-surface);
  cursor: pointer;
}
.dialog-kicker {
  color: var(--ui-violet);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-700);
}
.purchase-dialog h2 {
  margin: 4px 42px 18px 0;
  font-size: var(--ui-font-size-large-15);
}
.dialog-goods {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface-soft);
}
.dialog-goods :deep(.item-image) {
  width: 64px;
  height: 64px;
}
.dialog-goods > div:last-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.dialog-goods strong {
  overflow: hidden;
  font-size: var(--ui-font-size-large-15);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dialog-goods span {
  margin-top: 3px;
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
}
.dialog-summary {
  margin: 14px 0 18px;
}
.dialog-summary > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 2px;
  border-bottom: 1px solid var(--ui-border);
}
.dialog-summary dt {
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
}
.dialog-summary dd {
  margin: 0;
  color: var(--ui-warning);
  font-weight: var(--fw-700);
}
.dialog-actions {
  display: grid;
  grid-template-columns: 1fr 1.45fr;
  gap: 9px;
}
.dialog-actions button {
  height: var(--ui-content-item-control-height-30);
  border: 1px solid var(--ui-border-strong);
  border-radius: 10px;
  color: var(--ui-ink);
  background: var(--ui-surface);
  font-weight: var(--fw-700);
  cursor: pointer;
}
.dialog-actions .dialog-confirm {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-color: var(--ui-primary);
  color: white;
  background: var(--ui-primary-fill);
}
.dialog-actions button:disabled,
.dialog-close:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.merchant-dialog-enter-active,
.merchant-dialog-leave-active {
  transition: opacity 0.16s ease;
}
.merchant-dialog-enter-active .purchase-dialog,
.merchant-dialog-leave-active .purchase-dialog {
  transition: transform 0.16s ease;
}
.merchant-dialog-enter-from,
.merchant-dialog-leave-to {
  opacity: 0;
}
.merchant-dialog-enter-from .purchase-dialog,
.merchant-dialog-leave-to .purchase-dialog {
  transform: translateY(8px) scale(0.98);
}
</style>
