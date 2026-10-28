<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { Profile } from '../engine/profile'
import { drawCharacter, px, type Emotion } from '../pixel/sprites'

const props = withDefaults(defineProps<{ avatar: Profile['avatar']; size?: number; emotion?: string }>(), { size: 96, emotion: 'idle' })
const cv = ref<HTMLCanvasElement>()
function draw() {
  const c = cv.value
  if (!c) return
  const g = c.getContext('2d')!
  g.clearRect(0, 0, 24, 24)
  px(g, 0, 0, 24, 24, '#243050')
  px(g, 0, 18, 24, 6, '#1d2740')
  drawCharacter(g, 12, 21, { ...props.avatar }, 0, props.emotion as Emotion, 1)
}
onMounted(draw)
watch(() => [props.avatar, props.emotion], draw, { deep: true })
</script>

<template>
  <canvas ref="cv" width="24" height="24" :style="{ width: size + 'px', height: size + 'px', imageRendering: 'pixelated', boxShadow: '0 0 0 2px var(--border)' }" role="img" aria-label="玩家像素形象" />
</template>
