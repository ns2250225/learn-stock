import type { Engine } from './engine'
import type { EventTemplate, MarketEvent, SectorId, SourceType } from './types'
import type { MacroRelease, NewsArticle, StockState } from './state'
import { EVENT_TEMPLATES } from './content/events'
import { SECTORS, SECTOR_MAP } from './content/sectors'
import { COMPANIES } from './content/companies'
import { REGIME_PARAMS } from './params'
import { quarterLabel } from './clock'
import { clamp, fillTemplate, fmtPct } from './util'
import { macroLstar } from './world'

export const TEMPLATE_MAP: Record<string, EventTemplate> = Object.fromEntries(EVENT_TEMPLATES.map((t) => [t.id, t]))

const MEDIA = ['像素财经', '方块日报', '8-bit 商业周刊', '像素城晚报']
const RUMOR = ['咖啡馆传闻', '社交平台热帖', '匿名论坛']
const OPINION = ['像素财经评论', '分析师专栏', '像素城投资圈']

export function sourceName(e: Engine, st: SourceType, company?: string): string {
  const r = e.rng.opinion
  switch (st) {
    case 'official':
      return '像素城统计局 / 监管机构'
    case 'announcement':
      return company ? `${company} 公告` : '交易所公告'
    case 'media':
      return r.pick(MEDIA)
    case 'rumor':
      return r.pick(RUMOR)
    default:
      return r.pick(OPINION)
  }
}

export function publishNews(e: Engine, n: Omit<NewsArticle, 'id' | 'ts' | 'tradingDay' | 'priceAtPublish' | 'indexAtPublish'>): NewsArticle {
  const art: NewsArticle = {
    ...n,
    id: e.nextId('N'),
    ts: e.w.clock.time,
    tradingDay: e.w.clock.tradingDay,
    priceAtPublish: Object.fromEntries(n.symbols.map((s) => [s, e.w.stocks[s]?.last ?? 0])),
    indexAtPublish: e.w.indices.PXC.value,
  }
  e.w.news.push(art)
  if (e.w.news.length > 900) e.w.news.splice(0, e.w.news.length - 900)
  e.emit({ type: 'news', news: art })
  return art
}

function pricedIn(st: StockState, days = 5): number {
  const d = st.daily
  if (d.length < days + 1) return 0
  return Math.log(st.last / d[d.length - days - 1].c)
}

/**
 * 给个股加入冲击。若处于非连续交易时段，直接计入潜在价格（开盘时体现为跳空）；
 * 否则分步释放，模拟信息逐步被市场消化。
 */
export function addImpact(e: Engine, st: StockState, logRet: number, eventId: string, label: string) {
  if (!isFinite(logRet) || Math.abs(logRet) < 1e-6) return
  const ph = e.phase
  if (ph !== 'continuous' && ph !== 'closing') {
    st.dev += logRet
    st.attrToday.events[eventId] = (st.attrToday.events[eventId] ?? 0) + logRet
    return
  }
  const fast = Math.abs(logRet) > 0.04 ? 0.25 : 0.12
  st.impacts.push({ eventId, remaining: logRet, rate: fast, label })
}

function addModifier(e: Engine, st: StockState, eventId: string, t: { vol?: number; volume?: number; spread?: number }, steps: number) {
  st.modifiers.push({ eventId, vol: t.vol ?? 1, volume: t.volume ?? 1, spread: t.spread ?? 1, untilStep: e.tmp.globalStep + steps })
}

function eligible(e: Engine, t: EventTemplate, sym: string): boolean {
  const c = e.tmpl[sym]
  const st = e.w.stocks[sym]
  if (st.status === 'delisted' || st.status === 'suspended') return false
  if (t.sectors?.length && !t.sectors.includes(c.sector)) return false
  const f = t.filter
  if (f) {
    if (f.styles && !f.styles.some((s) => c.styles.includes(s))) return false
    if (f.minDebtRatio !== undefined && st.f.debtRatio < f.minDebtRatio) return false
    if (f.maxDebtRatio !== undefined && st.f.debtRatio > f.maxDebtRatio) return false
    if (f.minVolatility !== undefined && c.volatility < f.minVolatility) return false
    if (f.minLiquidityTier !== undefined && c.liquidityTier < f.minLiquidityTier) return false
    if (f.maxLiquidityTier !== undefined && c.liquidityTier > f.maxLiquidityTier) return false
    if (f.minCustomerConcentration !== undefined && c.customerConcentration < f.minCustomerConcentration) return false
    if (f.maxReportReliability !== undefined && c.reportReliability > f.maxReportReliability) return false
    if (f.maxMgmtCredibility !== undefined && c.mgmtCredibility > f.maxMgmtCredibility) return false
    if (f.minPayoutRatio !== undefined && c.payoutRatio < f.minPayoutRatio) return false
    if (f.negativeMarginOnly && st.f.netMargin >= 0) return false
  }
  const cd = e.w.cooldowns[`${t.id}:${sym}`]
  if (cd !== undefined && cd > e.w.clock.tradingDay) return false
  return true
}

/** 每个连续交易分钟（及夜间批量）按概率抽取随机事件 */
export function maybeRandomEvent(e: Engine, stepsInBatch = 1) {
  const w = e.w
  const rp = REGIME_PARAMS[w.regime.current]
  const p = (w.eventFrequency * rp.events * stepsInBatch) / e.T
  if (!e.rng.events.chance(Math.min(0.9, p))) return
  const pool = EVENT_TEMPLATES.filter((t) => !t.scriptOnly)
  const t = e.rng.events.weighted(pool, (t) => {
    let wgt = t.weight * (t.regimeBias?.[w.regime.current] ?? 1)
    if (t.highImpact && w.highImpactBudget < 1) wgt = 0
    if (t.scope === 'market' && (w.cooldowns[t.id] ?? -1) > w.clock.tradingDay) wgt = 0
    return wgt
  })
  if (!t) return
  fireTemplate(e, t)
}

