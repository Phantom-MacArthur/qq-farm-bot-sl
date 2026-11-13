<script setup lang="ts">
import type { AutoCodeRefreshConfig } from '@/stores/setting'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

withDefaults(defineProps<{
<<<<<<< HEAD
  loading: boolean
  saving: boolean
=======
  currentAccountId: string | number | null | undefined
  loading: boolean
  saving: boolean
  refreshing: boolean
>>>>>>> abe5fe93d4f52d2eb5413a21172d6aaf01ed46e3
}>(), {})

const emit = defineEmits<{
  save: []
<<<<<<< HEAD
=======
  refresh: []
>>>>>>> abe5fe93d4f52d2eb5413a21172d6aaf01ed46e3
}>()

const config = defineModel<AutoCodeRefreshConfig>('config', { required: true })
</script>

<template>
  <div class="farm-card rounded-lg p-4">
    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
          微信code定时刷新
        </h3>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          此设置统一应用于所有账号；仅有内置登录凭据的微信扫码账号会自动刷新。
        </p>
      </div>
      <BaseButton
        size="sm"
        :loading="saving"
<<<<<<< HEAD
        :disabled="loading"
=======
        :disabled="loading || refreshing"
>>>>>>> abe5fe93d4f52d2eb5413a21172d6aaf01ed46e3
        @click="emit('save')"
      >
        保存刷新设置
      </BaseButton>
    </div>

    <div v-if="loading" class="py-4 text-center text-gray-500">
      <div class="i-svg-spinners-ring-resize mx-auto mb-2 text-2xl" />
      <p>加载中...</p>
    </div>

    <div v-else class="border border-gray-200 rounded bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/20">
<<<<<<< HEAD
      <BaseSwitch v-model="config.enabled" label="启用定时刷新与自动重登" />
      <p class="mt-2 max-w-3xl text-xs text-gray-500 dark:text-gray-400">
        <span class="text-amber-700 font-semibold dark:text-amber-300">仅带内置登录凭据的微信扫码账号可用。</span>
        启用后会按间隔获取新 Code 并重启账号；账号被踢或重连失败时，也会按此间隔尝试自动重登。
        手动停止的账号会退出轮询，不会被定时刷新重新拉起（凭证保活继续）。
        关闭不会停用启动时刷新、Code 失效时的即时恢复和微信凭证保活。
      </p>

      <!-- 两个字段按内容宽靠左排同一行、固定 24px 间距；说明文字换到下一行，
           否则它单行撑开的宽度会把第二个字段顶到卡片另一头。 -->
      <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
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
      <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
        每个账号的每日重试次数上限最多可设为 100；达到上限后当天不再自动重试。
      </p>
=======
      <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div class="min-w-0 flex-1 space-y-2">
          <BaseSwitch v-model="config.enabled" label="启用定时刷新与自动重登" />
          <p class="max-w-3xl text-xs text-gray-500 dark:text-gray-400">
            <span class="text-amber-700 font-semibold dark:text-amber-300">仅带内置登录凭据的微信扫码账号可用。</span>
            启用后会按间隔获取新 Code 并重启账号；账号被踢或重连失败时，也会按此间隔尝试自动重登。
            手动停止的账号会退出轮询，不会被定时刷新重新拉起（凭证保活继续）。
            关闭不会停用启动时刷新、Code 失效时的即时恢复和微信凭证保活。
          </p>
          <BaseInput
            v-model.number="config.maxRetries"
            class="sm:w-40"
            label="每日最大重试次数"
            type="number"
            min="1"
            max="100"
            placeholder="8"
          />
          <p class="text-xs text-gray-500 dark:text-gray-400">
            每个账号的每日重试次数上限最多可设为 100；达到上限后当天不再自动重试。
          </p>
        </div>

        <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
          <BaseInput
            v-model.number="config.intervalMinutes"
            class="sm:w-36"
            label="间隔(分钟)"
            type="number"
            min="1"
            max="1440"
            placeholder="2"
          />
          <BaseButton
            variant="secondary"
            size="sm"
            class="h-9 whitespace-nowrap"
            :loading="refreshing"
            :disabled="saving || !currentAccountId"
            :title="!currentAccountId ? '请先在账号管理中选择账号' : ''"
            @click="emit('refresh')"
          >
            <span class="i-carbon-renew mr-1" />
            立即刷新
          </BaseButton>
        </div>
      </div>
>>>>>>> abe5fe93d4f52d2eb5413a21172d6aaf01ed46e3
    </div>
  </div>
</template>
