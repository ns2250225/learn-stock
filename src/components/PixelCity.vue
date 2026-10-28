<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useGame } from '../store/game'
import { useSettings } from '../store/settings'
import { NPCS } from '../engine/content/npcs'
import { COMPANIES } from '../engine/content/companies'
import { SECTOR_MAP } from '../engine/content/sectors'
import type { LocationId, MarketPhase } from '../engine/types'
import Modal from './Modal.vue'
import Logo from './Logo.vue'
import Chg from './Chg.vue'
import { fmtPrice } from '../engine/util'
import {
  applyTint,
  drawBubble,
  drawBuilding,
  drawCar,
  drawCharacter,
  drawConfetti,
  drawGround,
  drawLamp,
  drawSky,
  drawTree,
  LOCATION_NAMES,
  LOCATION_PAGE,
  px,
  skyFor,
  type Emotion,
} from '../pixel/sprites'

const game = useGame()
const settings = useSettings()
const W = 400
const H = 170
const GROUND = 118
const cv = ref<HTMLCanvasElement>()
const hoverId = ref<LocationId | null>(null)
const dialog = ref<LocationId | null>(null)

interface B {
  id: LocationId
  x: number
  w: number
  h: number
}
const buildings: B[] = [
  { id: 'apartment', x: 6, w: 34, h: 58 },
  { id: 'academy', x: 46, w: 38, h: 50 },
  { id: 'library', x: 90, w: 38, h: 46 },
  { id: 'bank', x: 134, w: 36, h: 52 },
  { id: 'exchange', x: 176, w: 52, h: 66 },
  { id: 'broker', x: 234, w: 34, h: 60 },
  { id: 'newsroom', x: 274, w: 36, h: 72 },
  { id: 'cafe', x: 316, w: 32, h: 34 },
  { id: 'campus', x: 354, w: 40, h: 64 },
]

interface Walker {
  npc: (typeof NPCS)[number]
  x: number
  dir: number
  speed: number
  pause: number
}
const walkers: Walker[] = NPCS.slice(0, 10).map((n, i) => ({ npc: n, x: (i * 41) % W, dir: i % 2 ? 1 : -1, speed: 0.012 + (i % 4) * 0.004, pause: 0 }))
const cars = [
  { x: 0, color: '#e63946', dir: 1, y: 156, speed: 0.05 },
  { x: 200, color: '#457b9d', dir: -1, y: 146, speed: 0.04 },
  { x: 320, color: '#f4a261', dir: 1, y: 156, speed: 0.035 },
]

const market = computed(() => {
  game.rev
  const e = game.engine
  if (!e) return { phase: 'closed' as MarketPhase, chg: 0, ticker: '' }
  const idx = e.w.indices.PXC
  return {
    phase: e.phase,
    chg: idx.prevClose ? idx.value / idx.prevClose - 1 : 0,
    ticker: Object.values(e.w.stocks)
      .slice(0, 12)
      .map((s) => s.symbol + (s.last / 100).toFixed(2))
      .join(' '),
  }
})
const panic = computed(() => market.value.chg < -0.025)
const bull = computed(() => market.value.chg > 0.02)

let bellUntil = 0
watch(
  () => market.value.phase,
  (p, old) => {
    if (p === 'continuous' && old === 'opening') bellUntil = performance.now() + 3500
  },
)

let raf = 0
let last = 0
let lastT = 0