export function fireTemplate(e: Engine, t: EventTemplate, target?: string, parentId?: string): MarketEvent | null {
  const w = e.w
  const re = e.rng.events
  let symbol: string | undefined
  let sector: SectorId | undefined
  if (t.scope === 'company') {
    if (target && w.stocks[target]) symbol = target
    else {
      const cands = Object.keys(w.stocks).filter((s) => eligible(e, t, s))
      symbol = re.weighted(cands, (s) => e.tmpl[s].eventSensitivity)
    }
    if (!symbol) return null
    sector = e.tmpl[symbol].sector
  } else if (t.scope === 'sector') {
    if (target && SECTOR_MAP[target as SectorId]) sector = target as SectorId
    else {
      const cands = (t.sectors?.length ? t.sectors : SECTORS.map((s) => s.id)).filter((s) => (w.cooldowns[`${t.id}:${s}`] ?? -1) <= w.clock.tradingDay)
      sector = cands.length ? re.pick(cands) : undefined
    }
    if (!sector) return null
  }
  const c = symbol ? e.tmpl[symbol] : undefined
  const peers = sector ? COMPANIES.filter((x) => x.sector === sector && x.symbol !== symbol) : []
  const nums = (t.nums ?? []).map(([a, b]) => re.range(a, b).toFixed(1))
  const vars: Record<string, string> = {
    company: c?.name ?? '',
    symbol: symbol ?? '',
    sector: sector ? SECTOR_MAP[sector].name : '',
    peer: peers.length ? re.pick(peers).name : '同业公司',
    product: c?.products.length ? re.pick(c.products) : '核心产品',
  }
  nums.forEach((n, i) => (vars[`n${i + 1}`] = n))
  const cred = re.range(t.credibility[0], t.credibility[1])
  const surprise = re.range(t.surprise[0], t.surprise[1])
  const imm = re.range(t.immediateImpact[0], t.immediateImpact[1])
  const fund = re.range(t.fundamentalImpact[0], t.fundamentalImpact[1])
  const duration = Math.round(re.range(t.durationSteps[0], t.durationSteps[1]))
  const affected: string[] = []
  const ev: MarketEvent = {
    id: e.nextId('EV'),
    templateId: t.id,
    category: t.category,
    title: fillTemplate(t.title, vars),
    summary: fillTemplate(t.summary, vars),
    detail: fillTemplate(t.detail, vars),
    analysis: t.analysis.map((a) => fillTemplate(a, vars)),
    sourceType: t.sourceType,
    publishAt: w.clock.time,
    affectedSymbols: affected,
    affectedSectors: sector ? [sector] : [],
    marketWide: t.scope === 'market',
    credibility: cred,
    surprise,
    immediateImpact: imm,
    fundamentalImpact: fund,
    durationSteps: duration,
    volatilityMultiplier: t.volatilityMultiplier,
    volumeMultiplier: t.volumeMultiplier,
    followUpEventIds: [],
    parentEventId: parentId,
    educationalTags: t.educationalTags,
    affectsMetrics: t.affectsMetrics,
    highImpact: !!t.highImpact,
    priceAtPublish: {},
    indexAtPublish: w.indices.PXC.value,
    tradingDay: w.clock.tradingDay,
  }
  const credFactor = 0.45 + 0.55 * cred
  const mods = { vol: t.volatilityMultiplier, volume: t.volumeMultiplier, spread: t.spreadMultiplier }
  const label = ev.title
  const hit = (sym: string, ret: number) => {
    const st = w.stocks[sym]
    if (!st || st.status === 'delisted') return
    addImpact(e, st, ret, ev.id, label)
    if (mods.vol || mods.volume || mods.spread) addModifier(e, st, ev.id, mods, duration)
    if (!affected.includes(sym)) affected.push(sym)
  }
  if (t.scope === 'company' && symbol && c) {
    const st = w.stocks[symbol]
    const pre = pricedIn(st)
    let base = imm * c.eventSensitivity * re.range(0.6, 1.4) * credFactor
    if (Math.sign(base) === Math.sign(pre)) base -= 0.3 * pre // 预期已被部分定价
    base += re.normal() * Math.abs(imm) * 0.3 // 市场解读分歧
    hit(symbol, clamp(base, -0.35, 0.35))
    if (cred >= 0.55) st.f.earningsPower += fund * (0.5 + 0.5 * c.reportReliability)
    st.sentiment = clamp(st.sentiment + (t.sentimentShock ?? Math.sign(imm) * 0.2), -1, 1)
    if (t.sectorSpill) for (const p of peers) hit(p.symbol, imm * t.sectorSpill * p.sectorSensitivity * re.range(0.4, 1.4) * credFactor)
    w.cooldowns[`${t.id}:${symbol}`] = w.clock.tradingDay + t.cooldownDays
  } else if (t.scope === 'sector' && sector) {
    for (const p of COMPANIES.filter((x) => x.sector === sector)) {
      const ret = imm * p.sectorSensitivity * re.range(0.5, 1.5) * credFactor + re.normal() * Math.abs(imm) * 0.25
      hit(p.symbol, ret)
      if (cred >= 0.55) w.stocks[p.symbol].f.earningsPower += fund * re.range(0.5, 1.5)
    }
    w.sectorFactors[sector].sentiment = clamp(w.sectorFactors[sector].sentiment + (t.sentimentShock ?? Math.sign(imm) * 0.25), -1, 1)
    w.cooldowns[`${t.id}:${sector}`] = w.clock.tradingDay + t.cooldownDays
  }
  if (t.scope === 'market' || t.sectorEffects) {
    for (const p of COMPANIES) {
      if (t.scope !== 'market' && p.sector === sector) continue
      const se = t.sectorEffects?.[p.sector]
      if (t.scope !== 'market' && se === undefined) continue
      const coef = se ?? 1
      const ret = imm * coef * (0.6 + 0.4 * p.beta) * re.range(0.6, 1.4) * credFactor + re.normal() * Math.abs(imm) * 0.2
      hit(p.symbol, ret)
      if (cred >= 0.55 && fund) w.stocks[p.symbol].f.earningsPower += fund * coef * 0.5
    }
    if (t.scope === 'market') {
      w.marketSentiment = clamp(w.marketSentiment + (t.sentimentShock ?? Math.sign(imm) * Math.min(0.5, Math.abs(imm) * 15)), -1, 1)
      w.cooldowns[t.id] = w.clock.tradingDay + t.cooldownDays
      ev.affectedSectors = SECTORS.map((s) => s.id)
    }
  }
  if (t.marketSpill && t.scope !== 'market') {
    for (const p of COMPANIES) if (!affected.includes(p.symbol)) hit(p.symbol, imm * t.marketSpill * p.beta * re.range(0.5, 1.5))
  }
  if (t.macroEffects) {
    for (const [k, v] of Object.entries(t.macroEffects)) {
      const key = k as keyof typeof w.macro
      w.macro[key] = (w.macro[key] as number) + (v as number) * credFactor
    }
    w.macro.riskAppetite = clamp(w.macro.riskAppetite, -1, 1)
    w.regime.Lstar = macroLstar(w.macro)
  }
  if (t.highImpact) w.highImpactBudget = Math.max(0, w.highImpactBudget - 1)
  ev.priceAtPublish = Object.fromEntries(affected.map((s) => [s, w.stocks[s].last]))
  // 公司行动 / 状态联动
  if (symbol) {
    const st = w.stocks[symbol]
    if (t.suspendDays) e.corp.suspend(symbol, Math.round(re.range(t.suspendDays[0], t.suspendDays[1])), ev.title)
    if (t.riskWarning) e.corp.setRiskWarning(symbol, ev.title)
    if (t.delistChain) e.corp.delistPressure(symbol, ev.title)
    if (t.id === 'buyback_announce') e.corp.announceBuyback(symbol)
    if (t.id === 'secondary_offering_plan') e.corp.announceOffering(symbol)
    if (t.id === 'dividend_hike') st.f.dpsTTM *= 1.2
    if (t.id === 'dividend_cut') st.f.dpsTTM *= 0.5
  }
  // 连锁事件
  for (const fu of t.followUps ?? []) {
    if (!re.chance(fu.probability)) continue
    const pid = e.nextId('PE')
    w.pending.push({
      id: pid,
      templateId: fu.templateId,
      day: w.clock.tradingDay + Math.round(re.range(fu.delayDays[0], fu.delayDays[1])),
      minute: undefined,
      target: fu.sameTarget ? symbol ?? (sector ? sector : undefined) : undefined,
      parentEventId: ev.id,
    })
    ev.followUpEventIds.push(pid)
  }
  w.events.push(ev)
  if (w.events.length > 700) w.events.splice(0, w.events.length - 700)
  const importance = t.highImpact ? 3 : t.scope === 'market' || cred > 0.8 ? 2 : 1
  publishNews(e, {
    category: t.category,
    sourceType: t.sourceType,
    sourceName: sourceName(e, t.sourceType, c?.name),
    title: ev.title,
    summary: ev.summary,
    detail: ev.detail,
    analysis: ev.analysis,
    symbols: symbol ? [symbol] : t.scope === 'sector' ? COMPANIES.filter((x) => x.sector === sector).map((x) => x.symbol) : [],
    sectors: ev.affectedSectors,
    credibility: cred,
    knownBefore: false,
    metrics: t.affectsMetrics,
    tags: t.educationalTags,
    eventId: ev.id,
    followUpOf: parentId,
    importance: importance as 1 | 2 | 3,
  })
  e.debug('event', `${ev.id} ${t.id} ${symbol ?? sector ?? '全市场'} 即时 ${fmtPct(imm)} 基本面 ${fmtPct(fund)} 可信度 ${cred.toFixed(2)}`)
  e.onKeyEvent(ev)
  return ev
}

