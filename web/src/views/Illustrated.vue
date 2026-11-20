<script setup lang="ts">
import { NTab } from 'naive-ui/es/tabs'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ItemsCatalog from '@/components/catalog/ItemsCatalog.vue'
import SeedsCatalog from '@/components/catalog/SeedsCatalog.vue'
import CollectionsPanel from '@/components/CollectionsPanel.vue'
import IllustratedPanel from '@/components/IllustratedPanel.vue'
import MutationCatalogPanel from '@/components/MutationCatalogPanel.vue'
import PageTabs from '@/components/PageTabs.vue'

type BookTab = 'seeds' | 'crop' | 'mutant' | 'collection' | 'catalog' | 'items'
const BOOK_TABS: BookTab[] = ['seeds', 'crop', 'mutant', 'collection', 'catalog', 'items']
const route = useRoute()
const router = useRouter()
const currentTab = computed<BookTab>({
  get: () => {
    const tab = route.query.tab as BookTab | undefined
    return tab && BOOK_TABS.includes(tab) ? tab : 'seeds'
  },
  set: tab => void router.replace({ query: { ...route.query, tab: tab === 'seeds' ? undefined : tab } }),
})
</script>

<template>
  <div class="page-stack">
    <PageTabs v-model:value="currentTab">
      <NTab name="seeds">
        <span class="inline-flex items-center gap-2"><span class="i-carbon-sprout" />种子详情</span>
      </NTab>
      <NTab name="crop">
        <span class="inline-flex items-center gap-2"><span class="i-carbon-wheat" />作物图鉴</span>
      </NTab>
      <NTab name="mutant">
        <span class="inline-flex items-center gap-2"><span class="i-carbon-gem" />超变图鉴</span>
      </NTab>
      <NTab name="collection">
        <span class="inline-flex items-center gap-2"><span class="i-carbon-trophy" />藏品</span>
      </NTab>
      <NTab name="catalog">
        <span class="inline-flex items-center gap-2"><span class="i-carbon-catalog" />变异宝典</span>
      </NTab>
      <NTab name="items">
        <span class="inline-flex items-center gap-2"><span class="i-carbon-tool-box" />道具</span>
      </NTab>
    </PageTabs>
    <SeedsCatalog v-if="currentTab === 'seeds'" />
    <ItemsCatalog v-else-if="currentTab === 'items'" />
    <CollectionsPanel v-else-if="currentTab === 'collection'" />
    <MutationCatalogPanel v-else-if="currentTab === 'catalog'" />
    <IllustratedPanel v-else :book-type="currentTab" />
  </div>
</template>
