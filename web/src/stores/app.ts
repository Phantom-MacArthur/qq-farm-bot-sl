import { useStorage, useWindowSize } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const EXPANDED_LAYOUT_MIN_WIDTH = 962
export const COLLAPSED_LAYOUT_MIN_WIDTH = 884

export const useAppStore = defineStore('app', () => {
  // 活动详情有自己的标题栏，打开时布局隐藏通用页头并让活动外壳撑满内容区。
  const activityDetailOpen = ref(false)
  const sidebarCollapsedPreference = useStorage('sidebar_collapsed', false)
  // 只根据视口判断断点，页面最小宽度、内容区滚动条都不能反过来影响侧栏状态。
  const { width: viewportWidth } = useWindowSize({ type: 'inner', includeScrollbar: true })
  const sidebarAutoCollapsed = computed(() => viewportWidth.value < EXPANDED_LAYOUT_MIN_WIDTH)
  const sidebarCollapsed = computed(() => sidebarAutoCollapsed.value || sidebarCollapsedPreference.value)
  const layoutMinWidth = computed(() => sidebarCollapsed.value ? COLLAPSED_LAYOUT_MIN_WIDTH : EXPANDED_LAYOUT_MIN_WIDTH)
  const sidebarToggleLabel = computed(() => sidebarAutoCollapsed.value
    ? `窗口宽度不足 ${EXPANDED_LAYOUT_MIN_WIDTH}px，侧栏已自动收起`
    : sidebarCollapsed.value ? '展开侧栏' : '收起侧栏')

  function toggleSidebarCollapsed() {
    // 自动收起不写入持久化偏好；回到宽屏时恢复用户原来的选择。
    if (!sidebarAutoCollapsed.value)
      sidebarCollapsedPreference.value = !sidebarCollapsedPreference.value
  }

  return {
    sidebarCollapsed,
    sidebarAutoCollapsed,
    sidebarToggleLabel,
    layoutMinWidth,
    activityDetailOpen,
    toggleSidebarCollapsed,
  }
})
