<script setup lang="ts">
import type { RanchFeedStage } from '@/stores/setting'
import type { BagPreferenceModule, FeatureAutomationShape, FeatureModuleKey, FeatureStrategyShape, FriendAction } from '@/utils/account-feature-modules'
import { NTimePicker } from 'naive-ui/es/time-picker'
import { computed, ref, watch } from 'vue'
import ActivitySettingsButtons from '@/components/settings/ActivitySettingsButtons.vue'
import RanchCubPriorityDialog from '@/components/settings/RanchCubPriorityDialog.vue'
import RanchStrategyPreview from '@/components/settings/RanchStrategyPreview.vue'
import IllustratedPriorityPreview from '@/components/settings/IllustratedPriorityPreview.vue'
import PatrolIntervalFields from '@/components/settings/PatrolIntervalFields.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { applyAllowedMysteryShopCurrency, applyModuleEnabled, FEATURE_MODULES, getAllowedMysteryShopCurrency, getSharedFriendAction, isModuleEnabled, MYSTERY_SHOP_CURRENCIES, setSharedFriendAction } from '@/utils/account-feature-modules'

const props = defineProps<{
  accountId: string
  connected: boolean
  ranchAnimalOptions: Array<{ value: number, label: string, kind: string }>
  ranchAnimalOptionsLoading: boolean
  ranchAnimalOptionsError: string
  saveModule: (module: FeatureModuleKey, gateOnly?: boolean) => Promise<boolean>
  saveBagPreferences: (module: BagPreferenceModule) => Promise<boolean>
  currentAccountName: string | null
  saving: boolean
  fertilizerLandTypeOptions: Array<{ label: string, short: string, value: string }>
  fertilizerOptions: Array<{ label: string, value: string }>
}>()

const emit = defineEmits<{
  reloadAnimals: []
}>()

const strategy = defineModel<FeatureStrategyShape>('strategy', { required: true })
const automation = defineModel<FeatureAutomationShape>('automation', { required: true })

const activeModule = ref<FeatureModuleKey | null>(null)
const ranchBagPreviewVisible = ref(false)
watch([activeModule, () => props.accountId], () => { ranchBagPreviewVisible.value = false })
const editSnapshot = ref<{ strategy: FeatureStrategyShape, automation: FeatureAutomationShape } | null>(null)

const moduleContext = computed(() => ({ strategy: strategy.value, automation: automation.value }))
const activeInfo = computed(() => FEATURE_MODULES.find(item => item.key === activeModule.value) || null)
const auto = computed(() => automation.value.automation)
watch(() => auto.value.ranch_strategy, (strategy) => {
  if (strategy === 'bag_priority' && auto.value.ranch_bag_fallback === 'bag_priority')
    auto.value.ranch_bag_fallback = 'level'
})
const landFertilizerStrategies = computed(() => {
  const config = auto.value
  const selected = new Set(config.fertilizer_land_types)
  return Object.fromEntries(props.fertilizerLandTypeOptions.map(({ value }) => [
    value,
    config.fertilizer_land_strategies?.[value] ?? (selected.has(value) ? config.fertilizer || 'none' : 'none'),
  ]))
})
const hasRipeningStrategy = computed(() => Object.values(landFertilizerStrategies.value)
  .some(mode => mode === 'smart' || mode === 'normal_ripen' || mode === 'organic_ripen'))

function setLandFertilizerStrategy(landType: string, mode: string | number) {
  auto.value.fertilizer_land_strategies = { ...landFertilizerStrategies.value, [landType]: String(mode) }
}

// 神秘商人货币：后端是四个独立布尔，下拉单选在这里双向映射
const mysteryCurrencyOptions = MYSTERY_SHOP_CURRENCIES.map(({ label, value }) => ({ label, value }))
const mysteryShopCurrency = computed({
  get: () => getAllowedMysteryShopCurrency(auto.value),
  set: (value: string | number) => applyAllowedMysteryShopCurrency(auto.value, String(value ?? '')),
})

