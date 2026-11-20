<script setup lang="ts">
import { NButton } from 'naive-ui/es/button'
import { computed, onMounted, ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import CollectionRulesPopover from '@/components/CollectionRulesPopover.vue'
import BookToolbar from '@/components/illustrated/BookToolbar.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { useReconnectRefresh } from '@/composables/useReconnectRefresh'
import { vLazySrc } from '@/directives/lazy-src'

interface Mutation { id: number, name: string, image: string, effect: string, description: string, probabilities: Array<{ rarity: number | null, percent: number }> }
interface Series { id: number, name: string, rarity?: number, rarityName: string, description: string, mutationRules: Array<{ name: string, probability: number, guarantee: number }>, items: Array<{ id: number, name: string, image: string }> }

const tab = ref('normal')
const query = ref('')
const seriesId = ref(0)
const catalog = ref<{ normal: Mutation[], decoration: Mutation[], collections: Series[] } | null>(null)
const loading = ref(false)
const error = ref('')
const rarityNames = ['', '普通', '稀有', '珍品', '天工']

const tabs = computed(() => [
  { value: 'normal', label: '常规变异', count: catalog.value?.normal.length },
  { value: 'decoration', label: '装扮变异', count: catalog.value?.decoration.length },
  { value: 'collections', label: '藏品变异', count: catalog.value?.collections.reduce((sum, entry) => sum + entry.items.length, 0) },
])
const seriesOptions = computed(() => [{ label: '全部系列', value: 0 }, ...(catalog.value?.collections || []).map(entry => ({ label: entry.name, value: entry.id }))])
const keyword = computed(() => query.value.trim())
const effects = computed(() => {
  if (tab.value === 'collections')
    return []
  return (catalog.value?.[tab.value as 'normal' | 'decoration'] || []).filter(effect => !keyword.value || `${effect.name}${effect.effect}${effect.description}`.includes(keyword.value))
})
/** 藏品变异与常规变异同样一行一条：按系列筛选后展开为藏品行，获取途径与概率说明取所属系列。 */
const collectionRows = computed(() => (catalog.value?.collections || [])
  .filter(entry => !seriesId.value || entry.id === seriesId.value)
  .flatMap(entry => entry.items
    .filter(item => !keyword.value || `${item.name} ${entry.name}`.includes(keyword.value))
    .map(item => ({ item, series: entry }))))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const response = await api.get('/api/illustrated/mutations', { skipErrorToast: true } as any)
    if (!response.data?.ok)
      throw new Error(response.data?.error || '变异宝典读取失败')
    catalog.value = response.data.data
  }
  catch (cause) {
    error.value = getApiErrorMessage(cause, '变异宝典读取失败')
  }
  finally {
    loading.value = false
  }
}
onMounted(load)
// 重新上线时按一次刷新键
useReconnectRefresh(load)
</script>

