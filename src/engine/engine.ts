import type { CompanyTemplate, Execution, MarketEvent, MarketPhase, MarketRules, Order, Position, TradeReview } from './types'
import type { NewsArticle, StockState, WorldState } from './state'
import { COMPANIES } from './content/companies'
import { SECTORS } from './content/sectors'
import { Rng } from './rng'
import { RULE_PACKS, PHASE_LABEL, tradingMinutes } from './rules'
import { TradingCalendar, firstTradingDayIndex, nextActiveStart, phaseAt, fmtTime } from './clock'
import { createWorld, earningsPower, emptyAttr, macroLstar, RNG_STREAMS, valuationMult, type NewGameOptions } from './world'
import { computeLimits, makeBook, stepFactors, stepStockLatent, tradablePrice, updateIndices, writeMinute } from './market'
import { auctionMatch, checkMargin, checkTriggers, equity, expireOrders, forceLiquidate, isOpen, matchOrder, processCancel, cancelOrder, submitOrder, type OrderRequest, ledger, nav, grossExposure } from './trading'
import { maybeAnalystRevision, maybeRandomEvent, opinionColumn, processEarnings, processPending, processReleases, scheduleReleases } from './news'
import { CorporateEngine } from './corporate'
import { ScriptedEngine, setupChallenge, CHALLENGE_MAP } from './challenge'
import { buildDailySummary, createReview, riskSnapshot } from './review'
import { DIFFICULTY_PARAMS, REGIME_PARAMS, REGIME_TRANSITIONS, UNLOCKS } from './params'
import { clamp, fmtMoney, fmtPrice } from './util'

export type EngineEvent =
  | { type: 'notice'; level: string; title: string; body: string }
  | { type: 'fill'; order: Order; exec: Execution }
  | { type: 'news'; news: NewsArticle }
  | { type: 'keyEvent'; event: MarketEvent }
  | { type: 'review'; review: TradeReview }
  | { type: 'dayClose'; day: number }
  | { type: 'challengeEnd' }
  | { type: 'marginCall' }
  | { type: 'alert'; symbol: string; price: number }
  | { type: 'phase'; phase: MarketPhase }

export interface EngineSettings {
  unlockAll: boolean
  level: number
  maxOrderPct: number
  tutorialPause: boolean
}

export class Engine {
  w: WorldState
  rules: MarketRules
  rng: Record<string, Rng> = {}
  cal: TradingCalendar
  tmpl: Record<string, CompanyTemplate>
  T: number
  corp: CorporateEngine
  scripted: ScriptedEngine
  running = false
  dirty = false
  importantDirty = false
  settings: EngineSettings = { unlockAll: false, level: 1, maxOrderPct: 1, tutorialPause: true }
  tmp = {
    dL: 0,
    dS: {} as Record<string, number>,
    globalStep: 0,
    passiveUsed: {} as Record<string, number>,
    forceAtOpen: false,
  }
  private listeners: ((ev: EngineEvent) => void)[] = []

  constructor(w: WorldState) {
    this.w = w
    this.rules = RULE_PACKS[w.meta.rulesId]
    for (const s of RNG_STREAMS) this.rng[s] = w.rng[s] ? new Rng(w.rng[s]) : Rng.from(w.meta.worldSeed, s)
    this.cal = new TradingCalendar(this.rules, firstTradingDayIndex(this.rules))
    this.tmpl = Object.fromEntries(COMPANIES.map((c) => [c.symbol, c]))
    this.T = tradingMinutes(this.rules)
    this.corp = new CorporateEngine(this)
    this.scripted = new ScriptedEngine(this)
  }

  static newGame(opts: NewGameOptions): Engine {
    const def = opts.challengeId ? CHALLENGE_MAP[opts.challengeId] : undefined
    if (def) {
      opts = {
        ...opts,
        rulesId: def.rulesId ?? opts.rulesId,
        initialCash: def.startCash,
        regime: def.regime,
        macro: def.macro,
        eventFrequency: def.eventFrequency,
        volatilityMult: def.volatilityMult,
      }
    }
    const w = createWorld(opts)
    const e = new Engine(w)
    const first = firstTradingDayIndex(e.rules)
    w.clock.time = first * 1440 + e.rules.sessions.preopen[0] - 1
    for (const st of Object.values(w.stocks)) {
      computeLimits(e, st)
      makeBook(e, st, st.last, 1)
    }
    scheduleReleases(e)
    if (def) setupChallenge(e, def)
    e.notice('info', '欢迎来到像素证券城', '本游戏所有公司、价格、新闻与资金均为虚构模拟数据，不连接任何真实券商，也不构成投资建议。')
    e.syncRng()
    return e
  }

