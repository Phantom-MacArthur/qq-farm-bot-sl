<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

/**
 * 一块地的卡片。结构固定为：编号与土地类型 / 作物 / 名称 / 时间或主状态 / 进度 / 状态图标。
 * 土地详情和作物详情分别通过土地类型标签与作物图标查看。
 */
const props = withDefaults(defineProps<{
  land: any
  selectable?: boolean
  selected?: boolean
  selectionDisabled?: boolean
  selectionLabel?: string
  farmDisabled?: boolean
  /** 使土地类型标签可点击打开详情。 */
  openable?: boolean
}>(), {
  selectable: false,
  selected: false,
  selectionDisabled: false,
  selectionLabel: '',
  farmDisabled: false,
  openable: false,
})

const emit = defineEmits<{
  select: [land: any]
  open: [land: any]
  farm: [land: any]
}>()

const land = computed(() => props.land || {})

const SOILS: Record<number, { short: string, name: string }> = {
  0: { short: '普通', name: '普通土地' },
  1: { short: '普通', name: '普通土地' },
  2: { short: '红土', name: '红土地' },
  3: { short: '黑土', name: '黑土地' },
  4: { short: '金土', name: '金土地' },
  5: { short: '紫金', name: '紫金土地' },
  6: { short: '蓝晶', name: '蓝晶土地' },
}
const level = computed(() => {
  const lv = Number(land.value.level) || 0
  return SOILS[lv] ? lv : 0
})
const soil = computed(() => SOILS[level.value]!)

const status = computed(() => String(land.value.status || ''))
const isLocked = computed(() => status.value === 'locked' || land.value.unlocked === false)
const isEmpty = computed(() => !isLocked.value && (status.value === 'empty' || !String(land.value.plantName || '').trim()))
const hasCrop = computed(() => !isLocked.value && !isEmpty.value)
const cropStage = computed(() => hasCrop.value ? String(land.value.phaseName || '').trim() : '')
const plantSize = computed(() => Math.max(1, Number(land.value.plantSize) || 1))
// 合种副地：作物与状态都来自主地，只做弱化展示并指向主地。
const isFollower = computed(() => !!land.value.occupiedByMaster && Number(land.value.masterLandId) > 0 && Number(land.value.masterLandId) !== Number(land.value.id))
const isJointMaster = computed(() => plantSize.value > 1 && !isFollower.value && !isEmpty.value && !isLocked.value)

/** 时间行：生长中显示倒计时，其余显示主状态。 */
const stateTag = computed(() => {
  if (isLocked.value)
    return { kind: 'muted', icon: 'i-carbon-locked', text: '未解锁' }
  if (isEmpty.value)
    return { kind: 'muted', icon: 'i-carbon-add-alt', text: '空地' }
  if (isFollower.value)
    return { kind: 'muted', icon: 'i-carbon-link', text: `#${land.value.masterLandId}合种` }
  if (status.value === 'harvestable')
    return { kind: 'ripe', icon: 'i-carbon-wheat', text: '可收获' }
  if (status.value === 'stealable')
    return { kind: 'steal', icon: 'i-carbon-touch-1', text: '可偷' }
  if (status.value === 'harvested')
    return { kind: 'muted', icon: 'i-carbon-wheat', text: '已成熟' }
  if (status.value === 'dead')
    return { kind: 'dead', icon: 'i-carbon-misuse-outline', text: '已枯萎' }
  return null
})

function formatTime(sec: number) {
  const value = Math.max(0, Math.floor(Number(sec) || 0))
  const h = Math.floor(value / 3600)
  const m = Math.floor((value % 3600) / 60)
  const s = value % 60
  return `${h > 0 ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 已生长的比例：越接近成熟越满。 */
const growPercent = computed(() => {
  const total = Number(land.value.totalGrowTime) || 0
  const remain = Number(land.value.matureInSec) || 0
  if (total <= 0 || remain <= 0)
    return status.value === 'harvestable' || status.value === 'stealable' ? 100 : 0
  return Math.min(100, Math.max(3, (1 - remain / total) * 100))
})

function safeImage(url: string) {
  return url && url.startsWith('http://') ? url.replace('http://', 'https://') : url
}

// ---- 状态图标：需处理（实心）与加成/效果（描边）分两组 ----
const needs = computed(() => {
  if (isFollower.value || isLocked.value || isEmpty.value)
    return []
  return [
    land.value.needWater && { key: 'water', icon: 'i-carbon-rain-drop', title: '缺水' },
    land.value.needWeed && { key: 'weed', icon: 'i-carbon-clean', title: '杂草' },
    land.value.needBug && { key: 'bug', icon: 'i-carbon-debug', title: '虫害' },
  ].filter(Boolean) as Array<{ key: string, icon: string, title: string }>
})

const failedMutantIcons = ref(new Set<string>())

const cropMutations = computed(() => {
  const effects = Array.isArray(land.value.mutantEffects) && land.value.mutantEffects.length
    ? [...land.value.mutantEffects]
    : (Array.isArray(land.value.mutantConfigIds) ? land.value.mutantConfigIds.map((id: unknown) => ({ id, name: `变异 #${id}` })) : [])
  const resonance = Math.max(0, Number(land.value.purpleCrystalResonanceExpBonus) || 0) / 100
  if (resonance > 0) {
    effects.push({
      id: 'purple-crystal-resonance',
      name: '紫晶共鸣',
      description: `变异作物经验 +${resonance}%`,
      isPurpleCrystalResonance: true,
    })
  }
  return effects
})

