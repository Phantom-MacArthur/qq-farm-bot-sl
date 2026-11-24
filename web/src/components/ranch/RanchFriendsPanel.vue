<script setup lang="ts">
import { NButton } from 'naive-ui/es/button'
import { NDropdown } from 'naive-ui/es/dropdown'
import { NModal } from 'naive-ui/es/modal'
import { NTab } from 'naive-ui/es/tabs'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import PageTabs from '@/components/PageTabs.vue'
import { useRanchActions, useRanchClock } from '@/components/ranch/ranch-shared'
import CareerHarvestSteal from '@/components/CareerHarvestSteal.vue'
import RanchAmountDialog from '@/components/ranch/RanchAmountDialog.vue'
import RanchAnimalCard from '@/components/ranch/RanchAnimalCard.vue'
import RanchGate from '@/components/ranch/RanchGate.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { useAccountStore } from '@/stores/account'
import { useRanchStore } from '@/stores/ranch'
import { useToastStore } from '@/stores/toast'
import { formatCountdown } from '@/utils/format-countdown'

const ranch = useRanchStore()
const { state, loading, refreshing, error } = storeToRefs(ranch)
const { currentAccountId } = storeToRefs(useAccountStore())
const toast = useToastStore()
const { disabled, request } = useRanchActions()
const { remainingSeconds } = useRanchClock()

const friends = ref<any[]>([])
const listLoaded = ref(false)
const selected = ref('')
const listRefreshing = ref(false)
const refreshingDetail = ref<any>(null)
const mischiefTarget = ref('')
const mischiefPens = ref<Array<{ id: string, name: string }>>([])
watch(currentAccountId, () => { mischiefTarget.value = '' })
const query = ref('')
const failedAvatars = ref<Record<string, boolean>>({})
const activeTab = ref<'friends' | 'visitors' | 'blacklist'>('friends')
const showBlacklist = computed(() => activeTab.value === 'blacklist')
const blacklistGids = ref<number[]>([])
const blacklistLoading = ref(false)
const blacklistSaving = ref(false)
const blacklistError = ref('')
const blacklistBusy = computed(() => blacklistLoading.value || blacklistSaving.value)
const blacklistedSet = computed(() => new Set(blacklistGids.value))
let blacklistRequest = 0
let alive = true
onBeforeUnmount(() => alive = false)

function isCurrentBlacklist(id: string, request: number) {
  return alive && id === String(currentAccountId.value || '') && request === blacklistRequest
}

async function loadBlacklist() {
  const id = String(currentAccountId.value || '')
  if (!id || blacklistBusy.value)
    return
  const request = ++blacklistRequest
  blacklistLoading.value = true
  blacklistError.value = ''
  try {
    const { data } = await api.get('/api/ranch-friend-blacklist', { headers: { 'x-account-id': id }, skipErrorToast: true } as any)
    if (!isCurrentBlacklist(id, request))
      return
    if (!data?.ok)
      throw new Error(getApiErrorMessage(data, '牧场黑名单读取失败'))
    blacklistGids.value = data.data.gids
  }
  catch (cause) {
    if (isCurrentBlacklist(id, request))
      blacklistError.value = getApiErrorMessage(cause, '牧场黑名单读取失败')
  }
  finally {
    if (isCurrentBlacklist(id, request))
      blacklistLoading.value = false
  }
}

async function toggleBlacklist(gid: string | number) {
  const id = String(currentAccountId.value || '')
  if (!id || blacklistBusy.value || blacklistError.value)
    return
  const request = ++blacklistRequest
  blacklistSaving.value = true
  try {
    const blacklisted = !blacklistedSet.value.has(Number(gid))
    const { data } = await api.post('/api/ranch-friend-blacklist/toggle', { gid: Number(gid), blacklisted }, { headers: { 'x-account-id': id }, skipErrorToast: true } as any)
    if (!isCurrentBlacklist(id, request))
      return
    if (!data?.ok)
      throw new Error(getApiErrorMessage(data, '牧场黑名单保存失败'))
    blacklistGids.value = data.data.gids
    if (data.data.blacklisted && Number(selected.value) === Number(gid)) {
      selected.value = ''
      grassDialogGid.value = ''
    }
    toast.success(data.data.blacklisted ? '已加入牧场黑名单' : '已移出牧场黑名单')
  }
  catch (cause) {
    if (isCurrentBlacklist(id, request))
      toast.error(getApiErrorMessage(cause, '牧场黑名单保存失败'))
  }
  finally {
    if (isCurrentBlacklist(id, request))
      blacklistSaving.value = false
  }
}

