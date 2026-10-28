<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useGame } from '../store/game'
import { useSettings } from '../store/settings'
import { fmtPrice, fmtQty, fmtPct } from '../engine/util'
import { fmtClock } from '../engine/clock'
import type { Bar } from '../engine/state'

const props = withDefaults(defineProps<{ symbol: string; mode: 'intraday' | 'day' | 'week'; height?: number }>(), { height: 340 })
const game = useGame()
const settings = useSettings()

const overlay = ref<'MA' | 'BOLL' | 'none'>('MA')
const sub = ref<'VOL' | 'MACD' | 'RSI'>('VOL')
const showTable = ref(settings.s.showChartTable)
const count = ref(90)
const offset = ref(0)
const hover = ref<number | null>(null)
const wrap = ref<HTMLDivElement>()
const cv = ref<HTMLCanvasElement>()
let ro: ResizeObserver | null = null

interface CBar extends Bar {
  label: string
}

/** 全部 K 线（每次 rev 计算一次；绘制仅遍历可见区间） */
const bars = computed<CBar[]>(() => {
  game.rev
  const e = game.engine
  if (!e) return []
  const st = e.w.stocks[props.symbol]
  if (!st) return []
  if (props.mode === 'intraday') return st.minute.map((b) => ({ ...b, label: fmtClock(b.t % 1440) }))
  const td = e.w.clock.tradingDay
  const daily: Bar[] = st.daily.slice()
  const lastT = daily.length ? daily[daily.length - 1].t : -1e9
  if (st.minute.length && lastT < td) daily.push({ t: td, o: st.open, h: st.high, l: st.low, c: st.last, v: st.volume, a: st.amount })
  if (props.mode === 'day') return daily.map((b) => ({ ...b, label: e.cal.short(b.t) }))
  const out: CBar[] = []
  for (const b of daily) {
    const g = Math.floor((b.t + 10000) / 5)
    const prev = out[out.length - 1]
    if (prev && Math.floor((prev.t + 10000) / 5) === g) {
      prev.h = Math.max(prev.h, b.h)
      prev.l = Math.min(prev.l, b.l)
      prev.c = b.c
      prev.v += b.v
      prev.a += b.a
    } else out.push({ ...b, label: e.cal.short(b.t) })
  }
  return out
})

function sma(src: number[], n: number): (number | null)[] {
  const out: (number | null)[] = []
  let s = 0
  for (let i = 0; i < src.length; i++) {
    s += src[i]
    if (i >= n) s -= src[i - n]
    out.push(i >= n - 1 ? s / n : null)
  }
  return out
}
function ema(src: number[], n: number): number[] {
  const k = 2 / (n + 1)
  const out: number[] = []
  src.forEach((v, i) => out.push(i ? v * k + out[i - 1] * (1 - k) : v))
  return out
}

const ind = computed(() => {
  const c = bars.value.map((b) => b.c)
  const ma5 = sma(c, 5), ma10 = sma(c, 10), ma20 = sma(c, 20)
  const up: (number | null)[] = [], dn: (number | null)[] = []
  for (let i = 0; i < c.length; i++) {
    if (i < 19) { up.push(null); dn.push(null); continue }
    const w = c.slice(i - 19, i + 1)
    const m = ma20[i]!
    const sd = Math.sqrt(w.reduce((a, x) => a + (x - m) ** 2, 0) / 20)
    up.push(m + 2 * sd); dn.push(m - 2 * sd)
  }
  const e12 = ema(c, 12), e26 = ema(c, 26)
  const dif = c.map((_, i) => e12[i] - e26[i])
  const dea = ema(dif, 9)
  const hist = dif.map((d, i) => (d - dea[i]) * 2)
  const rsi: (number | null)[] = []
  let ag = 0, al = 0
  for (let i = 0; i < c.length; i++) {
    if (i === 0) { rsi.push(null); continue }
    const d = c[i] - c[i - 1]
    const g = Math.max(0, d), l = Math.max(0, -d)
    if (i <= 14) { ag += g / 14; al += l / 14 } else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14 }
    rsi.push(i >= 14 ? (al === 0 ? 100 : 100 - 100 / (1 + ag / al)) : null)
  }
  // 分时均价（VWAP）
  let cv2 = 0, cq = 0
  const vwap = bars.value.map((b) => { cv2 += b.a; cq += b.v; return cq ? cv2 / cq : b.c })
  return { ma5, ma10, ma20, up, dn, dif, dea, hist, rsi, vwap }
})

