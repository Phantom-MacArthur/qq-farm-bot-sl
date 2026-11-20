<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatNumber } from '@/utils/format-number'

const props = withDefaults(defineProps<{
  dailyGifts: any
  /** 账号平台；微信账号不展示 QQ 会员等 QQ 专属任务。 */
  platform?: string
}>(), { platform: '' })

type StatusTone = 'done' | 'claimable' | 'progress' | 'pending' | 'off' | 'error'

interface TaskRow {
  key: string
  label: string
  icon: string
  desc: string
  rewards: any[]
  rewardHint: string
  status: string
  tone: StatusTone
  error?: string
}

const ROW_ICONS: Record<string, string> = {
  task_claim: 'i-carbon-task-complete',
  email_rewards: 'i-carbon-email',
  mall_free_gifts: 'i-carbon-shopping-bag',
  daily_share: 'i-carbon-share',
  vip_daily_gift: 'i-carbon-star',
  month_card_gift: 'i-carbon-calendar',
}

const DEFAULT_DESC: Record<string, string> = {
  email_rewards: '自动领取邮件附件',
  mall_free_gifts: '商城每日免费礼包',
  daily_share: '每日分享奖励',
  vip_daily_gift: 'QQ 会员每日礼包',
  month_card_gift: '月卡每日奖励',
}

// 只在 QQ 平台存在的任务，微信账号不展示。
const QQ_ONLY_KEYS = new Set(['vip_daily_gift'])

const STATUS_ICONS: Record<StatusTone, string> = {
  done: 'i-carbon-checkmark',
  claimable: 'i-carbon-gift',
  progress: 'i-carbon-time',
  pending: 'i-carbon-time',
  off: 'i-carbon-subtract',
  error: 'i-carbon-warning-alt',
}

function formatTime(timestamp: number) {
  if (!timestamp)
    return ''
  const d = new Date(timestamp)
  const timeZone = props.dailyGifts?.timeZone
  if (timeZone) {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d)
  }
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function growthRow(growth: any): TaskRow {
  const task = growth.currentTask || growth.tasks?.[0] || null
  const base = { key: 'growth_task', label: '成长任务', icon: 'i-carbon-growth', rewardHint: '—' }
  if (!task)
    return { ...base, desc: '成长任务已全部完成', rewards: [], status: '已完成', tone: 'done' }
  const progress = Number(task.progress) || 0
  const total = Number(task.totalProgress) || 0
  const desc = total ? `${task.desc} · ${Math.min(progress, total)}/${total}` : task.desc
  const rewards = task.rewards || []
  if (task.isClaimed)
    return { ...base, desc, rewards, status: '已领取', tone: 'done' }
  if (task.isCompleted)
    return { ...base, desc, rewards, status: '待领取', tone: 'claimable' }
  return { ...base, desc, rewards, status: '进行中', tone: 'progress' }
}

function dailyTaskStatus(gift: any): Pick<TaskRow, 'status' | 'tone'> {
  const total = Number(gift.totalCount) || 3
  if (Number(gift.claimedCount) >= total)
    return { status: '已领取', tone: 'done' }
  if (Number(gift.claimableCount) > 0)
    return { status: '待领取', tone: 'claimable' }
  if (gift.doneToday)
    return { status: '已完成', tone: 'done' }
  return { status: '进行中', tone: 'progress' }
}

function giftStatus(gift: any): Pick<TaskRow, 'status' | 'tone'> {
  if (gift.result === 'error')
    return { status: gift.key === 'email_rewards' ? '检查失败' : '领取失败', tone: 'error' }
  if (gift.result === 'partial')
    return { status: '部分失败', tone: 'error' }
  switch (gift.key) {
    case 'email_rewards':
      if (gift.result === 'running')
        return { status: '检查中', tone: 'progress' }
      if (gift.doneToday)
        return gift.result === 'ok' ? { status: '已领取', tone: 'done' } : { status: '无可领取', tone: 'off' }
      return { status: '待检查', tone: 'pending' }
    case 'mall_free_gifts':
      if (gift.doneToday)
        return { status: gift.lastAt ? '已领取' : '已完成', tone: 'done' }
      return { status: '待领取', tone: 'pending' }
    case 'daily_share':
      if (gift.doneToday)
        return { status: '已领取', tone: 'done' }
      if (gift.checkStatus === 'entry_unavailable')
        return { status: '不可分享', tone: 'off' }
      if (gift.checkStatus === 'check_failed')
        return { status: '检测失败', tone: 'error' }
      return { status: '待领取', tone: 'pending' }
    case 'vip_daily_gift':
      if (gift.isVip === false || (gift.isVip == null && gift.hasGift === false))
        return { status: '未开通', tone: 'off' }
      if (gift.hasGift === false)
        return { status: '暂无礼包', tone: 'off' }
      if (gift.doneToday)
        return gift.result === 'ok' ? { status: '已领取', tone: 'done' } : { status: '无可领取', tone: 'off' }
      return { status: '待领取', tone: 'pending' }
    case 'month_card_gift':
      if (gift.doneToday)
        return { status: '已领取', tone: 'done' }
      if (gift.hasCard === false)
        return { status: '未开通', tone: 'off' }
      if (gift.hasClaimable === false)
        return { status: '无可领取', tone: 'off' }
      return { status: '待领取', tone: 'pending' }
  }
  if (gift.doneToday)
    return { status: '已完成', tone: 'done' }
  return { status: gift.enabled ? '待领取' : '未开启', tone: gift.enabled ? 'pending' : 'off' }
}

