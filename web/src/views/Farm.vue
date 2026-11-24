<script setup lang="ts">
import { NTab } from 'naive-ui/es/tabs'
import { ref, watch } from 'vue'
import FarmBagPanel from '@/components/farm/FarmBagPanel.vue'
import FarmPanel from '@/components/farm/FarmPanel.vue'
import FarmTaskPanel from '@/components/farm/FarmTaskPanel.vue'
import PageTabs from '@/components/PageTabs.vue'

type FarmTab = 'farm' | 'bag' | 'task'

const currentTab = ref<FarmTab>('farm')

const tabPanels: Record<FarmTab, any> = {
  farm: FarmPanel,
  bag: FarmBagPanel,
  task: FarmTaskPanel,
}

const visitedTabs = ref<FarmTab[]>(['farm'])

watch(currentTab, (tab) => {
  if (!visitedTabs.value.includes(tab))
    visitedTabs.value.push(tab)
})
</script>

<template>
  <div class="page-stack flex flex-col">
    <PageTabs v-model:value="currentTab" animated>
      <NTab name="farm">
        <span class="inline-flex items-center gap-2"><span class="i-carbon-grid" />我的农场</span>
      </NTab>
      <NTab name="bag">
        <span class="inline-flex items-center gap-2"><span class="i-carbon-box" />农场背包</span>
      </NTab>
      <NTab name="task">
        <span class="inline-flex items-center gap-2"><span class="i-carbon-task" />农场奖励</span>
      </NTab>
    </PageTabs>

    <div class="min-w-0 panel-fill">
      <div v-for="tab in visitedTabs" v-show="tab === currentTab" :key="tab" class="panel-fill">
        <component :is="tabPanels[tab]" />
      </div>
    </div>
  </div>
</template>

<style scoped>
</style>
