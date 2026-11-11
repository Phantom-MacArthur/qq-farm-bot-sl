<script setup lang="ts">
import { useIntervalFn, useMediaQuery, useNow } from '@vueuse/core'
import { NButton } from 'naive-ui/es/button'
import { NTooltip } from 'naive-ui/es/tooltip'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/api'
import AccountModal from '@/components/AccountModal.vue'
import { menuRoutes } from '@/router/menu'
import { useAccountStore } from '@/stores/account'
import { useAppStore } from '@/stores/app'
import { useStatusStore } from '@/stores/status'

const accountStore = useAccountStore()
const statusStore = useStatusStore()
const appStore = useAppStore()
const route = useRoute()
const isDesktop = useMediaQuery('(min-width: 1024px)')
const { currentAccount } = storeToRefs(accountStore)
const { status, realtimeConnected } = storeToRefs(statusStore)
const { sidebarOpen, sidebarCollapsed } = storeToRefs(appStore)
const isSidebarCollapsed = computed(() => isDesktop.value && sidebarCollapsed.value)
const navigationExpanded = computed(() => isDesktop.value ? !sidebarCollapsed.value : sidebarOpen.value)
const navigationToggleLabel = computed(() => isDesktop.value
  ? navigationExpanded.value ? '收起侧栏' : '展开侧栏'
  : '关闭侧栏')
const navigationIcon = computed(() => {
  if (!isDesktop.value)
    return 'i-carbon-close'
  return navigationExpanded.value ? 'i-carbon-side-panel-close' : 'i-carbon-side-panel-open'
})
const sidebarTooltipTheme = {
  color: 'rgba(31, 43, 35, 0.94)',
  textColor: '#ffffff',
  borderRadius: '9px',
  boxShadow: '0 8px 24px rgba(30, 45, 35, 0.18)',
  padding: '8px 10px',
}

const showAccountModal = ref(false)
const accountToEdit = ref<any>(null)
const wsErrorNotifiedAt = ref<Record<string, number>>({})

const systemConnected = ref(true)
const serverUptimeBase = ref(0)
const lastPingTime = ref(Date.now())
const now = useNow({ interval: 1000 })

async function checkConnection() {
  try {
    const res = await api.get('/api/ping')
    systemConnected.value = true
    if (res.data.ok && res.data.data) {
      if (res.data.data.uptime) {
        serverUptimeBase.value = res.data.data.uptime
        lastPingTime.value = Date.now()
      }
    }
    const accountRef = currentAccount.value?.id || currentAccount.value?.uin
    if (accountRef) {
      statusStore.connectRealtime(String(accountRef))
    }
  }
  catch {
    systemConnected.value = false
  }
}

async function refreshStatusFallback() {
  if (realtimeConnected.value)
    return

  const accountRef = currentAccount.value?.id || currentAccount.value?.uin
  if (accountRef) {
    await statusStore.fetchStatus(String(accountRef))
  }
}

async function handleAccountSaved() {
  await accountStore.fetchAccounts()
  await refreshStatusFallback()
  showAccountModal.value = false
}

onMounted(() => {
  accountStore.fetchAccounts()
  checkConnection()
})

onBeforeUnmount(() => {
  statusStore.disconnectRealtime()
})

useIntervalFn(checkConnection, 30000)
useIntervalFn(refreshStatusFallback, 10000)

watch(() => currentAccount.value?.id || currentAccount.value?.uin || '', () => {
  const accountRef = currentAccount.value?.id || currentAccount.value?.uin
  statusStore.connectRealtime(String(accountRef || ''))
  refreshStatusFallback()
}, { immediate: true })

watch(
  () => [status.value?.accountId, status.value?.status?.avatarUrl] as const,
  ([accountId, avatar]) => {
    const normalizedId = String(accountId || '')
    const normalizedAvatar = String(avatar || '').trim()
    if (!normalizedId || !normalizedAvatar)
      return
    accountStore.syncAccountAvatar(normalizedId, normalizedAvatar)
  },
)

watch(() => status.value?.wsError, (wsError: any) => {
  if (!wsError || Number(wsError.code) !== 400 || !currentAccount.value)
    return

  const errAt = Number(wsError.at) || 0
  const accId = String(currentAccount.value.id || currentAccount.value.uin || '')
  const lastNotified = wsErrorNotifiedAt.value[accId] || 0
  if (errAt <= lastNotified)
    return

  wsErrorNotifiedAt.value[accId] = errAt
  accountToEdit.value = currentAccount.value
  showAccountModal.value = true
}, { deep: true })

