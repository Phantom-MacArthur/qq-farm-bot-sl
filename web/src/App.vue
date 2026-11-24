<script setup lang="ts">
import { darkTheme } from 'naive-ui/es/themes'
import { NConfigProvider } from 'naive-ui/es/config-provider'
import { NDialogProvider } from 'naive-ui/es/dialog'
import { NGlobalStyle } from 'naive-ui/es/global-style'
import { dateZhCN, zhCN } from 'naive-ui/es/locales'
import { NMessageProvider } from 'naive-ui/es/message'
import { NNotificationProvider } from 'naive-ui/es/notification'
import { computed } from 'vue'
import { RouterView } from 'vue-router'
import ToastContainer from '@/components/ToastContainer.vue'
import { useAppStore } from '@/stores/app'
import { createNaiveThemeOverrides } from '@/ui/naive-theme'

const app = useAppStore()
const themeOverrides = computed(() => createNaiveThemeOverrides(app.isDark))
</script>

<template>
  <NConfigProvider
    :theme="app.isDark ? darkTheme : null"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <NGlobalStyle />
    <NMessageProvider placement="top-right" keep-alive-on-hover>
      <NDialogProvider>
        <NNotificationProvider placement="top-right" :max="4">
          <!-- 外壳保持视口宽度；布局小于最小宽度时，侧栏、页头与正文统一横向滚动。 -->
          <div class="app-shell">
            <RouterView />
            <ToastContainer />
          </div>
        </NNotificationProvider>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
