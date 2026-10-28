import type { Engine } from './engine'
import type { CorporateAction, CorpActionType } from './state'
import { publishNews } from './news'
import { cancelOpenOrdersFor, ledger, availableCash } from './trading'
import { computeLimits, rebaseIndices } from './market'
import { fmtMoney, fmtPrice, fmtQty, roundTick } from './util'

export class CorporateEngine {
  constructor(private e: Engine) {}

  private get w() {
    return this.e.w
  }

  private add(sym: string, type: CorpActionType, title: string, description: string, extra: Partial<CorporateAction> = {}): CorporateAction {
    const a: CorporateAction = { id: this.e.nextId('CA'), symbol: sym, type, announceDay: this.w.clock.tradingDay, status: 'announced', title, description, ...extra }
    this.w.actions.push(a)
    const c = this.e.tmpl[sym]
    publishNews(this.e, {
      category: 'corporate',
      sourceType: 'announcement',
      sourceName: `${c.name} 公告`,
      title,
      summary: description.split('。')[0] + '。',
      detail: description,
      analysis: CORP_ANALYSIS[type],
      symbols: [sym],
      sectors: [c.sector],
      credibility: 1,
      knownBefore: false,
      metrics: CORP_METRICS[type],
      tags: CORP_TAGS[type],
      importance: type === 'delisting' || type === 'suspension' || type === 'riskWarning' ? 3 : 2,
    })
    if (this.e.w.account.positions[sym]?.qty) this.e.notice(type === 'delisting' || type === 'riskWarning' ? 'danger' : 'info', `持仓公司公告 · ${c.name}`, title, sym)
    this.e.debug('corp', `${a.id} ${type} ${sym} ${title}`)
    return a
  }

  private held(sym: string) {
    return this.w.account.positions[sym]?.qty ?? 0
  }

  // ---------------------------------------------------------------- 公告
  announceDividend(sym: string, dps: number, exIn = 8, payIn = 13) {
    const td = this.w.clock.tradingDay
    const c = this.e.tmpl[sym]
    const st = this.w.stocks[sym]
    const yieldPct = ((dps / st.last) * 100).toFixed(2)
    this.add(
      sym,
      'dividend',
      `${c.name}分红方案：每股派现 ${fmtPrice(dps)} 元，除息日 ${this.e.cal.label(td + exIn)}`,
      `${c.name}董事会通过现金分红方案，每股派发现金 ${fmtPrice(dps)} 元（按当前价约 ${yieldPct}%）。除息日为 ${this.e.cal.label(td + exIn)}（除息日开盘前持有的股份享有分红），派息日为 ${this.e.cal.label(td + payIn)}。除息日参考价将扣除每股股息；股息到账时按规则包代扣税率 ${(this.e.rules.dividendTaxRate * 100).toFixed(0)}%。理论上分红前后股东总价值（股价+现金）不变。`,
      { exDay: td + exIn, payDay: td + payIn, dps },
    )
  }

  announceSplit(sym: string, ratio: number) {
    const td = this.w.clock.tradingDay
    const c = this.e.tmpl[sym]
    const label = ratio >= 1 ? `每 1 股拆分为 ${ratio} 股` : `每 ${Math.round(1 / ratio)} 股合并为 1 股`
    this.add(
      sym,
      'split',
      `${c.name}${ratio >= 1 ? '拆股' : '合股'}：${label}，${this.e.cal.label(td + 10)} 生效`,
      `${c.name}宣布${label}，于 ${this.e.cal.label(td + 10)} 开盘前生效。生效后持股数量与价格按比例调整，持仓成本总额不变，公司总市值理论上不变。${ratio < 1 ? '合股后不足 1 股的零碎股份将按生效前收盘价折算为现金。' : ''}生效时该股票所有未成交订单将被撤销。之后的价格仍由市场决定。`,
      { effectiveDay: td + 10, ratio },
    )
  }

