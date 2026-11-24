<script setup lang="ts">
import type { MallCatalogDto, MallGoodsDto } from '@/stores/commerce'
import type { DogFoodInfo, PetInfo } from '@/stores/pet'
import { NButton } from 'naive-ui/es/button'
import { NInputNumber } from 'naive-ui/es/input-number'
import { NModal } from 'naive-ui/es/modal'
import { NTab } from 'naive-ui/es/tabs'
import { storeToRefs } from 'pinia'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import PurchaseDialog from '@/components/commerce/PurchaseDialog.vue'
import PageTabs from '@/components/PageTabs.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import OfflineState from '@/components/ui/OfflineState.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { useAccountPresence } from '@/composables/useReconnectRefresh'
import { useAccountStore } from '@/stores/account'
import { useBagStore } from '@/stores/bag'
import { usePetStore } from '@/stores/pet'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import { formatCompactAmount, formatNumber } from '@/utils/format-number'

const accountStore = useAccountStore()
const bagStore = useBagStore()
const petStore = usePetStore()
const statusStore = useStatusStore()
const toastStore = useToastStore()
const { currentAccountId } = storeToRefs(accountStore)
const { loading: statusLoading, realtimeConnected } = storeToRefs(statusStore)
const {
  snapshot,
  dogs,
  foods,
  activeDog,
  loading,
  usingFood,
  operatingDogId,
  protectLogs,
  protectLogsTotal,
  protectLogsLoading,
  claimingGifts,
  giftError,
  error,
} = storeToRefs(petStore)

const selectedFoodCounts = reactive<Record<number, number>>({})
const activePetTab = ref<'details' | 'protectLogs'>('details')
const showFeedingModal = ref(false)
/** 只有用户点击刷新才让图标转圈；页面/标签切换引起的自动加载不碰按钮，避免刷新图标闪烁。 */
const manualRefreshing = ref(false)
const petOffers = ref<Array<{ goods: MallGoodsDto, slotType: number, shop: 'pet' | 'props' | 'mall', membership?: MallCatalogDto['membership'] }>>([])
const petOfferError = ref('')
const selectedOffer = ref<(typeof petOffers.value)[number] | null>(null)
const buyingPetId = ref<number | null>(null)
let offerRequestVersion = 0

const presence = useAccountPresence()
const isOffline = computed(() => presence.value === 'offline')
const isConnected = computed(() => presence.value === 'online')
/** 宠物总数与 core/src/services/pets.ts 的 PET_IDS 一致；离线或尚未读到快照时用它撑起标题计数。 */
const PET_TOTAL = 6
const maxDuration = computed(() => Number(snapshot.value?.maxProtectDuration || 30 * 86400))
const protectDuration = computed(() => Math.max(0, Number(snapshot.value?.protectDuration || 0)))
const durationPercent = computed(() => Math.min(100, Math.round((protectDuration.value / maxDuration.value) * 100)))
const pendingGiftCount = computed(() => Math.max(0, Number(snapshot.value?.pendingGiftCount || 0)))
const ownedCount = computed(() => dogs.value.filter(dog => dog.owned).length)
// 离线时读不到宠物信息，已获得数不沿用旧快照
const rosterCount = computed(() => `${isConnected.value ? ownedCount.value : 0}/${dogs.value.length || PET_TOTAL}`)
const orderedDogs = computed(() => [
  ...dogs.value.filter(dog => dog.active),
  ...dogs.value.filter(dog => !dog.active),
])
const durationLow = computed(() => !!activeDog.value && protectDuration.value < 86400)

function formatDuration(secondsInput: unknown) {
  let seconds = Math.max(0, Math.floor(Number(secondsInput) || 0))
  const days = Math.floor(seconds / 86400)
  seconds %= 86400
  const hours = Math.floor(seconds / 3600)
  seconds %= 3600
  const minutes = Math.floor(seconds / 60)
  if (days > 0)
    return `${days}天${hours}小时${minutes}分`
  if (hours > 0)
    return `${hours}小时${minutes}分`
  return `${minutes}分`
}

function formatFoodDuration(seconds: number) {
  const days = Math.round(Number(seconds || 0) / 86400)
  return days > 0 ? `${days}天` : `${Math.max(1, Math.round(Number(seconds || 0) / 3600))}小时`
}

function formatProtectTime(timestamp: number) {
  if (!timestamp)
    return '时间未知'
  return new Date(timestamp * 1000).toLocaleString('zh-CN', { hour12: false })
}

/** 稀有度配色：4+ 金、3 蓝、2 绿，其余灰。 */
function rarityTone(pet: PetInfo) {
  if (pet.rarity >= 4)
    return 'is-gold'
  if (pet.rarity === 3)
    return 'is-blue'
  if (pet.rarity === 2)
    return 'is-green'
  return 'is-plain'
}

