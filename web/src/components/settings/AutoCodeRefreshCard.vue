<script setup lang="ts">
import type { AutoCodeRefreshConfig } from '@/stores/setting'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

withDefaults(defineProps<{
  loading: boolean
  saving: boolean
}>(), {})

const emit = defineEmits<{
  save: []
}>()

const config = defineModel<AutoCodeRefreshConfig>('config', { required: true })
</script>

<template>
  <div class="page-card-surface rounded-lg margin-shell"><span class="margin-content !m-3">
    <div class="panel-titlebar mb-4 justify-between margin-shell"><span class="margin-content">
      <span class="text-sm text-gray-500 dark:text-gray-400">仅带内置登录凭据的微信扫码账号可用</span>
      <BaseButton
        class="ml-auto"
        size="sm"
        :loading="saving"
        :disabled="loading"
        @click="emit('save')"
      >
        保存
      </BaseButton>
    </span></div>

    <div v-if="loading" class="py-4 text-center text-gray-500">
      <div class="i-svg-spinners-ring-resize mx-auto mb-2 text-2xl" />
      <p>加载中...</p>
    </div>

    <div v-else>
      <BaseSwitch v-model="config.enabled" label="启用微信掉线重登" />
      <p class="mt-3 text-xs text-gray-500">在线时仅续期微信授权。掉线后每 5 分钟尝试重登，直到恢复或需要重新扫码。</p>
    </div>
  </span></div>
</template>
