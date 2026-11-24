<script setup lang="ts">
import type { GameSpace } from '@/components/space-transition'
import { NButton } from 'naive-ui/es/button'
import { storeToRefs } from 'pinia'
import { computed, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getSpaceMenu } from '@/router/menu'
import { useAccountStore } from '@/stores/account'
import { useAppStore } from '@/stores/app'
import { useRanchStore } from '@/stores/ranch'

// 给目标页一次短暂的读取机会，较慢的请求继续使用页面自身的加载状态。
const MAX_HOLD_MS = 1200

const route = useRoute()
const router = useRouter()
const app = useAppStore()
const ranch = useRanchStore()
const { currentAccountId } = storeToRefs(useAccountStore())
const inRanch = computed(() => route.meta.gameSpace === 'ranch')
const label = computed(() => inRanch.value ? '去农场' : '去牧场')

const frame = () => new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))

function waitUntil(ready: () => boolean, timeout: number) {
  return new Promise<void>((resolve) => {
    if (ready())
      return resolve()
    const timer = window.setTimeout(done, timeout)
    const stop = watch(ready, ok => ok && done())
    function done() {
      window.clearTimeout(timer)
      stop()
      resolve()
    }
  })
}

/** 牧场页等待读取结果；农场页的数据由实时推送补齐，渲染两帧即可。 */
async function waitForDestination(target: GameSpace) {
  if (target === 'ranch') {
    await waitUntil(() => !ranch.loading && !ranch.busy && (!!ranch.state || !!ranch.error || !currentAccountId.value), MAX_HOLD_MS)
  }
  await nextTick()
  await frame()
  await frame()
}

function destinationOf(target: GameSpace) {
  if (route.name === 'farm' || route.name === 'ranch')
    return target === 'ranch' ? '/ranch' : '/farm'
  const baseName = String(route.name || 'dashboard').replace(/^ranch-/, '')
  const targetName = `${target === 'ranch' ? 'ranch-' : ''}${baseName}`
  const item = getSpaceMenu(target === 'ranch').find(entry => entry.name === targetName)
  return `/${item?.path ?? (target === 'ranch' ? 'ranch' : 'farm')}`
}

async function switchSpace() {
  if (app.spaceSwitching || ranch.busy)
    return
  const target: GameSpace = inRanch.value ? 'farm' : 'ranch'
  const destination = destinationOf(target)
  app.spaceSwitching = true
  try {
    await router.push(destination)
    await nextTick()
    await waitForDestination(target)
  }
  finally {
    app.spaceSwitching = false
  }
  await nextTick()
  document.querySelector<HTMLElement>('.page-heading__title')?.focus({ preventScroll: true })
}
</script>

<template>
  <NButton quaternary class="game-space-switch" :disabled="app.spaceSwitching || ranch.busy" :title="label" :aria-label="label" @click="switchSpace">
    <template #icon>
      <span class="text-xl i-carbon-arrows-horizontal" aria-hidden="true" />
    </template>
    {{ label }}
  </NButton>
</template>
