<script setup lang="ts">
import { NConfigProvider } from 'naive-ui/es/config-provider'
import { NDialogProvider } from 'naive-ui/es/dialog'
import { NGlobalStyle } from 'naive-ui/es/global-style'
import { dateZhCN, zhCN } from 'naive-ui/es/locales'
import { NMessageProvider } from 'naive-ui/es/message'
import { NNotificationProvider } from 'naive-ui/es/notification'
import { computed } from 'vue'
import { RouterView } from 'vue-router'
import ToastContainer from '@/components/ToastContainer.vue'
import { createNaiveThemeOverrides } from '@/ui/naive-theme'

// 固定浅色主题（已移除深浅色切换）。
const themeOverrides = computed(() => createNaiveThemeOverrides(false))
</script>

<template>
  <NConfigProvider
    :theme="null"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <NGlobalStyle />
    <NMessageProvider placement="top-right" :max="4" keep-alive-on-hover>
      <NDialogProvider>
        <NNotificationProvider placement="top-right" :max="4">
          <div class="app-shell h-screen w-screen overflow-hidden">
            <RouterView />
            <ToastContainer />
          </div>
        </NNotificationProvider>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
