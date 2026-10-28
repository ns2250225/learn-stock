import type { Engine } from './engine'
import type { Cents, Execution, LedgerType, Order, OrderSide, OrderStatus, OrderType, Position, TimeInForce } from './types'
import type { StockState } from './state'
import { PROTECT_BAND } from './params'
import { ORDER_TYPE_LABEL, SIDE_LABEL, STATUS_LABEL } from './rules'
import { fmtMoney, fmtPrice, fmtQty, roundTick } from './util'

export interface OrderRequest {
  clientKey: string
  symbol: string
  side: OrderSide
  type: OrderType
  tif: TimeInForce
  qty: number
  limitPrice?: Cents
  stopPrice?: Cents
  planId?: string
  source?: 'player' | 'system'
  forced?: boolean
}

export interface SubmitResult {
  ok: boolean
  order?: Order
  duplicate?: boolean
  error?: string
  suggestion?: string
}

// ---------------------------------------------------------------------------
// 订单状态机
// ---------------------------------------------------------------------------
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ['pendingSubmit'],
  pendingSubmit: ['accepted', 'rejected'],
  accepted: ['waitingTrigger', 'partiallyFilled', 'filled', 'cancelPending', 'cancelled', 'expired'],
  waitingTrigger: ['accepted', 'cancelPending', 'cancelled', 'expired'],
  partiallyFilled: ['partiallyFilled', 'filled', 'cancelPending', 'cancelled', 'expired'],
  cancelPending: ['cancelled'],
  filled: [],
  cancelled: [],
  rejected: [],
  expired: [],
}

export const OPEN_STATUSES: OrderStatus[] = ['accepted', 'waitingTrigger', 'partiallyFilled', 'cancelPending']
export const isOpen = (o: Order) => OPEN_STATUSES.includes(o.status)
export const isBuySide = (s: OrderSide) => s === 'buy' || s === 'cover'

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function transition(e: Engine, o: Order, to: OrderStatus, reason: string, fees = 0) {
  if (!canTransition(o.status, to)) {
    e.debug('order', `非法状态转换被阻止：${o.id} ${o.status} → ${to}`)
    throw new Error(`非法订单状态转换 ${STATUS_LABEL[o.status]} → ${STATUS_LABEL[to]}`)
  }
  o.history.push({ ts: e.w.clock.time, from: o.status, to, reason, filledQty: o.filledQty, remainingQty: o.qty - o.filledQty, fees })
  o.status = to
  o.updatedAt = e.w.clock.time
}

// ---------------------------------------------------------------------------
// 费用
// ---------------------------------------------------------------------------
export interface FeeBreakdown {
  commission: number
  exchangeFee: number
  regulatoryFee: number
  stampTax: number
  transferFee: number
  total: number
}

/** 按订单累计成交额计算累计应收费用（部分成交时每笔收取 累计应收−已收，结果稳定可测） */
export function cumulativeFees(e: Engine, side: OrderSide, cumValue: Cents): FeeBreakdown {
  const f = e.rules.fees
  if (cumValue <= 0) return { commission: 0, exchangeFee: 0, regulatoryFee: 0, stampTax: 0, transferFee: 0, total: 0 }
  const sellSide = side === 'sell' || side === 'short'
  const commission = Math.round(Math.max(f.minCommission, cumValue * f.commissionRate))
  const exchangeFee = Math.round(cumValue * f.exchangeFeeRate)
  const regulatoryFee = sellSide ? Math.round(cumValue * f.regulatoryFeeRate) : 0
  const stampTax = sellSide ? Math.round(cumValue * f.stampTaxSellRate) : 0
  const transferFee = Math.round(cumValue * f.transferFeeRate)
  return { commission, exchangeFee, regulatoryFee, stampTax, transferFee, total: commission + exchangeFee + regulatoryFee + stampTax + transferFee }
}

export function feeRate(e: Engine, side: OrderSide): number {
  const f = e.rules.fees
  const sellSide = side === 'sell' || side === 'short'
  return f.commissionRate + f.exchangeFeeRate + f.transferFeeRate + (sellSide ? f.regulatoryFeeRate + f.stampTaxSellRate : 0)
}

// ---------------------------------------------------------------------------
// 账户查询
// ---------------------------------------------------------------------------
export function markPrice(e: Engine, sym: string): Cents {
  return e.w.stocks[sym]?.last ?? 0
}

export function longValue(e: Engine): Cents {
  let v = 0
  for (const p of Object.values(e.w.account.positions)) if (p.qty > 0) v += p.qty * markPrice(e, p.symbol)
  return v
}

export function shortValue(e: Engine): Cents {
  let v = 0
  for (const p of Object.values(e.w.account.positions)) if (p.qty < 0) v += -p.qty * markPrice(e, p.symbol)
  return v
}

export function equity(e: Engine): Cents {
  return e.w.account.cash + longValue(e) - shortValue(e)
}

export function grossExposure(e: Engine): Cents {
  return longValue(e) + shortValue(e)
}

export function availableCash(e: Engine): Cents {
  return Math.max(0, e.w.account.cash - e.w.account.frozen)
}

export function nav(e: Engine): number {
  return equity(e) / Math.max(1e-9, e.w.account.navUnits)
}

export function totalReturn(e: Engine): number {
  return nav(e) / 100 - 1
}

export function pendingExposure(e: Engine): Cents {
  let v = 0
  for (const o of e.w.orders) {
    if (!isOpen(o) || (o.side !== 'buy' && o.side !== 'short')) continue
    const p = o.limitPrice ?? o.stopPrice ?? markPrice(e, o.symbol)
    v += (o.qty - o.filledQty) * p
  }
  return v
}

/** 保证金账户的购买力（新增敞口上限） */
export function buyingPower(e: Engine): Cents {
  const m = e.rules.margin
  const eq = equity(e)
  return Math.max(0, eq / m.initialMargin - grossExposure(e) - pendingExposure(e))
}

export function sellableQty(e: Engine, sym: string): number {
  const p = e.w.account.positions[sym]
  if (!p || p.qty <= 0) return 0
  const td = e.w.clock.tradingDay
  const settled = p.lots.reduce((a, l) => a + (l.sellableDay <= td ? l.qty : 0), 0)
  return Math.max(0, Math.min(p.qty, settled) - p.frozenQty)
}

