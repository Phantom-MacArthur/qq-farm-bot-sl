import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
// This repository runs its tests with Node's built-in runner.
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const srcDir = new URL('../src/', import.meta.url)
const srcPath = fileURLToPath(srcDir)
const style = readFileSync(new URL('style.css', srcDir), 'utf8')

/**
 * 允许直接出现 renew 图标的文件：模板本身、状态图标和活动内的专用控件。
 * 想在这个列表外新增刷新按钮，请改用 components/ui/RefreshButton.vue，
 * 否则各页又会各写一套 gap / 圆角 / 转圈，改样式时漏改。
 */
const RENEW_ICON_EXCEPTIONS = new Map([
  ['components/ui/RefreshButton.vue', '刷新按钮模板本身'],
  ['components/activity/gameplays/qixi/QixiActivityView.vue', '七夕页主题内的行内图标键（刷新好友）'],
  ['components/activity/center/AutumnActivityPage.vue', '空状态里的文字链「重新加载」'],
  ['components/PanelStatusBanner.vue', '新版就绪时重新载入面板'],
  ['views/SolarCalendar.vue', '空状态里的加载中占位图标'],
])

function listVueFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules')
      return []
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir)
    return entry.isDirectory() ? listVueFiles(child) : entry.name.endsWith('.vue') ? [child] : []
  })
}