function maxUsableCount(food: DogFoodInfo) {
  if (!activeDog.value || food.duration <= 0)
    return 0
  const remaining = Math.max(0, maxDuration.value - protectDuration.value)
  return Math.max(0, Math.min(food.count, Math.floor(remaining / food.duration)))
}

function selectedCount(food: DogFoodInfo) {
  const max = maxUsableCount(food)
  const current = Math.trunc(Number(selectedFoodCounts[food.id] || 1))
  return Math.max(1, Math.min(max || 1, current))
}

function canUseFood(food: DogFoodInfo) {
  return !!currentAccountId.value && !!activeDog.value && food.count > 0 && maxUsableCount(food) > 0 && !usingFood.value
}

function feedTitle(food: DogFoodInfo) {
  if (!activeDog.value)
    return '请先上场宠物'
  if (food.count <= 0)
    return '狗盆中没有该狗粮'
  if (maxUsableCount(food) <= 0)
    return '狗粮时长已接近上限'
  return '从狗盆喂食'
}

const currencyIcons: Record<number, string> = {
  1001: '/game-config/resource-icons/gold.png',
  1002: '/game-config/resource-icons/coupon.png',
  1005: '/game-config/resource-icons/gold-bean.png',
}
const knownPetPrices: Record<number, { id: number, count: number, name: string, icon: string }> = {
  90002: { id: 1001, count: 500000, name: '金币', icon: '/game-config/resource-icons/gold.png' },
  90003: { id: 1001, count: 1000000, name: '金币', icon: '/game-config/resource-icons/gold.png' },
  90011: { id: 1005, count: 4800, name: '金豆', icon: '/game-config/resource-icons/gold-bean.png' },
}
function purchasableOffer(pet: PetInfo) {
  if (pet.owned || pet.activatable)
    return null
  return petOffers.value.find((offer) => {
    const expectedPrice = knownPetPrices[pet.id]
    return offer.goods.rewards.some(reward => reward.id === pet.id)
      && offer.goods.purchasable && offer.goods.purchaseStatus === 'available'
      && (!expectedPrice || (offer.goods.price.id === expectedPrice.id && offer.goods.price.count === expectedPrice.count))
  }) || null
}

const shopPetIds = new Set([90002, 90003, 90011])
function hasPurchaseEntry(pet: PetInfo) {
  return !pet.owned && !pet.activatable && (shopPetIds.has(pet.id) || !!purchasableOffer(pet))
}

function petDisplayPrice(pet: PetInfo) {
  const offerPrice = petOffers.value.find(offer =>
    offer.goods.rewards.some(reward => reward.id === pet.id),
  )?.goods.price
  if (offerPrice)
    return { ...offerPrice, image: currencyIcons[offerPrice.id] || offerPrice.image }
  const known = knownPetPrices[pet.id]
  if (known)
    return { name: known.name, count: known.count, image: known.icon }
  return null
}

function operationTitle(pet: PetInfo) {
  if (pet.owned)
    return pet.active ? '收回当前宠物' : '将该宠物上场'
  if (pet.activatable)
    return '消耗背包中的宠物卡激活该宠物'
  return hasPurchaseEntry(pet) ? `查询并购买 ${pet.name} 的宠物卡` : '当前没有可购买的宠物卡'
}

function dogActionLabel(pet: PetInfo) {
  if (pet.owned)
    return pet.active ? '收回' : '上场'
  return pet.activatable ? '激活' : hasPurchaseEntry(pet) ? '购买' : '限定'
}

function dogActionType(pet: PetInfo): 'default' | 'info' | 'success' | 'warning' {
  if (!pet.owned)
    return pet.activatable || hasPurchaseEntry(pet) ? 'info' : 'default'
  return pet.active ? 'warning' : 'success'
}

function dogStatusLabel(pet: PetInfo) {
  if (pet.active)
    return '上场中'
  if (pet.owned)
    return '已获得'
  return pet.activatable ? '待激活' : purchasableOffer(pet) ? '可购买' : hasPurchaseEntry(pet) ? '待查询商品' : '未获得'
}

function isPetLocked(pet: PetInfo) {
  return !pet.owned && !pet.activatable && !hasPurchaseEntry(pet)
}

