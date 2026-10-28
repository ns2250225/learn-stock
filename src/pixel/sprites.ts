// 像素美术：全部为原创、程序化绘制（fillRect），在低分辨率画布上绘制后放大显示
import type { LocationId, MarketPhase } from '../engine/types'

export type Ctx = CanvasRenderingContext2D
export type Emotion = 'idle' | 'think' | 'surprise' | 'celebrate' | 'confused' | 'phone' | 'watching' | 'run'

export interface Palette {
  skin: string
  hair: string
  shirt: string
  pants: string
  hat?: string
}

export function px(g: Ctx, x: number, y: number, w: number, h: number, c: string) {
  g.fillStyle = c
  g.fillRect(Math.round(x), Math.round(y), w, h)
}

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16)
  if (isNaN(n)) return hex
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt))
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt))
  const b = Math.max(0, Math.min(255, (n & 255) + amt))
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
}

/**
 * 角色：约 8×14 像素。(x,y) 为脚底中心。frame 0/1 为行走帧，dir 1 向右 -1 向左。
 */
export function drawCharacter(g: Ctx, x: number, y: number, p: Palette, frame = 0, emotion: Emotion = 'idle', dir = 1, scale = 1) {
  const s = scale
  const X = (dx: number) => x + (dir > 0 ? dx : -dx - 1) * s
  const P = (dx: number, dy: number, w: number, h: number, c: string) => {
    const xx = dir > 0 ? x + dx * s : x - (dx + w) * s
    px(g, xx, y + dy * s, w * s, h * s, c)
  }
  void X
  const bob = emotion === 'celebrate' ? (frame ? -2 : 0) : 0
  const top = -14 + bob
  // 影子
  g.globalAlpha = 0.25
  px(g, x - 4 * s, y - 1 * s, 8 * s, 1 * s, '#000')
  g.globalAlpha = 1
  // 腿
  const walking = emotion === 'run' || frame === 1
  if (walking && frame === 1) {
    P(-3, -5, 2, 4, p.pants)
    P(1, -4, 2, 3, p.pants)
  } else {
    P(-3, -5, 2, 5, p.pants)
    P(1, -5, 2, 5, p.pants)
  }
  P(-3, -1, 2, 1, '#222')
  P(1, -1, 2, 1, '#222')
  // 身体
  P(-4, top + 6, 8, 5, p.shirt)
  P(-4, top + 10, 8, 1, shade(p.shirt, -30))
  // 手臂
  if (emotion === 'celebrate') {
    P(-5, top + 3, 1, 4, p.skin)
    P(4, top + 3, 1, 4, p.skin)
  } else if (emotion === 'phone') {
    P(-5, top + 6, 1, 4, p.shirt)
    P(3, top + 3, 2, 3, p.skin)
    P(4, top + 2, 1, 3, '#333')
  } else if (emotion === 'think') {
    P(-5, top + 6, 1, 4, p.shirt)
    P(1, top + 5, 2, 2, p.skin)
  } else {
    P(-5, top + 6, 1, 4, p.shirt)
    P(4, top + 6, 1, 4, p.shirt)
    P(-5, top + 10, 1, 1, p.skin)
    P(4, top + 10, 1, 1, p.skin)
  }
  // 头
  P(-3, top, 6, 6, p.skin)
  P(-3, top, 6, 2, p.hair)
  P(-3, top + 2, 1, 2, p.hair)
  if (p.hat && p.hat !== 'none') {
    P(-4, top - 1, 8, 1, p.hat)
    P(-3, top - 3, 6, 2, p.hat)
  }
  // 眼睛与表情
  const eye = '#1a1a1a'
  if (emotion === 'surprise') {
    P(-1, top + 3, 1, 2, eye)
    P(2, top + 3, 1, 2, eye)
    P(0, top + 5, 2, 1, '#7a2b2b')
  } else if (emotion === 'confused') {
    P(-1, top + 3, 1, 1, eye)
    P(2, top + 2, 1, 1, eye)
  } else if (emotion === 'celebrate') {
    P(-1, top + 3, 1, 1, eye)
    P(2, top + 3, 1, 1, eye)
    P(-1, top + 4, 4, 1, '#7a2b2b')
  } else if (emotion === 'watching') {
    P(0, top + 3, 1, 1, eye)
    P(2, top + 3, 1, 1, eye)
  } else {
    P(-1, top + 3, 1, 1, eye)
    P(2, top + 3, 1, 1, eye)
  }
  // 头顶符号
  if (emotion === 'think') {
    px(g, x + 4 * s, y + (top - 4) * s, 1 * s, 1 * s, '#fff')
    px(g, x + 6 * s, y + (top - 6) * s, 2 * s, 2 * s, '#fff')
  }
  if (emotion === 'surprise') px(g, x - 0.5 * s, y + (top - 5) * s, 1 * s, 3 * s, '#ffeb3b')
  if (emotion === 'confused') {
    px(g, x + 3 * s, y + (top - 6) * s, 3 * s, 1 * s, '#9ad')
    px(g, x + 5 * s, y + (top - 5) * s, 1 * s, 2 * s, '#9ad')
    px(g, x + 4 * s, y + (top - 2) * s, 1 * s, 1 * s, '#9ad')
  }
}

