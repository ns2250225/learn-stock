import type { Engine } from './engine'
import type { ChallengeDef, ChallengeGoal, SectorId } from './types'
import type { PendingEvent } from './state'
import { CHALLENGES } from './content/challenges'
import { COMPANIES } from './content/companies'
import { fireTemplate, processEarnings, publishNews, TEMPLATE_MAP } from './news'
import { equity, ledger, nav } from './trading'
import { riskSnapshot } from './review'
import { fmtMoney, fmtPct, roundTick } from './util'

export const CHALLENGE_MAP: Record<string, ChallengeDef> = Object.fromEntries(CHALLENGES.map((c) => [c.id, c]))

/** 连续交易第 n 分钟 → 时钟分钟 */
function continuousMinute(e: Engine, n: number): number {
  let left = n
  for (const [a, b] of e.rules.sessions.continuous) {
    if (left < b - a) return a + left
    left -= b - a
  }
  return e.rules.sessions.closing[0] - 1
}

export function setupChallenge(e: Engine, def: ChallengeDef) {
  const w = e.w
  const startDay = 1
  w.challenge = {
    id: def.id,
    startDay,
    endDay: startDay + def.days - 1,
    startEquity: w.account.cash,
    startBench: w.indices.PXC.value,
    minCashRatio: 1,
    finished: false,
  }
  if (def.allowMargin) w.flags.challenge_allow_margin = true
  // 初始持仓
  const r = e.rng.corp
  const lot = e.rules.lotSize
  for (const h of def.startHoldings ?? []) {
    let cands = COMPANIES.filter((c) => (!h.sector || c.sector === h.sector) && (!h.style || c.styles.includes(h.style)))
    if (!cands.length) cands = COMPANIES
    const picks = r.sample(cands, h.count)
    const budgetEach = (w.account.cash * h.weight) / Math.max(1, picks.length)
    for (const c of picks) {
      const st = w.stocks[c.symbol]
      const qty = Math.floor(budgetEach / st.last / lot) * lot
      if (qty <= 0) continue
      const cost = qty * st.last
      const p = e.ensurePosition(c.symbol)
      p.qty += qty
      p.costBasis += cost
      p.lots.push({ qty, sellableDay: 0 })
      p.openedDay = 0
      ledger(e, 'adjustment', -cost, `挑战初始持仓：${c.symbol} ${qty} 股 @ ${(st.last / 100).toFixed(2)}（按开局价计入成本，不计费用）`, { symbol: c.symbol })
    }
  }
  w.challenge.startEquity = equity(e)
  // 剧本事件
  for (const s of def.scripted) {
    const p: PendingEvent = {
      id: e.nextId('PE'),
      templateId: s.templateId,
      day: startDay + s.day - 1,
      minute: s.minute !== undefined ? continuousMinute(e, s.minute) : undefined,
      target: s.target,
      forced: true,
    }
    w.pending.push(p)
  }
}

export class ScriptedEngine {
  constructor(private e: Engine) {}

  private resolveTarget(target?: string): { symbol?: string; sector?: SectorId } {
    const w = this.e.w
    const r = this.e.rng.events
    if (!target || target === 'any') return {}
    if (target === 'holding') {
      const held = Object.values(w.account.positions).filter((p) => p.qty > 0 && w.stocks[p.symbol].status === 'normal')
      if (held.length) {
        held.sort((a, b) => b.qty * w.stocks[b.symbol].last - a.qty * w.stocks[a.symbol].last)
        return { symbol: held[0].symbol }
      }
      const any = Object.values(w.stocks).filter((s) => s.status === 'normal')
      return { symbol: r.pick(any).symbol }
    }
    if (target.startsWith('sector:')) return { sector: target.slice(7) as SectorId }
    if (target.startsWith('symbol:')) return { symbol: target.slice(7) }
    if (w.stocks[target]) return { symbol: target }
    return { sector: target as SectorId }
  }

  private pickSymbol(t: { symbol?: string; sector?: SectorId }): string {
    const w = this.e.w
    if (t.symbol) return t.symbol
    const cands = Object.values(w.stocks).filter((s) => s.status === 'normal' && (!t.sector || this.e.tmpl[s.symbol].sector === t.sector))
    return this.e.rng.events.pick(cands).symbol
  }

