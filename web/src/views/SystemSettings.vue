<script setup lang="ts">
import type { AutoCodeRefreshConfig } from '@/stores/setting'
import { NTab } from 'naive-ui/es/tabs'
import { computed, onMounted, ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import PageTabs from '@/components/PageTabs.vue'
import AutoCodeRefreshCard from '@/components/settings/AutoCodeRefreshCard.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useAccountStore } from '@/stores/account'
import { useSettingStore } from '@/stores/setting'
import { useToastStore } from '@/stores/toast'

const accountStore = useAccountStore()
const settingStore = useSettingStore()
const toast = useToastStore()

function showAlert(message: string, type: 'primary' | 'danger' = 'primary') {
  if (type === 'danger') {
    toast.error(message)
    return
  }
  toast.success(message)
}

type SystemTab = 'refresh' | 'login' | 'environment'
const activeSystemTab = ref<SystemTab>('refresh')
const systemTabs = [
  { key: 'refresh', label: '定时刷新', icon: 'i-carbon-time' },
  { key: 'login', label: '登录设置', icon: 'i-carbon-login' },
  { key: 'environment', label: '运行环境', icon: 'i-carbon-settings-adjust' },
] as const
function setActiveSystemTab(value: string) {
  if (systemTabs.some(tab => tab.key === value))
    activeSystemTab.value = value as SystemTab
}

const systemConfigSaving = ref(false)
const systemConfigLoading = ref(false)
const loginSettingsSaving = ref(false)

// ===== 抓包登录配置（对接 /api/settings/capture-config） =====
const captureConfigTesting = ref(false)
const localCaptureConfig = ref({
  enabled: false,
  autoImportQqGids: true,
  embedded: false,
  running: false,
})

function normalizeCaptureConfig(source: any) {
  return {
    enabled: source?.enabled === true,
    autoImportQqGids: source?.autoImportQqGids !== false,
    embedded: source?.embedded === true,
    running: source?.running === true,
  }
}

async function loadCaptureConfigSettings() {
  try {
    const { data } = await api.get('/api/settings/capture-config')
    if (data?.ok)
      localCaptureConfig.value = normalizeCaptureConfig(data.data)
  }
  catch (e) {
    console.error('加载抓包登录配置失败:', e)
  }
}

async function handleTestCaptureConfig() {
  captureConfigTesting.value = true
  try {
    const { data } = await api.post('/api/settings/capture-config/test')
    if (data?.ok) {
      const d = data.data || {}
      showAlert(`抓包内核自检通过：会话 ${d.sessions || 0}，端口池 ${d.portPoolSize || 0}，代理端口 ${d.proxyPort || '-'}`, 'primary')
    }
    else {
      showAlert(getApiErrorMessage(data, '自检失败'), 'danger')
    }
  }
  catch (e: any) {
    showAlert(`自检失败: ${getApiErrorMessage(e, '未知错误')}`, 'danger')
  }
  finally {
    captureConfigTesting.value = false
  }
}

// ==================== 微信 code 定时刷新 ====================
const localAutoCodeRefresh = ref<AutoCodeRefreshConfig>({ enabled: true, intervalMinutes: 2, maxRetries: 8 })
const autoCodeRefreshSaving = ref(false)

async function fetchAutoCodeRefresh() {
  const result = await settingStore.fetchAutoCodeRefresh()
  if (!result.ok) {
    showAlert(`读取刷新设置失败: ${result.error || '未知错误'}`, 'danger')
    return
  }
  localAutoCodeRefresh.value = { ...settingStore.autoCodeRefresh }
}

async function saveAutoCodeRefreshSettings() {
  if (autoCodeRefreshSaving.value)
    return
  autoCodeRefreshSaving.value = true
  try {
    localAutoCodeRefresh.value.intervalMinutes = Math.max(1, Math.min(1440, Math.round(Number(localAutoCodeRefresh.value.intervalMinutes) || 2)))
    localAutoCodeRefresh.value.maxRetries = Math.max(1, Math.min(100, Math.round(Number(localAutoCodeRefresh.value.maxRetries) || 8)))
    const result = await settingStore.saveAutoCodeRefresh(localAutoCodeRefresh.value)
    if (!result.ok)
      throw new Error(result.error || '保存失败')
    showAlert('微信code定时刷新设置已保存')
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '刷新设置保存失败', 'danger')
  }
  finally {
    autoCodeRefreshSaving.value = false
  }
}