export function lockedQty(e: Engine, sym: string): number {
  const p = e.w.account.positions[sym]
  if (!p || p.qty <= 0) return 0
  const td = e.w.clock.tradingDay
  return p.lots.reduce((a, l) => a + (l.sellableDay > td ? l.qty : 0), 0)
}

export function coverableQty(e: Engine, sym: string): number {
  const p = e.w.account.positions[sym]
  if (!p || p.qty >= 0) return 0
  return Math.max(0, -p.qty - p.frozenQty)
}

export function marginRatio(e: Engine): number {
  const g = grossExposure(e)
  return g > 0 ? equity(e) / g : Infinity
}

// ---------------------------------------------------------------------------
// 流水
// ---------------------------------------------------------------------------
export function ledger(
  e: Engine,
  type: LedgerType,
  amount: Cents,
  note: string,
  extra: { symbol?: string; orderId?: string; execId?: string; frozenDelta?: Cents } = {},
) {
  const a = e.w.account
  if (type === 'freeze' || type === 'unfreeze') {
    a.frozen += extra.frozenDelta ?? 0
  } else {
    a.cash += amount
  }
  e.w.ledger.push({
    id: e.nextId('L'),
    ts: e.w.clock.time,
    tradingDay: e.w.clock.tradingDay,
    type,
    amount: type === 'freeze' || type === 'unfreeze' ? (extra.frozenDelta ?? 0) : amount,
    balanceAfter: a.cash,
    frozenAfter: a.frozen,
    symbol: extra.symbol,
    orderId: extra.orderId,
    execId: extra.execId,
    note,
  })
}

// ---------------------------------------------------------------------------
// 下单
// ---------------------------------------------------------------------------
function basisPrice(e: Engine, st: StockState, req: { side: OrderSide; type: OrderType; limitPrice?: Cents; stopPrice?: Cents }): Cents {
  const tick = e.rules.tickSize
  if (req.type === 'limit' || req.type === 'stopLimit') return req.limitPrice!
  const ref = req.type === 'stop' ? req.stopPrice! : Math.max(st.book.asks[0]?.price ?? st.last, st.last)
  return Math.min(st.limitUp, roundTick(ref * (1 + PROTECT_BAND), tick, 'ceil'))
}

export function protectPrice(e: Engine, st: StockState, side: OrderSide, ref: Cents): Cents {
  const tick = e.rules.tickSize
  return isBuySide(side)
    ? Math.min(st.limitUp, roundTick(ref * (1 + PROTECT_BAND), tick, 'ceil'))
    : Math.max(st.limitDown, roundTick(ref * (1 - PROTECT_BAND), tick, 'floor'))
}

export interface OrderEstimate {
  basis: Cents
  notional: Cents
  fees: FeeBreakdown
  freeze: Cents
  maxQty: number
  sellable: number
  locked: number
  coverable: number
  available: Cents
  slippageRange: [number, number]
  warnings: string[]
  error?: string
  netProceeds?: Cents
}

export function estimateOrder(e: Engine, req: Omit<OrderRequest, 'clientKey'>): OrderEstimate {
  const st = e.w.stocks[req.symbol]
  const lot = e.rules.lotSize
  const warnings: string[] = []
  const basis = st ? basisPrice(e, st, req) : 0
  const notional = Math.max(0, req.qty) * (basis || st?.last || 0)
  const fees = cumulativeFees(e, req.side, notional)
  const freeze = isBuySide(req.side) ? Math.ceil(req.qty * basis * (1 + feeRate(e, req.side))) + e.rules.fees.minCommission : 0
  const avail = availableCash(e)
  const perShare = Math.max(1, basis * (1 + feeRate(e, req.side)))
  let maxQty = 0
  if (req.side === 'buy') {
    const budget = e.w.account.marginEnabled ? Math.min(buyingPower(e), avail + buyingPower(e)) : avail
    maxQty = Math.max(0, Math.floor((budget - e.rules.fees.minCommission) / perShare / lot) * lot)
  } else if (req.side === 'sell') maxQty = sellableQty(e, req.symbol)
  else if (req.side === 'cover') maxQty = coverableQty(e, req.symbol)
  else if (req.side === 'short') maxQty = Math.max(0, Math.floor(Math.min(buyingPower(e) / Math.max(1, st?.last ?? 1), st?.borrowAvailable ?? 0) / lot) * lot)
  // 滑点估算：按当前盘口逐档推算
  let slip: [number, number] = [0, 0]
  if (st && (req.type === 'market' || req.type === 'stop')) {
    const levels = isBuySide(req.side) ? st.book.asks : st.book.bids
    let rem = req.qty
    let cost = 0
    let filled = 0
    for (const lv of levels) {
      const q = Math.min(rem, lv.qty)
      cost += q * lv.price
      filled += q
      rem -= q
      if (rem <= 0) break
    }
    const mid = ((st.book.bids[0]?.price ?? st.last) + (st.book.asks[0]?.price ?? st.last)) / 2
    const avg = filled ? cost / filled : mid
    const s = Math.abs(avg - mid) / mid
    slip = [s * 0.6, s * 1.6 + (rem > 0 ? 0.01 : 0)]
    if (rem > 0) warnings.push(`当前五档深度不足以一次性成交 ${fmtQty(req.qty)} 股，可能部分成交并产生更大滑点。`)
  }
  if (st) {
    const c = e.tmpl[req.symbol]
    const eq = equity(e)
    if (eq > 0 && notional / eq > 0.3 && (req.side === 'buy' || req.side === 'short')) warnings.push(`本单约占账户净值 ${((notional / eq) * 100).toFixed(1)}%，仓位集中度较高。`)
    if (c.liquidityTier >= 4) warnings.push('该股流动性偏弱，价差与冲击成本可能较大。')
    if (st.book.spreadTicks * e.rules.tickSize / Math.max(1, st.last) > 0.004) warnings.push('当前买卖价差较宽。')
    if (st.last >= st.limitUp && e.rules.priceLimit.enabled) warnings.push('该股处于涨停价，卖盘稀少，买单可能难以成交。')
    if (st.last <= st.limitDown && e.rules.priceLimit.enabled) warnings.push('该股处于跌停价，买盘稀少，卖单可能难以成交。')
    if (st.nextEarningsDay - e.w.clock.tradingDay <= 2 && st.nextEarningsDay >= e.w.clock.tradingDay) warnings.push('该公司即将发布财报，价格可能出现较大波动。')
    if (st.riskWarning) warnings.push('该股处于风险警示状态。')
    if (st.status === 'delisting') warnings.push('该股处于退市整理期，最终可能按很低的价值结算。')
    if (req.type === 'stop' || req.type === 'stopLimit') warnings.push('止损单触发后按市场可得价格成交，跳空时成交价可能显著偏离触发价；止损限价单则可能无法成交。')
    if (req.side === 'short') warnings.push('卖空的潜在亏损理论上没有上限，且需支付借券费用与期间股息。')
  }
  const res: OrderEstimate = {
    basis,
    notional,
    fees,
    freeze,
    maxQty,
    sellable: sellableQty(e, req.symbol),
    locked: lockedQty(e, req.symbol),
    coverable: coverableQty(e, req.symbol),
    available: avail,
    slippageRange: slip,
    warnings,
  }
  if (req.side === 'sell' || req.side === 'short') res.netProceeds = notional - fees.total
  const err = validate(e, req)
  if (err) res.error = err.error
  return res
}