<template>
  <div class="book-page panel-fill">
    <EmptyState v-if="error" title="变异宝典读取失败" :description="error" tone="error" icon="i-carbon-warning-alt">
      <NButton secondary @click="load">
        重新读取
      </NButton>
    </EmptyState>
    <div v-else-if="loading && !catalog" class="book-loading" role="status" aria-label="正在读取变异宝典">
      <span class="i-svg-spinners-90-ring-with-bg" />
    </div>
    <!-- 标题栏与列表合成一张卡片：列表放进 #body，用全宽分割线与标题栏隔开。 -->
    <BookToolbar v-else-if="catalog" v-model:filter="tab" v-model:query="query" class="mutation-book" :filters="tabs" label="变异宝典分类" placeholder="输入名称/效果搜索">
      <BaseSelect v-if="tab === 'collections'" v-model="seriesId" :options="seriesOptions" fit-width aria-label="藏品系列" />
      <template #actions>
        <RefreshButton :loading="loading" :disabled="loading" @click="load" />
      </template>

      <!-- 列表而非卡片网格：条目字段固定，按列对齐后不会因缺少概率行而留白。 -->
      <template #body>
        <template v-if="tab !== 'collections'">
          <ul v-if="effects.length" class="mutation-list">
            <li v-for="effect in effects" :key="effect.id" class="mutation-row">
              <span class="mutation-row__well"><img v-if="effect.image" v-lazy-src="effect.image" alt="" loading="lazy" decoding="async"></span>
              <div class="mutation-row__main">
                <h3>{{ effect.name }}</h3>
                <p>{{ effect.description || '—' }}</p>
              </div>
              <div class="mutation-row__odds" :aria-label="`${effect.name}变异概率`">
                <template v-if="effect.probabilities.length">
                  <span v-for="probability in effect.probabilities" :key="probability.rarity || 0">
                    {{ probability.rarity ? rarityNames[probability.rarity] : '触发' }}<b>{{ probability.percent }}%</b>
                  </span>
                </template>
                <span v-else class="is-empty">—</span>
              </div>
              <span class="mutation-row__effect" :title="effect.effect">{{ effect.effect }}</span>
            </li>
          </ul>
          <EmptyState v-else bare title="没有符合条件的变异" description="换个搜索词试试" icon="i-carbon-search" />
        </template>

        <template v-else>
          <ul v-if="collectionRows.length" class="mutation-list">
            <li v-for="row in collectionRows" :key="row.item.id" class="mutation-row mutation-row--collection">
              <span class="mutation-row__well"><img v-if="row.item.image" v-lazy-src="row.item.image" alt="" loading="lazy" decoding="async"></span>
              <div class="mutation-row__main">
                <h3 class="mutation-row__title">
                  {{ row.item.name }}
                  <CollectionRulesPopover :title="row.item.name" :rules="row.series.mutationRules" />
                </h3>
              </div>
              <p class="mutation-row__note" :title="row.series.description">
                {{ row.series.description || '—' }}
              </p>
              <span class="mutation-row__effect" :title="`${row.series.rarityName} · ${row.series.name}`">{{ row.series.rarityName }} · {{ row.series.name }}</span>
            </li>
          </ul>
          <EmptyState v-else bare title="没有符合条件的藏品" description="换个系列或搜索词试试" icon="i-carbon-search" />
        </template>
      </template>
    </BookToolbar>
  </div>
</template>

<style scoped>
.book-page {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 16px;
}

.book-loading {
  display: grid;
  min-height: 240px;
  place-items: center;
  color: var(--ui-primary);
  font-size: 28px;
}

/* 列表行自带内边距，行间分割线要贴卡片左右边缘，去掉 #body 的默认留白 */
.mutation-book :deep(.book-card__body) {
  padding: 0;
}

.mutation-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.mutation-row {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) minmax(0, 240px) 128px;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
}

/* 藏品名称较短，收窄名称列，让获取条件紧跟名称并吃掉剩余宽度。 */
.mutation-row--collection {
  grid-template-columns: 44px minmax(0, 160px) minmax(0, 1fr) 128px;
}

.mutation-row + .mutation-row {
  border-top: 1px solid var(--ui-border);
}

.mutation-row__well {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 11px;
  background: var(--ui-surface-soft);
}

.mutation-row__well img {
  width: 74%;
  height: 74%;
  object-fit: contain;
}

.mutation-row__main {
  min-width: 0;
}

.mutation-row__main h3 {
  margin: 0;
  color: var(--ui-ink);
  font-size: 14px;
  font-weight: var(--fw-650);
  line-height: 20px;
}

.mutation-row__main p {
  margin: 2px 0 0;
  overflow: hidden;
  color: var(--ui-muted);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mutation-row__title {
  display: flex;
  align-items: center;
  gap: 4px;
}

.mutation-row__note {
  margin: 0;
  overflow: hidden;
  color: var(--ui-muted);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mutation-row__odds {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.mutation-row__odds > span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 7px;
  border-radius: 6px;
  color: var(--ui-subtle);
  background: var(--ui-surface-soft);
  font-size: 11px;
  line-height: 20px;
}

.mutation-row__odds > .is-empty {
  padding: 0;
  background: transparent;
}

.mutation-row__odds b {
  color: var(--ui-ink);
  font-weight: var(--fw-600);
  font-variant-numeric: tabular-nums;
}

.mutation-row__effect {
  justify-self: end;
  max-width: 100%;
  overflow: hidden;
  padding: 0 10px;
  border-radius: 999px;
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
  font-size: 12px;
  font-weight: var(--fw-600);
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