const traits = computed(() => {
  if (isFollower.value || isLocked.value || isEmpty.value)
    return []
  const list: Array<{ key: string, kind: string, icon?: string, image?: string, title: string }> = []
  for (const effect of cropMutations.value) {
    const id = Number(effect?.id) || 0
    const name = String(effect?.name || effect?.effect_name || '').trim()
    if (!name)
      continue
    const desc = String(effect?.description || effect?.desc || '').trim()
    if (effect?.isPurpleCrystalResonance) {
      list.push({ key: 'resonance', kind: 'mutant', icon: 'i-carbon-flash-filled', title: desc ? `${name}：${desc}` : name })
      continue
    }
    const collections = id === 18 && Array.isArray(effect.collections) ? effect.collections : []
    for (const collection of collections) {
      const key = `m${id}:${collection.seriesId}:${collection.itemId}`
      list.push({
        key,
        kind: 'mutant',
        image: failedMutantIcons.value.has(key) ? '' : safeImage(String(collection.image || '')),
        icon: 'i-carbon-trophy',
        title: `藏品 · ${collection.name}`,
      })
    }
    if (collections.length)
      continue
    const key = `m${id}${name}`
    list.push({
      key,
      kind: 'mutant',
      // 官方配置的藏品图标仍指向奶茶；没有具体藏品时显示通用藏品标记。
      image: id > 0 && id !== 18 && !failedMutantIcons.value.has(key) ? `/game-config/seed_images_named/mutant/${id}.png` : '',
      icon: id === 18 ? 'i-carbon-trophy' : 'i-carbon-star',
      title: desc ? `${name}：${desc}` : name,
    })
  }
  const seen = new Set<string>()
  for (const effect of Array.isArray(land.value.interactionEffects) ? land.value.interactionEffects : []) {
    const itemId = String(effect?.itemId || '')
    if (!effect?.confirmed || !itemId || seen.has(itemId))
      continue
    seen.add(itemId)
    list.push({ key: `i${itemId}`, kind: 'effect', icon: 'i-carbon-checkmark-outline', title: `${effect.itemName || `道具${itemId}`}：已生效` })
  }
  const left = land.value.leftInorcFertTimes
  if (left != null && !Number.isNaN(Number(left)) && status.value === 'growing')
    list.push({ key: 'organic', kind: Number(left) > 0 ? 'organic' : 'organic-off', icon: 'i-carbon-chemistry', title: Number(left) > 0 ? `还可施有机肥 ${left} 次` : '已无法再施有机肥' })
  return list
})

// 需处理的问题排在最前。
const allTags = computed(() => [
  ...needs.value.map(item => ({ ...item, group: 'need' as const, kind: item.key, image: '' })),
  ...traits.value.map(item => ({ ...item, group: 'trait' as const })),
])
const mutationTags = computed(() => allTags.value.filter(item => item.kind === 'mutant'))
const statusTags = computed(() => allTags.value.filter(item => item.kind !== 'mutant'))

function markMutantFailed(key: string) {
  failedMutantIcons.value = new Set(failedMutantIcons.value).add(key)
}

const interactive = computed(() => props.selectable)

function activate() {
  if (props.selectable && !props.selectionDisabled)
    emit('select', props.land)
}

const cropDetailsOpen = ref(false)
const cropAnchor = ref<HTMLElement | null>(null)
const cropDetailsElement = ref<HTMLElement | null>(null)
const cropDetailsStyle = ref<Record<string, string>>({})
const cropDetailsBelow = ref(false)
const now = ref(Date.now())
let cropDetailsTimer: ReturnType<typeof setInterval> | null = null

const maturityProgress = computed(() => {
  const total = Number(land.value.totalGrowTime) || 0
  if (!hasCrop.value || status.value === 'dead' || total <= 0)
    return null
  const remaining = Math.max(0, Number(land.value.matureInSec) || 0)
  const elapsed = Math.min(total, Math.max(0, total - remaining))
  return { percent: Math.round(elapsed / total * 100), elapsed, duration: total }
})

