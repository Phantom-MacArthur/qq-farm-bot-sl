<script setup lang="ts">
/**
 * 设置页标签面板：与「账号管理」同构 —— 一张 page-card-surface 里上半部是动作工具栏，
 * 下半部是内容区，两者用表头底色（var(--ui-table-head)）区分，而不是靠卡片之间的留白。
 * 默认槽放动作按钮（与 .account-actions 同一套尺寸），body 槽放该标签页的正文组件。
 */
</script>

<template>
  <div class="settings-panel page-card-surface rounded-2xl panel-scroll-layout margin-shell"><span class="margin-content">
    <div class="settings-panel__toolbar panel-titlebar margin-shell"><span class="margin-content">
      <slot />
    </span></div>
    <div class="settings-panel__body panel-scroll-body">
      <slot name="body" />
    </div>
  </span></div>
</template>

<style scoped>
/* 外壳、出血到卡片边缘的底色带、16px 间距全部对齐 .account-panel / .account-toolbar。 */
.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  --inset-top: 16px; --inset-right: 16px; --inset-bottom: 16px; --inset-left: 16px;
  /* 半透的 --glass-card 叠在页面底色上会让卡片之间的空隙发灰，而内层卡片是双层叠加、
     反而更白，所以面板铺成不透明表面色，空隙与卡片就是同一个白底。 */
  background: var(--ui-surface-solid) !important;
  /* 圆角统一由面板裁切，子元素不再自己画一遍弧。
     用 clip 而不是 hidden：hidden 会创建滚动容器，吸顶的 panel-titlebar 会被困在面板内失效。 */
  overflow: clip;
}

/* 标题栏的出血/留白/分隔线/底色/吸顶/控件统一高度全部走全局 .panel-titlebar，
   这里只保留与模板默认（wrap 换行）不同的布局差异：窄屏横向滚动而不是换行。 */
.settings-panel__toolbar {
  flex-wrap: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
}

/* 正文里可能有守住最小宽度的网格（如「常规设置」固定的两列模块卡），
   窄屏时让正文自己横向滚动，而不是顶穿卡片背景和描边。 */
.settings-panel__body {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
}

/* 与 .account-actions / .account-action-btn 同尺寸：按钮不收缩、
   统一 105px 最小宽度、图标与文案 4px 间距、内容靠左，窄屏横向滚动而不是压小按钮。 */
.settings-panel__toolbar :deep(.n-button) {
  flex: 0 0 auto;
  width: auto;
  min-width: 105px;
  justify-content: flex-start;
}

.settings-panel__toolbar :deep(.n-button__content) {
  justify-content: flex-start;
  gap: 4px;
  white-space: nowrap;
}
</style>