  // ------------------------------------------------------------------ 基础
  on(fn: (ev: EngineEvent) => void) {
    this.listeners.push(fn)
    return () => (this.listeners = this.listeners.filter((x) => x !== fn))
  }
  emit(ev: EngineEvent) {
    for (const l of this.listeners) l(ev)
  }
  nextId(prefix: string): string {
    const n = (this.w.seq[prefix] ?? 0) + 1
    this.w.seq[prefix] = n
    return `${prefix}${n.toString().padStart(5, '0')}`
  }
  notice(level: 'info' | 'success' | 'warn' | 'danger', title: string, body: string, symbol?: string) {
    this.w.notices.push({ id: this.nextId('NT'), ts: this.w.clock.time, level, title, body, symbol, read: false })
    if (this.w.notices.length > 300) this.w.notices.splice(0, this.w.notices.length - 300)
    this.emit({ type: 'notice', level, title, body })
  }
  debug(kind: 'match' | 'factor' | 'event' | 'order' | 'corp', text: string) {
    this.w.debug.push({ ts: this.w.clock.time, kind, text })
    if (this.w.debug.length > 4000) this.w.debug.splice(0, this.w.debug.length - 4000)
  }
  logCommand(cmd: string, args: unknown) {
    this.w.commandLog.push({ ts: this.w.clock.time, cmd, args })
    if (this.w.commandLog.length > 5000) this.w.commandLog.splice(0, this.w.commandLog.length - 5000)
  }
  markDirty(important = false) {
    this.dirty = true
    if (important) this.importantDirty = true
  }
  syncRng() {
    for (const s of RNG_STREAMS) this.w.rng[s] = this.rng[s].state()
  }
  serialize(): WorldState {
    this.syncRng()
    this.w.meta.savedAt = new Date().toISOString()
    return this.w
  }

  get phase(): MarketPhase {
    return phaseAt(this.w.clock.time, this.rules)
  }
  get phaseLabel(): string {
    return PHASE_LABEL[this.phase]
  }
  get minuteOfDay(): number {
    return this.w.clock.time % 1440
  }
  get dayIndex(): number {
    return Math.floor(this.w.clock.time / 1440)
  }
  isAfterSessionToday(): boolean {
    return this.minuteOfDay >= this.rules.sessions.closing[1]
  }
  /** 本交易日距离收盘的分钟数（仅交易时段） */
  minutesToClose(): number {
    const ph = this.phase
    if (ph === 'closed' || ph === 'postclose') return 0
    return Math.max(0, this.rules.sessions.closing[1] - this.minuteOfDay)
  }
  timeLabel(): string {
    return fmtTime(this.w.clock.time)
  }
  isUnlocked(feature: string): boolean {
    const u = UNLOCKS[feature]
    if (!u) return true
    return this.settings.unlockAll || this.settings.level >= u.level
  }

  ensurePosition(sym: string): Position {
    let p = this.w.account.positions[sym]
    if (!p) {
      p = { symbol: sym, qty: 0, costBasis: 0, frozenQty: 0, lots: [], realizedPnl: 0, openedDay: this.w.clock.tradingDay, dividendsReceived: 0, feesPaid: 0 }
      this.w.account.positions[sym] = p
    }
    return p
  }
  cleanupPosition(sym: string) {
    const p = this.w.account.positions[sym]
    if (!p) return
    const hasOpen = this.w.orders.some((o) => o.symbol === sym && isOpen(o))
    const hasRights = this.w.account.rightsPending.some((r) => r.symbol === sym)
    if (p.qty === 0 && p.frozenQty === 0 && !hasOpen && !hasRights) {
      p.costBasis = 0
      delete this.w.account.positions[sym]
    }
  }
  onOrderFinished(o: Order) {
    createReview(this, o)
  }
  onKeyEvent(ev: MarketEvent) {
    if (this.w.meta.mode !== 'tutorial' || !this.settings.tutorialPause) return
    const held = ev.affectedSymbols.some((s) => this.w.account.positions[s]?.qty)
    if (ev.highImpact || held) this.emit({ type: 'keyEvent', event: ev })
  }