// ---------------------------------------------------------------------------
// 连锁 / 剧本事件
// ---------------------------------------------------------------------------
export function processPending(e: Engine) {
  const w = e.w
  const td = w.clock.tradingDay
  const minute = w.clock.time % 1440
  const ph = e.phase
  const due = w.pending.filter((p) => p.day < td || (p.day === td && (p.minute === undefined ? ph === 'preopen' || ph === 'opening' || ph === 'continuous' : minute >= p.minute)))
  if (!due.length) return
  w.pending = w.pending.filter((p) => !due.includes(p))
  for (const p of due) {
    if (e.scripted.handle(p)) continue
    const t = TEMPLATE_MAP[p.templateId]
    if (!t) continue
    fireTemplate(e, t, p.target, p.parentEventId)
  }
}

// ---------------------------------------------------------------------------
// 宏观数据日历
// ---------------------------------------------------------------------------
interface MacroKindDef {
  name: string
  unit: string
  period: number
  offset: number
  minute: (e: Engine) => number
  sigma: number
}

const MACRO_KINDS: Record<MacroRelease['kind'], MacroKindDef> = {
  pmi: { name: '制造业 PMI', unit: '', period: 21, offset: 1, minute: (e) => e.rules.sessions.preopen[0] + 5, sigma: 0.6 },
  jobs: { name: '失业率', unit: '%', period: 21, offset: 4, minute: (e) => e.rules.sessions.preopen[0] + 5, sigma: 0.12 },
  cpi: { name: 'CPI 同比', unit: '%', period: 21, offset: 9, minute: (e) => e.rules.sessions.preopen[0] + 5, sigma: 0.15 },
  confidence: { name: '消费者信心指数', unit: '', period: 21, offset: 13, minute: (e) => e.rules.sessions.preopen[0] + 5, sigma: 2.5 },
  gdp: { name: 'GDP 同比', unit: '%', period: 63, offset: 22, minute: (e) => e.rules.sessions.preopen[0] + 5, sigma: 0.25 },
  cb: { name: '央行利率决议', unit: '%', period: 30, offset: 17, minute: (e) => e.rules.sessions.continuous[e.rules.sessions.continuous.length - 1][0] + 60, sigma: 0.25 },
}