function validate(e: Engine, req: Omit<OrderRequest, 'clientKey'>): { error: string; suggestion?: string } | null {
  const r = e.rules
  const st = e.w.stocks[req.symbol]
  if (!st) return { error: '股票代码不存在' }
  if (st.status === 'delisted') return { error: '股票已退市，无法交易', suggestion: '可在「公司行动」查看退市结算记录。' }
  if (st.status === 'suspended') return { error: '股票停牌中，暂停交易', suggestion: '停牌期间可查看公告，复牌后再下单，并注意复牌跳空风险。' }
  if (!r.orderTypes.includes(req.type)) return { error: '该订单类型在当前市场不可用' }
  if (req.source !== 'system' && (req.type === 'stop' || req.type === 'stopLimit') && !e.isUnlocked('stopOrders'))
    return { error: '止损类订单尚未解锁', suggestion: '完成更多任务提升等级，或在设置中解锁全部工具。' }
  const phase = e.phase
  const allowed = r.phaseOrderTypes[phase] ?? []
  if (!allowed.includes(req.type)) {
    if (req.type === 'market') return { error: phase === 'closed' || phase === 'postclose' || phase === 'break' || phase === 'preopen' ? '市场休市或未开盘，市价单不可提交' : '当前阶段不接受市价单', suggestion: '可改用限价单，在下一交易时段生效。' }
    return { error: `当前阶段（${e.phaseLabel}）不接受${ORDER_TYPE_LABEL[req.type]}` }
  }
  if (!r.tifs.includes(req.tif)) return { error: '订单有效期类型不可用' }
  if (req.tif === 'IOC' && phase !== 'continuous' && !(phase === 'closing' && !r.sessions.closingAuction))
    return { error: '「立即成交剩余撤销」仅在连续交易时段可用' }
  if (req.tif === 'IOC' && (req.type === 'stop' || req.type === 'stopLimit')) return { error: '止损类订单不支持 IOC' }
  if (!Number.isInteger(req.qty) || req.qty <= 0) return { error: '数量必须为正整数' }
  const lot = r.lotSize
  if (req.side === 'buy' || req.side === 'short' || req.side === 'cover') {
    if (req.qty % lot !== 0 && !(req.side === 'cover' && req.qty === coverableQty(e, req.symbol)))
      return { error: `数量不符合最小交易单位（${lot} 股的整数倍）`, suggestion: `可调整为 ${Math.max(lot, Math.floor(req.qty / lot) * lot)} 股。` }
  }
  if (req.side === 'sell' && req.qty % lot !== 0) {
    const s = sellableQty(e, req.symbol)
    if (!(r.oddLotSellAllowed && req.qty === s)) return { error: `卖出数量须为 ${lot} 股整数倍，零股需一次性全部卖出`, suggestion: `可卖 ${fmtQty(s)} 股。` }
  }
  const tick = r.tickSize
  for (const [k, v] of [
    ['限价', req.limitPrice],
    ['触发价', req.stopPrice],
  ] as const) {
    if (v === undefined) continue
    if (!Number.isFinite(v) || v <= 0) return { error: `${k}无效` }
    if (Math.round(v) % tick !== 0) return { error: `${k}不符合最小价格变动单位（${fmtPrice(tick)}）` }
  }
  if ((req.type === 'limit' || req.type === 'stopLimit') && req.limitPrice === undefined) return { error: '请填写限价' }
  if ((req.type === 'stop' || req.type === 'stopLimit') && req.stopPrice === undefined) return { error: '请填写触发价' }
  if (r.priceLimit.enabled && req.limitPrice !== undefined && (req.limitPrice > st.limitUp || req.limitPrice < st.limitDown) && st.last > 0) {
    // 休市阶段提交的次日订单，以次日涨跌停价为准；此处按当前已知价格区间检查
    return { error: `价格超出涨跌幅限制（${fmtPrice(st.limitDown)} ~ ${fmtPrice(st.limitUp)}）`, suggestion: '调整限价至允许区间内。' }
  }
  if (req.stopPrice !== undefined) {
    if (isBuySide(req.side) && req.stopPrice <= st.last) return { error: '买入方向止损单的触发价应高于最新价', suggestion: '触发价低于现价会立即触发，可直接使用限价单。' }
    if (!isBuySide(req.side) && req.stopPrice >= st.last) return { error: '卖出方向止损单的触发价应低于最新价', suggestion: '若想立即卖出可使用市价单或限价单。' }
  }
  const a = e.w.account
  if (req.side === 'short' || req.side === 'cover') {
    if (!a.marginEnabled || !r.margin.enabled || !r.shortSelling.enabled) return { error: '卖空需开启进阶模式（保证金账户），且市场规则允许卖空' }
  }
  if (req.side === 'buy') {
    const p = a.positions[req.symbol]
    if (p && p.qty < 0) return { error: '该股票存在空头持仓，请使用「买入平空」', suggestion: '平空后再开多头仓位。' }
    const need = Math.ceil(req.qty * basisPrice(e, st, req) * (1 + feeRate(e, req.side))) + r.fees.minCommission
    if (a.marginEnabled) {
      if (need > buyingPower(e))
        return { error: `购买力不足（需 ${fmtMoney(need)}，购买力 ${fmtMoney(buyingPower(e))}）` }
    } else if (need > availableCash(e)) {
      return { error: `可用现金不足（需冻结 ${fmtMoney(need)}，可用 ${fmtMoney(availableCash(e))}）`, suggestion: '减少数量，或撤销其他未成交买单释放冻结资金。' }
    }
  }
  if (req.side === 'sell') {
    const p = a.positions[req.symbol]
    if (!p || p.qty <= 0) return { error: '持仓不足：未持有该股票' }
    const s = sellableQty(e, req.symbol)
    if (req.qty > s) {
      const locked = lockedQty(e, req.symbol)
      return {
        error: `可卖数量不足（可卖 ${fmtQty(s)} 股${locked ? `；${fmtQty(locked)} 股为未到可卖日的新买入股份（${r.settlement.label}）` : ''}${p.frozenQty ? `；${fmtQty(p.frozenQty)} 股被其他卖单占用` : ''}）`,
        suggestion: '可等待交收后再卖出，或撤销占用持仓的其他挂单。',
      }
    }
  }
  if (req.side === 'short') {
    const p = a.positions[req.symbol]
    if (p && p.qty > 0) return { error: '持有该股多头时不能卖空，请先卖出多头' }
    if (req.qty > st.borrowAvailable) return { error: `可借券数量不足（可借 ${fmtQty(st.borrowAvailable)} 股）` }
    if (req.qty * st.last > buyingPower(e)) return { error: `保证金不足（卖空需初始保证金，购买力 ${fmtMoney(buyingPower(e))}）` }
  }
  if (req.side === 'cover') {
    if (req.qty > coverableQty(e, req.symbol)) return { error: `可平空数量不足（可平 ${fmtQty(coverableQty(e, req.symbol))} 股）` }
  }
  if (req.source !== 'system' && (req.side === 'buy' || req.side === 'short')) {
    const eq = equity(e)
    const lim = Math.min(r.riskLimit.maxOrderPctOfEquity, e.settings.maxOrderPct ?? 1) * (a.marginEnabled ? 1 / r.margin.initialMargin : 1)
    const notional = req.qty * basisPrice(e, st, req)
    if (eq > 0 && notional > eq * lim + 1) return { error: `超过单笔风险限额（单笔不超过净值的 ${(lim * 100).toFixed(0)}%）`, suggestion: '可分批下单，或在设置中调整风险限额。' }
  }
  return null
}