async function loadPetOffers(accountId: string) {
  const version = ++offerRequestVersion
  petOffers.value = []
  petOfferError.value = ''
  if (!accountId || !isConnected.value)
    return
  const shops = [
    { url: '/api/pet-shop', params: undefined, slotType: 0, shop: 'pet' as const },
    { url: '/api/game-mall', params: { slotType: 1, subSlotType: 1 }, slotType: 1, shop: 'mall' as const },
    { url: '/api/props-shop', params: undefined, slotType: 0, shop: 'props' as const },
  ]
  const results = await Promise.allSettled(shops.map(async (shop) => {
    const response = await api.get(shop.url, { headers: { 'x-account-id': accountId }, params: shop.params, skipErrorToast: true } as any)
    if (!response.data?.ok)
      throw new Error(getApiErrorMessage(response.data, '商城加载失败'))
    const catalog = response.data.data as MallCatalogDto
    return catalog.goods.map(goods => ({ goods, slotType: shop.slotType, shop: shop.shop, membership: catalog.membership }))
  }))
  if (version !== offerRequestVersion || accountId !== currentAccountId.value || !isConnected.value)
    return
  petOffers.value = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
  const failed = results[0]
  if (failed?.status === 'rejected') {
    petOfferError.value = failed.reason instanceof Error ? failed.reason.message : '宠物商店加载失败'
  }
  else if (!petOffers.value.some(offer => [90002, 90003, 90011].some(id => offer.goods.rewards.some(reward => reward.id === id)))) {
    petOfferError.value = '当前商店未返回牧羊犬、斑点狗或柯基的商品，请核对当前账号的商店目录'
  }
}

async function purchasePet(count: number) {
  const offer = selectedOffer.value
  const accountId = String(currentAccountId.value || '')
  if (!offer || !accountId || buyingPetId.value !== null || !isConnected.value)
    return
  buyingPetId.value = offer.goods.id
  try {
    const response = await api.post(offer.shop === 'pet' ? '/api/pet-shop/purchase'
      : offer.shop === 'props' ? '/api/props-shop/purchase' : '/api/game-mall/purchase', {
      goodsId: offer.goods.id,
      count,
      ...(offer.shop !== 'mall'
        ? { expectedOffer: { price: { id: offer.goods.price.id, count: offer.goods.price.count }, rewards: offer.goods.rewards.map(reward => ({ id: reward.id, count: reward.count })) } }
        : { slotType: offer.slotType, expectedPrice: { id: offer.goods.price.id, count: offer.goods.price.count, rewards: offer.goods.rewards.map(reward => ({ id: reward.id, count: reward.count })) } }),
    }, { headers: { 'x-account-id': accountId }, skipErrorToast: true } as any)
    if (!response.data?.ok)
      throw new Error(getApiErrorMessage(response.data, '购买失败'))
    if (accountId !== currentAccountId.value || !isConnected.value)
      return
    selectedOffer.value = null
    toastStore.success(`购买成功：${offer.goods.name} x${count}`)
    await Promise.all([petStore.fetchPetInfo(accountId), bagStore.fetchBag(accountId), loadPetOffers(accountId)])
  }
  catch (cause) {
    if (accountId === currentAccountId.value && isConnected.value)
      toastStore.error(getApiErrorMessage(cause, '购买失败'))
  }
  finally {
    buyingPetId.value = null
  }
}

async function handlePetOperation(pet: PetInfo) {
  if (operatingDogId.value || buyingPetId.value !== null || isPetLocked(pet))
    return
  if (!pet.owned && !pet.activatable) {
    const accountId = currentAccountId.value
    let offer = purchasableOffer(pet)
    if (!offer) {
      buyingPetId.value = pet.id
      try {
        await loadPetOffers(accountId)
        if (accountId !== currentAccountId.value || !isConnected.value)
          return
        offer = purchasableOffer(pet)
      }
      finally {
        buyingPetId.value = null
      }
    }
    if (offer)
      selectedOffer.value = {
        ...offer,
        goods: { ...offer.goods, price: { ...offer.goods.price, image: currencyIcons[offer.goods.price.id] || offer.goods.price.image } },
      }
    else
      toastStore.warning(knownPetPrices[pet.id] && petOffers.value.some(item => item.goods.rewards.some(reward => reward.id === pet.id))
        ? `${pet.name}的商店报价与游戏内价格不一致，未发起购买`
        : petOfferError.value || `当前商店没有可购买的 ${pet.name}，未发起购买`)
    return
  }
  if (!pet.owned) {
    const activated = await petStore.activateDog(currentAccountId.value, pet.id)
    if (activated)
      toastStore.success(`已激活 ${pet.name}`)
    else
      toastStore.error(error.value || '激活宠物失败')
    return
  }
  const result = pet.active
    ? await petStore.withdrawDog(currentAccountId.value, pet.id)
    : await petStore.deployDog(currentAccountId.value, pet.id)
  if (result)
    toastStore.success(pet.active ? `已收回 ${pet.name}` : `已上场 ${pet.name}`)
  else
    toastStore.error(error.value || (pet.active ? '收回宠物失败' : '上场宠物失败'))
}

function loadStatusIfNeeded() {
  const id = currentAccountId.value
  if (id && !realtimeConnected.value)
    void statusStore.fetchStatus(id)
}

