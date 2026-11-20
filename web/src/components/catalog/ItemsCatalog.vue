<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import CatalogPanel from '@/components/catalog/CatalogPanel.vue'
import {
  cleanDescription,
  ITEM_TYPE_FILTER_OPTIONS,
  ITEM_TYPE_LABELS,
  RARITY_FILTER_OPTIONS,
  RARITY_LABELS,
  useCatalogPaging,
  useImageErrors,
} from '@/components/catalog/catalogShared'
import CatalogSortButton from '@/components/catalog/CatalogSortButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import OverflowTooltip from '@/components/ui/OverflowTooltip.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { useReconnectRefresh } from '@/composables/useReconnectRefresh'
import { useSortToggle } from '@/composables/useSortToggle'
import { vLazySrc } from '@/directives/lazy-src'

/* 道具列表：类型/稀有度筛选 + 名称/类型/稀有度排序（可切换正序倒序）。
   本组件独占自己的数据与状态，不再需要按页签做条件渲染。 */

const loading = ref(false)
const list = ref<any[]>([])
const searchKeyword = ref('')
const typeFilter = ref('')
const rarityFilter = ref('')
const { imageErrors, mark } = useImageErrors()
const { currentPage, pageCount, slice } = useCatalogPaging()

const SORT_OPTIONS = [
  { value: 'name', label: '名称' },
  { value: 'type', label: '类型' },
  { value: 'rarity', label: '稀有度' },
  { value: 'canUse', label: '可使用' },
]
// 默认按名称排序
const { sort, dir, direction, select } = useSortToggle('name')
const sortLabel = computed(() => SORT_OPTIONS.find(o => o.value === sort.value)?.label || '排序')

function sortValue(item: any, key: string) {
  if (key === 'canUse')
    return Number(item.canUse) || 0
  if (key === 'rarity')
    return Number(item.rarity) || 0
  if (key === 'type')
    return Number(item.type) || 0
  return String(item.name || '')
}

const filtered = computed(() => {
  let result = list.value
  if (searchKeyword.value) {
    const kw = searchKeyword.value.toLowerCase()
    result = result.filter((i: any) => i.name?.toLowerCase().includes(kw))
  }
  if (typeFilter.value) {
    const t = Number(typeFilter.value)
    result = result.filter((i: any) => i.type === t)
  }
  if (rarityFilter.value !== '') {
    const r = Number(rarityFilter.value)
    result = result.filter((i: any) => i.rarity === r)
  }
  const key = sort.value
  const d = direction.value
  return [...result].sort((a: any, b: any) => {
    const va = sortValue(a, key)
    const vb = sortValue(b, key)
    if (typeof va === 'number' && typeof vb === 'number')
      return (va - vb) * d
    return String(va).localeCompare(String(vb)) * d
  })
})

const paginated = computed(() => slice(filtered.value))
const totalPages = computed(() => pageCount(filtered.value.length))

// 列宽：与种子表同一套规则，先给每列容纳标题的最小宽度，剩余宽度按标题长度比例摊分
const ITEM_COLUMNS = [
  { label: '道具', min: 124 },
  { label: '类型', min: 84 },
  { label: '可使用', min: 72 },
  { label: '稀有度', min: 84 },
  { label: '描述', min: 160 },
]
const itemColumnWidths = computed(() => {
  const totalMin = ITEM_COLUMNS.reduce((sum, col) => sum + col.min, 0)
  const totalWeight = ITEM_COLUMNS.reduce((sum, col) => sum + col.label.length, 0)
  return ITEM_COLUMNS.map((col) => {
    const ratio = (col.label.length / totalWeight).toFixed(4)
    return `max(${col.min}px, calc(${col.min}px + (100% - ${totalMin}px) * ${ratio}))`
  })
})

watch([searchKeyword, typeFilter, rarityFilter, sort, dir], () => {
  currentPage.value = 1
})
watch(totalPages, (pages) => {
  currentPage.value = Math.min(currentPage.value, pages)
})

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/api/config/items')
    if (data?.ok)
      list.value = data.data || []
  }
  catch { /* ignore */ }
  finally { loading.value = false }
}