  // ------------------------------------------------------------------ 主循环
  /**
   * 推进一个模拟时间步。顺序：
   * 1 时钟/阶段 → 2 日历事件与公司行动 → 3 新事件 → 4 因子更新 → 5 参考价格 →
   * 6 盘口 → 7 止损触发 → 8 撮合 → 9 资金/持仓 → 10 流水与快照 → 11 风险/任务 → 12 自动存档标记
   */
  step() {
    const w = this.w
    const prev = this.phase
    if (prev === 'closed' || prev === 'break') {
      const next = nextActiveStart(w.clock.time, this.rules)
      if (prev === 'closed') this.overnight()
      w.clock.time = next
      this.tmp.globalStep++
      this.onTransition(prev, this.phase)
      return
    }
    w.clock.time += 1
    this.tmp.globalStep++
    const cur = this.phase
    if (cur !== prev) this.onTransition(prev, cur)
    if (cur === 'closed' || cur === 'break') return
    this.minuteWork(cur)
  }

  private onTransition(prev: MarketPhase, cur: MarketPhase) {
    if (prev === 'opening' && cur === 'continuous') this.openingAuction()
    if ((prev === 'closing' || prev === 'continuous') && (cur === 'postclose' || cur === 'closed')) {
      if (this.rules.sessions.closingAuction && prev === 'closing') this.closingAuction()
      this.dayClose()
    }
    if (cur === 'preopen') this.dayStart()
    this.emit({ type: 'phase', phase: cur })
  }

  private minuteWork(ph: MarketPhase) {
    const w = this.w
    const m = this.minuteOfDay
    // 先处理撤单（撤单与成交同一步发生时，撤单优先）
    for (const o of w.orders) if (o.status === 'cancelPending') processCancel(this, o)
    // 2. 日历事件与连锁/剧本事件
    processReleases(this)
    processPending(this)
    if (ph === 'preopen') {
      if (m === this.rules.sessions.preopen[0] + 10) processEarnings(this)
      if (this.rng.events.chance(0.04)) maybeRandomEvent(this, this.T * 0.05)
      return
    }
    if (ph === 'opening' || ph === 'postclose') {
      if (ph === 'postclose' && this.rng.events.chance(0.02)) maybeRandomEvent(this, this.T * 0.05)
      return
    }
    const auctionClose = ph === 'closing' && this.rules.sessions.closingAuction
    // 3. 随机事件
    if (!auctionClose) maybeRandomEvent(this)
    // 4-5. 因子与参考价格
    const dt = 1 / this.T
    stepFactors(this, dt)
    this.tmp.passiveUsed = {}
    const sessionMinute = this.sessionMinute()
    const openBySym: Record<string, Order[]> = {}
    for (const o of w.orders) if (isOpen(o)) (openBySym[o.symbol] ??= []).push(o)
    for (const st of Object.values(w.stocks)) {
      if (st.status === 'delisted') continue
      const r = stepStockLatent(this, st, dt)
      if (st.status === 'suspended' || auctionClose) continue
      const prevPx = st.last
      const px = tradablePrice(this, st)
      writeMinute(this, st, prevPx, px, r, sessionMinute)
      // 6. 盘口
      const phaseMult = sessionMinute < 5 ? 1.8 : ph === 'closing' ? 1.3 : 1
      makeBook(this, st, px, phaseMult)
      // 7-9. 触发与撮合
      const list = openBySym[st.symbol]
      if (list) {
        checkTriggers(this, st, px)
        const live = list
          .filter((o) => (o.status === 'accepted' || o.status === 'partiallyFilled') && o.expireDay >= w.clock.tradingDay)
          .sort((a, b) => prio(b) - prio(a) || a.createdAt - b.createdAt)
        for (const o of live) matchOrder(this, o, st, false)
      }
    }
    // 10. 指数与快照
    updateIndices(this, !auctionClose)
    if (sessionMinute % 5 === 0) {
      w.account.equityIntraday.push({ t: w.clock.time, equity: equity(this) })
    }
    // 11. 风险与提醒
    this.checkAlerts()
    checkMargin(this, false)
    this.updatePeak()
  }

