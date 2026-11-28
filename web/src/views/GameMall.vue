<script setup lang="ts">
import { NTab } from 'naive-ui/es/tabs'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MallCatalogPanel from '@/components/commerce/MallCatalogPanel.vue'
import MysteryShopPanel from '@/components/commerce/MysteryShopPanel.vue'
import PageTabs from '@/components/PageTabs.vue'
import { useCommerceStore } from '@/stores/commerce'

type MallTab = 'mall' | 'svip' | 'mystery' | 'limited' | 'props'

const route = useRoute()
const router = useRouter()
const { purchasingGoodsId, mysteryPurchasing } = storeToRefs(useCommerceStore())
const tabs: Array<{ key: MallTab, label: string, icon: string }> = [
  { key: 'limited', label: '特惠商城', icon: 'i-carbon-timer' },
  { key: 'mall', label: '礼包商城', icon: 'i-carbon-shopping-bag' },
  { key: 'props', label: '道具商店', icon: 'i-carbon-store' },
  { key: 'mystery', label: '神秘商人', icon: 'i-carbon-store' },
  { key: 'svip', label: 'SVIP商城', icon: 'i-carbon-diamond-outline' },
]
// 默认落地页签取数组第一项：以后调上面的顺序，落地页会跟着变，不用另处维护。
const defaultTab = tabs[0]!.key
const tabKeys = new Set<string>(tabs.map(tab => tab.key))
// 未知或缺失的 tab 参数一律回落到默认页签，与改之前的 `?tab=mall` 链接仍正常打开。
const activeTab = computed<MallTab>(() => typeof route.query.tab === 'string' && tabKeys.has(route.query.tab) ? route.query.tab as MallTab : defaultTab)
const purchasing = computed(() => purchasingGoodsId.value !== null || mysteryPurchasing.value)

function selectTab(tab: MallTab) {
  if (purchasing.value || tab === activeTab.value)
    return
  // 只有默认页签不写 query，保证 `/farm/game-mall` 是干净链接；其余页签仍然显式入 URL，方便书签。
  router.replace({ query: { ...route.query, tab: tab === defaultTab ? undefined : tab }, hash: route.hash })
}
</script>

<template>
  <div class="mall-page mall-typography page-stack" :class="{ 'mall-page--fill': activeTab === 'mystery' }">
    <PageTabs :value="activeTab" @update:value="selectTab">
      <NTab v-for="tab in tabs" :key="tab.key" :name="tab.key" :disabled="purchasing && activeTab !== tab.key">
        <span class="inline-flex items-center gap-2">
          <span :class="tab.icon" />
          {{ tab.label }}
        </span>
      </NTab>
    </PageTabs>

    <MysteryShopPanel v-if="activeTab === 'mystery'" />
    <MallCatalogPanel v-else :slot-type="activeTab === 'svip' ? 4 : activeTab === 'limited' ? 5 : 1" :props-shop="activeTab === 'props'" />
  </div>
</template>

<style scoped>
.mall-page {
  min-height: 100%;
  color: var(--ui-ink);
}

/* 神秘商人页需要把页签剩下的高度全部交给面板（上半货币栏/货品卡，
   下半购买历史），所以这里要参与滚动容器的 flex 分配。
   DefaultLayout 的 `.page-scroll > *` 把页面根设成 flex: 0 0 auto，
   因此这里用多一级类名提高优先级来覆写，而不是靠样式注入顺序。
   min-height: 0 让它自己缩小到可视高度，不会把页面顶长；
   窄屏下底部导航的占位由 DefaultLayout 的 padding-bottom 提供，因此历史卡
   自动停在导航栏上方，不需要写死任何导航栏高度。 */
.page-stack.mall-page--fill {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}
</style>
