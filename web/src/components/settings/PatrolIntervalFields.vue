<script setup lang="ts">
import BaseInput from '@/components/ui/BaseInput.vue'

defineProps<{ title: string }>()
const minimum = defineModel<number>('minimum')
const maximum = defineModel<number>('maximum')
</script>

<template>
  <section class="settings-group space-y-2">
    <h4 class="settings-group__title">{{ title }}</h4>
    <div class="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
      <span class="whitespace-nowrap">巡查间隔</span>
      <BaseInput v-model.number="minimum" type="number" min="1" :aria-label="`${title}最小值`" />
      <span aria-hidden="true">-</span>
      <BaseInput v-model.number="maximum" type="number" min="1" :aria-label="`${title}最大值`" />
    </div>
  </section>
</template>
