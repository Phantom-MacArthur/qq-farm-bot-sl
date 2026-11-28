<script setup lang="ts">
import type { Account } from '@/stores/account'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import OfflineState from '@/components/ui/OfflineState.vue'
import { formatCompactAmount, formatNumber } from '@/utils/format-number'

interface CareerItem {
  seedId: number
  name: string
  image?: string
  harvestCount?: number
}

interface CareerProfile {
  name?: string
  avatar?: string
  level?: number
  exp?: number
  gid?: number
  totalHarvestCount?: number
  totalStealCount?: number
  ranch?: { harvest: number, steal: number } | null
}

const props = defineProps<{
  show: boolean
  account?: Account | null
  profile?: CareerProfile | null
  items?: CareerItem[]
  loading?: boolean
  error?: string
  isOffline?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'refresh'): void
}>()

const harvestedItems = computed(() => (props.items || [])
  .filter(item => Number(item.harvestCount) > 0)
  .sort((a, b) => Number(b.harvestCount) - Number(a.harvestCount)))

const isRanchCareer = ref(false)
const nextCareerLabel = computed(() => isRanchCareer.value ? '农场生涯' : '牧场生涯')
const totalHarvest = computed(() => isRanchCareer.value
  ? props.profile?.ranch?.harvest ?? null
  : Number(props.profile?.totalHarvestCount ?? harvestedItems.value.reduce((sum, item) => sum + Number(item.harvestCount || 0), 0)))
const topItems = computed(() => harvestedItems.value.slice(0, 3))
const name = computed(() => String(props.profile?.name || props.account?.nick || props.account?.name || '农场主'))
const avatar = computed(() => String(props.profile?.avatar || props.account?.avatar || ''))
const level = computed(() => Number(props.profile?.level || 0))
const exp = computed(() => Number(props.profile?.exp || 0))
const gid = computed(() => String(props.profile?.gid || ''))
const totalStealCount = computed(() => isRanchCareer.value
  ? props.profile?.ranch?.steal ?? null
  : Number(props.profile?.totalStealCount || 0))

// 轻量焦点管理：打开时聚焦面板，ESC 关闭（替代 origin 的 useModalFocus）
const modalSurface = ref<HTMLElement | null>(null)
const modalId = useId()

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape')
    emit('close')
}