export function submitOrder(e: Engine, req: OrderRequest): SubmitResult {
  // 幂等：同一提交请求只生成一张订单
  const existed = e.w.idempotency[req.clientKey]
  if (existed) {
    const o = e.w.orders.find((x) => x.id === existed)
    return { ok: o ? o.status !== 'rejected' : false, order: o, duplicate: true, error: o?.rejectReason }
  }
  const st = e.w.stocks[req.symbol]
  const td = e.w.clock.tradingDay
  const phase = e.phase
  const afterClose = phase === 'postclose' || (phase === 'closed' && e.w.clock.tradingDay > 0 && e.isAfterSessionToday())
  const effectiveDay = afterClose ? td + 1 : Math.max(td, 1)
  const mid = st ? ((st.book.bids[0]?.price ?? st.last) + (st.book.asks[0]?.price ?? st.last)) / 2 : 0
  const o: Order = {
    id: e.nextId('O'),
    clientKey: req.clientKey,
    symbol: req.symbol,
    side: req.side,
    type: req.type,
    tif: req.tif,
    qty: req.qty,
    limitPrice: req.limitPrice,
    stopPrice: req.stopPrice,
    status: 'new',
    filledQty: 0,
    avgFillPrice: 0,
    fees: 0,
    frozenCash: 0,
    frozenInitial: 0,
    frozenPerShare: 0,
    triggered: false,
    createdAt: e.w.clock.time,
    createdDay: td,
    expireDay: req.tif === 'GTC' ? effectiveDay + e.rules.maxGtcDays - 1 : effectiveDay,
    updatedAt: e.w.clock.time,
    history: [{ ts: e.w.clock.time, from: null, to: 'new', reason: '订单已创建', filledQty: 0, remainingQty: req.qty, fees: 0 }],
    planId: req.planId,
    snapshot: {
      last: st?.last ?? 0,
      bid: st?.book.bids[0]?.price ?? 0,
      ask: st?.book.asks[0]?.price ?? 0,
      index: e.w.indices.PXC.value,
      news: e.w.news.filter((n) => n.symbols.includes(req.symbol) || n.importance >= 3).slice(-3).map((n) => n.title),
      equity: equity(e),
      positionQty: e.w.account.positions[req.symbol]?.qty ?? 0,
    },
    arrivalMid: mid,
    forced: req.forced,
    source: req.source ?? 'player',
  }
  e.w.orders.push(o)
  e.w.idempotency[req.clientKey] = o.id
  e.w.commandLog.push({ ts: e.w.clock.time, cmd: 'submitOrder', args: { ...req } })
  transition(e, o, 'pendingSubmit', '提交至模拟交易引擎')
  const stats = e.w.stats
  if (o.source === 'player') {
    stats.ordersSubmitted++
    if (o.type === 'market') stats.marketOrders++
    if (o.type === 'limit') stats.limitOrders++
    if (o.type === 'stop') stats.stopOrders++
    if (o.type === 'stopLimit') stats.stopLimitOrders++
  }
  const err = req.forced ? null : validate(e, req)
  if (err) {
    o.rejectReason = err.error
    transition(e, o, 'rejected', err.error + (err.suggestion ? `（建议：${err.suggestion}）` : ''))
    if (o.source === 'player') stats.ordersRejected++
    e.debug('order', `拒单 ${o.id} ${req.symbol} ${err.error}`)
    return { ok: false, order: o, error: err.error, suggestion: err.suggestion }
  }
  // 冻结
  if (isBuySide(o.side)) {
    const basis = basisPrice(e, st, o)
    o.frozenPerShare = basis * (1 + feeRate(e, o.side))
    const freeze = Math.ceil(o.qty * o.frozenPerShare) + e.rules.fees.minCommission
    o.frozenCash = freeze
    o.frozenInitial = freeze
    ledger(e, 'freeze', 0, `${SIDE_LABEL[o.side]}挂单冻结资金`, { symbol: o.symbol, orderId: o.id, frozenDelta: freeze })
    if (o.side === 'cover') e.ensurePosition(o.symbol).frozenQty += o.qty
  } else {
    let p = e.w.account.positions[o.symbol]
    if (!p && o.side === 'short') p = e.ensurePosition(o.symbol)
    const sd = o.side as OrderSide
    if (p && (sd === 'sell' || sd === 'cover')) p.frozenQty += o.qty
  }
  const waitNote = phase === 'continuous' || (phase === 'closing' && !e.rules.sessions.closingAuction) ? '' : `（当前${e.phaseLabel}，将在${afterClose ? '下一交易日' : '下一可撮合时段'}处理）`
  transition(e, o, 'accepted', `订单已接受，${o.type === 'stop' || o.type === 'stopLimit' ? '等待触发' : '等待撮合'}${waitNote}`)
  if (o.source === 'player') stats.ordersAccepted++
  if (o.type === 'stop' || o.type === 'stopLimit') transition(e, o, 'waitingTrigger', `等待最新价${isBuySide(o.side) ? '≥' : '≤'} ${fmtPrice(o.stopPrice)} 触发`)
  if (o.planId) {
    const plan = e.w.plans.find((p) => p.id === o.planId)
    if (plan) {
      plan.linkedOrderIds.push(o.id)
      stats.tradesWithPlan++
    }
  }
  e.debug('order', `接受 ${o.id} ${SIDE_LABEL[o.side]} ${o.symbol} ${o.qty} ${ORDER_TYPE_LABEL[o.type]} 限价${fmtPrice(o.limitPrice)} 触发${fmtPrice(o.stopPrice)}`)
  // 连续交易时段立即尝试撮合
  if (o.status === 'accepted' && (phase === 'continuous' || (phase === 'closing' && !e.rules.sessions.closingAuction))) {
    matchOrder(e, o, st, true)
    if (o.tif === 'IOC' && isOpen(o)) finishRemainder(e, o, 'cancelled', 'IOC 订单未成交部分自动撤销')
  }
  e.markDirty()
  return { ok: true, order: o }
}