  private sessionMinute(): number {
    const m = this.minuteOfDay
    let acc = 0
    for (const [a, b] of this.rules.sessions.continuous) {
      if (m < a) return acc
      if (m < b) return acc + (m - a)
      acc += b - a
    }
    return acc + Math.max(0, m - this.rules.sessions.closing[0])
  }

  private overnight() {
    const w = this.w
    const rm = this.rng.market
    const rp = REGIME_PARAMS[w.regime.current]
    const dLn = (rp.sigma / Math.sqrt(252)) * Math.sqrt(0.25) * rm.normal() * w.volatilityMult
    w.regime.L += dLn
    for (const st of Object.values(w.stocks)) {
      if (st.status === 'delisted') continue
      const c = this.tmpl[st.symbol]
      const n = (c.volatility / Math.sqrt(252)) * Math.sqrt(0.15) * this.rng.stock.normal() * w.volatilityMult
      st.dev += n
      st.attrToday.noise += n
      st.attrToday.market += c.beta * dLn
    }
    // 盘后/夜间公告
    for (let i = 0; i < 2; i++) maybeRandomEvent(this, this.T * 0.12)
  }

  private dayStart() {
    const w = this.w
    w.clock.tradingDay++
    const td = w.clock.tradingDay
    w.clock.dayIndexOfTradingDay[td] = this.dayIndex
    w.clock.lastTradingDayIndex = this.dayIndex
    // 市场状态（Regime）转换
    const diff = DIFFICULTY_PARAMS[w.meta.difficulty]
    if (!w.challenge || w.challenge.finished) {
      const trans = REGIME_TRANSITIONS[w.regime.current]
      let r = this.rng.market.next()
      for (const [to, p] of Object.entries(trans)) {
        const pp = (p as number) * (to === 'crisis' ? diff.crisis : 1)
        if (r < pp) {
          w.regime.current = to as typeof w.regime.current
          w.regime.since = td
          this.notice('info', '市场环境变化', `宏观与情绪因素正在改变，市场进入新的阶段。可以在市场大厅查看情绪构成。`)
          break
        }
        r -= pp
      }
    }
    // 宏观缓慢漂移
    const m = w.macro
    const rmac = this.rng.macro
    m.commodity = clamp(m.commodity + 0.03 * (100 - m.commodity) + rmac.normal() * 1.2, 40, 220)
    m.riskAppetite = clamp(m.riskAppetite * 0.98 + REGIME_PARAMS[w.regime.current].sentiment * 0.02 + rmac.normal() * 0.03, -1, 1)
    m.yield10y = clamp(m.yield10y + 0.02 * (m.rate + 0.5 - m.yield10y) + rmac.normal() * 0.02, 0, 12)
    w.regime.Lstar = macroLstar(m)
    // 公司基本面（日频）
    for (const st of Object.values(w.stocks)) {
      if (st.status === 'delisted') continue
      const c = this.tmpl[st.symbol]
      const f = st.f
      f.growth += 0.01 * (f.growthLR - f.growth) + this.rng.earnings.normal() * 0.0015
      f.revenueAnnual *= Math.exp(f.growth / 252)
      const marginTarget = f.marginBase + 0.06 * c.commoditySensitivity * ((m.commodity - 100) / 100) + 0.03 * c.consumerSensitivity * ((m.consumerConfidence - 100) / 100)
      f.netMargin += 0.01 * (marginTarget - f.netMargin) + this.rng.earnings.normal() * 0.0006
      const ep = earningsPower(f.revenueAnnual, f.netMargin) * Math.exp(f.earningsPower)
      const newLn = st.lnFund0 + Math.log(Math.max(1e-6, ep) / f.ep0) + Math.log(valuationMult(c, m) / st.valMult0)
      st.attrToday.fundamental += newLn - st.lnFund
      st.lnFund = newLn
      st.minute = []
      st.tape = []
      st.open = st.high = st.low = st.last
      st.volume = 0
      st.amount = 0
      st.impacts = st.impacts.filter((x) => Math.abs(x.remaining) > 1e-5)
    }
    this.corp.processDayStart()
    for (const st of Object.values(w.stocks)) {
      if (st.status === 'delisted') continue
      computeLimits(this, st)
      st.open = st.high = st.low = st.last = st.prevClose
      makeBook(this, st, st.last, 2)
    }
    for (const idx of Object.values(w.indices)) {
      idx.prevClose = idx.value
      idx.open = idx.high = idx.low = idx.value
      idx.minute = []
    }
    scheduleReleases(this)
    maybeAnalystRevision(this)
    if (this.rng.opinion.chance(0.7)) opinionColumn(this)
    w.highImpactBudget = Math.min(2, w.highImpactBudget + 0.3)
    const a = w.account
    a.dayStartEquity = equity(this)
    a.dayStartPositions = Object.fromEntries(Object.values(a.positions).map((p) => [p.symbol, p.qty]))
    a.dayFees = 0
    a.equityIntraday = [{ t: w.clock.time, equity: a.dayStartEquity }]
    a.dayStartRisk = riskSnapshot(this)
    w.debug.push({ ts: w.clock.time, kind: 'factor', text: `交易日 ${td} 开始：状态 ${w.regime.current} L=${w.regime.L.toFixed(4)} L*=${w.regime.Lstar.toFixed(4)} 利率 ${m.rate} 通胀 ${m.inflation}` })
    this.markDirty(true)
  }