const phaseProgress = computed(() => {
  const start = Number(land.value.phaseStartTime) || 0
  const end = Number(land.value.phaseEndTime) || 0
  if (!hasCrop.value || end <= start)
    return null
  const duration = end - start
  const total = Number(land.value.totalGrowTime) || 0
  if (total > 0 && Math.abs(duration - total) <= 1)
    return null
  const elapsed = Math.min(duration, Math.max(0, now.value / 1000 - start))
  return { percent: Math.round(elapsed / duration * 100), elapsed, duration }
})

const cropMutationDetails = computed(() => cropMutations.value
  .map((effect: any) => {
    const name = String(effect?.name || effect?.effect_name || '变异')
    const description = String(effect?.description || effect?.desc || '').trim()
    return description ? `${name}：${description}` : name
  }))

async function updateCropDetailsPosition() {
  await nextTick()
  const anchor = cropAnchor.value
  const panel = cropDetailsElement.value
  if (!anchor || !panel)
    return

  const anchorRect = anchor.getBoundingClientRect()
  const width = panel.offsetWidth
  const height = panel.offsetHeight
  const margin = 10
  const gap = 10
  const spaceAbove = anchorRect.top - margin - gap
  const spaceBelow = window.innerHeight - anchorRect.bottom - margin - gap
  const below = spaceAbove < height && spaceBelow > spaceAbove
  const left = Math.min(window.innerWidth - width - margin, Math.max(margin, anchorRect.left + anchorRect.width / 2 - width / 2))
  const idealTop = below ? anchorRect.bottom + gap : anchorRect.top - height - gap
  const top = Math.min(window.innerHeight - height - margin, Math.max(margin, idealTop))
  cropDetailsBelow.value = below
  cropDetailsStyle.value = {
    'left': `${left}px`,
    'top': `${top}px`,
    '--crop-arrow-left': `${Math.min(width - 18, Math.max(18, anchorRect.left + anchorRect.width / 2 - left))}px`,
  }
}

function closeCropDetails() {
  cropDetailsOpen.value = false
  if (cropDetailsTimer) {
    clearInterval(cropDetailsTimer)
    cropDetailsTimer = null
  }
  document.removeEventListener('pointerdown', handleCropOutside)
  document.removeEventListener('keydown', handleCropEscape)
  window.removeEventListener('resize', updateCropDetailsPosition)
  window.removeEventListener('scroll', updateCropDetailsPosition, true)
}

function handleCropOutside(event: PointerEvent) {
  const target = event.target as Node | null
  if (target && (cropDetailsElement.value?.contains(target) || cropAnchor.value?.contains(target)))
    return
  closeCropDetails()
}

function handleCropEscape(event: KeyboardEvent) {
  if (event.key === 'Escape')
    closeCropDetails()
}

async function toggleCropDetails(event: MouseEvent) {
  event.stopPropagation()
  if (cropDetailsOpen.value) {
    closeCropDetails()
    return
  }

  cropAnchor.value = event.currentTarget as HTMLElement
  cropDetailsOpen.value = true
  now.value = Date.now()
  cropDetailsTimer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  document.addEventListener('pointerdown', handleCropOutside)
  document.addEventListener('keydown', handleCropEscape)
  window.addEventListener('resize', updateCropDetailsPosition)
  window.addEventListener('scroll', updateCropDetailsPosition, true)
  await updateCropDetailsPosition()
}

watch([() => land.value.id, () => land.value.plantName], closeCropDetails)
watch([
  () => phaseProgress.value?.percent,
  () => phaseProgress.value?.duration,
  () => maturityProgress.value?.percent,
  () => cropMutationDetails.value.join('；'),
  () => land.value.needWater,
  () => land.value.needWeed,
  () => land.value.needBug,
], updateCropDetailsPosition, { flush: 'post' })
onUnmounted(closeCropDetails)

const ariaLabel = computed(() => {
  const parts = [`第 ${land.value.id} 块地`, soil.value.name]
  if (!isEmpty.value && !isLocked.value)
    parts.push(String(land.value.plantName || ''))
  if (stateTag.value)
    parts.push(stateTag.value.text)
  else if (Number(land.value.matureInSec) > 0)
    parts.push(`${formatTime(land.value.matureInSec)} 后成熟`)
  if (needs.value.length)
    parts.push(needs.value.map(item => item.title).join('、'))
  if (props.selectable && props.selectionDisabled && props.selectionLabel)
    parts.push(props.selectionLabel)
  return parts.filter(Boolean).join('，')
})
</script>

