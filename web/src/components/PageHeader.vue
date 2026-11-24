<script setup lang="ts">
import { useRoute } from 'vue-router'
import GameSpaceSwitch from '@/components/GameSpaceSwitch.vue'
import TopAccountMenu from '@/components/TopAccountMenu.vue'
import ThemeSwitcher from '@/components/ThemeSwitcher.vue'

const route = useRoute()
</script>

<template>
  <header class="page-header">
    <!-- 左侧：应用图标 + 标题 -->
    <div class="min-w-0 flex flex-1 items-center gap-3">
      <div class="page-header__brand">
        <img src="/icon.png?v=3" alt="QQ农场智能助手图标" class="h-full w-full object-cover">
      </div>
      <h1 class="page-header__title">
        QQ农场智能助手
      </h1>
    </div>

    <!-- 右侧：主题、空间和账号 -->
    <div class="flex shrink-0 items-center gap-2">
      <ThemeSwitcher />
      <GameSpaceSwitch v-if="route.name !== 'dashboard'" />
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
  font-size: var(--ui-font-size-large-15);
  font-weight: var(--fw-700);
  /* 28px 行盒在 48px 标题栏内居中后，文字上缘恰好落在侧栏「收起边栏」按钮的上沿（12px） */
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
