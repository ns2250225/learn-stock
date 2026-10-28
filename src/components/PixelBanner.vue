<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { LocationId } from '../engine/types'
import { NPCS } from '../engine/content/npcs'
import { useGame } from '../store/game'
import { useSettings } from '../store/settings'
import { applyTint, drawBuilding, drawCharacter, drawGround, drawLamp, drawSky, drawTree, LOCATION_NAMES, skyFor, type Emotion } from '../pixel/sprites'

const props = withDefaults(defineProps<{ scene: LocationId; height?: number }>(), { height: 110 })
const game = useGame()
const settings = useSettings()
const wrap = ref<HTMLDivElement>()
const cv = ref<HTMLCanvasElement>()
const SCALE = 2
const lineIdx = ref(0)
const npcs = computed(() => {
  const list = NPCS.filter((n) => n.location === props.scene)
  return list.length ? list : NPCS.slice(0, 1)
})
const allLines = computed(() => npcs.value.flatMap((n) => n.lines.map((l) => ({ n, l }))))
const current = computed(() => allLines.value[lineIdx.value % Math.max(1, allLines.value.length)])
const phase = computed(() => {
  game.rev
  return game.engine?.phase ?? 'continuous'
})

let raf = 0
let last = 0
let lineTimer: ReturnType<typeof setInterval> | null = null
let ro: ResizeObserver | null = null

function draw(t: number) {
  const c = cv.value
  const w0 = wrap.value
  if (!c || !w0) return
  const W = Math.max(80, Math.floor(w0.clientWidth / SCALE))
  const H = Math.floor(props.height / SCALE)
  if (c.width !== W || c.height !== H) {
    c.width = W
    c.height = H
  }
  const g = c.getContext('2d')!
  const motion = !settings.s.reduceMotion
  const tt = motion ? t : 0
  const sky = skyFor(phase.value)
  const ground = H - 10
  drawSky(g, W, H, sky, tt)
  drawGround(g, W, ground, H, sky.night)
  const bw = Math.min(70, Math.floor(W * 0.35))
  const bh = Math.min(ground - 8, 40)
  drawBuilding(g, props.scene, 8, ground, bw, bh, sky.night, tt, {})
  drawTree(g, bw + 18, ground + 2, sky.night)
  drawLamp(g, W - 12, ground + 4, sky.night)
  npcs.value.slice(0, 2).forEach((n, i) => {
    const x = bw + 34 + i * 20
    const talking = current.value?.n.id === n.id
    const emo: Emotion = talking ? (Math.floor(tt / 1500) % 3 === 0 ? 'think' : 'idle') : 'watching'
    drawCharacter(g, x, ground + 6, n.palette, motion && talking ? Math.floor(t / 400) % 2 : 0, emo, i ? -1 : 1)
  })
  applyTint(g, W, H, sky)
}

function loop(t: number) {
  raf = requestAnimationFrame(loop)
  if (t - last < 66) return // 横幅 15fps 即可
  last = t
  draw(t)
}

onMounted(() => {
  draw(0)
  if (!settings.s.reduceMotion) raf = requestAnimationFrame(loop)
  lineTimer = setInterval(() => lineIdx.value++, 6500)
  ro = new ResizeObserver(() => draw(performance.now()))
  if (wrap.value) ro.observe(wrap.value)
})
watch(
  () => [props.scene, phase.value, settings.s.reduceMotion],
  () => {
    cancelAnimationFrame(raf)
    draw(0)
    if (!settings.s.reduceMotion) raf = requestAnimationFrame(loop)
  },
)
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  if (lineTimer) clearInterval(lineTimer)
  ro?.disconnect()
})
</script>

<template>
  <div ref="wrap" class="banner" :style="{ height: height + 'px' }">
    <canvas ref="cv" class="banner-cv" :aria-label="LOCATION_NAMES[scene] + '像素场景'" role="img" />
    <div class="place pixel-sm">{{ LOCATION_NAMES[scene] }}</div>
    <div v-if="current" class="bubble" role="note" @click="lineIdx++">
      <b>{{ current.n.name }}</b><span class="muted tiny"> · {{ current.n.role }}</span>
      <div>{{ current.l }}</div>
    </div>
  </div>
</template>

<style scoped>
.banner {
  position: relative;
  width: 100%;
  overflow: hidden;
  box-shadow: 0 0 0 2px var(--border);
  margin-bottom: 12px;
}
.banner-cv {
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}
.place {
  position: absolute;
  left: 8px;
  top: 6px;
  background: #141828cc;
  color: #f4c95d;
  padding: 3px 6px;
}
.bubble {
  position: absolute;
  right: 8px;
  top: 8px;
  max-width: min(420px, 58%);
  background: #fffaf0;
  color: #2a2418;
  font-size: 0.82em;
  padding: 6px 9px;
  box-shadow: 0 0 0 2px #141828, 3px 3px 0 2px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  line-height: 1.45;
}
.bubble .muted {
  color: #6c6450;
}
@media (max-width: 600px) {
  .bubble {
    max-width: 64%;
    font-size: 0.74em;
  }
}
</style>