async function refreshPetInfo() {
  if (manualRefreshing.value)
    return

  const id = String(currentAccountId.value || '')
  if (!id || !isConnected.value)
    return

  manualRefreshing.value = true
  try {
    // 守护记录依赖宠物快照；还没快照时先读宠物，拿到快照后由 watch 补读记录
    if (activePetTab.value === 'protectLogs' && snapshot.value) {
      await loadProtectLogs()
      return
    }
    await Promise.all([petStore.fetchPetInfo(id), loadPetOffers(id)])
  }
  finally {
    manualRefreshing.value = false
  }
}

async function handleClaimGifts() {
  const id = String(currentAccountId.value || '')
  if (!id || claimingGifts.value)
    return

  const result = await petStore.claimDogSkillGifts(id)
  if (!result) {
    toastStore.error(giftError.value || '拾取同气连枝礼包失败')
    return
  }

  const claimed = Math.max(0, Number(result.claimed || 0))
  if (claimed > 0)
    toastStore.success(`已拾取同气连枝礼包 x${claimed}`)
  else
    toastStore.warning('当前没有待拾取的同气连枝礼包')
}

async function handleUseFood(food: DogFoodInfo) {
  if (!canUseFood(food))
    return
  const count = selectedCount(food)
  const result = await petStore.useDogFood(currentAccountId.value, food.id, count)
  if (result) {
    toastStore.success(`已从狗盆喂食 ${food.name} x${count}`)
    if (isConnected.value)
      await bagStore.fetchBag(currentAccountId.value)
  }
  else {
    toastStore.error(error.value || '使用狗粮失败')
  }
}

async function loadProtectLogs() {
  const id = String(currentAccountId.value || '')
  if (!id || !isConnected.value || !snapshot.value?.guardianRecordsSupported || protectLogsLoading.value)
    return
  const ok = await petStore.fetchProtectLogs(id)
  if (!ok && id === currentAccountId.value && !isOffline.value)
    toastStore.error(error.value || '获取守护记录失败')
}

function setUseCount(food: DogFoodInfo, value: number | null) {
  selectedFoodCounts[food.id] = Math.max(1, Math.trunc(Number(value) || 1))
}

onMounted(loadStatusIfNeeded)
watch([activePetTab, snapshot], ([tab, petSnapshot]) => {
  if (tab === 'protectLogs' && petSnapshot?.guardianRecordsSupported)
    void loadProtectLogs()
})
watch(currentAccountId, () => {
  activePetTab.value = 'details'
  showFeedingModal.value = false
  selectedOffer.value = null
  petOffers.value = []
  ++offerRequestVersion
  petStore.clear()
  loadStatusIfNeeded()
})

watch([currentAccountId, presence], ([id, next]) => {
  if (next === 'offline') {
    selectedOffer.value = null
    petOffers.value = []
    ++offerRequestVersion
    petStore.clear()
  }
  else if (next === 'online') {
    void petStore.fetchPetInfo(id)
    void loadPetOffers(id)
  }
}, { immediate: true })
</script>