// ---------------------------------------------------------------------------
// 撤单
// ---------------------------------------------------------------------------
export function cancelOrder(e: Engine, id: string, reason = '用户撤单'): { ok: boolean; message: string } {
  const o = e.w.orders.find((x) => x.id === id)
  if (!o) return { ok: false, message: '订单不存在' }
  if (o.status === 'filled') return { ok: false, message: '订单已全部成交，无法撤销' }
  if (o.status === 'cancelled' || o.status === 'rejected' || o.status === 'expired') return { ok: false, message: `订单已结束（${STATUS_LABEL[o.status]}），无需撤销` }
  if (o.status === 'cancelPending') return { ok: true, message: '撤单请求已在处理中' }
  e.w.commandLog.push({ ts: e.w.clock.time, cmd: 'cancelOrder', args: { id } })
  transition(e, o, 'cancelPending', reason + '：撤单请求已提交')
  // 撮合时段：撤单在下一时间步撮合之前处理（顺序规则：先撤单、后撮合）
  const active = e.phase === 'continuous' || e.phase === 'opening' || e.phase === 'closing'
  if (!active || !e.running) processCancel(e, o, reason)
  e.markDirty()
  return { ok: true, message: (o.status as OrderStatus) === 'cancelled' ? '订单已撤销' : '撤单中，将在下一撮合步之前处理' }
}

export function processCancel(e: Engine, o: Order, reason = '用户撤单') {
  if (o.status !== 'cancelPending') return
  finishRemainder(e, o, 'cancelled', `${reason}${o.filledQty ? `，已成交 ${fmtQty(o.filledQty)} 股保留` : ''}，未成交部分解除冻结`)
  if (o.source === 'player') e.w.stats.ordersCancelled++
}

/** 结束订单剩余部分：解冻资金或持仓 */
export function finishRemainder(e: Engine, o: Order, to: OrderStatus, reason: string) {
  if (o.frozenCash > 0) {
    const amt = o.frozenCash
    o.frozenCash = 0
    ledger(e, 'unfreeze', 0, `订单结束解冻：${reason}`, { symbol: o.symbol, orderId: o.id, frozenDelta: -amt })
  }
  if (!isBuySide(o.side) || o.side === 'cover') {
    const p = e.w.account.positions[o.symbol]
    const rem = o.qty - o.filledQty
    if (p && (o.side === 'sell' || o.side === 'cover')) p.frozenQty = Math.max(0, p.frozenQty - rem)
  }
  transition(e, o, to, reason)
  if (to === 'expired' && o.source === 'player') e.w.stats.ordersExpired++
  e.onOrderFinished(o)
  e.cleanupPosition(o.symbol)
}