const markers = computed(() => {
  game.rev
  const e = game.engine
  if (!e) return { execs: [] as { key: number; side: 'B' | 'S'; price: number }[], news: [] as { key: number; title: string; kind: 'news' | 'corp' }[] }
  const w = e.w
  const keyOf = (td: number, ts: number) => (props.mode === 'intraday' ? ts : props.mode === 'week' ? Math.floor((td + 10000) / 5) : td)
  const today = w.clock.tradingDay
  const execs = w.executions
    .filter((x) => x.symbol === props.symbol && (props.mode !== 'intraday' || x.tradingDay === today))
    .map((x) => ({ key: keyOf(x.tradingDay, x.ts), side: (x.side === 'buy' || x.side === 'cover' ? 'B' : 'S') as 'B' | 'S', price: x.price }))
  const news = [
    ...w.news.filter((n) => n.symbols.includes(props.symbol) && n.importance >= 2 && (props.mode !== 'intraday' || n.tradingDay === today)).map((n) => ({ key: keyOf(n.tradingDay, n.ts), title: n.title, kind: 'news' as const })),
    ...(props.mode === 'intraday' ? [] : w.actions.filter((a) => a.symbol === props.symbol).map((a) => ({ key: keyOf(a.announceDay, 0), title: a.title, kind: 'corp' as const }))),
  ]
  return { execs, news }
})

function barKey(b: CBar): number {
  return props.mode === 'week' ? Math.floor((b.t + 10000) / 5) : b.t
}

const visible = computed(() => {
  const n = bars.value.length
  if (props.mode === 'intraday') return { start: 0, end: n, slots: Math.max(n, game.engine?.T ?? 240) }
  const cnt = Math.min(Math.max(20, count.value), Math.max(20, n))
  const off = Math.min(Math.max(0, offset.value), Math.max(0, n - cnt))
  const end = n - off
  return { start: Math.max(0, end - cnt), end, slots: cnt }
})

function cssVar(n: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888'
}

