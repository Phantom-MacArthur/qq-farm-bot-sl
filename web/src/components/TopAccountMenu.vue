<script setup lang="ts">
import type { Account } from '@/stores/account'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import api from '@/api'
import AccountCareerModal from '@/components/AccountCareerModal.vue'
import AccountModal from '@/components/AccountModal.vue'
import RemarkModal from '@/components/RemarkModal.vue'
import { getPlatformClass, getPlatformLabel, useAccountStore } from '@/stores/account'
import { useStatusStore } from '@/stores/status'

// 仿 origin 的 TopAccountMenu：头像 + 昵称 + 平台角标的触发器，
// 下拉内切换账号、改备注、添加账号、跳转设置管理账号。
const accountStore = useAccountStore()
const statusStore = useStatusStore()
const { accounts, currentAccount } = storeToRefs(accountStore)
const { status } = storeToRefs(statusStore)

const showAccountDropdown = ref(false)
const showAccountModal = ref(false)
const showRemarkModal = ref(false)
const showCareerModal = ref(false)
const careerLoading = ref(false)
const careerError = ref('')
const careerItems = ref<any[]>([])
const careerProfile = ref<Record<string, any>>({})
const accountToEdit = ref<any>(null)
const failedAvatars = ref(new Set<string>())

const dropdownId = useId()
const menuSurface = ref<HTMLElement | null>(null)
const triggerEl = ref<HTMLElement | null>(null)
const dropdownPos = ref({ top: 0, left: 0, width: 320, maxHeight: 420 })

function onScroll() {
  if (showAccountDropdown.value)
    updateDropdownPos()
}

function onResize() {
  if (showAccountDropdown.value)
    updateDropdownPos()
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onResize)
})

const platform = computed(() => getPlatformLabel(currentAccount.value?.platform))

function cleanText(value: unknown) {
  return String(value || '').trim()
}

function liveAccountName() {
  const name = cleanText(status.value?.status?.name)
  return name && name !== '未登录' ? name : ''
}

function liveAccountAvatar() {
  return cleanText(status.value?.status?.avatarUrl || status.value?.status?.avatar)
}

function accountDisplayName(acc?: Account | null) {
  if (!acc)
    return '选择账号'

  const liveName = currentAccount.value?.id === acc.id ? liveAccountName() : ''
  const nick = cleanText(liveName || acc.nick)
  const remark = cleanText(acc.name)
  if (nick && remark && nick !== remark)
    return `${nick} (${remark})`
  if (nick)
    return nick
  if (remark)
    return remark
  return cleanText(acc.uin || acc.id) || '选择账号'
}

function accountSubtitle(acc?: Account | null) {
  if (!acc)
    return ''
  return cleanText(acc.uin || acc.id)
}

function avatarSource(acc?: Account | null) {
  if (!acc)
    return ''
  const explicit = currentAccount.value?.id === acc.id
    ? cleanText(liveAccountAvatar() || acc.avatar)
    : cleanText(acc.avatar)
  if (explicit)
    return explicit
  const qq = cleanText(acc.uin)
  if (qq && /^\d+$/.test(qq))
    return `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100`
  return ''
}

function avatarKey(acc?: Account | null) {
  return cleanText(acc?.id || acc?.uin || '')
}

function shouldShowAvatar(acc?: Account | null) {
  const key = avatarKey(acc)
  return !!avatarSource(acc) && !!key && !failedAvatars.value.has(key)
}

function markAvatarFailed(acc?: Account | null) {
  const key = avatarKey(acc)
  if (!key)
    return
  const next = new Set(failedAvatars.value)
  next.add(key)
  failedAvatars.value = next
}

function avatarInitial(acc?: Account | null) {
  return accountDisplayName(acc).replace(/[()（）\s]/g, '').slice(0, 1) || '账'
}

const displayName = computed(() => accountDisplayName(currentAccount.value))
const currentAvatarSrc = computed(() => avatarSource(currentAccount.value))
const currentSubtitle = computed(() => accountSubtitle(currentAccount.value))

async function openDropdown() {
  updateDropdownPos()
  showAccountDropdown.value = true
  await nextTick()
  updateDropdownPos()
  menuSurface.value?.querySelector<HTMLElement>('button')?.focus()
}

function closeDropdown() {
  showAccountDropdown.value = false
  triggerEl.value?.focus()
}

function toggleDropdown() {
  if (showAccountDropdown.value) {
    closeDropdown()
    return
  }
  openDropdown()
}