function setActiveTab(value: string) {
  if (value !== 'friends' && value !== 'visitors' && value !== 'blacklist')
    return
  activeTab.value = value
  if (showBlacklist.value)
    void loadBlacklist()
}

/** 黑名单视图条目：好友列表里能对上的补名称/头像，纯 GID 的兜底展示。 */
const blacklistItems = computed(() => blacklistGids.value.map((gid) => {
  const friend = friends.value.find(f => Number(f.gid) === gid) || state.value?.friends?.find((f: any) => Number(f.gid) === gid)
  return { gid, name: friend?.name || '未命名好友', avatarUrl: friend?.avatarUrl || '' }
}))

const visible = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return keyword ? friends.value.filter(f => String(f.name || '').toLowerCase().includes(keyword)) : friends.value
})
const detail = computed(() => {
  if (!selected.value)
    return null
  const current = state.value?.friendRanch
  if (current?.gid === selected.value)
    return current
  return refreshingDetail.value?.gid === selected.value ? refreshingDetail.value : null
})
const detailAnimals = computed(() => (detail.value?.ranches || []).flatMap((pen: { id: string, animals: any[] }) => pen.animals.map((animal) => {
  const deadline = animal.deliveringUntilMs || animal.nextAtMs
  const remaining = deadline ? remainingSeconds(deadline) : 0
  const stage = animal.nextAtMs ? remainingSeconds(animal.nextAtMs) : null
  const duration = Number(animal.stageDurationSec)
  return {
    animal,
    penId: pen.id,
    remaining: remaining > 0 ? formatCountdown(remaining) : '',
    production: animal.productionAtMs ? remainingSeconds(animal.productionAtMs) : null,
    maturity: animal.matureAtMs ? formatCountdown(remainingSeconds(animal.matureAtMs)) : '',
    stage,
    progress: stage != null && Number.isFinite(duration) && duration > 0
      ? Math.round(Math.min(1, Math.max(0, 1 - stage / duration)) * 100)
      : null,
  }
})))

async function loadList(id: string) {
  await ranch.load(id, 'friends')
  if (id === String(currentAccountId.value || '') && state.value?.friends) {
    friends.value = state.value.friends
    listLoaded.value = true
  }
}

// 打开面板即满足“打开好友面板”任务条件：先静默上报，再读取好友列表。
async function enter(id: string) {
  const current = () => alive && id === String(currentAccountId.value || '')
  ranch.invalidateRanchReadRequests()
  await nextTick()
  if (!current())
    return
  const quote = await ranch.quote(id, 'reportEntry', { entry: 'friends' })
  if (quote && !quote.skipped && current())
    await ranch.execute(id, 'reportEntry', { entry: 'friends' }, quote.expected, { quiet: true })
  if (!current())
    return
  const reportError = error.value
  await loadList(id)
  if (current() && reportError && !error.value && state.value?.unlocked)
    error.value = reportError
}

watch(currentAccountId, (id) => {
  selected.value = ''
  refreshingDetail.value = null
  friends.value = []
  listLoaded.value = false
  activeTab.value = 'friends'
  blacklistRequest++
  blacklistGids.value = []
  blacklistError.value = ''
  blacklistLoading.value = false
  blacklistSaving.value = false
  void loadBlacklist()
  if (id)
    void enter(String(id))
  else ranch.clearRanchAccountState()
}, { immediate: true })

function onFriendRowClick(event: MouseEvent, friend: any) {
  if (event.target instanceof Element && !event.target.closest('button'))
    void toggle(friend)
}

async function toggle(friend: any) {
  const id = String(currentAccountId.value || '')
  const gid = String(friend.gid || '')
  if (!id || !gid || disabled.value || blacklistedSet.value.has(Number(gid)))
    return
  const wasSelected = selected.value === gid
  selected.value = wasSelected ? '' : gid
  grassDialogGid.value = ''
  if (!wasSelected)
    await ranch.load(id, 'friends', undefined, gid)
}

