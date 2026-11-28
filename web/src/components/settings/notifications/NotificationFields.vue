<script setup lang="ts">
import type { OfflineConfig } from '@/stores/setting'
import { NCheckbox, NCheckboxGroup } from 'naive-ui/es/checkbox'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { FARM_ACTIVITY_OPTIONS } from '@/stores/setting'

defineProps<{ disabled?: boolean }>()

const rows = [
  { key: 'offline', label: '账号下线', placeholder: '账号下线' },
  { key: 'mysteryArrival', label: '神秘商店到访', placeholder: '神秘商人到访' },
  { key: 'mysteryPurchase', label: '神秘商店购买', placeholder: '神秘商人到访' },
] as const

type NotificationType = typeof rows[number]['key']
const types = defineModel<OfflineConfig['notificationTypes']>('types', { required: true })
const messages = defineModel<Record<NotificationType, string>>('messages', { required: true })
const farmActivityEvents = defineModel<OfflineConfig['farmActivityEvents']>('farmActivityEvents', { required: true })
const activityCheckboxTheme = { borderRadius: '3px', fontSizeSmall: 'var(--ui-font-size-small-13)' }
</script>

<template>
  <div class="notification-fields grid gap-2">
    <div v-for="row in rows" :key="row.key" class="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-3">
      <BaseSwitch v-model="types[row.key]" :label="row.label" :aria-label="row.label" :disabled="disabled" />
      <BaseInput
        :id="`notification-content-${row.key}`"
        :model-value="messages[row.key]"
        class="!max-w-none"
        label="内容"
        inline-label
        :aria-label="`${row.label}内容`"
        :placeholder="row.placeholder"
        :disabled="disabled"
        @update:model-value="messages = { ...messages, [row.key]: String($event ?? '') }"
      />
    </div>
    <div class="farm-activity-row grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-3">
      <BaseSwitch v-model="types.farmActivity" label="农牧场动态" aria-label="农牧场动态" :disabled="disabled" />
      <NCheckboxGroup
        class="farm-activity-options"
        :class="{ 'is-hidden': !types.farmActivity }"
        :value="farmActivityEvents"
        aria-label="农牧场动态类型"
        :aria-hidden="!types.farmActivity"
        :disabled="disabled || !types.farmActivity"
        @update:value="values => farmActivityEvents = FARM_ACTIVITY_OPTIONS.filter(option => values.includes(option.value)).map(option => option.value)"
      >
        <div class="flex flex-wrap gap-x-5 gap-y-2">
          <NCheckbox
            v-for="option in FARM_ACTIVITY_OPTIONS"
            :key="option.value"
            :value="option.value"
            size="small"
            :theme-overrides="activityCheckboxTheme"
          >
            {{ option.label }}
          </NCheckbox>
        </div>
      </NCheckboxGroup>
    </div>
  </div>
</template>

<style scoped>
.notification-fields {
  padding-inline: 4px;
  padding-block-end: 8px;
}

.farm-activity-row {
  min-height: var(--ui-content-item-control-height-30);
}

.farm-activity-options.is-hidden {
  visibility: hidden;
}

.farm-activity-options :deep(.n-checkbox__label) {
  color: var(--theme-text);
}

.dark .farm-activity-options :deep(.n-checkbox__label) {
  color: #fff;
}
</style>