// ---------------------------------------------------------------------------
// 成交
// ---------------------------------------------------------------------------
export function applyFill(e: Engine, o: Order, qty: number, price: Cents, liquidity: Execution['liquidity']) {
  if (qty <= 0) return
  const a = e.w.account
  const td = e.w.clock.tradingDay
  const st = e.w.stocks[o.symbol]
  const prevValue = Math.round(o.avgFillPrice * o.filledQty)
  const value = qty * price
  const cumBefore = cumulativeFees(e, o.side, prevValue)
  const cumAfter = cumulativeFees(e, o.side, prevValue + value)
  const fee = {
    commission: cumAfter.commission - cumBefore.commission,
    exchangeFee: cumAfter.exchangeFee - cumBefore.exchangeFee,
    regulatoryFee: cumAfter.regulatoryFee - cumBefore.regulatoryFee,
    stampTax: cumAfter.stampTax - cumBefore.stampTax,
    transferFee: cumAfter.transferFee - cumBefore.transferFee,
  }
  const totalFee = fee.commission + fee.exchangeFee + fee.regulatoryFee + fee.stampTax + fee.transferFee
  const ref = o.triggerPrice ?? o.arrivalMid
  const slippage = ref > 0 ? (isBuySide(o.side) ? price - ref : ref - price) : 0
  const exec: Execution = {
    id: e.nextId('E'),
    orderId: o.id,
    ts: e.w.clock.time,
    tradingDay: td,
    symbol: o.symbol,
    side: o.side,
    qty,
    price,
    value,
    ...fee,
    totalFee,
    liquidity,
    slippage,
    feeVersion: e.rules.fees.version,
  }
  const p = e.ensurePosition(o.symbol)
  if (p.qty === 0) p.openedDay = td
  const nonTaxFee = totalFee - fee.stampTax
  if (o.side === 'buy') {
    // 解冻按比例释放
    const release = Math.min(o.frozenCash, Math.round((o.frozenInitial * qty) / o.qty) + (o.filledQty + qty >= o.qty ? o.frozenCash : 0))
    if (release > 0) {
      o.frozenCash -= release
      ledger(e, 'unfreeze', 0, '成交解冻', { symbol: o.symbol, orderId: o.id, frozenDelta: -release })
    }
    ledger(e, 'buy', -value, `买入 ${o.symbol} ${fmtQty(qty)} 股 @ ${fmtPrice(price)}`, { symbol: o.symbol, orderId: o.id, execId: exec.id })
    if (totalFee) ledger(e, 'fee', -totalFee, `买入费用（佣金 ${fmtMoney(fee.commission)}、其他 ${fmtMoney(totalFee - fee.commission)}）`, { symbol: o.symbol, orderId: o.id, execId: exec.id })
    p.qty += qty
    p.costBasis += value + totalFee
    p.lots.push({ qty, sellableDay: td + e.rules.settlement.sharesSellableAfterDays })
  } else if (o.side === 'sell') {
    const avg = p.costBasis / p.qty
    const costOut = Math.round(avg * qty)
    const realized = value - totalFee - costOut
    ledger(e, 'sell', value, `卖出 ${o.symbol} ${fmtQty(qty)} 股 @ ${fmtPrice(price)}`, { symbol: o.symbol, orderId: o.id, execId: exec.id })
    if (nonTaxFee) ledger(e, 'fee', -nonTaxFee, '卖出费用（佣金、经手费、监管费、过户费）', { symbol: o.symbol, orderId: o.id, execId: exec.id })
    if (fee.stampTax) ledger(e, 'tax', -fee.stampTax, '卖出印花税', { symbol: o.symbol, orderId: o.id, execId: exec.id })
    p.qty -= qty
    p.costBasis -= costOut
    p.frozenQty = Math.max(0, p.frozenQty - qty)
    p.realizedPnl += realized
    a.realizedTotal += realized
    exec.realizedPnl = realized
    // 先进先出消耗可卖批次
    let rem = qty
    for (const lot of p.lots) {
      if (rem <= 0) break
      if (lot.sellableDay > td) continue
      const q = Math.min(lot.qty, rem)
      lot.qty -= q
      rem -= q
    }
    p.lots = p.lots.filter((l) => l.qty > 0)
  } else if (o.side === 'short') {
    ledger(e, 'shortSell', value, `卖空 ${o.symbol} ${fmtQty(qty)} 股 @ ${fmtPrice(price)}`, { symbol: o.symbol, orderId: o.id, execId: exec.id })
    if (nonTaxFee) ledger(e, 'fee', -nonTaxFee, '卖空费用', { symbol: o.symbol, orderId: o.id, execId: exec.id })
    if (fee.stampTax) ledger(e, 'tax', -fee.stampTax, '卖出印花税', { symbol: o.symbol, orderId: o.id, execId: exec.id })
    p.qty -= qty
    p.costBasis += value - totalFee
    st.borrowAvailable = Math.max(0, st.borrowAvailable - qty)
    e.w.stats.shortsOpened++
  } else {
    // cover
    const release = Math.min(o.frozenCash, Math.round((o.frozenInitial * qty) / o.qty) + (o.filledQty + qty >= o.qty ? o.frozenCash : 0))
    if (release > 0) {
      o.frozenCash -= release
      ledger(e, 'unfreeze', 0, '成交解冻', { symbol: o.symbol, orderId: o.id, frozenDelta: -release })
    }
    const avgCredit = p.costBasis / -p.qty
    const creditOut = Math.round(avgCredit * qty)
    const realized = creditOut - value - totalFee
    ledger(e, 'cover', -value, `买入平空 ${o.symbol} ${fmtQty(qty)} 股 @ ${fmtPrice(price)}`, { symbol: o.symbol, orderId: o.id, execId: exec.id })
    if (totalFee) ledger(e, 'fee', -totalFee, '平空费用', { symbol: o.symbol, orderId: o.id, execId: exec.id })
    p.qty += qty
    p.costBasis -= creditOut
    p.frozenQty = Math.max(0, p.frozenQty - qty)
    p.realizedPnl += realized
    a.realizedTotal += realized
    exec.realizedPnl = realized
    st.borrowAvailable += qty
  }
  p.feesPaid += totalFee
  a.feesTotal += totalFee
  a.dayFees += totalFee
  o.avgFillPrice = (o.avgFillPrice * o.filledQty + price * qty) / (o.filledQty + qty)
  o.filledQty += qty
  o.fees += totalFee
  e.w.executions.push(exec)
  st.tape.push({ t: e.w.clock.time, price, qty, side: isBuySide(o.side) ? 'B' : 'S', player: true })
  st.volume += qty
  st.amount += value
  const stats = e.w.stats
  if (o.source === 'player') {
    stats.fills++
    stats.feesPaid += totalFee
    if (isBuySide(o.side)) stats.buys++
    else stats.sells++
  }
  const wasPartial = o.status === 'partiallyFilled'
  const done = o.filledQty >= o.qty
  transition(e, o, done ? 'filled' : 'partiallyFilled', `${liquidity === 'auction' ? '集合竞价' : liquidity === 'maker' ? '挂单被动' : '主动'}成交 ${fmtQty(qty)} 股 @ ${fmtPrice(price)}，费用 ${fmtMoney(totalFee)}`, totalFee)
  if (!done && !wasPartial && o.source === 'player') stats.partialFills++
  e.debug('match', `成交 ${o.id} ${o.symbol} ${qty}@${fmtPrice(price)} ${liquidity} 滑点${slippage.toFixed(1)}分`)
  e.emit({ type: 'fill', order: o, exec })
  if (done) {
    if (o.source === 'player') {
      stats.ordersFilled++
      if (o.type === 'limit') stats.limitFilled++
      if (o.type === 'market') stats.marketFilled++
      if (o.qty * o.avgFillPrice < 500000) stats.smallTrades++
    }
    if (o.type === 'stop' && o.triggerPrice && Math.abs(o.avgFillPrice - o.triggerPrice) / o.triggerPrice >= 0.01) stats.stopGapFills++
    e.onOrderFinished(o)
    e.cleanupPosition(o.symbol)
  }
  e.markDirty(true)
}