function draw(t: number) {
  const c = cv.value
  if (!c) return
  const g = c.getContext('2d')!
  const dt = Math.min(100, t - lastT)
  lastT = t
  const sky = skyFor(market.value.phase)
  const motion = !settings.s.reduceMotion
  const flash = !settings.s.reduceFlash && motion
  const tt = motion ? t : 0
  drawSky(g, W, H, sky, tt)
  // 远景
  for (let i = 0; i < 12; i++) px(g, i * 36, GROUND - 30 - ((i * 17) % 25), 30, 40, sky.night ? '#1a1f3a' : '#9fb7cf')
  drawGround(g, W, GROUND, H, sky.night)
  for (const b of buildings)
    drawBuilding(g, b.id, b.x, GROUND, b.w, b.h, sky.night, tt, {
      panic: panic.value && flash,
      bull: bull.value && motion,
      ticker: market.value.ticker,
      highlight: hoverId.value === b.id,
    })
  for (let x = 42; x < W; x += 44) drawTree(g, x, GROUND + 2, sky.night)
  for (let x = 20; x < W; x += 88) drawLamp(g, x, GROUND + 4, sky.night)
  // 招牌
  g.font = '6px monospace'
  // 行人
  for (const wk of walkers) {
    if (motion) {
      if (wk.pause > 0) wk.pause -= dt
      else {
        const sp = panic.value ? wk.speed * 3 : wk.speed
        wk.x += wk.dir * sp * dt
        if (wk.x < 4 || wk.x > W - 4) wk.dir *= -1
        if (Math.random() < 0.0008 * dt) wk.pause = 800 + Math.random() * 1500
      }
    }
    const frame = motion && wk.pause <= 0 ? Math.floor(t / 180) % 2 : 0
    let emo: Emotion = wk.pause > 0 ? 'watching' : 'idle'
    if (panic.value) emo = 'surprise'
    else if (bull.value && wk.pause > 0) emo = 'celebrate'
    else if (wk.npc.id === 'reporter_su' && wk.pause > 0) emo = 'phone'
    else if (wk.npc.id === 'analyst_chen' && wk.pause > 0) emo = 'think'
    drawCharacter(g, wk.x, GROUND + 14, wk.npc.palette, frame, emo, wk.dir)
  }
  for (const car of cars) {
    if (motion) {
      car.x += car.dir * car.speed * dt
      if (car.x > W + 20) car.x = -20
      if (car.x < -20) car.x = W + 20
    }
    drawCar(g, car.x, car.y, car.color, car.dir, sky.night)
  }
  applyTint(g, W, H, sky)
  if (panic.value && flash && Math.floor(t / 400) % 2) {
    g.globalAlpha = 0.12
    px(g, 0, 0, W, H, '#ff0000')
    g.globalAlpha = 1
  }
  if (bull.value && motion) drawConfetti(g, W, GROUND, t)
  // 开盘铃
  if (t < bellUntil) {
    const ex = buildings[4]
    const bx = ex.x + ex.w / 2 - 12
    drawBubble(g, bx - 8, GROUND - ex.h - 32, 40, 12)
    g.fillStyle = '#c1121f'
    g.font = 'bold 8px sans-serif'
    g.fillText('当~当~开盘!', bx - 6, GROUND - ex.h - 23)
    const sw = Math.floor(t / 150) % 2 ? 1 : -1
    px(g, ex.x + ex.w / 2 - 3 + sw, GROUND - ex.h - 18, 6, 5, '#f4c95d')
  }
  // 悬停名称
  if (hoverId.value) {
    const b = buildings.find((x) => x.id === hoverId.value)!
    const label = LOCATION_NAMES[b.id]
    g.font = 'bold 8px sans-serif'
    const tw = g.measureText(label).width + 6
    const lx = Math.max(2, Math.min(W - tw - 2, b.x + b.w / 2 - tw / 2))
    px(g, lx, GROUND - b.h - 14, tw, 11, '#141828')
    g.fillStyle = '#f4c95d'
    g.fillText(label, lx + 3, GROUND - b.h - 5)
  }
}

function loop(t: number) {
  raf = requestAnimationFrame(loop)
  if (t - last < 33) return // ~30fps
  last = t
  draw(t)
}

