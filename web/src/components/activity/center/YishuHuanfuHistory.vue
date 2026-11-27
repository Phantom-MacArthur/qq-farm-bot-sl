<script setup lang="ts">
import type { YishuHuanfuFriendShopDto } from '@/stores/activity-center'
import type { YishuHistory } from './yishu-huanfu-details'
import { computed } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { yishuTime } from './yishu-huanfu-details'

const props = defineProps<{ history: YishuHistory | null, busy: boolean, ownGid?: string, shops: YishuHuanfuFriendShopDto[] }>()
const emit = defineEmits<{ date: [date: string], resolve: [orderId: string] }>()
const entries = computed(() => props.history?.entries.filter(entry => entry.type === 'harvest' || entry.type === 'sale') ?? [])
const shopNames = computed(() => new Map(props.shops.map(shop => [shop.gid, shop.name])))

function recipient(targetGid?: string, targetName?: string) {
  if (targetName)
    return targetName
  if (targetGid && targetGid === props.ownGid)
    return '自家铺子'
  return (targetGid && (shopNames.value.get(targetGid) || `GID ${targetGid}`)) || '未知铺子'
}
</script>

<template>
  <div v-if="history" class="activity-log-toolbar margin-shell">
    <div class="margin-content">
      <label class="activity-log-date">
        日期
        <select :value="history.day" :disabled="busy" @change="emit('date', ($event.target as HTMLSelectElement).value)">
          <option v-for="day in history.days" :key="day" :value="day">{{ day }}</option>
        </select>
      </label>
      <div v-if="history.pendingOrder?.orderId" class="activity-log-pending" role="status">
        <span>有一笔出售待核对，请检查游戏库存和到账。</span>
        <BaseButton size="sm" variant="outline" :disabled="busy" @click="emit('resolve', history.pendingOrder.orderId)">我已核对</BaseButton>
      </div>
    </div>
  </div>
  <ul v-if="entries.length" class="activity-log-list panel-list list-divider">
    <li v-for="(entry, index) in entries" :key="`${entry.at}-${index}`" class="activity-log-row margin-shell">
      <div class="margin-content">
        <time>{{ yishuTime(entry.at) }}</time>
        <span v-if="entry.type === 'harvest'">收获 {{ entry.count }} 块红薯</span>
        <span v-else>出售 {{ entry.count }} 个蜜薯给 {{ recipient(entry.targetGid, entry.targetName) }}</span>
      </div>
    </li>
  </ul>
  <p v-else class="activity-log-empty">{{ busy ? '正在读取活动日志…' : '当日暂无收获或出售记录。' }}</p>
</template>

<style scoped>
.activity-log-toolbar,
.panel-list > .activity-log-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
  --inset-top: 8px;
  --inset-right: 16px;
  --inset-bottom: 8px;
  --inset-left: 16px;
}

.activity-log-toolbar {
  border-bottom: 1px solid var(--ui-border);
}

.activity-log-list {
  font-size: inherit;
}

.activity-log-date,
.activity-log-pending {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.activity-log-date,
.activity-log-empty,
.activity-log-row time {
  color: var(--ui-muted);
}

.activity-log-date select {
  padding: 4px 8px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-control);
  background: var(--ui-surface-soft);
  color: var(--ui-ink);
}

.activity-log-pending {
  color: var(--ui-warning);
}

.activity-log-row time {
  flex: none;
  font-variant-numeric: tabular-nums;
}

.activity-log-empty {
  margin: 12px 16px;
}
</style>