// ---------------------------------------------------------------------------
// 撮合
// ---------------------------------------------------------------------------
function effectiveLimit(e: Engine, o: Order, st: StockState): Cents {
  if (o.type === 'limit' || o.type === 'stopLimit') return o.limitPrice!
  // 市价/止损市价：保护价（且买单不超过冻结基准价）
  const ref = o.triggerPrice ?? st.last
  const prot = protectPrice(e, st, o.side, ref)
  if (isBuySide(o.side) && o.frozenPerShare > 0) {
    const cap = Math.floor(o.frozenPerShare / (1 + feeRate(e, o.side)))
    return Math.min(prot, cap)
  }
  return prot
}

/** 连续交易撮合：先主动吃盘口，剩余限价单按本分钟价格区间估算被动成交 */
export function matchOrder(e: Engine, o: Order, st: StockState, immediate: boolean) {
  if (!(o.status === 'accepted' || o.status === 'partiallyFilled')) return
  if (st.status === 'suspended' || st.status === 'delisted') return
  const buy = isBuySide(o.side)
  const lim = effectiveLimit(e, o, st)
  const levels = buy ? st.book.asks : st.book.bids
  for (const lv of levels) {
    if (o.filledQty >= o.qty) break
    if (lv.qty <= 0) continue
    if (buy ? lv.price > lim : lv.price < lim) break
    let q = Math.min(lv.qty, o.qty - o.filledQty)
    if (o.side === 'buy') q = affordable(e, o, q, lv.price)
    if (q <= 0) break
    lv.qty -= q
    applyFill(e, o, q, lv.price, 'taker')
    const stt = o.status as OrderStatus
    if (!(stt === 'partiallyFilled' || stt === 'filled')) break
  }
  if (!(o.status === 'accepted' || o.status === 'partiallyFilled')) return
  // 被动成交（仅限价单，非本次提交的即时撮合）
  if (!immediate && (o.type === 'limit' || o.type === 'stopLimit')) {
    const bar = st.minute[st.minute.length - 1]
    if (!bar || bar.t !== e.w.clock.time) return
    const used = e.tmp.passiveUsed[st.symbol] ?? 0
    const cap = Math.max(0, bar.v * 0.3 - used)
    let ratio = 0
    if (buy ? bar.l < lim : bar.h > lim) ratio = e.rng.book.range(0.1, 0.3)
    else if (buy ? bar.l === lim : bar.h === lim) ratio = e.rng.book.range(0.02, 0.08)
    if (ratio <= 0) return
    const lot = e.rules.lotSize
    let q = Math.min(o.qty - o.filledQty, Math.floor((Math.min(cap, bar.v * ratio)) / lot) * lot)
    if (o.side === 'sell' && o.qty - o.filledQty < lot) q = o.qty - o.filledQty
    if (q <= 0) return
    e.tmp.passiveUsed[st.symbol] = used + q
    applyFill(e, o, q, lim, 'maker')
  }
  // 市价单剩余部分处理
  if ((o.type === 'market' || (o.type === 'stop' && o.triggered)) && (o.status === 'accepted' || o.status === 'partiallyFilled') && e.rules.marketRemainder === 'cancel') {
    finishRemainder(e, o, 'cancelled', o.filledQty ? '市价单剩余部分自动撤销（五档内无更多可成交对手盘）' : '市价单无可成交对手盘（保护价范围内），已自动撤销')
  }
}

function affordable(e: Engine, o: Order, q: number, price: Cents): number {
  // 冻结资金已覆盖保护价；此处再做一次保守校验，防止异常
  const lot = e.rules.lotSize
  const cost = (n: number) => n * price * (1 + feeRate(e, o.side)) + e.rules.fees.minCommission
  if (e.w.account.marginEnabled) return q
  const budget = o.frozenCash + availableCash(e)
  while (q > 0 && cost(q) > budget) q -= lot
  return Math.max(0, q)
}

/** 检查止损触发 */
export function checkTriggers(e: Engine, st: StockState, price: Cents) {
  for (const o of e.w.orders) {
    if (o.symbol !== st.symbol || o.status !== 'waitingTrigger') continue
    const hit = isBuySide(o.side) ? price >= o.stopPrice! : price <= o.stopPrice!
    if (!hit) continue
    o.triggered = true
    o.triggerPrice = o.stopPrice
    transition(e, o, 'accepted', `最新价 ${fmtPrice(price)} 触及触发价 ${fmtPrice(o.stopPrice)}，转为${o.type === 'stop' ? '市价单' : `限价 ${fmtPrice(o.limitPrice)} 的限价单`}`)
    if (o.source === 'player') {
      if (o.type === 'stop') e.w.stats.stopTriggered++
      else e.w.stats.stopLimitTriggered++
    }
    e.notice('info', `止损单已触发 · ${o.symbol}`, `${o.id} 在 ${fmtPrice(price)} 触发（触发价 ${fmtPrice(o.stopPrice)}），按${o.type === 'stop' ? '市价' : '限价'}继续撮合。`, o.symbol)
  }
}

/** 集合竞价：所有可成交订单以统一价格成交，受竞价深度约束 */
export function auctionMatch(e: Engine, st: StockState, price: Cents, kind: 'open' | 'close') {
  const rb = e.rng.book
  let buyDepth = Math.round(st.adv * (kind === 'open' ? 0.025 : 0.03) * rb.range(0.5, 1.5))
  let sellDepth = Math.round(st.adv * (kind === 'open' ? 0.025 : 0.03) * rb.range(0.5, 1.5))
  if (e.rules.priceLimit.enabled && price >= st.limitUp) buyDepth = Math.round(buyDepth * 0.05)
  if (e.rules.priceLimit.enabled && price <= st.limitDown) sellDepth = Math.round(sellDepth * 0.05)
  checkTriggers(e, st, price)
  const lot = e.rules.lotSize
  const orders = e.w.orders
    .filter((o) => o.symbol === st.symbol && (o.status === 'accepted' || o.status === 'partiallyFilled'))
    .sort((a, b) => priority(b) - priority(a) || a.createdAt - b.createdAt)
  for (const o of orders) {
    const buy = isBuySide(o.side)
    const lim = o.type === 'market' || o.type === 'stop' ? (buy ? Infinity : 0) : o.limitPrice!
    if (buy ? price > lim : price < lim) continue
    if (buy && o.frozenPerShare > 0 && price * (1 + feeRate(e, o.side)) > o.frozenPerShare + 1e-6) continue
    const depth = buy ? sellDepth : buyDepth
    let q = Math.min(o.qty - o.filledQty, Math.floor(depth / lot) * lot)
    if (!buy && o.qty - o.filledQty < lot) q = o.qty - o.filledQty
    if (o.side === 'buy') q = affordable(e, o, q, price)
    if (q <= 0) continue
    if (buy) sellDepth -= q
    else buyDepth -= q
    applyFill(e, o, q, price, 'auction')
  }
}