watch(() => props.show, (show) => {
  if (show) {
    isRanchCareer.value = false
    window.addEventListener('keydown', onKeydown)
    nextTick(() => modalSurface.value?.focus())
  }
  else {
    window.removeEventListener('keydown', onKeydown)
  }
})
watch(() => props.account?.id, () => { isRanchCareer.value = false })

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Transition name="career-fade">
    <div v-if="show" class="fixed inset-0 z-[10020] flex items-center justify-center bg-black/45 p-3 backdrop-blur-sm" @click.self="emit('close')">
      <section ref="modalSurface" role="dialog" aria-modal="true" :aria-labelledby="`${modalId}-title`" tabindex="-1" class="career-panel max-h-[min(76vh,680px)] max-w-md w-full flex flex-col overflow-hidden rounded-3xl bg-[var(--ui-surface-strong)] shadow-2xl">
        <header class="relative mx-[15px] mt-[15px] flex shrink-0 items-start gap-[15px]">
          <div class="h-16 w-16 flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--ui-surface-soft)] ring-2 ring-[var(--ui-border)]">
            <img v-if="avatar" :src="avatar" :alt="name" class="h-full w-full object-cover">
            <span v-else class="text-xl text-amber-700 dark:text-amber-300 font-bold">{{ name.slice(0, 1) }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <h2 :id="`${modalId}-title`" class="truncate text-base text-[var(--ui-ink)] leading-5 font-bold">
              {{ name }}
            </h2>
            <div class="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs font-normal">
              <span class="text-[var(--ui-primary)] font-bold">Lv.{{ level }}</span>
              <span class="text-blue-400 font-bold" :title="`经验: ${formatNumber(exp)}`">经验 {{ formatCompactAmount(exp) }}</span>
            </div>
            <p v-if="gid" class="mt-1.5 truncate text-xs text-[var(--ui-muted)] font-bold">
              ID {{ gid }}
            </p>
          </div>
          <BaseButton
            class="shrink-0"
            size="sm"
            variant="secondary"
            :aria-label="`切换到${nextCareerLabel}`"
            @click="isRanchCareer = !isRanchCareer"
          >
            <template #icon>
              <span class="i-carbon-arrows-horizontal" aria-hidden="true" />
            </template>
            {{ nextCareerLabel }}
          </BaseButton>
        </header>

        <div class="mx-[15px] min-h-0 flex flex-col" :class="{ 'my-[15px]': !isOffline }">
          <OfflineState v-if="isOffline" />
          <div v-else-if="loading" class="h-56 flex flex-col items-center justify-center gap-3 text-[var(--ui-muted)]">
            <div class="i-carbon-circle-dash animate-spin text-3xl" />
            <span>正在读取角色生涯...</span>
          </div>

          <div v-else-if="error" class="h-48 flex flex-col items-center justify-center gap-3 text-center">
            <div class="i-carbon-warning-alt text-3xl text-amber-500" />
            <p class="text-sm text-[var(--ui-muted)]">
              {{ error }}
            </p>
            <button class="rounded-lg bg-amber-500 px-4 py-2 text-sm text-white hover:bg-amber-600" @click="emit('refresh')">
              重新加载
            </button>
          </div>

          <template v-else>
            <div class="flex gap-2.5" role="group" :aria-label="isRanchCareer ? '牧场生涯' : '农场生涯'">
              <div class="flex flex-1 items-center justify-between gap-2.5 rounded-2xl bg-[var(--ui-surface-soft)] px-3 py-2 shadow-sm">
                <div class="flex items-center gap-2.5 text-sm text-orange-600 dark:text-orange-300">
                  <img src="/game-config/module_icons/planting.png" alt="" class="h-5 w-5 object-contain">
                  <span>历史累计收获</span>
                </div>
                <div class="text-sm text-orange-600 dark:text-orange-300 font-bold" :title="totalHarvest === null ? '暂无牧场生涯记录' : `收获数: ${formatNumber(totalHarvest)}`">
                  {{ totalHarvest === null ? '—' : formatCompactAmount(totalHarvest) }}
                </div>
              </div>
              <div class="flex flex-1 items-center justify-between gap-2.5 rounded-2xl bg-[var(--ui-surface-soft)] px-3 py-2 shadow-sm">
                <div class="flex items-center gap-2.5 text-sm text-rose-600">
                  <img src="/game-config/module_icons/steal.png" alt="" class="h-5 w-5 object-contain">
                  <span>摘取好友作物</span>
                </div>
                <div class="text-sm text-rose-600 font-bold" :title="totalStealCount === null ? '暂无牧场生涯记录' : `收获数: ${formatNumber(totalStealCount)}`">
                  {{ totalStealCount === null ? '—' : formatCompactAmount(totalStealCount) }}
                </div>
              </div>
            </div>

            <div v-if="!isRanchCareer && topItems.length" class="grid grid-cols-3 mt-[15px] gap-2.5">
              <div v-for="(item, index) in topItems" :key="item.seedId" class="relative rounded-xl bg-[var(--ui-surface-soft)] p-2 text-center shadow-sm" :title="`收获数: ${formatNumber(Number(item.harvestCount))}`">
                <span class="absolute left-1.5 top-2 h-5 w-5 flex items-center justify-center rounded-full text-xs text-white font-bold" :class="index === 0 ? 'bg-amber-400' : index === 1 ? 'bg-slate-400' : 'bg-orange-400'">
                  {{ index + 1 }}
                </span>
                <div class="mx-auto h-12 w-12 flex items-center justify-center">
                  <img v-if="item.image" :src="item.image" :alt="item.name" class="max-h-full max-w-full object-contain">
                  <div v-else class="i-carbon-sprout text-3xl text-green-400" />
                </div>
                <div class="mt-1 whitespace-nowrap text-sm text-amber-800 font-bold" :title="`收获数: ${formatNumber(Number(item.harvestCount))}`">
                  {{ formatCompactAmount(Number(item.harvestCount)) }}
                </div>
                <div class="truncate text-[11px] text-[var(--ui-muted)]">
                  {{ item.name }}
                </div>
              </div>
            </div>

            <template v-if="!isRanchCareer">
              <div class="mb-3 mt-[15px] flex shrink-0 items-baseline gap-2.5">
                <h3 :id="`${modalId}-harvest`" class="text-sm text-[var(--ui-ink)] font-normal">
                  收获明细
                </h3>
                <span class="text-[11px] text-[var(--ui-muted)] font-normal">({{ harvestedItems.length }})</span>
              </div>
              <div v-if="harvestedItems.length" class="career-harvest-scroll min-h-0 overflow-y-auto" role="region" :aria-labelledby="`${modalId}-harvest`" tabindex="0">
                <div class="grid grid-cols-5 gap-2.5">
                  <div v-for="item in harvestedItems" :key="item.seedId" class="overflow-hidden rounded-xl bg-[var(--ui-surface-soft)] p-2 text-center shadow-sm" :title="`收获数: ${formatNumber(Number(item.harvestCount))}`">
                    <div class="mx-auto h-10 w-10 flex items-center justify-center">
                      <img v-if="item.image" :src="item.image" :alt="item.name" class="max-h-full max-w-full object-contain">
                      <div v-else class="i-carbon-sprout text-2xl text-green-400" />
                    </div>
                    <div class="mt-1 truncate text-[11px] text-[var(--ui-muted)]">
                      {{ item.name }}
                    </div>
                    <div class="mt-0.5 whitespace-nowrap text-[11px] text-[var(--ui-ink)] font-bold">
                      {{ formatCompactAmount(Number(item.harvestCount)) }}
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="rounded-2xl bg-[var(--ui-surface-soft)] py-8 text-center text-sm text-[var(--ui-muted)]">
                暂无收获记录
              </div>
            </template>
          </template>
        </div>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.career-fade-enter-active,
.career-fade-leave-active {
  transition: opacity 0.18s ease;
}
.career-fade-enter-from,
.career-fade-leave-to {
  opacity: 0;
}
.career-harvest-scroll {
  scrollbar-width: none;
}
.career-harvest-scroll::-webkit-scrollbar {
  display: none;
}
</style>
