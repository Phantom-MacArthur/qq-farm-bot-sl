import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAppStore = defineStore('app', () => {
  const sidebarOpen = ref(false)
  // 活动详情有自己的标题栏，打开时布局隐藏通用页头并让活动外壳撑满内容区。
  const activityDetailOpen = ref(false)
  const sidebarCollapsed = useStorage('sidebar_collapsed', false)

  function toggleSidebar() {
    sidebarOpen.value = !sidebarOpen.value
  }

  function closeSidebar() {
    sidebarOpen.value = false
  }

  function openSidebar() {
    sidebarOpen.value = true
  }

  function toggleSidebarCollapsed() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  return {
    sidebarOpen,
    sidebarCollapsed,
    activityDetailOpen,
    toggleSidebar,
    closeSidebar,
    openSidebar,
    toggleSidebarCollapsed,
  }
})