function draw() {
  const c = cv.value, wr = wrap.value
  if (!c || !wr) return
  const W = Math.max(200, wr.clientWidth)
  const H = props.height
  const dpr = window.devicePixelRatio || 1
  c.width = W * dpr; c.height = H * dpr
  c.style.width = W + 'px'; c.style.height = H + 'px'
  const g = c.getContext('2d')!
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, W, H)
  const UP = cssVar('--up'), DN = cssVar('--down'), MUT = cssVar('--muted'), BOR = cssVar('--border'), ACC = cssVar('--accent'), AC2 = cssVar('--accent2'), TXT = cssVar('--text')
  const { start, end, slots } = visible.value
  const vis = bars.value.slice(start, end)
  g.font = '11px sans-serif'
  if (!vis.length) {
    g.fillStyle = MUT
    g.fillText(props.mode === 'intraday' ? '今日尚未开盘，暂无分时数据' : '暂无数据', 12, 24)
    return
  }
  const L = 4, R = 60, T = 6
  const mainH = Math.round(H * 0.66), subTop = mainH + 18, subH = H - subTop - 16
  const slotW = (W - L - R) / slots
  const X = (i: number) => L + (i + 0.5) * slotW
  const e = game.engine!
  const st = e.w.stocks[props.symbol]
  let hi = -Infinity, lo = Infinity
  for (let i = start; i < end; i++) {
    const b = bars.value[i]
    hi = Math.max(hi, b.h); lo = Math.min(lo, b.l)
    if (overlay.value === 'BOLL' && props.mode !== 'intraday') {
      const u = ind.value.up[i], d = ind.value.dn[i]
      if (u !== null) hi = Math.max(hi, u)
      if (d !== null) lo = Math.min(lo, d)
    }
  }
  if (props.mode === 'intraday') { hi = Math.max(hi, st.prevClose); lo = Math.min(lo, st.prevClose) }
  const pad = (hi - lo) * 0.08 || hi * 0.01 || 1
  hi += pad; lo -= pad
  const Y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (mainH - T)
  // 网格与刻度
  g.strokeStyle = BOR; g.globalAlpha = 0.45; g.lineWidth = 1
  g.fillStyle = MUT
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4
    const y = Math.round(Y(v)) + 0.5
    g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke()
    g.globalAlpha = 1
    g.fillText(fmtPrice(v), W - R + 4, y + 4)
    if (props.mode === 'intraday' && st.prevClose) g.fillText(fmtPct(v / st.prevClose - 1, 1), W - R + 4, y + 15 > mainH ? y - 6 : y + 15)
    g.globalAlpha = 0.45
  }
  g.globalAlpha = 1
  // x 标签
  const step = Math.max(1, Math.ceil(vis.length / 6))
  for (let i = 0; i < vis.length; i += step) g.fillText(vis[i].label, Math.min(W - R - 36, X(i) - 14), H - 3)
  if (props.mode === 'intraday') {
    // 昨收基线
    g.setLineDash([4, 4]); g.strokeStyle = MUT
    g.beginPath(); g.moveTo(L, Y(st.prevClose)); g.lineTo(W - R, Y(st.prevClose)); g.stroke(); g.setLineDash([])
    g.strokeStyle = AC2; g.lineWidth = 1.6
    g.beginPath(); vis.forEach((b, i) => (i ? g.lineTo(X(i), Y(b.c)) : g.moveTo(X(i), Y(b.c)))); g.stroke()
    g.strokeStyle = ACC; g.lineWidth = 1.2
    g.beginPath(); vis.forEach((_, i) => { const v = ind.value.vwap[start + i]; i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)) }); g.stroke()
  } else {
    const bw = Math.max(1, Math.floor(slotW * 0.7))
    vis.forEach((b, i) => {
      const col = b.c >= b.o ? UP : DN
      g.strokeStyle = col; g.fillStyle = col
      const x = Math.round(X(i))
      g.beginPath(); g.moveTo(x + 0.5, Y(b.h)); g.lineTo(x + 0.5, Y(b.l)); g.stroke()
      const y1 = Y(Math.max(b.o, b.c)), y2 = Y(Math.min(b.o, b.c))
      const h = Math.max(1, y2 - y1)
      if (b.c >= b.o) g.strokeRect(x - bw / 2 + 0.5, y1 + 0.5, bw, h)
      else g.fillRect(x - bw / 2, y1, bw, h)
    })
    const line = (arr: (number | null)[], color: string) => {
      g.strokeStyle = color; g.lineWidth = 1.2; g.beginPath()
      let started = false
      for (let i = start; i < end; i++) {
        const v = arr[i]
        if (v === null) continue
        const x = X(i - start), y = Y(v)
        if (!started) { g.moveTo(x, y); started = true } else g.lineTo(x, y)
      }
      g.stroke()
    }
    if (overlay.value === 'MA') { line(ind.value.ma5, '#f4c95d'); line(ind.value.ma10, '#6fd3e8'); line(ind.value.ma20, '#c3a6ff') }
    if (overlay.value === 'BOLL') { line(ind.value.ma20, '#f4c95d'); line(ind.value.up, '#6fd3e8'); line(ind.value.dn, '#6fd3e8') }
  }
  // 标记：成交与新闻
  const keyIndex = new Map<number, number>()
  vis.forEach((b, i) => keyIndex.set(props.mode === 'intraday' ? b.t : barKey(b), i))
  g.font = 'bold 10px sans-serif'
  for (const m of markers.value.execs) {
    const i = keyIndex.get(m.key)
    if (i === undefined) continue
    const x = X(i), y = Y(m.price)
    g.fillStyle = m.side === 'B' ? UP : DN
    g.beginPath()
    if (m.side === 'B') { g.moveTo(x, y + 4); g.lineTo(x - 5, y + 12); g.lineTo(x + 5, y + 12) } else { g.moveTo(x, y - 4); g.lineTo(x - 5, y - 12); g.lineTo(x + 5, y - 12) }
    g.fill()
    g.fillStyle = TXT
    g.fillText(m.side, x - 3, m.side === 'B' ? y + 22 : y - 14)
  }
  for (const m of markers.value.news) {
    const i = keyIndex.get(m.key)
    if (i === undefined) continue
    g.fillStyle = m.kind === 'corp' ? '#c3a6ff' : ACC
    g.fillRect(Math.round(X(i)) - 3, T, 6, 6)
  }
  // 副图
  const subVals = (i: number) => bars.value[i]
  g.strokeStyle = BOR; g.globalAlpha = 0.5
  g.beginPath(); g.moveTo(L, subTop - 4); g.lineTo(W - R, subTop - 4); g.stroke(); g.globalAlpha = 1
  g.fillStyle = MUT; g.font = '10px sans-serif'
  if (sub.value === 'VOL' || props.mode === 'intraday') {
    let vmax = 1
    for (let i = start; i < end; i++) vmax = Math.max(vmax, subVals(i).v)
    g.fillText('成交量 ' + fmtQty(Math.round(vmax)), W - R + 4, subTop + 8)
    vis.forEach((b, i) => {
      const h = (b.v / vmax) * subH
      const prevC = i > 0 ? vis[i - 1].c : props.mode === 'intraday' ? st.prevClose : b.o
      g.fillStyle = (props.mode === 'intraday' ? b.c >= prevC : b.c >= b.o) ? UP : DN
      g.globalAlpha = 0.75
      g.fillRect(X(i) - Math.max(1, slotW * 0.35), subTop + subH - h, Math.max(1, slotW * 0.7), h)
    })
    g.globalAlpha = 1
  } else if (sub.value === 'MACD') {
    let m = 1e-9
    for (let i = start; i < end; i++) m = Math.max(m, Math.abs(ind.value.hist[i]), Math.abs(ind.value.dif[i]), Math.abs(ind.value.dea[i]))
    const SY = (v: number) => subTop + subH / 2 - (v / m) * (subH / 2)
    for (let i = start; i < end; i++) {
      const v = ind.value.hist[i]
      g.fillStyle = v >= 0 ? UP : DN
      g.fillRect(X(i - start) - 1, Math.min(SY(0), SY(v)), 2, Math.abs(SY(v) - SY(0)))
    }
    const ln = (arr: number[], col: string) => { g.strokeStyle = col; g.beginPath(); for (let i = start; i < end; i++) (i === start ? g.moveTo : g.lineTo).call(g, X(i - start), SY(arr[i])); g.stroke() }
    ln(ind.value.dif, '#f4c95d'); ln(ind.value.dea, '#6fd3e8')
    g.fillStyle = MUT; g.fillText('MACD(12,26,9)', W - R + 4, subTop + 8)
  } else {
    const SY = (v: number) => subTop + (1 - v / 100) * subH
    g.setLineDash([3, 3]); g.strokeStyle = MUT
    for (const lv of [30, 70]) { g.beginPath(); g.moveTo(L, SY(lv)); g.lineTo(W - R, SY(lv)); g.stroke() }
    g.setLineDash([])
    g.strokeStyle = '#c3a6ff'; g.beginPath()
    let s = false
    for (let i = start; i < end; i++) { const v = ind.value.rsi[i]; if (v === null) continue; s ? g.lineTo(X(i - start), SY(v)) : g.moveTo(X(i - start), SY(v)); s = true }
    g.stroke()
    g.fillStyle = MUT; g.fillText('RSI(14) 30/70', W - R + 4, subTop + 8)
  }
  // 十字线
  if (hover.value !== null && hover.value < vis.length) {
    const x = X(hover.value)
    const b = vis[hover.value]
    g.strokeStyle = ACC; g.lineWidth = 1; g.setLineDash([2, 2])
    g.beginPath(); g.moveTo(x, T); g.lineTo(x, H - 14); g.moveTo(L, Y(b.c)); g.lineTo(W - R, Y(b.c)); g.stroke(); g.setLineDash([])
    g.fillStyle = ACC; g.fillRect(W - R, Y(b.c) - 8, R, 16)
    g.fillStyle = '#241a05'; g.font = 'bold 11px sans-serif'; g.fillText(fmtPrice(b.c), W - R + 4, Y(b.c) + 4)
  }
}