<template>
  <div
    class="pet-page pet-panel-card page-card-surface rounded-2xl panel-scroll-layout margin-shell"
    :class="{ 'pet-page--protect-logs': activePetTab === 'protectLogs' }"
  ><span class="margin-content">
    <PageTabs v-model:value="activePetTab">
      <NTab name="details">
        <span class="inline-flex items-center gap-2"><span class="i-carbon-dog-walker" />宠物管理</span>
      </NTab>
      <NTab name="protectLogs">
        <span class="inline-flex items-center gap-2"><span class="i-carbon-security" />守护记录</span>
      </NTab>
    </PageTabs>

    <div class="pet-toolbar panel-titlebar shrink-0 margin-shell"><span class="margin-content">
      <h3 v-if="activePetTab === 'details'" id="pet-roster-title" class="pet-roster__title">
        全部宠物<small>({{ rosterCount }})</small>
      </h3>
      <p v-else class="protect-log-summary protect-log-summary--toolbar">
        共 {{ protectLogsTotal }} 条记录
      </p>
      <div class="pet-toolbar__actions">
        <NButton
          v-if="activePetTab === 'details'"
          secondary
          title="喂食"
          aria-label="喂食"
          :disabled="!isConnected || !activeDog || usingFood"
          @click="showFeedingModal = true"
        >
          <template #icon>
            <span class="i-carbon-restaurant" />
          </template>
          喂食
        </NButton>
        <RefreshButton
          title="刷新宠物信息"
          :loading="manualRefreshing"
          :disabled="!isConnected"
          @click="refreshPetInfo"
        />
      </div>
    </span></div>

    <div class="panel-scroll-body panel-scroll-body--bleed">
      <template v-if="activePetTab === 'details'">
      <EmptyState v-if="!currentAccountId" title="请先选择账号" description="选择账号后查看宠物与狗粮" icon="i-carbon-dog-walker" />
      <OfflineState v-else-if="isOffline" />
      <EmptyState v-else-if="loading || statusLoading || presence === 'unknown'" title="正在读取宠物信息" icon="i-svg-spinners-90-ring-with-bg" />
      <EmptyState v-else-if="error && !snapshot" title="获取宠物数据失败" :description="error" icon="i-carbon-warning-alt">
        <NButton secondary @click="refreshPetInfo">
          重新加载
        </NButton>
      </EmptyState>

      <!-- 宠物名册只在拿到快照后展示；离线时拿不到宠物信息，不能显示“暂无宠物” -->
      <template v-else-if="snapshot">
        <section id="pet-roster" class="pet-roster" aria-labelledby="pet-roster-title">
          <div v-if="petOfferError" class="pet-offer-error">宠物商店：{{ petOfferError }}</div>
          <EmptyState v-if="!dogs.length" bare title="暂无宠物" icon="i-carbon-dog-walker" />
          <ul v-else class="pet-list panel-list list-divider">
            <li
              v-for="pet in orderedDogs" :key="pet.id" class="pet-row margin-shell"
              :class="{ 'is-active': pet.active, 'is-locked': isPetLocked(pet) }"
            ><span class="margin-content">
              <div class="pet-row__identity">
                <div class="pet-row__avatar">
                  <img :src="pet.image" :alt="pet.name" loading="lazy">
                  <span v-if="isPetLocked(pet)" class="pet-row__lock i-carbon-locked" aria-hidden="true" />
                </div>
                <strong class="pet-row__name">{{ pet.name }}</strong>
                <div class="pet-row__meta">
                  <span class="pet-rarity" :class="rarityTone(pet)">{{ pet.rarityLabel }}</span>
                  <span class="pet-row__status" :class="{ 'is-active': pet.active, 'is-owned': pet.owned || pet.activatable }">
                    <span class="pet-dot" :class="{ 'is-active': pet.active, 'is-owned': pet.owned || pet.activatable }" aria-hidden="true" />{{ dogStatusLabel(pet) }}
                  </span>
                </div>
              </div>
              <ul class="pet-skills pet-row__skills">
                <li v-for="skill in pet.skills" :key="skill.name">
                  <strong>{{ skill.name }}</strong>
                  <span v-if="skill.remainingCount !== undefined && skill.dailyLimit" class="pet-usage">今日剩余 {{ skill.remainingCount }}/{{ skill.dailyLimit }}</span>
                  <p>{{ skill.description }}</p>
                </li>
              </ul>
              <div class="pet-row__obtain">
                <small>获得条件</small>
                <p v-if="petDisplayPrice(pet)" class="pet-row__price" :title="`${petDisplayPrice(pet)!.name} ${formatNumber(petDisplayPrice(pet)!.count)}`">
                  <img :src="petDisplayPrice(pet)!.image" :alt="petDisplayPrice(pet)!.name" loading="lazy">
                  <span class="resource-amount">{{ formatCompactAmount(petDisplayPrice(pet)!.count) }}</span>
                </p>
                <p v-else>{{ pet.obtainCondition || '—' }}</p>
              </div>
              <NButton
                class="pet-row__action control-fit-content" size="small"
                :type="dogActionType(pet)"
                secondary
                :loading="operatingDogId === pet.id || buyingPetId === pet.id" :disabled="!!isPetLocked(pet) || !!operatingDogId || buyingPetId !== null"
                :title="operationTitle(pet)" @click="handlePetOperation(pet)"
              >
                {{ dogActionLabel(pet) }}
              </NButton>
            </span></li>
          </ul>
        </section>

        <div v-if="pendingGiftCount > 0 || giftError" class="pet-gift" :role="giftError ? 'alert' : undefined">
          <span class="pet-gift__icon i-carbon-gift" aria-hidden="true" />
          <p>
            <strong>同气连枝礼包 ×{{ pendingGiftCount }}</strong>
            <span>{{ giftError || '拾取后奖励存入背包' }}</span>
          </p>
          <NButton v-if="pendingGiftCount > 0" size="small" type="warning" :loading="claimingGifts" :disabled="!isConnected" @click="handleClaimGifts">
            全部拾取
          </NButton>
        </div>
      </template>
    </template>

    <section v-else class="protect-log-panel">
      <EmptyState v-if="!currentAccountId" title="请先选择账号" description="选择账号后查看守护记录" icon="i-carbon-security" />
      <OfflineState v-else-if="isOffline" />
      <EmptyState v-else-if="loading || statusLoading || presence === 'unknown'" title="正在读取宠物信息" icon="i-svg-spinners-90-ring-with-bg" />
      <EmptyState v-else-if="error && !snapshot" title="获取宠物数据失败" :description="error" icon="i-carbon-warning-alt">
        <NButton secondary @click="refreshPetInfo">
          重新加载
        </NButton>
      </EmptyState>
      <EmptyState v-else-if="!snapshot?.guardianRecordsSupported" title="暂不支持守护记录" icon="i-carbon-security" />
      <EmptyState v-else-if="protectLogsLoading" title="正在读取守护记录" icon="i-svg-spinners-90-ring-with-bg" />
      <EmptyState v-else-if="error" tone="error" title="获取守护记录失败" :description="error" icon="i-carbon-warning-alt">
        <NButton secondary @click="loadProtectLogs">
          重新加载
        </NButton>
      </EmptyState>
      <EmptyState v-else-if="!protectLogs.length" bare title="暂无守护记录" :description="`共 ${protectLogsTotal} 条记录`" icon="i-carbon-security" />
      <template v-else>
        <ul class="protect-log-list panel-list list-divider">
          <li v-for="logItem in protectLogs" :key="logItem.id" class="protect-log-row margin-shell"><span class="margin-content">
            <img v-if="logItem.friendAvatar" :src="logItem.friendAvatar" :alt="logItem.friendName" class="protect-log-avatar">
            <span v-else class="protect-log-avatar protect-log-avatar--empty"><span class="i-carbon-user" aria-hidden="true" /></span>
            <div class="protect-log-copy">
              <p><strong>{{ logItem.dogName || '宠物' }}</strong> 拦下了 <strong>{{ logItem.friendName }}</strong> 的摘取</p>
              <span>拦截果实 {{ logItem.stolenCount }} · 守护金币 {{ logItem.protectedGold }}</span>
            </div>
            <time>{{ formatProtectTime(logItem.timestamp) }}</time>
          </span></li>
        </ul>
      </template>
    </section>
    </div>

    <PurchaseDialog
      :open="isConnected && !!selectedOffer"
      :goods="selectedOffer?.goods || null"
      :show-currency-name="true"
      :hide-rewards="true"
      :pending="buyingPetId !== null"
      @close="selectedOffer = null"
      @confirm="purchasePet"
    />

    <NModal
      v-model:show="showFeedingModal"
      preset="card"
      title="喂食"
      class="pet-feeding-modal"
      :bordered="false"
      :style="{ width: 'min(640px, calc(100vw - 32px))', maxHeight: 'min(760px, calc(100vh - 32px))' }"
    >
      <div class="pet-bowl pet-feeding-bowl">
        <div v-if="activeDog" class="pet-bowl__meter">
          <div class="pet-bowl__label">
            <span>狗粮剩余</span>
            <strong :class="{ 'is-low': durationLow }">{{ formatDuration(protectDuration) }}</strong>
          </div>
          <div
            class="pet-bowl__track ui-progress-track" :class="{ 'is-low': durationLow }" role="progressbar" aria-label="狗粮剩余时间"
            aria-valuemin="0" aria-valuemax="100" :aria-valuenow="durationPercent"
          >
            <span :style="{ width: `${durationPercent}%` }" />
          </div>
          <small>上限 {{ formatFoodDuration(maxDuration) }} · 已存 {{ durationPercent }}%</small>
        </div>
        <p v-else class="pet-bowl__empty">
          请先让一只宠物上场，再进行喂食
        </p>

        <ul v-if="foods.length" class="pet-foods" aria-label="狗盆里的狗粮">
          <li v-for="food in foods" :key="food.id" class="pet-food">
            <img :src="food.image" :alt="food.name" loading="lazy">
            <div class="pet-food__copy">
              <strong>{{ food.name }}</strong>
              <span>每份 +{{ formatFoodDuration(food.duration) }} · 库存 {{ food.count }}</span>
            </div>
            <NInputNumber
              :value="selectedCount(food)" :min="1" :max="Math.max(1, maxUsableCount(food))" size="small"
              :disabled="!canUseFood(food)" class="pet-food__count" :aria-label="`${food.name}喂食份数`"
              @update:value="value => setUseCount(food, value)"
            />
            <NButton size="small" type="primary" :loading="usingFood" :disabled="!canUseFood(food)" :title="feedTitle(food)" @click="handleUseFood(food)">
              喂食
            </NButton>
          </li>
        </ul>
        <p v-else class="pet-bowl__empty">
          狗盆里暂无狗粮
        </p>
      </div>
    </NModal>
  </span></div>
