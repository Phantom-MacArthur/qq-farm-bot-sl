import { usePreferredDark, useStorage, useWindowSize } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

type ThemeMode = 'system' | 'light' | 'dark'

export const EXPANDED_LAYOUT_MIN_WIDTH = 962
export const COLLAPSED_LAYOUT_MIN_WIDTH = 884

export const useAppStore = defineStore('app', () => {
  // 自带页头的活动详情使用独立布局。
  const activityUsesCustomLayout = ref(false)
  // 保留上游组件的状态契约；实际切换由页头直接导航，不触发转场。
  const spaceSwitching = ref(false)
  const sidebarCollapsedPreference = useStorage('sidebar_collapsed', false)
  // 只根据视口判断断点，页面最小宽度、内容区滚动条都不能反过来影响侧栏状态。
  const { width: viewportWidth } = useWindowSize({ type: 'inner', includeScrollbar: true })
  const sidebarAutoCollapsed = computed(() => viewportWidth.value < EXPANDED_LAYOUT_MIN_WIDTH)
  const sidebarCollapsed = computed(() => sidebarAutoCollapsed.value || sidebarCollapsedPreference.value)
  const layoutMinWidth = computed(() => sidebarCollapsed.value ? COLLAPSED_LAYOUT_MIN_WIDTH : EXPANDED_LAYOUT_MIN_WIDTH)
  const sidebarToggleLabel = computed(() => sidebarAutoCollapsed.value
    ? `窗口宽度不足 ${EXPANDED_LAYOUT_MIN_WIDTH}px，侧栏已自动收起`
    : sidebarCollapsed.value ? '展开侧栏' : '收起侧栏')

  const themeMode = useStorage<ThemeMode>('theme_mode', 'system')
  const preferredDark = usePreferredDark()
  const isDark = computed(() => themeMode.value === 'dark' || (themeMode.value === 'system' && preferredDark.value))
  watch(isDark, (dark) => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }, { immediate: true })
  function setThemeMode(mode: ThemeMode) {
    themeMode.value = mode
  }

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
    activityUsesCustomLayout,
    spaceSwitching,
    themeMode,
    isDark,
    setThemeMode,
    toggleSidebarCollapsed,
  }
})