// “立即刷新”入口已从设置卡片中移除；取码仍由账号启动前的 settingStore.runAutoCodeRefresh(id)
// 和定时调度负责，两处共用同一个 store 方法，这里不再包一层只给当前账号手动触发。

const defaultDeviceInfo = {
  os: 'Windows',
  clientVersion: '',
  sysSoftware: 'Windows 10',
  network: 'wifi',
  memory: '16384',
  deviceId: 'DESKTOP-PC<WPC>',
  userAgent: '',
}

const localSystemConfig = ref({
  serverUrl: '',
  clientVersion: '',
  wxClientVersion: '',
  platform: 'qq',
  os: 'Windows',
  timeZone: 'Asia/Shanghai',
  deviceInfo: { ...defaultDeviceInfo },
})
const defaultSystemConfig = ref({
  serverUrl: '',
  clientVersion: '',
  wxClientVersion: '',
  platform: 'qq',
  os: 'Windows',
  timeZone: 'Asia/Shanghai',
  deviceInfo: { ...defaultDeviceInfo },
})
const localLoginSettings = ref({
  wechatQrLogin: true,
  qqQrLogin: false,
  napCatEndpoint: '',
  napCatSignature: '',
})
const devicePresets = ref<any[]>([])
const selectedPresetId = ref<string | number>('')
const devicePresetOptions = computed(() => devicePresets.value.map(item => ({ label: item.name, value: item.id })))
const timeZoneOptions = ref([
  { label: '北京时间 / 上海（UTC+8）', value: 'Asia/Shanghai' },
])
const platformOptions = [
  { label: 'QQ', value: 'qq' },
  { label: '微信', value: 'wx' },
]
const osOptions = [
  { label: 'Windows', value: 'Windows' },
  { label: 'iOS', value: 'iOS' },
  { label: 'Android', value: 'Android' },
]

function normalizeSystemConfig(source: any, fallback: any) {
  return {
    serverUrl: source?.serverUrl || '',
    clientVersion: source?.clientVersion || '',
    wxClientVersion: source?.wxClientVersion || fallback.wxClientVersion || '',
    platform: source?.platform || 'qq',
    os: source?.os || 'Windows',
    timeZone: source?.timeZone || fallback.timeZone || 'Asia/Shanghai',
    deviceInfo: source?.deviceInfo ? { ...fallback.deviceInfo, ...source.deviceInfo } : { ...fallback.deviceInfo },
  }
}

function normalizeLoginSettings(source: any) {
  return {
    wechatQrLogin: typeof source?.wechatQrLogin === 'boolean' ? source.wechatQrLogin : true,
    qqQrLogin: typeof source?.qqQrLogin === 'boolean' ? source.qqQrLogin : false,
    napCatEndpoint: typeof source?.napCatEndpoint === 'string' ? source.napCatEndpoint.trim() : '',
    napCatSignature: typeof source?.napCatSignature === 'string' ? source.napCatSignature.trim() : '',
  }
}

async function loadDevicePresets() {
  try {
    const { data } = await api.get('/api/settings/device-presets')
    if (data?.ok && Array.isArray(data.data)) {
      devicePresets.value = data.data
      if (devicePresets.value[0])
        applyDevicePreset(devicePresets.value[0].id)
    }
  }
  catch (e) {
    console.error('加载设备预设失败:', e)
  }
}

function applyDevicePreset(presetId: string | number) {
  const preset = devicePresets.value.find(item => item.id === presetId)
  if (!preset)
    return
  const deviceInfo = { ...defaultDeviceInfo, ...(preset.deviceInfo || {}) }
  localSystemConfig.value = {
    ...localSystemConfig.value,
    platform: 'wx',
    os: deviceInfo.os || 'Windows',
    clientVersion: deviceInfo.clientVersion || '',
    deviceInfo,
  }
  selectedPresetId.value = presetId
}