test('the refresh button format lives in the global stylesheet', () => {
  assert.match(style, /\.panel-refresh \{[\s\S]*?\}/, 'style.css 必须定义 .panel-refresh')
  assert.match(style, /--ui-toolbar-control-gap: 4px;/, '图标与文案间距令牌应为 4px')
  assert.match(style, /\.panel-refresh \.n-button__content \{[^}]*gap: var\(--ui-toolbar-control-gap\)/, '刷新键图标与文案间距应复用统一令牌')
  assert.match(style, /\.panel-refresh \.n-button__content \{[^}]*white-space: nowrap/, '文案不应换行')
  assert.match(style, /\.panel-refresh__label \{[^}]*white-space: nowrap/, '文案类必须禁止换行')
  // 收起文案的唯一开关：页面只改这个变量，几何一律由模板负责
  assert.match(style, /\.panel-refresh__label \{[^}]*display: var\(--refresh-label, inline\)/, '文案必须用 --refresh-label 切换显示，便于页面容器查询一行收起')
  assert.match(style, /\.panel-refresh__icon \{[^}]*font-size: calc\(var\(--n-icon-size/, '图标尺寸必须对齐 naive 的 --n-icon-size，否则会被 flex 压成非正方形')
})

test('the RefreshButton component consumes the global format instead of restyling it', () => {
  const component = readFileSync(new URL('components/ui/RefreshButton.vue', srcDir), 'utf8')
  assert.match(component, /class="panel-refresh"/, '组件必须挂全局 .panel-refresh')
  assert.match(component, /class="panel-refresh__label"/, '组件文案必须用全局 .panel-refresh__label')
  assert.match(component, /panel-refresh__icon/, '组件图标必须用全局 .panel-refresh__icon')
  assert.match(component, /type="primary"/, '刷新按钮统一为主色实底')
  // naive 给 #icon 插槽的图标挂了 6px margin-right，收起文案后图标右侧会多出一截死空间
  assert.doesNotMatch(component, /<template #icon>/, '图标不能走 naive 的 #icon 插槽，要放进默认插槽')
  // 组件自身不应该再写 scoped 样式：格式只有 style.css 一份
  assert.doesNotMatch(component, /<style/, '样式统一放 style.css，组件内不要再写 scoped 样式')
})

test('pages collapse the label through --refresh-label instead of restyling the button', () => {
  const offenders = []
  for (const file of listVueFiles(srcDir)) {
    const relative = path.relative(srcPath, fileURLToPath(file)).split(path.sep).join('/')
    const source = readFileSync(file, 'utf8')
    // 只能通过 --refresh-label 收起文案；重写宽度/内边距或直接 display: none 文案都会让图标左右不等距
    if (/\.panel-refresh__label[^{]*\{[^}]*display:\s*none/.test(source))
      offenders.push(`${relative}: 用 display: none 收起文案`)
    if (/\.panel-refresh\s*\{[^}]*width:/.test(source))
      offenders.push(`${relative}: 重写了刷新键宽度`)
  }
  assert.deepEqual(offenders, [], '收起刷新键文案请只用 { --refresh-label: none }')
})

test('every refresh button goes through the template', () => {
  const offenders = listVueFiles(srcDir)
    .map(file => fileURLToPath(file))
    .map(file => path.relative(srcPath, file).split(path.sep).join('/'))
    .filter(relative => !RENEW_ICON_EXCEPTIONS.has(relative))
    .filter(relative => /i-carbon-renew/.test(readFileSync(new URL(relative, srcDir), 'utf8')))
  assert.deepEqual(offenders, [], '这些文件绕过了 RefreshButton 模板，请改用 <RefreshButton>')
  const muge = readFileSync(new URL('components/activity/center/MugePage.vue', srcDir), 'utf8')
  assert.equal([...muge.matchAll(/<RefreshButton[^>]*title="刷新活动"[^>]*:disabled="busy \|\| !currentAccountId"[^>]*@click="refresh"/g)].length, 1)
  const update = readFileSync(new URL('components/PanelStatusBanner.vue', srcDir), 'utf8')
  assert.match(update, /@click="appUpdateStore\.applyPendingUpdate\(\)"[^]*?i-carbon-renew/)
})

test('好友三个页签复用全局标题栏，统计行高与标题栏控件一致', () => {
  const source = readFileSync(new URL('views/Friends.vue', srcDir), 'utf8')
  const headers = [...source.matchAll(/<header class="friends-head\b[\s\S]*?<\/header>/g)]
  assert.equal(headers.length, 1, '三个页签应共用一个标题栏，避免重复样式')
  const header = headers[0][0]
  assert.match(header, /class="friends-head panel-titlebar shrink-0\b[^"]*"/)
  assert.match(header, /activeTab === 'friends'/)
  assert.match(header, /activeTab === 'blacklist'/)
  assert.match(header, /activeTab === 'visitors'/)
  assert.match(source, /\.friends-head__summary\s*\{[^}]*min-height: var\(--ui-content-titlebar-control-height-34\);/)
  assert.match(source, /\.friends-head,\s*\.friends-toolbar\s*\{[^}]*flex-wrap: nowrap;/)
  assert.doesNotMatch(header, /icon-only/, '标题栏刷新按钮保留图标与文案')
})

test('访客筛选和刷新归入统一标题栏，保留原事件并防止不可用时发起刷新', () => {
  const source = readFileSync(new URL('views/Friends.vue', srcDir), 'utf8')
  const header = source.match(/<header class="friends-head\b[\s\S]*?<\/header>/)?.[0] || ''
  assert.match(header, /<BaseSelect\s+v-model="interactFilter"\s+:options="interactFilterOptions"/)
  assert.match(header, /<RefreshButton\s+title="刷新最近访客"/)
  assert.match(header, /:disabled="!currentAccountId \|\| !currentAccountRunning \|\| interactLoading"/)
  assert.match(header, /@click="refreshInteractRecords"/)
  assert.match(header, /<RefreshButton\s+title="刷新好友列表"[^>]*@click="refreshFriendsAndExpandedLands"/)
  assert.match(source, /async function refreshFriendsAndExpandedLands\(\)[^]*?await handleRefreshFriends\(\)[^]*?await refreshFriendLands\(gid\)/)
  assert.equal((source.match(/v-model="interactFilter"/g) || []).length, 1)
  assert.equal((header.match(/@click="refreshInteractRecords"/g) || []).length, 1)
  assert.match(source, /<OfflineState v-else-if="activeTab === 'visitors'[^"\n]+interactError[^"\n]*" title="请求超时">\s*<template #action>\s*<RefreshButton label="重新加载访客记录" @click="refreshInteractRecords"/)
})

test('搜索筛选排序与刷新复用标题栏 34px 和内容区 30px 的高度令牌', () => {
  assert.match(style, /:root\s*\{[^}]*--ui-content-titlebar-control-height-34: 34px;[^}]*--ui-content-item-control-height-30: 30px;/)
  const css = style.replace(/\s+/g, ' ')
  assert.match(css, /:is\(\.panel-titlebar, \.book-toolbar, \.log-filters, \.toolbar-filters, \.toolbar-control, \.friends-toolbar\) :is\(\.n-button, \.n-input:not\(\.n-input--textarea\), \.n-base-selection\),[^{}]+\{ --n-height: var\(--ui-content-titlebar-control-height-34\) !important;/)
  assert.match(css, /:is\(\.n-button:not\(\.bag-item__action-tiny\), \.n-input:not\(\.n-input--textarea\), \.n-base-selection\) \{ --n-height: var\(--ui-content-item-control-height-30\) !important;/)
  assert.doesNotMatch(css, /\.mall-filters__chips/, '已移除的筛选组不应留在高度规则中')
  assert.doesNotMatch(css, /\.(?:catalog-sort|panel-refresh)\s*\{[^}]*--n-height:/, '排序和刷新复用所处区域的高度')
})

test('内容适配宽度由测量层决定，搜索和下拉保留各自的控件布局', () => {
  assert.match(style, /\.toolbar-fit \{[^}]*display: inline-grid;[^}]*width: max-content;[^}]*height: var\(--ui-content-item-control-height-30\) !important;/)
  assert.match(style, /\.toolbar-fit__measure \{[^}]*visibility: hidden;[^}]*pointer-events: none;/, '测量层只占位，不可见也不可交互')
  assert.match(style, /\.toolbar-fit__measure > span,\s*\.toolbar-sort__labels > span \{\s*grid-area: 1 \/ 1;/, '候选文案叠放同一格，网格自然取最长宽度')
  assert.match(style, /\.toolbar-fit > \.toolbar-fit__control \{[^}]*position: absolute;[^}]*inset: 0;/, '实际控件绝对定位覆盖在测量层上')
  assert.match(style, /\.toolbar-fit--select > \.toolbar-fit__control \{[^}]*position: relative;[^}]*grid-area: 1 \/ 1;/, '下拉控件与测量层同格，保留可点击区域')
  assert.match(style, /\.toolbar-fit--search \.toolbar-fit__measure \{[^}]*var\(--ui-toolbar-control-icon-size\)/, '搜索宽度包含搜索图标')
  assert.match(style, /\.toolbar-fit--select \.toolbar-fit__measure \{[^}]*var\(--ui-toolbar-control-icon-size\)/, '筛选宽度包含下拉箭头')
  assert.match(style, /\.toolbar-sort \{[^}]*--n-width: max-content !important;/)
  assert.match(style, /\.panel-refresh:not\(\.panel-refresh--icon-only\),\s*\.control-fit-content \{[^}]*width: max-content !important;[^}]*min-width: 0 !important;/, '文本刷新键只按图标与文案撑开')
})

test('搜索框按默认文案定宽，不随输入内容伸缩', () => {
  const input = readFileSync(new URL('components/ui/BaseInput.vue', srcDir), 'utf8')
  const search = input.match(/<div v-else-if="type === 'search'"[\s\S]*?<\/NInput>/)?.[0] || ''
  assert.match(search, /class="toolbar-fit toolbar-fit--search"/)
  assert.match(search, /<span class="toolbar-fit__measure" aria-hidden="true">\{\{ placeholder \|\| '搜索' \}\}<\/span>/, '测量层只放默认文案')
  assert.doesNotMatch(search, /toolbar-fit__measure[^>]*>\{\{[^}]*textValue/, '输入值不能驱动宽度')
  assert.match(search, /class="toolbar-search__icon i-carbon-search"/)
  for (const file of ['components/illustrated/BookToolbar.vue', 'components/commerce/MallCatalogPanel.vue', 'components/catalog/SeedsCatalog.vue', 'components/catalog/ItemsCatalog.vue', 'views/Friends.vue']) {
    const source = readFileSync(new URL(file, srcDir), 'utf8')
    assert.match(source, /<BaseInput[^>]*type="search"/, `${file} 的搜索框应使用统一模板`)
    assert.doesNotMatch(source, /\.(?:book-toolbar__search|mall-search|catalog-search|friends-search)\s*\{/, `${file} 不应保留页面内的搜索框尺寸`)
  }
})

test('筛选框与排序按钮按全部候选项中最长的文案定宽', () => {
  const select = readFileSync(new URL('components/ui/BaseSelect.vue', srcDir), 'utf8')
  assert.match(select, /props\.placeholder \|\| '请选择',\s*\.\.\.\(props\.options \|\| \[\]\)\.map\(option => String\(option\.label\)\)/)
  assert.match(select, /<span v-for="\(text, index\) in fitLabels" :key="index">\{\{ text \}\}<\/span>/)
  assert.match(select, /'toolbar-fit toolbar-fit--select': fitWidth/)
  const sort = readFileSync(new URL('components/catalog/CatalogSortButton.vue', srcDir), 'utf8')
  assert.match(sort, /v-for="option in options"[^>]*class="toolbar-sort__measure" aria-hidden="true"/, '所有排序项都参与宽度')
  assert.match(sort, /class="catalog-sort toolbar-sort"/)
  // 旧实现按全角 / 半角字符估算像素，中英混排时会偏宽或裁切
  for (const source of [select, sort]) {
    assert.doesNotMatch(source, /textPxWidth|maxOptionWidth|fitStyle|minWidth/)
  }
  const book = readFileSync(new URL('components/illustrated/BookToolbar.vue', srcDir), 'utf8')
  assert.doesNotMatch(book, /SEARCH_FIXED_WIDTH|searchWidth/)
  const collections = readFileSync(new URL('components/CollectionsPanel.vue', srcDir), 'utf8')
  assert.match(collections, /<BaseSelect v-model="seriesId"[^>]*fit-width/)
  assert.doesNotMatch(collections, /\.series-select\s*\{/)
})

test('藏品页：所有藏品平铺在标题栏卡片里，不再显示系列标题与说明行', () => {
  const collections = readFileSync(new URL('components/CollectionsPanel.vue', srcDir), 'utf8')
  assert.match(collections, /<template #body>\s*(?:<!--[\s\S]*?-->\s*)?<div v-if="visibleItems\.length" class="book-grid">/)
  assert.match(collections, /:style="\{ '--tile-accent': accent \}"/, '稀有度色标挂在单个卡片上')
  assert.doesNotMatch(collections, /BookSection|series\.description|CollectionRulesPopover|visibleSeries/)
})

test('图鉴删除30px试用覆盖，不再单独调整普通操作按钮', () => {
  const source = readFileSync(new URL('views/Illustrated.vue', srcDir), 'utf8')
  assert.match(source, /class="page-stack"/)
  assert.doesNotMatch(source, /--illustrated-toolbar-control-height|--n-height|book-overview__actions/)
})

test('纯图标刷新按钮的宽度跟随所在区域的高度，保持正圆', () => {
  const component = readFileSync(new URL('components/ui/RefreshButton.vue', srcDir), 'utf8')
  assert.match(component, /:class="\{ 'panel-refresh--icon-only': iconOnly \}"/)
  assert.match(component, /:circle="iconOnly"/)
  assert.match(style, /\.n-button--circle\s*\{\s*--n-width: var\(--ui-content-item-control-height-30\) !important;/)
  assert.match(style, /:is\(\.panel-titlebar,[^)]+\)\s+\.n-button--circle\s*\{\s*--n-width: var\(--ui-content-titlebar-control-height-34\) !important;/)
})

test('个人页背包、任务与宠物页一致，刷新键放在右对齐的操作组末尾', () => {
  assert.match(style, /\.page-toolbar__actions \{[^}]*margin-left: auto;/)
  for (const file of ['components/farm/FarmBagPanel.vue', 'components/farm/FarmTaskPanel.vue']) {
    const source = readFileSync(new URL(file, srcDir), 'utf8')
    const actions = source.match(/<div class="page-toolbar__actions\b[^"]*">([\s\S]*?)\n {8}<\/div>/)?.[1] || ''
    assert.match(actions, /<RefreshButton[\s\S]*\/>\s*$/, `${file} 的刷新键应位于右侧操作组末尾`)
  }
  const bag = readFileSync(new URL('components/farm/FarmBagPanel.vue', srcDir), 'utf8')
  assert.doesNotMatch(bag, /bag-refresh-row|bag-selection-toggle/, '背包不再保留左侧刷新的自定义排布')
})

test('背包仿图鉴道具页：标题栏用搜索框与分类下拉，去掉分类按钮行', () => {
  const bag = readFileSync(new URL('components/farm/FarmBagPanel.vue', srcDir), 'utf8')
  const toolbar = bag.match(/<div class="bag-toolbar panel-titlebar[^"]*">([\s\S]*?)<div class="page-toolbar__actions/)?.[1] || ''
  assert.match(toolbar, /<BaseInput v-model="searchKeyword" type="search" clearable placeholder="输入名称搜索" \/>/)
  assert.match(toolbar, /<BaseSelect v-model="selectedCategory" :options="CATEGORY_OPTIONS" fit-width/)
  for (const label of ['全部', '果实', '超变果实', '种子', '道具'])
    assert.match(bag, new RegExp(`\\{ label: '${label}', value: '\\w+' \\}`))
  assert.match(bag, /const selectedCategory = ref<CategoryValue>\('all'\)/, '默认展示全部')
  // 搜索与分类叠加筛选，批量选择随筛选结果重置
  assert.match(bag, /const filteredItems = computed\([\s\S]*?searchKeyword\.value[\s\S]*?selectedCategory\.value/)
  assert.match(bag, /watch\(\[selectedCategory, searchKeyword\]/)
  assert.doesNotMatch(bag, /bag-categories|categoryCounts|i-carbon-(?:apple|flash|tree|tool-box|list-boxes)\b/, '分类按钮行及其图标、计数与样式已清理')
  assert.doesNotMatch(style, /bag-categories/)
})

test('背包离线时保留标题栏，只在内容区提示账号未运行', () => {
  const bag = readFileSync(new URL('components/farm/FarmBagPanel.vue', srcDir), 'utf8')
  const template = bag.match(/<template>\s*<div class="panel-fill">([\s\S]*?)<div class="bag-toolbar/)?.[1]
  assert.ok(template, '应能定位到标题栏之前的模板片段')
  assert.doesNotMatch(template, /v-if|v-else|EmptyState/, '标题栏之前不能有状态分支把它整个替换掉')
  assert.match(bag, /class="panel-scroll-body"[^]*?请先选择账号[^]*?<OfflineState v-else-if="isOffline" \/>[^]*?获取数据失败/)
})

test('背包卡片精简：去掉编号/UID、等级与可否出售文案，底栏操作在左、数量在右', () => {
  const card = readFileSync(new URL('components/ui/BagItemCard.vue', srcDir), 'utf8')
  const warehouse = readFileSync(new URL('../../core/src/services/warehouse.ts', srcDir), 'utf8')
  for (const file of ['components/farm/FarmBagPanel.vue', 'components/ranch/RanchBagPanel.vue']) {
    const bag = readFileSync(new URL(file, srcDir), 'utf8')
    assert.match(bag, /<BagItemCard\s+v-for=/, `${file} 复用背包卡片`)
    assert.doesNotMatch(bag, /bag-item__ids|UID \{\{|item\.level|'可出售'|'不可出售'|is-sellable/)
  }
  assert.doesNotMatch(card, /bag-item__ids|UID \{\{|item\.level|'可出售'|'不可出售'|is-sellable/)
  assert.doesNotMatch(warehouse, /level: info \? \(Number\(info\.level\)/, '背包接口不再下发仅供卡片显示的等级')
  const foot = card.match(/<footer class="bag-item__foot\b[^"]*">([\s\S]*?)<\/footer>/)?.[1] || ''
  assert.ok(foot.includes('bag-item__ops') && foot.indexOf('bag-item__ops') < foot.indexOf('bag-item__qty'), '操作在前、数量在后')
  assert.match(foot, /\{\{ duration \|\| `×\$\{quantity\}` \}\}/, '× 与数量同字号')
  assert.match(card, /\.bag-item__qty \{[^}]*margin-inline-start: auto;[^}]*font-size: var\(--ui-font-size-small-13\);/, '数量用 13px 并靠右')
  assert.match(card, /\.bag-item__name \{[^}]*font-size: var\(--ui-font-size-small-13\);/)
  assert.match(card, /\.bag-item :deep\(\*\) \{[^}]*font-weight: var\(--fw-400\)/)
  assert.match(card, /\.bag-item-grid \{[^}]*minmax\(min\(100%, 112px\), 1fr\)/)
})

test('任务页：成长任务并入列表，一行一项并标出奖励与右侧状态，微信账号隐藏 QQ 专属任务', () => {
  const panel = readFileSync(new URL('components/farm/FarmTaskPanel.vue', srcDir), 'utf8')
  const overview = readFileSync(new URL('components/DailyOverview.vue', srcDir), 'utf8')
  assert.doesNotMatch(panel, /task-growth-section|成长任务列表/, '不再单独渲染成长任务卡片')
  assert.doesNotMatch(overview, /每日礼包 & 任务|grid-cols-3/, '去掉标题与三列卡片')
  assert.match(panel, /:platform="currentAccount\?\.platform"/)
  assert.match(overview, /props\.platform === 'wx' && QQ_ONLY_KEYS\.has\(gift\.key\)/)
  assert.match(overview, /const QQ_ONLY_KEYS = new Set\(\['vip_daily_gift'\]\)/)
  assert.match(overview, /list\.push\(growthRow\(data\.growth\)\)/)
  const row = overview.match(/<li v-for="row in rows"[\s\S]*?<\/li>/)?.[0] || ''
  assert.ok(row.indexOf('task-row__rewards') < row.indexOf('task-row__status'), '奖励在前、状态在最右')
  assert.match(overview, /grid-template-areas: 'icon info rewards status';/)
})

test('任务页：未选账号与明确离线分开显示，真实错误保留重试', () => {
  const panel = readFileSync(new URL('components/farm/FarmTaskPanel.vue', srcDir), 'utf8')
  const overview = readFileSync(new URL('components/DailyOverview.vue', srcDir), 'utf8')
  assert.equal([...panel.matchAll(/<OfflineState\b/g)].length, 1)
  assert.match(panel, /请先选择账号[^]*?<OfflineState v-else-if="isOffline" \/>/)
  assert.match(panel, /v-if="dailyGiftsError"[^]*?@click="refresh"/)
  assert.doesNotMatch(panel, /启动账号后读取任务|暂无任务详情|taskEmptyText|empty-text/)
  assert.doesNotMatch(overview, /EmptyState|emptyText/, '列表组件不再自带空状态')
})

test('宠物页：离线只显示“账号未运行”，名册与“暂无宠物”只在拿到快照后出现', () => {
  const pet = readFileSync(new URL('components/PetPanel.vue', srcDir), 'utf8')
  const offline = [...pet.matchAll(/<OfflineState v-else-if="isOffline" \/>/g)]
  assert.equal(offline.length, 2, '宠物管理与守护记录各一个')
  assert.doesNotMatch(pet, /v-show="!loading && !statusLoading"/, '名册不再独立于状态链显示')
  assert.match(pet, /<template v-else-if="snapshot">\s*<section id="pet-roster"/)
  assert.match(pet, /获取宠物数据失败[^]*?@click="refreshPetInfo"/)
  assert.match(pet, /获取守护记录失败" :description="error"[^]*?@click="loadProtectLogs"/)
  assert.match(pet, /\$\{isConnected\.value \? ownedCount\.value : 0\}\/\$\{dogs\.value\.length \|\| PET_TOTAL\}/, '离线计数显示 0/总数')
  assert.match(pet, /全部宠物<small>\(\{\{ rosterCount \}\}\)<\/small>/)
})

test('宠物管理：可购买的未拥有宠物显示购买入口并刷新购买结果', () => {
  const pet = readFileSync(new URL('components/PetPanel.vue', srcDir), 'utf8')
  assert.match(pet, /function purchasableOffer\(pet: PetInfo\)[^]*?offer\.goods\.rewards\.some\(reward => reward\.id === pet\.id\)[^]*?offer\.goods\.purchasable && offer\.goods\.purchaseStatus === 'available'/)
  assert.match(pet, /90003: \{ id: 1001, count: 1000000, name: '金币', icon: '[^']+' \}/)
  assert.match(pet, /90011: \{ id: 1005, count: 4800, name: '金豆', icon: '[^']+' \}/)
  assert.match(pet, /pet-row__price[^]*?formatCompactAmount\(petDisplayPrice\(pet\)!\.count\)/)
  const dialog = readFileSync(new URL('components/commerce/PurchaseDialog.vue', srcDir), 'utf8')
  assert.match(dialog, /v-if="!hideRewards"[^]*?每份包含/)
  assert.match(pet, /<PurchaseDialog[^]*?:show-currency-name="true"[^]*?@confirm="purchasePet"/)
  assert.match(dialog, /showCurrencyName \? formatCompactAmount\(Number\(goods\.price\.count\)\) : fullAmount\(goods\.price\.count\)/)
  assert.match(dialog, /showCurrencyName \? formatCompactAmount\(Number\(totalCost\)\) : fullAmount\(totalCost\)/)
  assert.match(dialog, /<Teleport to="body">\s*<div v-if="open && goods" class="purchase-mask"/, '购买遮罩必须挂载到 body，避免被页面滚动遮罩裁切')
  assert.match(pet, /offer\.goods\.price\.id === expectedPrice\.id && offer\.goods\.price\.count === expectedPrice\.count/)
  assert.match(pet, /商店报价与游戏内价格不一致，未发起购买/)
  assert.match(pet, /petOfferError\.value = failed\.reason instanceof Error/)
  assert.match(pet, /宠物商店：\{\{ petOfferError \}\}/)
  assert.match(pet, /当前商店未返回牧羊犬、斑点狗或柯基的商品/)
  assert.match(pet, /function hasPurchaseEntry\(pet: PetInfo\)[^]*?shopPetIds\.has\(pet\.id\)/)
  assert.match(pet, /function dogActionLabel\(pet: PetInfo\)[^]*?hasPurchaseEntry\(pet\) \? '购买' : '限定'/)
  assert.match(pet, /function dogStatusLabel\(pet: PetInfo\)[^]*?purchasableOffer\(pet\) \? '可购买' : hasPurchaseEntry\(pet\) \? '待查询商品' : '未获得'/)
  assert.match(pet, /function isPetLocked\(pet: PetInfo\)[^]*?!hasPurchaseEntry\(pet\)/)
  assert.match(pet, /if \(!pet\.owned && !pet\.activatable\) \{[^]*?await loadPetOffers\(accountId\)[^]*?if \(offer\)\s*selectedOffer\.value = \{/)
  assert.match(pet, /<PurchaseDialog[^]*?@confirm="purchasePet"/)
  assert.match(pet, /url: '\/api\/pet-shop'/)
  assert.match(pet, /offer\.shop === 'pet' \? '\/api\/pet-shop\/purchase'/)
  assert.match(pet, /await Promise\.all\(\[petStore\.fetchPetInfo\(accountId\), bagStore\.fetchBag\(accountId\), loadPetOffers\(accountId\)\]\)/)
})

test('离线控件模板：断网图标、状态文字和只重连当前账号的刷新按钮', () => {
  for (const selector of ['.offline-state', '.offline-state__badge', '.offline-state__icon', '.offline-state__title'])
    assert.match(style, new RegExp(`${selector.replace('.', '\\.')} \\{`), `style.css 必须定义 ${selector}`)
  const block = style.match(/\.offline-state \{[^}]*\}/)?.[0] || ''
  assert.doesNotMatch(block, /border:|box-shadow/, '无边框')
  const component = readFileSync(new URL('components/ui/OfflineState.vue', srcDir), 'utf8')
  assert.match(component, /class="offline-state"/)
  assert.match(component, /i-carbon-connection-signal-off/)
  assert.match(component, /\{\{ title \?\? '账号未运行' \}\}<\/strong>\s*<slot name="action">\s*<RefreshButton\s+label="重新加载账号信息"/)
  assert.match(component, /:disabled="accountStore\.bulkRunning \|\| !accountStore\.currentAccountId"/)
  assert.match(component, /@click="accountStore\.reloadCurrentAccount\(\)"/)
  const settings = readFileSync(new URL('views/Settings.vue', srcDir), 'utf8')
  assert.match(settings, /@click="accountStore\.startAllAccounts\(\)"[^]*?>全部启动</)
  assert.doesNotMatch(component, /<style/, '不在组件里重复样式')
})

test('离线提示一律用 OfflineState，不再用 EmptyState 拼接', () => {
  const offenders = listVueFiles(srcDir)
    .map(url => [path.relative(srcPath, fileURLToPath(url)).replaceAll('\\', '/'), readFileSync(url, 'utf8')])
    .filter(([rel, source]) => rel !== 'components/ui/OfflineState.vue'
      && /connection-signal-off|账号未登录|title="账号未运行"/.test(source))
    .map(([rel]) => rel)
  assert.deepEqual(offenders, [])
  const pages = ['components/farm/FarmPanel.vue', 'components/farm/FarmBagPanel.vue', 'components/PetPanel.vue', 'components/IllustratedPanel.vue', 'components/CollectionsPanel.vue', 'views/Friends.vue', 'views/SolarCalendar.vue', 'components/activity/center/ActivityDirectoryPage.vue']
  for (const page of pages)
    assert.match(readFileSync(new URL(page, srcDir), 'utf8'), /<OfflineState\b/, `${page} 应使用 OfflineState`)
})

test('概览离线时在账号卡提供重连，农牧场进度仍然显示', () => {
  const dashboard = readFileSync(new URL('views/Dashboard.vue', srcDir), 'utf8')
  assert.match(dashboard, /<section class="ov-card ov-account\b[^]*?<div v-if="isOffline" class="ov-account__head">\s*<RefreshButton\s+label="重新加载账号信息"[^>]*:disabled="accountStore\.bulkRunning \|\| !currentAccountId"[^>]*@click="accountStore\.reloadCurrentAccount\(\)"\s*\/>\s*<\/div>\s*<template v-for="row in experienceRows"/)
})

test('重新上线：只在同一账号离线→在线时执行一次当前页的刷新键', () => {
  const composable = readFileSync(new URL('composables/useReconnectRefresh.ts', srcDir), 'utf8')
  assert.match(composable, /id && id === prevId && prev === 'offline' && next === 'online'/)
  const pages = new Map([
    ['components/MutationCatalogPanel.vue', 'load'],
    ['components/catalog/SeedsCatalog.vue', 'handleCalibrate'],
    ['components/catalog/ItemsCatalog.vue', 'refreshItems'],
    ['components/commerce/MallCatalogPanel.vue', 'load'],
    ['components/commerce/MysteryShopPanel.vue', 'load'],
    ['components/activity/center/ShareRewardActivity.vue', '() => request()'],
    ['views/SolarCalendar.vue', 'manualRefresh'],
    ['components/activity/center/ActivityDirectoryPage.vue', '() => load(true)'],
    ['components/activity/center/PetDiaryPage.vue', 'load'],
    ['components/activity/center/MilkTeaPage.vue', '() => request()'],
    ['components/activity/center/AutumnActivityPage.vue', '() => request()'],
    ['components/activity/center/CharityActivityPage.vue', 'refreshActivity'],
    ['components/activity/center/QingMeiActivityPage.vue', 'refreshActivity'],
    ['components/activity/center/QixiActivityPage.vue', 'refreshActivity'],
    ['components/activity/center/WeatherActivityPage.vue', 'refreshActivity'],
  ])
  for (const [page, handler] of pages)
    assert.ok(readFileSync(new URL(page, srcDir), 'utf8').includes(`useReconnectRefresh(${handler})`), `${page} 上线时应执行 ${handler}`)
  const items = readFileSync(new URL('components/catalog/ItemsCatalog.vue', srcDir), 'utf8')
  assert.match(items, /<CatalogSortButton[\s\S]*?\/>\s*<RefreshButton\s+title="刷新道具列表"/, '道具图鉴刷新键在排序按钮右侧')
  const friends = readFileSync(new URL('views/Friends.vue', srcDir), 'utf8')
  assert.match(friends, /<RefreshButton\s+title="刷新黑名单"[\s\S]*?@click="refreshBlacklist"/, '黑名单页签有刷新键')
  assert.match(friends, /activeTab\.value === 'blacklist'\) \{\s*blacklistLoadedAccount\.value = id\s*void refreshBlacklist\(\)/, '黑名单页签上线时重新读')
})

test('账号数据面板明确离线时显示提示，确认上线后重读不依赖旧错误', () => {
  for (const [page, reload] of [
    ['components/farm/FarmPanel.vue', /next === 'online'\)\s*void refreshFarmData\(\)/],
    ['components/farm/FarmBagPanel.vue', /next === 'online'\) \{\s*imageErrors\.value = \{\}\s*void bagStore\.fetchBag\(id\)/],
    ['components/farm/FarmTaskPanel.vue', /next === 'online'\)\s*void refresh\(\)/],
    ['components/PetPanel.vue', /next === 'online'\)\s*\{\s*void petStore\.fetchPetInfo\(id\)\s*void loadPetOffers\(id\)/],
    ['components/IllustratedPanel.vue', /watch\(\[currentAccountId, isConnected\][^]*?void refresh\(\)/],
    ['components/CollectionsPanel.vue', /watch\(\[currentAccountId, isConnected\][^]*?void refresh\(\)/],
    ['views/Friends.vue', /if \(id !== previousId\)\s*offlineAccountId = ''.*?if \(next === 'offline'\) \{\s*offlineAccountId = id.*?if \(offlineAccountId !== id\) \{\s*loadTabData\(\)\s*return\s*\}\s*offlineAccountId = ''.*?for \(const gid of expandedFriends\.value\)\s*void refreshFriendLands\(gid\)/s],
  ]) {
    const source = readFileSync(new URL(page, srcDir), 'utf8')
    assert.match(source, /const isOffline = computed\(\(\) => presence\.value === 'offline'\)/, page)
    assert.match(source, /<OfflineState v-else-if="isOffline" \/>[^]*?presence === 'unknown'/, page)
    assert.match(source, reload, page)
  }
  const friends = readFileSync(new URL('views/Friends.vue', srcDir), 'utf8')
  assert.match(friends, /watch\(currentAccountId, \(\) => \{\s*expandedFriends\.value\.clear\(\)/)
})

test('土地和图鉴读取失败提供反馈，后台轮询跳过读取失败的土地', () => {
  const read = file => readFileSync(new URL(file, srcDir), 'utf8')
  const farm = read('components/farm/FarmPanel.vue')
  const friends = read('views/Friends.vue')
  const illustrated = read('components/IllustratedPanel.vue')
  assert.match(farm, /<EmptyState v-else-if="error"[^>]*title="土地读取失败"[^>]*>\s*<NButton secondary @click="refreshFarm">\s*重新读取/)
  assert.match(illustrated, /<OfflineState v-else-if="isOffline" \/>[^]*?<EmptyState v-else-if="error"[^>]*title="图鉴加载失败"[^>]*>\s*<NButton secondary @click="refresh">重试<\/NButton>/)
  assert.match(friends, /<OfflineState v-else-if="friendLandsError\[friend\.gid\]" class="offline-state--inline" \/>/)
  assert.match(style, /\.offline-state:not\(\.offline-state--inline\)/)
  assert.match(farm, /useIntervalFn\(\(\) => refreshFarmData\(!error\.value\), 60000\)/)
  assert.match(farm, /readLands \? farmStore\.fetchLands\(accountId\) : undefined/)
  assert.match(friends, /friendLandsError\.value\[key\] \? undefined : refreshFriendLands\(key\)/)
})

test('商城：仅明确离线时显示统一提示，读取失败单独重试', () => {
  for (const [panel, data, retry] of [
    ['MallCatalogPanel', 'mall', 'load'],
    ['MysteryShopPanel', 'mystery', 'commerceStore.fetchMystery(currentAccountId)'],
  ]) {
    const source = readFileSync(new URL(`components/commerce/${panel}.vue`, srcDir), 'utf8')
    assert.match(source, /presence\.value === 'offline'/)
    assert.equal([...source.matchAll(/<OfflineState\b/g)].length, 1)
    assert.match(source, /请先选择账号[^]*?<OfflineState v-else-if="isOffline" \/>[^]*?<EmptyState v-else-if="[^"]*error[^"]*" title="[^"]+读取失败"/)
    const errorState = source.match(/<EmptyState v-else-if="[^"]*error[^"]*"[^>]*>([^]*?)<\/EmptyState>/)?.[1] || ''
    assert.ok(errorState.includes('label="重新读取"') && errorState.includes(`@click="${retry}"`), data)
  }
  const mystery = readFileSync(new URL('components/commerce/MysteryShopPanel.vue', srcDir), 'utf8')
  assert.match(mystery, /v-if="currentAccountId && \(mystery \|\| mysteryHistory\.length\)"[^]*?aria-label="购买历史"/)
  const page = readFileSync(new URL('views/GameMall.vue', srcDir), 'utf8')
  assert.match(page, /<MysteryShopPanel v-if="activeTab === 'mystery'" \/>\s*<MallCatalogPanel v-else/)
  assert.doesNotMatch(page, /<OfflineState/)
})

test('活动离线时保留子菜单和标题栏，离线提示上下各留 12px', () => {
  const read = file => readFileSync(new URL(file, srcDir), 'utf8')
  assert.match(read('components/activity/center/ActivityCenterContent.vue'), /<ActivityDirectoryPage\s+v-if="!selectedActivity \|\| \(isOffline && selectedActivity !== 'yishuhuanfu'\)"\s+:offline="isOffline"/)
  assert.match(read('components/activity/center/YishuHuanfuActivityPage.vue'), /const currentActivity = computed\(\(\) => offline\.value \? null : yishuHuanfu\.value\)/)
  const directory = read('components/activity/center/ActivityDirectoryPage.vue')
  assert.match(directory, /<PageTabs\b[^]*?<\/PageTabs>[^]*?class="activity-toolbar panel-titlebar panel-titlebar--flush\b[^"]*"[^]*?class="panel-scroll-body">\s*<OfflineState v-if="offline" \/>/)
  assert.match(directory, /:disabled="!currentAccountId \|\| offline"/)
  assert.match(read('style.css'), /\.offline-state\s*\{[^}]*padding:\s*12px 20px;/)
  const friends = read('views/Friends.vue')
  assert.match(friends, /<OfflineState v-else-if="isOffline" \/>[^]*?<template v-else>[^]*?<div v-else-if="activeTab === 'blacklist'" class="blacklist-tab">/)
  assert.match(friends, /<div v-if="blacklist\.length === 0" class="blacklist-empty">/)
})

test('节令、概览、设置和生涯：离线只替换依赖连接的内容', () => {
  const read = file => readFileSync(new URL(file, srcDir), 'utf8')
  for (const page of ['views/Settings.vue', 'components/AccountCareerModal.vue']) {
    const source = read(page)
    assert.equal([...source.matchAll(/<OfflineState\b/g)].length, 1, page)
    assert.match(source, /<OfflineState v-(?:else-)?if="isOffline" \/>/)
  }
  const solar = read('views/SolarCalendar.vue')
  assert.equal([...solar.matchAll(/<OfflineState\b/g)].length, 1)
  assert.match(solar, /<PageTabs[^>]+seasonId.*?<\/PageTabs>/s)
  assert.match(solar, /<section v-if="currentAccountId && \(isOffline \|\| calendarData\)"[^>]*>.*?<header v-if="isOffline \|\| season" class="panel-titlebar panel-titlebar--flush\b[^"]*"[^>]*>.*?seasonTabs\.find\(entry => entry\.id === seasonId\)\?\.name.*?<\/header>\s*<div v-if="isOffline" class="panel-scroll-body[^>]*>\s*<OfflineState \/>/s)
  assert.match(solar, /v-else-if="!isOffline && \(error \|\| !calendarData\)".*?@click="manualRefresh"/s)
  assert.doesNotMatch(read('views/Dashboard.vue'), /账号未运行/)
  const settings = read('views/Settings.vue')
  assert.match(settings, /v-else-if="seedOptionsError"[^]*?@click="fetchSeedOptions\(currentAccountId\)"/)
  assert.match(settings, /<FarmSeedPriorityDialog[^]*?:error="bagSeedsError"[^]*?@refresh="fetchBagSeeds\(\)"/)
  assert.match(read('components/settings/FarmSeedPriorityDialog.vue'), /v-else-if="error"[^]*?@click="emit\('refresh'\)"/)
  assert.match(settings, /@click="strategyPreviewVisible = true"/)
  const menu = read('components/TopAccountMenu.vue')
  assert.match(menu, /:is-offline="isOffline"[^]*?@refresh="loadCareer"/)
  assert.match(read('components/AccountCareerModal.vue'), /<OfflineState v-if="isOffline" \/>[^]*?v-else-if="error"[^]*?emit\('refresh'\)/)
})