const friendActions: Array<{ key: FriendAction, label: string }> = [
  { key: 'patrol', label: '自动巡查' },
  { key: 'help', label: '自动帮忙' },
  { key: 'mischief', label: '自动捣乱' },
]
const sharedFriendOptions = [
  { label: '保留原设置', value: 'mixed' },
  { label: '农牧场同时开启', value: 'on' },
  { label: '农牧场同时关闭', value: 'off' },
]
const friendStates = computed(() => ({
  patrol: getSharedFriendAction('patrol', auto.value),
  help: getSharedFriendAction('help', auto.value),
  steal: getSharedFriendAction('steal', auto.value),
  mischief: getSharedFriendAction('mischief', auto.value),
}))

function setSharedFriendChoice(action: FriendAction, value: string | number | undefined) {
  if (value === 'on' || value === 'off')
    setSharedFriendAction(action, value === 'on', auto.value)
}

const ranchStrategies = [
  { label: '最高等级', value: 'level' },
  { label: '指定动物', value: 'preferred' },
  { label: '优先背包幼崽', value: 'bag_priority' },
  { label: '图鉴优先（普通图鉴）', value: 'illustrated' },
]
const ranchFeedStages: Array<{ label: string, value: RanchFeedStage | 'none' }> = [
  { label: '不使用', value: 'none' },
  { label: '可喂养时就用', value: 'any' },
  { label: '仅最长阶段', value: 'longest' },
  { label: '成长期 · 加速到生产期', value: 'to_production' },
  { label: '成熟期 · 距收获 10 分钟内', value: 'near_harvest' },
]
const ranchCanTypes = [
  { label: '普通罐头', enabled: 'ranch_feed_normal', stage: 'ranch_feed_normal_stage', defaultStage: 'longest' },
  { label: '有机罐头', enabled: 'ranch_feed_organic', stage: 'ranch_feed_organic_stage', defaultStage: 'near_harvest' },
] as const

function setRanchFeedStage(can: typeof ranchCanTypes[number], value: string | number) {
  const option = ranchFeedStages.find(option => option.value === value)
  if (!option)
    return

  if (option.value !== 'none')
    auto.value[can.stage] = option.value
  auto.value[can.enabled] = option.value !== 'none'
}

const fertilizerBuyRows = [
  { label: '有机化肥', enabled: 'fertilizer_buy_organic', count: 'fertilizerBuyOrganicCount', threshold: 'fertilizerBuyOrganicThresholdHours', interval: 'fertilizerBuyCheckIntervalMinutes' },
  { label: '无机化肥', enabled: 'fertilizer_buy_normal', count: 'fertilizerBuyNormalCount', threshold: 'fertilizerBuyNormalThresholdHours', interval: 'fertilizerBuyNormalCheckIntervalMinutes' },
] as const
const activeFertilizerBuyRows = computed(() => fertilizerBuyRows.filter(row => auto.value[row.enabled]))

async function toggleModule(key: FeatureModuleKey, enabled: boolean) {
  if (props.saving)
    return
  const accountId = props.accountId
  const previous = isModuleEnabled(key, moduleContext.value)
  applyModuleEnabled(key, enabled, moduleContext.value)
  if (!await props.saveModule(key, true) && props.accountId === accountId)
    applyModuleEnabled(key, previous, moduleContext.value)
}

function openModule(key: FeatureModuleKey) {
  // 弹窗内是草稿：取消要能整体回滚，包括父级槽位里改动的背包种子土地限制。
  editSnapshot.value = {
    strategy: JSON.parse(JSON.stringify(strategy.value)),
    automation: JSON.parse(JSON.stringify(automation.value)),
  }
  activeModule.value = key
  if (key === 'ranchProduction' && !props.ranchAnimalOptions.length && !props.ranchAnimalOptionsLoading)
    emit('reloadAnimals')
}

function cancel() {
  if (props.saving)
    return
  if (editSnapshot.value) {
    strategy.value = editSnapshot.value.strategy
    automation.value = editSnapshot.value.automation
  }
  editSnapshot.value = null
  activeModule.value = null
}

async function finish() {
  if (!activeModule.value || props.saving || !await props.saveModule(activeModule.value))
    return
  editSnapshot.value = null
  activeModule.value = null
}