<template>
  <article
    class="plot"
    :class="[
      `plot--lv${level}`,
      stateTag ? `plot--${stateTag.kind}` : '',
      {
        'plot--locked': isLocked,
        'plot--follower': isFollower,
        'plot--interactive': interactive,
        'plot--selectable': selectable,
        'plot--selected': selectable && selected,
        'plot--disabled': selectable && selectionDisabled,
      },
    ]"
    :role="interactive ? (selectable ? 'checkbox' : 'button') : undefined"
    :tabindex="interactive && !(selectable && selectionDisabled) ? 0 : undefined"
    :aria-checked="selectable ? selected : undefined"
    :aria-disabled="selectable ? selectionDisabled : undefined"
    :aria-label="ariaLabel"
    :title="selectable && selectionDisabled ? (selectionLabel || '这块地当前不能选择') : undefined"
    @click="activate"
    @keydown.enter.prevent="activate"
    @keydown.space.prevent="activate"
  >
    <header class="plot__top" :class="{ 'plot__top--wrapped-tags': statusTags.length > 1 }">
      <span class="plot__no">#{{ land.id }}</span>
      <button
        v-if="openable && !selectable"
        type="button"
        class="plot__soil plot__soil-button"
        :title="`查看${soil.name}详情`"
        :aria-label="`查看第 ${land.id} 块地的${soil.name}详情`"
        @click.stop="emit('open', land)"
      >
        {{ soil.short }}
      </button>
      <span v-else class="plot__soil" :title="soil.name">{{ soil.short }}</span>
      <div v-if="mutationTags.length" class="plot__mutations">
        <span
          v-for="item in mutationTags"
          :key="item.key"
          class="plot__mutation"
          :aria-label="`查看变异效果：${item.title}`"
          role="img"
        >
          <img v-if="item.image" :src="item.image" alt="" @error="markMutantFailed(item.key)">
          <span v-else :class="item.icon || 'i-carbon-star'" aria-hidden="true" />
          <span class="plot__mutation-tooltip" role="tooltip">
            <strong>变异</strong>&nbsp;&nbsp;<span>{{ item.title }}</span>
          </span>
        </span>
      </div>
      <div v-if="statusTags.length" class="plot__status-icons">
        <template v-for="item in statusTags" :key="item.key">
          <button
            v-if="item.group === 'need' && !selectable"
            type="button"
            class="plot__need"
            :class="`is-${item.kind}`"
            :title="`${item.title}，点击务农`"
            :aria-label="`${item.title}，点击务农`"
            :disabled="farmDisabled"
            @click.stop="emit('farm', land)"
            @keydown.stop
          >
            <span :class="item.icon" />
          </button>
          <span v-else-if="item.group === 'need'" class="plot__need" :class="`is-${item.kind}`" :title="item.title">
            <span :class="item.icon" />
          </span>
          <span v-else class="plot__trait" :class="`is-${item.kind}`" :title="item.title">
            <img v-if="item.image" :src="item.image" alt="" @error="markMutantFailed(item.key)">
            <span v-else :class="item.icon" />
          </span>
        </template>
      </div>
      <span v-if="isJointMaster" class="plot__joint" :title="`合种作物，占用 ${plantSize}×${plantSize} 块地`">
        <span class="i-carbon-grid" aria-hidden="true" />{{ plantSize }}×{{ plantSize }}
      </span>
      <span v-if="selectable" class="plot__check" aria-hidden="true">
        <span v-if="selected" class="i-carbon-checkmark" />
        <span v-else-if="selectionDisabled" class="i-carbon-subtract" />
      </span>
    </header>

    <div class="plot__crop">
      <span v-if="isLocked" class="plot__placeholder i-carbon-locked" />
      <span v-else-if="isEmpty" class="plot__placeholder i-carbon-sprout" />
      <button
        v-else-if="!selectable"
        type="button"
        class="plot__crop-button"
        :aria-label="`查看${land.plantName}作物详情`"
        :aria-expanded="cropDetailsOpen"
        @click.stop="toggleCropDetails"
      >
        <img v-if="land.seedImage" :src="safeImage(land.seedImage)" alt="" loading="lazy" referrerpolicy="no-referrer">
        <span v-else class="plot__placeholder i-carbon-sprout" />
      </button>
      <img v-else-if="land.seedImage" :src="safeImage(land.seedImage)" alt="" loading="lazy" referrerpolicy="no-referrer">
      <span v-else class="plot__placeholder i-carbon-sprout" />
    </div>

    <div class="plot__name" :title="cropStage ? `${land.plantName} (${cropStage})` : land.plantName">
      <span class="plot__name-crop">{{ isLocked ? '—' : isEmpty ? '待种植' : land.plantName }}</span>
      <span v-if="cropStage" class="plot__name-stage">({{ cropStage }})</span>
    </div>

    <div class="plot__time">
      <span v-if="stateTag" class="plot__state" :class="`is-${stateTag.kind}`"><span :class="stateTag.icon" aria-hidden="true" />{{ stateTag.text }}</span>
      <span v-else-if="Number(land.matureInSec) > 0" class="plot__countdown">成熟 {{ formatTime(land.matureInSec) }}</span>
      <span v-else class="plot__state is-muted">{{ land.phaseName || '生长中' }}</span>
      <span v-if="hasCrop && !isFollower" class="plot__growth-percent">{{ Math.round(growPercent) }}%</span>
    </div>

    <div class="plot__bar" aria-hidden="true">
      <i :style="{ width: `${isFollower || isEmpty || isLocked ? 0 : growPercent}%` }" />
    </div>
  </article>
  <Teleport to="body">
    <section
      v-if="cropDetailsOpen"
      ref="cropDetailsElement"
      class="crop-detail-popover"
      :class="{ 'crop-detail-popover--below': cropDetailsBelow }"
      :style="cropDetailsStyle"
      role="dialog"
      :aria-label="`${land.plantName}作物详情`"
      @click.stop
    >
      <div class="crop-detail-popover__content">
        <header class="crop-detail-popover__header">
          <strong>
            <span class="plot__no">#{{ land.id }}</span> ·
            <span class="crop-detail-popover__plant-name">{{ land.plantName }}</span>
            <span class="crop-detail-popover__season">(生长季数 {{ Number(land.totalSeason) > 0 ? `${land.currentSeason}/${land.totalSeason}` : '—' }})</span>
          </strong>
        </header>
        <div v-if="maturityProgress" class="crop-detail-popover__progress">
          <div class="crop-detail-popover__progress-head">
            <strong>成熟倒计时</strong>
            <b>{{ maturityProgress.percent }}%</b>
          </div>
          <div class="crop-detail-popover__progress-track">
            <span :style="{ width: `${maturityProgress.percent}%` }" />
          </div>
          <div class="crop-detail-popover__progress-time">
            <span>已生长 {{ formatTime(maturityProgress.elapsed) }}</span>
            <span>总时长 {{ formatTime(maturityProgress.duration) }}</span>
          </div>
        </div>
        <div v-if="phaseProgress" class="crop-detail-popover__progress">
          <div class="crop-detail-popover__progress-head">
            <strong>阶段倒计时</strong>
            <b>{{ phaseProgress.percent }}%</b>
          </div>
          <div class="crop-detail-popover__progress-track">
            <span :style="{ width: `${phaseProgress.percent}%` }" />
          </div>
          <div class="crop-detail-popover__progress-time">
            <span>当前阶段 {{ cropStage || '—' }}</span>
            <span>阶段时长 {{ formatTime(phaseProgress.duration) }}</span>
          </div>
        </div>
        <div v-if="cropMutationDetails.length" class="crop-detail-popover__mutations">
          <strong>变异</strong>
          <ul>
            <li v-for="(effect, index) in cropMutationDetails" :key="`${index}-${effect}`">
              {{ effect }}
            </li>
          </ul>
        </div>
        <div v-if="land.needWater || land.needWeed || land.needBug" class="crop-detail-popover__needs">
          <span v-if="land.needWater">需要浇水</span>
          <span v-if="land.needWeed">需要除草</span>
          <span v-if="land.needBug">需要除虫</span>
        </div>
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.plot {
  /* 土地类型色：卡面淡底、描边、类型标签共用这一组变量 */
  --soil-bg: #fbf8f1;
  --soil-line: #e6dbc2;
  --soil-ink: #86642e;
  --soil-chip: #f1e7d2;

  position: relative;
  display: flex;
  min-width: 180px;
  flex-direction: column;
  align-items: center;
  padding: 8px 10px 9px;
  border: 1px solid var(--soil-line);
  border-radius: 14px;
  color: var(--ui-ink);
  background: var(--soil-bg);
  box-shadow: 0 1px 2px rgba(45, 66, 52, 0.05);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    opacity 0.15s ease,
    transform 0.15s ease;
}
.plot--lv2 {
  --soil-bg: #fdf4f1;
  --soil-line: #eecbc1;
  --soil-ink: #b0482f;
  --soil-chip: #f8ddd5;
}
.plot--lv3 {
  --soil-bg: #f4f3f1;
  --soil-line: #d3cfc8;
  --soil-ink: #4b4540;
  --soil-chip: #e3dfd9;
}
.plot--lv4 {
  --soil-bg: #fffae8;
  --soil-line: #ead57f;
  --soil-ink: #946600;
  --soil-chip: #f9e9a8;
}
.plot--lv5 {
  --soil-bg: #f8f3fd;
  --soil-line: #d7c6ef;
  --soil-ink: #7140b5;
  --soil-chip: #eadffa;
}