const grassDialogGid = ref('')
const grassLimit = computed(() => {
  const machine = detail.value?.feedMachine
  return machine ? Math.max(0, Math.min(Number(detail.value.grassAvailable) || 0, machine.capacity - machine.count)) : 0
})

function submitGrass(count: number) {
  const hostGid = grassDialogGid.value
  const machine = detail.value?.feedMachine
  grassDialogGid.value = ''
  if (hostGid && hostGid === selected.value && machine && count > 0 && count <= grassLimit.value)
    void request('addGrass', { hostGid, facilityId: machine.id, count })
}

async function reloadList() {
  const id = String(currentAccountId.value || '')
  if (!id || disabled.value || listRefreshing.value)
    return
  const expandedGid = selected.value
  refreshingDetail.value = detail.value
  listRefreshing.value = true
  try {
    void loadBlacklist()
    await loadList(id)
    if (expandedGid && id === String(currentAccountId.value || '') && selected.value === expandedGid)
      await ranch.load(id, 'friends', undefined, expandedGid)
  }
  finally {
    refreshingDetail.value = null
    listRefreshing.value = false
  }
}

async function openMischief(friend: any) {
  const accountId = currentAccountId.value
  if (!accountId || disabled.value || refreshing.value || blacklistedSet.value.has(Number(friend.gid))) return
  if (selected.value !== friend.gid || !detail.value) {
    selected.value = friend.gid
    await ranch.load(accountId, 'friends', undefined, friend.gid)
  }
  if (accountId !== currentAccountId.value || selected.value !== friend.gid || !detail.value) return
  const pens = detail.value.ranches.filter((pen: any) => pen.mosquitoRoom > 0)
  if (detail.value.mosquitoQuotaExhausted || !pens.length) {
    toast.info('当前没有可以放蚊子的栏舍')
    return
  }
  mischiefPens.value = pens.map((pen: any) => ({ id: pen.id, name: pen.name }))
  mischiefTarget.value = friend.gid
}

function chooseMischiefPen(ranchId: string) {
  const hostGid = mischiefTarget.value
  mischiefTarget.value = ''
  if (hostGid) void request('putMosquito', { hostGid, ranchId })
}
</script>