async function saveBagPreferences(module: BagPreferenceModule) {
  const snapshot = editSnapshot.value
  if (props.saving || !await props.saveBagPreferences(module) || !snapshot || editSnapshot.value !== snapshot)
    return false

  // 上层取消时，背包仍以本次已保存的配置为准。
  if (module === 'planting') {
    snapshot.strategy.bagSeedPriority = strategy.value.bagSeedPriority
    snapshot.strategy.bagSeedLandTypes = strategy.value.bagSeedLandTypes
  }
  else {
    snapshot.automation.automation.ranch_coop_cub_priority = auto.value.ranch_coop_cub_priority
    snapshot.automation.automation.ranch_shed_cub_priority = auto.value.ranch_shed_cub_priority
  }
  return true
}

async function saveRanchCubs() {
  if (await saveBagPreferences('ranchProduction'))
    ranchBagPreviewVisible.value = false
}
</script>

<template>
  <div class="space-y-4">
    <div v-if="!strategy || !automation" class="py-8 text-center text-gray-500">
      <div class="i-carbon-settings mx-auto mb-2 text-3xl text-gray-400" />
      <p>账号设置加载失败，请切换账号或刷新页面重试</p>
    </div>
    <template v-else>
      <!-- 模块卡靠 1px 深色描边分组（见下方 .feature-card）：面板已经是白底，
           不能叠半透底色和投影，否则卡片内部会比面板灰一档、外围又多出一圈灰。 -->
      <div class="feature-grid-wrap">
        <!-- 列数只看这块区域自己的宽度，不看视口：页面左侧还有导航栏，
             按视口断点会在窄栏里挤成 4 列。 -->
        <div class="feature-grid">
          <article
            v-for="info in FEATURE_MODULES"
            :key="info.key"
            class="feature-card"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0 flex items-center gap-2">
                <img v-if="info.image" :src="info.image" alt="" class="h-7 w-7 shrink-0 object-contain">
                <span v-else :class="info.icon" class="h-7 w-7 shrink-0 text-[var(--theme-primary)]" aria-hidden="true" />
                <h4 class="settings-group__title truncate">
                  {{ info.title }}
                </h4>
              </div>
              <BaseSwitch
                :aria-label="`${info.title}自动化`"
                :model-value="isModuleEnabled(info.key, moduleContext)"
                :disabled="saving"
                @update:model-value="toggleModule(info.key, !!$event)"
              />
            </div>

            <div class="mt-2 flex items-center justify-between gap-2">
              <span class="settings-note min-w-0 flex items-center gap-1.5">
                <span class="h-2 w-2 shrink-0 rounded-full" :class="isModuleEnabled(info.key, moduleContext) ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'" />
                {{ isModuleEnabled(info.key, moduleContext) ? '已启用' : '已暂停' }}
              </span>
              <BaseButton variant="secondary" size="sm" :disabled="saving" @click="openModule(info.key)">
                配置
              </BaseButton>
            </div>
          </article>
        </div>
      </div>
    </template>

    <Teleport to="body">
      <div
        v-if="activeModule && activeInfo"
        class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-gray-950/45 p-[var(--ui-settings-space)] backdrop-blur-[2px]"
        @click.self="cancel"
      >
        <section
          class="settings-dialog max-h-[calc(100dvh-24px)] max-w-[560px] w-full flex flex-col overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="feature-dialog-title"
        >
          <header class="settings-dialog__header flex items-center justify-between gap-2 border-b">
            <div class="min-w-0 flex items-start gap-3">
              <img v-if="activeInfo.image" :src="activeInfo.image" alt="" class="h-11 w-11 shrink-0 rounded-lg bg-gray-100 object-contain p-1.5 dark:bg-gray-700">
              <span v-else :class="activeInfo.icon" class="h-11 w-11 shrink-0 text-[var(--theme-primary)]" aria-hidden="true" />
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 id="feature-dialog-title" class="settings-dialog__title">
                    {{ activeInfo.title }}
                  </h3>
                  <span class="settings-note settings-dialog__status rounded-full px-2 py-0.5">
                    {{ isModuleEnabled(activeModule, moduleContext) ? '已启用' : '已暂停' }}
                  </span>
                </div>
              </div>
            </div>
            <button type="button" class="settings-dialog__close" aria-label="关闭" :disabled="saving" @click="cancel">
              <span class="i-carbon-close text-xl" />
            </button>
          </header>

          <fieldset class="settings-dialog__body modal-scroll m-0 min-h-0 min-w-0 flex-1 overflow-y-auto border-0" :disabled="saving">
            <!-- ========== 种植与收获 ========== -->
            <div v-if="activeModule === 'planting'" class="space-y-3">
              <section class="settings-group space-y-2">
                <div class="settings-group__title">
                  基础功能
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <BaseSwitch v-model="auto.farm" label="自动种植收获" />
                  <BaseSwitch v-model="auto.farm_harvest_tiangong" label="自动收获天工作物" />
                  <BaseSwitch v-model="auto.farm_push" label="推送触发巡田" />
                  <BaseSwitch v-model="auto.skip_own_weed_bug" label="巡田时跳过一键务农" />
                  <BaseSwitch v-model="auto.sell" label="自动卖果实" />
                  <BaseSwitch v-model="strategy.bagSeedMultiLandReservationEnabled" label="为高优先级多格种子预留土地" />
                </div>
              </section>

              <!-- 选种策略与背包种子优先顺序依赖账号实时数据，由页面提供 -->
              <section class="settings-group">
                <slot name="planting-strategy" :save-bag-preferences="saveBagPreferences" />
              </section>

              <PatrolIntervalFields v-model:minimum="strategy.intervals.farmMin" v-model:maximum="strategy.intervals.farmMax" title="农场巡查间隔(秒)" />
            </div>

            <div v-else-if="activeModule === 'ranchProduction'" class="space-y-3">
              <section class="settings-group space-y-2">
                <h4 class="settings-group__title">生产与补栏</h4>
                <div class="grid grid-cols-2 gap-2">
                  <BaseSwitch v-model="auto.ranch_produce" label="自动生产" />
                  <BaseSwitch v-model="auto.ranch_harvest" label="自动收获" />
                  <BaseSwitch v-model="auto.ranch_buy" label="自动补栏（金券）" />
                  <BaseSwitch v-model="auto.ranch_sell" label="自动出售产物" />
                </div>
              </section>
              <section class="settings-group space-y-2">
                <div class="grid grid-cols-2 gap-2">
                  <BaseSelect v-model="auto.ranch_strategy" label="第一优先策略" :options="ranchStrategies" :virtual-scroll="false" :theme-overrides="{ peers: { InternalSelectMenu: { height: 'none' } } }" />
                  <div v-if="auto.ranch_strategy === 'bag_priority'" class="base-field">
                    <label class="base-field__label">第一优先策略预览</label>
                    <BaseButton variant="secondary" @click="ranchBagPreviewVisible = true">背包幼崽</BaseButton>
                  </div>
                  <IllustratedPriorityPreview v-if="auto.ranch_strategy === 'illustrated'" kind="ranch" :account-id="accountId" :connected="connected" />
                  <template v-if="auto.ranch_strategy === 'preferred'">
                    <p v-if="ranchAnimalOptionsLoading" class="col-span-full settings-note" role="status">
                      正在读取牧场动物选项…
                    </p>
                    <div v-else-if="ranchAnimalOptionsError" class="col-span-full flex flex-wrap items-center gap-2">
                      <p class="settings-error" role="alert">
                        {{ ranchAnimalOptionsError }}
                      </p>
                      <BaseButton variant="secondary" size="sm" @click="emit('reloadAnimals')">
                        重试
                      </BaseButton>
                    </div>
                    <div v-else class="col-span-full grid grid-cols-2 gap-2">
                      <BaseSelect v-model="auto.ranch_coop_animal" label="窝 · 指定动物" :options="[{ value: 0, label: '不购买' }, ...ranchAnimalOptions.filter(animal => animal.kind === '窝')]" />
                      <BaseSelect v-model="auto.ranch_shed_animal" label="棚 · 指定动物" :options="[{ value: 0, label: '不购买' }, ...ranchAnimalOptions.filter(animal => animal.kind === '棚')]" />
                    </div>
                  </template>
                </div>
                <div v-if="['bag_priority', 'illustrated'].includes(auto.ranch_strategy || '')" class="mt-2 space-y-2">
                  <div class="grid grid-cols-2 gap-2">
                    <BaseSelect v-model="auto.ranch_bag_fallback" label="第二优先策略" :options="auto.ranch_strategy === 'illustrated' ? ranchStrategies.slice(0, 3) : ranchStrategies.slice(0, 2)" />
                    <div v-if="auto.ranch_bag_fallback === 'bag_priority'" class="base-field">
                      <label class="base-field__label">第二优先策略预览</label>
                      <BaseButton variant="secondary" @click="ranchBagPreviewVisible = true">背包幼崽</BaseButton>
                    </div>
                  </div>
                  <RanchCubPriorityDialog v-model:show="ranchBagPreviewVisible" v-model="automation.automation" :account-id="accountId" :connected="connected" :saving="saving" @save="saveRanchCubs" />
                  <template v-if="auto.ranch_bag_fallback === 'preferred'">
                    <p v-if="ranchAnimalOptionsLoading" class="settings-note" role="status">正在读取牧场动物选项…</p>
                    <div v-else-if="ranchAnimalOptionsError" class="flex items-center gap-2">
                      <p class="settings-error" role="alert">{{ ranchAnimalOptionsError }}</p>
                      <BaseButton variant="secondary" @click="emit('reloadAnimals')">重试</BaseButton>
                    </div>
                    <div v-else class="grid grid-cols-2 gap-2">
                      <BaseSelect v-model="auto.ranch_coop_animal" label="窝 · 指定动物" :options="[{ value: 0, label: '不购买' }, ...ranchAnimalOptions.filter(animal => animal.kind === '窝')]" />
                      <BaseSelect v-model="auto.ranch_shed_animal" label="棚 · 指定动物" :options="[{ value: 0, label: '不购买' }, ...ranchAnimalOptions.filter(animal => animal.kind === '棚')]" />
                    </div>
                  </template>
                </div>
                <RanchStrategyPreview
                  :show-refresh="auto.ranch_strategy !== 'level'"
                  v-if="auto.ranch_strategy === 'level' || ['bag_priority', 'illustrated'].includes(auto.ranch_strategy || '') && auto.ranch_bag_fallback === 'level'"
                  :title="['bag_priority', 'illustrated'].includes(auto.ranch_strategy || '') ? '第二优先策略预览' : '第一优先策略预览'"
                  :account-id="accountId"
                  :connected="connected"
                />
              </section>
              <PatrolIntervalFields v-model:minimum="auto.ranch_check_min_seconds" v-model:maximum="auto.ranch_check_max_seconds" title="牧场巡查间隔(秒)" />
            </div>

            <!-- ========== 土地与施肥 ========== -->
            <div v-else-if="activeModule === 'fertilizer'" class="space-y-3">
              <section class="settings-group space-y-2">
                <div class="settings-group__title">
                  基础功能
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <BaseSwitch v-model="auto.land_upgrade" label="自动升级土地" />
                  <BaseSwitch v-model="auto.fertilizer_gift" label="自动填充化肥" />
                  <BaseSwitch v-model="auto.fertilizer_buy_organic" label="自动购买有机化肥" />
                  <BaseSwitch v-model="auto.fertilizer_buy_normal" label="自动购买无机化肥" />
                  <BaseSwitch v-model="auto.fertilizer_multi_season" label="多季补肥" />
                  <BaseSwitch v-model="auto.show_manual_fertilizer" label="显示手动施肥按钮" />
                </div>
              </section>

              <section class="settings-group space-y-2">
                <h4 class="settings-group__title">
                  施肥范围与策略
                </h4>
                <div class="grid grid-cols-2 gap-x-3 gap-y-2">
                  <div v-for="option in fertilizerLandTypeOptions" :key="option.value" class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
                    <span class="text-[13px]">{{ option.value === 'normal' ? '黄' : option.short }}</span>
                    <BaseSelect
                      :model-value="landFertilizerStrategies[option.value]"
                      :options="fertilizerOptions"
                      :aria-label="option.label + '施肥策略'"
                      @change="setLandFertilizerStrategy(option.value, $event)"
                    />
                  </div>
                </div>
                <div v-if="hasRipeningStrategy" class="flex flex-wrap items-end gap-2 rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-900/20">
                  <BaseInput
                    v-model.number="auto.fertilizer_smart_seconds"
                    label="快成熟判定秒数"
                    type="number"
                    min="30"
                    max="3600"
                    class="w-40"
                  />
                  <span class="pb-2 settings-note">
                    使用临熟策略的土地共用此阈值（默认 300 秒）
                  </span>
                </div>
              </section>

              <section
                v-if="auto.fertilizer_buy_organic || auto.fertilizer_buy_normal"
                class="settings-group space-y-2"
              >
                <div class="settings-group__title">
                  自动补肥参数
                </div>
                <div v-for="row in activeFertilizerBuyRows" :key="row.enabled" class="space-y-2">
                  <div class="settings-note">{{ row.label }}</div>
                  <div class="grid grid-cols-3 gap-2">
                    <BaseInput v-model.number="automation[row.count]" label="购买数量" type="number" min="1" max="10000" :aria-label="`${row.label}购买数量`" />
                    <BaseInput v-model.number="automation[row.threshold]" label="触发阈值 (小时)" type="number" min="1" max="990" :aria-label="`${row.label}触发阈值 (小时)`" />
                    <BaseInput v-model.number="automation[row.interval]" label="检测间隔 (分钟)" type="number" min="1" max="1440" :aria-label="`${row.label}检测间隔 (分钟)`" />
                  </div>
                </div>
              </section>
            </div>

            <div v-else-if="activeModule === 'ranchFacilities'" class="space-y-3">
              <section class="settings-group space-y-2">
                <h4 class="settings-group__title">设施维护</h4>
                <div class="grid grid-cols-2 gap-2">
                  <BaseSwitch v-model="auto.ranch_upgrade" label="自动升级建筑（金券）" />
                  <BaseSwitch v-model="auto.ranch_clean" label="自动清理自家牧场" />
                </div>
              </section>
              <section class="settings-group space-y-2">
                <h4 class="settings-group__title">牧草</h4>
                <div class="grid grid-cols-2 gap-2">
                  <BaseSwitch v-model="auto.ranch_grass" label="自动补充牧草" />
                  <BaseSwitch v-model="auto.ranch_grass_buy" label="库存不足时购买（金券）" :disabled="!auto.ranch_grass" />
                </div>
                <div class="flex items-center gap-2">
                  <BaseInput v-model.number="auto.ranch_grass_threshold_percent" label="补充牧草阈值" type="number" min="1" max="100" step="1" inline-label aria-label="补充牧草阈值（%）" :disabled="!auto.ranch_grass" />
                  <span class="settings-note" aria-hidden="true">%</span>
                </div>
              </section>
              <section class="settings-group space-y-2">
                <h4 class="settings-group__title">罐头</h4>
                <BaseSwitch v-model="auto.ranch_fill_cans" label="自动填充库存罐头" />
                <div class="space-y-2">
                  <div v-for="can in ranchCanTypes" :key="can.enabled" class="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2">
                    <span class="text-[13px]">{{ can.label }}</span>
                    <BaseSelect
                      :model-value="auto[can.enabled] ? auto[can.stage] ?? can.defaultStage : 'none'"
                      :options="ranchFeedStages"
                      :aria-label="can.label + '喂养策略'"
                      @change="setRanchFeedStage(can, $event)"
                    />
                  </div>
                </div>
              </section>
            </div>

            <!-- ========== 好友 ========== -->
            <div v-else-if="activeModule === 'friends'" class="space-y-3">
              <section class="settings-group space-y-2">
                <div class="settings-group__title">
                  互动行为
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <template v-for="action in friendActions" :key="action.key">
                    <BaseSelect
                      v-if="friendStates[action.key] === 'mixed'"
                      :label="action.label"
                      model-value="mixed"
                      :options="sharedFriendOptions"
                      @update:model-value="setSharedFriendChoice(action.key, $event)"
                    />
                    <BaseSwitch
                      v-else
                      :label="action.label"
                      :model-value="friendStates[action.key] === true"
                      @update:model-value="setSharedFriendAction(action.key, $event === true, auto)"
                    />
                  </template>
                  <BaseSwitch v-model="auto.ranch_stroke" label="自动抚摸" />
                  <BaseSwitch v-model="auto.ranch_friend_produce" label="自动帮忙生产" />
                </div>
                <div v-if="auto.friend_help" class="grid grid-cols-2 gap-2">
                  <BaseSwitch v-model="auto.friend_help_exp_limit" label="农场经验满不帮忙" />
                  <BaseSwitch v-if="auto.friend_help_exp_limit" v-model="auto.friend_help_protect_dog_ignore_exp_limit" label="护主犬经验满仍帮忙" />
                </div>
                <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <BaseSwitch v-model="auto.friend_auto_accept" label="自动通过好友申请" />
                  <BaseInput
                    v-if="auto.friend_auto_accept"
                    v-model.number="automation.autoAcceptFriendMinLevel"
                    label="最低等级"
                    type="number"
                    min="0"
                    max="200"
                    inline-label
                  />
                  <BaseSwitch
                    v-if="auto.friend_auto_accept"
                    v-model="automation.autoAcceptRequireOwnLevel"
                    label="不低于自己等级"
                  />
                </div>
                <div class="grid grid-cols-2 items-center gap-2">
                  <BaseSelect
                    v-if="friendStates.steal === 'mixed'"
                    label="自动偷取"
                    model-value="mixed"
                    :options="sharedFriendOptions"
                    @update:model-value="setSharedFriendChoice('steal', $event)"
                  />
                  <BaseSwitch
                    v-else
                    label="自动偷取"
                    :model-value="friendStates.steal"
                    @update:model-value="setSharedFriendAction('steal', $event === true, auto)"
                  />
                  <BaseInput
                    v-if="friendStates.steal === true"
                    v-model.number="strategy.stealDelaySeconds"
                    label="偷取延迟（秒）"
                    type="number"
                    min="0"
                    max="300"
                    inline-label
                  />
                </div>
              </section>

              <PatrolIntervalFields v-model:minimum="strategy.intervals.friendMin" v-model:maximum="strategy.intervals.friendMax" title="农牧场好友巡查间隔(秒)" />
              <section class="settings-group space-y-2">
                <div class="settings-group__title">
                  农牧场好友静默时段
                </div>
                <div class="flex flex-wrap items-center gap-4">
                  <BaseSwitch v-model="strategy.friendQuietHours.enabled" label="启用静默时段" />
                  <div class="flex items-center gap-2">
                    <NTimePicker
                      v-model:formatted-value="strategy.friendQuietHours.start"
                      class="w-28"
                      format="HH:mm"
                      value-format="HH:mm"
                      :clearable="false"
                      :disabled="!strategy.friendQuietHours.enabled"
                      size="small"
                    />
                    <span class="settings-note">-</span>
                    <NTimePicker
                      v-model:formatted-value="strategy.friendQuietHours.end"
                      class="w-28"
                      format="HH:mm"
                      value-format="HH:mm"
                      :clearable="false"
                      :disabled="!strategy.friendQuietHours.enabled"
                      size="small"
                    />
                  </div>
                  <div class="friend-quiet-continue">
                    <BaseSwitch
                      v-model="strategy.friendQuietHours.continueFarm"
                      label="静默时继续农场巡查"
                      :disabled="!strategy.friendQuietHours.enabled"
                    />
                  </div>
                </div>
                <p class="settings-note">静默期间暂停两边的好友巡查与互动，好友申请仍按上方开关处理。</p>
              </section>
            </div>

            <!-- ========== 日常与活动 ========== -->
            <div v-else class="space-y-3">
              <section class="settings-group space-y-2">
                <h4 class="settings-group__title">农场日常任务</h4>
                <div class="grid grid-cols-2 gap-2">
                  <BaseSwitch v-model="auto.task" label="自动领取任务奖励" />
                  <BaseSwitch v-model="auto.farm_email_rewards" label="自动领取邮箱奖励" />
                  <BaseSwitch v-model="auto.farm_daily_share" label="每日分享礼包" />
                  <BaseSwitch v-model="auto.farm_month_card_gift" label="每日月卡礼包" />
                  <BaseSwitch v-model="auto.farm_vip_gift" label="每日会员礼包" />
                  <BaseSwitch v-model="auto.farm_illustrated" label="自动领取图鉴奖励" />
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <BaseSwitch v-model="auto.farm_free_gifts" label="每日商城免费礼包" aria-label="农场每日商城免费礼包" />
                  <BaseSwitch v-model="auto.mall_coupon_gift_buy" label="自动购买点券限时礼包" aria-label="自动购买农场点券限时礼包" />
                </div>
                <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <BaseSwitch v-model="auto.mystery_shop_auto_buy" label="神秘商人自动购买" />
                  <BaseSelect
                    v-if="auto.mystery_shop_auto_buy"
                    v-model="mysteryShopCurrency"
                    class="w-40"
                    placeholder="请选择货币"
                    :options="mysteryCurrencyOptions"
                  />
                </div>
                <p v-if="auto.mystery_shop_auto_buy && mysteryShopCurrency === 'diamond'" class="settings-note">
                  钻石属于付费货币，自动购买可能消耗充值余额。
                </p>
              </section>

              <section class="settings-group space-y-2">
                <h4 class="settings-group__title">牧场日常任务</h4>
                <div class="grid grid-cols-2 gap-2">
                  <BaseSwitch v-model="auto.ranch_task" label="自动领取任务奖励" />
                  <BaseSwitch v-model="auto.ranch_illustrated" label="自动领取图鉴奖励" />
                  <BaseSwitch v-model="auto.ranch_share" label="每日分享礼包" />
                  <BaseSwitch v-model="auto.ranch_market_organic_poop" label="集市：粑粑兑换有机化肥" />
                  <BaseSwitch v-model="auto.ranch_market_organic_pinecone" label="集市：松果兑换有机化肥" />
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <BaseSwitch v-model="auto.ranch_daily_benefit" label="每日商城免费礼包" aria-label="牧场每日商城免费礼包" />
                  <BaseSwitch v-model="auto.ranch_coupon_gift_buy" label="自动购买点券限时礼包" aria-label="自动购买牧场点券限时礼包" />
                </div>
              </section>

              <ActivitySettingsButtons v-model="automation.automation" :account-id="accountId" :connected="connected" />
            </div>
          </fieldset>

          <footer class="settings-dialog__footer flex justify-end gap-2 border-t">
            <BaseButton size="sm" :loading="saving" @click="finish">
              保存
            </BaseButton>
            <BaseButton variant="secondary" size="sm" :disabled="saving" @click="cancel">
              取消
            </BaseButton>
          </footer>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.friend-quiet-continue :deep(.base-switch__label:disabled) {
  background: transparent !important;
}

