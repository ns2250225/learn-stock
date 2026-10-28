import type { Engine } from './engine'
import type { Bar, StockState } from './state'
import type { CompanyTemplate } from './types'
import { K_DEV, K_L, K_S, MARKET_SENT_COEF, REGIME_PARAMS, SECTOR_SIGMA, SENT_COEF, TIER_DEPTH, TIER_SPREAD_BPS } from './params'
import { clamp, roundTick } from './util'
import { SECTORS } from './content/sectors'

/** 个股潜在 log 价格（元） */
export function latentX(e: Engine, st: StockState): number {
  const c = e.tmpl[st.symbol]
  return st.lnFund + c.beta * e.w.regime.L + c.sectorSensitivity * e.w.sectorFactors[c.sector].S + st.dev
}

export function latentPrice(e: Engine, st: StockState): number {
  return Math.exp(latentX(e, st)) * 100
}

export function computeLimits(e: Engine, st: StockState) {
  const r = e.rules
  if (!r.priceLimit.enabled) {
    st.limitUp = Number.MAX_SAFE_INTEGER
    st.limitDown = r.tickSize
    return
  }
  const pct = st.riskWarning ? r.priceLimit.riskWarningPct : r.priceLimit.pct
  st.limitUp = roundTick(st.prevClose * (1 + pct), r.tickSize, 'floor')
  st.limitDown = Math.max(r.tickSize, roundTick(st.prevClose * (1 - pct), r.tickSize, 'ceil'))
}

export function clampToLimits(st: StockState, p: number): number {
  return clamp(p, st.limitDown, st.limitUp)
}

export function tradablePrice(e: Engine, st: StockState): number {
  return roundTick(clampToLimits(st, latentPrice(e, st)), e.rules.tickSize)
}

function stockVolMult(e: Engine, st: StockState): number {
  let m = 1
  for (const md of st.modifiers) m *= md.vol
  const regimeVol = Math.sqrt(REGIME_PARAMS[e.w.regime.current].sigma / 0.14)
  return m * Math.min(2.5, st.volState) * e.w.volatilityMult * regimeVol
}

export function modifierProduct(st: StockState, key: 'vol' | 'volume' | 'spread'): number {
  let m = 1
  for (const md of st.modifiers) m *= md[key]
  return m
}

/** 每个连续交易分钟：更新市场、行业因子与情绪 */
export function stepFactors(e: Engine, dt: number) {
  const w = e.w
  const rp = REGIME_PARAMS[w.regime.current]
  const rm = e.rng.market
  const zm = rm.normal()
  const drift = (rp.mu / 252) * dt + K_L * (w.regime.Lstar - w.regime.L) * dt + w.marketSentiment * MARKET_SENT_COEF * dt
  const noise = (rp.sigma / Math.sqrt(252)) * Math.sqrt(dt) * zm * w.volatilityMult
  const dL = drift + noise
  w.regime.L += dL
  e.tmp.dL = dL
  w.marketSentiment = clamp(w.marketSentiment * (1 - 0.004) + dL * 6 + rp.sentiment * 0.0008, -1, 1)
  for (const s of SECTORS) {
    const sf = w.sectorFactors[s.id]
    const dS = (SECTOR_SIGMA / Math.sqrt(252)) * Math.sqrt(dt) * rm.normal() * w.volatilityMult - K_S * sf.S * dt + sf.sentiment * 0.004 * dt
    sf.S += dS
    sf.sentiment = clamp(sf.sentiment * 0.996 + dS * 5, -1, 1)
    e.tmp.dS[s.id] = dS
  }
}

/**
 * 推进个股潜在价格一步。返回本步 log 收益分解。
 * 停牌股票同样推进（复牌时体现跳空），但不生成成交。
 */