const tip = computed(() => {
  if (hover.value === null) return null
  const { start } = visible.value
  const i = start + hover.value
  const b = bars.value[i]
  if (!b) return null
  const prev = bars.value[i - 1]
  const base = props.mode === 'intraday' ? game.engine?.w.stocks[props.symbol].prevClose ?? b.o : prev?.c ?? b.o
  const evs = markers.value.news.filter((m) => m.key === (props.mode === 'intraday' ? b.t : barKey(b))).map((m) => m.title)
  return { b, chg: base ? b.c / base - 1 : 0, vwap: props.mode === 'intraday' ? ind.value.vwap[i] : null, evs }
})

// ---------------- 交互：缩放 / 平移 / 十字线 ----------------
let dragX: number | null = null
let dragOff = 0
let pinchD: number | null = null
let pinchCount = 0
function idxAt(clientX: number) {
  const c = cv.value!
  const r = c.getBoundingClientRect()
  const slotW = (r.width - 64) / visible.value.slots
  return Math.max(0, Math.min(visible.value.end - visible.value.start - 1, Math.floor((clientX - r.left - 4) / slotW)))
}
function onWheel(ev: WheelEvent) {
  if (props.mode === 'intraday') return
  ev.preventDefault()
  count.value = Math.round(Math.min(Math.max(20, count.value * (ev.deltaY > 0 ? 1.15 : 0.87)), Math.max(20, bars.value.length)))
}
function onDown(ev: MouseEvent) {
  dragX = ev.clientX
  dragOff = offset.value
}
function onMove(ev: MouseEvent) {
  if (dragX !== null && props.mode !== 'intraday') {
    const r = cv.value!.getBoundingClientRect()
    const slotW = (r.width - 64) / visible.value.slots
    offset.value = Math.max(0, Math.round(dragOff + (ev.clientX - dragX) / slotW))
  }
  hover.value = idxAt(ev.clientX)
}
function onUp() {
  dragX = null
}
function onLeave() {
  dragX = null
  hover.value = null
}
function onTouchStart(ev: TouchEvent) {
  if (ev.touches.length === 2) {
    pinchD = Math.abs(ev.touches[0].clientX - ev.touches[1].clientX)
    pinchCount = count.value
  } else {
    dragX = ev.touches[0].clientX
    dragOff = offset.value
    hover.value = idxAt(ev.touches[0].clientX)
  }
}
function onTouchMove(ev: TouchEvent) {
  if (ev.touches.length === 2 && pinchD && props.mode !== 'intraday') {
    const d = Math.abs(ev.touches[0].clientX - ev.touches[1].clientX)
    count.value = Math.round(Math.min(Math.max(20, (pinchCount * pinchD) / Math.max(10, d)), Math.max(20, bars.value.length)))
  } else if (ev.touches.length === 1) onMove({ clientX: ev.touches[0].clientX } as MouseEvent)
}
function onTouchEnd() {
  pinchD = null
  dragX = null
}
function resetView() {
  count.value = 90
  offset.value = 0
}

