import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// 使用项目现有的 Node 原生测试框架。
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'

const require = createRequire(import.meta.url)
const { createPinia, disposePinia, setActivePinia } = require('pinia')
const ts = require('typescript')
const { ref } = require('vue')

const source = readFileSync(new URL('../src/stores/app.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})

function harness(t, initialWidth, savedCollapsed = false) {
  const pinia = createPinia()
  setActivePinia(pinia)
  t.after(() => disposePinia(pinia))
  const viewportWidth = ref(initialWidth)
  const preference = ref(savedCollapsed)
  const imports = {
    '@vueuse/core': {
      useStorage(key, fallback) {
        assert.equal(key, 'sidebar_collapsed')
        assert.equal(fallback, false)
        return preference
      },
      useWindowSize(options) {
        // 不以 document.clientWidth 或正文滚动区宽度判断断点。
        assert.equal(options.type, 'inner')
        assert.equal(options.includeScrollbar, true)
        return { width: viewportWidth }
      },
    },
  }
  const module = { exports: {} }
  // 执行实际的 Pinia store，只替换视口与存储输入。
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', outputText)(id => imports[id] || require(id), module, module.exports)
  return { store: module.exports.useAppStore(pinia), viewportWidth, preference }
}

test('962px 为展开临界值，低于它立即自动收起，884px 以下仍保持整页下限', (t) => {
  const { store, viewportWidth, preference } = harness(t, 1200)
  for (const [width, collapsed, minimum] of [
    [1200, false, 962],
    [963, false, 962],
    [962, false, 962],
    [961.5, true, 884],
    [961, true, 884],
    [885, true, 884],
    [884, true, 884],
    [883, true, 884],
    [600, true, 884],
    [962, false, 962],
    [1440, false, 962],
  ]) {
    viewportWidth.value = width
    assert.equal(store.sidebarCollapsed, collapsed, `${width}px 侧栏状态`)
    assert.equal(store.sidebarAutoCollapsed, collapsed, `${width}px 自动收起状态`)
    assert.equal(store.layoutMinWidth, minimum, `${width}px 整页最小宽度`)
    assert.equal(preference.value, false, '自动切换不能写入用户偏好')
  }
})

test('首次直接打开窄屏页面时自动收起，不能通过按钮强行展开', (t) => {
  const { store, viewportWidth, preference } = harness(t, 884)
  assert.equal(store.sidebarCollapsed, true)
  assert.match(store.sidebarToggleLabel, /962px.*自动收起/)
  store.toggleSidebarCollapsed()
  assert.equal(store.sidebarCollapsed, true)
  assert.equal(store.layoutMinWidth, 884)
  assert.equal(preference.value, false)
  viewportWidth.value = 962
  assert.equal(store.sidebarCollapsed, false)
  assert.equal(store.sidebarToggleLabel, '收起侧栏')
})

test('手动收起偏好跨越断点保持不变，恢复宽屏后仍可手动展开', (t) => {
  const { store, viewportWidth, preference } = harness(t, 1200)
  store.toggleSidebarCollapsed()
  assert.equal(preference.value, true)
  assert.equal(store.layoutMinWidth, 884)
  assert.equal(store.sidebarToggleLabel, '展开侧栏')
  viewportWidth.value = 883
  store.toggleSidebarCollapsed()
  assert.equal(preference.value, true)
  viewportWidth.value = 962
  assert.equal(store.sidebarCollapsed, true)
  assert.equal(store.sidebarAutoCollapsed, false)
  store.toggleSidebarCollapsed()
  assert.equal(store.sidebarCollapsed, false)
  assert.equal(store.layoutMinWidth, 962)
  assert.equal(preference.value, false)
})

test('读取原有持久化收起偏好，往返缩放不覆盖它', (t) => {
  const { store, viewportWidth, preference } = harness(t, 1440, true)
  assert.equal(store.sidebarCollapsed, true)
  for (const width of [961, 884, 883, 962, 1440]) {
    viewportWidth.value = width
    assert.equal(store.sidebarCollapsed, true)
    assert.equal(store.layoutMinWidth, 884)
    assert.equal(preference.value, true)
  }
})

const readSource = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
const layout = readSource('layouts/DefaultLayout.vue')
const styles = readSource('style.css')

test('全局布局统一兜底宽度并拉伸页面，只有外壳承担整页横向滚动', () => {
  assert.match(layout, /'--app-min-width': `\$\{layoutMinWidth\}px`/)
  assert.match(layout, /\.liquid-layout\s*\{[^}]*min-width: var\(--app-min-width\)/)
  assert.match(layout, /\.liquid-layout\s*\{[^}]*min-height: 0/)
  assert.match(layout, /\.page-scroll > :deep\(\*\)\s*\{[^}]*width: 100%;[^}]*min-width: 0;[^}]*max-width: none;/)
  assert.match(styles, /\.app-shell\s*\{[^}]*height: 100dvh;[^}]*overflow-x: auto;[^}]*overflow-y: hidden;/)
  assert.doesNotMatch(styles, /--app-min-width: 780px/)
  assert.doesNotMatch(readSource('App.vue'), /class="app-shell[^"\n]*overflow-hidden/)
})

