<script setup lang="ts">
import type { Account } from '@/stores/account'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

interface CareerItem {
  seedId: number
  name: string
  image?: string
  harvestCount?: number
}

const props = defineProps<{
  show: boolean
  account?: Account | null
  profile?: Record<string, any> | null
  items?: CareerItem[]
  loading?: boolean
  error?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'refresh'): void
}>()

const harvestedItems = computed(() => (props.items || [])
  .filter(item => Number(item.harvestCount) > 0)
  .sort((a, b) => Number(b.harvestCount) - Number(a.harvestCount)))

const totalHarvest = computed(() => Number(props.profile?.totalHarvestCount ?? harvestedItems.value.reduce((sum, item) => sum + Number(item.harvestCount || 0), 0)))
const topItems = computed(() => harvestedItems.value.slice(0, 3))
const name = computed(() => String(props.profile?.name || props.account?.nick || props.account?.name || '农场主'))
const avatar = computed(() => String(props.profile?.avatar || props.account?.avatar || ''))
const level = computed(() => Number(props.profile?.level || 0))
const exp = computed(() => Number(props.profile?.exp || 0))
const gid = computed(() => String(props.profile?.gid || ''))
const totalStealCount = computed(() => Number(props.profile?.totalStealCount || 0))

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(Number(value || 0))
}

function formatCompactNumber(value: number) {
  const numericValue = Number(value || 0)
  const units = [
    { threshold: 100000000, divisor: 100000000, suffix: '亿' },
    { threshold: 10000000, divisor: 10000000, suffix: '千万' },
    { threshold: 1000000, divisor: 1000000, suffix: '百万' },
    { threshold: 10000, divisor: 10000, suffix: '万' },
    { threshold: 1000, divisor: 1000, suffix: '千' },
  ]
  const unit = units.find(item => Math.abs(numericValue) >= item.threshold)
  if (!unit)
    return formatNumber(numericValue)
  const compactValue = numericValue / unit.divisor
  const digits = compactValue >= 100 ? 0 : 1
  return `${compactValue.toFixed(digits).replace(/\.0+$|(?<=\.\d)0+$/g, '')}${unit.suffix}`
}

// 轻量焦点管理：打开时聚焦面板，ESC 关闭（替代 origin 的 useModalFocus）
const modalSurface = ref<HTMLElement | null>(null)
const modalId = useId()

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape')
    emit('close')
}

