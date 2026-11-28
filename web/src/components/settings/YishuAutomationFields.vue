<script setup lang="ts">
import { NTimePicker } from 'naive-ui/es/time-picker'
import { useId } from 'vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { YISHU_ACTIVITY_OPTIONS, YISHU_SELL_MODES } from '@/utils/account-feature-modules'

const settings = defineModel<Record<string, any>>({ required: true })
const scanLimitNoteId = useId()
const startTimeId = useId()
</script>

<template>
  <div class="yishu-fields">
    <section class="yishu-field-group">
      <h3><span class="i-carbon-task" aria-hidden="true" />每日任务</h3>
      <div class="yishu-field-switches">
        <BaseSwitch
          v-for="option in YISHU_ACTIVITY_OPTIONS"
          :key="option.key"
          v-model="settings[option.key]"
          :label="option.label"
          :aria-label="option.label"
        />
      </div>
      <p v-if="settings.yishu_plant" class="yishu-field-note">
        <span class="i-carbon-information" aria-hidden="true" />
        <span>优先种在预计能于当天 23:30 前成熟的空地。</span>
      </p>
    </section>
    <section class="yishu-field-group">
      <h3><span class="i-carbon-store" aria-hidden="true" />比价与出售</h3>
      <BaseSelect v-model="settings.yishu_sell_mode" label="卖薯模式" :options="[...YISHU_SELL_MODES]" />
      <template v-if="settings.yishu_sell_mode !== 'off'">
        <div class="yishu-field-numbers">
          <BaseInput
            v-model.number="settings.yishu_scan_friend_limit"
            label="每批查价上限"
            type="number"
            :min="1"
            :max="200"
            :input-props="{ 'aria-label': '每批查价上限', 'aria-describedby': scanLimitNoteId, 'inputmode': 'numeric' }"
          />
          <BaseInput v-if="settings.yishu_sell_mode !== 'manual'" v-model.number="settings.yishu_scan_interval_minutes" label="比价间隔（分钟）" type="number" :min="5" :max="720" />
          <BaseInput v-if="settings.yishu_sell_mode === 'auto'" v-model.number="settings.yishu_sell_min_count" label="起卖数量" type="number" :min="1" :max="10000" />
          <div v-if="settings.yishu_sell_mode === 'auto'" class="base-field">
            <label :id="startTimeId" class="base-field__label">最早出售时间</label>
            <NTimePicker
              v-model:formatted-value="settings.yishu_sell_after_time"
              format="HH:mm"
              value-format="HH:mm"
              :clearable="false"
              :is-minute-disabled="(minute, hour) => hour === 23 && minute >= 55"
              :aria-labelledby="startTimeId"
            />
          </div>
          <BaseInput
            v-if="settings.yishu_sell_mode === 'auto'"
            v-model.number="settings.yishu_sell_min_price"
            label="最低收购报价"
            type="number"
            :min="0"
            :max="Number.MAX_SAFE_INTEGER"
            :precision="0"
            :input-props="{ 'aria-label': '最低收购报价', 'inputmode': 'numeric' }"
          />
        </div>
        <p :id="scanLimitNoteId" class="yishu-field-note">
          <span class="i-carbon-information" aria-hidden="true" />
          <span v-if="settings.yishu_sell_mode === 'manual'">在活动页点击「开始询价」后，每 3 秒查一家，每轮最多查询设定的家数。</span>
          <span v-else>后台每 10 秒查一家，每轮最多查询设定的家数。报价按当天累积，手动比价每 3 秒刷新一家零基础价或零加成的铺子。</span>
        </p>
        <template v-if="settings.yishu_sell_mode === 'auto'">
          <p class="yishu-field-note">
            <span class="i-carbon-time" aria-hidden="true" />
            <span>从设定的北京时间起每半小时检查一次。自家和其他铺子按达到最低报价的价格顺序出售，23:55 停发新单。</span>
          </p>
        </template>
      </template>
    </section>
  </div>
</template>

<style scoped>
.yishu-fields {
  display: grid;
  gap: 12px;
}

.yishu-field-group {
  display: grid;
  min-width: 0;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--ui-border-strong);
  border-radius: 12px;
  background: var(--ui-surface-solid);
}

.yishu-field-group h3 {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  color: var(--ui-ink);
  font-size: 14px;
  font-weight: var(--fw-650, 650);
}

.yishu-field-group h3 span,
.yishu-field-note > span:first-child {
  color: var(--ui-primary);
}

.yishu-field-switches,
.yishu-field-numbers {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(145px, 100%), 1fr));
  gap: 8px;
}

.yishu-field-switches {
  grid-template-columns: repeat(auto-fit, minmax(min(190px, 100%), 1fr));
}

.yishu-fields :deep(.base-switch) {
  min-height: 38px;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--ui-surface-soft);
}

.yishu-fields :deep(.base-switch__label) {
  order: -1;
  text-align: start;
}

.yishu-field-note {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0;
  color: var(--ui-muted);
  font-size: 12px;
  line-height: 1.5;
}

.yishu-field-note > span:first-child {
  flex: none;
}
</style>