</template>

<style scoped>
.pet-page {
  container: pet-page / inline-size;
  color: var(--ui-ink);
}

.pet-panel-card {
  --panel-pad: 16px;
  display: flex;
  flex-direction: column;
  --inset-top: var(--panel-pad); --inset-right: var(--panel-pad); --inset-bottom: var(--panel-pad); --inset-left: var(--panel-pad);
}

.protect-log-panel {
  display: flex;
  flex-direction: column;
}

h3,
p {
  margin: 0;
}

/* —— 工具栏 —— 格式走全局 .panel-titlebar，这里只把按钮组推到最右。 */
.pet-toolbar__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.pet-toolbar :deep(.n-button) {
  width: auto;
  flex: 0 0 auto;
}

.pet-toolbar :deep(.n-button__content) {
  gap: 4px;
  white-space: nowrap;
}

/* —— 通用小件 —— */
.pet-rarity {
  display: inline-flex;
  flex: none;
  align-items: center;
  padding: 0 7px;
  border-radius: 999px;
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-600);
  line-height: 18px;
  white-space: nowrap;
}

.pet-rarity.is-gold {
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
}

.pet-rarity.is-blue {
  color: var(--ui-blue);
  background: var(--ui-blue-soft);
}

.pet-rarity.is-green {
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

.pet-rarity.is-plain {
  color: var(--ui-muted);
  background: var(--ui-surface-soft);
}

.pet-dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 999px;
  background: var(--ui-subtle);
}