function hit(ev: MouseEvent): LocationId | null {
  const c = cv.value
  if (!c) return null
  const r = c.getBoundingClientRect()
  const x = ((ev.clientX - r.left) / r.width) * W
  const y = ((ev.clientY - r.top) / r.height) * H
  for (const b of buildings) if (x >= b.x && x <= b.x + b.w && y >= GROUND - b.h - 8 && y <= GROUND) return b.id
  return null
}
function onMove(ev: MouseEvent) {
  hoverId.value = hit(ev)
  if (settings.s.reduceMotion) draw(performance.now())
}
function onClick(ev: MouseEvent) {
  const id = hit(ev)
  if (id) visit(id)
}
function visit(id: LocationId) {
  const p = LOCATION_PAGE[id]
  // 交易所大楼对应的就是当前所在的市场大厅：打开大楼窗口，而不是「跳转到当前页」导致无反应
  if (id === 'exchange' || !p) {
    dialog.value = id
    return
  }
  if (p === game.page) {
    game.toast('info', `你已在${LOCATION_NAMES[id] ?? '该地点'}`)
    return
  }
  game.go(p)
}

const exchangeNpcs = computed(() => NPCS.filter((n) => n.location === 'exchange'))
const exchangeInfo = computed(() => {
  game.rev
  const e = game.engine
  if (!e) return null
  const w = e.w
  let up = 0, down = 0, flat = 0, lu = 0, ld = 0
  for (const st of Object.values(w.stocks)) {
    if (st.status === 'delisted') continue
    if (st.last > st.prevClose) up++
    else if (st.last < st.prevClose) down++
    else flat++
    if (e.rules.priceLimit.enabled && st.last >= st.limitUp) lu++
    if (e.rules.priceLimit.enabled && st.last <= st.limitDown) ld++
  }
  const idx = ['PXC', 'PX30'].map((id) => w.indices[id]).map((i) => ({ name: i.name, value: i.value, chg: i.value / i.prevClose - 1 }))
  const suspended = Object.values(w.stocks).filter((s) => s.status === 'suspended').length
  return { phase: e.phaseLabel, toClose: e.minutesToClose(), idx, up, down, flat, lu, ld, suspended, rules: e.rules.name }
})

const cafeNpcs = computed(() => NPCS.filter((n) => n.location === 'cafe'))
const campusNpcs = computed(() => NPCS.filter((n) => n.location === 'campus'))
const companies = computed(() => {
  game.rev
  const e = game.engine
  return COMPANIES.map((c) => ({ c, st: e?.w.stocks[c.symbol] }))
})

