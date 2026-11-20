<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { NButton } from 'naive-ui/es/button'
import { NCard } from 'naive-ui/es/card'
import { NModal } from 'naive-ui/es/modal'
import { NTab } from 'naive-ui/es/tabs'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import CommerceItemImage from '@/components/commerce/CommerceItemImage.vue'
import PageTabs from '@/components/PageTabs.vue'
import OfflineState from '@/components/ui/OfflineState.vue'
import RefreshButton from '@/components/ui/RefreshButton.vue'
import { useAccountPresence, useReconnectRefresh } from '@/composables/useReconnectRefresh'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'

const { currentAccountId, currentAccount } = storeToRefs(useAccountStore())
const running = computed(() => !!currentAccount.value?.running)
const presence = useAccountPresence()
const isOffline = computed(() => presence.value === 'offline')
const toast = useToastStore()
/** 与 core/src/activity-data/solar-calendar.json 的 seasons 保持一致；离线首次进入页面时撑起页签栏。 */
const FALLBACK_SEASONS = [
  { id: 2, name: '第二季度' },
  { id: 3, name: '第三季度' },
  { id: 4, name: '第四季度' },
]
const calendarData = ref<any>(null)
const lastSeasons = ref<{ id: number, name: string }[]>([])
const busy = ref(false)
const error = ref('')
const seasonId = ref(0)
const questionId = ref(0)
const answer = ref<number | null>(null)
const receivedAt = ref(Date.now())
const tick = ref(Date.now())
let sequence = 0
let refreshedBoundary = 0
useIntervalFn(() => tick.value = Date.now(), 1000)
const now = computed(() => Number(calendarData.value?.serverTime || 0) + (tick.value - receivedAt.value) / 1000)
const season = computed(() => calendarData.value?.seasons.find((v: any) => v.id === seasonId.value))
// 页签栏与数据解耦：在线用服务器季度，离线沿用最近一次的季度，从未拿到过则用静态兜底
const seasonTabs = computed<{ id: number, name: string }[]>(() => {
  if (calendarData.value?.seasons?.length)
    return calendarData.value.seasons
  return lastSeasons.value.length ? lastSeasons.value : FALLBACK_SEASONS
})
function ensureSeasonSelected() {
  if (!seasonTabs.value.some(v => v.id === seasonId.value))
    seasonId.value = seasonTabs.value[seasonTabs.value.length - 1]?.id || 0
}
const events = computed<any[]>(() => (calendarData.value?.events || []).filter((v: any) => !season.value || season.value.eventIds.includes(v.id)))
const question = computed(() => calendarData.value?.events.find((v: any) => v.id === questionId.value))
const nextBoundary = computed(() => {
  const snapshotTime = Number(calendarData.value?.serverTime || 0)
  const times = (calendarData.value?.events || []).flatMap((event: any) => [event.startTime, event.endTime + 1])
  if (calendarData.value?.events.some((event: any) => event.quizWrongToday))
    times.push((Math.floor((snapshotTime + 28800) / 86400) + 1) * 86400 - 28800)
  return Math.min(...times.filter((time: number) => time > snapshotTime))
})
const dayFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai' })
// 撕页日历：开始日期的月、日，以及结束日（同月只写日）
function leaf(event: any) {
  const part = (value: number) => {
    const parts = dayFormat.formatToParts(new Date(value * 1000))
    return { month: parts.find(v => v.type === 'month')?.value || '', day: parts.find(v => v.type === 'day')?.value || '' }
  }
  const start = part(event.startTime)
  const end = part(event.endTime)
  return { month: `${start.month}月`, day: start.day, until: end.month === start.month ? `至 ${end.day}日` : `至 ${end.month}月${end.day}日` }
}
// 描述首行是农历日期，其余是节令诗句
function lunarOf(event: any) {
  const first = String(event.description || '').split('\n')[0] || ''
  return first.startsWith('农历') ? first : ''
}
function poemOf(event: any) {
  const lines = String(event.description || '').split('\n').filter(Boolean)
  return lunarOf(event) ? lines.slice(1) : lines
}
function distance(seconds: number) {
  return seconds >= 86400 ? `${Math.ceil(seconds / 86400)}天` : seconds >= 3600 ? `${Math.ceil(seconds / 3600)}小时` : `${Math.max(1, Math.ceil(seconds / 60))}分钟`
}
function phase(event: any) {
  if (event.directClaimed && (!event.question || event.quizClaimed))
    return 'done'
  if (now.value > event.endTime || event.status === 3)
    return 'expired'
  return now.value < event.startTime ? 'upcoming' : 'open'
}
function phaseText(event: any) {
  const current = phase(event)
  if (current === 'done')
    return '已完成'
  if (current === 'expired')
    return '已结束'
  if (current === 'upcoming')
    return `${distance(Math.ceil(event.startTime - now.value))}后开始`
  return `进行中 · 剩 ${distance(Math.ceil(event.endTime - now.value))}`
}
// "A.敬老节" 拆成字母标和选项文字
function optionParts(option: string, index: number | string) {
  const match = /^([A-Z])[.．、](.*)$/.exec(option)
  return match ? { letter: match[1], text: (match[2] || '').trim() } : { letter: String.fromCharCode(65 + Number(index)), text: option }
}
function stateText(event: any, quiz = false) {
  if (quiz ? event.quizClaimed : event.directClaimed)
    return '已领取'
  if (now.value > event.endTime || event.status === 3)
    return '已过期'
  const seconds = Math.ceil(event.startTime - now.value)
  if (seconds > 0)
    return `${distance(seconds)}后${quiz ? '开启' : '可领取'}`
  return quiz ? event.quizWrongToday ? '明日再来' : '答题' : '领取'
}
function available(event: any, quiz = false) {
  return running.value && !isOffline.value && !busy.value && (quiz ? event.canAnswer : event.canClaim) && now.value >= event.startTime && now.value <= event.endTime
}
function openQuestion(event: any) {
  answer.value = null
  questionId.value = event.id
}
async function request(action = '', input: any = {}) {
  if (!currentAccountId.value || !running.value || isOffline.value || busy.value)
    return
  const revision = ++sequence
  busy.value = true
  error.value = ''
  try {
    const options = { headers: { 'x-account-id': currentAccountId.value }, skipErrorToast: true } as any
    const response = action ? await api.post(`/api/solar-calendar/${action}`, input, options) : await api.get('/api/solar-calendar', options)
    if (revision !== sequence)
      return
    if (!response.data?.ok)
      throw new Error(getApiErrorMessage(response.data, '节令日历请求失败'))
    const result = response.data.data
    if (action) {
      questionId.value = 0
      const text = result.rewards?.map((v: any) => `${v.name} ×${v.count}`).join('、') || (action === 'answer' && !result.correct ? '明日再来' : '领取成功')
      if (result.refreshRequired)
        toast.warning(`${text}。请刷新确认最新进度`)
      else toast.success(text)
    }
    calendarData.value = action ? result.calendar : result
    if (calendarData.value?.seasons?.length)
      lastSeasons.value = calendarData.value.seasons.map((v: any) => ({ id: v.id, name: v.name }))
    receivedAt.value = Date.now()
    tick.value = receivedAt.value
    if (!calendarData.value?.seasons.some((v: any) => v.id === seasonId.value)) {
      const target = calendarData.value?.events.find((v: any) => !v.directClaimed && v.endTime >= now.value)?.id || calendarData.value?.defaultEventId
      seasonId.value = calendarData.value?.seasons.find((v: any) => v.eventIds.includes(target))?.id || calendarData.value?.seasons.at(-1)?.id || 0
    }
  }
  catch (cause) {
    if (revision === sequence) {
      error.value = getApiErrorMessage(cause, '节令日历请求失败')
      if (action) {
        if (!isOffline.value)
          toast.error(error.value)
        calendarData.value = null
        questionId.value = 0
      }
      if (!calendarData.value)
        ensureSeasonSelected()
    }
  }
  finally {
    if (revision === sequence)
      busy.value = false
  }
}
const manualRefreshing = ref(false)
/** 与商城刷新键同规则：只有手动点击才转圈，边界时刻的自动刷新不碰按钮图标。 */
async function manualRefresh() {
  manualRefreshing.value = true
  try {
    await request()
  }
  finally {
    manualRefreshing.value = false
  }
}
watch([now, busy], () => {
  const boundary = nextBoundary.value
  if (running.value && !isOffline.value && !busy.value && now.value >= boundary && refreshedBoundary !== boundary) {
    refreshedBoundary = boundary
    void request()
  }
})
watch([currentAccountId, running], (value, previous) => {
  const accountChanged = !previous || value[0] !== previous[0]
  sequence++
  calendarData.value = null
  busy.value = false
  questionId.value = 0
  answer.value = null
  // 仅切换账号时重置页签；同一账号上下线保持当前季度不变
  if (accountChanged) {
    seasonId.value = 0
    lastSeasons.value = []
  }
  if (!running.value || isOffline.value)
    ensureSeasonSelected()
  error.value = ''
  refreshedBoundary = 0
  void request()
}, { immediate: true, flush: 'sync' })
watch(isOffline, (offline) => {
  if (offline) {
    questionId.value = 0
    ensureSeasonSelected()
  }
})
// 重新上线时按一次刷新键
useReconnectRefresh(manualRefresh)
onUnmounted(() => sequence++)
</script>

