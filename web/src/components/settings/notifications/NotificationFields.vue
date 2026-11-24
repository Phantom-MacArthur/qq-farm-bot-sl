<script setup lang="ts">
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

defineProps<{ disabled?: boolean }>()

const rows = [
  { key: 'offline', label: '账号下线', placeholder: '账号下线' },
  { key: 'mysteryArrival', label: '神秘商店到访', placeholder: '神秘商人到访' },
  { key: 'mysteryPurchase', label: '神秘商店购买', placeholder: '神秘商人到访' },
] as const

type NotificationType = typeof rows[number]['key']
const types = defineModel<Record<NotificationType, boolean>>('types', { required: true })
const messages = defineModel<Record<NotificationType, string>>('messages', { required: true })
</script>

<template>
  <div class="grid gap-2">
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
  </div>
</template>
