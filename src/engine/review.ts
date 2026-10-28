import type { Engine } from './engine'
import type { Cents, DailySummary, Order, TradePlan, TradeReview } from './types'
import { SECTORS } from './content/sectors'
import { equity, grossExposure, longValue, positionSummary } from './trading'
import { SIDE_LABEL } from './rules'
import { fmtMoney, fmtPct } from './util'

export interface PlanInput {
  symbol: string
  reason: string
  hypothesis: string
  horizon: 'short' | 'medium' | 'long'
  invalidation: string
  targetPct: number
  stopPrice?: Cents
  targetPrice?: Cents
  tranches?: { price: Cents; qty: number }[]
}

export function createPlan(e: Engine, input: PlanInput): TradePlan {
  const st = e.w.stocks[input.symbol]
  const eq = equity(e)
  const invest = Math.round(eq * input.targetPct)
  const estFee = Math.round(Math.max(e.rules.fees.minCommission, invest * e.rules.fees.commissionRate) * 2 + invest * e.rules.fees.stampTaxSellRate)
  const estMaxLoss = input.stopPrice && st.last > 0 ? Math.round(invest * Math.max(0, 1 - input.stopPrice / st.last)) + estFee : invest
  const plan: TradePlan = {
    id: e.nextId('P'),
    symbol: input.symbol,
    createdAt: e.w.clock.time,
    reason: input.reason,
    hypothesis: input.hypothesis,
    horizon: input.horizon,
    invalidation: input.invalidation,
    targetPct: input.targetPct,
    stopPrice: input.stopPrice,
    targetPrice: input.targetPrice,
    estFee,
    estMaxLoss,
    tranches: input.tranches?.map((t) => ({ ...t })),
    status: 'active',
    linkedOrderIds: [],
  }
  e.w.plans.push(plan)
  e.w.stats.plansCreated++
  if (input.invalidation.trim() || input.stopPrice) e.w.stats.plansWithExit++
  if (input.tranches?.length) e.w.stats.tranchePlans++
  e.logCommand('createPlan', input)
  e.markDirty(true)
  return plan
}

function dayReturn(e: Engine, sym: string, days: number): number {
  const st = e.w.stocks[sym]
  const d = st.daily
  if (d.length < days) return 0
  return st.last / d[d.length - days].c - 1
}

/** 依据可观察的交易记录给出「可能的」行为偏差提示 */
export function biasHints(e: Engine, o: Order): string[] {
  const hints: string[] = []
  const w = e.w
  const sym = o.symbol
  const buyish = o.side === 'buy' || o.side === 'short'
  const notional = o.filledQty * o.avgFillPrice
  if (buyish && !o.planId) hints.push('本次开仓未关联交易计划：事后较难判断交易是否按预期执行。')
  // 连续亏损后加大仓位
  const closes = w.executions.filter((x) => x.realizedPnl !== undefined && x.orderId !== o.id)
  const lastOrders = Array.from(new Set(closes.slice(-6).map((x) => x.orderId))).slice(-2)
  const lossBoth = lastOrders.length === 2 && lastOrders.every((id) => closes.filter((x) => x.orderId === id).reduce((a, x) => a + (x.realizedPnl ?? 0), 0) < 0)
  const prevNotionals = w.orders.filter((x) => x.id !== o.id && x.filledQty > 0 && x.source === 'player').slice(-5).map((x) => x.filledQty * x.avgFillPrice)
  const med = prevNotionals.length ? prevNotionals.sort((a, b) => a - b)[Math.floor(prevNotionals.length / 2)] : 0
  if (buyish && lossBoth && med > 0 && notional > med * 1.5) hints.push('连续两笔亏损后，本次开仓金额明显高于近期中位数——可能存在「报复性交易/加大仓位」倾向。')
  if (o.side === 'buy') {
    const r3 = dayReturn(e, sym, 3)
    const st = w.stocks[sym]
    const intraday = st.prevClose ? st.last / st.prevClose - 1 : 0
    if (r3 > 0.08 || intraday > 0.06) hints.push(`买入前该股近 3 日涨幅 ${fmtPct(r3, 1)}、当日 ${fmtPct(intraday, 1)}：可以考虑检查是否在追涨（FOMO）。`)
    const p = w.account.positions[sym]
    if (p && p.qty > 0) {
      const s = positionSummary(e, p)
      if (p.costBasis > 0 && s.unreal / p.costBasis < -0.15) hints.push('在浮亏超过 15% 的持仓上继续买入：摊低成本前，可以考虑检查原交易假设是否仍然成立。')
    }
    const lastLoss = [...w.executions].reverse().find((x) => x.symbol === sym && (x.realizedPnl ?? 0) < 0)
    if (lastLoss && o.createdAt - lastLoss.ts < 30) hints.push('在同一股票亏损卖出后 30 分钟内再次买入：可能是情绪驱动的报复性交易。')
  }
  if (o.side === 'sell') {
    const r3 = dayReturn(e, sym, 3)
    const recentBad = w.news.some((n) => n.ts >= o.createdAt - 30 && n.ts <= o.createdAt && (n.symbols.includes(sym) || n.importance >= 3))
    if (r3 < -0.08 && recentBad) hints.push(`卖出前该股 3 日跌幅 ${fmtPct(r3, 1)}，且刚出现重要新闻：可以回顾这是按计划止损，还是恐慌性卖出。`)
    const realized = w.executions.filter((x) => x.orderId === o.id).reduce((a, x) => a + (x.realizedPnl ?? 0), 0)
    if (realized > 0) {
      const losers = Object.values(w.account.positions).filter((p) => p.qty > 0 && p.symbol !== sym && positionSummary(e, p).unreal / Math.max(1, p.costBasis) < -0.1)
      if (losers.length) hints.push(`卖出盈利持仓的同时继续持有 ${losers.length} 只浮亏超过 10% 的股票：可能存在「处置效应」（过早卖出赢家、拖延卖出输家）。`)
    }
  }
  const today = w.orders.filter((x) => x.createdDay === w.clock.tradingDay && x.source === 'player').length
  if (today >= 10) hints.push(`今日已提交 ${today} 笔订单：频繁交易会累积费用与滑点，可以考虑检查是否存在过度交易。`)
  const eq = equity(e)
  const p = w.account.positions[sym]
  if (p && eq > 0) {
    const wgt = Math.abs(p.qty * w.stocks[sym].last) / eq
    if (wgt > 0.4) hints.push(`交易后该股占账户净值 ${fmtPct(wgt, 0, false)}：单一股票集中度较高。`)
  }
  return hints
}