function priority(o: Order): number {
  if (o.type === 'market' || (o.type === 'stop' && o.triggered)) return 1e12
  return isBuySide(o.side) ? o.limitPrice ?? 0 : 1e11 - (o.limitPrice ?? 0)
}

/** 本步撮合该股票的所有挂单（价格优先、时间优先） */
export function matchStock(e: Engine, st: StockState) {
  checkTriggers(e, st, st.last)
  const orders = e.w.orders
    .filter((o) => o.symbol === st.symbol && (o.status === 'accepted' || o.status === 'partiallyFilled') && o.createdDay <= e.w.clock.tradingDay && o.expireDay >= e.w.clock.tradingDay)
    .sort((a, b) => priority(b) - priority(a) || a.createdAt - b.createdAt)
  for (const o of orders) matchOrder(e, o, st, false)
}

export function expireOrders(e: Engine) {
  const td = e.w.clock.tradingDay
  for (const o of e.w.orders) {
    if (!isOpen(o)) continue
    if (o.status === 'cancelPending') {
      processCancel(e, o)
      continue
    }
    if (o.expireDay <= td) {
      finishRemainder(e, o, 'expired', o.tif === 'GTC' ? `撤销前有效订单已达最长有效期（${e.rules.maxGtcDays} 个交易日）` : '当日有效订单收盘未全部成交，剩余部分自动失效')
    }
  }
}

export function cancelOpenOrdersFor(e: Engine, sym: string, reason: string) {
  for (const o of e.w.orders) {
    if (o.symbol !== sym || !isOpen(o)) continue
    if (o.status !== 'cancelPending') transition(e, o, 'cancelPending', reason)
    finishRemainder(e, o, 'cancelled', reason)
  }
}

// ---------------------------------------------------------------------------
// 保证金
// ---------------------------------------------------------------------------
export function checkMargin(e: Engine, endOfDay: boolean) {
  const a = e.w.account
  if (!a.marginEnabled) return
  const g = grossExposure(e)
  const m = e.rules.margin
  if (g <= 0) {
    if (a.marginCall) {
      a.marginCall = null
      e.notice('success', '保证金通知已解除', '账户已无杠杆敞口。')
    }
    return
  }
  const eq = equity(e)
  const ratio = eq / g
  const lev = g / Math.max(1, eq)
  e.w.stats.leverageUsedMax = Math.max(e.w.stats.leverageUsedMax, Math.round(lev * 100) / 100)
  const td = e.w.clock.tradingDay
  if (ratio < m.liquidationMargin && e.phase === 'continuous') {
    if (e.w.orders.some((o) => o.forced && isOpen(o))) return
    forceLiquidate(e, `保证金比例 ${(ratio * 100).toFixed(1)}% 低于强制平仓线 ${(m.liquidationMargin * 100).toFixed(0)}%`)
    return
  }
  if (ratio < m.maintenanceMargin) {
    if (!a.marginCall) {
      a.marginCall = { issuedDay: td, deadlineDay: td + m.callGraceDays, deficit: Math.round(m.maintenanceMargin * g - eq) }
      e.w.stats.marginCalls++
      e.notice('danger', '追加保证金通知', `保证金比例 ${(ratio * 100).toFixed(1)}% 低于维持保证金 ${(m.maintenanceMargin * 100).toFixed(0)}%。缺口约 ${fmtMoney(a.marginCall.deficit)}。请在第 ${a.marginCall.deadlineDay} 个交易日收盘前补足（追加资金或减仓），否则将被强制平仓；若跌破 ${(m.liquidationMargin * 100).toFixed(0)}% 将立即强平。`)
      e.emit({ type: 'marginCall' })
    } else {
      a.marginCall.deficit = Math.round(m.maintenanceMargin * g - eq)
      if (endOfDay && td >= a.marginCall.deadlineDay) e.tmp.forceAtOpen = true
    }
  } else if (a.marginCall) {
    a.marginCall = null
    e.notice('success', '保证金通知已解除', `保证金比例已恢复至 ${(ratio * 100).toFixed(1)}%。`)
  }
}

export function forceLiquidate(e: Engine, reason: string) {
  const a = e.w.account
  const m = e.rules.margin
  const target = m.initialMargin * 0.8
  let need = grossExposure(e) - equity(e) / target
  if (need <= 0) return
  e.w.stats.forcedLiquidations++
  e.notice('danger', '强制平仓', `${reason}。系统将按市价减仓，直至保证金比例恢复到约 ${(target * 100).toFixed(0)}%。强平可能以不利价格成交。`)
  const positions = Object.values(a.positions)
    .filter((p) => p.qty !== 0)
    .sort((x, y) => Math.abs(y.qty * markPrice(e, y.symbol)) - Math.abs(x.qty * markPrice(e, x.symbol)))
  for (const p of positions) {
    if (need <= 0) break
    const st = e.w.stocks[p.symbol]
    if (st.status !== 'normal' && st.status !== 'delisting') continue
    cancelOpenOrdersFor(e, p.symbol, '强制平仓前撤销该股票挂单')
    const px = markPrice(e, p.symbol)
    const lot = e.rules.lotSize
    let qty = Math.min(Math.abs(p.qty), Math.ceil(need / Math.max(1, px) / lot) * lot)
    if (p.qty > 0) qty = Math.min(qty, sellableQty(e, p.symbol))
    if (qty <= 0) continue
    submitOrder(e, { clientKey: e.nextId('FL'), symbol: p.symbol, side: p.qty > 0 ? 'sell' : 'cover', type: 'market', tif: 'DAY', qty, source: 'system', forced: true })
    need -= qty * px
  }
  a.marginCall = null
}

export function positionSummary(e: Engine, p: Position) {
  const px = markPrice(e, p.symbol)
  const mv = p.qty * px
  const unreal = p.qty > 0 ? mv - p.costBasis : p.qty < 0 ? p.costBasis + mv : 0
  const avg = p.qty !== 0 ? p.costBasis / Math.abs(p.qty) : 0
  return { mv, unreal, avg, px }
}