function projectMacro(e: Engine, kind: MacroRelease['kind']): number {
  const m = e.w.macro
  switch (kind) {
    case 'cpi':
      return m.inflation + 0.15 * (2.2 - m.inflation) + 0.008 * (m.commodity - 100)
    case 'jobs':
      return m.unemployment + 0.1 * (5.1 - m.unemployment) - 0.05 * (m.growth - 5)
    case 'gdp':
      return m.growth + 0.2 * (5 - m.growth) + 0.3 * m.riskAppetite
    case 'pmi':
      return 50 + (m.growth - 5) * 1.5 + m.riskAppetite * 1.2
    case 'confidence':
      return m.consumerConfidence + 0.1 * (100 - m.consumerConfidence) - (m.unemployment - 5.1) * 2
    case 'cb': {
      const target = 2.5 + 1.5 * (m.inflation - 2.2) - 0.5 * (m.unemployment - 5.1) + 0.3 * (m.growth - 5)
      const gap = target - m.rate
      return m.rate + (Math.abs(gap) > 0.35 ? Math.sign(gap) * 0.25 : 0)
    }
  }
}

export function scheduleReleases(e: Engine) {
  const w = e.w
  const td = w.clock.tradingDay
  const horizon = td + 25
  const last = w.releases.reduce((a, r) => Math.max(a, r.day), td)
  for (let d = Math.max(td + 1, last + 1); d <= horizon; d++) {
    for (const [kind, def] of Object.entries(MACRO_KINDS) as [MacroRelease['kind'], MacroKindDef][]) {
      if (d % def.period !== def.offset % def.period) continue
      const proj = projectMacro(e, kind)
      const expected = kind === 'cb' ? proj : proj + e.rng.macro.normal() * def.sigma * 0.5
      w.releases.push({ id: e.nextId('MR'), kind, name: def.name, day: d, minute: def.minute(e), expected: round2(expected), unit: def.unit, released: false })
    }
  }
  w.releases = w.releases.filter((r) => !r.released || r.day >= td - 30)
}

const round2 = (x: number) => Math.round(x * 100) / 100

const MACRO_EFFECTS: Record<MacroRelease['kind'], { market: number; sectors: Partial<Record<SectorId, number>> }> = {
  // 系数含义：每 +1 个标准差「惊喜」（数值高于预期）对各行业的即时影响系数（乘以 market）
  cpi: { market: -0.005, sectors: { tech: 1.4, realestate: 1.3, utilities: 1.1, consumer: 0.9, health: 0.6, industrial: 0.7, telecom: 0.7, finance: 0.2, energy: -0.8, materials: -0.4 } },
  jobs: { market: -0.003, sectors: { consumer: 1.3, industrial: 1.2, materials: 1, finance: 0.8, tech: 0.3, utilities: -0.4, realestate: 0.4, health: 0.1, energy: 0.8, telecom: 0.2 } },
  gdp: { market: 0.005, sectors: { industrial: 1.5, materials: 1.5, energy: 1.3, finance: 1.2, consumer: 1.1, realestate: 1.1, tech: 0.9, telecom: 0.5, health: 0.3, utilities: 0.2 } },
  pmi: { market: 0.003, sectors: { industrial: 1.6, materials: 1.5, energy: 1.2, finance: 0.9, tech: 0.8, consumer: 0.7, realestate: 0.8, telecom: 0.5, health: 0.3, utilities: 0.2 } },
  confidence: { market: 0.002, sectors: { consumer: 2.2, realestate: 1.3, tech: 0.9, telecom: 0.6, finance: 0.7, industrial: 0.6, health: 0.3, utilities: 0.1, energy: 0.4, materials: 0.5 } },
  cb: { market: -0.008, sectors: { realestate: 1.6, tech: 1.4, utilities: 1.3, consumer: 1, health: 0.8, telecom: 0.9, industrial: 0.8, materials: 0.7, energy: 0.5, finance: -0.4 } },
}

export function processReleases(e: Engine) {
  const w = e.w
  const td = w.clock.tradingDay
  const minute = w.clock.time % 1440
  for (const r of w.releases) {
    if (r.released || r.day > td || (r.day === td && minute < r.minute)) continue
    r.released = true
    releaseMacro(e, r)
  }
}