export interface Sky {
  top: string
  bottom: string
  tint: string
  tintAlpha: number
  night: boolean
}

export function skyFor(phase: MarketPhase): Sky {
  switch (phase) {
    case 'preopen':
    case 'opening':
      return { top: '#f7b267', bottom: '#f4845f', tint: '#ff9a3c', tintAlpha: 0.08, night: false }
    case 'continuous':
    case 'break':
      return { top: '#5aa9e6', bottom: '#a7d8f0', tint: '#ffffff', tintAlpha: 0, night: false }
    case 'closing':
    case 'postclose':
      return { top: '#6d597a', bottom: '#e56b6f', tint: '#b56576', tintAlpha: 0.12, night: false }
    default:
      return { top: '#0b1026', bottom: '#2b2d5c', tint: '#0a0f2e', tintAlpha: 0.35, night: true }
  }
}

export function drawSky(g: Ctx, W: number, H: number, sky: Sky, t: number) {
  const steps = 8
  for (let i = 0; i < steps; i++) {
    const f = i / (steps - 1)
    px(g, 0, (H * i) / steps, W, H / steps + 1, mix(sky.top, sky.bottom, f))
  }
  if (sky.night) {
    for (let i = 0; i < 30; i++) {
      const sx = (i * 97) % W
      const sy = (i * 53) % Math.floor(H * 0.45)
      if ((Math.floor(t / 600) + i) % 7 !== 0) px(g, sx, sy, 1, 1, '#fff')
    }
    px(g, W - 30, 10, 8, 8, '#f6f1c7')
    px(g, W - 27, 10, 5, 6, mix(sky.top, sky.bottom, 0.2))
  } else {
    px(g, W - 34, 12, 10, 10, '#fff3b0')
    // 云
    const cx = ((t / 120) % (W + 60)) - 40
    cloud(g, cx, 18)
    cloud(g, ((t / 200 + 140) % (W + 60)) - 40, 30)
  }
}

function cloud(g: Ctx, x: number, y: number) {
  px(g, x, y, 22, 4, '#ffffffcc')
  px(g, x + 4, y - 3, 12, 3, '#ffffffcc')
}

export function mix(a: string, b: string, f: number): string {
  const pa = parseInt(a.slice(1, 7), 16)
  const pb = parseInt(b.slice(1, 7), 16)
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - f) + ((pb >> sh) & 255) * f)
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')
}

export interface BuildingDef {
  id: LocationId
  name: string
  x: number
  w: number
  h: number
}

/** 窗户：夜间亮灯 */
function windows(g: Ctx, x: number, y: number, w: number, h: number, night: boolean, seed: number, color = '#9cd3ff') {
  for (let wy = y + 4; wy < y + h - 8; wy += 6) {
    for (let wx = x + 3; wx < x + w - 4; wx += 5) {
      const lit = night ? (wx * 7 + wy * 13 + seed) % 5 < 3 : false
      px(g, wx, wy, 3, 3, lit ? '#ffe680' : night ? '#24304f' : color)
    }
  }
}