  private openingAuction() {
    const w = this.w
    for (const st of Object.values(w.stocks)) {
      if (st.status !== 'normal' && st.status !== 'delisting') continue
      const open = tradablePrice(this, st)
      st.open = st.high = st.low = st.last = open
      st.volume += Math.round(st.adv * 0.02)
      st.amount += Math.round(st.adv * 0.02) * open
      makeBook(this, st, open, 1.8)
      auctionMatch(this, st, open, 'open')
      if (Math.abs(open / st.prevClose - 1) > 0.05 && w.account.positions[st.symbol]?.qty)
        this.notice('warn', `开盘跳空 · ${this.tmpl[st.symbol].name}`, `开盘价 ${fmtPrice(open)}，较昨收 ${fmtPrice(st.prevClose)} ${open > st.prevClose ? '高开' : '低开'} ${((open / st.prevClose - 1) * 100).toFixed(1)}%。`, st.symbol)
    }
    updateIndices(this, true)
    for (const idx of Object.values(w.indices)) idx.open = idx.value
    if (this.tmp.forceAtOpen) {
      this.tmp.forceAtOpen = false
      forceLiquidate(this, '追加保证金期限已过仍未补足')
    }
    this.markDirty(true)
  }

  private closingAuction() {
    const w = this.w
    for (const st of Object.values(w.stocks)) {
      if (st.status !== 'normal' && st.status !== 'delisting') continue
      const prevPx = st.last
      const px = tradablePrice(this, st)
      writeMinute(this, st, prevPx, px, 0, this.T - 1)
      makeBook(this, st, px, 1.3)
      auctionMatch(this, st, px, 'close')
    }
    updateIndices(this, true)
  }