<template>
  <div class="solar">
    <PageTabs v-model:value="seasonId" class="solar-tabs">
      <NTab v-for="entry in seasonTabs" :key="entry.id" :name="entry.id" :disabled="busy">
        {{ entry.name }}
      </NTab>
    </PageTabs>

    <div v-if="!currentAccountId" class="solar-empty">
      <span class="i-carbon-calendar" />
      <strong>请先选择账号</strong>
      <small>节令进度按当前账号读取</small>
    </div>
    <div v-else-if="!isOffline && (error || !calendarData)" class="solar-empty">
      <span :class="busy ? 'i-carbon-renew animate-spin' : 'i-carbon-calendar'" />
      <strong>{{ error || (busy ? '正在读取节令日历' : '暂未获取到节令日历') }}</strong>
      <RefreshButton
        class="solar-refresh"
        :loading="manualRefreshing"
        :disabled="busy"
        @click="manualRefresh"
      />
    </div>

    <section v-if="currentAccountId && (isOffline || calendarData)" class="solar-panel page-card-surface rounded-2xl panel-scroll-layout">
      <header v-if="isOffline || season" class="panel-titlebar panel-titlebar--flush" aria-label="季度进度">
        <div v-if="isOffline" class="season-bar__progress">
          <strong>{{ seasonTabs.find(entry => entry.id === seasonId)?.name }}</strong>
        </div>
        <div v-else-if="season" class="season-bar__progress">
          <strong>{{ season.name }}已点亮</strong>
          <span class="season-dots" aria-hidden="true">
            <i v-for="index in season.totalCount" :key="index" :class="{ lit: index <= season.litCount }" />
          </span>
          <b>{{ season.litCount }}/{{ season.totalCount }}</b>
        </div>
        <RefreshButton
          class="solar-refresh"
          :loading="manualRefreshing"
          :disabled="isOffline || busy"
          @click="manualRefresh"
        />
      </header>

      <div v-if="isOffline" class="panel-scroll-body solar-content">
        <OfflineState />
      </div>
      <div v-else class="panel-scroll-body solar-content">
        <div v-if="season?.rewards.length" class="season-reward">
        <span class="line-label">集齐奖励</span>
        <span class="chips">
          <span v-for="item in season.rewards" :key="item.id" class="chip" :title="`${item.name} ×${item.count}`"><CommerceItemImage :src="item.image" :alt="item.name" size="sm" /><b>{{ item.count }}</b></span>
        </span>
        <NButton size="small" :type="season.canClaim ? 'primary' : 'default'" :disabled="busy || !season.canClaim" @click="request('season', { id: season.id })">
          {{ season.claimed ? '已领取' : season.canClaim ? '领取' : '集齐后可领' }}
        </NButton>
      </div>

      <ol class="term-list panel-list" aria-label="节令列表">
        <li v-for="event in events" :key="event.id" class="term" :class="`term--${phase(event)}`">
          <div class="date-leaf" aria-hidden="true">
            <span class="date-leaf__month">{{ leaf(event).month }}</span>
            <b class="date-leaf__day">{{ leaf(event).day }}</b>
            <span class="date-leaf__until">{{ leaf(event).until }}</span>
          </div>

          <div class="term__body">
            <div class="term__title">
              <h3>{{ event.name }}</h3>
              <span v-if="lunarOf(event)" class="term__lunar">{{ lunarOf(event) }}</span>
              <span class="term__badge">{{ phaseText(event) }}</span>
            </div>
            <p v-if="poemOf(event).length" class="term__poem">
              <span v-for="line in poemOf(event)" :key="line">{{ line }}</span>
            </p>
          </div>

          <div class="term__rewards">
            <div class="reward-line">
              <span class="line-label">节令奖励</span>
              <span class="chips">
                <span v-for="item in event.rewards" :key="item.id" class="chip" :title="`${item.name} ×${item.count}`"><CommerceItemImage :src="item.image" :alt="item.name" size="sm" /><b>{{ item.count }}</b></span>
              </span>
              <NButton size="small" :type="available(event) ? 'primary' : 'default'" :disabled="!available(event)" @click="request('claim', { id: event.id })">
                {{ stateText(event) }}
              </NButton>
            </div>
            <div v-if="event.question" class="reward-line">
              <span class="line-label">答题奖励</span>
              <span class="chips">
                <span v-for="item in event.questionRewards" :key="item.id" class="chip" :title="`${item.name} ×${item.count}`"><CommerceItemImage :src="item.image" :alt="item.name" size="sm" /><b>{{ item.count }}</b></span>
              </span>
              <NButton size="small" :type="available(event, true) ? 'primary' : 'default'" secondary :disabled="!available(event, true)" @click="openQuestion(event)">
                {{ stateText(event, true) }}
              </NButton>
            </div>
            <p v-if="event.quizWrongToday && event.errorTips" class="term__tips">
              <span class="i-carbon-information" />{{ event.errorTips }}
            </p>
          </div>
        </li>
      </ol>
      </div>

    </section>

    <NModal v-if="!isOffline && question" :show="true" :mask-closable="!busy" :close-on-esc="!busy" @update:show="!busy && (questionId = 0)">
      <NCard :title="`${question.name} · 节令问答`" :closable="!busy" class="solar-question" role="dialog" aria-modal="true" :aria-label="question.name" @close="questionId = 0">
        <div class="question-scroll">
          <p class="question-text">
            {{ question.question }}
          </p>
          <div class="answer-options" role="radiogroup" aria-label="答案">
            <label
              v-for="(option, index) in question.options"
              :key="index"
              :class="{ selected: answer === index, correct: question.answerIndex === index, wrong: question.wrongOptions.includes(index) }"
            >
              <input v-model="answer" type="radio" name="solar-answer" :value="index" :disabled="busy || question.wrongOptions.includes(index)">
              <b class="answer-options__letter">{{ optionParts(option, index).letter }}</b>
              <span class="answer-options__text">{{ optionParts(option, index).text }}</span>
              <small v-if="question.answerIndex === index" class="answer-options__correct">正确答案</small>
              <small v-else-if="question.wrongOptions.includes(index)">已答错</small>
            </label>
          </div>
        </div>
        <template #footer>
          <NButton block type="primary" :loading="busy" :disabled="answer === null || !available(question, true)" @click="request('answer', { id: question.id, optionIndex: answer, expectedQuestion: question.question })">
            提交答案
          </NButton>
        </template>
      </NCard>
    </NModal>
  </div>