test('右侧16px包含滚动条占位，页头与正文共用同一补偿值', () => {
  assert.match(layout, /--page-pad: 16px/)
  assert.match(layout, /\.app-content,\s*\.page-header-bar,\s*\.page-scroll\s*\{[^}]*transition-property: none;/)
  assert.match(layout, /--page-pad-end: max\(0px, calc\(var\(--page-pad\) - var\(--scrollbar-w, 0px\)\)\)/)
  assert.match(layout, /\.page-header-bar\s*\{[^}]*padding: 10px var\(--page-pad-end\) 6px var\(--page-pad\)/)
  assert.match(layout, /\.page-scroll\s*\{[^}]*padding: 0 var\(--page-pad-end\) var\(--page-pad-bottom, var\(--page-pad\)\) var\(--page-pad\)/)
})

test('固定标题栏面板按内容取高，底部留白包含外层横向滚动条', () => {
  const style = readSource('style.css')
  assert.match(style, /\.page-scroll:has\(\.panel-scroll-layout\)\s*\{[^}]*--page-pad-bottom: max\(0px, calc\(var\(--page-pad, 16px\) - var\(--page-bottom-inset, 0px\)\)\)/)
  assert.match(style, /\.page-scroll > \.panel-scroll-layout\s*\{[^}]*flex: 0 1 auto;/)
})

test('节令卡片随容器拉伸且不再叠加整页最小宽度，窄屏隐藏侧栏开关', () => {
  const calendar = readSource('views/SolarCalendar.vue')
  assert.match(calendar, /\.solar\s*\{[^}]*width: 100%;[^}]*min-width: 0;/)
  assert.match(calendar, /\.solar-panel\s*\{[^}]*width: 100%;[^}]*min-width: 0;/)
  assert.doesNotMatch(calendar, /min-width: var\(--app-min-width\)|min-width: max-content/)
  assert.match(calendar, /\.reward-line :deep\(\.n-button\)\s*\{[^}]*min-width: 100px;\s*padding-inline: 0;/)
  const sidebar = readSource('components/Sidebar.vue')
  assert.match(sidebar, /<NButton\s+v-if="!sidebarAutoCollapsed"[^>]*@click="appStore\.toggleSidebarCollapsed"/)
  assert.doesNotMatch(readSource('components/PageHeader.vue'), /toggleSidebarCollapsed/, '页头不再提供第二个侧栏开关')
  assert.match(readSource('components/Sidebar.vue'), /\.app-sidebar\.is-auto-collapsed\s*\{[^}]*transition: none;/)
})