  announceRights(sym: string, ratio = 0.3, discount = 0.8) {
    const td = this.w.clock.tradingDay
    const c = this.e.tmpl[sym]
    const st = this.w.stocks[sym]
    const price = roundTick(st.last * discount, this.e.rules.tickSize)
    this.add(
      sym,
      'rights',
      `${c.name}配股：每 10 股配 ${(ratio * 10).toFixed(0)} 股，配股价 ${fmtPrice(price)} 元`,
      `${c.name}为补充资本金实施配股。股权登记/除权日 ${this.e.cal.label(td + 5)}，在该日开盘前持股的股东可按每 10 股配 ${(ratio * 10).toFixed(0)} 股认购，认购期至 ${this.e.cal.label(td + 10)}，新股于 ${this.e.cal.label(td + 12)} 上市。配股价较现价折让约 ${((1 - discount) * 100).toFixed(0)}%。除权日参考价调整为理论除权价。不参与认购的股东持股比例将被稀释，价值可能受损；参与认购则需要额外现金。`,
      { exDay: td + 5, endDay: td + 10, effectiveDay: td + 12, ratio, price },
    )
  }

  announceOffering(sym: string) {
    const td = this.w.clock.tradingDay
    const c = this.e.tmpl[sym]
    const st = this.w.stocks[sym]
    const n = Math.round(st.f.shares * this.e.rng.corp.range(0.05, 0.15))
    const price = roundTick(st.last * this.e.rng.corp.range(0.85, 0.95), this.e.rules.tickSize)
    this.add(
      sym,
      'offering',
      `${c.name}定向增发：拟发行 ${(n / 1e6).toFixed(1)} 百万股，发行价 ${fmtPrice(price)} 元`,
      `${c.name}拟向特定投资者增发约 ${(n / 1e6).toFixed(1)} 百万股（约占总股本 ${((n / st.f.shares) * 100).toFixed(1)}%），发行价 ${fmtPrice(price)} 元，预计 ${this.e.cal.label(td + 15)} 完成。增发带来新增资金，同时摊薄每股收益；市场对资金用途与发行折价的评估决定价格反应。`,
      { effectiveDay: td + 15, amount: n, price },
    )
  }

  announceBuyback(sym: string) {
    const td = this.w.clock.tradingDay
    const c = this.e.tmpl[sym]
    const st = this.w.stocks[sym]
    const mcap = (st.last / 100) * st.f.shares
    const amount = (mcap * this.e.rng.corp.range(0.008, 0.025)) / 1e6
    this.add(
      sym,
      'buyback',
      `${c.name}回购计划：拟在 20 个交易日内回购约 ${amount.toFixed(1)} 百万元股份`,
      `${c.name}计划使用自有资金在未来 20 个交易日内回购股份并注销，金额约 ${amount.toFixed(1)} 百万元（约占市值 ${((amount * 1e6 / mcap) * 100).toFixed(2)}%）。回购减少流通股本、改善每股指标，但会消耗公司现金；回购并不保证股价上涨。`,
      { effectiveDay: td + 1, endDay: td + 20, amount },
    )
  }

  suspend(sym: string, days: number, reason: string) {
    const st = this.w.stocks[sym]
    if (st.status === 'delisted' || st.status === 'suspended') return
    const td = this.w.clock.tradingDay
    const resume = td + Math.max(1, days)
    st.status = 'suspended'
    st.suspendUntilDay = resume
    const c = this.e.tmpl[sym]
    this.add(
      sym,
      'suspension',
      `${c.name}停牌公告：预计 ${this.e.cal.label(resume)} 复牌`,
      `因「${reason}」，${c.name}股票自即日起停牌，预计于 ${this.e.cal.label(resume)} 复牌。停牌期间无法成交，但可以查看公告与持仓状态。停牌期间市场与行业的变化仍在发生，复牌时价格可能出现明显跳空。`,
      { effectiveDay: td, endDay: resume, status: 'active' },
    )
    if (this.held(sym)) this.w.stats.suspensionsHeld++
  }

  setRiskWarning(sym: string, reason: string) {
    const st = this.w.stocks[sym]
    if (st.riskWarning || st.status === 'delisted') return
    st.riskWarning = true
    const c = this.e.tmpl[sym]
    this.add(
      sym,
      'riskWarning',
      `交易所对 ${c.name} 实施风险警示`,
      `因「${reason}」，交易所对 ${c.name}（${sym}）实施风险警示，下一交易日起涨跌幅限制调整为 ±${(this.e.rules.priceLimit.riskWarningPct * 100).toFixed(0)}%（若规则包启用涨跌幅）。若相关情形未能消除，公司可能进入退市流程。风险警示股波动与流动性风险通常更高。`,
      { status: 'active' },
    )
  }