</template>

<style scoped>
.solar {
  --seal: #c0533f;
  --seal-soft: #fbece8;
  --serif: 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', SimSun, serif;
  /* 整页最小宽度由全局布局兜底；内容随侧栏切换占满可用空间，不再叠加整页宽度。 */
  width: 100%;
  min-width: 0;
  color: var(--ui-ink);
  container-type: inline-size;
}

/* 页头 */
.solar-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
  padding: 56px 20px;
  border: 1px dashed var(--ui-border-strong);
  border-radius: var(--ui-radius-card);
  color: var(--ui-muted);
  text-align: center;
}
.solar-empty > span {
  font-size: 32px;
  opacity: 0.6;
}
.solar-empty strong {
  color: var(--ui-ink);
  font-size: 15px;
}

/* 季节面板：与账号管理同构的 page-card-surface，内部靠分隔线而不是卡片堆叠。
   裁切溢出改用 clip：只裁出血的节令列表贴合卡片圆角、不形成滚动容器，
   不会把标题栏的吸顶困死在面板内（同 BookToolbar .book-card 的做法）。
   宽度横向拉伸占满可用宽度（width: 100%），消除卡片右侧空白；
   最小内容宽度由全局两档布局保证，面板不再用固有宽度撑破页面右侧留白。
   奖励行按钮靠右、诗句→标签固定 50px，拉伸余量落在图标与按钮之间。 */
