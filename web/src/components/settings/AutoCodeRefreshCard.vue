<script setup lang="ts">
import type { AutoCodeRefreshConfig } from '@/stores/setting'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
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
  <div class="page-card-surface rounded-lg margin-shell"><span class="margin-content !m-4">
    <div class="panel-titlebar mb-4 justify-between margin-shell"><span class="margin-content">
      <span class="text-sm text-gray-500 dark:text-gray-400">仅带内置登录凭据的微信扫码账号可用</span>
      <BaseButton
        class="ml-auto"
        size="sm"
        :loading="saving"
        :disabled="loading"
        @click="emit('save')"
      >
        保存刷新设置
      </BaseButton>
    </span></div>

    <div v-if="loading" class="py-4 text-center text-gray-500">
      <div class="i-svg-spinners-ring-resize mx-auto mb-2 text-2xl" />
      <p>加载中...</p>
    </div>

    <div v-else>
      <BaseSwitch v-model="config.enabled" label="启用定时刷新" />
      <!-- 两个字段按内容宽靠左排同一行、固定 24px 间距。 -->
      <div class="mt-3 flex items-start gap-6">
        <BaseInput
          v-model.number="config.maxRetries"
          label="每日最大重试次数"
          inline-label
          type="number"
          controls="vertical"
          min="1"
          max="100"
          placeholder="8"
        />
        <BaseInput
          v-model.number="config.intervalMinutes"
          label="间隔(分钟)"
          inline-label
          type="number"
          controls="vertical"
          min="1"
          max="1440"
          placeholder="2"
        />
      </div>
    </div>
  </span></div>
</template>