<template>
  <div class="friends page-stack">
    <PageTabs :value="activeTab" @update:value="setActiveTab">
      <NTab name="friends">
        <span class="inline-flex items-center gap-2"><span class="i-carbon-user-multiple" />牧场好友</span>
      </NTab>
      <NTab name="visitors">
        <span class="inline-flex items-center gap-2"><span class="i-carbon-recently-viewed" />最近访客</span>
      </NTab>
      <NTab name="blacklist">
        <span class="inline-flex items-center gap-2">
          <span class="i-carbon-rule-cancelled" />黑名单
          <span v-if="blacklistGids.length" class="text-xs text-red-500">{{ blacklistGids.length }}</span>
        </span>
      </NTab>
    </PageTabs>

    <section class="friends-card panel-scroll-layout page-card-surface rounded-2xl margin-shell"><span class="margin-content">
      <header class="friends-head panel-titlebar shrink-0 margin-shell" aria-label="牧场好友页面操作栏"><span class="margin-content">
        <span class="friends__count">{{ activeTab === 'visitors' ? '最近访客' : showBlacklist ? `共 ${blacklistGids.length} 人` : `共 ${visible.length}/${friends.length} 位好友` }}</span>
        <div v-if="activeTab !== 'visitors'" class="page-toolbar__actions friends-toolbar">
          <BaseInput v-if="!showBlacklist" v-model="query" type="search" placeholder="搜索好友名称" clearable />
          <RefreshButton
            :title="showBlacklist ? '刷新黑名单' : '刷新好友列表'"
            :loading="showBlacklist ? blacklistLoading : listRefreshing || (loading && !selected)"
            :disabled="showBlacklist ? !currentAccountId || blacklistBusy : !currentAccountId || listRefreshing || (disabled && !loading)"
            @click="showBlacklist ? loadBlacklist() : reloadList()"
          />
        </div>
      </span></header>

      <div class="panel-scroll-body panel-scroll-body--bleed">
        <div v-if="showBlacklist" class="blacklist">
          <p v-if="blacklistLoading" class="text-sm text-gray-500" role="status">
            读取黑名单中…
          </p>
          <EmptyState v-else-if="blacklistError" title="牧场黑名单读取失败" :description="blacklistError" tone="error" icon="i-carbon-warning-alt">
            <NButton secondary @click="loadBlacklist">
              重新读取
            </NButton>
          </EmptyState>
          <div v-else-if="!blacklistItems.length" class="blacklist-empty">
            <div class="i-carbon-user-x-ray mb-3 text-4xl text-gray-300 dark:text-gray-500" />
            <span class="text-gray-500 dark:text-gray-400">暂无黑名单好友</span>
          </div>
          <ul v-else class="blacklist__list panel-list list-divider">
            <li v-for="item in blacklistItems" :key="item.gid" class="blacklist__item margin-shell"><span class="margin-content">
              <div class="friend-avatar">
                <img v-if="item.avatarUrl" :src="item.avatarUrl" alt="" loading="lazy">
                <span v-else class="i-carbon-user" />
              </div>
              <div class="min-w-0 flex-1">
                <strong class="block truncate text-sm">{{ item.name }}</strong>
              </div>
              <NButton size="small" secondary :disabled="blacklistBusy" @click="toggleBlacklist(item.gid)">
                移出黑名单
              </NButton>
            </span></li>
          </ul>
        </div>

        <EmptyState v-else-if="activeTab === 'visitors'" class="friends__empty" title="牧场访客记录暂不可用" icon="i-carbon-recently-viewed" />

        <RanchGate v-else @retry="reloadList">
          <div v-if="loading && !listLoaded" class="friends__loading" role="status" aria-label="正在读取好友">
            <span class="i-svg-spinners-90-ring-with-bg" />
          </div>
          <EmptyState v-else-if="listLoaded && !friends.length" class="friends__empty" title="暂无好友" description="添加游戏好友后可以互相拜访牧场" icon="i-carbon-user-multiple" />
          <EmptyState v-else-if="listLoaded && !visible.length" class="friends__empty" title="没有匹配的好友" description="换个好友名称试试" icon="i-carbon-search" />

          <ul v-else class="friends__list panel-list list-divider">
            <li v-for="friend in visible" :key="friend.gid" class="friend-card margin-shell" :class="{ 'is-expanded': selected === friend.gid, 'is-blacklisted': blacklistedSet.has(Number(friend.gid)) }"><span class="margin-content">
              <div class="friend-row" @click="onFriendRowClick($event, friend)">
                <div class="friend-open">
                  <span class="friend-avatar">
                    <img v-if="friend.avatarUrl && !failedAvatars[friend.gid]" :src="friend.avatarUrl" alt="" loading="lazy" @error="failedAvatars[friend.gid] = true">
                    <span v-else class="i-carbon-user" />
                  </span>
                  <span class="friend-main">
                    <span class="friend-name-row">
                      <strong class="friend-name" :title="friend.name">{{ friend.name }}</strong>
                    </span>
                    <span v-if="blacklistedSet.has(Number(friend.gid))" class="friend-tags">
                      <span class="f-tag f-tag--blocked">已拉黑</span>
                    </span>
                    <span v-else-if="friend.level > 0 || (selected === friend.gid && detail?.level > 0)" class="friend-tags">
                      <span class="f-tag f-tag--level">Lv.{{ friend.level > 0 ? friend.level : detail.level }}</span>
                    </span>
                  </span>
                </div>
                <div class="friend-actions">
                  <span v-if="!blacklistedSet.has(Number(friend.gid)) && (friend.canMidwife || friend.canSteal || friend.canHelp)" class="friend-tags text-xs">
                    <span v-if="friend.canMidwife">可帮生产</span>
                    <span v-if="friend.canSteal">可收取</span>
                    <span v-if="friend.canHelp">可清理</span>
                  </span>
                  <NButton size="small" secondary :type="selected === friend.gid && detail?.canSteal ? 'primary' : 'default'" :disabled="disabled || refreshing || blacklistedSet.has(Number(friend.gid))" @click="request('steal', { hostGid: friend.gid })">
                    <template #icon><span class="i-carbon-shopping-bag" /></template>
                    偷取
                  </NButton>
                  <NButton size="small" secondary :type="selected === friend.gid && detail?.cleanableHazards ? 'primary' : 'default'" :disabled="disabled || refreshing || blacklistedSet.has(Number(friend.gid))" @click="request('cleanFriend', { hostGid: friend.gid })">
                    <template #icon><span class="i-carbon-clean" /></template>
                    清理
                  </NButton>
                  <NButton size="small" secondary :disabled="disabled || refreshing || blacklistedSet.has(Number(friend.gid))" @click="openMischief(friend)">
                    <template #icon><span class="i-carbon-debug" /></template>
                    捣乱
                  </NButton>
                  <NDropdown trigger="click" placement="bottom-end" :options="[{ key: 'blacklist', label: blacklistedSet.has(Number(friend.gid)) ? '移出黑名单' : '加入黑名单', disabled: blacklistBusy || !!blacklistError }]" @select="toggleBlacklist(friend.gid)">
                    <NButton size="small" quaternary circle title="更多操作" aria-label="更多操作">
                      <template #icon><span class="i-carbon-overflow-menu-horizontal" /></template>
                    </NButton>
                  </NDropdown>
                  <NButton class="friend-expand" size="small" quaternary circle :aria-expanded="selected === friend.gid" :aria-label="`${selected === friend.gid ? '收起' : '展开'}${friend.name}的牧场`" :disabled="disabled || blacklistedSet.has(Number(friend.gid))" @click="toggle(friend)">
                    <template #icon><span class="friend-chevron i-carbon-chevron-down" /></template>
                  </NButton>
                </div>
              </div>

              <div v-if="selected === friend.gid" class="friend-detail">
                <div v-if="refreshing && !detail" class="flex justify-center my-6" role="status" aria-label="正在读取好友牧场">
                  <span class="i-svg-spinners-90-ring-with-bg text-2xl text-green-600" />
                </div>
                <template v-else-if="detail">
                  <CareerHarvestSteal v-if="detail.career" :career="detail.career" />
                  <NButton v-if="detail.feedMachine" size="small" secondary :disabled="disabled || grassLimit === 0" @click="grassDialogGid = friend.gid">
                    赠送牧草
                  </NButton>
                  <p v-if="detail.notice" class="friend-detail__notice" role="alert">
                    {{ detail.notice }}
                  </p>
                  <div v-if="detailAnimals.length" class="friend-animals">
                    <RanchAnimalCard
                      v-for="entry in detailAnimals" :key="`${entry.penId}:${entry.animal.id}`" :animal="entry.animal"
                      crop-layout friend actionable :disabled="disabled"
                      :remaining="entry.remaining" :production-remaining-seconds="entry.production"
                      :maturity-remaining="entry.maturity" :progress="entry.progress" :stage-remaining-seconds="entry.stage"
                      @stroke="request('stroke', { hostGid: friend.gid, ranchId: entry.penId, animalId: entry.animal.id })"
                    />
                  </div>
                </template>
                <p v-else-if="error" class="friend-detail__notice" role="alert">
                  {{ error }}
                </p>
              </div>
            </span></li>
          </ul>
        </RanchGate>
      </div>
    </span></section>
    <RanchAmountDialog
      :show="!!grassDialogGid && grassDialogGid === selected && !!detail?.feedMachine"
      title="赠送牧草"
      name="牧草"
      :max="grassLimit"
      submit-text="确认赠送"
      @close="grassDialogGid = ''"
      @submit="submitGrass"
    />
    <NModal :show="!!mischiefTarget" @update:show="!$event && (mischiefTarget = '')">
      <section class="mischief-panel page-card-surface" role="dialog" aria-modal="true" aria-label="选择放蚊子的栏舍">
        <div class="mischief-panel__content">
          <h2>选择放蚊子的栏舍</h2>
          <NButton v-for="pen in mischiefPens" :key="pen.id" secondary @click="chooseMischiefPen(pen.id)">{{ pen.name }}</NButton>
          <NButton quaternary @click="mischiefTarget = ''">取消</NButton>
        </div>
      </section>
    </NModal>
  </div>