/** 绘制建筑，(x, ground) 为左下角 */
export function drawBuilding(g: Ctx, id: LocationId, x: number, ground: number, w: number, h: number, night: boolean, t: number, opts: { panic?: boolean; bull?: boolean; ticker?: string; highlight?: boolean } = {}) {
  const y = ground - h
  const outline = '#141828'
  const body: Record<LocationId, string> = {
    exchange: '#d8cfb8',
    broker: '#3f6e9e',
    bank: '#8c9aa8',
    newsroom: '#b5523b',
    library: '#7a5c3e',
    academy: '#5a7d5a',
    cafe: '#c98b5e',
    apartment: '#8e6fa8',
    campus: '#4b8f8c',
  }
  const c = body[id]
  px(g, x - 1, y - 1, w + 2, h + 1, outline)
  px(g, x, y, w, h, c)
  px(g, x, y, w, 2, shade(c, 30))
  px(g, x + w - 3, y, 3, h, shade(c, -25))
  if (opts.highlight) {
    g.globalAlpha = 0.25
    px(g, x, y, w, h, '#fff7c2')
    g.globalAlpha = 1
  }
  const door = (dc = '#3b2a1e') => {
    px(g, x + w / 2 - 3, ground - 8, 6, 8, dc)
    px(g, x + w / 2 - 3, ground - 9, 6, 1, outline)
  }
  switch (id) {
    case 'exchange': {
      // 三角楣 + 柱子 + 行情屏
      for (let i = 0; i < 4; i++) px(g, x + 2 + i, y - 2 - i, w - 4 - i * 2, 1, shade(c, 15 - i * 5))
      px(g, x + w / 2 - 8, y - 7, 16, 1, shade(c, -10))
      for (let cx = x + 4; cx < x + w - 4; cx += 6) px(g, cx, y + 16, 3, h - 16, shade(c, 20))
      px(g, x + 3, y + 4, w - 6, 10, '#0a0f1c')
      const color = opts.panic ? (Math.floor(t / 300) % 2 ? '#ff4d4d' : '#7a1010') : '#4dff88'
      const s = opts.ticker ?? ''
      g.fillStyle = color
      // 滚动"数字"像素
      const off = Math.floor(t / 80) % 40
      for (let i = 0; i < w - 8; i += 2) {
        const v = (s.charCodeAt((i + off) % Math.max(1, s.length)) || 48) % 5
        if (v > 1) g.fillRect(x + 4 + i, y + 6 + (v % 3) * 2, 1, 2)
      }
      door('#2b2116')
      if (opts.panic && Math.floor(t / 250) % 2) {
        px(g, x + 2, y - 6, 3, 3, '#ff3b3b')
        px(g, x + w - 5, y - 6, 3, 3, '#ff3b3b')
      }
      break
    }
    case 'broker':
      windows(g, x, y, w, h - 10, night, 3)
      px(g, x + 2, ground - 14, w - 4, 4, '#f4c95d')
      door('#1d2a3a')
      break
    case 'bank':
      for (let i = 0; i < 3; i++) px(g, x + 1 + i, y - 1 - i, w - 2 - i * 2, 1, shade(c, 10))
      for (let cx = x + 3; cx < x + w - 3; cx += 5) px(g, cx, y + 6, 2, h - 6, shade(c, 25))
      px(g, x + w / 2 - 3, y + 1, 6, 4, '#f4c95d')
      door('#2a2f38')
      break
    case 'newsroom':
      windows(g, x, y, w, h - 10, night, 7, '#ffd1b3')
      // 天线
      px(g, x + w - 8, y - 10, 1, 10, '#555')
      if (Math.floor(t / 400) % 2) px(g, x + w - 9, y - 11, 3, 2, '#ff5c5c')
      px(g, x + 2, ground - 15, w - 4, 4, '#1a1a1a')
      g.fillStyle = '#ffe680'
      for (let i = 0; i < w - 6; i += 3) if ((i + Math.floor(t / 100)) % 6 < 3) g.fillRect(x + 3 + i, ground - 14, 2, 2)
      door()
      break
    case 'library':
      px(g, x - 2, y - 3, w + 4, 3, shade(c, -20))
      windows(g, x, y, w, h - 10, night, 11, '#e8d8a8')
      door('#2b1d10')
      break
    case 'academy':
      px(g, x + w / 2 - 4, y - 8, 8, 8, shade(c, 10))
      px(g, x + w / 2 - 2, y - 6, 4, 4, '#fff')
      px(g, x + w / 2, y - 5, 1, 2, '#333')
      windows(g, x, y, w, h - 10, night, 5, '#cfe8cf')
      door('#2a3a2a')
      break
    case 'cafe':
      // 遮阳棚
      for (let i = 0; i < w; i += 4) px(g, x + i, y + 8, 2, 4, i % 8 ? '#fff' : '#e63946')
      px(g, x + 3, y + 14, w - 6, 8, night ? '#ffd27a' : '#bfe3f0')
      px(g, x + 4, y + 2, w - 8, 5, '#3b2a1e')
      door('#3b2a1e')
      // 蒸汽
      if (Math.floor(t / 300) % 2) px(g, x + w - 6, y - 4, 1, 3, '#ffffff88')
      break
    case 'apartment':
      windows(g, x, y, w, h - 6, night, 13, '#f0d0ff')
      px(g, x - 1, y - 2, w + 2, 2, shade(c, -30))
      door('#2e1f3a')
      break
    case 'campus':
      windows(g, x, y, w, h - 10, night, 17, '#b8f2ef')
      px(g, x + 2, y + 2, 8, 8, '#f4c95d')
      px(g, x + 4, y + 4, 4, 4, '#4b8f8c')
      door('#173b3a')
      break
  }
  if (opts.bull && id === 'exchange') {
    for (let i = 0; i < 3; i++) px(g, x + 6 + i * ((w - 12) / 2), y - 12, 2, 6 - (Math.floor(t / 200 + i) % 2) * 2, '#ffd166')
  }
}

