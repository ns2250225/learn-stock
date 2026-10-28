import type { MarketPhase, MarketRules, SimTime } from './types'

/** 开局日（dayIndex=0）= 2031-01-06（周一，虚构模拟日期） */
const EPOCH = Date.UTC(2031, 0, 6)
const DAY = 86400000
const WEEK = ['日', '一', '二', '三', '四', '五', '六']

export function dateOfDayIndex(dayIndex: number): Date {
  return new Date(EPOCH + dayIndex * DAY)
}

export function fmtDate(dayIndex: number, withWeek = true): string {
  const d = dateOfDayIndex(dayIndex)
  const s = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  return withWeek ? `${s} 周${WEEK[d.getUTCDay()]}` : s
}

export function fmtShortDate(dayIndex: number): string {
  const d = dateOfDayIndex(dayIndex)
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export function fmtClock(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function fmtTime(t: SimTime): string {
  return `${fmtDate(Math.floor(t / 1440), false)} ${fmtClock(t % 1440)}`
}

export function isTradingDayIndex(dayIndex: number, rules: MarketRules): boolean {
  const d = dateOfDayIndex(dayIndex)
  const wd = d.getUTCDay()
  if (wd === 0 || wd === 6) return false
  const md = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  return !rules.holidays.includes(md)
}

export function phaseAt(t: SimTime, rules: MarketRules): MarketPhase {
  const dayIndex = Math.floor(t / 1440)
  if (!isTradingDayIndex(dayIndex, rules)) return 'closed'
  const m = t - dayIndex * 1440
  const s = rules.sessions
  const inr = (r: [number, number]) => m >= r[0] && m < r[1]
  if (inr(s.preopen)) return 'preopen'
  if (inr(s.opening)) return 'opening'
  for (const c of s.continuous) if (inr(c)) return 'continuous'
  if (inr(s.closing)) return 'closing'
  if (inr(s.postclose)) return 'postclose'
  if (m >= s.continuous[0][0] && m < s.closing[0]) return 'break'
  return 'closed'
}

/** 从 t 起（不含 t）找到下一个「活跃阶段」的开始时间 */
export function nextActiveStart(t: SimTime, rules: MarketRules): SimTime {
  const s = rules.sessions
  let dayIndex = Math.floor(t / 1440)
  const m = t - dayIndex * 1440
  // 同日的午休结束
  if (isTradingDayIndex(dayIndex, rules)) {
    if (m < s.preopen[0]) return dayIndex * 1440 + s.preopen[0]
    for (const c of s.continuous) if (m < c[0] && m >= s.continuous[0][0]) return dayIndex * 1440 + c[0]
  }
  dayIndex++
  for (let i = 0; i < 30; i++) {
    if (isTradingDayIndex(dayIndex, rules)) return dayIndex * 1440 + s.preopen[0]
    dayIndex++
  }
  return dayIndex * 1440 + s.preopen[0]
}

export function nextTradingDayIndex(dayIndex: number, rules: MarketRules): number {
  let d = dayIndex + 1
  while (!isTradingDayIndex(d, rules)) d++
  return d
}

export function prevTradingDayIndex(dayIndex: number, rules: MarketRules): number {
  let d = dayIndex - 1
  while (!isTradingDayIndex(d, rules)) d--
  return d
}

/**
 * 交易日序号 → 日历 dayIndex。交易日 1 = firstDayIndex；历史交易日（≤0）向前推算。
 */
export class TradingCalendar {
  private cache = new Map<number, number>()
  constructor(private rules: MarketRules, private firstDayIndex: number) {
    this.cache.set(1, firstDayIndex)
  }
  dayIndexOf(td: number): number {
    const hit = this.cache.get(td)
    if (hit !== undefined) return hit
    let nearest = 1
    let best = Infinity
    for (const k of this.cache.keys()) {
      const dist = Math.abs(k - td)
      if (dist < best) {
        best = dist
        nearest = k
      }
    }
    let di = this.cache.get(nearest)!
    let cur = nearest
    while (cur < td) {
      di = nextTradingDayIndex(di, this.rules)
      cur++
      this.cache.set(cur, di)
    }
    while (cur > td) {
      di = prevTradingDayIndex(di, this.rules)
      cur--
      this.cache.set(cur, di)
    }
    return di
  }
  label(td: number, withWeek = false): string {
    return fmtDate(this.dayIndexOf(td), withWeek)
  }
  short(td: number): string {
    return fmtShortDate(this.dayIndexOf(td))
  }
}

export function firstTradingDayIndex(rules: MarketRules): number {
  let d = 0
  while (!isTradingDayIndex(d, rules)) d++
  return d
}

export function quarterLabel(k: number): string {
  const y = 2031 + Math.floor(k / 4)
  const q = ((k % 4) + 4) % 4
  return `${y}Q${q + 1}`
}