  delistPressure(sym: string, reason: string) {
    const st = this.w.stocks[sym]
    if (st.riskWarning) this.announceDelisting(sym, reason)
    else this.setRiskWarning(sym, reason)
  }

  announceDelisting(sym: string, reason: string) {
    const st = this.w.stocks[sym]
    if (st.status === 'delisting' || st.status === 'delisted') return
    const td = this.w.clock.tradingDay
    if (st.status === 'suspended') st.suspendUntilDay = td + 1
    st.status = 'delisting'
    st.delistDay = td + 10
    const c = this.e.tmpl[sym]
    this.add(
      sym,
      'delisting',
      `${c.name}终止上市：进入 10 个交易日退市整理期`,
      `因「${reason}」，${c.name}将终止上市。${this.e.cal.label(td + 1)} 起进入退市整理期（约 10 个交易日），期间仍可交易；整理期结束后（${this.e.cal.label(td + 10)}）股票停止交易，剩余持仓将按清算评估的每股剩余价值结算为现金（可能远低于当前价格，甚至接近零）。持仓不会被无解释地删除，结算记录会写入资金流水。`,
      { effectiveDay: td, endDay: td + 10, status: 'active' },
    )
  }

  // ---------------------------------------------------------------- 玩家命令：认购配股
  subscribeRights(actionId: string, qty: number): { ok: boolean; message: string } {
    const a = this.w.actions.find((x) => x.id === actionId)
    const td = this.w.clock.tradingDay
    if (!a || a.type !== 'rights') return { ok: false, message: '配股信息不存在' }
    if (td < (a.exDay ?? 0) || td > (a.endDay ?? 0)) return { ok: false, message: '不在认购期内' }
    const max = Math.floor((a.entitledQty ?? 0) * (a.ratio ?? 0)) - (a.subscribedQty ?? 0)
    if (!Number.isInteger(qty) || qty <= 0 || qty > max) return { ok: false, message: `可认购数量为 0 ~ ${fmtQty(Math.max(0, max))} 股` }
    const cost = qty * (a.price ?? 0)
    if (cost > availableCash(this.e)) return { ok: false, message: `可用现金不足（需 ${fmtMoney(cost)}）` }
    ledger(this.e, 'rightsSubscribe', -cost, `认购 ${a.symbol} 配股 ${fmtQty(qty)} 股 @ ${fmtPrice(a.price)}`, { symbol: a.symbol })
    a.subscribedQty = (a.subscribedQty ?? 0) + qty
    this.w.account.rightsPending.push({ actionId: a.id, symbol: a.symbol, qty, paid: cost, listDay: a.effectiveDay ?? td + 2 })
    this.w.stats.rightsSubscribed++
    this.e.logCommand('subscribeRights', { actionId, qty })
    this.e.markDirty(true)
    return { ok: true, message: `已认购 ${fmtQty(qty)} 股，新股将于 ${this.e.cal.label(a.effectiveDay ?? td + 2)} 上市到账` }
  }