export function releaseMacro(e: Engine, r: MacroRelease, forcedSurprise?: number) {
  const w = e.w
  const def = MACRO_KINDS[r.kind]
  const rm = e.rng.macro
  let actual: number
  let tone = ''
  if (r.kind === 'cb') {
    const target = projectMacro(e, 'cb')
    // 央行可能偏离市场预期
    actual = rm.chance(0.2) ? w.macro.rate + rm.pick([-0.25, 0, 0.25]) : target
    if (forcedSurprise !== undefined) actual = r.expected + Math.sign(forcedSurprise) * 0.25
    actual = Math.max(0, round2(actual))
    tone = rm.pick(['鹰派', '中性', '鸽派'])
  } else {
    actual = round2(projectMacro(e, r.kind) + rm.normal() * def.sigma)
    if (forcedSurprise !== undefined) actual = round2(r.expected + forcedSurprise * def.sigma)
  }
  r.actual = actual
  // 失业率「高于预期」为负面，统一换算为「经济/通胀强弱」方向
  let s = (actual - r.expected) / def.sigma
  if (r.kind === 'cb') s = (actual - r.expected) / 0.25 + (tone === '鹰派' ? 0.5 : tone === '鸽派' ? -0.5 : 0)
  const sDir = r.kind === 'jobs' ? -s : s
  // 更新宏观状态
  const m = w.macro
  if (r.kind === 'cpi') {
    m.inflation = actual
    m.yield10y += 0.05 * s
  }
  if (r.kind === 'jobs') m.unemployment = actual
  if (r.kind === 'gdp') m.growth = actual
  if (r.kind === 'pmi') m.growth += (actual - 50) * 0.02
  if (r.kind === 'confidence') m.consumerConfidence = actual
  if (r.kind === 'cb') {
    m.yield10y += (actual - m.rate) * 0.5 + (tone === '鹰派' ? 0.05 : tone === '鸽派' ? -0.05 : 0)
    m.rate = actual
  }
  m.riskAppetite = clamp(m.riskAppetite + (r.kind === 'gdp' || r.kind === 'pmi' || r.kind === 'confidence' ? 0.03 * sDir : -0.02 * Math.abs(s)), -1, 1)
  w.regime.Lstar = macroLstar(m)
  w.macroHistory.push({ day: w.clock.tradingDay, ...m })
  if (w.macroHistory.length > 400) w.macroHistory.shift()
  // 行情冲击：就业强劲的解读可正可负（经济向好 vs 紧缩担忧）
  const eff = MACRO_EFFECTS[r.kind]
  let mkt = eff.market * sDir
  if (r.kind === 'jobs') mkt *= rm.chance(0.5) ? 1 : -0.6
  const ev: MarketEvent = {
    id: e.nextId('EV'),
    templateId: 'macro:' + r.kind,
    category: 'macro',
    title: '',
    summary: '',
    detail: '',
    analysis: [],
    sourceType: 'official',
    publishAt: w.clock.time,
    knownAt: w.clock.time,
    affectedSymbols: [],
    affectedSectors: SECTORS.map((x) => x.id),
    marketWide: true,
    credibility: 1,
    surprise: s,
    immediateImpact: mkt,
    fundamentalImpact: 0,
    durationSteps: 240,
    followUpEventIds: [],
    educationalTags: r.kind === 'cb' ? ['central_bank', 'interest_rate'] : r.kind === 'cpi' ? ['cpi', 'inflation'] : r.kind === 'gdp' ? ['gdp', 'business_cycle'] : r.kind === 'jobs' ? ['unemployment'] : ['business_cycle'],
    affectsMetrics: ['估值', '盈利预期'],
    highImpact: Math.abs(s) > 1.5,
    priceAtPublish: {},
    indexAtPublish: w.indices.PXC.value,
    tradingDay: w.clock.tradingDay,
  }
  const text = macroText(r, actual, s, tone)
  ev.title = text.title
  ev.summary = text.summary
  ev.detail = text.detail
  ev.analysis = text.analysis
  for (const c of COMPANIES) {
    const st = w.stocks[c.symbol]
    if (st.status === 'delisted') continue
    const coef = eff.sectors[c.sector] ?? 1
    const ret = mkt * coef * (0.6 + 0.4 * c.beta) * rm.range(0.6, 1.4) + rm.normal() * Math.abs(mkt) * 0.25
    addImpact(e, st, ret, ev.id, ev.title)
    ev.affectedSymbols.push(c.symbol)
  }
  w.marketSentiment = clamp(w.marketSentiment + mkt * 20, -1, 1)
  ev.priceAtPublish = Object.fromEntries(ev.affectedSymbols.map((x) => [x, w.stocks[x].last]))
  w.events.push(ev)
  const art = publishNews(e, {
    category: 'macro',
    sourceType: 'official',
    sourceName: r.kind === 'cb' ? '像素城中央银行' : '像素城统计局',
    title: ev.title,
    summary: ev.summary,
    detail: ev.detail,
    analysis: ev.analysis,
    symbols: [],
    sectors: ev.affectedSectors,
    credibility: 1,
    knownBefore: true,
    metrics: ['估值', '盈利预期', '利率'],
    tags: ev.educationalTags,
    eventId: ev.id,
    importance: Math.abs(s) > 1.2 || r.kind === 'cb' ? 3 : 2,
  })
  r.newsId = art.id
  e.onKeyEvent(ev)
}