async function loadSystemConfig() {
  systemConfigLoading.value = true
  try {
    const { data } = await api.get('/api/settings/system-config')
    if (data?.ok) {
      if (Array.isArray(data.data.timeZones) && data.data.timeZones.length) {
        timeZoneOptions.value = data.data.timeZones.map((option: any) => ({
          label: String(option.label || option.value || ''),
          value: String(option.value || 'Asia/Shanghai'),
        }))
      }
      defaultSystemConfig.value = normalizeSystemConfig(data.data.default, defaultSystemConfig.value)
      localSystemConfig.value = normalizeSystemConfig(data.data.saved || data.data.default, defaultSystemConfig.value)
      localLoginSettings.value = normalizeLoginSettings(data.data.loginSettings)
    }
  }
  catch (e) {
    console.error('加载系统配置失败:', e)
  }
  finally {
    systemConfigLoading.value = false
  }
}

async function handleSaveLoginSettings() {
  if (localLoginSettings.value.qqQrLogin
    && (!localLoginSettings.value.napCatEndpoint.trim() || !localLoginSettings.value.napCatSignature.trim())) {
    showAlert('开启 QQ 扫码登录前，请配置 NapCat 接口地址和接口签名', 'danger')
    return
  }
  loginSettingsSaving.value = true
  let loginSaved = false
  try {
    const { data: loginResult } = await api.post('/api/settings/login-config', localLoginSettings.value)
    if (!loginResult?.ok) {
      showAlert(getApiErrorMessage(loginResult, '保存登录设置失败'), 'danger')
      return
    }
    localLoginSettings.value = normalizeLoginSettings(loginResult.data)
    loginSaved = true
    const { data: captureResult } = await api.post('/api/settings/capture-config', {
      enabled: localCaptureConfig.value.enabled,
      autoImportQqGids: localCaptureConfig.value.autoImportQqGids,
    })
    if (!captureResult?.ok) {
      showAlert(`登录设置已保存，抓包设置保存失败: ${getApiErrorMessage(captureResult, '未知错误')}`, 'danger')
      return
    }
    localCaptureConfig.value = normalizeCaptureConfig(captureResult.data)
    showAlert('登录设置与抓包设置已保存', 'primary')
  }
  catch (e: any) {
    showAlert(`${loginSaved ? '登录设置已保存，抓包设置保存失败' : '保存失败'}: ${getApiErrorMessage(e, '未知错误')}`, 'danger')
  }
  finally {
    loginSettingsSaving.value = false
  }
}

async function handleSaveSystemConfig() {
  systemConfigSaving.value = true
  try {
    localSystemConfig.value.clientVersion = localSystemConfig.value.deviceInfo.clientVersion
    localSystemConfig.value.os = localSystemConfig.value.deviceInfo.os
    const { data } = await api.post('/api/settings/system-config', localSystemConfig.value)
    showAlert(data?.ok ? '系统配置已保存，连接参数在下次登录时生效' : getApiErrorMessage(data, '保存失败'), data?.ok ? 'primary' : 'danger')
  }
  catch (e: any) {
    showAlert(`保存失败: ${getApiErrorMessage(e, '未知错误')}`, 'danger')
  }
  finally {
    systemConfigSaving.value = false
  }
}

async function handleResetSystemConfig() {
  systemConfigSaving.value = true
  try {
    const { data } = await api.post('/api/settings/system-config/reset')
    if (data?.ok) {
      localSystemConfig.value = normalizeSystemConfig(data.data.saved, defaultSystemConfig.value)
      if (devicePresets.value[0])
        applyDevicePreset(devicePresets.value[0].id)
      showAlert('系统配置已重置，连接参数在下次登录时生效', 'primary')
    }
    else {
      showAlert(getApiErrorMessage(data, '重置失败'), 'danger')
    }
  }
  catch (e: any) {
    showAlert(`重置失败: ${getApiErrorMessage(e, '未知错误')}`, 'danger')
  }
  finally {
    systemConfigSaving.value = false
  }
}