const uptime = computed(() => {
  const diff = Math.floor(serverUptimeBase.value + (now.value.getTime() - lastPingTime.value) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  return `${h}h ${m}m ${s}s`
})

const connectionStatus = computed(() => {
  if (!systemConnected.value) {
    return {
      text: '系统离线',
      color: 'bg-red-500',
      pulse: false,
    }
  }

  if (!currentAccount.value?.id) {
    return {
      text: '请添加账号',
      color: 'bg-gray-400',
      pulse: false,
    }
  }

  const isConnected = status.value?.connection?.connected
  if (isConnected) {
    return {
      text: '已连接',
      color: 'bg-green-500',
      pulse: true,
    }
  }

  return {
    text: '未连接',
    color: 'bg-gray-400', // Or red? Old version uses gray/offline class which is gray usually
    pulse: false,
  }
})

const navItems = computed(() => {
  return menuRoutes
    .map(item => ({
      path: item.path ? `/${item.path}` : '/',
      label: item.label,
      icon: item.icon,
    }))
})

function toggleNavigation() {
  if (isDesktop.value)
    appStore.toggleSidebarCollapsed()
  else
    appStore.closeSidebar()
}

watch(
  () => route.path,
  () => {
    // Close sidebar on route change (mobile only)
    if (window.innerWidth < 1024)
      appStore.closeSidebar()
  },
)
</script>

<template>
  <aside
    id="app-sidebar"
    class="app-sidebar fixed inset-y-0 left-0 z-50 h-full w-[150px] flex shrink-0 flex-col lg:static lg:translate-x-0"
    :class="[
      sidebarOpen ? 'translate-x-0' : '-translate-x-full',
      { 'is-collapsed': isSidebarCollapsed },
    ]"
    aria-label="主导航"
  >
    <div class="sidebar-brand h-15 flex items-center justify-between px-4">
      <NButton
        quaternary
        circle
        aria-controls="app-sidebar"
        :aria-expanded="navigationExpanded"
        :aria-label="navigationToggleLabel"
        :title="navigationToggleLabel"
        @click="toggleNavigation"
      >
        <div class="h-5 w-5 flex-none text-xl leading-5" :class="navigationIcon" />
      </NButton>
    </div>

    <!-- Navigation -->
    <nav class="sidebar-nav flex-1 overflow-y-auto px-3 py-4 space-y-1">
      <NTooltip
        v-for="item in navItems"
        :key="item.path"
        :disabled="!isSidebarCollapsed"
        placement="right"
        :show-arrow="false"
        :theme-overrides="sidebarTooltipTheme"
      >
        <template #trigger>
          <router-link
            :to="item.path"
            class="sidebar-nav__link group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150"
            :active-class="item.path === '/' ? '' : 'font-medium'"
            :style="{
              color: 'var(--theme-text)',
              opacity: '0.85',
            }"
            :data-nav="item.path"
            :aria-label="isSidebarCollapsed ? item.label : undefined"
          >
            <span class="nav-icon" :class="item.icon" />
            <span v-show="!isSidebarCollapsed" class="font-body min-w-0 truncate leading-5">{{ item.label }}</span>
          </router-link>
        </template>
        {{ item.label }}
      </NTooltip>
    </nav>

    <!-- Footer Status -->
    <div class="sidebar-footer relative mb-5 mt-auto translate-y-2.5 px-6 py-3">
      <div class="sidebar-footer__content">
        <div class="sidebar-footer__status">
          <NTooltip
            :disabled="!isSidebarCollapsed"
            placement="right"
            :show-arrow="false"
            :theme-overrides="sidebarTooltipTheme"
          >
            <template #trigger>
              <span class="sidebar-footer__icon" tabindex="0" :aria-label="`连接状态：${connectionStatus.text}`">
                <span class="i-carbon-connection-signal text-xl" />
                <span
                  class="sidebar-status-dot"
                  :class="[connectionStatus.color, { 'animate-pulse': connectionStatus.pulse }]"
                />
              </span>
            </template>
            <div class="sidebar-tooltip-content">
              <span>服务运行时长 {{ uptime }}</span>
            </div>
          </NTooltip>
          <span v-show="!isSidebarCollapsed" class="sidebar-footer__uptime">{{ uptime }}</span>
        </div>
        <a
          class="sidebar-footer__github"
          href="https://github.com/liyangpengs/qq-farm-bot"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub 项目地址"
        >
          <span class="sidebar-footer__icon">
            <span class="i-carbon-logo-github text-xl" />
          </span>
          <span v-show="!isSidebarCollapsed" class="sidebar-footer__github-label">github</span>
        </a>
      </div>
    </div>
  </aside>

  <AccountModal
    :show="showAccountModal"
    :edit-data="accountToEdit"
    @close="showAccountModal = false; accountToEdit = null"
    @saved="handleAccountSaved"
  />