/* 容器宽度而不是视口宽度决定列数：窄区域一行 2 个，够宽则一行 4 个，卡片宽度自适应。 */
.feature-grid-wrap {
  container-type: inline-size;
}

.feature-grid {
  display: grid;
  align-items: start;
  gap: var(--ui-settings-space);
  /* 列宽由区域自身决定：卡片至少 220px，按可用宽度自动排 1～N 列，
     不再用固定两列把正文顶出横向滚动。 */
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
}

/* 描边对齐「商城」物品卡的深色那一档，并且永远停在这档：不再有 hover 深浅变化。
   底色用不透明的 --ui-surface-solid：商城卡在页面底色上需要半透的 --ui-surface，
   而这里卡在已经铺白的面板里，沿用半透就会多出一层灰。也不画投影。 */
.feature-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 30%, var(--ui-border));
  border-radius: var(--ui-radius-card);
  padding: var(--ui-settings-space);
  background: var(--ui-surface-solid);
}

/* 4 列阈值仍按 1000px 切（用户要求其他不变），列宽下限收到 220px 后
   实际每张卡仍有 (1000 - 36) / 4 = 241px，不会碰线。 */
@container (min-width: 1000px) {
  .feature-grid {
    grid-template-columns: repeat(4, minmax(220px, 1fr));
  }
}
</style>