  // ---------------------------------------------------------------- 每日处理（盘前）
  processDayStart() {
    const td = this.w.clock.tradingDay
    const acc = this.w.account
    for (const a of this.w.actions) {
      if (a.status === 'completed' || a.status === 'cancelled') continue
      const st = this.w.stocks[a.symbol]
      const c = this.e.tmpl[a.symbol]
      const pos = acc.positions[a.symbol]
      switch (a.type) {
        case 'dividend': {
          if (a.exDay === td && st.status !== 'delisted') {
            a.status = 'active'
            a.entitledQty = pos && pos.qty > 0 ? pos.qty : 0
            a.shortQtyAtEx = pos && pos.qty < 0 ? -pos.qty : 0
            const ratio = Math.max(0.01, 1 - a.dps! / Math.max(1, st.prevClose))
            st.prevClose = Math.max(this.e.rules.tickSize, st.prevClose - a.dps!)
            st.lnFund += Math.log(ratio)
            st.lnFund0 += Math.log(ratio)
            computeLimits(this.e, st)
            if (a.entitledQty) this.w.stats.exDividendHeld++
            if (a.shortQtyAtEx) {
              const pay = a.shortQtyAtEx * a.dps!
              ledger(this.e, 'dividendPayShort', -pay, `空头持仓需向出借方支付 ${a.symbol} 股息`, { symbol: a.symbol })
            }
            if (a.entitledQty) this.e.notice('info', `除息 · ${c.name}`, `今日除息，参考价下调 ${fmtPrice(a.dps)} 元。你持有 ${fmtQty(a.entitledQty)} 股，股息将于 ${this.e.cal.label(a.payDay!)} 到账。`, a.symbol)
          }
          if (a.payDay === td && a.status === 'active') {
            const q = a.entitledQty ?? 0
            if (q > 0) {
              const gross = q * a.dps!
              const tax = Math.round(gross * this.e.rules.dividendTaxRate)
              ledger(this.e, 'dividend', gross, `${a.symbol} 现金股息 ${fmtQty(q)} 股 × ${fmtPrice(a.dps)}`, { symbol: a.symbol })
              if (tax) ledger(this.e, 'dividendTax', -tax, `${a.symbol} 股息代扣税（${(this.e.rules.dividendTaxRate * 100).toFixed(0)}%）`, { symbol: a.symbol })
              acc.dividendsTotal += gross - tax
              if (pos) pos.dividendsReceived += gross - tax
              this.w.stats.dividendsReceived++
              this.e.notice('success', `股息到账 · ${c.name}`, `税后 ${fmtMoney(gross - tax)} 已计入现金。`, a.symbol)
            }
            a.status = 'completed'
          }
          break
        }
        case 'split': {
          if (a.effectiveDay === td && st.status !== 'delisted') {
            this.applySplit(a)
            a.status = 'completed'
          }
          break
        }
        case 'rights': {
          if (a.exDay === td) {
            a.status = 'active'
            a.entitledQty = pos && pos.qty > 0 ? pos.qty : 0
            const p0 = st.prevClose
            const terp = (p0 + a.ratio! * a.price!) / (1 + a.ratio!)
            rebaseIndices(this.e, () => {
              st.prevClose = roundTick(terp, this.e.rules.tickSize)
              st.last = st.prevClose
            })
            st.lnFund += Math.log(terp / p0)
            st.lnFund0 += Math.log(terp / p0)
            computeLimits(this.e, st)
            if (a.entitledQty) this.e.notice('warn', `配股认购开始 · ${c.name}`, `你可认购最多 ${fmtQty(Math.floor(a.entitledQty * a.ratio!))} 股（配股价 ${fmtPrice(a.price)}），截止 ${this.e.cal.label(a.endDay!)}。可在股票详情「公司行动」中认购。`, a.symbol)
          }
          if (a.effectiveDay === td && a.status === 'active') {
            const add = Math.round(st.f.shares * a.ratio!)
            rebaseIndices(this.e, () => {
              st.f.shares += add
              st.f.floatShares += add
            })
            st.f.equity += (add * a.price!) / 100 / 1e6
            st.shareHistory.push({ day: td, shares: st.f.shares, note: '配股上市' })
            for (const rp of acc.rightsPending.filter((x) => x.actionId === a.id)) {
              const p = this.e.ensurePosition(a.symbol)
              if (p.qty === 0) p.openedDay = td
              p.qty += rp.qty
              p.costBasis += rp.paid
              p.lots.push({ qty: rp.qty, sellableDay: td })
              this.e.notice('success', `配股到账 · ${c.name}`, `${fmtQty(rp.qty)} 股配股已上市到账。`, a.symbol)
            }
            acc.rightsPending = acc.rightsPending.filter((x) => x.actionId !== a.id)
            a.status = 'completed'
          }
          break
        }
        case 'offering': {
          if (a.effectiveDay === td) {
            const n = a.amount!
            const P = st.prevClose
            const newP = (P * st.f.shares + a.price! * n) / (st.f.shares + n)
            rebaseIndices(this.e, () => {
              st.f.shares += n
              st.f.floatShares += n
            })
            st.lnFund += Math.log(newP / P)
            st.lnFund0 += Math.log(newP / P)
            st.f.equity += (n * a.price!) / 100 / 1e6
            st.shareHistory.push({ day: td, shares: st.f.shares, note: '定向增发完成' })
            a.status = 'completed'
          }
          break
        }
        case 'buyback': {
          if (td >= (a.effectiveDay ?? 0) && td <= (a.endDay ?? 0) && st.status === 'normal') {
            a.status = 'active'
            const daily = (a.amount! * 1e6) / 20
            const qty = Math.min(Math.round(daily / Math.max(0.01, st.last / 100)), Math.round(st.f.floatShares * 0.01))
            rebaseIndices(this.e, () => {
              st.f.shares -= qty
              st.f.floatShares -= qty
            })
            st.f.equity -= daily / 1e6
            st.dev += 0.0006 * this.e.rng.corp.range(0, 2)
            if (td === a.endDay) {
              a.status = 'completed'
              st.shareHistory.push({ day: td, shares: st.f.shares, note: '回购注销完成' })
            }
          }
          break
        }
        case 'suspension': {
          if (a.endDay === td && st.status === 'suspended') {
            st.status = 'normal'
            st.suspendUntilDay = undefined
            a.status = 'completed'
            publishNews(this.e, {
              category: 'corporate',
              sourceType: 'announcement',
              sourceName: `${c.name} 公告`,
              title: `${c.name}今日复牌：注意跳空风险`,
              summary: '停牌期间的市场变化与公司信息将在复牌开盘时集中反映。',
              detail: `${c.name}（${a.symbol}）今日复牌。停牌期间，大盘、行业与公司相关信息持续变化，复牌开盘价可能与停牌前价格存在明显差异（跳空）。止损单在跳空时可能以远离触发价的价格成交。`,
              analysis: ['复牌首日成交量与波动通常放大。', '若停牌原因为重组/调查，需阅读复牌公告中的结论。'],
              symbols: [a.symbol],
              sectors: [c.sector],
              credibility: 1,
              knownBefore: true,
              metrics: [],
              tags: ['suspension', 'gap'],
              importance: 2,
            })
            if (this.held(a.symbol)) this.e.notice('warn', `复牌 · ${c.name}`, '今日复牌，开盘价可能大幅跳空，请留意风险。', a.symbol)
          }
          break
        }
        case 'delisting': {
          if (a.endDay === td && st.status === 'delisting') {
            this.finalizeDelisting(a)
            a.status = 'completed'
          }
          break
        }
      }
    }
  }

