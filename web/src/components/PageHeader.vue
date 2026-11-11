<script setup lang="ts">
import { NButton } from 'naive-ui/es/button'
import { storeToRefs } from 'pinia'
import TopAccountMenu from '@/components/TopAccountMenu.vue'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
const { sidebarOpen } = storeToRefs(appStore)
</script>

<template>
  <header class="page-header">
    <!-- 左侧：应用图标 + 标题 -->
    <div class="min-w-0 flex flex-1 items-center gap-3">
      <NButton
        class="lg:hidden"
        quaternary
        circle
        aria-controls="app-sidebar"
        :aria-expanded="sidebarOpen"
        aria-label="打开侧栏"
        title="打开侧栏"
        @click="appStore.openSidebar"
      >
        <div class="i-carbon-menu text-xl" />
      </NButton>
      <div class="page-header__brand">
        <img src="/icon.png" alt="QQ农场智能助手图标" class="h-full w-full object-cover">
      </div>
      <h1 class="page-header__title">
        QQ农场智能助手
      </h1>
    </div>

    <!-- 右侧：账号切换 -->
    <div class="flex shrink-0 items-center">
      <TopAccountMenu />
    </div>
  </header>
</template>

<style scoped>
.page-header {
  min-height: 44px;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0;
}

.page-header__brand {
  height: 32px;
  width: 32px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 999px;
  border: 1px solid var(--ui-border);
  box-shadow: var(--ui-shadow-sm);
}

.page-header__title {
  overflow: hidden;
  margin: 0;
  color: var(--ui-ink);
  font-size: 20px;
  font-weight: var(--fw-700);
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1023px) {
  .page-header__title {
    font-size: 17px;
  }
}
</style>
