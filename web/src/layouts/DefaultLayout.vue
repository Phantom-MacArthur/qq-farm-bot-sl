<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, nextTick, provide, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import PageHeader from '@/components/PageHeader.vue'
import Sidebar from '@/components/Sidebar.vue'
import { SPACE_TRANSITION_STYLE, spaceTransition } from '@/components/space-transition'
import { useAppStore } from '@/stores/app'

const route = useRoute()
const { activityDetailOpen, layoutMinWidth } = storeToRefs(useAppStore())
// 页头固定在滚动区之外；活动详情自带标题栏，打开时隐藏通用页头。
const activityDetail = computed(() => ['activity-center', 'ranch-activity-center'].includes(String(route.name)) && activityDetailOpen.value)
const showPageHeader = computed(() => !route.meta.fullBleed && !activityDetail.value)
const scrolled = ref(false)
const scrollEl = ref<HTMLElement | null>(null)
const pageTabsTarget = ref<HTMLElement | null>(null)
provide('page-tabs-target', pageTabsTarget)

function measureScrollbar() {
  const el = scrollEl.value
  if (!el)
    return
  // 页头右边缘与滚动区对齐：经典滚动条占位时让出它的宽度。
  el.parentElement?.style.setProperty('--scrollbar-w', `${Math.max(0, el.offsetWidth - el.clientWidth)}px`)
  el.style.setProperty('--page-bottom-inset', `${Math.max(0, document.documentElement.clientHeight - el.getBoundingClientRect().bottom)}px`)
}

function onPageScroll(event: Event) {
  const el = event.target as HTMLElement
  scrolled.value = el.scrollTop > 2
}

watch(() => route.fullPath, async () => {
  scrolled.value = false
  await nextTick()
  scrollEl.value?.scrollTo({ top: 0 })
  measureScrollbar()
}, { immediate: true })
useResizeObserver(scrollEl, measureScrollbar)
</script>

<template>
  <div class="liquid-layout w-full flex overflow-hidden" :data-space-phase="spaceTransition?.phase" :style="{ '--app-min-width': `${layoutMinWidth}px`, ...SPACE_TRANSITION_STYLE }">
    <Sidebar />

    <main class="app-main relative h-full min-h-0 min-w-0 flex flex-1 flex-col overflow-hidden">
      <div class="app-content min-h-0 flex flex-1 flex-col overflow-hidden" :class="{ 'is-scrolled': scrolled }">
        <div v-if="showPageHeader" class="page-header-bar">
          <div class="page-header-content">
            <PageHeader />
            <div ref="pageTabsTarget" class="page-tabs-host" />
          </div>
        </div>
        <div
          ref="scrollEl"
          class="page-scroll custom-scrollbar flex flex-1 flex-col"
          :class="[
            route.meta.fullBleed ? 'overflow-hidden p-0' : 'overflow-y-auto',
            {
              'page-scroll--fill': activityDetail,
              'page-scroll--dashboard': route.name === 'dashboard',
            },
          ]"
          @scroll.passive="onPageScroll"
        >
          <RouterView v-slot="{ Component, route: currentRoute }">
            <div :key="currentRoute.path" class="page-view min-h-0 min-w-0 w-full flex flex-1 flex-col">
              <component :is="Component" />
            </div>
          </RouterView>
        </div>
      </div>
    </main>

  </div>
</template>

<style scoped>
.liquid-layout {
  flex: 1 1 0%;
  min-height: 0;
  /* 最小宽度包含侧栏；外层统一横向滚动，页头、侧栏与正文一起移动。 */
  min-width: var(--app-min-width);
}

/* 滚动条补偿直接生效，不能被全局动效规则变成 padding/margin 过渡。 */
.app-content,
.page-header-bar,
.page-scroll {
  transition-property: none;
}

/* 页头和内容共用左右留白，顶栏透出页面原有的渐变背景。 */
.app-content {
  --page-pad: 16px;
  /* 滚动条占位包含在右侧留白内，避免出现 16px + 滚动条宽度的额外间隙。 */
  --page-pad-end: max(0px, calc(var(--page-pad) - var(--scrollbar-w, 0px)));
  /* 吸顶偏移与 .page-scroll > * 的 margin-block-start 一致：吸顶后工具栏与子菜单保持原间距。 */
  --sticky-top: 12px;
}

.page-header-bar {
  position: relative;
  z-index: 20;
  flex-shrink: 0;
  margin-right: var(--scrollbar-w, 0px);
  /* 视觉上的「上边距」＝ padding + 账号胶囊比标题高出的居中补偿（约 10.5px）+ 行盒半 leading（约 3.5px），
     所以 padding 取 10px，字形上缘落在 ≈24px 处（getBoundingClientRect 的 title.top 含 leading，为 20.5），观感即 24px；
     底部从 12px 压到 6px，减少标题栏与下方卡片的间距。 */
  padding: 10px var(--page-pad-end) 6px var(--page-pad);
  background: transparent;
}

.page-header-content {
  width: 100%;
  margin-inline: auto;
}

.page-header-bar:has(.page-tabs) {
  padding-bottom: 0;
}

.page-tabs-host:empty {
  display: none;
}

.page-scroll {
  position: relative;
  z-index: 0;
  min-height: 0;
  padding: 0 var(--page-pad-end) var(--page-pad-bottom, var(--page-pad)) var(--page-pad);
  isolation: isolate;
  scrollbar-gutter: stable;
}

.page-scroll > :deep(:where(:not(.panel-scroll-layout):not(:has(.panel-scroll-layout)))) {
  flex: 0 0 auto;
}

.page-scroll > :deep(*) {
  width: 100%;
  min-width: 0;
  max-width: none;
  /* 首张卡片上缘对齐侧栏「概览」项的文字上缘（88px）：
     标题栏 1 + 49 + 6 = 56，再加 12px 间距落在 68，与按钮行（top 80）视觉齐平。 */
  margin-block-start: 12px;
  margin-inline: auto;
}

.page-scroll--dashboard > :deep(.dashboard-page) {
  flex: 1 0 auto;
}

/* 活动详情隐藏通用页头；普通详情沿用页面滚动，游戏外壳保留内部滚动。 */
.page-scroll--fill > :deep(*) {
  margin-block-start: 0;
  flex: 1 1 auto;
  min-height: 0;
}

.page-scroll--fill :deep(.activity-shell) {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