  private applySplit(a: CorporateAction) {
    const e = this.e
    const st = this.w.stocks[a.symbol]
    const r = a.ratio!
    const tick = e.rules.tickSize
    cancelOpenOrdersFor(e, a.symbol, `公司行动：${r >= 1 ? '拆股' : '合股'}生效，未成交订单已撤销`)
    const adj = (p: number) => roundTick(p / r, tick)
    st.f.shares = Math.round(st.f.shares * r)
    st.f.floatShares = Math.round(st.f.floatShares * r)
    st.last = adj(st.last)
    st.prevClose = adj(st.prevClose)
    st.open = adj(st.open)
    st.high = adj(st.high)
    st.low = adj(st.low)
    for (const b of st.daily) {
      b.o = adj(b.o); b.h = adj(b.h); b.l = adj(b.l); b.c = adj(b.c); b.v = Math.round(b.v * r)
    }
    for (const b of st.minute) {
      b.o = adj(b.o); b.h = adj(b.h); b.l = adj(b.l); b.c = adj(b.c); b.v = Math.round(b.v * r)
    }
    st.tape = []
    st.lnFund -= Math.log(r)
    st.lnFund0 -= Math.log(r)
    st.f.epsTTM /= r
    st.f.dpsTTM /= r
    st.f.bvps /= r
    st.expectation.eps /= r
    for (const rep of st.reports) {
      rep.eps /= r
      rep.expectedEps /= r
    }
    st.adv = Math.round(st.adv * r)
    st.minuteBase *= r
    st.borrowAvailable = Math.round(st.borrowAvailable * r)
    st.splitFactor *= r
    st.shareHistory.push({ day: this.w.clock.tradingDay, shares: st.f.shares, note: r >= 1 ? `拆股 1→${r}` : `合股 ${Math.round(1 / r)}→1` })
    computeLimits(e, st)
    // 待生效的分红每股金额同步调整
    for (const x of this.w.actions) if (x.symbol === a.symbol && x.type === 'dividend' && x.status !== 'completed' && x.dps) x.dps = Math.round(x.dps / r)
    const p = this.w.account.positions[a.symbol]
    if (p && p.qty !== 0) {
      this.w.stats.splitsHeld++
      const raw = Math.abs(p.qty) * r
      const whole = Math.floor(raw + 1e-9)
      const frac = raw - whole
      const sign = Math.sign(p.qty)
      if (frac > 1e-9 && sign > 0) {
        const cash = Math.round(frac * st.prevClose)
        const costOut = Math.round((p.costBasis * frac) / raw)
        ledger(e, 'cashInLieu', cash, `${a.symbol} 合股零碎股折现 ${frac.toFixed(3)} 股`, { symbol: a.symbol })
        p.costBasis -= costOut
        p.realizedPnl += cash - costOut
        this.w.account.realizedTotal += cash - costOut
      }
      p.qty = sign * whole
      // 批次缩放
      let remaining = whole
      p.lots = p.lots.map((l) => ({ ...l, qty: Math.floor(l.qty * r) }))
      const lotSum = p.lots.reduce((s, l) => s + l.qty, 0)
      if (p.lots.length && lotSum !== remaining && sign > 0) p.lots[p.lots.length - 1].qty += remaining - lotSum
      p.lots = p.lots.filter((l) => l.qty > 0)
      remaining = 0
      e.notice('info', `${r >= 1 ? '拆股' : '合股'}生效 · ${e.tmpl[a.symbol].name}`, `持仓调整为 ${fmtQty(p.qty)} 股，成本总额不变。`, a.symbol)
    }
  }