onMounted(async () => {
  await accountStore.fetchAccounts()
  await Promise.all([loadSystemConfig(), loadCaptureConfigSettings(), fetchAutoCodeRefresh()])
  await loadDevicePresets()
})
</script>

<template>
  <div class="settings-page page-stack">
    <div class="settings-content panel-fill">
      <PageTabs :value="activeSystemTab" @update:value="setActiveSystemTab">
        <NTab v-for="tab in systemTabs" :key="tab.key" :name="tab.key">
          <span class="inline-flex items-center gap-2">
            <span :class="tab.icon" />
            {{ tab.label }}
          </span>
        </NTab>
      </PageTabs>

      <div class="settings-body panel-fill">
        <!-- 系统设置 -->
        <div class="space-y-4">
          <div class="system-settings-content flex flex-col gap-3">
            <section v-if="activeSystemTab === 'environment'" class="page-card-surface rounded-lg margin-shell"><span class="margin-content !m-3">
              <div class="panel-titlebar mb-4 justify-between margin-shell"><span class="margin-content">
                <div class="ml-auto flex shrink-0 items-center gap-2">
                  <BaseButton variant="secondary" class="!w-auto !min-w-0" :disabled="systemConfigLoading" :loading="systemConfigSaving" @click="handleResetSystemConfig">
                    重置
                  </BaseButton>
                  <BaseButton variant="primary" size="sm" :disabled="systemConfigLoading" :loading="systemConfigSaving" @click="handleSaveSystemConfig">
                    保存
                  </BaseButton>
                </div>
              </span></div>

              <div v-if="systemConfigLoading" class="py-8 text-center text-gray-500">
                <span class="i-svg-spinners-90-ring-with-bg inline-block text-2xl" />
              </div>
              <div v-else class="system-environment-fields space-y-3">
                <div class="system-environment-selects grid grid-cols-1 gap-3" :class="devicePresets.length ? 'md:grid-cols-3' : 'md:grid-cols-2'">
                  <BaseSelect
                    v-if="devicePresets.length"
                    v-model="selectedPresetId"
                    label="设备预设"
                    :options="devicePresetOptions"
                    placeholder="选择设备预设"
                    @change="applyDevicePreset"
                  />
                  <BaseSelect v-model="localSystemConfig.platform" label="平台" :options="platformOptions" />
                  <BaseSelect v-model="localSystemConfig.deviceInfo.os" label="系统" :options="osOptions" />
                </div>

                <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <BaseInput
                    v-model="localSystemConfig.serverUrl"
                    label="服务器地址"
                    type="text"
                    placeholder="wss://..."
                  />
                  <BaseSelect
                    v-model="localSystemConfig.timeZone"
                    label="系统时区"
                    :options="timeZoneOptions"
                  />
                </div>

                <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <BaseInput
                    v-model="localSystemConfig.deviceInfo.clientVersion"
                    label="QQ 客户端版本"
                    type="text"
                    :placeholder="defaultSystemConfig.deviceInfo.clientVersion || '从服务器加载中...'"
                  />
                  <BaseInput
                    v-model="localSystemConfig.wxClientVersion"
                    label="微信客户端版本"
                    type="text"
                    :placeholder="defaultSystemConfig.wxClientVersion || '从服务器加载中...'"
                  />
                  <BaseInput
                    v-model="localSystemConfig.deviceInfo.sysSoftware"
                    label="系统版本"
                    type="text"
                    placeholder="Windows 10"
                  />
                  <BaseInput
                    v-model="localSystemConfig.deviceInfo.deviceId"
                    label="设备标识"
                    type="text"
                    placeholder="DESKTOP-PC<WPC>"
                  />
                  <BaseInput
                    v-model="localSystemConfig.deviceInfo.memory"
                    label="内存 (MB)"
                    type="text"
                    placeholder="16384"
                  />
                  <BaseInput
                    v-model="localSystemConfig.deviceInfo.network"
                    label="网络"
                    type="text"
                    placeholder="wifi"
                  />
                  <div class="col-span-full pr-3">
                    <BaseInput
                      v-model="localSystemConfig.deviceInfo.userAgent"
                      label="User-Agent"
                      type="text"
                      placeholder="Mozilla/5.0 ..."
                    />
                  </div>
                </div>
              </div>
            </span></section>

            <AutoCodeRefreshCard
              v-if="activeSystemTab === 'refresh'"
              v-model:config="localAutoCodeRefresh"
              class="system-settings-form"
              :loading="settingStore.autoCodeRefreshLoading"
              :saving="autoCodeRefreshSaving"
              @save="saveAutoCodeRefreshSettings"
            />

            <div v-if="activeSystemTab === 'login'" class="system-settings-form min-w-0 flex flex-col gap-3">
              <section class="page-card-surface rounded-lg margin-shell"><span class="margin-content !m-3">
                <div class="panel-titlebar mb-4 justify-between margin-shell"><span class="margin-content">
                  <div class="ml-auto flex shrink-0 items-center gap-2">
                    <BaseButton
                      variant="secondary"
                      class="!w-auto !min-w-0"
                      :loading="captureConfigTesting"
                      @click="handleTestCaptureConfig"
                    >
                      连通性自检
                    </BaseButton>
                    <BaseButton
                      variant="primary"
                      size="sm"
                      :loading="loginSettingsSaving"
                      @click="handleSaveLoginSettings"
                    >
                      保存
                    </BaseButton>
                  </div>
                </span></div>

                <div class="grid grid-cols-2 gap-2">
                  <BaseSwitch v-model="localCaptureConfig.enabled" label="启用抓包登录" />
                  <BaseSwitch v-model="localCaptureConfig.autoImportQqGids" label="自动导入 QQ 好友" :disabled="!localCaptureConfig.enabled" />
                </div>
                <div class="grid grid-cols-2 mt-4 gap-2">
                  <BaseSwitch v-model="localLoginSettings.wechatQrLogin" label="微信扫码登录" />
                  <BaseSwitch v-model="localLoginSettings.qqQrLogin" label="QQ扫码登录" />
                </div>

                <div
                  v-if="localLoginSettings.qqQrLogin"
                  class="grid grid-cols-2 mt-4 gap-3"
                >
                  <BaseInput
                    v-model="localLoginSettings.napCatEndpoint"
                    label="NapCat接口地址"
                    type="text"
                    placeholder="http://127.0.0.1:6099"
                  />
                  <BaseInput
                    v-model="localLoginSettings.napCatSignature"
                    label="NapCat接口签名"
                    type="password"
                    placeholder="请输入 NapCat 接口签名"
                  />
                </div>
              </span></section>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.system-settings-content :deep(.panel-titlebar) {
  margin-bottom: 0;
  margin-inline: calc(-1 * var(--ui-settings-space));
  --inset-top: var(--ui-settings-space);
  --inset-right: var(--ui-settings-space);
  --inset-bottom: var(--ui-settings-space);
  --inset-left: var(--ui-settings-space);
}

.system-settings-content :deep(.panel-titlebar + *) {
  margin-top: 12px;
}

.system-settings-content :deep(.base-switch__label) {
  font-size: var(--ui-font-size-medium-14);
  font-weight: 600;
}

.system-settings-form,
.system-settings-form :deep(:is(.base-switch__label, .base-field__label)) {
  font-size: var(--ui-font-size-small-13);
  font-weight: var(--fw-400);
}

.system-environment-fields :deep(.base-field) {
  flex-direction: row;
  align-items: center;
  gap: 10px;
}

.system-environment-selects :deep(.base-field) {
  gap: 12px;
}

.system-environment-fields :deep(.base-field__label) {
  flex: 0 0 calc(7rem - 20px);
  white-space: nowrap;
}

.system-environment-selects :deep(.base-field__label) {
  flex: 0 0 auto;
}

.system-environment-fields :deep(.base-field > :not(.base-field__label)) {
  flex: 1 1 auto;
  min-width: 0;
}
</style>