  private dayClose() {
    const w = this.w
    const td = w.clock.tradingDay
    if (td <= 0) return
    expireOrders(this)
    for (const st of Object.values(w.stocks)) {
      if (st.status === 'delisted') continue
      const traded = st.minute.length > 0
      if (traded) {
        st.daily.push({ t: td, o: st.open, h: st.high, l: st.low, c: st.last, v: st.volume, a: st.amount })
        st.adv = Math.round(st.adv * 0.95 + st.volume * 0.05)
        st.minuteBase = st.adv / this.T
      }
      const ret = Math.log(st.last / Math.max(1, st.prevClose))
      st.attrHistory.push({ day: td, a: st.attrToday, ret })
      if (st.attrHistory.length > 30) st.attrHistory.shift()
      if (Math.abs(ret) >= 0.04) {
        const a = st.attrToday
        const parts = [
          { label: '市场整体', value: a.market },
          { label: '行业因子', value: a.sector },
          { label: '基本面/估值变化', value: a.fundamental },
          { label: '情绪与趋势', value: a.sentiment },
          { label: '估值回归', value: a.reversion },
          { label: '随机扰动', value: a.noise },
          ...Object.entries(a.events).map(([id, v]) => ({ label: w.events.find((x) => x.id === id)?.title ?? '事件冲击', value: v, eventId: id })),
        ].sort((x, y) => Math.abs(y.value) - Math.abs(x.value))
        st.moves.push({ day: td, ret, parts: parts.slice(0, 6) })
        if (st.moves.length > 30) st.moves.shift()
      }
      st.attrToday = emptyAttr()
      st.prevClose = st.last
      computeLimits(this, st) // 盘后提交的次日订单按次日涨跌停区间校验
    }
    for (const idx of Object.values(w.indices)) {
      idx.daily.push({ t: td, o: idx.open, h: idx.high, l: idx.low, c: idx.value, v: idx.members.reduce((s, x) => s + w.stocks[x].amount, 0) })
    }
    // 融资利息与借券费
    const a = w.account
    if (a.marginEnabled) {
      if (a.cash < 0) {
        const interest = Math.round((-a.cash * this.rules.margin.interestRate) / 252)
        if (interest > 0) {
          ledger(this, 'marginInterest', -interest, `融资利息（年化 ${(this.rules.margin.interestRate * 100).toFixed(1)}%）`)
          a.interestTotal += interest
        }
      }
      for (const p of Object.values(a.positions)) {
        if (p.qty >= 0) continue
        const st = w.stocks[p.symbol]
        const fee = Math.round((-p.qty * st.last * st.borrowRate) / 252)
        if (fee > 0) {
          ledger(this, 'borrowFee', -fee, `${p.symbol} 借券费（年化 ${(st.borrowRate * 100).toFixed(1)}%）`, { symbol: p.symbol })
          a.interestTotal += fee
        }
      }
      checkMargin(this, true)
    }
    const eq = equity(this)
    a.equityDaily.push({ day: td, equity: eq, cash: a.cash, mv: eq - a.cash, nav: nav(this), bench: w.indices.PXC.value })
    this.updatePeak()
    // 统计
    const s = w.stats
    s.daysPlayed++
    const held = Object.values(a.positions).filter((p) => p.qty !== 0)
    for (const p of held) s.daysHeldMax = Math.max(s.daysHeldMax, td - p.openedDay)
    s.maxPositionsHeld = Math.max(s.maxPositionsHeld, held.length)
    s.maxSectorsHeld = Math.max(s.maxSectorsHeld, new Set(held.map((p) => this.tmpl[p.symbol].sector)).size)
    const pxc = w.indices.PXC
    const cashRatio = eq > 0 ? Math.max(0, a.cash) / eq : 0
    if (pxc.value / pxc.prevClose - 1 < -0.025 && cashRatio >= 0.3) s.cashRatioUnderStress++
    if (w.regime.current === 'crisis' && eq > 0) s.crisisDaysSurvived++
    this.corp.processDayEnd()
    // 收盘总结
    const sum = buildDailySummary(this)
    w.summaries.push(sum)
    if (w.summaries.length > 400) w.summaries.shift()
    w.pendingSummaryDay = td
    // 挑战
    if (w.challenge && !w.challenge.finished) {
      w.challenge.minCashRatio = Math.min(w.challenge.minCashRatio, cashRatio)
      if (td >= w.challenge.endDay) this.emit({ type: 'challengeEnd' })
    }
    // 订单与成交保留上限（已结束订单仍可在导出中查询）
    if (w.orders.length > 4000) w.orders = w.orders.filter((o, i) => isOpen(o) || i > w.orders.length - 3500)
    this.emit({ type: 'dayClose', day: td })
    this.markDirty(true)
  }

  private updatePeak() {
    const a = this.w.account
    const n = nav(this)
    if (n > a.peakNav) a.peakNav = n
    a.peakEquity = Math.max(a.peakEquity, equity(this))
    const dd = a.peakNav > 0 ? Math.max(0, 1 - n / a.peakNav) : 0
    a.maxDrawdown = Math.max(a.maxDrawdown, dd)
  }

  private checkAlerts() {
    for (const al of this.w.alerts) {
      if (al.triggeredAt) continue
      const st = this.w.stocks[al.symbol]
      if (!st) continue
      const hit = al.direction === 'above' ? st.last >= al.price : st.last <= al.price
      if (hit) {
        al.triggeredAt = this.w.clock.time
        this.notice('warn', `价格提醒 · ${this.tmpl[al.symbol].name}`, `最新价 ${fmtPrice(st.last)} 已${al.direction === 'above' ? '升至' : '跌至'}提醒价 ${fmtPrice(al.price)}。提醒不会自动下单。`, al.symbol)
        this.emit({ type: 'alert', symbol: al.symbol, price: st.last })
      }
    }
  }

