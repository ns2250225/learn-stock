import { COMPANIES } from './content/companies'
import { SECTORS } from './content/sectors'
import { Rng } from './rng'
import { RULE_PACKS } from './rules'
import { quarterLabel } from './clock'
import { DIFFICULTY_PARAMS, HISTORY_DAYS, QUARTER_DAYS, REGIME_PARAMS, TIER_TURNOVER, K_DEV, K_L, K_S, SECTOR_SIGMA } from './params'
import type { Bar, Difficulty, FinancialReport, GameMode, IndexState, StockState, WorldState } from './state'
import type { CompanyTemplate, MacroState, PlayerStats, Regime, RulesId, SectorId } from './types'
import { clamp, roundTick } from './util'

export interface NewGameOptions {
  name: string
  mode: GameMode
  rulesId: RulesId
  difficulty: Difficulty
  seed: string
  initialCash: number // 元
  challengeId?: string
  regime?: Regime
  macro?: Partial<MacroState>
  eventFrequency?: number
  volatilityMult?: number
}

export const RNG_STREAMS = ['market', 'stock', 'book', 'events', 'earnings', 'corp', 'macro', 'opinion', 'history'] as const

export const DEFAULT_MACRO: MacroState = {
  rate: 2.5,
  inflation: 2.2,
  growth: 5.0,
  unemployment: 5.1,
  riskAppetite: 0.1,
  commodity: 100,
  consumerConfidence: 100,
  yield10y: 2.9,
}

export function emptyStats(): PlayerStats {
  return {
    ordersSubmitted: 0, marketOrders: 0, limitOrders: 0, stopOrders: 0, stopLimitOrders: 0, ordersAccepted: 0,
    ordersRejected: 0, ordersCancelled: 0, ordersExpired: 0, partialFills: 0, ordersFilled: 0, limitFilled: 0,
    marketFilled: 0, stopTriggered: 0, stopLimitTriggered: 0, stopGapFills: 0, fills: 0, buys: 0, sells: 0,
    feesPaid: 0, smallTrades: 0, plansCreated: 0, plansWithExit: 0, tradesWithPlan: 0, reviewsCompleted: 0,
    reviewStreak: 0, bestReviewStreak: 0, dailySummaries: 0, biasTags: 0, newsOpened: 0, newsAnalysisViewed: 0,
    newsRetroViewed: 0, earningsNewsOpened: 0, mixedEarningsOpened: 0, watchlistAdds: 0, eventsWatched: 0,
    stockDetailViews: 0, financialsViewed: 0, valuationViewed: 0, peersCompared: 0, cashflowCompared: 0,
    riskPanelViewed: 0, sectorPanelViewed: 0, calendarViewed: 0, attributionViewed: 0, lessonsCompleted: 0,
    quizCorrect: 0, quizWrong: 0, wrongReviewed: 0, dividendsReceived: 0, exDividendHeld: 0, splitsHeld: 0,
    rightsSubscribed: 0, daysPlayed: 0, daysHeldMax: 0, maxSectorsHeld: 0, maxPositionsHeld: 0, shortsOpened: 0,
    marginCalls: 0, forcedLiquidations: 0, leverageUsedMax: 0, exports: 0, manualSaves: 0, alertsSet: 0,
    tranchePlans: 0, heldThroughEarnings: 0, suspensionsHeld: 0, cashRatioUnderStress: 0, crisisDaysSurvived: 0,
    notesWritten: 0,
  }
}

export function emptyAttr() {
  return { market: 0, sector: 0, fundamental: 0, sentiment: 0, noise: 0, reversion: 0, events: {} as Record<string, number> }
}

export function earningsPower(revenue: number, margin: number): number {
  return revenue * Math.max(0.02, 0.1 + margin)
}

export function valuationMult(c: CompanyTemplate, m: MacroState): number {
  return Math.exp(
    c.rateSensitivity * (m.rate - DEFAULT_MACRO.rate) * 0.06 +
      c.rateSensitivity * (m.yield10y - DEFAULT_MACRO.yield10y) * 0.04 +
      c.commoditySensitivity * Math.log(Math.max(30, m.commodity) / 100) * 0.35 +
      c.consumerSensitivity * ((m.consumerConfidence - 100) / 100) * 0.5 +
      (c.beta - 1) * m.riskAppetite * 0.08,
  )
}