function updateDropdownPos() {
  const el = triggerEl.value
  if (!el)
    return

  const rect = el.getBoundingClientRect()
  const viewportGap = 8
  const width = Math.min(320, window.innerWidth - viewportGap * 2)
  const left = Math.min(
    Math.max(viewportGap, rect.right - width),
    window.innerWidth - width - viewportGap,
  )

  const top = Math.min(rect.bottom + viewportGap, Math.max(viewportGap, window.innerHeight - 160))
  dropdownPos.value = {
    top,
    maxHeight: Math.max(0, window.innerHeight - top - viewportGap),
    left,
    width,
  }
}

function onMenuFocusout(event: FocusEvent) {
  const next = event.relatedTarget as Node | null
  if (!menuSurface.value?.contains(next) && !triggerEl.value?.contains(next))
    showAccountDropdown.value = false
}

function selectAccount(acc: any) {
  accountStore.setCurrentAccount(acc)
  closeDropdown()
}

function openAddAccount() {
  accountToEdit.value = null
  showAccountModal.value = true
  closeDropdown()
}

function openRemarkModal(acc: any) {
  accountToEdit.value = acc
  showRemarkModal.value = true
  closeDropdown()
}

async function handleAccountSaved() {
  await accountStore.fetchAccounts()
  showAccountModal.value = false
  showRemarkModal.value = false
  accountToEdit.value = null
}

// 角色生涯：仿 origin，从顶栏账号菜单进入；数据走 /api/career（后端已移植）。
async function loadCareer() {
  const accountId = cleanText(currentAccount.value?.id)
  if (!accountId)
    return
  careerLoading.value = true
  careerError.value = ''
  try {
    const { data } = await api.get('/api/career', {
      headers: { 'x-account-id': accountId },
    })
    if (!data?.ok)
      throw new Error(data?.error || '生涯记录读取失败')
    careerProfile.value = data.data || {}
    careerItems.value = data.data?.items || []
  }
  catch (error: any) {
    careerError.value = error?.response?.data?.error || error?.message || '生涯记录读取失败'
  }
  finally {
    careerLoading.value = false
  }
}

function openCareer() {
  if (!currentAccount.value)
    return
  closeDropdown()
  showCareerModal.value = true
  loadCareer()
}
</script>