</template>

<style scoped>
.friend-animals {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 8px;
}

.friends {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 12px;
}

.friends-card {
  --panel-pad: 16px;
  --inset-top: var(--panel-pad); --inset-right: var(--panel-pad); --inset-bottom: var(--panel-pad); --inset-left: var(--panel-pad);
  overflow: clip;
}

.friends-head,
.friends-toolbar {
  flex-wrap: nowrap;
}

.friends__count {
  display: flex;
  min-height: var(--ui-content-titlebar-control-height-34);
  flex: none;
  align-items: center;
  color: var(--ui-muted);
  font-size: var(--ui-font-size-small-13);
  white-space: nowrap;
}

.friends__loading,
.friends__empty {
  margin-inline: var(--panel-pad);
}

.friends__loading {
  display: grid;
  min-height: 240px;
  place-items: center;
  color: var(--ui-primary);
  font-size: var(--ui-font-size-large-15);
}

.friends__list {
  width: 100%;
}

.friend-card {
  min-width: 0;
}

.friend-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.mischief-panel {
  width: min(360px, calc(100vw - 32px));
}

.mischief-panel__content {
  display: grid;
  gap: 8px;
  margin: 12px;
}

.mischief-panel__content h2 {
  margin: 0;
  font-size: var(--ui-font-size-medium);
}

