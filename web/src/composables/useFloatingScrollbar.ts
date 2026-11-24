import type { Ref } from 'vue'
import { watch } from 'vue'

const PANEL_SCROLL_SELECTOR = '.panel-scroll-layout > .panel-scroll-body:not(.mystery-body), .panel-scroll-layout > .margin-content > .panel-scroll-body:not(.mystery-body), .mystery-body > .history-list'
const TRACK_WIDTH = 8
const TRACK_INSET_TOP = 4
const TRACK_INSET_BOTTOM = 6
const TRACK_GAP = 2
const MIN_THUMB_HEIGHT = 24
const HIDE_DELAY_MS = 900

const hosts = new WeakMap<HTMLElement, { count: number, previousPosition: string | null }>()

function retainHost(host: HTMLElement) {
  let state = hosts.get(host)
  if (!state) {
    const previousPosition = getComputedStyle(host).position === 'static' ? host.style.position : null
    if (previousPosition !== null)
      host.style.position = 'relative'
    state = { count: 0, previousPosition }
    hosts.set(host, state)
  }
  state.count++

  return () => {
    if (--state.count === 0) {
      if (state.previousPosition !== null && host.style.position === 'relative')
        host.style.position = state.previousPosition
      hosts.delete(host)
    }
  }
}

function isScrollable(overflow: string) {
  return overflow === 'auto' || overflow === 'scroll'
}

function attachFloatingScrollbar(el: HTMLElement, host: HTMLElement, scheduleRefresh: () => void) {
  const releaseHost = retainHost(host)
  const track = document.createElement('div')
  const thumb = document.createElement('div')
  track.className = 'fsb-track'
  track.style.display = 'none'
  track.setAttribute('aria-hidden', 'true')
  thumb.className = 'fsb-thumb'
  thumb.style.touchAction = 'none'
  track.appendChild(thumb)
  host.appendChild(track)

  const controller = new AbortController()
  const { signal } = controller
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let active = false
  let trackHeight = 0
  let lastScrollTop = el.scrollTop
  let dragPointer: number | null = null
  let dragStartY = 0
  let dragStartScroll = 0
  let dragRatio = 0

  function scheduleHide() {
    clearTimeout(hideTimer)
    if (active && dragPointer === null)
      hideTimer = setTimeout(() => track.classList.remove('is-visible'), HIDE_DELAY_MS)
  }

  function show() {
    if (!active)
      return
    track.classList.add('is-visible')
    scheduleHide()
  }

  function stopDrag() {
    const pointer = dragPointer
    dragPointer = null
    if (pointer !== null && thumb.hasPointerCapture(pointer))
      thumb.releasePointerCapture(pointer)
    scheduleHide()
  }

  function updateThumb() {
    const { clientHeight, scrollHeight, scrollTop } = el
    const maxScroll = scrollHeight - clientHeight
    const thumbHeight = Math.max(MIN_THUMB_HEIGHT, Math.round(trackHeight * clientHeight / scrollHeight))
    const travel = Math.max(0, trackHeight - thumbHeight)
    const ratio = maxScroll > 0 ? Math.min(1, Math.max(0, scrollTop / maxScroll)) : 0
    thumb.style.height = `${thumbHeight}px`
    thumb.style.transform = `translateY(${Math.round(travel * ratio)}px)`
    dragRatio = travel > 0 ? maxScroll / travel : 0
  }

  const observer = new ResizeObserver(scheduleRefresh)
  observer.observe(el)
  observer.observe(host)
  let children = new Set<Element>()

  function refresh() {
    // 正文的盒子没变时，表格或列表仍可能因异步内容而改变滚动范围。
    const nextChildren = new Set(el.children)
    for (const child of children) {
      if (!nextChildren.has(child))
        observer.unobserve(child)
    }
    for (const child of nextChildren) {
      if (!children.has(child))
        observer.observe(child)
    }
    children = nextChildren

    const { overflowX, overflowY, visibility } = getComputedStyle(el)
    const needsNativeX = overflowX === 'scroll' || (isScrollable(overflowX) && el.scrollWidth > el.clientWidth)
    active = visibility === 'visible' && el.offsetParent === host && isScrollable(overflowY)
      && !needsNativeX && el.scrollHeight > el.clientHeight
      && el.clientHeight > TRACK_INSET_TOP + TRACK_INSET_BOTTOM + MIN_THUMB_HEIGHT
      && el.clientWidth > TRACK_WIDTH + TRACK_GAP

    el.classList.toggle('has-floating-scrollbar', active)
    track.style.display = active ? '' : 'none'
    if (!active) {
      stopDrag()
      track.classList.remove('is-visible')
      lastScrollTop = el.scrollTop
      return
    }

    // offset 相对父级 padding box，包含实际留白；只覆盖正文的滚动口，避开固定分页等兄弟节点。
    trackHeight = el.clientHeight - TRACK_INSET_TOP - TRACK_INSET_BOTTOM
    track.style.top = `${el.offsetTop + el.clientTop + TRACK_INSET_TOP}px`
    track.style.left = `${el.offsetLeft + el.clientLeft + el.clientWidth - TRACK_WIDTH - TRACK_GAP}px`
    track.style.height = `${trackHeight}px`
    updateThumb()
  }

  el.addEventListener('scroll', () => {
    // 忽略没有实际纵向位移的事件，横滚也不会点亮竖向滑块。
    const top = el.scrollTop
    if (top === lastScrollTop)
      return
    lastScrollTop = top
    if (active) {
      updateThumb()
      show()
    }
  }, { passive: true, signal })
  el.addEventListener('pointermove', show, { passive: true, signal })
  el.addEventListener('pointerenter', show, { signal })
  el.addEventListener('pointerleave', scheduleHide, { signal })
  el.addEventListener('focusin', show, { signal })
  el.addEventListener('focusout', scheduleHide, { signal })
  thumb.addEventListener('pointerdown', (event) => {
    if (!active || dragPointer !== null || event.button !== 0 || dragRatio <= 0)
      return
    dragPointer = event.pointerId
    dragStartY = event.clientY
    dragStartScroll = el.scrollTop
    thumb.setPointerCapture(event.pointerId)
    show()
    event.preventDefault()
  }, { signal })
  thumb.addEventListener('pointermove', (event) => {
    if (event.pointerId === dragPointer)
      el.scrollTop = dragStartScroll + (event.clientY - dragStartY) * dragRatio
  }, { signal })
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    thumb.addEventListener(type, (event) => {
      if (event.pointerId === dragPointer)
        stopDrag()
    }, { signal })
  }

  return {
    host,
    refresh,
    cleanup() {
      controller.abort()
      observer.disconnect()
      active = false
      stopDrag()
      el.classList.remove('has-floating-scrollbar')
      track.remove()
      releaseHost()
    },
  }
}