onMounted(() => {
  if (settings.s.reduceMotion) draw(0)
  else raf = requestAnimationFrame(loop)
})
watch(
  () => settings.s.reduceMotion,
  (rm) => {
    cancelAnimationFrame(raf)
    if (rm) draw(0)
    else raf = requestAnimationFrame(loop)
  },
)
watch(
  () => game.rev,
  () => {
    if (settings.s.reduceMotion) draw(0)
  },
)
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <div class="city">
    <canvas
      ref="cv"
      :width="W"
      :height="H"
      class="city-cv"
      :style="{ cursor: hoverId ? 'pointer' : 'default' }"
      role="img"
      aria-label="像素证券城地图：点击建筑进入对应功能"
      @mousemove="onMove"
      @mouseleave="hoverId = null"
      @click="onClick"
    />
    <div class="loc-list" role="navigation" aria-label="城市地点">
      <button v-for="b in buildings" :key="b.id" class="btn btn-xs" @click="visit(b.id)" @focus="hoverId = b.id" @blur="hoverId = null">
        {{ LOCATION_NAMES[b.id] }}
      </button>
    </div>
    <div v-if="panic" class="tag tag-danger city-flag">市场恐慌：综指跌幅超过 2.5%</div>
    <div v-else-if="bull" class="tag tag-ok city-flag">市场热闹：综指涨幅超过 2%</div>

    <Modal v-if="dialog === 'exchange' && exchangeInfo" title="交易所大楼" @close="dialog = null">
      <div class="row wrap mb">
        <span class="tag tag-accent">{{ exchangeInfo.phase }}</span>
        <span v-if="exchangeInfo.toClose" class="small muted">距收盘 {{ exchangeInfo.toClose }} 分钟</span>
        <span class="small muted">规则包：{{ exchangeInfo.rules }}</span>
      </div>
      <div class="grid-2 mb">
        <div v-for="i in exchangeInfo.idx" :key="i.name" class="panel inset">
          <div class="small muted">{{ i.name }}</div>
          <div class="row between"><span class="mid-num">{{ i.value.toFixed(2) }}</span><Chg :v="i.chg" /></div>
        </div>
      </div>
      <div class="kv mb">
        <span>上涨 / 下跌 / 平盘</span><span><span class="up">▲{{ exchangeInfo.up }}</span> / <span class="down">▼{{ exchangeInfo.down }}</span> / {{ exchangeInfo.flat }}</span>
        <span>涨停 / 跌停</span><span>{{ exchangeInfo.lu }} / {{ exchangeInfo.ld }}</span>
        <span>停牌股票</span><span>{{ exchangeInfo.suspended }}</span>
      </div>
      <div v-for="n in exchangeNpcs" :key="n.id" class="small mb">💬 {{ n.name }}（{{ n.role }}）：{{ n.lines[(game.engine?.w.clock.tradingDay ?? 0) % n.lines.length] }}</div>
      <div class="note tiny">所有行情均为模拟数据。</div>
      <template #footer>
        <button class="btn btn-ghost" @click="(dialog = null), game.go('news')">今日新闻</button>
        <button class="btn btn-primary" @click="(dialog = null), game.go('trade')">前往交易终端</button>
      </template>
    </Modal>
    <Modal v-if="dialog === 'cafe'" title="投资者咖啡馆" @close="dialog = null">
      <div class="note warn mb">咖啡馆里听到的多为个人观点或传闻（已标注【传闻】/【观点】），并非事实，也不是投资建议。</div>
      <div v-for="n in cafeNpcs" :key="n.id" class="mb">
        <div class="bold">{{ n.name }} <span class="muted small">{{ n.role }}</span></div>
        <div v-for="(l, i) in n.lines" :key="i" class="small">💬 {{ l }}</div>
      </div>
    </Modal>
    <Modal v-if="dialog === 'campus'" title="上市公司园区（虚构公司）" size="wide" @close="dialog = null">
      <div v-for="n in campusNpcs" :key="n.id" class="small mb">💬 {{ n.name }}：{{ n.lines[0] }}</div>
      <div class="tbl-wrap" style="max-height: 50vh">
        <table class="tbl">
          <thead>
            <tr><th>公司</th><th>行业</th><th>园区</th><th class="num">最新价</th><th class="num">涨跌</th></tr>
          </thead>
          <tbody>
            <tr v-for="x in companies" :key="x.c.symbol" class="clickable" @click="(dialog = null), game.openStock(x.c.symbol)">
              <td class="row"><Logo :symbol="x.c.symbol" :size="18" /> {{ x.c.symbol }} {{ x.c.name }}</td>
              <td>{{ SECTOR_MAP[x.c.sector].name }}</td>
              <td class="muted">{{ x.c.district }}</td>
              <td class="num">{{ x.st ? fmtPrice(x.st.last) : '—' }}</td>
              <td class="num"><Chg v-if="x.st" :v="x.st.last / x.st.prevClose - 1" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.city {
  position: relative;
}
.city-cv {
  width: 100%;
  height: auto;
  aspect-ratio: 400 / 170;
  image-rendering: pixelated;
  box-shadow: 0 0 0 2px var(--border);
}
.loc-list {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin-top: 6px;
}
.city-flag {
  position: absolute;
  top: 6px;
  left: 6px;
}
</style>