export function drawTree(g: Ctx, x: number, ground: number, night: boolean) {
  px(g, x, ground - 6, 2, 6, '#6b4226')
  px(g, x - 3, ground - 14, 8, 8, night ? '#1f4d2b' : '#3a8d4a')
  px(g, x - 2, ground - 16, 6, 2, night ? '#2a6038' : '#58b368')
}

export function drawLamp(g: Ctx, x: number, ground: number, night: boolean) {
  px(g, x, ground - 14, 1, 14, '#444')
  px(g, x - 1, ground - 15, 3, 2, night ? '#ffe680' : '#999')
  if (night) {
    g.globalAlpha = 0.15
    px(g, x - 6, ground - 13, 13, 13, '#ffe680')
    g.globalAlpha = 1
  }
}

export function drawCar(g: Ctx, x: number, y: number, color: string, dir: number, night: boolean) {
  px(g, x, y - 5, 14, 4, color)
  px(g, x + 3, y - 8, 8, 3, shade(color, 20))
  px(g, x + 4, y - 7, 6, 2, '#bfe3f0')
  px(g, x + 2, y - 1, 3, 2, '#111')
  px(g, x + 9, y - 1, 3, 2, '#111')
  if (night) px(g, dir > 0 ? x + 14 : x - 3, y - 4, 3, 2, '#fff6a0')
}

export function drawConfetti(g: Ctx, W: number, H: number, t: number) {
  const colors = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#f78c6b']
  for (let i = 0; i < 40; i++) {
    const x = (i * 37 + t / 20) % W
    const y = (i * 23 + t / (8 + (i % 5))) % H
    px(g, x, y, 2, 2, colors[i % colors.length])
  }
}

export function drawBubble(g: Ctx, x: number, y: number, w: number, h: number) {
  px(g, x - 1, y - 1, w + 2, h + 2, '#141828')
  px(g, x, y, w, h, '#fffaf0')
  px(g, x + 6, y + h, 4, 2, '#fffaf0')
  px(g, x + 7, y + h + 2, 2, 1, '#fffaf0')
}

export function applyTint(g: Ctx, W: number, H: number, sky: Sky) {
  if (sky.tintAlpha <= 0) return
  g.globalAlpha = sky.tintAlpha
  px(g, 0, 0, W, H, sky.tint)
  g.globalAlpha = 1
}

export const LOCATION_NAMES: Record<LocationId, string> = {
  exchange: '交易所大楼',
  broker: '券商营业厅',
  bank: '账户中心',
  newsroom: '财经新闻社',
  library: '研究图书馆',
  academy: '投资学院',
  cafe: '投资者咖啡馆',
  apartment: '交易者公寓',
  campus: '上市公司园区',
}

export const LOCATION_PAGE: Partial<Record<LocationId, 'hall' | 'trade' | 'account' | 'news' | 'research' | 'learn' | 'home'>> = {
  exchange: 'hall',
  broker: 'trade',
  bank: 'account',
  newsroom: 'news',
  library: 'research',
  academy: 'learn',
  apartment: 'home',
}

/** 简单的手绘地面与道路 */
export function drawGround(g: Ctx, W: number, ground: number, H: number, night: boolean) {
  px(g, 0, ground, W, 3, night ? '#3a4a3a' : '#6fbf6f')
  px(g, 0, ground + 3, W, 4, night ? '#555' : '#c9c2b0')
  px(g, 0, ground + 7, W, H - ground - 7, night ? '#22252e' : '#3d4150')
  for (let x = 0; x < W; x += 16) px(g, x, ground + 7 + Math.floor((H - ground - 7) / 2), 8, 1, '#e8d36a')
}