.solar-panel {
  overflow: clip;
  width: 100%;
  min-width: 0;
  padding: 0;
}
.solar-content {
  --term-inset: 12px;
  padding: 0;
}
.season-bar__progress {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
}
.season-bar__progress b {
  color: var(--ui-primary);
  font-variant-numeric: tabular-nums;
}
.season-dots {
  display: flex;
  gap: 6px;
}
.season-dots i {
  width: 12px;
  height: 12px;
  border: 1.5px solid var(--ui-border-strong);
  border-radius: 50%;
  background: transparent;
}
.season-dots i.lit {
  border-color: var(--seal);
  background: var(--seal);
}
.season-reward {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: var(--term-inset);
  border-bottom: 1px solid var(--ui-border);
}

/* 刷新键：走全局 .panel-refresh 模板（primary 实底 + 图标 + 文案），靠右对齐 */
.solar-refresh {
  margin-left: auto;
}

/* 行背景和分隔线铺满内容栏，日历图标沿用模板自带的 12px 外边距。 */
.term-list {
  display: grid;
  /* 以当前列表容纳所有内容所需的最小高度统一各行。 */
  grid-auto-rows: 1fr;
  background: var(--ui-surface);
}
.term {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  grid-template-rows: max-content auto;
  box-sizing: border-box;
  padding-inline-end: var(--term-inset);
  padding-block-end: var(--term-inset);
}
.term + .term {
  box-shadow: inset 0 1px var(--ui-border);
}
.term--open {
  background: var(--seal-soft);
}