  /** 处理保留剧本 ID；返回 true 表示已处理 */
  handle(p: PendingEvent): boolean {
    const e = this.e
    const w = e.w
    const t = this.resolveTarget(p.target)
    switch (p.templateId) {
      case 'EARNINGS_SEASON': {
        const td = w.clock.tradingDay
        for (const st of Object.values(w.stocks)) if (st.status !== 'delisted') st.nextEarningsDay = td + e.rng.earnings.int(0, 4)
        publishNews(e, {
          category: 'calendar', sourceType: 'official', sourceName: '交易所', title: '财报季开启：未来 5 个交易日所有上市公司集中披露季报',
          summary: '财报日历已更新，可在事件日历中查看各公司披露日期。', detail: '集中披露期内个股波动与成交量通常放大。财报前的「一致预期」是判断结果好坏的基准。',
          analysis: ['可以考虑在财报前记录对每家持仓公司的预期，并在发布后对比。'], symbols: [], sectors: [], credibility: 1, knownBefore: true, metrics: ['EPS', '营收'], tags: ['earnings_surprise', 'consensus'], importance: 2,
        })
        return true
      }
      case 'EARNINGS_BEAT':
      case 'EARNINGS_MISS':
      case 'EARNINGS_MIXED': {
        const sym = this.pickSymbol(t)
        const o = p.templateId === 'EARNINGS_BEAT' ? 'beat' : p.templateId === 'EARNINGS_MISS' ? 'miss' : 'mixed'
        processEarnings(e, o, sym)
        return true
      }
      case 'GAP_DOWN': {
        const sym = this.pickSymbol(t)
        const st = w.stocks[sym]
        const c = e.tmpl[sym]
        const shock = -e.rng.events.range(0.09, 0.16)
        const id = e.nextId('EV')
        st.dev += shock
        st.attrToday.events[id] = (st.attrToday.events[id] ?? 0) + shock
        w.events.push({
          id, templateId: 'GAP_DOWN', category: 'company', title: `${c.name}盘前披露重大产品召回`, summary: '公司盘前公告召回主力产品，预计影响全年利润。',
          detail: '', analysis: [], sourceType: 'announcement', publishAt: w.clock.time, affectedSymbols: [sym], affectedSectors: [c.sector], marketWide: false,
          credibility: 1, surprise: -3, immediateImpact: shock, fundamentalImpact: -0.04, durationSteps: 240, followUpEventIds: [], educationalTags: ['gap', 'stop_loss_gap'],
          affectsMetrics: ['营收', '利润'], highImpact: true, priceAtPublish: { [sym]: st.last }, indexAtPublish: w.indices.PXC.value, tradingDay: w.clock.tradingDay,
        })
        st.f.earningsPower -= 0.04
        publishNews(e, {
          category: 'company', sourceType: 'announcement', sourceName: `${c.name} 公告`, title: `${c.name}盘前公告：召回主力产品，预计显著影响全年利润`,
          summary: '公告发布于开盘前，开盘价可能大幅低于昨日收盘价。',
          detail: `${c.name}在开盘前披露，因质量问题召回主力产品${c.products[0] ? `「${c.products[0]}」` : ''}，预计减少全年利润。由于信息在休市期间发布，市场无法在昨日收盘与今日开盘之间连续交易，价格将在开盘集合竞价中一次性反映，形成跳空。`,
          analysis: ['跳空开盘时，触发价高于开盘价的止损（市价）单会以接近开盘价的价格成交，而非触发价。', '止损限价单若限价高于开盘价，可能完全无法成交。'],
          symbols: [sym], sectors: [c.sector], credibility: 1, knownBefore: false, metrics: ['营收', '利润'], tags: ['gap', 'stop_loss_gap', 'stop_order'], importance: 3,
        })
        return true
      }
      case 'DIVIDEND': {
        const sym = this.pickSymbol(t)
        const st = w.stocks[sym]
        e.corp.announceDividend(sym, Math.max(1, roundTick(st.last * 0.03, 1)), 2, 4)
        return true
      }
      case 'SPLIT':
        e.corp.announceSplit(this.pickSymbol(t), 2)
        return true
      case 'RIGHTS':
        e.corp.announceRights(this.pickSymbol(t), 0.3, 0.8)
        return true
      case 'SUSPEND':
        e.corp.suspend(this.pickSymbol(t), 2, '筹划重大事项')
        return true
    }
    if (p.forced && TEMPLATE_MAP[p.templateId]) {
      const tm = TEMPLATE_MAP[p.templateId]
      fireTemplate(e, tm, t.symbol ?? t.sector, p.parentEventId)
      return true
    }
    return false
  }
}