  private finalizeDelisting(a: CorporateAction) {
    const e = this.e
    const st = this.w.stocks[a.symbol]
    cancelOpenOrdersFor(e, a.symbol, '股票终止上市，未成交订单已撤销')
    const residual = Math.max(0, Math.round(st.last * e.rng.corp.range(0, 0.25)))
    a.residual = residual
    const p = this.w.account.positions[a.symbol]
    rebaseIndices(e, () => {
      st.status = 'delisted'
    })
    if (p && p.qty !== 0) {
      const q = p.qty
      const proceeds = q * residual
      ledger(e, 'delistSettlement', proceeds, `${a.symbol} 退市清算：${fmtQty(Math.abs(q))} 股 × 每股剩余价值 ${fmtPrice(residual)}`, { symbol: a.symbol })
      const realized = q > 0 ? proceeds - p.costBasis : p.costBasis + proceeds
      p.realizedPnl += realized
      this.w.account.realizedTotal += realized
      if (q < 0) st.borrowAvailable += -q
      p.qty = 0
      p.costBasis = 0
      p.lots = []
      p.frozenQty = 0
      e.notice('danger', `退市结算 · ${e.tmpl[a.symbol].name}`, `持仓按每股 ${fmtPrice(residual)} 结算，已实现盈亏 ${fmtMoney(realized)}。记录已写入资金流水。`, a.symbol)
      e.cleanupPosition(a.symbol)
    }
  }