.pet-dot.is-owned {
  background: color-mix(in srgb, var(--ui-primary) 60%, transparent);
}

.pet-dot.is-active {
  background: var(--ui-primary);
  box-shadow: 0 0 0 3px var(--ui-primary-soft);
}

.pet-skills {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pet-skills strong {
  color: var(--ui-ink);
  font-size: var(--ui-font-size-small-13);
  font-weight: var(--fw-650);
}

.pet-skills p {
  margin-top: 2px;
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
  line-height: 1.6;
}

.pet-usage {
  display: inline-flex;
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-600);
  line-height: 18px;
  font-variant-numeric: tabular-nums;
  vertical-align: 1px;
}

/* —— 看家状态卡 —— */
.pet-home {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-card);
  background: var(--ui-surface);
  box-shadow:
    inset 0 1px 0 var(--glass-highlight),
    var(--ui-shadow-sm);
}

.pet-home .pet-skills {
  margin-top: 2px;
}

.pet-bowl {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 14px;
  padding: 20px 22px;
  border-left: 1px solid var(--ui-border);
  background: var(--ui-surface-soft);
}

.pet-feeding-bowl {
  border-left: 0;
  border-radius: var(--ui-radius-card);
}

.pet-bowl__meter {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pet-bowl__label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.pet-bowl__label strong {
  color: var(--ui-primary);
  font-size: var(--ui-font-size-large-15);
  font-weight: var(--fw-700);
  font-variant-numeric: tabular-nums;
}

.pet-bowl__label strong.is-low {
  color: var(--ui-warning);
}

.pet-bowl__track {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-ink) 8%, transparent);
}

.pet-bowl__track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--ui-primary);
  transition: width var(--spring-drag-duration) var(--spring-drag);
}

.pet-bowl__track.is-low span {
  background: var(--ui-warning);
}

.pet-bowl__meter small {
  color: var(--ui-subtle);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-variant-numeric: tabular-nums;
}

.pet-foods {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--ui-border);
  list-style: none;
}

.pet-food {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
}

.pet-food + .pet-food {
  border-top: 1px dashed var(--ui-border);
}

.pet-food img {
  width: 36px;
  height: 36px;
  flex: none;
  object-fit: contain;
}

.pet-food__copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.pet-food__copy strong {
  overflow: hidden;
  font-size: var(--ui-font-size-small-13);
  font-weight: var(--fw-600);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pet-food__copy span {
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-variant-numeric: tabular-nums;
}

.pet-food__count {
  width: 88px;
  flex: none;
}

.pet-bowl__empty {
  padding-top: 12px;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-muted);
  font-size: var(--ui-font-size-small-13);
}

.pet-gift {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  gap: 12px;
  padding: 12px 24px;
  border-top: 1px solid var(--ui-border);
  background: var(--ui-warning-soft);
}

.pet-gift__icon {
  flex: none;
  color: var(--ui-warning);
  font-size: var(--ui-font-size-large-15);
}

.pet-gift p {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 10px;
}

.pet-gift strong {
  font-size: var(--ui-font-size-medium-14);
  font-weight: var(--fw-650);
}