export function stepStockLatent(e: Engine, st: StockState, dt: number) {
  const c = e.tmpl[st.symbol]
  const rs = e.rng.stock
  const a = st.attrToday
  const dMkt = c.beta * e.tmp.dL
  const dSec = c.sectorSensitivity * (e.tmp.dS[c.sector] ?? 0)
  // 事件冲击释放
  let shock = 0
  for (const im of st.impacts) {
    const amt = im.remaining * im.rate
    im.remaining -= amt
    shock += amt
    a.events[im.eventId] = (a.events[im.eventId] ?? 0) + amt
  }
  st.impacts = st.impacts.filter((im) => Math.abs(im.remaining) > 1e-5)
  st.modifiers = st.modifiers.filter((m) => m.untilStep > e.tmp.globalStep)
  const rev = -K_DEV * st.dev * dt
  const sent = st.sentiment * SENT_COEF * dt
  const vm = stockVolMult(e, st)
  const noise = (c.volatility / Math.sqrt(252)) * Math.sqrt(dt) * rs.normal() * vm
  st.dev += rev + sent + noise + shock
  a.market += dMkt
  a.sector += dSec
  a.reversion += rev
  a.sentiment += sent
  a.noise += noise
  const r = dMkt + dSec + rev + sent + noise + shock
  st.sentiment = clamp(st.sentiment * (1 - 0.003) + r * 3, -1, 1)
  st.volState = clamp(st.volState + 0.01 * (1 - st.volState) + Math.abs(shock) * 4, 0.6, 3)
  return r
}

/** 根据流动性档位、波动、市场压力与时段生成模拟盘口 */
export function makeBook(e: Engine, st: StockState, last: number, phaseMult: number) {
  const c = e.tmpl[st.symbol]
  const rb = e.rng.book
  const tick = e.rules.tickSize
  const rp = REGIME_PARAMS[e.w.regime.current]
  const spreadBps = TIER_SPREAD_BPS[c.liquidityTier] * rp.spread * modifierProduct(st, 'spread') * phaseMult * Math.min(2.5, st.volState) * rb.range(0.7, 1.4)
  const spreadTicks = Math.max(1, Math.round((last * spreadBps) / 10000 / tick))
  const lot = e.rules.lotSize
  const depthBase = st.minuteBase * TIER_DEPTH[c.liquidityTier] / Math.max(1, modifierProduct(st, 'spread'))
  const bid1 = Math.max(tick, last - Math.floor(spreadTicks / 2) * tick)
  const ask1 = bid1 + spreadTicks * tick
  const bids = []
  const asks = []
  const levelGap = Math.max(1, Math.round(spreadTicks / 2))
  for (let i = 0; i < 5; i++) {
    const bp = bid1 - i * levelGap * tick
    const ap = ask1 + i * levelGap * tick
    const qb = Math.max(lot, Math.round((depthBase * rb.range(0.4, 1.6) * (1 + 0.35 * i)) / lot) * lot)
    const qa = Math.max(lot, Math.round((depthBase * rb.range(0.4, 1.6) * (1 + 0.35 * i)) / lot) * lot)
    if (bp >= st.limitDown && bp > 0) bids.push({ price: bp, qty: qb })
    if (ap <= st.limitUp) asks.push({ price: ap, qty: qa })
  }
  // 涨跌停：一侧几乎没有对手盘
  if (last >= st.limitUp && e.rules.priceLimit.enabled) {
    asks.length = 0
    if (rb.chance(0.3)) asks.push({ price: st.limitUp, qty: lot * rb.int(1, 5) })
    bids[0] = { price: st.limitUp, qty: Math.round(depthBase * 20 / lot) * lot + lot }
  }
  if (last <= st.limitDown && e.rules.priceLimit.enabled) {
    bids.length = 0
    if (rb.chance(0.3)) bids.push({ price: st.limitDown, qty: lot * rb.int(1, 5) })
    asks[0] = { price: st.limitDown, qty: Math.round(depthBase * 20 / lot) * lot + lot }
  }
  st.book = { bids, asks, spreadTicks }
}