.plot--interactive {
  cursor: pointer;
  user-select: none;
}
.plot--interactive:hover {
  border-color: color-mix(in srgb, var(--soil-ink) 45%, var(--soil-line));
  box-shadow: 0 4px 14px rgba(45, 66, 52, 0.1);
}
.plot--interactive:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-primary) 60%, transparent);
  outline-offset: 2px;
}
.plot--ripe {
  border-color: color-mix(in srgb, var(--ui-primary) 55%, var(--soil-line));
}
.plot--steal {
  border-color: color-mix(in srgb, var(--ui-violet) 55%, var(--soil-line));
}
.plot--dead {
  filter: grayscale(0.85);
}
.plot--locked {
  border-style: dashed;
  opacity: 0.6;
}
.plot--follower .plot__crop,
.plot--follower .plot__name {
  opacity: 0.45;
}
.plot--selected,
.plot--selected:hover {
  border-color: var(--ui-primary);
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--ui-primary) 22%, transparent),
    inset 0 0 0 1px var(--ui-primary);
}
.plot--disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.plot__top {
  display: grid;
  width: 100%;
  min-height: 24px;
  grid-template-columns: auto auto minmax(24px, auto) minmax(0, 1fr) auto auto;
  grid-auto-rows: minmax(24px, auto);
  align-items: center;
  column-gap: 4px;
  row-gap: 3px;
}
.plot__no {
  grid-column: 1;
  grid-row: 1;
  color: var(--ui-subtle);
  font-size: 12px;
  font-weight: var(--fw-600);
}
.plot__soil {
  grid-column: 2;
  grid-row: 1;
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--soil-ink);
  background: var(--soil-chip);
  font-size: 12px;
  font-weight: var(--fw-700);
  line-height: 18px;
  white-space: nowrap;
}
.plot__soil-button {
  font-family: inherit;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.plot__soil-button:hover,
.plot__soil-button:focus-visible {
  border-color: color-mix(in srgb, var(--soil-ink) 55%, var(--soil-line));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--soil-ink) 18%, transparent);
  outline: none;
}
.plot__mutations {
  min-width: 0;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 3px;
  overflow-x: auto;
  scrollbar-width: none;
  grid-column: 3;
  grid-row: 1;
}
.plot__mutations::-webkit-scrollbar {
  display: none;
}
.plot__status-icons {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  align-content: center;
  gap: 3px;
  grid-column: 4;
  grid-row: 1;
}
.plot__top--wrapped-tags .plot__status-icons {
  grid-column: 1 / -1;
  grid-row: 2;
}
.plot__mutation {
  position: relative;
  width: 22px;
  height: 22px;
  display: grid;
  flex: none;
  place-items: center;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
}
.plot__mutation > img {
  width: 20px;
  height: 20px;
  object-fit: contain;
}
.plot__mutation > span:not(.plot__mutation-tooltip) {
  width: 20px;
  height: 20px;
  display: grid;
  flex: none;
  place-items: center;
  font-size: 20px;
}
.plot__mutation-tooltip {
  position: absolute;
  z-index: 20;
  top: calc(100% + 7px);
  right: 0;
  width: min(240px, calc(100vw - 24px));
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--ui-border-strong);
  border-radius: 9px;
  color: var(--ui-ink);
  background: var(--ui-surface-strong);
  box-shadow: 0 8px 22px rgb(15 23 42 / 20%);
  font-size: 11px;
  font-weight: var(--fw-500);
  line-height: 1.5;
  text-align: left;
  overflow-x: auto;
  scrollbar-width: none;
  white-space: nowrap;
  visibility: hidden;
  opacity: 0;
  pointer-events: auto;
  transition: opacity 0.12s ease;
}
.plot__mutation-tooltip::-webkit-scrollbar {
  display: none;
}
.plot__mutation-tooltip > strong {
  color: var(--ui-primary);
  font-weight: var(--fw-700);
}
.plot__mutation-tooltip > span {
  font-weight: var(--fw-400);
}
.plot__mutation:hover .plot__mutation-tooltip,
.plot__mutation-tooltip:hover {
  visibility: visible;
  opacity: 1;
}
.plot__joint {
  grid-column: 5;
  grid-row: 1;
  display: inline-flex;
  align-items: center;
  justify-self: end;
  gap: 2px;
  color: var(--soil-ink);
  font-size: 10px;
  font-weight: var(--fw-700);
}
/* 多选勾选框全站统一：16px 圆形（对齐「作物图鉴」图标右上角的 .book-tile__check）。 */
.plot__check {
  width: 16px;
  height: 16px;
  display: grid;
  flex: none;
  grid-column: 6;
  grid-row: 1;
  place-items: center;
  border: 1.5px solid color-mix(in srgb, var(--ui-primary) 42%, var(--ui-border));
  border-radius: 50%;
  color: #fff;
  background: color-mix(in srgb, var(--ui-surface-strong) 65%, transparent);
  font-size: 10px;
}
.plot--selected .plot__check {
  border-color: var(--ui-primary-fill);
  background: var(--ui-primary-fill);
}
.plot--disabled .plot__check {
  color: var(--ui-subtle);
  border-color: var(--ui-border-strong);
  border-style: dashed;
  background: transparent;
}

