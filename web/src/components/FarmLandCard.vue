<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { formatCountdown as formatTime } from '@/utils/format-countdown'

/**
 * 一块地的卡片。结构固定为：标题栏（编号、土地类型、状态图标）/ 作物 / 名称 / 时间或主状态 / 进度。
 * 状态图标整组在标题栏内居中，正对下方居中的作物图标；
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
  fertilize: [land: any]
}>()

const land = computed(() => props.land || {})

const SOILS: Record<number, { short: string, name: string }> = {
  0: { short: '普', name: '普通土地' },
  1: { short: '普', name: '普通土地' },
  2: { short: '红', name: '红土地' },
  3: { short: '黑', name: '黑土地' },
  4: { short: '金', name: '金土地' },
  5: { short: '紫', name: '紫金土地' },
  6: { short: '蓝', name: '蓝晶土地' },
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

const seasonProgress = computed(() => {
  if (!hasCrop.value || isFollower.value) return [0]
  const total = Number(land.value.totalSeason) === 2 ? 2 : 1
  const current = total === 2 && Number(land.value.currentSeason) === 2 ? 2 : 1
  return Array.from({ length: total }, (_, index) => {
    const season = index + 1
    return season < current ? 100 : season === current ? growPercent.value : 0
  })
})

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
  const remaining = Number(land.value.leftInorcFertTimes)
  if (land.value.unlocked && !land.value.occupiedByMaster && status.value === 'growing'
    && Number(land.value.matureInSec) > 0 && Number.isFinite(remaining) && remaining > 0) {
    list.push({
      key: 'normal-fertilizer',
      kind: 'normal-fertilizer',
      icon: 'i-carbon-chemistry',
      title: `还可施普通肥 ${remaining} 次`,
    })
  }
  return list
})

// 需处理的问题排在最前。
const allTags = computed(() => [
  ...needs.value.map(item => ({ ...item, group: 'need' as const, kind: item.key, image: '' })),
  ...traits.value.map(item => ({ ...item, group: 'trait' as const })),
])

function markMutantFailed(key: string) {
  failedMutantIcons.value = new Set(failedMutantIcons.value).add(key)
}

/** 变异 tooltip 智能定位：默认向左展开，左侧放不下改向右，两边都放不下则居中并夹在视口内。 */
function positionMutationTooltip(event: Event) {
  const el = event.currentTarget as HTMLElement | null
  if (!el)
    return
  const rect = el.getBoundingClientRect()
  const margin = 10
  const width = Math.min(240, window.innerWidth - margin * 2)
  let left = -width
  if (rect.right - width < margin) {
    left = 0
    if (rect.left + width > window.innerWidth - margin) {
      left = rect.width / 2 - width / 2
    }
  }
  const min = Math.max(margin, rect.left + left) - rect.left
  const max = Math.min(window.innerWidth - margin - width, rect.right) - rect.left
  left = Math.min(max, Math.max(min, left))
  el.style.setProperty('--tip-w', `${width}px`)
  el.style.setProperty('--tip-left', `${left}px`)
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
    class="plot selection-card margin-shell"
    :class="[
      `plot--lv${level}`,
      stateTag ? `plot--${stateTag.kind}` : '',
      {
        'plot--locked': isLocked,
        'plot--follower': isFollower,
        'plot--interactive': interactive,
        'plot--selectable': selectable,
        'selection-card--selected': selectable && selected,
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
  ><span class="margin-content">
    <header class="plot__top">
      <span class="plot__no">#{{ land.id }}</span>
      <button
        v-if="openable && !selectable"
        type="button"
        class="plot__soil ui-area-badge"
        :title="`查看${soil.name}详情`"
        :aria-label="`查看第 ${land.id} 块地的${soil.name}详情`"
        @click.stop="emit('open', land)"
      >
        {{ soil.short }}
      </button>
      <span v-else class="plot__soil ui-area-badge" :title="soil.name">{{ soil.short }}</span>
      <div v-if="allTags.length" class="plot__tags">
        <template v-for="item in allTags" :key="item.key">
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
          <span
            v-else-if="item.kind === 'mutant'"
            class="plot__mutation"
            :aria-label="`查看变异效果：${item.title}`"
            role="img"
            @pointerenter="positionMutationTooltip"
          >
            <img v-if="item.image" :src="item.image" alt="" @error="markMutantFailed(item.key)">
            <span v-else :class="item.icon || 'i-carbon-star'" aria-hidden="true" />
            <span class="plot__mutation-tooltip" role="tooltip">
              <strong>变异</strong>&nbsp;&nbsp;<span>{{ item.title }}</span>
            </span>
          </span>
          <button
            v-else-if="item.kind === 'normal-fertilizer' && !selectable && openable"
            type="button"
            class="plot__trait is-normal-fertilizer plot__fertilize-button"
            :title="`${item.title}，点击施肥`"
            :aria-label="`为第 ${land.id} 块地施普通肥`"
            :disabled="farmDisabled"
            @click.stop="emit('fertilize', land)"
            @keydown.stop
          >
            <span :class="item.icon" aria-hidden="true" />
          </button>
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

    <div class="plot__bars" aria-hidden="true">
      <div v-for="(percent, index) in seasonProgress" :key="index" class="plot__bar ui-progress-track">
        <i :style="{ width: `${percent}%` }" />
      </div>
    </div>
  </span></article>
  <Teleport to="body">
    <section
      v-if="cropDetailsOpen"
      ref="cropDetailsElement"
      class="crop-detail-popover margin-shell"
      :class="{ 'crop-detail-popover--below': cropDetailsBelow }"
      :style="cropDetailsStyle"
      role="dialog"
      :aria-label="`${land.plantName}作物详情`"
      @click.stop
    ><span class="margin-content">
      <div class="crop-detail-popover__content">
        <header class="crop-detail-popover__header">
          <strong>
            <span class="plot__no">#{{ land.id }}</span> ·
            <span class="crop-detail-popover__plant-name">{{ land.plantName }}</span>
            <span class="crop-detail-popover__season">(生长季数 {{ Number(land.totalSeason) > 0 ? `${land.currentSeason}/${land.totalSeason}` : '—' }})</span>
          </strong>
        </header>
        <div v-if="maturityProgress" class="crop-detail-popover__progress margin-shell"><span class="margin-content">
          <div class="crop-detail-popover__progress-head">
            <strong>成熟倒计时</strong>
            <b>{{ maturityProgress.percent }}%</b>
          </div>
          <div class="crop-detail-popover__progress-track ui-progress-track">
            <span :style="{ width: `${maturityProgress.percent}%` }" />
          </div>
          <div class="crop-detail-popover__progress-time">
            <span>已生长 {{ formatTime(maturityProgress.elapsed) }}</span>
            <span>总时长 {{ formatTime(maturityProgress.duration) }}</span>
          </div>
        </span></div>
        <div v-if="phaseProgress" class="crop-detail-popover__progress margin-shell"><span class="margin-content">
          <div class="crop-detail-popover__progress-head">
            <strong>阶段倒计时</strong>
            <b>{{ phaseProgress.percent }}%</b>
          </div>
          <div class="crop-detail-popover__progress-track ui-progress-track">
            <span :style="{ width: `${phaseProgress.percent}%` }" />
          </div>
          <div class="crop-detail-popover__progress-time">
            <span>当前阶段 {{ cropStage || '—' }}</span>
            <span>阶段时长 {{ formatTime(phaseProgress.duration) }}</span>
          </div>
        </span></div>
        <div v-if="cropMutationDetails.length" class="crop-detail-popover__mutations margin-shell"><span class="margin-content">
          <strong>变异</strong>
          <ul>
            <li v-for="(effect, index) in cropMutationDetails" :key="`${index}-${effect}`">
              {{ effect }}
            </li>
          </ul>
        </span></div>
        <div v-if="land.needWater || land.needWeed || land.needBug" class="crop-detail-popover__needs">
          <span v-if="land.needWater" class="ui-area-badge"><span>需要浇水</span></span>
          <span v-if="land.needWeed" class="ui-area-badge"><span>需要除草</span></span>
          <span v-if="land.needBug" class="ui-area-badge"><span>需要除虫</span></span>
        </div>
      </div>
    </span></section>
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
  --inset-top: 8px; --inset-right: 10px; --inset-bottom: 9px; --inset-left: 10px;
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
.plot--disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.plot__top {
  display: grid;
  width: 100%;
  min-height: 24px;
  /* 编号 / 土地类型 / 状态图标组（剩余空间内居中，正对下方作物图标） / 合种标记 / 勾选框 */
  grid-template-columns: auto auto minmax(0, 1fr) auto auto;
  grid-auto-rows: minmax(24px, auto);
  align-items: center;
  column-gap: 4px;
  row-gap: 3px;
}
.plot__no {
  grid-column: 1;
  grid-row: 1;
  color: var(--ui-subtle);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-400);
}
.plot__soil {
  --ui-area-badge-tint: var(--soil-tint, var(--soil-ink));
  grid-column: 2;
  grid-row: 1;
  font-size: var(--ui-font-size-tiny-12);
  font-weight: var(--fw-400) !important;
  white-space: nowrap;
}
.plot__soil:hover,
.plot__soil:focus-visible {
  outline: 1px solid var(--ui-area-badge-tint);
}
/* 状态图标组：在标题栏内（编号/土质标签之后、合种标记之前的剩余空间）整组居中，
   正对下方居中的作物图标；图标多时自动换行 */
.plot__tags {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  align-content: center;
  justify-content: center;
  gap: 3px;
  grid-column: 3;
  grid-row: 1;
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
  font-size: var(--ui-font-size-large-15);
}
.plot__mutation-tooltip {
  position: absolute;
  z-index: 20;
  top: calc(100% + 7px);
  /* 位置由 positionMutationTooltip 按视口空间计算：默认贴图标右缘向左展开（--tip-left: -宽度） */
  left: var(--tip-left, calc(-1 * min(240px, 100vw - 20px)));
  width: var(--tip-w, min(240px, calc(100vw - 24px)));
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--ui-border-strong);
  border-radius: 9px;
  color: var(--ui-ink);
  background: var(--ui-surface-strong);
  box-shadow: 0 8px 22px rgb(15 23 42 / 20%);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-400);
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
  font-weight: var(--fw-400);
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
  grid-column: 4;
  grid-row: 1;
  display: inline-flex;
  align-items: center;
  justify-self: end;
  gap: 2px;
  color: var(--soil-ink);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-400);
}
/* 多选勾选框全站统一：16px 圆形（对齐「作物图鉴」图标右上角的 .book-tile__check）。 */
.plot__check {
  width: 16px;
  height: 16px;
  display: grid;
  flex: none;
  grid-column: 5;
  grid-row: 1;
  place-items: center;
  border: 1.5px solid color-mix(in srgb, var(--ui-primary) 42%, var(--ui-border));
  border-radius: 50%;
  color: #fff;
  background: color-mix(in srgb, var(--ui-surface-strong) 65%, transparent);
  font-size: var(--ui-content-item-font-height-tiny-12);
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
  outline: none;
  box-shadow: inset 0 0 0 1px var(--ui-primary);
}
.plot__placeholder {
  color: color-mix(in srgb, var(--soil-ink) 40%, transparent);
  font-size: var(--ui-font-size-large-15);
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
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-400);
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
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-400);
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
  --inset-top: 12px; --inset-right: 12px; --inset-bottom: 12px; --inset-left: 12px;
  border: 1px solid var(--ui-border-strong);
  border-radius: var(--ui-radius-card);
  color: var(--ui-ink);
  background: var(--ui-surface-strong);
  box-shadow: var(--ui-shadow-md);
  font-size: var(--ui-content-item-font-height-tiny-12);
}
.crop-detail-popover__content {
  display: flex;
  min-width: 0;
  max-height: calc(100dvh - 44px);
  flex-direction: column;
  gap: var(--ui-content-vertical-gap);
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
}
.crop-detail-popover__content :is(strong, b) {
  font-weight: var(--fw-400);
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
  font-size: var(--ui-font-size-small-13);
  font-weight: var(--fw-400);
  white-space: nowrap;
}
.crop-detail-popover__plant-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.crop-detail-popover__season {
  flex: none;
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-400);
}
.crop-detail-popover__progress {
  margin: 0;
  --inset-top: 8px; --inset-right: 8px; --inset-bottom: 8px; --inset-left: 8px;
  border-radius: 9px;
  background: var(--ui-surface-soft);
}
.crop-detail-popover__mutations {
  margin: 0;
  --inset-top: 8px; --inset-right: 8px; --inset-bottom: 8px; --inset-left: 8px;
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
  color: var(--ui-ink);
  overflow-wrap: anywhere;
}
.crop-detail-popover__progress-head b {
  flex: none;
  color: var(--ui-primary);
  font-family: inherit;
  font-variant-numeric: tabular-nums;
}
.crop-detail-popover__progress-track {
  --ui-progress-track-bg: color-mix(in srgb, var(--ui-ink) 24%, var(--ui-surface-soft));
  height: 6px;
  margin-top: var(--ui-content-vertical-gap);
  overflow: hidden;
  border-radius: 999px;
}
.crop-detail-popover__progress-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--ui-primary);
  transition: width 0.3s ease;
}
.crop-detail-popover__progress-time {
  margin-top: var(--ui-content-vertical-gap);
  color: var(--ui-muted);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-family: inherit;
  font-variant-numeric: tabular-nums;
}
.crop-detail-popover__mutations {
  display: flex;
  flex-direction: column;
  gap: 4px;
  line-height: 1.5;
}
.crop-detail-popover__mutations > .margin-content > strong {
  color: var(--ui-primary);
}
.crop-detail-popover__mutations ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.crop-detail-popover__mutations li {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-weight: var(--fw-400);
}
.crop-detail-popover__mutations li::before {
  flex: none;
  color: var(--ui-subtle);
  content: '•';
  font-size: var(--ui-content-item-font-height-tiny-12);
}
.crop-detail-popover__needs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.crop-detail-popover__needs .ui-area-badge {
  --ui-area-badge-tint: var(--ui-warning);
  --ui-area-badge-strength: 14%;
  padding: 0;
  font-size: var(--ui-content-item-font-height-tiny-12);
}
.crop-detail-popover__needs .ui-area-badge > span {
  display: block;
  margin: 2px 7px;
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
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-400);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plot__growth-percent {
  flex: none;
  color: var(--ui-subtle);
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-400);
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
  font-size: var(--ui-content-item-font-height-tiny-12);
  font-weight: var(--fw-400);
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
  font-weight: var(--fw-400);
}

.plot__bars {
  display: flex;
  width: 100%;
  gap: 3px;
  margin-top: 5px;
}
.plot__bar {
  flex: 1;
  min-width: 0;
  height: 4px;
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
  font-size: var(--ui-content-item-font-height-tiny-12);
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
button.plot__need {
  width: 20px;
  height: 20px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ui-ink) 40%, transparent);
}
button.plot__need > span {
  width: 16px;
  height: 16px;
}
button.plot__need:not(:disabled):hover,
button.plot__need:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--ui-ink);
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
.plot__trait.is-normal-fertilizer {
  color: #5f8f1d;
}
.plot__trait.is-normal-fertilizer {
  width: 20px;
  height: 20px;
  border: 0;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 60%, transparent);
}
.plot__trait.is-normal-fertilizer > span {
  width: 16px;
  height: 16px;
}
.plot__trait.is-normal-fertilizer:hover {
  box-shadow: inset 0 0 0 1px currentColor;
}
.plot__fertilize-button {
  cursor: pointer;
}
.plot__fertilize-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
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
.dark .plot__joint {
  color: var(--soil-tint);
  background: color-mix(in srgb, var(--soil-tint) 15%, transparent);
}
.dark .plot__joint {
  background: transparent;
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