const LEARN_TAGS: Record<string, { tag: string; q: string }> = {
  market: { tag: 'slippage', q: '这笔市价单的成交价与下单时中间价相差多少？如果用限价单，结果会怎样？' },
  limit: { tag: 'limit_order', q: '限价单的价格条件让你得到了什么，又可能错过了什么？' },
  stop: { tag: 'stop_loss_gap', q: '止损触发价与实际成交价之间的差异来自哪里？' },
  stopLimit: { tag: 'stop_limit_order', q: '如果价格跳过了你的限价，这张单会发生什么？' },
}

export function createReview(e: Engine, o: Order) {
  if (o.source !== 'player' || o.filledQty <= 0) return
  if (e.w.reviews.some((r) => r.orderId === o.id)) return
  const execs = e.w.executions.filter((x) => x.orderId === o.id)
  const realized = execs.reduce((a, x) => a + (x.realizedPnl ?? 0), 0)
  const slip = execs.reduce((a, x) => a + x.slippage * x.qty, 0)
  const plan = o.planId ? e.w.plans.find((p) => p.id === o.planId) : undefined
  const eq = Math.max(1, o.snapshot.equity)
  const lt = LEARN_TAGS[o.type]
  const r: TradeReview = {
    id: e.nextId('R'),
    orderId: o.id,
    symbol: o.symbol,
    side: o.side,
    createdAt: e.w.clock.time,
    completed: false,
    qty: o.filledQty,
    avgPrice: o.avgFillPrice,
    fees: o.fees,
    slippageTotal: Math.round(slip),
    realizedPnl: realized,
    equityImpactPct: (realized - (o.side === 'buy' || o.side === 'short' ? o.fees : 0)) / eq,
    planId: o.planId,
    planSummary: plan ? `理由：${plan.reason}｜假设：${plan.hypothesis}｜退出条件：${plan.invalidation || '未填写'}｜计划仓位 ${fmtPct(plan.targetPct, 0, false)}` : undefined,
    snapshot: o.snapshot,
    biasHints: biasHints(e, o),
    selfBiasTags: [],
    note: '',
    learnTag: lt.tag,
    question: lt.q,
  }
  e.w.reviews.push(r)
  e.emit({ type: 'review', review: r })
}