  // ------------------------------------------------------------------ 命令
  submit(req: OrderRequest) {
    return submitOrder(this, req)
  }
  cancel(id: string) {
    return cancelOrder(this, id)
  }
  deposit(yuan: number): { ok: boolean; message: string } {
    const c = Math.round(yuan * 100)
    if (!(c > 0) || c > 1e12) return { ok: false, message: '金额无效' }
    const a = this.w.account
    const n = nav(this)
    a.navUnits += c / Math.max(1e-9, n)
    a.netDeposits += c
    ledger(this, 'deposit', c, `追加虚拟资金 ${fmtMoney(c)}（按当前单位净值折算份额，不影响收益率）`)
    this.logCommand('deposit', { yuan })
    this.markDirty(true)
    return { ok: true, message: `已追加 ${fmtMoney(c)}` }
  }
  setMargin(enabled: boolean): { ok: boolean; message: string } {
    const a = this.w.account
    const r = this.rules
    if (enabled) {
      if (!r.margin.enabled) return { ok: false, message: `当前规则包（${r.name}）未启用保证金交易` }
      a.marginEnabled = true
      this.w.flags.enabled_advanced = true
      this.logCommand('setMargin', { enabled })
      this.markDirty(true)
      return { ok: true, message: '已开启进阶模式：保证金账户与卖空。请注意杠杆会同时放大收益与亏损。' }
    }
    const hasShort = Object.values(a.positions).some((p) => p.qty < 0)
    if (hasShort || a.cash < 0) return { ok: false, message: '存在空头持仓或融资负债，需先平仓/还款后才能关闭' }
    if (this.w.orders.some((o) => isOpen(o) && (o.side === 'short' || o.side === 'cover'))) return { ok: false, message: '存在未完成的卖空/平空订单' }
    a.marginEnabled = false
    a.marginCall = null
    this.markDirty(true)
    return { ok: true, message: '已关闭进阶模式' }
  }
  addAlert(symbol: string, price: number, direction: 'above' | 'below') {
    this.w.alerts.push({ id: this.nextId('AL'), symbol, price, direction, createdAt: this.w.clock.time })
    this.w.stats.alertsSet++
    this.w.flags.set_price_alert = true
    this.markDirty()
  }
  removeAlert(id: string) {
    this.w.alerts = this.w.alerts.filter((a) => a.id !== id)
    this.markDirty()
  }
  toggleWatch(sym: string) {
    const wl = this.w.watchlist
    const i = wl.indexOf(sym)
    if (i >= 0) wl.splice(i, 1)
    else {
      wl.push(sym)
      this.w.stats.watchlistAdds++
    }
    this.markDirty()
  }
  toggleWatchEvent(newsId: string) {
    const l = this.w.watchedEvents
    const i = l.indexOf(newsId)
    if (i >= 0) l.splice(i, 1)
    else {
      l.push(newsId)
      this.w.stats.eventsWatched++
    }
    this.markDirty()
  }
  toggleReviewLater(newsId: string) {
    const l = this.w.reviewLater
    const i = l.indexOf(newsId)
    if (i >= 0) l.splice(i, 1)
    else l.push(newsId)
    this.markDirty()
  }
  setFlag(k: string) {
    if (!this.w.flags[k]) {
      this.w.flags[k] = true
      this.markDirty()
    }
  }
  bump(k: keyof WorldState['stats'], n = 1) {
    ;(this.w.stats[k] as number) += n
    this.markDirty()
  }

  // ------------------------------------------------------------------ 查询
  stock(sym: string): StockState {
    return this.w.stocks[sym]
  }
  leverage(): number {
    return grossExposure(this) / Math.max(1, equity(this))
  }
  sectorName(id: string) {
    return SECTORS.find((s) => s.id === id)?.name ?? id
  }
}

function prio(o: Order): number {
  if (o.type === 'market' || (o.type === 'stop' && o.triggered)) return 1e12
  const buy = o.side === 'buy' || o.side === 'cover'
  return buy ? o.limitPrice ?? 0 : 1e11 - (o.limitPrice ?? 0)
}
