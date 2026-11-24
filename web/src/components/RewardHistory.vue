<script setup lang="ts">
import { NModal } from 'naive-ui/es/modal'
import { storeToRefs } from 'pinia'
import { ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAccountStore } from '@/stores/account'
import { formatNumber, formatRewardAmount } from '@/utils/format-number'

const { currentAccountId } = storeToRefs(useAccountStore())
const showHistory = ref(false)
const historyLoading = ref(false)
const historyError = ref(false)
const history = ref<Array<{ id: string, key: string, name?: string, claimedAt: number, rewards: Array<{ id: number, image: string, name: string, count: number }> }>>([])
let historyRequest = 0
const historyTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' })

watch(currentAccountId, () => {
  historyRequest++
  showHistory.value = false
  history.value = []
})

async function openHistory() {
  const accountId = currentAccountId.value
  if (!accountId) return
  const request = ++historyRequest
  showHistory.value = true
  historyLoading.value = true
  historyError.value = false
  try {
    const { data } = await api.get('/api/farm-reward-history', { headers: { 'x-account-id': accountId } })
    if (request !== historyRequest) return
    if (!data.ok || !Array.isArray(data.data)) throw new Error('领取记录读取失败')
    history.value = data.data
  }
  catch {
    if (request === historyRequest) historyError.value = true
  }
  finally {
    if (request === historyRequest) historyLoading.value = false
  }
}
</script>

<template>
          <BaseButton variant="secondary" :disabled="!currentAccountId" @click="openHistory">
            领取记录
          </BaseButton>
    <NModal v-model:show="showHistory">
      <section class="reward-history page-card-surface" role="dialog" aria-modal="true" aria-label="领取记录">
        <header class="reward-history__titlebar panel-titlebar panel-titlebar--flush">
          <div class="reward-history__header">
            <h2>领取记录</h2>
            <BaseButton variant="ghost" aria-label="关闭领取记录" @click="showHistory = false">
              <span class="i-carbon-close" aria-hidden="true" />
            </BaseButton>
          </div>
        </header>
        <p v-if="historyLoading" class="reward-history__message">正在读取领取记录…</p>
        <p v-else-if="historyError" class="reward-history__message">领取记录读取失败</p>
        <p v-else-if="!history.length" class="reward-history__message reward-history__message--empty">暂无领取记录</p>
        <ul v-else class="reward-history__list panel-list list-divider">
          <li v-for="entry in history" :key="entry.id">
            <div class="reward-history__row">
              <span :class="entry.key === 'daily_share' ? 'i-carbon-share' : 'i-carbon-gift'" aria-hidden="true" />
              <span>{{ entry.key.startsWith('ranch_') ? '牧场 · ' : '农场 · ' }}{{ entry.name || (entry.key === 'daily_share' ? '分享礼包' : '商城免费礼包') }}</span>
              <span v-if="entry.rewards.length" class="reward-history__items">
                <span v-for="(item, index) in entry.rewards" :key="`${item.id}-${index}`" class="reward-history__item" :title="`${item.name} ×${formatNumber(item.count)}`">
                  <img v-if="item.image" :src="item.image" alt="" width="18" height="18">
                  {{ item.name }} ×{{ formatRewardAmount(item.id, item.count) }}
                </span>
              </span>
              <span v-else>回包未提供明细</span>
              <time :datetime="new Date(entry.claimedAt).toISOString()">{{ historyTime.format(entry.claimedAt) }}</time>
            </div>
          </li>
        </ul>
      </section>
    </NModal>
</template>

<style scoped>
.reward-history {
  display: flex;
  flex-direction: column;
  width: min(640px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  overflow: hidden;
  font-size: var(--ui-font-size-small-13);
}
.reward-history__titlebar {
  position: static;
  flex: none;
}
.reward-history__list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.reward-history__header,
.reward-history__row {
  display: flex;
  align-items: center;
  gap: 8px 12px;
  margin: 8px 12px;
  width: 100%;
}
.reward-history__row {
  width: auto;
  flex-wrap: wrap;
}
.reward-history__header { justify-content: space-between; }
.reward-history__message {
  margin: 12px;
}
.reward-history__message--empty {
  text-align: center;
}
.reward-history__items,
.reward-history__item { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.reward-history__row time { margin-inline-start: auto; color: var(--ui-muted); }

</style>
