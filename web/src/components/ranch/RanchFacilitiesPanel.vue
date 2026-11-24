<script setup lang="ts">
import { NButton } from 'naive-ui/es/button'
import { NPopover } from 'naive-ui/es/popover'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { formatCount, formatDuration, RANCH_IMAGE, sortFacilities, useRanchActions, useRanchClock, useRanchLoader } from '@/components/ranch/ranch-shared'
import RanchAmountDialog from '@/components/ranch/RanchAmountDialog.vue'
import RanchGate from '@/components/ranch/RanchGate.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { useRanchStore } from '@/stores/ranch'

const { state } = storeToRefs(useRanchStore())
const { refresh } = useRanchLoader('facilities')
const { disabled, request } = useRanchActions()
const { serverNow, remainingSeconds } = useRanchClock()

const facilities = computed<any[]>(() => sortFacilities(state.value?.facilities || []))
const grass = computed(() => Number(state.value?.grass) || 0)
const grassTarget = ref<any>(null)
const refreshing = ref(false)

async function refreshManually() {
  refreshing.value = true
  try {
    await refresh()
  }
  finally {
    refreshing.value = false
  }
}

function facilityIcon(f: any) {
  return f.feed ? 'i-carbon-wheat' : f.ranch ? 'i-carbon-home' : 'i-carbon-building'
}
function upgradeDuration(seconds: number) {
  const minutes = Math.ceil((Number(seconds) || 0) / 60)
  return `${Math.floor(minutes / 60)}h${minutes % 60}min`
}
function meter(f: any) {
  if (f.ranch)
    return { label: '动物', value: `${f.ranch.count} / ${f.ranch.capacity}`, percent: f.ranch.capacity ? f.ranch.count / f.ranch.capacity * 100 : 0 }
  if (f.feed)
    return { label: '牧草', value: `${f.feed.count} / ${f.capacity}`, percent: f.capacity ? f.feed.count / f.capacity * 100 : 0 }
  return { label: '容量', value: String(f.capacity), percent: 0 }
}
function upgradeDone(f: any) {
  const end = Number(f.upgradeEndTime)
  return f.upgradeState === 2 || end * (end < 1e11 ? 1000 : 1) <= serverNow.value
}
function submitGrass(count: number) {
  const f = grassTarget.value
  grassTarget.value = null
  if (f)
    void request('addGrass', { facilityId: f.id, count })
}
</script>

<template>
  <div class="page-card-surface panel-scroll-layout facility-panel margin-shell"><span class="margin-content">
    <div class="facility-bar panel-titlebar panel-titlebar--flush margin-shell"><span class="margin-content">
        <span class="facility-bar__stock"><img :src="RANCH_IMAGE(7001)" alt="">牧草库存 <b>{{ formatCount(state?.grass ?? 0) }}</b></span>
        <div class="page-toolbar__actions">
          <RefreshButton label="刷新设施" :loading="refreshing" @click="refreshManually" />
        </div>
      </span></div>

    <div class="panel-scroll-body">
      <RanchGate @retry="refresh">
      <div class="facility-list panel-list has-divider">
        <article v-for="f in facilities" :key="f.id" class="facility margin-shell"><span class="margin-content">
          <header class="facility__head">
            <span class="facility__icon" aria-hidden="true"><span :class="facilityIcon(f)" /></span>
            <div class="min-w-0 flex-1">
              <h3>{{ f.name }}</h3>
              <small class="facility__level">Lv.{{ f.active ? f.level : 0 }}</small>
            </div>
            <span v-if="f.active && f.upgradeState" class="facility__badge is-busy">升级中</span>
          </header>

          <div v-if="f.active" class="facility__meter">
            <div class="facility__meter-labels">
              <span>{{ meter(f).label }}</span><b>{{ meter(f).value }}</b>
            </div>
            <div class="facility__track ui-progress-track" aria-hidden="true">
              <i :style="{ width: `${Math.min(100, meter(f).percent)}%` }" />
            </div>
            <p v-if="f.next" class="facility__note facility__next">
              <span>下一级: 容量{{ f.capacity }}→{{ f.next.capacity }}</span>
              <span>升级时间: {{ upgradeDuration(f.next.durationSec) }}</span>
            </p>
            <p v-else-if="!f.upgradeState" class="facility__note">已满级</p>
            <p v-if="f.feed && String(f.feed.remainingSec) !== '-1'" class="facility__note">
              预计可供 {{ formatDuration(f.feed.remainingSec) }}
            </p>
            <p v-if="f.upgradeState" class="facility__note is-busy">
              {{ upgradeDone(f) ? '升级已完成，等待确认' : `剩余 ${formatDuration(remainingSeconds(f.upgradeEndTime))}` }}
            </p>
          </div>

          <footer v-if="!f.active" class="facility__foot">
            <NPopover trigger="hover" placement="top" :flip="true">
              <template #trigger>
                <span class="facility__trigger" tabindex="0">
                  <NButton size="small" :type="f.canActivate ? 'primary' : 'default'" :disabled="disabled || !f.canActivate" @click="request('activateShed', { facilityId: f.id })">
                    <span class="i-carbon-upgrade mr-0.5" aria-hidden="true" />解锁
                  </NButton>
                </span>
              </template>
              <div class="facility__hint">
                <b>解锁{{ f.name }}</b>
                <span v-if="f.moduleType === 7" :class="{ 'is-unmet': Number(state?.level) < 21 }">牧场等级 {{ state?.level }} / 需要 21</span>
                <span v-else>等待牧场开放</span>
              </div>
            </NPopover>
          </footer>
          <footer v-else-if="f.active" class="facility__foot">
            <NButton v-if="f.feed" size="small" secondary :disabled="disabled || f.feed.count >= f.capacity || grass < 1" @click="grassTarget = f">
              <span class="i-carbon-add mr-0.5" aria-hidden="true" />补充牧草
            </NButton>
            <NButton v-if="f.upgradeState" size="small" type="primary" :disabled="disabled || !upgradeDone(f)" @click="request('completeUpgrade', { facilityId: f.id })">
              完成升级
            </NButton>
            <NPopover v-else-if="f.next" trigger="hover" placement="top" :flip="true">
              <template #trigger>
                <span class="facility__trigger" tabindex="0">
                  <NButton size="small" :type="f.next.available ? 'primary' : 'default'" :secondary="!f.next.available" :disabled="disabled || !f.next.available" @click="request('upgrade', { facilityId: f.id })">
                    <span class="i-carbon-upgrade mr-0.5" aria-hidden="true" />升级
                  </NButton>
                </span>
              </template>
              <div class="facility__hint">
                <b>升级至 Lv.{{ f.next.level }}</b>
                <span>容量 {{ f.capacity }} → {{ f.next.capacity }}</span>
                <span v-if="f.next.requiredLevel" :class="{ 'is-unmet': Number(state?.level) < f.next.requiredLevel }">牧场等级 {{ state?.level }} / 需要 {{ f.next.requiredLevel }}</span>
                <span v-for="cost in f.next.costs" :key="cost.id">{{ cost.name }} × {{ formatCount(cost.count) }}</span>
                <span>升级时间 {{ upgradeDuration(f.next.durationSec) }}</span>
              </div>
            </NPopover>
          </footer>
        </span></article>
      </div>
      </RanchGate>
    </div>

    <RanchAmountDialog
      :show="!!grassTarget"
      :title="`为${grassTarget?.name || ''}补充牧草`"
      name="牧草"
      :image="RANCH_IMAGE(7001)"
      :caption="`库存 ${formatCount(state?.grass ?? 0)} · 可再放入 ${grassTarget ? grassTarget.capacity - grassTarget.feed.count : 0}`"
      :max="grassTarget ? Math.min(grass, grassTarget.capacity - grassTarget.feed.count) : 1"
      @close="grassTarget = null"
      @submit="submitGrass"
    />
  </span></div>