</template>

<style scoped>
.app-sidebar {
  color: var(--ui-ink);
  border-right: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-bg) 84%, transparent);
  box-shadow:
    10px 0 32px rgba(55, 75, 61, 0.06),
    inset -1px 0 0 var(--glass-highlight);
  transition:
    transform 0.2s ease,
    width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  -webkit-backdrop-filter: blur(22px) saturate(135%);
  backdrop-filter: blur(22px) saturate(135%);
}

.sidebar-brand {
  min-height: 62px;
  border-bottom: 1px solid var(--ui-border);
  box-shadow: inset 0 1px 0 var(--glass-highlight);
}

.sidebar-nav__link:focus-visible,
.sidebar-footer__icon:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-primary) 55%, transparent);
  outline-offset: 2px;
}

.sidebar-footer {
  border-top: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-bg-soft) 58%, transparent);
}

.sidebar-footer__content {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}

.sidebar-footer__status {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.sidebar-footer__uptime {
  color: var(--ui-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.sidebar-footer__github {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ui-muted);
  font-size: 11px;
  line-height: 1;
  text-decoration: none;
  white-space: nowrap;
}

.sidebar-footer__github:hover {
  color: var(--ui-primary);
}

.sidebar-footer__github-label {
  min-width: 0;
}

.sidebar-footer__icon {
  position: relative;
  width: 20px;
  height: 20px;
  display: inline-flex;
  flex: 0 0 20px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--ui-muted);
  font-size: 20px;
  line-height: 20px;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;
}

.sidebar-footer__icon:hover {
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

.sidebar-status-dot {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 7px;
  height: 7px;
  border: 1.5px solid color-mix(in srgb, var(--ui-bg) 96%, transparent);
  border-radius: 999px;
}

.sidebar-tooltip-content {
  min-width: 132px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-block: 1px;
  line-height: 1.35;
}

.sidebar-tooltip-content strong {
  font-size: 12px;
  font-weight: var(--fw-600);
}

.sidebar-tooltip-content span {
  font-size: 11px;
  opacity: 0.78;
}

nav a:hover {
  background: var(--ui-primary-soft);
}

.nav-icon {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  font-size: 20px;
  line-height: 20px;
  color: var(--ui-muted);
}

.router-link-active {
  background: var(--ui-primary-soft) !important;
  color: var(--ui-primary) !important;
  font-weight: var(--fw-600);
  box-shadow: inset 0 0 0 1px rgba(67, 141, 99, 0.13) !important;
  border-radius: 8px;
  opacity: 1 !important;
}

.router-link-active .nav-icon {
  color: var(--ui-primary);
}

.router-link-exact-active {
  background: var(--ui-primary-soft) !important;
  color: var(--ui-primary) !important;
  font-weight: var(--fw-600);
  box-shadow: inset 0 0 0 1px rgba(67, 141, 99, 0.13) !important;
  border-radius: 8px;
  opacity: 1 !important;
}

.router-link-exact-active .nav-icon {
  color: var(--ui-primary);
}

@media (min-width: 1024px) {
  .app-sidebar.is-collapsed {
    width: 72px;
  }

  .app-sidebar.is-collapsed .sidebar-nav {
    scrollbar-width: none;
  }

  .app-sidebar.is-collapsed .sidebar-nav::-webkit-scrollbar {
    width: 0;
  }

  .app-sidebar.is-collapsed .sidebar-footer {
    padding: 12px 24px;
  }
}
</style>