function macroText(r: MacroRelease, actual: number, s: number, tone: string) {
  const dir = s > 0.5 ? '高于' : s < -0.5 ? '低于' : '基本符合'
  const u = r.unit
  const fmt = (x: number) => x.toFixed(r.kind === 'confidence' || r.kind === 'pmi' ? 1 : 2) + u
  if (r.kind === 'cb') {
    const act = actual > r.expected ? '意外加息' : actual < r.expected ? '意外降息' : actual > r.expected - 0.001 && Math.abs(actual - r.expected) < 0.001 ? '决议符合预期' : ''
    const move = `政策利率${actual > r.expected ? '上调' : actual < r.expected ? '下调' : '维持'}至 ${actual.toFixed(2)}%`
    return {
      title: `央行${act}：${move}，声明措辞偏${tone}`,
      summary: `市场预期利率为 ${r.expected.toFixed(2)}%，实际 ${actual.toFixed(2)}%；会后声明整体偏${tone}。`,
      detail: `像素城中央银行公布利率决议：${move}。会前市场定价的利率为 ${r.expected.toFixed(2)}%。声明对通胀与就业的描述偏${tone}，${tone === '鹰派' ? '暗示未来仍可能收紧' : tone === '鸽派' ? '暗示未来可能放松' : '未给出明确方向'}。利率路径影响折现率、融资成本与银行净息差，不同行业反应可能分化。`,
      analysis: [
        '高估值、依赖远期现金流的公司对折现率变化更敏感；高负债行业关注融资成本。',
        '银行受益于净息差还是受损于信用风险与债券估值，取决于经济前景，不能一概而论。',
        '「符合预期」的决议若措辞改变，也可能引发明显波动——市场交易的是对未来路径的预期。',
        '可以关注后续通胀与就业数据是否支持央行的判断。',
      ],
    }
  }
  const analysisByKind: Record<string, string[]> = {
    cpi: ['通胀高于预期可能推高利率预期，成长股与高负债行业估值承压；能源与原材料公司可能受益于价格传导。', '单月数据可能受食品、能源等波动项影响，核心通胀趋势更值得关注。', '若市场此前已担心通胀，「略高于预期」的影响可能有限。'],
    jobs: ['失业率下降意味着经济韧性，但也可能让央行更难放松政策——同一数据可以有两种解读。', '消费和周期行业对就业更敏感；利率敏感行业关注其对央行路径的影响。', '注意数据修正：前值常被修订。'],
    gdp: ['增长超预期通常利好周期行业，但若伴随通胀压力，也会抬升利率预期。', '季度 GDP 是滞后数据，市场可能更关注前瞻指标（如 PMI）。', '需要拆分消费、投资、出口等结构看增长质量。'],
    pmi: ['PMI 高于 50 表示扩张，低于 50 表示收缩；与预期差比绝对水平更影响短期行情。', '新订单与库存分项能提供更多前瞻信息。'],
    confidence: ['消费者信心影响可选消费、旅游与地产需求，但与实际消费之间存在时滞。', '调查数据波动较大，需观察趋势而非单月。'],
  }
  return {
    title: `${r.name}公布：${fmt(actual)}，${dir}预期（${fmt(r.expected)}）`,
    summary: `${r.name}实际值 ${fmt(actual)}，市场预期 ${fmt(r.expected)}，预期差 ${(s >= 0 ? '+' : '') + s.toFixed(1)} 个标准差。`,
    detail: `该数据为日历事件，发布时间此前已公开，市场在发布前已形成预期（${fmt(r.expected)}）。价格反应主要取决于实际值与预期的差异，而非数值本身的好坏。本次预期差约 ${(s >= 0 ? '+' : '') + s.toFixed(1)} 个标准差。`,
    analysis: analysisByKind[r.kind] ?? [],
  }
}

// ---------------------------------------------------------------------------
// 财报
// ---------------------------------------------------------------------------
export function processEarnings(e: Engine, forceOutcome?: 'beat' | 'miss' | 'mixed', onlySymbol?: string) {
  const w = e.w
  const td = w.clock.tradingDay
  for (const sym of Object.keys(w.stocks)) {
    const st = w.stocks[sym]
    if (onlySymbol ? sym !== onlySymbol : st.nextEarningsDay !== td) continue
    if (st.status === 'delisted') continue
    releaseEarnings(e, st, forceOutcome)
  }
}