  /** 收盘后：风险警示与退市条件检查，以及随机公司行动 */
  processDayEnd() {
    const e = this.e
    const r = e.rng.corp
    for (const st of Object.values(this.w.stocks)) {
      if (st.status === 'delisted') continue
      const sym = st.symbol
      const c = e.tmpl[sym]
      st.lowPriceDays = st.last < 100 ? st.lowPriceDays + 1 : 0
      if (st.lowPriceDays >= 10 && !st.riskWarning) this.setRiskWarning(sym, '股价连续 10 个交易日低于 1 元')
      if (st.lowPriceDays >= 20 && st.status === 'normal') this.announceDelisting(sym, '股价连续 20 个交易日低于 1 元（面值退市）')
      if (st.f.equity < 0 && !st.riskWarning) this.setRiskWarning(sym, '最近一期净资产为负')
      if (st.riskWarning && st.status === 'normal' && st.last > 300 && st.f.equity > 0 && st.lowPriceDays === 0 && r.chance(0.02)) {
        st.riskWarning = false
        publishNews(e, {
          category: 'corporate', sourceType: 'announcement', sourceName: '交易所公告',
          title: `${c.name}撤销风险警示`, summary: '相关风险情形已消除，次一交易日起恢复正常涨跌幅限制。',
          detail: `经审核，${c.name}触发风险警示的情形已消除，交易所撤销风险警示。`, analysis: ['撤销警示不代表经营风险完全消失。'],
          symbols: [sym], sectors: [c.sector], credibility: 1, knownBefore: false, metrics: [], tags: ['delisting'], importance: 2,
        })
      }
      if (st.status !== 'normal') continue
      const pending = this.w.actions.some((x) => x.symbol === sym && x.status !== 'completed' && (x.type === 'split' || x.type === 'rights' || x.type === 'offering'))
      if (pending) continue
      if (st.last > 25000 && r.chance(0.03)) this.announceSplit(sym, st.last > 50000 ? 5 : 2)
      else if (st.last < 250 && !st.riskWarning && r.chance(0.01)) this.announceSplit(sym, 0.2)
      else if (st.f.debtRatio > 0.62 && r.chance(0.0012)) this.announceRights(sym, r.pick([0.2, 0.3]), r.range(0.75, 0.85))
      else if (c.ocfToNetIncome > 1.1 && st.dev < -0.1 && r.chance(0.003)) this.announceBuyback(sym)
    }
  }
}

const CORP_ANALYSIS: Record<CorpActionType, string[]> = {
  dividend: ['分红本身不创造价值：除息后股价参考价下调，股东获得现金（扣税后总价值可能略减）。', '稳定且可持续的分红往往反映现金流质量，但高股息率也可能是股价下跌所致（股息陷阱）。'],
  split: ['拆股/合股只改变股数和每股价格，不改变公司价值。', '拆股可能提高交易便利性；合股常见于股价过低的公司，需关注背后原因。'],
  rights: ['配股向老股东融资：参与需要额外现金，不参与则股权被稀释。', '理论除权价 = (除权前价格 + 配股比例 × 配股价) / (1 + 配股比例)。', '需关注融资用途与公司负债状况。'],
  offering: ['增发带来资金但摊薄每股收益；发行折价越大，对现有股东越不利。', '若资金投向高回报项目，长期可能提升价值。'],
  buyback: ['回购减少流通股、改善每股指标，常被视为管理层认为股价低估的信号。', '回购消耗现金，若以高价回购或举债回购，未必创造价值；回购不保证股价上涨。'],
  suspension: ['停牌期间无法交易，风险无法通过卖出规避。', '复牌时价格可能大幅跳空，止损单无法保证成交价。'],
  riskWarning: ['风险警示提示公司存在重大经营或财务风险，可能进入退市流程。', '风险警示股涨跌幅限制更窄，流动性可能变差。'],
  delisting: ['退市整理期结束后股票停止交易，剩余价值按清算结果结算，可能很低。', '「便宜」不等于「有价值」：低价股可能面临退市风险。'],
}
const CORP_METRICS: Record<CorpActionType, string[]> = {
  dividend: ['股息率', '现金流'], split: ['每股指标'], rights: ['股本', '每股收益', '负债率'], offering: ['股本', '每股收益'],
  buyback: ['股本', '现金'], suspension: ['流动性'], riskWarning: ['净资产', '持续经营'], delisting: ['清算价值'],
}
const CORP_TAGS: Record<CorpActionType, string[]> = {
  dividend: ['dividend', 'ex_dividend', 'dividend_yield'], split: ['stock_split', 'reverse_split'], rights: ['rights_issue'],
  offering: ['secondary_offering'], buyback: ['buyback'], suspension: ['suspension', 'gap'], riskWarning: ['delisting', 'price_limit'], delisting: ['delisting'],
}
