<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '@/stores/app'

const app = useAppStore()
const themes = {
  system: { label: '跟随系统', next: 'light' },
  light: { label: '浅色', next: 'dark' },
  dark: { label: '深色', next: 'system' },
} as const
const currentTheme = computed(() => themes[app.themeMode] ?? themes.system)
</script>

<template>
  <button
    type="button"
    class="sidebar-footer__action cursor-pointer border-0 bg-transparent p-0"
    :aria-label="`当前主题：${currentTheme.label}，切换到${themes[currentTheme.next].label}`"
    @click="app.setThemeMode(currentTheme.next)"
  >
    <span class="sidebar-footer__icon" aria-hidden="true">
      <span class="i-carbon-color-palette text-xl" />
    </span>
    <span v-show="!app.sidebarCollapsed">{{ currentTheme.label }}</span>
  </button>
</template>
