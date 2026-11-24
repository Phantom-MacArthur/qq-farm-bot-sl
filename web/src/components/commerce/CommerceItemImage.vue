<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  src?: string
  alt?: string
  size?: 'sm' | 'md' | 'lg'
  fitVisiblePixels?: boolean
}>(), {
  src: '',
  alt: '',
  size: 'md',
})

const failed = ref(false)
const fittedStyle = ref<CSSProperties>()
watch(() => props.src, () => {
  failed.value = false
  fittedStyle.value = undefined
})

function fitImage(event: Event) {
  const img = event.currentTarget as HTMLImageElement
  if (!props.fitVisiblePixels || !img.naturalWidth || !img.naturalHeight)
    return

  const canvas = document.createElement('canvas')
  const reduction = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight))
  const width = canvas.width = Math.max(1, Math.round(img.naturalWidth * reduction))
  const height = canvas.height = Math.max(1, Math.round(img.naturalHeight * reduction))
  const context = canvas.getContext('2d')
  if (!context)
    return

  try {
    context.drawImage(img, 0, 0, width, height)
    const { data } = context.getImageData(0, 0, width, height)
    let left = width
    let top = height
    let right = 0
    let bottom = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3]) {
          left = Math.min(left, x)
          top = Math.min(top, y)
          right = Math.max(right, x + 1)
          bottom = Math.max(bottom, y + 1)
        }
      }
    }
    if (right <= left || bottom <= top)
      return

    const extent = Math.max(right - left, bottom - top)
    const percent = (pixels: number) => `${pixels / extent * 100}%`
    fittedStyle.value = {
      position: 'absolute',
      width: percent(width),
      height: percent(height),
      maxWidth: 'none',
      left: percent((extent - (right - left)) / 2 - left),
      top: percent((extent - (bottom - top)) / 2 - top),
    }
  }
  catch {
    // Cross-origin images keep their standard object-fit layout.
  }
}
</script>

<template>
  <div class="item-image" :class="[`item-image--${size}`, { 'item-image--fit-visible': fitVisiblePixels }]">
    <img v-if="src && !failed" :src="src" :alt="alt" :style="fittedStyle" @load="fitImage" @error="failed = true">
    <div v-else class="i-carbon-image text-gray-400" aria-hidden="true" />
  </div>
</template>

<style scoped>
.item-image {
  display: grid;
  place-items: center;
  flex: none;
  overflow: hidden;
  border: 1px solid rgba(125, 101, 68, 0.14);
  border-radius: 8px;
}
.item-image img {
  width: 88%;
  height: 88%;
  object-fit: contain;
  image-rendering: auto;
}
.item-image--fit-visible {
  position: relative;
  border-radius: 0;
}
.item-image--sm {
  width: 36px;
  height: 36px;
}
.item-image--md {
  width: 64px;
  height: 64px;
}
.item-image--lg {
  width: clamp(112px, 18vw, 164px);
  height: clamp(112px, 18vw, 164px);
}
</style>