.pet-gift p span {
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

/* —— 全部宠物 —— */
.pet-roster {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
  container: pet-roster / inline-size;
}

.pet-offer-error {
  color: var(--error-color, #c24135);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.pet-roster__title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  margin: 0;
  font-size: var(--ui-font-size-medium-14);
  font-weight: var(--fw-650);
  white-space: nowrap;
}

.pet-roster__title small {
  color: var(--ui-subtle);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-400);
}

.pet-list {
  overflow: hidden;
  background: var(--ui-surface);
}

.pet-home,
.pet-gift,
.pet-roster > :not(.panel-list),
.protect-log-panel > :not(.panel-list),
.panel-scroll-body > :is(.empty-state, .offline-state) {
  margin-inline: var(--panel-pad);
}

/* 窄屏：身份块（头像 + 名称 + 稀有度/状态）与按钮一行，技能与获得条件在下方通栏 */
.pet-row {
  display: grid;
  grid-template-areas:
    'identity action'
    'skills   skills'
    'obtain   obtain';
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px 14px;
  --inset-top: 16px; --inset-right: 18px; --inset-bottom: 16px; --inset-left: 18px;
}

.pet-row:first-child {
  --inset-top: 12px;
}

/* 已上场的宠物不做背景区分，与其它行保持一致 */
.pet-row__avatar {
  position: relative;
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  grid-area: avatar;
  border-radius: 16px;
  background: var(--ui-surface-soft);
}

.pet-row__avatar img {
  width: 84%;
  height: 84%;
  object-fit: contain;
}

.pet-row.is-locked .pet-row__avatar img {
  filter: grayscale(1);
  opacity: 0.5;
}

.pet-row__lock {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 18px;
  height: 18px;
  padding: 3px;
  border-radius: 999px;
  color: #fff;
  background: var(--ui-muted);
  box-shadow: 0 0 0 2px var(--ui-surface-solid);
}

/* 身份块：头像与名称同列（名称居中落在图标下方），稀有度与获得状态只占图标所在行，
   因此整块与头像垂直居中平齐，不会被下方名称行拉低。
   使用网格而非 wrap flex，max-content 为各列相加的确定值，不会虚增列宽。 */
.pet-row__identity {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(52px, max-content) minmax(0, max-content);
  grid-template-areas:
    'avatar meta'
    'name   .';
  column-gap: 8px;
  row-gap: 4px;
  align-items: center;
  grid-area: identity;
}

.pet-row__name {
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  grid-area: name;
  color: var(--ui-ink);
  font-size: var(--ui-font-size-large-15);
  font-weight: var(--fw-650);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pet-row__meta {
  display: grid;
  min-width: 0;
  justify-items: start;
  gap: 4px;
  grid-area: meta;
}

.pet-row__status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-subtle);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.pet-row__status.is-owned {
  color: var(--ui-muted);
}

.pet-row__status.is-active {
  color: var(--ui-primary);
  font-weight: var(--fw-600);
}

.pet-row__skills {
  grid-area: skills;
}

.pet-row__obtain {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  grid-area: obtain;
}

.pet-row__obtain small {
  color: var(--ui-subtle);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.pet-row__obtain p {
  color: var(--ui-ink);
  font-size: var(--ui-content-item-font-height-tiny-12);
  line-height: 1.6;
}

.pet-row__obtain .pet-row__price {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-variant-numeric: tabular-nums;
}

.pet-row__price img {
  width: 18px;
  height: 18px;
  object-fit: contain;
}

.pet-row__action {
  justify-self: end;
  grid-area: action;
}

.pet-row.is-locked .pet-row__name,
.pet-row.is-locked .pet-skills strong {
  color: var(--ui-muted);
}

/* 宽屏：四列对齐的表格式行（身份块 / 技能 / 获得条件 / 按钮）。
   阈值 780px：左侧导航栏展开时内容区最窄约 818px，阈值必须低于它，
   否则拖着窗口变窄时会在「侧栏仍在」「侧栏已隐藏」之间反复横跳（多列 ⇄ 单列）。 */
@container pet-roster (min-width: 780px) {
  .pet-row {
    grid-template-areas: 'identity skills obtain action';
    /* 名称并入头像列、稀有度与状态另占一窄列：
       左侧占地从「52 + 被虚算撑宽的名称列」收缩为确定值，多出的宽度让给技能（1fr）。 */
    grid-template-columns: minmax(0, max-content) minmax(0, 1fr) minmax(200px, 280px) max-content;
    gap: 20px;
    --inset-left: 22px; --inset-right: 22px;
  }

  .pet-row__skills,
  .pet-row__obtain {
    align-self: center;
  }
}

/* —— 守护记录 —— */
.protect-log-summary {
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

/* 标题栏里的版本：同样式，左对齐即可。 */
.protect-log-summary--toolbar {
  margin: 0;
}

.protect-log-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.protect-log-row {
  display: flex;
  align-items: center;
  gap: 12px;
  --inset-top: 12px; --inset-right: var(--panel-pad); --inset-bottom: 12px; --inset-left: var(--panel-pad);
}

.protect-log-avatar {
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 999px;
  object-fit: cover;
}

.protect-log-avatar--empty {
  display: grid;
  place-items: center;
  color: var(--ui-subtle);
  background: var(--ui-surface-soft);
}

.protect-log-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  font-size: var(--ui-font-size-small-13);
  overflow-wrap: anywhere;
}

.protect-log-copy strong {
  font-weight: var(--fw-650);
}

.protect-log-copy span,
.protect-log-row time {
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-variant-numeric: tabular-nums;
}

.protect-log-row time {
  flex: none;
  color: var(--ui-subtle);
}

/* —— 窄屏 —— */
@container pet-page (max-width: 860px) {
  .pet-home {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .pet-bowl__track span {
    transition: none;
  }
}
</style>