function giftDesc(gift: any) {
  if (gift.key === 'task_claim') {
    const parts = [`今日完成 ${Number(gift.completedCount) || 0}/${Number(gift.totalCount) || 3}`]
    if (Number(gift.claimedCount) > 0)
      parts.push(`已领 ${gift.claimedCount}`)
    if (!gift.enabled)
      parts.push('未开启自动领取')
    return parts.join(' · ')
  }
  if (gift.key === 'email_rewards') {
    if (gift.result === 'running')
      return '正在检查邮箱奖励…'
    if (gift.nextAt)
      return `下次自动检查 ${formatTime(Number(gift.nextAt))}`
  }
  if (gift.key === 'daily_share' && gift.checkStatus === 'entry_unavailable')
    return '分享入口暂不可用'
  if (gift.key === 'vip_daily_gift' && gift.isVip === false)
    return '未开通 QQ 会员'
  if (gift.key === 'month_card_gift' && !gift.doneToday) {
    if (gift.hasCard === false)
      return '未购买月卡或已过期'
    if (gift.hasClaimable === false)
      return '未开通月卡，或今日已在游戏内领取'
  }
  const ts = Number(gift.lastAt || 0)
  if (ts && gift.doneToday)
    return `${DEFAULT_DESC[gift.key] || ''} · ${formatTime(ts)}`
  return DEFAULT_DESC[gift.key] || ''
}

function giftRewardHint(gift: any) {
  if (gift.key === 'email_rewards')
    return '随邮件'
  if (gift.key === 'daily_share' || gift.key === 'mall_free_gifts')
    return gift.doneToday ? '—' : '领取后显示'
  return '—'
}

const rows = computed<TaskRow[]>(() => {
  const data = props.dailyGifts
  if (!data)
    return []
  const list: TaskRow[] = []
  if (data.growth)
    list.push(growthRow(data.growth))
  for (const gift of data.gifts || []) {
    if (props.platform === 'wx' && QQ_ONLY_KEYS.has(gift.key))
      continue
    const { status, tone } = gift.key === 'task_claim' ? dailyTaskStatus(gift) : giftStatus(gift)
    list.push({
      key: gift.key,
      label: gift.label,
      icon: ROW_ICONS[gift.key] || 'i-carbon-gift',
      desc: giftDesc(gift),
      rewards: Array.isArray(gift.rewards) ? gift.rewards : [],
      rewardHint: giftRewardHint(gift),
      status,
      tone,
      error: (gift.result === 'error' || gift.result === 'partial') ? gift.lastError || '' : '',
    })
  }
  return list
})

// 奖励图标加载失败时改用名称首字占位，不留破图。
const rewardImageErrors = ref<Record<number, boolean>>({})

function rewardTitle(reward: any) {
  return `${reward.extra ? '额外奖励：' : ''}${reward.name} ×${formatNumber(reward.count)}`
}
</script>