export function completeReview(e: Engine, id: string, input: { followedPlan: TradeReview['followedPlan']; selfBiasTags: string[]; note: string }) {
  const r = e.w.reviews.find((x) => x.id === id)
  if (!r || r.completed) return null
  r.followedPlan = input.followedPlan
  r.selfBiasTags = input.selfBiasTags
  r.note = input.note
  r.completed = true
  const plan = r.planId ? e.w.plans.find((p) => p.id === r.planId) : undefined
  const breakdown: { label: string; points: number; max: number }[] = []
  breakdown.push({ label: '交易前有计划', points: plan ? 25 : 0, max: 25 })
  let sizeOk = 0
  if (plan) {
    const actualPct = (r.qty * r.avgPrice) / Math.max(1, r.snapshot.equity)
    sizeOk = r.side === 'sell' || r.side === 'cover' || actualPct <= plan.targetPct * 1.2 + 0.01 ? 15 : 0
  }
  breakdown.push({ label: '仓位符合计划', points: sizeOk, max: 15 })
  breakdown.push({ label: '定义了退出/证伪条件', points: plan && (plan.invalidation.trim() || plan.stopPrice) ? 15 : 0, max: 15 })
  breakdown.push({ label: '按计划执行', points: input.followedPlan === 'yes' ? 20 : input.followedPlan === 'partial' ? 10 : 0, max: 20 })
  const n = input.note.trim().length
  breakdown.push({ label: '记录了复盘思考', points: n >= 10 ? 15 : n > 0 ? 8 : 0, max: 15 })
  const risky = r.biasHints.some((h) => h.includes('集中度') || h.includes('报复性') || h.includes('过度交易'))
  breakdown.push({ label: '风险控制（无高风险行为提示）', points: risky ? 0 : 10, max: 10 })
  r.scoreBreakdown = breakdown
  r.processScore = breakdown.reduce((a, b) => a + b.points, 0)
  const s = e.w.stats
  s.reviewsCompleted++
  if (n >= 5 || input.selfBiasTags.length) {
    s.reviewStreak++
    s.bestReviewStreak = Math.max(s.bestReviewStreak, s.reviewStreak)
  } else s.reviewStreak = 0
  if (n) s.notesWritten++
  if (input.selfBiasTags.length) s.biasTags++
  e.logCommand('completeReview', { id, ...input })
  e.markDirty(true)
  return r
}

export function dismissReview(e: Engine, id: string) {
  const r = e.w.reviews.find((x) => x.id === id)
  if (!r || r.completed) return
  r.completed = true
  r.followedPlan = r.planId ? undefined : 'noplan'
  r.processScore = undefined
  r.note = '（已跳过复盘）'
  e.w.stats.reviewStreak = 0
  e.markDirty()
}

export function riskSnapshot(e: Engine) {
  const eq = equity(e)
  const a = e.w.account
  let maxW = 0
  for (const p of Object.values(a.positions)) if (p.qty !== 0) maxW = Math.max(maxW, Math.abs(p.qty * e.w.stocks[p.symbol].last) / Math.max(1, eq))
  const n = eq / Math.max(1e-9, a.navUnits)
  const dd = a.peakNav > 0 ? Math.max(0, 1 - n / a.peakNav) : 0
  return { maxWeight: maxW, drawdown: dd, leverage: grossExposure(e) / Math.max(1, eq) }
}