<template>
  <div class="relative min-w-0">
    <button
      ref="triggerEl"
      type="button"
      :aria-expanded="showAccountDropdown"
      :aria-controls="dropdownId"
      aria-label="选择和管理账号"
      class="account-trigger max-w-[min(64vw,280px)] flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition-colors"
      @click="toggleDropdown"
      @keydown.escape="closeDropdown"
    >
      <div class="account-trigger__avatar">
        <img
          v-if="shouldShowAvatar(currentAccount)"
          :src="currentAvatarSrc"
          :alt="displayName"
          class="h-full w-full object-cover"
          @error="markAvatarFailed(currentAccount)"
        >
        <span v-else class="text-xs text-gray-500 font-semibold">{{ avatarInitial(currentAccount) }}</span>
      </div>
      <div class="min-w-0 flex flex-col">
        <span class="truncate text-sm text-gray-900 font-semibold">{{ displayName }}</span>
        <span class="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
          <span
            v-if="platform"
            class="rounded px-1 text-xs leading-tight font-medium"
            :class="getPlatformClass(currentAccount?.platform)"
          >
            {{ platform }}
          </span>
          <span v-if="currentSubtitle" class="truncate">{{ currentSubtitle }}</span>
        </span>
      </div>
      <div
        class="i-carbon-chevron-down shrink-0 text-gray-400 transition-transform duration-200"
        :class="{ 'rotate-180': showAccountDropdown }"
      />
    </button>

    <Teleport to="body">
      <div
        v-if="showAccountDropdown"
        class="fixed inset-0 z-[9998] bg-transparent"
        @click="closeDropdown"
      />

      <div
        v-if="showAccountDropdown"
        :id="dropdownId"
        ref="menuSurface"
        role="region"
        aria-label="账号列表与管理"
        class="account-menu-surface fixed z-[9999] overflow-y-auto border border-gray-200/70 rounded-xl bg-white/95 py-1 shadow-xl backdrop-blur-sm"
        :style="{ top: `${dropdownPos.top}px`, left: `${dropdownPos.left}px`, width: `${dropdownPos.width}px`, maxHeight: `${dropdownPos.maxHeight}px` }"
        @keydown.escape.stop.prevent="closeDropdown"
        @focusout="onMenuFocusout"
      >
        <div class="max-h-72 overflow-y-auto">
          <template v-if="accounts.length > 0">
            <div
              v-for="acc in accounts"
              :key="acc.id || acc.uin"
              class="w-full flex items-center gap-3 px-4 py-2 transition-colors hover:bg-gray-100/60"
              :style="{ backgroundColor: currentAccount?.id === acc.id ? 'color-mix(in srgb, var(--ui-primary) 10%, transparent)' : undefined }"
            >
              <button
                type="button"
                class="min-w-0 flex flex-1 items-center gap-3 text-left"
                :aria-label="`选择账号 ${accountDisplayName(acc)}`"
                :aria-pressed="currentAccount?.id === acc.id"
                @click="selectAccount(acc)"
              >
                <div class="h-7 w-7 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200">
                  <img
                    v-if="shouldShowAvatar(acc)"
                    :src="avatarSource(acc)"
                    :alt="accountDisplayName(acc)"
                    class="h-full w-full object-cover"
                    @error="markAvatarFailed(acc)"
                  >
                  <span v-else class="text-xs text-gray-500 font-semibold">{{ avatarInitial(acc) }}</span>
                </div>
                <div class="min-w-0 flex flex-1 flex-col items-start">
                  <span class="w-full truncate text-left text-sm font-medium">{{ accountDisplayName(acc) }}</span>
                  <div class="flex items-center gap-1.5">
                    <span
                      v-if="getPlatformLabel(acc.platform)"
                      class="rounded px-1 text-xs leading-tight font-medium"
                      :class="getPlatformClass(acc.platform)"
                    >
                      {{ getPlatformLabel(acc.platform) }}
                    </span>
                    <span v-if="accountSubtitle(acc)" class="text-xs text-gray-500">{{ accountSubtitle(acc) }}</span>
                  </div>
                </div>
              </button>
              <button
                type="button"
                :aria-label="`修改 ${accountDisplayName(acc)} 的备注`"
                class="rounded-full p-1 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-500"
                title="修改备注"
                @click.stop="openRemarkModal(acc)"
              >
                <div class="i-carbon-edit" />
              </button>
              <div
                v-if="currentAccount?.id === acc.id"
                class="i-carbon-checkmark shrink-0"
                :style="{ color: 'var(--ui-primary)' }"
              />
            </div>
          </template>
          <div v-else class="px-4 py-3 text-center text-sm text-gray-400">
            暂无账号
          </div>
        </div>
        <button
          v-if="currentAccount"
          type="button"
          class="w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors hover:bg-gray-100/60"
          @click="openCareer"
        >
          <span class="i-carbon-user-profile" aria-hidden="true" />
          <span>查看角色生涯</span>
        </button>
        <div class="mt-1 border-t border-gray-100 pt-1">
          <button
            class="w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors hover:bg-gray-100/50"
            :style="{ color: 'var(--ui-primary)' }"
            @click="openAddAccount"
          >
            <div class="i-carbon-add" />
            <span>添加账号</span>
          </button>
          <router-link
            to="/settings"
            class="w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors hover:bg-gray-100/50"
            :style="{ color: 'var(--ui-primary)' }"
            @click="closeDropdown"
          >
            <div class="i-carbon-settings" />
            <span>管理账号</span>
          </router-link>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <AccountModal
        :show="showAccountModal"
        :edit-data="accountToEdit"
        @close="showAccountModal = false; accountToEdit = null"
        @saved="handleAccountSaved"
      />

      <RemarkModal
        :show="showRemarkModal"
        :account="accountToEdit"
        @close="showRemarkModal = false"
        @saved="handleAccountSaved"
      />

      <AccountCareerModal
        :show="showCareerModal"
        :account="currentAccount"
        :profile="careerProfile"
        :items="careerItems"
        :loading="careerLoading"
        :error="careerError"
        @close="showCareerModal = false"
        @refresh="loadCareer"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.account-trigger:hover {
  background: color-mix(in srgb, var(--ui-primary) 6%, transparent);
}

.account-trigger__avatar {
  display: grid;
  height: 36px;
  width: 36px;
  flex: none;
  place-items: center;
  overflow: hidden;
  border-radius: 999px;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface-soft);
}

.account-menu-surface {
  font-family: var(--ui-font-sans, inherit);
  color: var(--ui-ink);
  background: #fff;
}
</style>