<template>
  <!-- 离线提示由 TaskPanel 负责；已登录但没取到数据时只留错误条，不再放占位 -->
  <ul v-if="rows.length" class="task-list panel-list list-divider" aria-label="每日礼包与任务列表">
    <li v-for="row in rows" :key="row.key" class="task-row" :class="`is-${row.tone}`">
      <span class="task-row__icon" aria-hidden="true"><span :class="row.icon" /></span>
      <div class="task-row__info">
        <strong class="task-row__name">{{ row.label }}</strong>
        <p v-if="row.desc" class="task-row__desc" :title="row.desc">
          {{ row.desc }}
        </p>
        <p v-if="row.error" class="task-row__error" :title="row.error">
          {{ row.error }}
        </p>
      </div>
      <div class="task-row__rewards">
        <span v-if="row.rewards.length" class="task-rewards" role="list" aria-label="奖励">
          <span
            v-for="(reward, rIdx) in row.rewards"
            :key="rIdx"
            class="task-reward"
            :class="{ 'task-reward--extra': reward.extra }"
            role="listitem"
            :title="rewardTitle(reward)"
            :aria-label="rewardTitle(reward)"
          >
            <img
              v-if="reward.image && !rewardImageErrors[reward.id]"
              class="task-reward__icon"
              :src="reward.image"
              alt=""
              loading="lazy"
              @error="rewardImageErrors[reward.id] = true"
            >
            <span v-else class="task-reward__icon task-reward__fallback" aria-hidden="true">{{ String(reward.name || '物').slice(0, 1) }}</span>
            <span aria-hidden="true">×{{ formatNumber(reward.count) }}</span>
          </span>
        </span>
        <span v-else class="task-row__no-reward">{{ row.rewardHint }}</span>
      </div>
      <span class="task-row__status" :class="`is-${row.tone}`">
        <span :class="STATUS_ICONS[row.tone]" aria-hidden="true" />{{ row.status }}
      </span>
    </li>
  </ul>
</template>

<style scoped>
.task-list {
  container: task-list / inline-size;
}

.task-row {
  display: grid;
  grid-template-areas: 'icon info rewards status';
  grid-template-columns: 40px minmax(0, 1fr) minmax(0, max-content) 92px;
  align-items: center;
  gap: 8px 14px;
  padding: 14px 18px;
}

.task-row:first-child {
  padding-block-start: 12px;
}

.task-row__icon {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  grid-area: icon;
  border-radius: 12px;
  color: var(--ui-muted);
  background: var(--ui-surface-soft);
  font-size: 20px;
}

.task-row.is-done .task-row__icon {
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

.task-row.is-claimable .task-row__icon {
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
}

.task-row.is-error .task-row__icon {
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
}

.task-row__info {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  grid-area: info;
}

.task-row__name {
  color: var(--ui-ink);
  font-size: 14px;
  font-weight: var(--fw-600);
}

.task-row__desc,
.task-row__error {
  margin: 0;
  overflow: hidden;
  color: var(--ui-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-row__error {
  color: var(--ui-danger);
}

.task-row__rewards {
  display: flex;
  min-width: 0;
  justify-content: flex-end;
  grid-area: rewards;
}

.task-row__no-reward {
  color: var(--ui-subtle);
  font-size: 12px;
}

/* 状态放最右，图标 + 文案，不只靠颜色区分 */
.task-row__status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  justify-self: end;
  gap: 4px;
  min-width: 76px;
  height: 26px;
  padding: 0 10px;
  grid-area: status;
  border-radius: 999px;
  color: var(--ui-muted);
  background: var(--ui-surface-soft);
  font-size: 12px;
  font-weight: var(--fw-600);
  white-space: nowrap;
}

.task-row__status.is-done {
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

.task-row__status.is-claimable {
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
}

.task-row__status.is-progress {
  color: var(--ui-ink);
}

.task-row__status.is-off {
  color: var(--ui-subtle);
}

.task-row__status.is-error {
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
}

/* 奖励：图标 + 数量，多项横排；额外奖励用虚线描边区分。 */
.task-rewards {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.task-reward {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 26px;
  padding: 0 8px 0 4px;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  color: var(--ui-ink);
  background: var(--ui-surface-soft);
  font-size: 12px;
  font-weight: var(--fw-600);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.task-reward--extra {
  border-style: dashed;
  border-color: var(--ui-warning);
}

.task-reward__icon {
  width: 20px;
  height: 20px;
  flex: none;
  object-fit: contain;
}

.task-reward__fallback {
  display: grid;
  place-items: center;
  border-radius: 999px;
  color: var(--ui-muted);
  background: var(--ui-surface-solid);
  font-size: 11px;
}

/* 窄屏：奖励换到名称下方，状态仍在右侧 */
@container task-list (max-width: 560px) {
  .task-row {
    grid-template-areas:
      'icon info    status'
      '.    rewards rewards';
    grid-template-columns: 40px minmax(0, 1fr) auto;
    padding-inline: 16px;
  }

  .task-row__rewards,
  .task-rewards {
    justify-content: flex-start;
  }

  /* 没有奖励时不单独占一行 */
  .task-row__rewards:has(.task-row__no-reward) {
    display: none;
  }
}
</style>