export function sectorWeights(e: Engine): { sector: string; weight: number; value: number }[] {
  const eq = Math.max(1, equity(e))
  const m: Record<string, number> = {}
  for (const p of Object.values(e.w.account.positions)) {
    if (!p.qty) continue
    const sec = e.tmpl[p.symbol].sector
    m[sec] = (m[sec] ?? 0) + p.qty * e.w.stocks[p.symbol].last
  }
  return Object.entries(m).map(([sector, value]) => ({ sector, value, weight: value / eq })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
}

export function buildDailySummary(e: Engine): DailySummary {
  const w = e.w
  const td = w.clock.tradingDay
  const a = w.account
  const eq = equity(e)
  const idxIds = ['PXC', 'PX30']
  const indexChanges = idxIds.map((id) => {
    const i = w.indices[id]
    return { id, name: i.name, close: i.value, changePct: i.value / i.prevClose - 1 }
  })
  const sectorRanks = SECTORS.map((s) => {
    const i = w.indices['SEC_' + s.id]
    return { sector: s.id, changePct: i.value / i.prevClose - 1 }
  }).sort((x, y) => y.changePct - x.changePct)
  const topNews = w.news.filter((n) => n.tradingDay === td && n.importance >= 2).slice(-5).map((n) => n.title)
  const syms = new Set([...Object.keys(a.dayStartPositions), ...Object.keys(a.positions)])
  const positionChanges = [...syms]
    .map((s) => ({ symbol: s, before: a.dayStartPositions[s] ?? 0, after: a.positions[s]?.qty ?? 0 }))
    .filter((x) => x.before !== x.after)
  const upcoming: string[] = []
  for (const r of w.releases) if (!r.released && r.day > td && r.day <= td + 3) upcoming.push(`${e.cal.short(r.day)} ${r.name}（预期 ${r.expected}${r.unit}）`)
  for (const sym of Object.keys(a.positions)) {
    const st = w.stocks[sym]
    if (st.nextEarningsDay > td && st.nextEarningsDay <= td + 5) upcoming.push(`${e.cal.short(st.nextEarningsDay)} ${e.tmpl[sym].name} 发布财报（持仓）`)
  }
  for (const ac of w.actions) {
    if (ac.status === 'completed') continue
    const d = ac.exDay ?? ac.effectiveDay ?? ac.endDay
    if (d && d > td && d <= td + 5 && (a.positions[ac.symbol] || w.watchlist.includes(ac.symbol))) upcoming.push(`${e.cal.short(d)} ${ac.title}`)
  }
  let up = 0, down = 0, flat = 0
  for (const st of Object.values(w.stocks)) {
    if (st.status === 'delisted') continue
    if (st.last > st.prevClose) up++
    else if (st.last < st.prevClose) down++
    else flat++
  }
  return {
    tradingDay: td,
    date: e.cal.label(td, true),
    indexChanges,
    sectorRanks,
    topNews,
    positionChanges,
    fees: a.dayFees,
    dayPnl: eq - a.dayStartEquity,
    equity: eq,
    equityChangePct: a.dayStartEquity ? eq / a.dayStartEquity - 1 : 0,
    riskBefore: a.dayStartRisk ?? { maxWeight: 0, drawdown: 0, leverage: 0 },
    riskAfter: riskSnapshot(e),
    upcoming,
    note: '',
    breadth: { up, down, flat },
  }
}

export function saveSummaryNote(e: Engine, day: number, note: string, biasTag?: string) {
  const s = e.w.summaries.find((x) => x.tradingDay === day)
  if (!s) return
  const first = !s.note && !s.biasTag
  s.note = note
  s.biasTag = biasTag
  if (first && (note.trim() || biasTag)) {
    e.w.stats.dailySummaries++
    if (biasTag) e.w.stats.biasTags++
    if (note.trim()) e.w.stats.notesWritten++
  }
  e.markDirty(true)
}

/** 交易纪律分：由可验证的过程指标构成，不含收益 */
export function disciplineScore(e: Engine): { score: number; parts: { label: string; value: number; weight: number }[] } {
  const w = e.w
  const done = w.reviews.filter((r) => r.processScore !== undefined).slice(-20)
  const reviewAvg = done.length ? done.reduce((a, r) => a + (r.processScore ?? 0), 0) / done.length : 0
  const playerOrders = w.orders.filter((o) => o.source === 'player' && o.filledQty > 0 && (o.side === 'buy' || o.side === 'short'))
  const planRatio = playerOrders.length ? playerOrders.filter((o) => o.planId).length / playerOrders.length : 0
  const sumRatio = w.summaries.length ? w.summaries.filter((s) => s.note || s.biasTag).length / w.summaries.length : 0
  const riskDays = w.summaries.length ? w.summaries.filter((s) => s.riskAfter.maxWeight <= 0.4 && s.riskAfter.leverage <= 1.5).length / w.summaries.length : 1
  const reviewRatio = w.reviews.length ? w.reviews.filter((r) => r.processScore !== undefined).length / w.reviews.length : 0
  const parts = [
    { label: '复盘过程分（近 20 次均值）', value: reviewAvg / 100, weight: 0.45 },
    { label: '开仓关联交易计划比例', value: planRatio, weight: 0.2 },
    { label: '复盘完成率', value: reviewRatio, weight: 0.1 },
    { label: '收盘总结记录率', value: sumRatio, weight: 0.1 },
    { label: '仓位与杠杆在限度内的交易日比例', value: riskDays, weight: 0.15 },
  ]
  const score = Math.round(parts.reduce((a, p) => a + p.value * p.weight, 0) * 100)
  return { score, parts }
}

export function accountSnapshotForCheck(e: Engine) {
  const w = e.w
  const eq = equity(e)
  const r = riskSnapshot(e)
  const secs = new Set(Object.values(w.account.positions).filter((p) => p.qty !== 0).map((p) => e.tmpl[p.symbol].sector))
  return {
    equity: eq / 100,
    cash: w.account.cash / 100,
    available: Math.max(0, w.account.cash - w.account.frozen) / 100,
    frozen: w.account.frozen / 100,
    positions: Object.values(w.account.positions).filter((p) => p.qty !== 0).length,
    sectorsHeld: secs.size,
    maxWeight: r.maxWeight,
    cashRatio: eq > 0 ? Math.max(0, w.account.cash) / eq : 0,
    drawdown: r.drawdown,
    maxDrawdown: w.account.maxDrawdown,
    returnPct: eq / Math.max(1e-9, w.account.navUnits) / 100 - 1,
    realizedPnl: w.account.realizedTotal / 100,
    feesTotal: w.account.feesTotal / 100,
  }
}

export function sideText(o: { side: string }) {
  return SIDE_LABEL[o.side]
}

export { fmtMoney, longValue }
