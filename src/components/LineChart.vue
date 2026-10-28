<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

export interface LineSeries {
  name: string
  color: string
  values: number[]
  dashed?: boolean
}
const props = withDefaults(
  defineProps<{ series: LineSeries[]; labels: string[]; height?: number; yFormat?: (v: number) => string; baseline?: number; percent?: boolean; area?: boolean }>(),
  { height: 200, percent: false, area: false },
)
const wrap = ref<HTMLDivElement>()
const cv = ref<HTMLCanvasElement>()
const hover = ref<number | null>(null)
const tip = ref<{ x: number; y: number; lines: string[] } | null>(null)
let ro: ResizeObserver | null = null

function cssVar(n: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888'
}
function norm(s: LineSeries) {
  if (!props.percent) return s.values
  const b = s.values.find((v) => isFinite(v) && v !== 0) ?? 1
  return s.values.map((v) => v / b - 1)
}
function fmt(v: number) {
  if (props.yFormat) return props.yFormat(v)
  if (props.percent) return (v * 100).toFixed(2) + '%'
  return Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2)
}

function draw() {
  const c = cv.value
  const w0 = wrap.value
  if (!c || !w0) return
  const W = Math.max(100, w0.clientWidth)
  const H = props.height
  const dpr = window.devicePixelRatio || 1
  c.width = W * dpr
  c.height = H * dpr
  c.style.width = W + 'px'
  c.style.height = H + 'px'
  const g = c.getContext('2d')!
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, W, H)
  const data = props.series.map(norm)
  const n = Math.max(0, ...data.map((d) => d.length))
  if (n < 2) {
    g.fillStyle = cssVar('--dim')
    g.font = '12px sans-serif'
    g.fillText('数据不足', 10, 20)
    return
  }
  let min = Infinity
  let max = -Infinity
  for (const d of data) for (const v of d) if (isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v) }
  const base = props.percent ? 0 : props.baseline
  if (base !== undefined) { min = Math.min(min, base); max = Math.max(max, base) }
  const pad = (max - min) * 0.08 || 1
  min -= pad
  max += pad
  const L = 8, R = 62, T = 8, B = 22
  const X = (i: number) => L + (i / (n - 1)) * (W - L - R)
  const Y = (v: number) => T + (1 - (v - min) / (max - min)) * (H - T - B)
  g.strokeStyle = cssVar('--border')
  g.globalAlpha = 0.5
  g.lineWidth = 1
  g.font = '11px ' + cssVar('--font-body')
  g.fillStyle = cssVar('--muted')
  for (let k = 0; k <= 4; k++) {
    const v = min + ((max - min) * k) / 4
    const y = Math.round(Y(v)) + 0.5
    g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke()
    g.globalAlpha = 1
    g.fillText(fmt(v), W - R + 4, y + 4)
    g.globalAlpha = 0.5
  }
  g.globalAlpha = 1
  const step = Math.max(1, Math.ceil(n / 6))
  for (let i = 0; i < n; i += step) g.fillText(props.labels[i] ?? '', Math.min(W - R - 40, X(i)), H - 6)
  if (base !== undefined) {
    g.setLineDash([3, 4]); g.strokeStyle = cssVar('--muted')
    g.beginPath(); g.moveTo(L, Y(base)); g.lineTo(W - R, Y(base)); g.stroke(); g.setLineDash([])
  }
  data.forEach((d, si) => {
    const s = props.series[si]
    g.strokeStyle = s.color
    g.lineWidth = 2
    if (s.dashed) g.setLineDash([5, 4])
    g.beginPath()
    d.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))))
    g.stroke()
    g.setLineDash([])
    if (props.area && si === 0) {
      g.lineTo(X(d.length - 1), H - B); g.lineTo(X(0), H - B); g.closePath()
      g.globalAlpha = 0.12; g.fillStyle = s.color; g.fill(); g.globalAlpha = 1
    }
  })
  if (hover.value !== null && hover.value < n) {
    const x = X(hover.value)
    g.strokeStyle = cssVar('--accent'); g.lineWidth = 1
    g.beginPath(); g.moveTo(x, T); g.lineTo(x, H - B); g.stroke()
    const lines = [props.labels[hover.value] ?? '']
    data.forEach((d, si) => {
      const v = d[hover.value!]
      if (v === undefined) return
      g.fillStyle = props.series[si].color
      g.fillRect(x - 3, Y(v) - 3, 6, 6)
      lines.push(`${props.series[si].name}：${fmt(v)}`)
    })
    tip.value = { x: Math.min(x + 10, W - 170), y: 8, lines }
  } else tip.value = null
}

function onMove(ev: MouseEvent | TouchEvent) {
  const c = cv.value
  if (!c) return
  const rect = c.getBoundingClientRect()
  const cx = 'touches' in ev ? ev.touches[0].clientX : ev.clientX
  const n = Math.max(0, ...props.series.map((s) => s.values.length))
  const L = 8, R = 62
  const i = Math.round(((cx - rect.left - L) / (rect.width - L - R)) * (n - 1))
  hover.value = Math.max(0, Math.min(n - 1, i))
  draw()
}
function onLeave() {
  hover.value = null
  draw()
}
onMounted(() => {
  draw()
  ro = new ResizeObserver(() => draw())
  if (wrap.value) ro.observe(wrap.value)
})
onBeforeUnmount(() => ro?.disconnect())
watch(() => [props.series, props.labels, props.height], draw, { deep: true })
</script>

<template>
  <div ref="wrap" class="lc" :style="{ height: height + 'px' }">
    <canvas ref="cv" role="img" :aria-label="series.map((s) => s.name).join('、') + ' 折线图'" @mousemove="onMove" @mouseleave="onLeave" @touchstart.passive="onMove" @touchmove.passive="onMove" @touchend="onLeave" />
    <div v-if="tip" class="tip" :style="{ left: tip.x + 'px', top: tip.y + 'px' }">
      <div v-for="(l, i) in tip.lines" :key="i" :class="i ? '' : 'muted'">{{ l }}</div>
    </div>
  </div>
</template>

<style scoped>
.lc { position: relative; width: 100%; }
.tip { position: absolute; pointer-events: none; background: var(--panel3); box-shadow: 0 0 0 1px var(--border-hi); padding: 4px 8px; font-size: 0.8em; white-space: nowrap; z-index: 2; }
</style>