function releaseEarnings(e: Engine, st: StockState, force?: 'beat' | 'miss' | 'mixed') {
  const w = e.w
  const c = e.tmpl[st.symbol]
  const r = e.rng.earnings
  const f = st.f
  const k = f.nextQuarterK
  const sharesM = f.shares / 1e6
  const noise = 2 - c.reportReliability
  let revenue = (f.revenueAnnual / 4) * (1 + r.normal() * 0.025 * noise)
  let margin = f.netMargin + r.normal() * 0.012 * noise
  const exp = st.expectation
  if (force === 'beat') {
    revenue = Math.max(revenue, exp.revenue * 1.04)
    margin = Math.max(margin, ((exp.eps * sharesM) / revenue) * 1.12 + 0.002)
  } else if (force === 'miss') {
    revenue = Math.min(revenue, exp.revenue * 0.97)
    margin = Math.min(margin, ((exp.eps * sharesM) / revenue) * 0.82)
  } else if (force === 'mixed') {
    revenue = exp.revenue * 1.05
    margin = ((exp.eps * sharesM) / revenue) * 0.88
  }
  const ni = revenue * margin
  const eps = ni / sharesM
  const epsS = (eps - exp.eps) / Math.max(0.005, Math.abs(exp.eps))
  const revS = (revenue - exp.revenue) / Math.max(1, exp.revenue)
  const gPrev = f.growth
  let guidance: 'raise' | 'maintain' | 'lower' = 'maintain'
  const gr = r.next()
  if (f.growth > f.growthLR + 0.02 && gr < 0.4) guidance = 'raise'
  else if (gr < 0.18) guidance = 'raise'
  else if (gr > 0.8) guidance = 'lower'
  if (force === 'mixed' && r.chance(0.5)) guidance = 'lower'
  let outcome: 'beat' | 'meet' | 'miss' | 'mixed' = epsS > 0.03 ? 'beat' : epsS < -0.03 ? 'miss' : 'meet'
  if ((epsS > 0.02 && revS < -0.01) || (epsS < -0.02 && revS > 0.01) || (epsS > 0.03 && guidance === 'lower') || (epsS < -0.03 && guidance === 'raise')) outcome = 'mixed'
  if (force) outcome = force
  const ocf = ni * c.ocfToNetIncome * (1 + r.normal() * 0.2 * noise)
  const capex = revenue * (c.styles.includes('growth') ? 0.08 : 0.05)
  const dividendQ = Math.max(0, ni) * c.payoutRatio
  f.equity += ni - dividendQ
  const assets = f.equity / Math.max(0.05, 1 - f.debtRatio)
  const prevYear = st.reports.find((x) => x.period === quarterLabel(k - 4))
  const report = {
    id: `${st.symbol}-${quarterLabel(k)}`,
    symbol: st.symbol,
    period: quarterLabel(k),
    publishDay: w.clock.tradingDay,
    publishAt: w.clock.time,
    revenue,
    revenueYoY: prevYear ? revenue / prevYear.revenue - 1 : f.growth,
    grossMargin: f.grossMargin + r.normal() * 0.008,
    netIncome: ni,
    netMargin: margin,
    eps,
    operatingCashFlow: ocf,
    freeCashFlow: ocf - capex,
    totalAssets: assets,
    totalLiabilities: assets - f.equity,
    equity: f.equity,
    debtRatio: f.debtRatio,
    roe: (ni * 4) / Math.max(1, f.equity),
    expectedEps: exp.eps,
    expectedRevenue: exp.revenue,
    guidance,
    outcome,
    outcomeNote: '',
  }
  const outcomeLabel = { beat: '超预期', meet: '符合预期', miss: '低于预期', mixed: '数据混合' }[outcome]
  report.outcomeNote = `EPS ${eps.toFixed(3)} 元 vs 预期 ${exp.eps.toFixed(3)} 元（${fmtPct(epsS, 1)}）；营收 ${revenue.toFixed(0)} 百万 vs 预期 ${exp.revenue.toFixed(0)} 百万（${fmtPct(revS, 1)}）；指引${guidance === 'raise' ? '上调' : guidance === 'lower' ? '下调' : '维持'}`
  st.reports.push(report)
  if (st.reports.length > 16) st.reports.shift()
  f.epsTTM = st.reports.slice(-4).reduce((a, x) => a + x.eps, 0)
  f.bvps = f.equity / sharesM
  // 价格反应：预期差 + 指引 − 已定价
  const gEff = guidance === 'raise' ? 0.025 : guidance === 'lower' ? -0.04 : 0
  let shock = (0.12 * clamp(epsS, -0.4, 0.4) + 0.15 * clamp(revS, -0.2, 0.2) + gEff) * c.eventSensitivity * (1 + r.normal() * 0.35)
  const pre = Math.log(st.last / (st.daily[st.daily.length - 10]?.c ?? st.last))
  if (Math.sign(pre) === Math.sign(shock)) shock -= 0.3 * pre
  shock = clamp(shock, -0.2, 0.2)
  // 基本面：指引与盈利惊喜部分持久化
  f.earningsPower += clamp(epsS * 0.15, -0.05, 0.05) + gEff * 0.6
  if (guidance === 'raise') f.growth += 0.01
  if (guidance === 'lower') f.growth -= 0.015
  // 下一期预期
  f.nextQuarterK = k + 1
  st.nextEarningsDay += 63
  const nextRev = (f.revenueAnnual / 4) * Math.exp(f.growth / 4)
  const bias = r.normal() * 0.04 * (1.5 - c.transparency) + (guidance === 'raise' ? 0.015 : guidance === 'lower' ? -0.02 : 0)
  st.expectation = { nextPeriod: quarterLabel(k + 1), eps: ((nextRev * f.netMargin) / sharesM) * (1 + bias), revenue: nextRev * (1 + bias * 0.4), revisions: [] }
  const ev: MarketEvent = {
    id: e.nextId('EV'),
    templateId: 'earnings:' + outcome,
    category: 'company',
    title: `${c.name}（${st.symbol}）${report.period} 财报：${outcomeLabel}，指引${guidance === 'raise' ? '上调' : guidance === 'lower' ? '下调' : '维持'}`,
    summary: report.outcomeNote,
    detail: `${c.name}发布 ${report.period} 季度报告。营收 ${revenue.toFixed(1)} 百万元（同比 ${fmtPct(report.revenueYoY, 1)}），净利润 ${ni.toFixed(1)} 百万元，净利率 ${fmtPct(margin, 1, false)}，每股收益 ${eps.toFixed(3)} 元。经营现金流 ${ocf.toFixed(1)} 百万元（为净利润的 ${(ni !== 0 ? ocf / ni : 0).toFixed(2)} 倍）。财报发布前，分析师一致预期 EPS 为 ${exp.eps.toFixed(3)} 元、营收 ${exp.revenue.toFixed(1)} 百万元。管理层${guidance === 'raise' ? '上调' : guidance === 'lower' ? '下调' : '维持'}了未来指引。`,
    analysis: [
      outcome === 'mixed' ? '本次数据「有好有坏」：市场需要权衡当期数字与未来指引/增长质量，价格方向并不确定。' : `当期数字${outcomeLabel}，但价格反应还取决于发布前市场是否已提前定价（近 10 日涨跌 ${fmtPct(pre, 1)}）。`,
      guidance === 'lower' ? '指引下调往往比当期超预期更重要：股价反映的是对未来盈利的预期。' : guidance === 'raise' ? '指引上调可能带来分析师预期上修，但需观察是否可持续。' : '指引维持意味着管理层未改变对前景的判断。',
      Math.abs(ocf / (ni || 1)) < 0.7 ? '注意：经营现金流明显低于净利润，盈利质量值得进一步核实（应收账款、存货变化）。' : '现金流与利润基本匹配，盈利质量相对可靠。',
      '可以对比同行业公司的利润率与估值，再判断这份财报的含义。',
    ],
    sourceType: 'announcement',
    publishAt: w.clock.time,
    knownAt: w.clock.time,
    affectedSymbols: [st.symbol],
    affectedSectors: [c.sector],
    marketWide: false,
    credibility: c.reportReliability,
    surprise: epsS / 0.05,
    immediateImpact: shock,
    fundamentalImpact: clamp(epsS * 0.15, -0.05, 0.05) + gEff * 0.6,
    durationSteps: 480,
    volumeMultiplier: 2.5,
    volatilityMultiplier: 1.6,
    followUpEventIds: [],
    educationalTags: ['earnings_surprise', 'consensus', 'guidance', 'priced_in'],
    affectsMetrics: ['营收', 'EPS', '利润率', '现金流', '指引'],
    highImpact: Math.abs(shock) > 0.08,
    priceAtPublish: { [st.symbol]: st.last },
    indexAtPublish: w.indices.PXC.value,
    tradingDay: w.clock.tradingDay,
  }
  addImpact(e, st, shock, ev.id, ev.title)
  addModifier(e, st, ev.id, { vol: 1.6, volume: 2.5, spread: 1.2 }, 480)
  w.events.push(ev)
  publishNews(e, {
    category: 'earnings',
    sourceType: 'announcement',
    sourceName: `${c.name} 公告`,
    title: ev.title,
    summary: ev.summary,
    detail: ev.detail,
    analysis: ev.analysis,
    symbols: [st.symbol],
    sectors: [c.sector],
    credibility: c.reportReliability,
    knownBefore: true,
    metrics: ev.affectsMetrics,
    tags: [...ev.educationalTags, outcome === 'mixed' ? 'mixed' : outcome],
    eventId: ev.id,
    importance: Math.abs(shock) > 0.06 ? 3 : 2,
  })
  if (e.w.account.positions[st.symbol]?.qty) e.w.stats.heldThroughEarnings++
  // 分红：年报（Q4）与中报（Q2，高股息公司）
  const q = ((k % 4) + 4) % 4
  if (c.payoutRatio > 0 && f.epsTTM > 0 && (q === 3 || (q === 1 && c.payoutRatio >= 0.4))) {
    // 高股息公司年报与中报各派一半，其他公司仅年报派息
    const dps = f.epsTTM * c.payoutRatio * (c.payoutRatio >= 0.4 ? 0.5 : 1)
    if (dps > 0.01) e.corp.announceDividend(st.symbol, Math.round(dps * 100))
  }
  e.onKeyEvent(ev)
}