/** 只有用户点击刷新才让图标转圈，挂载时的自动加载不碰按钮。 */
const manualRefreshing = ref(false)
async function refreshItems() {
  if (manualRefreshing.value)
    return
  manualRefreshing.value = true
  try {
    await load()
  }
  finally {
    manualRefreshing.value = false
  }
}

onMounted(load)
// 重新上线时按一次刷新键
useReconnectRefresh(refreshItems)
</script>

<template>
  <CatalogPanel v-model:page="currentPage" :loading="loading" :page-count="totalPages">
    <template #toolbar>
      <BaseInput v-model="searchKeyword" type="search" clearable placeholder="输入名称搜索" />
      <div class="catalog-tools">
        <BaseSelect v-model="typeFilter" :options="ITEM_TYPE_FILTER_OPTIONS" fit-width />
        <BaseSelect v-model="rarityFilter" :options="RARITY_FILTER_OPTIONS" fit-width />
        <div class="ml-auto" />
        <div class="catalog-tools__actions">
          <CatalogSortButton
            :options="SORT_OPTIONS"
            :current="sort"
            :dir="dir"
            :label="sortLabel"
            @select="select"
          />
          <RefreshButton
            title="刷新道具列表"
            :loading="manualRefreshing"
            :disabled="manualRefreshing"
            @click="refreshItems"
          />
        </div>
      </div>
    </template>

    <div v-if="filtered.length === 0" class="catalog-empty">
      {{ searchKeyword || typeFilter ? '没有匹配的道具' : '暂无道具数据' }}
    </div>
    <div v-else class="catalog-table-scroll overflow-x-auto">
      <table class="catalog-table item-table w-full table-fixed whitespace-nowrap text-center text-sm">
        <colgroup>
          <col v-for="(width, i) in itemColumnWidths" :key="i" :style="{ width }">
        </colgroup>
        <thead class="border-b bg-gray-50 text-xs text-gray-500 uppercase dark:border-gray-700 dark:bg-gray-700/50 dark:text-gray-400">
          <tr>
            <th class="sticky left-0 z-2 px-3 py-3 font-medium">
              道具
            </th>
            <th class="px-3 py-3 font-medium">
              类型
            </th>
            <th class="px-3 py-3 font-medium">
              可使用
            </th>
            <th class="px-3 py-3 font-medium">
              稀有度
            </th>
            <th class="px-3 py-3 font-medium">
              描述
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
          <tr v-for="item in paginated" :key="item.id">
            <td class="sticky left-0 z-1 px-3 py-2 text-left">
              <div class="flex items-center gap-2">
                <div class="relative h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden border border-gray-200 rounded-lg bg-gray-100 dark:border-gray-600 dark:bg-gray-700">
                  <img
                    v-if="item.image && !imageErrors[item.id]"
                    v-lazy-src="item.image"
                    class="h-8 w-8 object-contain"
                    loading="lazy"
                    decoding="async"
                    @error="mark(item.id)"
                  >
                  <div v-else class="i-carbon-box text-xl text-gray-400" />
                </div>
                <span class="text-gray-900 font-bold dark:text-gray-100">{{ item.name }}</span>
              </div>
            </td>
            <td class="px-3 py-2">
              <span class="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-600 font-medium dark:bg-blue-900/30 dark:text-blue-400">
                {{ ITEM_TYPE_LABELS[item.type] || `类型${item.type}` }}
              </span>
            </td>
            <td class="px-3 py-2">
              <span
                class="rounded-full px-2 py-0.5 text-xs font-medium"
                :class="item.canUse ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'"
              >
                {{ item.canUse ? '是' : '否' }}
              </span>
            </td>
            <td class="px-3 py-2">
              <span
                class="rounded-full px-2 py-0.5 text-xs font-medium"
                :class="item.rarity >= 3 ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' : item.rarity >= 1 ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'"
              >
                {{ RARITY_LABELS[item.rarity] || '普通' }}
              </span>
            </td>
            <td class="px-3 py-2 text-xs text-gray-400">
              <OverflowTooltip :text="cleanDescription(item) || '-'" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </CatalogPanel>
</template>

<style scoped>
.catalog-empty {
  padding: 64px 16px;
  text-align: center;
  color: var(--ui-subtle);
}
</style>