.plot__joint + .plot__check {
  margin-left: 0;
}

.plot--selectable .plot__joint > span {
  display: none;
}

.plot__crop {
  width: 44px;
  height: 44px;
  display: grid;
  margin-top: 2px;
  place-items: center;
}
.plot__crop img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.12));
}
.plot__crop-button {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  border-radius: 8px;
  cursor: pointer;
}
.plot__crop-button:hover,
.plot__crop-button:focus-visible {
  background: color-mix(in srgb, var(--ui-primary) 9%, transparent);
  outline: 2px solid color-mix(in srgb, var(--ui-primary) 36%, transparent);
}
.plot__placeholder {
  color: color-mix(in srgb, var(--soil-ink) 40%, transparent);
  font-size: 24px;
}

.plot__name {
  width: 100%;
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: center;
  gap: 2px;
  margin-top: 4px;
  overflow: hidden;
  font-size: 12px;
  font-weight: var(--fw-650);
  line-height: 16px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plot__name-crop {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.plot__name-stage {
  flex: none;
  color: var(--ui-subtle);
  font-size: 10px;
  font-weight: var(--fw-500);
}

.crop-detail-popover {
  position: fixed;
  z-index: 3000;
  width: max-content;
  min-width: 280px;
  max-width: calc(100vw - 20px);
  height: auto;
  min-height: 0;
  box-sizing: border-box;
  overflow: visible;
  padding: 12px;
  border: 1px solid var(--ui-border-strong);
  border-radius: 14px;
  color: var(--ui-ink);
  background: var(--ui-surface-strong);
  box-shadow: 0 12px 32px rgb(15 23 42 / 22%);
  font-size: 12px;
}
.crop-detail-popover__content {
  display: flex;
  min-width: 0;
  max-height: calc(100dvh - 44px);
  flex-direction: column;
  gap: 8px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
}
.crop-detail-popover__content::-webkit-scrollbar {
  display: none;
}
.crop-detail-popover::before {
  position: absolute;
  left: var(--crop-arrow-left);
  width: 10px;
  height: 10px;
  border: solid var(--ui-border-strong);
  background: var(--ui-surface-strong);
  content: '';
  transform: translateX(-50%) rotate(45deg);
}
.crop-detail-popover:not(.crop-detail-popover--below)::before {
  bottom: -6px;
  border-width: 0 1px 1px 0;
}
.crop-detail-popover--below::before {
  top: -6px;
  border-width: 1px 0 0 1px;
}
.crop-detail-popover__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.crop-detail-popover__header strong {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 4px;
  font-size: 13px;
  font-weight: var(--fw-600);
  white-space: nowrap;
}
.crop-detail-popover__plant-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.crop-detail-popover__season {
  flex: none;
  font-size: 10px;
  font-weight: var(--fw-500);
}
.crop-detail-popover__progress {
  margin: 0;
  padding: 8px;
  border-radius: 9px;
  background: #ecfdf5;
}
.crop-detail-popover__mutations {
  margin: 0;
  padding: 8px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--ui-primary) 8%, transparent);
}
.crop-detail-popover__progress-head,
.crop-detail-popover__progress-time {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.crop-detail-popover__progress-head strong {
  min-width: 0;
  flex: 1;
  color: #047857;
  overflow-wrap: anywhere;
}
.crop-detail-popover__progress-head b {
  flex: none;
  color: #059669;
  font-family: inherit;
  font-variant-numeric: tabular-nums;
}
.crop-detail-popover__progress-track {
  height: 6px;
  margin-top: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: #d1fae5;
}
.crop-detail-popover__progress-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #10b981;
  transition: width 0.3s ease;
}
.crop-detail-popover__progress-time {
  margin-top: 5px;
  color: var(--ui-subtle);
  font-size: 10px;
  font-family: inherit;
  font-variant-numeric: tabular-nums;
}
.crop-detail-popover__mutations {
  display: flex;
  flex-direction: column;
  gap: 4px;
  line-height: 1.5;
}
.crop-detail-popover__mutations > strong {
  color: var(--ui-primary);
}
.crop-detail-popover__mutations ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.crop-detail-popover__mutations li {
  position: relative;
  padding-left: 9px;
  font-weight: var(--fw-400);
}
.crop-detail-popover__mutations li::before {
  position: absolute;
  top: 2px;
  left: 0;
  color: var(--ui-subtle);
  content: '•';
  font-size: 8px;
}
.crop-detail-popover__needs span {
  padding: 2px 7px;
  border-radius: 999px;
  color: var(--ui-ink);
  background: color-mix(in srgb, var(--ui-warning) 14%, transparent);
  font-size: 10px;
}
:global(.dark) .crop-detail-popover__progress {
  background: rgb(6 78 59 / 0.35);
}
:global(.dark) .crop-detail-popover__progress-head strong {
  color: #6ee7b7;
}
:global(.dark) .crop-detail-popover__progress-head b {
  color: #34d399;
}
:global(.dark) .crop-detail-popover__progress-track {
  background: #064e3b;
}