/** 分析师预期修正（随机） */
export function maybeAnalystRevision(e: Engine) {
  const w = e.w
  const r = e.rng.earnings
  for (const st of Object.values(w.stocks)) {
    if (st.status === 'delisted') continue
    if (!r.chance(0.012)) continue
    const c = e.tmpl[st.symbol]
    const delta = r.normal() * 0.04
    st.expectation.eps *= 1 + delta
    st.expectation.revenue *= 1 + delta * 0.4
    const note = `${r.pick(['像素证券', '方块资本', '八位研究所'])}${delta > 0 ? '上调' : '下调'} ${c.name} ${st.expectation.nextPeriod} EPS 预期 ${fmtPct(Math.abs(delta), 1, false)}`
    st.expectation.revisions.push({ day: w.clock.tradingDay, eps: st.expectation.eps, note })
    addImpact(e, st, delta * 0.15 * r.range(0.3, 1.2), 'revision', note)
    publishNews(e, {
      category: 'company',
      sourceType: 'opinion',
      sourceName: '分析师报告',
      title: note,
      summary: `一致预期 EPS 调整为 ${st.expectation.eps.toFixed(3)} 元。分析师观点属于评论，不代表事实结果。`,
      detail: `卖方分析师基于对行业需求、成本与公司指引的判断调整了盈利预测。预期修正会改变财报发布时的「比较基准」：预期越高，超预期的门槛越高。`,
      analysis: ['预期上调可能已被股价部分反映；下调也可能降低后续财报的比较门槛。', '不同机构预测分歧较大时，「一致预期」本身的可靠性下降。'],
      symbols: [st.symbol],
      sectors: [c.sector],
      credibility: 0.6,
      knownBefore: false,
      metrics: ['EPS 预期'],
      tags: ['consensus'],
      importance: 1,
    })
  }
}

/** 每日观点专栏（评论，不产生行情冲击） */
export function opinionColumn(e: Engine) {
  const w = e.w
  const r = e.rng.opinion
  const idx = w.indices.PXC
  const d = idx.daily
  const r5 = d.length > 5 ? idx.value / d[d.length - 5].c - 1 : 0
  const secs = SECTORS.map((s) => {
    const si = w.indices['SEC_' + s.id]
    const dd = si.daily
    return { s, ch: dd.length > 5 ? si.value / dd[dd.length - 5].c - 1 : 0 }
  }).sort((a, b) => b.ch - a.ch)
  const bull = r.chance(0.5)
  const author = r.pick(['陈分析师', '苏记者', '老胡（咖啡馆常客）', '林交易员'])
  const titles = bull
    ? [`观点｜${secs[0].s.name}领涨，${author}认为景气仍有延续可能`, `观点｜近五日指数${fmtPct(r5, 1)}，${author}：市场情绪偏暖但需警惕过度乐观`]
    : [`观点｜${secs[secs.length - 1].s.name}走弱，${author}提醒关注下行风险`, `观点｜近五日指数${fmtPct(r5, 1)}，${author}：防御板块或更具韧性`]
  publishNews(e, {
    category: 'market',
    sourceType: 'opinion',
    sourceName: r.pick(OPINION),
    title: r.pick(titles),
    summary: '以下为个人观点评论，不构成事实陈述，也不是投资建议。',
    detail: `近五个交易日，${secs[0].s.name}行业表现最好（${fmtPct(secs[0].ch, 1)}），${secs[secs.length - 1].s.name}表现最弱（${fmtPct(secs[secs.length - 1].ch, 1)}）。${author}${bull ? '倾向于认为趋势可能延续' : '倾向于认为短期风险上升'}，但同样承认：行业轮动难以预测，过去的涨跌不代表未来。`,
    analysis: ['评论代表作者观点，与公告、官方数据等事实信息不同。', '同一行情可以支持截然相反的观点——可以对照数据自己判断。'],
    symbols: [],
    sectors: [secs[0].s.id, secs[secs.length - 1].s.id],
    credibility: 0.5,
    knownBefore: false,
    metrics: [],
    tags: ['confirmation_bias', 'sector_rotation'],
    importance: 1,
  })
}
