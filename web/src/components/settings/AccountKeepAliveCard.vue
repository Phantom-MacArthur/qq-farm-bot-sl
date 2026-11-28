<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

/** 账号在线配置：周期性重登已整体下线，只保留掉线重登。 */
interface OnlineConfig {
  offlineEnabled: boolean
  offlineDelaySeconds: number
}

const emit = defineEmits<{ notify: [message: string, type?: 'primary' | 'danger'] }>()

const DEFAULT_CONFIG: OnlineConfig = { offlineEnabled: true, offlineDelaySeconds: 300 }

const config = ref<OnlineConfig>({ ...DEFAULT_CONFIG })
// 服务启动后自动登录已保存的账号（系统级开关，默认开启）。
const autoStart = ref(true)
const loading = ref(true)
const saving = ref(false)

const busy = computed(() => saving.value)
const disabled = computed(() => loading.value || busy.value)
const enabled = computed(() => config.value.offlineEnabled || autoStart.value)
const status = computed(() => loading.value ? '加载中' : enabled.value ? '已开启' : '已关闭')

function normalize(input: any): OnlineConfig {
  const src = (input && typeof input === 'object') ? input : {}
  return {
    offlineEnabled: src.offlineEnabled === undefined || src.offlineEnabled === null
      ? true
      : src.offlineEnabled === true,
    offlineDelaySeconds: DEFAULT_CONFIG.offlineDelaySeconds,
  }
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/api/settings/system-config')
    if (data?.ok) {
      const saved = data.data?.saved || data.data?.default
      config.value = normalize(saved?.autoCodeRefresh)
      autoStart.value = saved?.autoStartAccounts !== false
    }
  }
  catch (e) {
    console.error('加载账号在线配置失败:', e)
  }
  finally {
    loading.value = false
  }
}

async function save(next: OnlineConfig) {
  if (disabled.value)
    return false
  saving.value = true
  try {
    const payload = normalize(next)
    const { data } = await api.post('/api/settings/system-config', { autoCodeRefresh: payload })
    if (!data?.ok) {
      emit('notify', getApiErrorMessage(data, '保存账号在线配置失败'), 'danger')
      return false
    }
    config.value = normalize(data.data?.saved?.autoCodeRefresh ?? payload)
    emit('notify', '账号在线配置已保存', 'primary')
    return true
  }
  catch (e: any) {
    emit('notify', `保存失败: ${getApiErrorMessage(e, '未知错误')}`, 'danger')
    return false
  }
  finally {
    saving.value = false
  }
}

function toggleOffline(next: boolean | undefined) {
  void save({ ...config.value, offlineEnabled: !!next })
}

async function saveAutoStart(next: boolean | undefined) {
  if (disabled.value)
    return
  const nextValue = !!next
  saving.value = true
  try {
    const { data } = await api.post('/api/settings/system-config', { autoStartAccounts: nextValue })
    if (!data?.ok) {
      emit('notify', getApiErrorMessage(data, '保存自动登录设置失败'), 'danger')
      return
    }
    autoStart.value = (data.data?.saved?.autoStartAccounts ?? nextValue) !== false
    emit('notify', autoStart.value ? '已开启服务启动自动登录' : '已关闭服务启动自动登录', 'primary')
  }
  catch (e: any) {
    emit('notify', `保存失败: ${getApiErrorMessage(e, '未知错误')}`, 'danger')
  }
  finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
          账号登录与重连
        </h4>
        <p class="mt-0.5 text-xs text-gray-500">
          服务启动自动登录、掉线自动重登与微信授权到期前续期
        </p>
      </div>
      <span class="flex shrink-0 items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <span class="h-2 w-2 shrink-0 rounded-full" :class="enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'" />
        {{ status }}
      </span>
    </div>

    <div class="farm-card border border-transparent rounded-2xl bg-white p-3 shadow-md dark:bg-gray-800 sm:p-4">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3 dark:border-gray-700">
        <div class="min-w-0 flex items-center gap-3">
          <span class="inline-grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gray-100 text-xl dark:bg-gray-700">
            <span class="i-carbon-login" />
          </span>
          <div class="min-w-0">
            <h5 class="break-words text-sm text-gray-900 font-semibold dark:text-gray-100">
              账号登录与重连
            </h5>
            <p class="mt-0.5 break-words text-xs text-gray-500">
              所有微信区账号共享 · 仅对具备微信登录凭据的账号生效
            </p>
          </div>
        </div>
        <BaseSwitch
          :model-value="config.offlineEnabled"
          label="掉线重登"
          :disabled="disabled"
          @update:model-value="toggleOffline"
        />
      </div>

      <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <h6 class="text-xs text-gray-900 font-semibold dark:text-gray-100">
            服务启动自动登录
          </h6>
          <p class="mt-0.5 text-xs text-gray-500 leading-relaxed">
            重启服务后自动拉起已保存账号；QQ 账号 Code 失效仍需重新扫码或填写新 Code
          </p>
        </div>
        <BaseSwitch
          :model-value="autoStart"
          label="自动登录"
          :disabled="disabled"
          @update:model-value="saveAutoStart"
        />
      </div>

      <div class="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3 dark:border-gray-700">
        <div class="min-w-0">
          <h6 class="text-xs text-gray-900 font-semibold dark:text-gray-100">
            掉线自动重登
          </h6>
          <p class="mt-0.5 text-xs text-gray-500 leading-relaxed">
            微信掉线后每 5 分钟尝试重登，直到恢复或需要重新扫码。
          </p>
        </div>
        <span class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <span class="h-2 w-2 shrink-0 rounded-full" :class="config.offlineEnabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'" />
          {{ config.offlineEnabled ? '已开启' : '已关闭' }}
        </span>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
        <span class="max-w-full break-words rounded-md bg-gray-50 px-2.5 py-1 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          {{ autoStart ? '服务启动自动登录 已开启' : '服务启动自动登录 已关闭' }}
        </span>
        <span class="max-w-full break-words rounded-md bg-gray-50 px-2.5 py-1 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          {{ config.offlineEnabled ? '每 5 分钟尝试重登' : '掉线重登关闭' }}
        </span>
        <span class="max-w-full break-words rounded-md bg-gray-50 px-2.5 py-1 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          微信授权到期前自动续期 常开
        </span>
      </div>
    </div>

  </div>
</template>