export function macroLstar(m: MacroState): number {
  return (
    -0.07 * (m.rate - DEFAULT_MACRO.rate) -
    0.04 * (m.yield10y - DEFAULT_MACRO.yield10y) +
    0.03 * (m.growth - DEFAULT_MACRO.growth) +
    0.12 * m.riskAppetite -
    0.02 * (m.unemployment - DEFAULT_MACRO.unemployment)
  )
}

function companyGrowthLR(c: CompanyTemplate): number {
  let g = 0.04
  if (c.styles.includes('growth')) g = 0.12
  if (c.styles.includes('speculative')) g = 0.1
  if (c.styles.includes('value') || c.styles.includes('dividend') || c.styles.includes('stable')) g = 0.035
  if (c.styles.includes('cyclical')) g = 0.04
  if (c.styles.includes('turnaround')) g = 0.06
  return g
}

export function createWorld(opts: NewGameOptions): WorldState {
  const rules = RULE_PACKS[opts.rulesId]
  const diff = DIFFICULTY_PARAMS[opts.difficulty]
  const rng: Record<string, Rng> = {}
  for (const s of RNG_STREAMS) rng[s] = Rng.from(opts.seed, s)
  const h = rng.history
  const macro: MacroState = { ...DEFAULT_MACRO, ...(opts.macro ?? {}) }
  const tick = rules.tickSize

  // ---- 股票初始化 ----
  const stocks: Record<string, StockState> = {}
  const offsets = h.sample(
    Array.from({ length: 30 }, (_, i) => 6 + i),
    30,
  )
  COMPANIES.forEach((c, idx) => {
    const shares = Math.round(c.sharesOutstanding * 1e6)
    const floatShares = Math.round(shares * c.floatRatio)
    const eps = (c.revenue * c.netMargin) / c.sharesOutstanding
    const bvps = c.basePrice / c.pb
    const ep0 = earningsPower(c.revenue, c.netMargin)
    const adv = Math.max(2000, Math.round(floatShares * TIER_TURNOVER[c.liquidityTier]))
    const borrowAvail = Math.round(floatShares * (c.liquidityTier >= 4 ? 0.002 : 0.01) * h.range(0.5, 1.5))
    const offset = offsets[idx % offsets.length] + (idx >= 30 ? 3 : 0)
    stocks[c.symbol] = {
      symbol: c.symbol,
      status: 'normal',
      riskWarning: false,
      lowPriceDays: 0,
      last: 0,
      prevClose: 0,
      open: 0,
      high: 0,
      low: 0,
      volume: 0,
      amount: 0,
      limitUp: 0,
      limitDown: 0,
      lnFund: Math.log(c.basePrice),
      lnFund0: Math.log(c.basePrice),
      valMult0: valuationMult(c, DEFAULT_MACRO),
      dev: 0,
      sentiment: 0,
      volState: 1,
      overnightGap: 0,
      stepIndex: 0,
      impacts: [],
      modifiers: [],
      daily: [],
      minute: [],
      book: { bids: [], asks: [], spreadTicks: 1 },
      tape: [],
      adv,
      minuteBase: adv / 240,
      f: {
        revenueAnnual: c.revenue,
        growth: c.revenueGrowth,
        growthLR: companyGrowthLR(c),
        grossMargin: c.grossMargin,
        netMargin: c.netMargin,
        marginBase: c.netMargin,
        debtRatio: c.debtRatio,
        ocfRatio: c.ocfToNetIncome,
        equity: (bvps * shares) / 1e6,
        shares,
        floatShares,
        earningsPower: 0,
        ep0,
        nextQuarterK: -1,
        epsTTM: eps,
        dpsTTM: Math.max(0, eps * c.payoutRatio),
        bvps,
      },
      reports: [],
      expectation: { nextPeriod: quarterLabel(-1), eps: 0, revenue: 0, revisions: [] },
      nextEarningsDay: offset,
      earningsOffset: offset,
      borrowAvailable: borrowAvail,
      borrowRate: rules.shortSelling.baseBorrowRate * (c.liquidityTier >= 4 ? 2.5 : 1) * (c.styles.includes('speculative') ? 2 : 1),
      attrToday: emptyAttr(),
      attrHistory: [],
      moves: [],
      splitFactor: 1,
      shareHistory: [{ day: -HISTORY_DAYS, shares, note: '期初股本' }],
    }
  })

  // ---- 历史行情（日频，使用同一因子模型） ----
  let L = 0
  let regime: Regime = opts.regime ?? 'sideways'
  const S: Record<string, number> = {}
  for (const s of SECTORS) S[s.id] = 0
  const limitPct = rules.priceLimit.enabled ? rules.priceLimit.pct : 10
  const devs: Record<string, number> = {}
  const prevClose: Record<string, number> = {}
  for (const c of COMPANIES) {
    devs[c.symbol] = h.normal() * 0.05
    prevClose[c.symbol] = 0
  }
  const startPrice: Record<string, number> = {}
  // 起始价倒推：令历史末期价格接近模板参考价
  for (const c of COMPANIES) startPrice[c.symbol] = c.basePrice * Math.exp(-c.revenueGrowth * 0.6 * (HISTORY_DAYS / 252))
  for (let d = -HISTORY_DAYS + 1; d <= 0; d++) {
    const rp = REGIME_PARAMS[regime]
    const zm = h.normal()
    const dL = rp.mu / 252 + (rp.sigma / Math.sqrt(252)) * zm * diff.vol + K_L * (0 - L)
    L += dL
    if (d > -HISTORY_DAYS + 10 && h.chance(0.01)) regime = h.pick(['bull', 'bear', 'sideways', 'volatile'] as Regime[])
    for (const s of SECTORS) S[s.id] += (SECTOR_SIGMA / Math.sqrt(252)) * h.normal() - K_S * S[s.id]
    const frac = (d + HISTORY_DAYS) / HISTORY_DAYS
    for (const c of COMPANIES) {
      const st = stocks[c.symbol]
      const sigmaD = (c.volatility / Math.sqrt(252)) * diff.vol
      let jump = 0
      if (h.chance(0.012 * c.eventSensitivity)) jump = h.normal() * 0.05 * c.eventSensitivity
      devs[c.symbol] += -K_DEV * devs[c.symbol] + sigmaD * h.normal() + jump
      const lnF = Math.log(startPrice[c.symbol]) + (Math.log(c.basePrice) - Math.log(startPrice[c.symbol])) * frac
      const x = lnF + c.beta * L + c.sectorSensitivity * S[c.sector] + devs[c.symbol]
      let close = Math.exp(x) * 100
      const pc = prevClose[c.symbol] || close
      if (rules.priceLimit.enabled) close = clamp(close, pc * (1 - limitPct), pc * (1 + limitPct))
      const gap = h.normal() * sigmaD * 0.3
      let open = clamp(pc * Math.exp(gap), pc * (1 - limitPct), pc * (1 + limitPct))
      if (!prevClose[c.symbol]) open = close * Math.exp(h.normal() * sigmaD * 0.2)
      const hi = Math.max(open, close) * Math.exp(Math.abs(h.normal()) * sigmaD * 0.4)
      const lo = Math.min(open, close) * Math.exp(-Math.abs(h.normal()) * sigmaD * 0.4)
      const ret = Math.log(close / pc)
      const vol = Math.round(st.adv * Math.exp(h.normal() * 0.3) * (1 + Math.min(3, (Math.abs(ret) / Math.max(0.005, sigmaD)) * 0.25)))
      const bar: Bar = {
        t: d,
        o: roundTick(open, tick),
        h: roundTick(rules.priceLimit.enabled ? Math.min(hi, pc * (1 + limitPct)) : hi, tick),
        l: roundTick(rules.priceLimit.enabled ? Math.max(lo, pc * (1 - limitPct)) : lo, tick),
        c: roundTick(close, tick),
        v: vol,
        a: 0,
      }
      bar.h = Math.max(bar.h, bar.o, bar.c)
      bar.l = Math.min(bar.l, bar.o, bar.c)
      bar.a = Math.round(vol * ((bar.o + bar.c) / 2))
      st.daily.push(bar)
      prevClose[c.symbol] = bar.c
    }
  }
  // 将最后状态写入潜在价格分解：lnFund 取末期基本面，dev 吸收偏离
  for (const c of COMPANIES) {
    const st = stocks[c.symbol]
    const lastBar = st.daily[st.daily.length - 1]
    st.dev = Math.log(lastBar.c / 100) - (st.lnFund + c.beta * L + c.sectorSensitivity * S[c.sector])
    st.last = lastBar.c
    st.prevClose = lastBar.c
    st.open = lastBar.o
    st.high = lastBar.h
    st.low = lastBar.l
    st.adv = Math.round(st.daily.slice(-20).reduce((a, b) => a + b.v, 0) / 20)
  }

  // ---- 历史财报（8 个季度）与当前预期 ----
  for (const c of COMPANIES) {
    const st = stocks[c.symbol]
    const reports: FinancialReport[] = []
    for (let k = -9; k <= -2; k++) {
      const yearsBack = (-1 - k) / 4
      const revQ = (c.revenue / 4) * Math.exp(-c.revenueGrowth * yearsBack) * (1 + h.normal() * 0.03)
      const marginQ = c.netMargin + h.normal() * 0.01 * (2 - c.reportReliability)
      const ni = revQ * marginQ
      const eps = ni / c.sharesOutstanding
      const expEps = eps * (1 + h.normal() * 0.06)
      const expRev = revQ * (1 + h.normal() * 0.025)
      const equity = st.f.equity * Math.exp(-0.08 * yearsBack)
      const assets = equity / Math.max(0.05, 1 - c.debtRatio)
      const ocf = ni * c.ocfToNetIncome * (1 + h.normal() * 0.15)
      const epsS = (eps - expEps) / Math.max(0.01, Math.abs(expEps))
      const revS = (revQ - expRev) / expRev
      const outcome: FinancialReport['outcome'] =
        Math.sign(epsS) !== Math.sign(revS) && Math.abs(epsS) > 0.02 && Math.abs(revS) > 0.01
          ? 'mixed'
          : epsS > 0.03
            ? 'beat'
            : epsS < -0.03
              ? 'miss'
              : 'meet'
      const publishDay = QUARTER_DAYS * (k + 1) + st.earningsOffset
      reports.push({
        id: `${c.symbol}-${quarterLabel(k)}`,
        symbol: c.symbol,
        period: quarterLabel(k),
        publishDay,
        publishAt: 0,
        revenue: revQ,
        revenueYoY: Math.exp(c.revenueGrowth) - 1 + h.normal() * 0.02,
        grossMargin: c.grossMargin + h.normal() * 0.01,
        netIncome: ni,
        netMargin: marginQ,
        eps,
        operatingCashFlow: ocf,
        freeCashFlow: ocf - revQ * 0.05,
        totalAssets: assets,
        totalLiabilities: assets - equity,
        equity,
        debtRatio: (assets - equity) / assets,
        roe: (ni * 4) / equity,
        expectedEps: expEps,
        expectedRevenue: expRev,
        guidance: h.pick(['raise', 'maintain', 'maintain', 'lower'] as const),
        outcome,
        outcomeNote: '',
      })
    }
    st.reports = reports
    st.f.epsTTM = reports.slice(-4).reduce((a, r) => a + r.eps, 0)
    st.f.nextQuarterK = -1
    const nextEps = (st.f.revenueAnnual / 4) * st.f.netMargin / (st.f.shares / 1e6)
    st.expectation = {
      nextPeriod: quarterLabel(-1),
      eps: nextEps * (1 + h.normal() * 0.05),
      revenue: (st.f.revenueAnnual / 4) * (1 + h.normal() * 0.02),
      revisions: [],
    }
  }

  // ---- 指数 ----
  const indices: Record<string, IndexState> = {}
  const allSyms = COMPANIES.map((c) => c.symbol)
  const mcap0 = (sym: string) => stocks[sym].f.shares * stocks[sym].daily[0].c
  const byCap = [...allSyms].sort((a, b) => mcap0(b) - mcap0(a))
  const defs: { id: string; name: string; members: string[] }[] = [
    { id: 'PXC', name: '像素综合指数', members: allSyms },
    { id: 'PX30', name: '像素蓝筹 30', members: byCap.slice(0, 30) },
    ...SECTORS.map((s) => ({
      id: 'SEC_' + s.id,
      name: `${s.name}行业指数`,
      members: COMPANIES.filter((c) => c.sector === s.id).map((c) => c.symbol),
    })),
  ]
  for (const d of defs) {
    const base = d.members.reduce((a, s) => a + mcap0(s), 0)
    const divisor = base / 1000
    const idx: IndexState = { id: d.id, name: d.name, members: d.members, divisor, value: 1000, prevClose: 1000, open: 1000, high: 1000, low: 1000, daily: [], minute: [] }
    for (let i = 0; i < HISTORY_DAYS; i++) {
      let o = 0, hh = 0, l = 0, cc = 0, v = 0
      for (const s of d.members) {
        const b = stocks[s].daily[i]
        const sh = stocks[s].f.shares
        o += b.o * sh; hh += b.h * sh; l += b.l * sh; cc += b.c * sh; v += b.a
      }
      idx.daily.push({ t: stocks[d.members[0]].daily[i].t, o: o / divisor, h: hh / divisor, l: l / divisor, c: cc / divisor, v })
    }
    const lastBar = idx.daily[idx.daily.length - 1]
    idx.value = lastBar.c
    idx.prevClose = lastBar.c
    idx.open = lastBar.o
    idx.high = lastBar.h
    idx.low = lastBar.l
    indices[d.id] = idx
  }

  const sectorFactors = Object.fromEntries(SECTORS.map((s) => [s.id, { S: S[s.id], sentiment: 0 }])) as WorldState['sectorFactors']
  const initialCash = Math.round(opts.initialCash * 100)
  const watchlist = SECTORS.slice(0, 8).map((s) => {
    const cands = COMPANIES.filter((c) => c.sector === s.id).sort((a, b) => mcap0(b.symbol) - mcap0(a.symbol))
    return cands[0].symbol
  })

  const now = new Date().toISOString()
  const world: WorldState = {
    schema: 'pixel-stock-save',
    schemaVersion: 1,
    meta: {
      id: 'w' + Date.now().toString(36),
      name: opts.name,
      mode: opts.mode,
      rulesId: opts.rulesId,
      rulesVersion: rules.version,
      feeVersion: rules.fees.version,
      difficulty: opts.difficulty,
      worldSeed: opts.seed,
      createdAt: now,
      savedAt: now,
      initialCash,
      challengeId: opts.challengeId,
    },
    clock: { time: 0, tradingDay: 0, lastTradingDayIndex: -1, dayIndexOfTradingDay: {} },
    rng: {},
    macro,
    macro0: { ...macro },
    macroHistory: [{ day: 0, ...macro }],
    releases: [],
    regime: { current: opts.regime ?? regime, since: 0, L, Lstar: macroLstar(macro) },
    sectorFactors,
    marketSentiment: 0,
    eventFrequency: (opts.eventFrequency ?? 1) * diff.eventsPerDay * (opts.mode === 'tutorial' ? 0.6 : 1),
    volatilityMult: (opts.volatilityMult ?? 1) * diff.vol,
    stocks,
    indices,
    events: [],
    pending: [],
    cooldowns: {},
    highImpactBudget: 1,
    news: [],
    actions: [],
    account: {
      cash: initialCash,
      frozen: 0,
      positions: {},
      netDeposits: initialCash,
      navUnits: initialCash / 100,
      realizedTotal: 0,
      feesTotal: 0,
      dividendsTotal: 0,
      interestTotal: 0,
      peakEquity: initialCash,
      peakNav: 100,
      maxDrawdown: 0,
      marginEnabled: false,
      marginCall: null,
      equityDaily: [],
      equityIntraday: [],
      dayStartEquity: initialCash,
      dayStartPositions: {},
      dayFees: 0,
      rightsPending: [],
    },
    orders: [],
    executions: [],
    ledger: [],
    idempotency: {},
    seq: {},
    plans: [],
    reviews: [],
    summaries: [],
    alerts: [],
    notices: [],
    watchlist,
    watchedEvents: [],
    reviewLater: [],
    stats: emptyStats(),
    flags: {},
    debug: [],
    commandLog: [],
  }
  for (const s of RNG_STREAMS) world.rng[s] = rng[s].state()
  return world
}