function isTrackNode(node: Node) {
  return node instanceof Element && !!node.closest('.fsb-track')
}

/** 在页面正文统一发现面板滚动区；路由切换或筛选替换节点时按原节点清理。 */
export function usePanelFloatingScrollbars(root: Ref<HTMLElement | null>) {
  watch(root, (el, _previous, onCleanup) => {
    if (!el)
      return

    const page = el

    const bindings = new Map<HTMLElement, ReturnType<typeof attachFloatingScrollbar>>()
    let frame: number | undefined

    function refresh() {
      frame = undefined
      const panels = new Set(page.querySelectorAll<HTMLElement>(PANEL_SCROLL_SELECTOR))
      for (const [el, binding] of bindings) {
        if (!panels.has(el) || el.parentElement !== binding.host) {
          binding.cleanup()
          bindings.delete(el)
        }
      }
      for (const el of panels) {
        let binding = bindings.get(el)
        if (!binding && el.parentElement) {
          binding = attachFloatingScrollbar(el, el.parentElement, scheduleRefresh)
          bindings.set(el, binding)
        }
        binding?.refresh()
      }
    }

    function scheduleRefresh() {
      frame ??= requestAnimationFrame(refresh)
    }

    const observer = new MutationObserver((records) => {
      // 轨道插入、移除或更新自身样式时，不再次触发扫描。
      if (records.some(record => !isTrackNode(record.target) && (record.type !== 'childList'
        || [...record.addedNodes, ...record.removedNodes].some(node => !isTrackNode(node))))) {
        scheduleRefresh()
      }
    })
    observer.observe(page, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden'],
    })
    refresh()

    onCleanup(() => {
      observer.disconnect()
      if (frame !== undefined)
        cancelAnimationFrame(frame)
      for (const binding of bindings.values())
        binding.cleanup()
    })
  }, { immediate: true, flush: 'post' })
}