/* 撕页日历：基础外观（尺寸/12px 外边距/苹方与衬线字体）统一走全局 .date-leaf 模板（style.css），
   这里只保留节令各阶段的语义配色。 */
.term--open .date-leaf__month {
  background: var(--seal);
}
.term--upcoming .date-leaf__month {
  background: #9aa79e;
}
.term--done .date-leaf__month {
  background: var(--ui-primary-fill);
}
.term--expired .date-leaf__month {
  background: #b6bab5;
}
.term--expired .date-leaf__day {
  color: var(--ui-subtle);
}

/* 节令内容 */
/* 文案列收窄到「刚好放下全部文字」的宽度：max-content 让标题三项
   （节令名 + 农历 + 状态）不被列宽挤到折行；max-width 兼底，
   内容真的比格子宽时（极窄容器）仍然换行，不顶出网格。 */
.term__body {
  width: max-content;
  max-width: 100%;
  min-width: 0;
  align-self: center;
}
.term__title {
  display: flex;
  flex-wrap: wrap;
  /* 农历与状态胶囊随标题文字垂直居中（原来按基线对齐，小字号会偏上） */
  align-items: center;
  gap: 4px 12px;
}
.term__title h3 {
  margin: 0;
  font-family: var(--serif);
  font-size: 22px;
  font-weight: var(--fw-700);
  letter-spacing: 0.08em;
}
.term__lunar {
  color: var(--ui-muted);
  font-size: 13px;
}
.term__badge {
  padding: 1px 9px;
  border-radius: 999px;
  color: var(--ui-muted);
  background: var(--ui-bg-soft);
  font-size: 12px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.term--open .term__badge {
  color: var(--seal);
  background: var(--seal-soft);
  font-weight: var(--fw-600);
}
.term--upcoming .term__badge {
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
}
.term--done .term__badge {
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}
.term__poem {
  display: flex;
  /* 诗句整句不换行：每句一行展示，句与句也不折到下一行 */
  flex-wrap: nowrap;
  gap: 0 18px;
  margin: 8px 0 0;
  color: var(--ui-muted);
  font-family: var(--serif);
  font-size: 14px;
  line-height: 1.8;
}
.term__poem span {
  white-space: nowrap;
}
.term--expired .term__poem,
.term--done .term__poem {
  color: var(--ui-muted);
}

/* 奖励 */
.term__rewards {
  grid-column: 1 / -1;
  display: grid;
  align-content: start;
  gap: 8px;
  margin-inline-start: var(--term-inset);
}
.reward-line {
  display: grid;
  /* 三栏「标签 | 奖励图标 | 按钮」：前两栏按内容宽，按钮列 minmax(150px, 1fr)
     吸收面板横向拉伸的余量并把按钮推到右缘。这样诗句→标签间距固定 50px
     （正文 margin-right）、按钮距内容栏右缘 12px，拉伸余量只落在图标与按钮之间，
     不会拉开诗句与「节令奖励」标签。150px = 按钮 100px + 最小间距 50px。 */
  grid-template-columns: max-content max-content minmax(150px, 1fr);
  align-items: center;
  gap: 0;
}
.line-label {
  color: var(--ui-muted);
  font-size: 13px;
  white-space: nowrap;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  min-width: 0;
  /* 奖励图标紧贴「节令奖励」标签 */
  margin-left: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.chip :deep(.item-image) {
  width: 30px;
  height: 30px;
  border-radius: 7px;
}
.reward-line :deep(.n-button) {
  /* 钉死最后一列并靠右：按钮列是 minmax(150px, 1fr)，拉伸余量落在图标与按钮之间，
     按钮始终贴齐列右缘，不会被拉伸成整行宽。 */
  grid-column: 3;
  justify-self: end;
  /* 保持按钮 100px 与图标间距至少 50px（150 - 100）。定宽按钮不再叠加
     Naive 的水平内边距，让「23小时后可领取」完整居中，不缩小字号或按钮。 */
  width: 100px;
  min-width: 100px;
  padding-inline: 0;
}
.term__tips {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
  font-size: 13px;
  line-height: 1.6;
}
.term__tips span {
  flex: none;
  margin-top: 3px;
}

/* 宽屏：节令是按时间排列的序列，保持单列时间线。
   每行「日历页 | 节令内容 | 奖励」三栏统一垂直居中。
   列间距全部归零，改由各元素自己的 margin 控制：
   日历→文本 12px、文本→奖励 50px、奖励图标→按钮 ≥50px（随拉伸增大）。
   阈值 760px 低于页面最小内容宽 780px，保证三栏布局在所有支持宽度下始终生效。 */
@container (min-width: 760px) {
  .term {
    /* 日历列使用图标宽度加左右外边距；正文列 max-content（min-width 284px 兜底对齐）；
       奖励列 minmax(0, 1fr) 吸收面板拉伸余量，配合奖励行按钮靠右，
       使诗句→标签固定 50px、按钮距右缘 12px。 */
    grid-template-columns: max-content max-content minmax(0, 1fr);
    grid-template-rows: auto;
    align-items: center;
    padding-block-end: 0;
  }
  .date-leaf {
    align-self: center;
  }
  /* 诗句一律不换行：正文列取 max-content 并保留 284px 下限
     （一局诗句两段并排：126 + 18 + 140），无诗句的行奖励起点不漂移；
     与奖励列的 50px 间距改由正文自身 margin-right 承担。 */
  .term__body {
    width: max-content;
    max-width: none;
    min-width: 284px;
    margin-right: 50px;
  }
  .term__rewards {
    grid-column: auto;
    align-self: center;
    margin-inline-start: 0;
  }
  /* 奖励栏用全局的 max-content 三栏即可，无需在此重复覆盖。 */
}

/* 问答弹窗 */
.solar-question {
  display: flex;
  flex-direction: column;
  width: min(520px, calc(100vw - 24px));
  max-height: calc(100dvh - 32px);
  border-radius: 12px;
}
.solar-question :deep(.n-card-content) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.solar-question :deep(.n-card-header),
.solar-question :deep(.n-card__footer) {
  flex-shrink: 0;
}
.question-text {
  margin: 0;
  color: var(--ui-ink);
  font-size: 16px;
  font-weight: var(--fw-600);
  line-height: 1.7;
}
.answer-options {
  display: grid;
  gap: 10px;
  margin-top: 16px;
}
.answer-options label {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--ui-border-strong);
  border-radius: 10px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}
.answer-options label:hover {
  border-color: color-mix(in srgb, var(--ui-primary) 45%, transparent);
}
.answer-options input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.answer-options__letter {
  width: 26px;
  height: 26px;
  display: grid;
  flex: none;
  place-items: center;
  border: 1.5px solid var(--ui-border-strong);
  border-radius: 50%;
  color: var(--ui-muted);
  font-size: 13px;
}
.answer-options label.selected {
  border-color: var(--ui-primary);
  background: var(--ui-primary-soft);
}
.answer-options label.correct {
  border-color: color-mix(in srgb, var(--ui-primary) 60%, var(--ui-border-strong));
}
.answer-options__text {
  min-width: 0;
  overflow-wrap: anywhere;
}
.answer-options label.selected .answer-options__letter {
  border-color: var(--ui-primary);
  color: #fff;
  background: var(--ui-primary-fill);
}
.answer-options label:has(input:focus-visible) {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}
.answer-options label.wrong {
  color: var(--ui-subtle);
  cursor: not-allowed;
}
.answer-options label.wrong span {
  text-decoration: line-through;
}
.answer-options label small {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--ui-danger);
  font-size: 12px;
}
.answer-options label .answer-options__correct {
  padding: 2px 6px;
  border-radius: 4px;
  color: color-mix(in srgb, var(--ui-primary) 60%, var(--ui-ink));
  background: var(--ui-primary-soft);
  font-weight: var(--fw-600);
  white-space: nowrap;
}

/* 深色：印章红与日历页眉降低亮度，淡色背景改为半透明。 */
.dark .solar {
  --seal: #d4705e;
  --seal-soft: rgba(212, 112, 94, 0.14);
}
.dark .term--open .date-leaf__month {
  background: #b5503f;
}
.dark .term--upcoming .date-leaf__month {
  background: #4b535c;
}
.dark .term--expired .date-leaf__month {
  background: #3a4048;
}
.dark .term--expired .date-leaf__day {
  color: var(--ui-subtle);
}
</style>
