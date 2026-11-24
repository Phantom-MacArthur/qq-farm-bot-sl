<script setup lang="ts">
import type { FeatureAutomationShape, FeatureModuleKey, FeatureStrategyShape } from '@/utils/account-feature-modules'
import { NTimePicker } from 'naive-ui/es/time-picker'
import { computed, ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { applyAllowedMysteryShopCurrency, applyModuleEnabled, FEATURE_MODULES, getAllowedMysteryShopCurrency, isModuleEnabled, MYSTERY_SHOP_CURRENCIES } from '@/utils/account-feature-modules'

defineProps<{
  currentAccountName: string | null
  loading: boolean
  saving: boolean
  fertilizerLandTypeOptions: Array<{ label: string, value: string }>
  fertilizerOptions: Array<{ label: string, value: string }>
}>()

const emit = defineEmits<{
  save: [module: FeatureModuleKey]
}>()

const strategy = defineModel<FeatureStrategyShape>('strategy', { required: true })
const automation = defineModel<FeatureAutomationShape>('automation', { required: true })

const activeModule = ref<FeatureModuleKey | null>(null)
const editSnapshot = ref<{ strategy: FeatureStrategyShape, automation: FeatureAutomationShape } | null>(null)

const moduleContext = computed(() => ({ strategy: strategy.value, automation: automation.value }))
const activeInfo = computed(() => FEATURE_MODULES.find(item => item.key === activeModule.value) || null)
const auto = computed(() => automation.value.automation)
const selectedLandCount = computed(() => Array.isArray(auto.value.fertilizer_land_types) ? auto.value.fertilizer_land_types.length : 0)

// 神秘商人货币：后端是四个独立布尔，下拉单选在这里双向映射
const mysteryCurrencyOptions = MYSTERY_SHOP_CURRENCIES.map(({ label, value }) => ({ label, value }))
const mysteryShopCurrency = computed({
  get: () => getAllowedMysteryShopCurrency(auto.value),
  set: (value: string | number) => applyAllowedMysteryShopCurrency(auto.value, String(value ?? '')),
})

// UnoCSS 会把 border-[var(--x)] 当成 border-width 而不是颜色，选中态改用内联样式。
const selectedLandStyle = {
  borderColor: 'var(--theme-primary)',
  background: 'color-mix(in srgb, var(--theme-primary) 10%, transparent)',
  boxShadow: '0 0 0 1px var(--theme-primary)',
}

function isLandSelected(value: string) {
  return Array.isArray(auto.value.fertilizer_land_types) && auto.value.fertilizer_land_types.includes(value)
}

function toggleLand(value: string) {
  const current = Array.isArray(auto.value.fertilizer_land_types) ? auto.value.fertilizer_land_types : []
  auto.value.fertilizer_land_types = current.includes(value)
    ? current.filter((item: string) => item !== value)
    : [...current, value]
}

function toggleModule(key: FeatureModuleKey, enabled: boolean) {
  applyModuleEnabled(key, enabled, moduleContext.value)
  emit('save', key)
}

function openModule(key: FeatureModuleKey) {
  // 弹窗内是草稿：取消要能整体回滚，包括父级槽位里改动的背包种子土地限制。
  editSnapshot.value = {
    strategy: JSON.parse(JSON.stringify(strategy.value)),
    automation: JSON.parse(JSON.stringify(automation.value)),
  }
  activeModule.value = key
}

function cancel() {
  if (editSnapshot.value) {
    strategy.value = editSnapshot.value.strategy
    automation.value = editSnapshot.value.automation
  }
  editSnapshot.value = null
  activeModule.value = null
}

function finish() {
  if (!activeModule.value)
    return
  emit('save', activeModule.value)
  editSnapshot.value = null
  activeModule.value = null
}
</script>

<template>
  <div class="space-y-4">
    <div v-if="loading" class="py-4 text-center text-gray-500">
      <span class="i-carbon-circle-dash mx-auto mb-2 inline-block animate-spin text-2xl" />
      <p>加载中...</p>
    </div>
    <div v-else-if="!strategy || !automation" class="py-8 text-center text-gray-500">
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
                <img :src="info.image" alt="" class="h-7 w-7 shrink-0 object-contain">
                <h4 class="truncate text-sm text-gray-900 font-semibold dark:text-gray-100">
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
              <span class="min-w-0 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <span class="h-2 w-2 shrink-0 rounded-full" :class="isModuleEnabled(info.key, moduleContext) ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'" />
                {{ isModuleEnabled(info.key, moduleContext) ? '已开启' : '已关闭' }}
              </span>
              <BaseButton variant="secondary" size="sm" @click="openModule(info.key)">
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
        class="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-gray-950/45 p-6 backdrop-blur-[2px]"
        @click.self="cancel"
      >
        <section
          class="h-[calc(55vh+100px)] max-w-[560px] w-full flex flex-col overflow-hidden border border-gray-200 rounded-lg bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800"
        >
          <header class="flex items-start justify-between gap-4 border-b border-gray-100 px-4 py-4 dark:border-gray-700">
            <div class="min-w-0 flex items-start gap-3">
              <img :src="activeInfo.image" alt="" class="h-11 w-11 shrink-0 rounded-lg bg-gray-100 object-contain p-1.5 dark:bg-gray-700">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="text-lg text-gray-900 font-semibold dark:text-gray-100">
                    {{ activeInfo.title }}
                  </h3>
                  <span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                    {{ isModuleEnabled(activeModule, moduleContext) ? '已开启' : '已关闭' }}
                  </span>
                </div>
              </div>
            </div>
            <button class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="关闭" @click="cancel">
              <span class="i-carbon-close text-xl" />
            </button>
          </header>

          <div class="modal-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <!-- ========== 种植与收获 ========== -->
            <div v-if="activeModule === 'planting'" class="space-y-4">
              <section class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  基础功能
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <BaseSwitch v-model="auto.farm" label="自动种植收获" />
                  <BaseSwitch v-model="auto.farm_harvest_tiangong" label="自动收获天工作物" />
                  <BaseSwitch v-model="auto.farm_push" label="推送触发巡田" />
                  <BaseSwitch v-model="auto.skip_own_weed_bug" label="巡田时跳过一键务农" />
                  <BaseSwitch v-model="auto.sell" label="自动卖果实" />
                  <BaseSwitch v-model="strategy.bagSeedMultiLandReservationEnabled" label="为高优先级多格种子预留土地" />
                </div>
              </section>

              <!-- 选种策略与背包种子优先顺序依赖账号实时数据，由页面提供 -->
              <section class="border border-gray-100 rounded-lg p-4 dark:border-gray-700">
                <slot name="planting-strategy" />
              </section>

              <section class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  巡田控制
                </div>
                <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <BaseInput v-model.number="strategy.intervals.farmMin" label="巡查最小 (秒)" type="number" min="1" inline-label />
                  <BaseInput v-model.number="strategy.intervals.farmMax" label="巡查最大 (秒)" type="number" min="1" inline-label />
                </div>
              </section>
            </div>

            <!-- ========== 土地与施肥 ========== -->
            <div v-else-if="activeModule === 'fertilizer'" class="space-y-4">
              <section class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  基础功能
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <BaseSwitch v-model="auto.land_upgrade" label="自动升级土地" />
                  <BaseSwitch v-model="auto.fertilizer_gift" label="自动填充化肥" />
                  <BaseSwitch v-model="auto.fertilizer_buy_organic" label="自动购买有机化肥" />
                  <BaseSwitch v-model="auto.fertilizer_buy_normal" label="自动购买无机化肥" />
                  <BaseSwitch v-model="auto.fertilizer_multi_season" label="多季补肥" />
                  <BaseSwitch v-model="auto.show_manual_fertilizer" label="显示手动施肥按钮" />
                </div>
              </section>

              <section class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div class="flex items-center justify-between gap-3">
                  <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                    施肥范围
                  </div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">
                    已选 {{ selectedLandCount }}/{{ fertilizerLandTypeOptions.length }}
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    v-for="option in fertilizerLandTypeOptions"
                    :key="option.value"
                    type="button"
                    class="min-h-[var(--ui-content-item-control-height-30)] flex items-center justify-between gap-3 border rounded-lg px-3 py-2 text-left text-sm transition"
                    :class="isLandSelected(option.value)
                      ? 'text-gray-900 font-medium dark:text-gray-100'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:bg-gray-700/60'"
                    :style="isLandSelected(option.value) ? selectedLandStyle : undefined"
                    :aria-pressed="isLandSelected(option.value)"
                    @click="toggleLand(option.value)"
                  >
                    <span class="truncate font-medium">{{ option.label }}</span>
                    <span
                      class="grid h-5 w-5 shrink-0 place-items-center border rounded-full text-xs transition"
                      :class="isLandSelected(option.value)
                        ? 'border-transparent text-white'
                        : 'border-gray-300 text-transparent dark:border-gray-600'"
                      :style="isLandSelected(option.value) ? { background: 'var(--theme-primary)' } : undefined"
                    >
                      <span class="i-carbon-checkmark text-sm" />
                    </span>
                  </button>
                </div>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  仅对选中土地类型的地块执行施肥策略。
                </p>
              </section>

              <section class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  施肥策略
                </div>
                <BaseSelect v-model="auto.fertilizer" label="施肥策略" :options="fertilizerOptions" />
                <div v-if="auto.fertilizer === 'smart'" class="flex flex-wrap items-end gap-3 rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-900/20">
                  <BaseInput
                    v-model.number="auto.fertilizer_smart_seconds"
                    label="快成熟判定秒数"
                    type="number"
                    min="30"
                    max="3600"
                    class="w-40"
                  />
                  <span class="pb-2 text-xs text-gray-500 dark:text-gray-400">
                    距离成熟时间 ≤ 此秒数时施有机肥（默认 300 秒）
                  </span>
                </div>
              </section>

              <section
                v-if="auto.fertilizer_buy_organic || auto.fertilizer_buy_normal"
                class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700"
              >
                <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  自动补肥参数
                </div>
                <div v-if="auto.fertilizer_buy_organic" class="text-xs text-gray-500 dark:text-gray-400">
                  有机化肥
                </div>
                <div v-if="auto.fertilizer_buy_organic" class="grid grid-cols-2 gap-3">
                  <BaseInput v-model.number="automation.fertilizerBuyOrganicCount" label="购买数量" type="number" min="1" max="10000" />
                  <BaseInput v-model.number="automation.fertilizerBuyOrganicThresholdHours" label="触发阈值 (小时)" type="number" min="1" max="990" />
                </div>
                <div v-if="auto.fertilizer_buy_normal" class="pt-1 text-xs text-gray-500 dark:text-gray-400">
                  无机化肥
                </div>
                <div v-if="auto.fertilizer_buy_normal" class="grid grid-cols-2 gap-3">
                  <BaseInput v-model.number="automation.fertilizerBuyNormalCount" label="购买数量" type="number" min="1" max="10000" />
                  <BaseInput v-model.number="automation.fertilizerBuyNormalThresholdHours" label="触发阈值 (小时)" type="number" min="1" max="990" />
                </div>
                <BaseInput v-model.number="automation.fertilizerBuyCheckIntervalMinutes" label="检测间隔 (分钟)" type="number" min="1" max="1440" />
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  系统会按检测间隔检查化肥余量，低于阈值时自动购买。两种化肥同时开启时优先购买有机化肥。
                </p>
              </section>
            </div>

            <!-- ========== 好友 ========== -->
            <div v-else-if="activeModule === 'friends'" class="space-y-4">
              <section class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  互动行为
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <BaseSwitch v-model="auto.friend_help" label="自动帮忙" />
                  <BaseSwitch v-model="auto.friend_bad" label="自动捣乱" />
                  <BaseSwitch v-model="auto.friend_help_exp_limit" label="经验满不帮忙" />
                  <BaseSwitch v-model="auto.friend_help_protect_dog_ignore_exp_limit" label="护主犬经验满仍帮忙" />
                </div>
              </section>

              <section class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  偷菜
                </div>
                <!-- 延迟条件跟在开关右侧同一行，只在开启时出现，与「好友申请」一致 -->
                <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <BaseSwitch v-model="auto.friend_steal" label="自动偷菜" />
                  <BaseInput
                    v-if="auto.friend_steal"
                    v-model.number="strategy.stealDelaySeconds"
                    label="偷菜延迟 (秒)"
                    type="number"
                    min="0"
                    max="300"
                    inline-label
                  />
                </div>
                <p v-if="auto.friend_steal" class="text-xs text-gray-500 dark:text-gray-400">
                  偷菜延迟指进入好友农场后等待多久再执行采摘，0 表示不额外等待。
                </p>
                <p
                  v-if="auto.friend_steal && !auto.friend"
                  class="border border-amber-200 rounded-lg bg-amber-50/70 p-3 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/10 dark:text-amber-300"
                >
                  偷菜跟着好友互动一起执行，当前好友互动总开关已关闭，偷菜不会执行。
                </p>
              </section>

              <section class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  好友申请
                </div>
                <!-- 等级条件跟在开关右侧同一行，不再另起一行，弹窗高度不会因此变化 -->
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
                <p v-if="auto.friend_auto_accept" class="text-xs text-gray-500 dark:text-gray-400">
                  最低等级设为 0 表示不限制固定等级；开启等级条件时需同时满足所有条件。
                </p>
              </section>

              <section class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  好友任务节奏与静默时段
                </div>
                <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <BaseInput v-model.number="strategy.intervals.friendMin" label="好友任务最小 (秒)" type="number" min="1" inline-label />
                  <BaseInput v-model.number="strategy.intervals.friendMax" label="好友任务最大 (秒)" type="number" min="1" inline-label />
                </div>
                <div class="flex flex-wrap items-center gap-4 border-t pt-3 dark:border-gray-700">
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
                    <span class="text-xs text-gray-500">-</span>
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
                  <BaseSwitch
                    v-model="strategy.friendQuietHours.continueFarm"
                    label="静默时继续农场巡查"
                    :disabled="!strategy.friendQuietHours.enabled"
                  />
                </div>
              </section>
            </div>

            <!-- ========== 日常与活动 ========== -->
            <div v-else class="space-y-4">
              <section class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  日常任务
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <BaseSwitch v-model="auto.task" label="自动做任务" />
                </div>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  邮箱奖励默认自动领取：上线、刷新 code 后立即检查，之后周期轮询，无需开关。
                </p>
              </section>

              <section class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  神秘商人
                </div>
                <!-- 货币下拉只在打开自动购买后出现在其右侧；关闭时不展示也不占用行高 -->
                <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <BaseSwitch v-model="auto.mystery_shop_auto_buy" label="自动购买" />
                  <BaseSelect
                    v-if="auto.mystery_shop_auto_buy"
                    v-model="mysteryShopCurrency"
                    class="w-40"
                    placeholder="请选择货币"
                    :options="mysteryCurrencyOptions"
                  />
                </div>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  自动购买按所选货币的标价筛选商品并检查余额；钻石属于付费货币，选中后可能消耗真实充值余额。
                </p>
              </section>

              <section class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  点券限时礼包
                </div>
                <BaseSwitch v-model="auto.mall_coupon_gift_buy" label="自动购买点券礼包" />
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  仅在商品在售、未过促销结束时间时购买，会校验点券余额与限购余量；余额不足会自动跳过并记录日志。
                </p>
              </section>
            </div>
          </div>

          <footer class="flex justify-end gap-2 border-t bg-gray-50/70 px-4 py-4 dark:border-gray-700 dark:bg-gray-900/20">
            <BaseButton variant="secondary" size="sm" :disabled="saving" @click="cancel">
              取消
            </BaseButton>
            <BaseButton size="sm" :loading="saving" @click="finish">
              保存并关闭
            </BaseButton>
          </footer>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* 容器宽度而不是视口宽度决定列数：窄区域一行 2 个，够宽则一行 4 个，卡片宽度自适应。 */
.feature-grid-wrap {
  container-type: inline-size;
}

.feature-grid {
  display: grid;
  gap: 12px;
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
  padding: 12px;
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