export function goalLabelDetail(e: Engine, g: ChallengeGoal, quizAnswers?: number[]): { pass: boolean; detail: string; pending?: boolean } {
  const w = e.w
  const run = w.challenge!
  const eq = equity(e)
  const ret = eq / Math.max(1, run.startEquity) - 1
  const bench = w.indices.PXC.value / run.startBench - 1
  const risk = riskSnapshot(e)
  const secs = new Set(Object.values(w.account.positions).filter((p) => p.qty !== 0).map((p) => e.tmpl[p.symbol].sector)).size
  const cashRatio = eq > 0 ? Math.max(0, w.account.cash) / eq : 0
  const trades = w.orders.filter((o) => o.source === 'player' && o.filledQty > 0).length
  switch (g.type) {
    case 'returnAtLeast':
      return { pass: ret >= g.value, detail: `收益率 ${fmtPct(ret)}（目标 ≥ ${fmtPct(g.value, 1, false)}）` }
    case 'maxDrawdownBelow':
      return { pass: w.account.maxDrawdown < g.value, detail: `期间最大回撤 ${fmtPct(w.account.maxDrawdown, 1, false)}（目标 < ${fmtPct(g.value, 0, false)}）` }
    case 'minSectorsHeld':
      return { pass: secs >= g.value, detail: `持有 ${secs} 个行业（目标 ≥ ${g.value}）` }
    case 'maxSingleWeightBelow':
      return { pass: risk.maxWeight < g.value, detail: `最大单股占比 ${fmtPct(risk.maxWeight, 1, false)}（目标 < ${fmtPct(g.value, 0, false)}）` }
    case 'feesBelow':
      return { pass: w.account.feesTotal / 100 < g.value, detail: `累计费用 ${fmtMoney(w.account.feesTotal)}（目标 < ¥${g.value}）` }
    case 'cashRatioAtLeast':
      return { pass: cashRatio >= g.value, detail: `现金占比 ${fmtPct(cashRatio, 1, false)}（目标 ≥ ${fmtPct(g.value, 0, false)}）` }
    case 'minCashRatioThroughout':
      return { pass: run.minCashRatio >= g.value, detail: `期间最低收盘现金占比 ${fmtPct(run.minCashRatio, 1, false)}（目标 ≥ ${fmtPct(g.value, 0, false)}）` }
    case 'beatBenchmark':
      return { pass: ret - bench >= g.value, detail: `超额收益 ${fmtPct(ret - bench)}（组合 ${fmtPct(ret)} vs 综指 ${fmtPct(bench)}）` }
    case 'tradesAtMost':
      return { pass: trades <= g.value, detail: `成交订单 ${trades} 笔（目标 ≤ ${g.value}）` }
    case 'tradesAtLeast':
      return { pass: trades >= g.value, detail: `成交订单 ${trades} 笔（目标 ≥ ${g.value}）` }
    case 'reviewsAtLeast':
      return { pass: w.stats.reviewsCompleted >= g.value, detail: `完成复盘 ${w.stats.reviewsCompleted} 次（目标 ≥ ${g.value}）` }
    case 'plansAtLeast':
      return { pass: w.stats.plansCreated >= g.value, detail: `创建交易计划 ${w.stats.plansCreated} 份（目标 ≥ ${g.value}）` }
    case 'holdDaysAtLeast':
      return { pass: w.stats.daysHeldMax >= g.value, detail: `最长连续持有 ${w.stats.daysHeldMax} 个交易日（目标 ≥ ${g.value}）` }
    case 'quiz': {
      if (!quizAnswers) return { pass: false, detail: '待作答', pending: true }
      const ok = g.questions.every((q, i) => quizAnswers[i] === q.answer)
      return { pass: ok, detail: ok ? '全部答对' : '有题目答错，可在错题本查看解析' }
    }
  }
}

export function challengeMetrics(e: Engine): { label: string; value: string }[] {
  const w = e.w
  const run = w.challenge!
  const eq = equity(e)
  const ret = eq / Math.max(1, run.startEquity) - 1
  const bench = w.indices.PXC.value / run.startBench - 1
  const daily = w.account.equityDaily.filter((d) => d.day >= run.startDay)
  const rets = daily.slice(1).map((d, i) => d.nav / daily[i].nav - 1)
  const vol = rets.length > 1 ? Math.sqrt(rets.reduce((a, r) => a + r * r, 0) / rets.length) * Math.sqrt(252) : 0
  const trades = w.orders.filter((o) => o.source === 'player' && o.filledQty > 0).length
  return [
    { label: '收益率', value: fmtPct(ret) },
    { label: '基准（综指）', value: fmtPct(bench) },
    { label: '超额收益', value: fmtPct(ret - bench) },
    { label: '最大回撤', value: fmtPct(w.account.maxDrawdown, 1, false) },
    { label: '年化波动率', value: fmtPct(vol, 1, false) },
    { label: '成交订单数', value: String(trades) },
    { label: '累计费用', value: fmtMoney(w.account.feesTotal) },
    { label: '复盘完成', value: String(w.stats.reviewsCompleted) },
    { label: '单位净值', value: (nav(e) / 100).toFixed(4) },
  ]
}

export function finishChallenge(e: Engine, quizAnswers?: number[]) {
  const w = e.w
  const run = w.challenge
  if (!run) return null
  const def = CHALLENGE_MAP[run.id]
  if (!def) return null
  const results = def.goals.map((g) => {
    const r = goalLabelDetail(e, g.goal, g.goal.type === 'quiz' ? quizAnswers : undefined)
    return { label: g.label, pass: r.pass, required: g.required, detail: r.detail }
  })
  run.results = results
  run.quizAnswers = quizAnswers
  run.won = results.filter((r) => r.required).every((r) => r.pass)
  run.finished = true
  e.markDirty(true)
  return run
}

export { CHALLENGES }