</template>

<style scoped>
.facility-panel {
  --inset-top: 0; --inset-right: 0; --inset-bottom: 0; --inset-left: 0;
  overflow: clip;
}

.facility-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.facility-bar__stock {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-muted);
  font-size: var(--ui-font-size-small-13);
}

.facility-bar__stock img {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.facility-bar__stock b {
  color: var(--ui-ink);
  font-variant-numeric: tabular-nums;
}

.facility-list {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content;
  column-gap: 12px;
}

.facility {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content;
  grid-template-columns: subgrid;
  align-items: center;
  gap: 12px;
}

.facility > * {
  min-width: 0;
}



@media (max-width: 700px) {
  .facility-list {
    grid-template-columns: minmax(0, 1fr);
  }

  .facility {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
}

.facility__head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.facility__icon {
  display: grid;
  width: 40px;
  height: 40px;
  flex: none;
  place-items: center;
  border-radius: 12px;
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
  font-size: var(--ui-font-size-large-15);
}

.facility__head h3 {
  margin: 0;
  color: var(--ui-ink);
  font-size: var(--ui-font-size-large-15);
  font-weight: var(--fw-400);
}

.facility__level {
  display: block;
  margin-top: 4px;
  color: var(--ui-subtle);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-400);
}

.facility__badge {
  flex: none;
  padding: 1px 8px;
  border-radius: 999px;
  color: var(--ui-muted);
  background: var(--ui-surface-soft);
  font-size: var(--ui-content-item-font-height-tiny-12);
  line-height: 20px;
}

.facility__badge.is-busy {
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
}

.facility__meter-labels {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.facility__meter-labels b {
  color: var(--ui-ink);
  font-weight: var(--fw-400);
  font-variant-numeric: tabular-nums;
}

.facility__track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--ui-surface-soft);
}

.facility__track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #9fd17d, var(--ui-primary));
  transition: width 0.4s ease;
}

.facility__note {
  margin: 6px 0 0;
  color: var(--ui-subtle);
  font-size: var(--ui-content-item-font-height-tiny-12);
}

.facility__next {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 4px 12px;
}

.facility__next > :last-child {
  margin-left: auto;
}

.facility__hint {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: min(320px, calc(100vw - 48px));
  overflow-wrap: anywhere;
}

.facility__trigger {
  display: inline-flex;
}

.is-unmet,
.facility__note.is-busy {
  color: var(--ui-warning);
}

.facility__cost {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-wrap: anywhere;
}

.facility__cost img {
  width: 20px;
  height: 20px;
  flex: none;
  object-fit: contain;
}

.facility__foot {
  grid-column: -2 / -1;
  grid-row: 1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  align-self: center;
}

@media (max-width: 700px) {
  .facility__foot {
    grid-row: auto;
  }
}

.facility-list :is(h3, b, small, .n-button),
.facility__hint b {
  font-weight: var(--fw-400) !important;
}

.facility__foot:empty {
  display: none;
}
</style>