const summary = computed(() => {
  const vis = bars.value.slice(visible.value.start, visible.value.end)
  if (!vis.length) return '暂无数据'
  const hi = Math.max(...vis.map((b) => b.h)), lo = Math.min(...vis.map((b) => b.l))
  const first = vis[0], last = vis[vis.length - 1]
  const name = props.mode === 'intraday' ? '分时' : props.mode === 'day' ? '日K' : '周K'
  return `${props.symbol} ${name}：区间 ${first.label} 至 ${last.label}，最新 ${fmtPrice(last.c)}，最高 ${fmtPrice(hi)}，最低 ${fmtPrice(lo)}，区间涨跌 ${fmtPct(last.c / first.o - 1)}`
})
const tableRows = computed(() => bars.value.slice(-30).reverse())
const splitNote = computed(() => {
  game.rev
  const f = game.engine?.w.stocks[props.symbol]?.splitFactor ?? 1
  return f !== 1 && props.mode !== 'intraday' ? `图表已按拆/合股复权（累计因子 ${f}）` : ''
})

onMounted(() => {
  draw()
  ro = new ResizeObserver(() => draw())
  if (wrap.value) ro.observe(wrap.value)
})
onBeforeUnmount(() => ro?.disconnect())
watch([bars, overlay, sub, count, offset, hover, () => props.height, () => props.mode], draw)
watch(() => props.symbol, resetView)
</script>

