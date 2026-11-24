<script setup lang="ts">
import { NButton } from 'naive-ui/es/button'
import { NDropdown } from 'naive-ui/es/dropdown'
import { useAppStore } from '@/stores/app'

const app = useAppStore()
const labels = { system: '跟随系统', light: '浅色', dark: '深色' }
const options = [
  { label: labels.system, key: 'system' },
  { label: labels.light, key: 'light' },
  { label: labels.dark, key: 'dark' },
]
function selectTheme(key: string) {
  app.setThemeMode(key as keyof typeof labels)
}
</script>

<template>
  <NDropdown trigger="click" :options="options" :value="app.themeMode" @select="selectTheme">
    <NButton quaternary :title="`当前主题：${labels[app.themeMode]}`" :aria-label="`主题：${labels[app.themeMode]}，选择主题`">
      <template #icon>
        <span :class="app.themeMode === 'system' ? 'i-carbon-laptop' : app.themeMode === 'light' ? 'i-carbon-sun' : 'i-carbon-moon'" />
      </template>
      {{ labels[app.themeMode] }}
      <span class="i-carbon-chevron-down ml-1 text-xs" aria-hidden="true" />
    </NButton>
  </NDropdown>
</template>
