<script setup lang="ts">
import { useAccountStore } from '@/stores/account'
import RefreshButton from './RefreshButton.vue'

defineProps<{
  title?: string
}>()

const accountStore = useAccountStore()
</script>

<template>
  <div class="offline-state">
    <span class="offline-state__badge" aria-hidden="true">
      <span class="offline-state__icon i-carbon-connection-signal-off" />
    </span>
    <strong class="offline-state__title" role="status">{{ title ?? '账号未运行' }}</strong>
    <slot name="action">
      <RefreshButton
        label="重新加载账号信息"
        :loading="accountStore.bulkKind === 'start'"
        :disabled="accountStore.bulkRunning"
        @click="accountStore.startAllAccounts()"
      />
    </slot>
  </div>
</template>