.plot__time {
  display: flex;
  width: 100%;
  height: 20px;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  margin-top: 2px;
  padding: 0 2px;
}
.plot__countdown {
  display: inline-block;
  min-width: 0;
  overflow: hidden;
  color: var(--ui-warning);
  font-size: 10px;
  font-weight: var(--fw-700);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plot__growth-percent {
  flex: none;
  color: var(--ui-subtle);
  font-size: 10px;
  font-weight: var(--fw-600);
}
.plot__state {
  min-width: 0;
}
.plot__state {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 100%;
  overflow: hidden;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: var(--fw-700);
  line-height: 18px;
  white-space: nowrap;
}
.plot__state.is-ripe {
  color: #fff;
  background: var(--ui-primary-fill);
}
.plot__state.is-steal {
  color: var(--ui-violet);
  background: var(--ui-violet-soft);
}
.plot__state.is-dead {
  color: var(--ui-muted);
  background: color-mix(in srgb, var(--ui-ink) 8%, transparent);
}
.plot__state.is-muted {
  color: var(--ui-subtle);
  padding: 0;
  font-weight: var(--fw-500);
}

.plot__bar {
  width: 100%;
  height: 4px;
  margin-top: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--soil-ink) 12%, transparent);
}
.plot__bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #9fd17d, var(--ui-primary));
  transition: width 0.4s ease;
}