export function uShape(minuteOfSession: number, total: number): number {
  const x = minuteOfSession / total
  return 0.75 + 1.1 * Math.exp(-x * 12) + 0.7 * Math.exp(-(1 - x) * 10)
}

/** 写入分钟K线与成交带 */
export function writeMinute(e: Engine, st: StockState, prev: number, price: number, r: number, sessionMinute: number) {
  const rb = e.rng.book
  const c = e.tmpl[st.symbol]
  const tick = e.rules.tickSize
  const sigmaStep = (c.volatility / Math.sqrt(252)) * Math.sqrt(1 / e.T)
  const excursion = Math.abs(rb.normal()) * sigmaStep * 0.6
  let hi = Math.max(prev, price) * (1 + excursion)
  let lo = Math.min(prev, price) * (1 - Math.abs(rb.normal()) * sigmaStep * 0.6)
  hi = roundTick(clampToLimits(st, hi), tick)
  lo = roundTick(clampToLimits(st, lo), tick)
  const volMult = modifierProduct(st, 'volume')
  const v = Math.max(
    0,
    Math.round(st.minuteBase * uShape(sessionMinute, e.T) * (1 + Math.min(6, (Math.abs(r) / Math.max(1e-4, sigmaStep)) * 0.35)) * volMult * Math.exp(rb.normal() * 0.35) * (1 + Math.abs(st.sentiment) * 0.5)),
  )
  const bar: Bar = { t: e.w.clock.time, o: prev, h: Math.max(hi, prev, price), l: Math.min(lo, prev, price), c: price, v, a: Math.round(v * (prev + price) / 2) }
  st.minute.push(bar)
  st.last = price
  st.high = Math.max(st.high, bar.h)
  st.low = Math.min(st.low, bar.l)
  st.volume += v
  st.amount += bar.a
  // 成交带（演示用，最多保留 40 笔）
  const n = rb.int(1, 3)
  for (let i = 0; i < n; i++) {
    const p = i === n - 1 ? price : roundTick(lo + (hi - lo) * rb.next(), tick)
    st.tape.push({ t: e.w.clock.time, price: p, qty: Math.max(e.rules.lotSize, Math.round((v / n) * rb.range(0.3, 1.2) / e.rules.lotSize) * e.rules.lotSize), side: p >= price ? 'B' : 'S' })
  }
  if (st.tape.length > 40) st.tape.splice(0, st.tape.length - 40)
  return bar
}

export function indexValue(e: Engine, members: string[], divisor: number): number {
  let s = 0
  for (const sym of members) {
    const st = e.w.stocks[sym]
    if (st.status === 'delisted') continue
    s += st.last * st.f.shares
  }
  return s / divisor
}

export function updateIndices(e: Engine, recordMinute: boolean) {
  for (const idx of Object.values(e.w.indices)) {
    const v = indexValue(e, idx.members, idx.divisor)
    idx.value = v
    idx.high = Math.max(idx.high, v)
    idx.low = Math.min(idx.low, v)
    if (recordMinute) idx.minute.push({ t: e.w.clock.time, v })
  }
}

/** 公司股本或成分变化时调整除数，保持指数连续 */
export function rebaseIndices(e: Engine, mutate: () => void) {
  const before: Record<string, number> = {}
  for (const idx of Object.values(e.w.indices)) before[idx.id] = indexValue(e, idx.members, idx.divisor)
  mutate()
  for (const idx of Object.values(e.w.indices)) {
    let s = 0
    for (const sym of idx.members) {
      const st = e.w.stocks[sym]
      if (st.status !== 'delisted') s += st.last * st.f.shares
    }
    if (before[idx.id] > 0 && s > 0) idx.divisor = s / before[idx.id]
  }
}

export function companyOf(e: Engine, sym: string): CompanyTemplate {
  return e.tmpl[sym]
}