<template>
  <div class="kchart">
    <div class="row wrap between mb-sm" style="margin-bottom: 6px">
      <div class="row wrap gap-sm">
        <template v-if="mode !== 'intraday'">
          <div class="seg" role="group" aria-label="主图指标">
            <button v-for="o in ['MA', 'BOLL', 'none'] as const" :key="o" :class="{ active: overlay === o }" @click="overlay = o">{{ o === 'none' ? '无' : o }}</button>
          </div>
          <div class="seg" role="group" aria-label="副图指标">
            <button v-for="o in ['VOL', 'MACD', 'RSI'] as const" :key="o" :class="{ active: sub === o }" @click="sub = o">{{ o }}</button>
          </div>
          <button class="btn btn-xs btn-ghost" title="重置缩放" @click="resetView">⟲</button>
        </template>
        <span v-if="mode !== 'intraday' && overlay === 'MA'" class="tiny"><span style="color: #f4c95d">MA5</span> <span style="color: #6fd3e8">MA10</span> <span style="color: #c3a6ff">MA20</span></span>
        <span v-if="mode === 'intraday'" class="tiny"><span style="color: var(--accent2)">— 价格</span> <span style="color: var(--accent)">— 均价</span> <span class="muted">--- 昨收</span></span>
      </div>
      <label class="check tiny"><input v-model="showTable" type="checkbox" />数据表格</label>
    </div>
    <div ref="wrap" class="cwrap" :style="{ height: height + 'px' }">
      <canvas
        ref="cv"
        role="img"
        :aria-label="summary"
        @wheel="onWheel"
        @mousedown="onDown"
        @mousemove="onMove"
        @mouseup="onUp"
        @mouseleave="onLeave"
        @touchstart.passive="onTouchStart"
        @touchmove.passive="onTouchMove"
        @touchend="onTouchEnd"
      />
      <div v-if="tip" class="ktip">
        <div class="muted">{{ tip.b.label }}</div>
        <div>开 {{ fmtPrice(tip.b.o) }} 高 {{ fmtPrice(tip.b.h) }}</div>
        <div>低 {{ fmtPrice(tip.b.l) }} 收 {{ fmtPrice(tip.b.c) }}</div>
        <div :class="tip.chg > 0 ? 'up' : tip.chg < 0 ? 'down' : 'flat'">{{ tip.chg > 0 ? '▲' : tip.chg < 0 ? '▼' : '■' }} {{ fmtPct(tip.chg) }}</div>
        <div v-if="tip.vwap !== null">均价 {{ fmtPrice(tip.vwap) }}</div>
        <div>量 {{ fmtQty(tip.b.v) }} 股</div>
        <div v-for="(t, i) in tip.evs.slice(0, 2)" :key="i" class="accent" style="white-space: normal; max-width: 200px">◆ {{ t }}</div>
      </div>
    </div>
    <div class="tiny muted mt-sm">
      {{ summary }}<span v-if="splitNote"> · {{ splitNote }}</span>
      <span class="hide-mobile"> · 滚轮缩放、拖动平移；■ 黄色=新闻 紫色=公司行动；▲B 买入 ▼S 卖出</span>
    </div>
    <div v-if="showTable" class="tbl-wrap mt-sm" style="max-height: 260px">
      <table class="tbl">
        <thead><tr><th>时间</th><th class="num">开</th><th class="num">高</th><th class="num">低</th><th class="num">收</th><th class="num">成交量（股）</th></tr></thead>
        <tbody>
          <tr v-for="b in tableRows" :key="b.t">
            <td>{{ b.label }}</td><td class="num">{{ fmtPrice(b.o) }}</td><td class="num">{{ fmtPrice(b.h) }}</td><td class="num">{{ fmtPrice(b.l) }}</td>
            <td class="num" :class="b.c >= b.o ? 'up' : 'down'">{{ fmtPrice(b.c) }}</td><td class="num">{{ fmtQty(b.v) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.cwrap { position: relative; width: 100%; }
.cwrap canvas { touch-action: pan-y; cursor: crosshair; }
.ktip { position: absolute; top: 8px; left: 8px; pointer-events: none; background: var(--panel3); box-shadow: 0 0 0 1px var(--border-hi); padding: 4px 8px; font-size: 0.78em; white-space: nowrap; font-variant-numeric: tabular-nums; }
</style>