.friend-open {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  align-items: center;
  gap: 14px;
  min-width: 0;
  text-align: left;
}

.friend-blacklist-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-primary) 55%, transparent);
  outline-offset: 2px;
}

.friend-blacklist-btn:disabled {
  cursor: default;
}

.friend-avatar {
  display: grid;
  width: 44px;
  height: 44px;
  overflow: hidden;
  place-items: center;
  border-radius: 14px;
  color: var(--ui-subtle);
  background: var(--ui-surface-soft);
  font-size: var(--ui-font-size-large-15);
}

.friend-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.friend-main {
  min-width: 0;
  min-height: 48px;
}

.friend-name-row {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
  line-height: 20px;
}

.friend-name {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-ink);
  font-size: var(--ui-font-size-large-15);
  font-weight: var(--fw-650);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.friend-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.f-tag {
  height: 22px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border-radius: 7px;
  color: var(--ui-muted);
  background: var(--ui-surface-soft);
  font-size: var(--ui-content-item-font-height-tiny-12);
  line-height: 1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.f-tag--level {
  color: var(--ui-ink);
  font-weight: var(--fw-600);
}

.f-tag--blocked {
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
  font-weight: var(--fw-600);
}

.friend-blacklist-btn {
  height: 22px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--ui-danger) 35%, transparent);
  border-radius: 7px;
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
  font-size: var(--ui-content-item-font-height-tiny-12);
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.friend-blacklist-btn:hover {
  background: color-mix(in srgb, var(--ui-danger) 18%, transparent);
}

.friend-blacklist-btn.is-out {
  color: var(--ui-primary);
  border-color: color-mix(in srgb, var(--ui-primary) 35%, transparent);
  background: var(--ui-primary-soft);
}

.friend-blacklist-btn.is-out:hover {
  background: color-mix(in srgb, var(--ui-primary) 18%, transparent);
}

.friend-card.is-blacklisted {
  opacity: 0.72;
}

.blacklist {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.blacklist-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-block: 12px;
}

.blacklist > :not(.blacklist__list) {
  margin-inline: var(--panel-pad);
}

.blacklist__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px var(--panel-pad);
}

.friend-chevron {
  justify-self: end;
  color: var(--ui-subtle);
  font-size: var(--ui-font-size-large-15);
  transition: transform 0.2s ease;
}

.friend-card.is-expanded .friend-chevron {
  transform: rotate(180deg);
}

.friend-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.friend-animals {
  margin-block-start: 12px;
}

.friend-detail__notice {
  margin: 8px 12px;
  border-radius: 10px;
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
  font-size: var(--ui-font-size-small-13);
}

@media (max-width: 1199px) {
  .friend-pen__animals {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }
}

@media (max-width: 767px) {
  .friend-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .friend-actions {
    flex-wrap: wrap;
  }

  .friend-open {
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 8px;
  }

  .friend-avatar {
    width: 40px;
    height: 40px;
    border-radius: 12px;
  }



}
</style>