watch(() => props.show, (show) => {
  if (show) {
    window.addEventListener('keydown', onKeydown)
    nextTick(() => modalSurface.value?.focus())
  }
  else {
    window.removeEventListener('keydown', onKeydown)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Transition name="career-fade">
    <div v-if="show" class="fixed inset-0 z-[10020] flex items-center justify-center bg-black/45 p-3 backdrop-blur-sm" @click.self="emit('close')">
      <section ref="modalSurface" role="dialog" aria-modal="true" :aria-labelledby="`${modalId}-title`" tabindex="-1" class="career-panel max-h-[min(88vh,820px)] max-w-2xl w-full overflow-hidden rounded-3xl bg-[#f7f5ef] shadow-2xl">
        <header class="relative flex items-center gap-4 border-b border-amber-100 px-5 py-5 sm:px-7">
          <div class="h-16 w-16 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-amber-100 ring-2 ring-white">
            <img v-if="avatar" :src="avatar" :alt="name" class="h-full w-full object-cover">
            <span v-else class="text-xl text-amber-700 font-bold">{{ name.slice(0, 1) }}</span>
          </div>
          <div class="min-w-0">
            <h2 :id="`${modalId}-title`" class="truncate text-xl text-gray-900 font-bold">
              {{ name }}
            </h2>
            <div class="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span class="rounded-lg bg-amber-100 px-2 py-1 text-amber-700 font-semibold">Lv.{{ level }}</span>
              <span class="rounded-lg bg-blue-50 px-2 py-1 text-blue-600">经验 {{ formatNumber(exp) }}</span>
            </div>
            <p v-if="gid" class="mt-2 text-xs text-gray-400">
              角色编号：{{ gid }}
            </p>
          </div>
          <button class="absolute right-4 top-4 h-9 w-9 flex items-center justify-center rounded-full text-gray-400 transition hover:bg-black/5 hover:text-gray-700" aria-label="关闭" @click="emit('close')">
            <div class="i-carbon-close text-2xl" />
          </button>
        </header>

        <div class="custom-scrollbar max-h-[calc(min(88vh,820px)-106px)] overflow-y-auto p-5 sm:p-7">
          <div class="mb-4 text-center text-2xl text-amber-700 font-bold">
            生涯
          </div>

          <div v-if="loading" class="h-56 flex flex-col items-center justify-center gap-3 text-gray-400">
            <div class="i-carbon-circle-dash animate-spin text-3xl" />
            <span>正在读取角色生涯...</span>
          </div>

          <div v-else-if="error" class="h-48 flex flex-col items-center justify-center gap-3 text-center">
            <div class="i-carbon-warning-alt text-3xl text-amber-500" />
            <p class="text-sm text-gray-500">
              {{ error }}
            </p>
            <button class="rounded-lg bg-amber-500 px-4 py-2 text-sm text-white hover:bg-amber-600" @click="emit('refresh')">
              重新加载
            </button>
          </div>

          <template v-else>
            <div class="grid grid-cols-2 gap-3">
              <div class="rounded-2xl bg-white p-4 text-center shadow-sm" :title="`精确数量：${formatNumber(totalHarvest)}`">
                <div class="flex items-center justify-center gap-2 text-sm text-orange-600">
                  <img src="/game-config/career/harvest.png" alt="" class="h-9 w-8 object-contain">
                  <span>历史累计收获</span>
                </div>
                <div class="mt-1 text-2xl text-orange-600 font-bold">
                  {{ formatCompactNumber(totalHarvest) }}
                </div>
              </div>
              <div class="rounded-2xl bg-white p-4 text-center shadow-sm" :title="`精确数量：${formatNumber(totalStealCount)}`">
                <div class="flex items-center justify-center gap-2 text-sm text-rose-600">
                  <img src="/game-config/career/steal.png" alt="" class="h-9 w-9 object-contain">
                  <span>摘取好友作物</span>
                </div>
                <div class="mt-1 text-2xl text-rose-600 font-bold">
                  {{ formatCompactNumber(totalStealCount) }}
                </div>
                <div class="mt-0.5 text-[10px] text-gray-400">
                  官方生涯统计
                </div>
              </div>
            </div>

            <div v-if="topItems.length" class="grid grid-cols-3 mt-5 gap-3 border-t border-amber-100 pt-5">
              <div v-for="(item, index) in topItems" :key="item.seedId" class="text-center">
                <div class="mx-auto mb-2 h-7 w-7 flex items-center justify-center rounded-full text-sm text-white font-bold" :class="index === 0 ? 'bg-amber-400' : index === 1 ? 'bg-slate-400' : 'bg-orange-400'">
                  {{ index + 1 }}
                </div>
                <div class="mx-auto h-16 w-16 flex items-center justify-center">
                  <img v-if="item.image" :src="item.image" :alt="item.name" class="max-h-full max-w-full object-contain">
                  <div v-else class="i-carbon-sprout text-4xl text-green-400" />
                </div>
                <div class="mt-2 truncate text-sm text-gray-600">
                  {{ item.name }}
                </div>
                <div class="text-lg text-amber-800 font-bold">
                  {{ formatNumber(Number(item.harvestCount)) }}
                </div>
              </div>
            </div>

            <div class="mb-3 mt-7 flex items-baseline gap-2">
              <h3 class="text-lg text-gray-900 font-bold">
                收获明细
              </h3>
              <span class="text-sm text-gray-400">({{ harvestedItems.length }})</span>
            </div>
            <div v-if="harvestedItems.length" class="grid grid-cols-3 gap-3 sm:grid-cols-4">
              <div v-for="item in harvestedItems" :key="item.seedId" class="rounded-xl bg-white p-3 text-center shadow-sm">
                <div class="mx-auto h-12 w-12 flex items-center justify-center">
                  <img v-if="item.image" :src="item.image" :alt="item.name" class="max-h-full max-w-full object-contain">
                  <div v-else class="i-carbon-sprout text-3xl text-green-400" />
                </div>
                <div class="mt-2 truncate text-xs text-gray-600">
                  {{ item.name }}
                </div>
                <div class="mt-0.5 text-sm text-gray-900 font-bold">
                  {{ formatNumber(Number(item.harvestCount)) }}
                </div>
              </div>
            </div>
            <div v-else class="rounded-2xl bg-white py-12 text-center text-sm text-gray-400">
              暂无收获记录
            </div>
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
.custom-scrollbar::-webkit-scrollbar {
  width: 5px;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgb(156 163 175 / 45%);
}
</style>