.plot__need,
.plot__trait {
  width: 16px;
  height: 16px;
  display: inline-grid;
  flex: none;
  place-items: center;
  border-radius: 999px;
  font-size: 11px;
  cursor: help;
}
/* 图标块级、固定尺寸，去掉行内元素的行高与基线留白，圆内上下居中 */
.plot__need,
.plot__trait {
  box-sizing: border-box;
  line-height: 0;
}
.plot__need > span,
.plot__trait > span,
.plot__trait > img {
  display: block;
  flex: none;
}
.plot__need > span,
.plot__trait > span {
  width: 10px;
  height: 10px;
}
.plot__trait img {
  width: 10px;
  height: 10px;
  object-fit: contain;
}
/* 需处理：实心色块，最醒目 */
.plot__need {
  color: #fff;
  padding: 0;
  border: 0;
  font: inherit;
  cursor: pointer;
  appearance: none;
}
.plot__need:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.plot__need:not(:disabled):hover,
.plot__need:not(:disabled):focus-visible {
  outline: 2px solid color-mix(in srgb, currentColor 45%, transparent);
  outline-offset: 1px;
}
.plot__need.is-water {
  background: #4b9fd5;
}
.plot__need.is-weed {
  background: #5a9f4e;
}
.plot__need.is-bug {
  background: #d9605c;
}
/* 加成与效果：描边，次要 */
.plot__trait {
  border: 1px solid currentColor;
  background: var(--ui-surface-strong);
}
.plot__trait.is-mutant {
  color: #c08a12;
}
.plot__trait.is-effect {
  color: var(--ui-blue);
}
.plot__trait.is-organic {
  color: #5f8f1d;
}
.plot__trait.is-organic-off {
  color: var(--ui-subtle);
  opacity: 0.7;
}
/* 深色：深灰卡面，类型色只在顶部渐变、描边和类型标签上 */
.dark .plot {
  --soil-tint: #9aa3ad;
  border-color: color-mix(in srgb, var(--soil-tint) 28%, transparent);
  background: linear-gradient(180deg, color-mix(in srgb, var(--soil-tint) 12%, #1d2228) 0%, #1a1f25 70%);
  box-shadow: none;
}
.dark .plot--lv1,
.dark .plot--lv0 {
  --soil-tint: #c9a867;
}
.dark .plot--lv2 {
  --soil-tint: #e08a6e;
}
.dark .plot--lv3 {
  --soil-tint: #8d939b;
}
.dark .plot--lv4 {
  --soil-tint: #e6c35a;
}
.dark .plot--lv5 {
  --soil-tint: #b892f0;
}
.dark .plot__soil,
.dark .plot__joint {
  color: var(--soil-tint);
  background: color-mix(in srgb, var(--soil-tint) 15%, transparent);
}
.dark .plot__joint {
  background: transparent;
}
.dark .plot--selected {
  border-color: var(--ui-primary);
}
.dark .plot__trait {
  background: transparent;
}
.dark .plot__bar {
  background: rgba(255, 255, 255, 0.08);
}

@media (prefers-reduced-motion: reduce) {
  .plot,
  .plot__bar i {
    transition: none;
  }
}
.plot--lv6 {
  --soil-bg: #eef8fd;
  --soil-line: #b5d9eb;
  --soil-ink: #367caa;
  --soil-chip: #d7edf8;
}
.dark .plot--lv6 {
  --soil-tint: #82bddf;
}
</style>
