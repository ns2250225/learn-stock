<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useGame } from '../store/game'
import PixelBanner from '../components/PixelBanner.vue'
import LineChart from '../components/LineChart.vue'
import Chg from '../components/Chg.vue'
import Logo from '../components/Logo.vue'
import Gloss from '../components/Gloss.vue'
import ReviewCard from '../components/ReviewCard.vue'
import { equity, positionSummary, sellableQty, lockedQty, grossExposure, marginRatio, buyingPower, nav, totalReturn, isOpen, longValue, shortValue, cancelOrder } from '../engine/trading'
import { riskSnapshot, sectorWeights, disciplineScore } from '../engine/review'
import { SIDE_LABEL, ORDER_TYPE_LABEL, STATUS_LABEL, TIF_LABEL } from '../engine/rules'
import { SECTOR_MAP } from '../engine/content/sectors'
import { BIAS_TAGS } from '../engine/content/learning'
import { fmtTime, fmtShortDate } from '../engine/clock'
import { fmtMoney, fmtPrice, fmtPct, fmtQty, toCSV, downloadText } from '../engine/util'
import type { LedgerType, OrderStatus } from '../engine/types'
import type { SectorId } from '../engine/types'

const game = useGame()
const TABS = [
  { id: 'overview', label: '资产总览' },
  { id: 'positions', label: '持仓' },
  { id: 'risk', label: '风险面板' },
  { id: 'orders', label: '订单' },
  { id: 'execs', label: '成交' },
  { id: 'ledger', label: '资金流水' },
  { id: 'journal', label: '交易日志' },
] as const
type Tab = (typeof TABS)[number]['id']
const tab = ref<Tab>((TABS.find((t) => t.id === game.pageArg)?.id as Tab) ?? 'overview')
const sym = computed(() => game.engine?.rules.currencySymbol ?? '¥')
const money = (c: number) => fmtMoney(c, sym.value)

watch(
  tab,
  (t) => {
    const e = game.engine
    if (!e) return
    if (t === 'risk') {
      e.setFlag('viewed_risk_panel')
      e.bump('riskPanelViewed')
      if (e.w.account.marginEnabled) e.setFlag('viewed_margin_panel')
      game.after()
    }
  },
  { immediate: true },
)

// ---------------- 总览 ----------------
const sum = computed(() => {
  game.rev
  const e = game.engine!
  const a = e.w.account
  const eq = equity(e)
  let unreal = 0
  for (const p of Object.values(a.positions)) if (p.qty) unreal += positionSummary(e, p).unreal
  return {
    eq,
    cash: a.cash,
    avail: Math.max(0, a.cash - a.frozen),
    frozen: a.frozen,
    mv: longValue(e) - shortValue(e),
    realized: a.realizedTotal,
    unreal,
    ret: totalReturn(e),
    nav: nav(e) / 100,
    fees: a.feesTotal,
    div: a.dividendsTotal,
    interest: a.interestTotal,
    deposits: a.netDeposits,
    dayPnl: eq - a.dayStartEquity,
    maxDD: a.maxDrawdown,
  }
})
const showBench = ref(false)
const curveMode = ref<'nav' | 'equity'>('nav')
const canBench = computed(() => {
  game.rev
  return game.engine?.isUnlocked('benchmark') ?? false
})
function toggleBench() {
  showBench.value = !showBench.value
  if (showBench.value) {
    game.engine?.setFlag('viewed_benchmark')
    game.after()
  }
}
const curve = computed(() => {
  game.rev
  const e = game.engine!
  const a = e.w.account
  const pts = a.equityDaily.map((d) => ({ label: e.cal.short(d.day), eq: d.equity / 100, nav: d.nav, bench: d.bench }))
  const now = { label: '当前', eq: equity(e) / 100, nav: nav(e), bench: e.w.indices.PXC.value }
  if (e.w.clock.tradingDay > 0) pts.push(now)
  if (pts.length === 1) pts.unshift({ label: '期初', eq: a.netDeposits / 100, nav: 100, bench: e.w.indices.PXC.prevClose })
  const series =
    curveMode.value === 'nav'
      ? [{ name: '账户单位净值', color: '#f4c95d', values: pts.map((p) => p.nav) }]
      : [{ name: '账户净值（元）', color: '#f4c95d', values: pts.map((p) => p.eq) }]
  if (showBench.value && canBench.value && curveMode.value === 'nav') series.push({ name: '像素综合指数（基准）', color: '#6fd3e8', values: pts.map((p) => p.bench), dashed: true } as never)
  return { labels: pts.map((p) => p.label), series }
})
const intraday = computed(() => {
  game.rev
  const e = game.engine!
  const d = e.w.account.equityIntraday
  return { labels: d.map((x) => fmtTime(x.t).slice(-5)), series: [{ name: '今日净值', color: '#7bd389', values: d.map((x) => x.equity / 100) }] }
})

const depositAmt = ref(10000)
function doDeposit() {
  const e = game.engine
  if (!e) return
  const r = e.deposit(depositAmt.value)
  game.toast(r.ok ? 'success' : 'danger', r.message)
  game.after()
}

// ---------------- 持仓 ----------------
const positions = computed(() => {
  game.rev
  const e = game.engine!
  const eq = Math.max(1, equity(e))
  const td = e.w.clock.tradingDay
  return Object.values(e.w.account.positions)
    .filter((p) => p.qty !== 0 || p.frozenQty)
    .map((p) => {
      const s = positionSummary(e, p)
      const st = e.w.stocks[p.symbol]
      return {
        p,
        s,
        name: e.tmpl[p.symbol].name,
        sector: e.tmpl[p.symbol].sector,
        sellable: sellableQty(e, p.symbol),
        locked: lockedQty(e, p.symbol),
        weight: s.mv / eq,
        days: td - p.openedDay,
        status: st.status,
        dayChg: st.prevClose ? st.last / st.prevClose - 1 : 0,
      }
    })
    .sort((a, b) => Math.abs(b.s.mv) - Math.abs(a.s.mv))
})
const sectors = computed(() => {
  game.rev
  return sectorWeights(game.engine!)
})
function sectorName(id: string) {
  return SECTOR_MAP[id as SectorId]?.name ?? id
}

// ---------------- 风险 ----------------
const risk = computed(() => {
  game.rev
  const e = game.engine!
  const r = riskSnapshot(e)
  const sw = sectorWeights(e)
  const gross = sw.reduce((s, x) => s + Math.abs(x.value), 0) || 1
  const hhi = sw.reduce((s, x) => s + (Math.abs(x.value) / gross) ** 2, 0)
  const liq = positions.value.map((x) => {
    const st = e.w.stocks[x.p.symbol]
    const days = Math.abs(x.p.qty) / Math.max(1, st.adv * 0.1)
    return { sym: x.p.symbol, name: x.name, days, tier: e.tmpl[x.p.symbol].liquidityTier }
  })
  const a = e.w.account
  const m = e.rules.margin
  return {
    ...r,
    hhi,
    topSector: sw[0],
    liq,
    maxDD: a.maxDrawdown,
    gross: grossExposure(e),
    ratio: marginRatio(e),
    maint: m.maintenanceMargin,
    liqLine: m.liquidationMargin,
    init: m.initialMargin,
    bp: buyingPower(e),
    loan: Math.max(0, -a.cash),
    shorts: Object.values(a.positions)
      .filter((p) => p.qty < 0)
      .map((p) => ({ sym: p.symbol, qty: -p.qty, value: -p.qty * e.w.stocks[p.symbol].last, rate: e.w.stocks[p.symbol].borrowRate })),
    call: a.marginCall,
    marginEnabled: a.marginEnabled,
  }
})

// ---------------- 订单 / 成交 / 流水 ----------------
const q = ref('')
const fStatus = ref<'' | 'open' | OrderStatus>('')
const fSide = ref('')
const fType = ref('')
const fFrom = ref<number | null>(null)
const fTo = ref<number | null>(null)
const fLedger = ref<'' | LedgerType>('')
const showFreeze = ref(false)
const inRange = (d: number) => (fFrom.value === null || d >= fFrom.value) && (fTo.value === null || d <= fTo.value)
const match = (s: string) => !q.value.trim() || s.toLowerCase().includes(q.value.trim().toLowerCase())

const orders = computed(() => {
  game.rev
  const e = game.engine!
  return [...e.w.orders]
    .reverse()
    .filter(
      (o) =>
        (fStatus.value === '' || (fStatus.value === 'open' ? isOpen(o) : o.status === fStatus.value)) &&
        (!fSide.value || o.side === fSide.value) &&
        (!fType.value || o.type === fType.value) &&
        inRange(o.createdDay) &&
        match(`${o.id} ${o.symbol} ${e.tmpl[o.symbol]?.name ?? ''} ${o.rejectReason ?? ''}`),
    )
    .slice(0, 300)
})
const expandedOrder = ref('')
const execs = computed(() => {
  game.rev
  const e = game.engine!
  return [...e.w.executions]
    .reverse()
    .filter((x) => (!fSide.value || x.side === fSide.value) && inRange(x.tradingDay) && match(`${x.id} ${x.orderId} ${x.symbol} ${e.tmpl[x.symbol]?.name ?? ''}`))
    .slice(0, 400)
})
const LEDGER_LABEL: Record<LedgerType, string> = {
  deposit: '入金', buy: '买入', sell: '卖出', fee: '费用', tax: '税费', dividend: '股息', dividendTax: '股息税', dividendPayShort: '空头付息',
  cashInLieu: '零股折现', rightsSubscribe: '配股认购', rightsRefund: '配股退款', delistSettlement: '退市结算', marginInterest: '融资利息',
  borrowFee: '借券费', shortSell: '卖空', cover: '平空', freeze: '冻结', unfreeze: '解冻', settle: '交收', adjustment: '调整',
}
const ledgerRows = computed(() => {
  game.rev
  const e = game.engine!
  return [...e.w.ledger]
    .reverse()
    .filter(
      (l) =>
        (showFreeze.value || fLedger.value === 'freeze' || fLedger.value === 'unfreeze' || (l.type !== 'freeze' && l.type !== 'unfreeze')) &&
        (!fLedger.value || l.type === fLedger.value) &&
        inRange(l.tradingDay) &&
        match(`${l.id} ${l.symbol ?? ''} ${l.orderId ?? ''} ${l.note}`),
    )
    .slice(0, 500)
})
function cancel(id: string) {
  const e = game.engine
  if (!e) return
  const r = cancelOrder(e, id)
  game.toast(r.ok ? 'info' : 'warn', r.message)
  game.after()
}
function exportRows(kind: 'orders' | 'execs' | 'ledger', fmt: 'csv' | 'json') {
  const e = game.engine
  if (!e) return
  const seed = e.w.meta.worldSeed
  let rows: Record<string, unknown>[] = []
  if (kind === 'orders')
    rows = orders.value.map((o) => ({
      订单号: o.id, 代码: o.symbol, 方向: SIDE_LABEL[o.side], 类型: ORDER_TYPE_LABEL[o.type], 有效期: TIF_LABEL[o.tif], 数量: o.qty, 已成交: o.filledQty,
      限价: o.limitPrice ? fmtPrice(o.limitPrice) : '', 触发价: o.stopPrice ? fmtPrice(o.stopPrice) : '', 成交均价: o.filledQty ? (o.avgFillPrice / 100).toFixed(3) : '',
      费用: (o.fees / 100).toFixed(2), 状态: STATUS_LABEL[o.status], 拒单原因: o.rejectReason ?? '', 创建时间: fmtTime(o.createdAt), 交易日: o.createdDay, 来源: o.source,
    }))
  if (kind === 'execs')
    rows = execs.value.map((x) => ({
      成交号: x.id, 订单号: x.orderId, 时间: fmtTime(x.ts), 交易日: x.tradingDay, 代码: x.symbol, 方向: SIDE_LABEL[x.side], 数量: x.qty, 价格: fmtPrice(x.price),
      成交额: (x.value / 100).toFixed(2), 佣金: (x.commission / 100).toFixed(2), 经手费: (x.exchangeFee / 100).toFixed(2), 监管费: (x.regulatoryFee / 100).toFixed(2),
      印花税: (x.stampTax / 100).toFixed(2), 过户费: (x.transferFee / 100).toFixed(2), 费用合计: (x.totalFee / 100).toFixed(2), 流动性: x.liquidity,
      滑点每股: (x.slippage / 100).toFixed(4), 已实现盈亏: x.realizedPnl !== undefined ? (x.realizedPnl / 100).toFixed(2) : '', 费率版本: x.feeVersion,
    }))
  if (kind === 'ledger')
    rows = ledgerRows.value.map((l) => ({
      流水号: l.id, 时间: fmtTime(l.ts), 交易日: l.tradingDay, 类型: LEDGER_LABEL[l.type], 金额: (l.amount / 100).toFixed(2), 现金余额: (l.balanceAfter / 100).toFixed(2),
      冻结余额: (l.frozenAfter / 100).toFixed(2), 代码: l.symbol ?? '', 订单: l.orderId ?? '', 成交: l.execId ?? '', 说明: l.note,
    }))
  const name = `pixel-stock-${kind}-${seed}-D${e.w.clock.tradingDay}`
  if (fmt === 'csv') downloadText(name + '.csv', toCSV(rows), 'text/csv')
  else downloadText(name + '.json', JSON.stringify(rows, null, 2), 'application/json')
  e.bump('exports')
  game.after()
}

// ---------------- 交易日志 ----------------
const pendingReviews = computed(() => {
  game.rev
  return game.engine!.w.reviews.filter((r) => !r.completed).reverse()
})
const doneReviews = computed(() => {
  game.rev
  return game.engine!.w.reviews.filter((r) => r.completed).reverse().slice(0, 30)
})
const plans = computed(() => {
  game.rev
  return [...game.engine!.w.plans].reverse()
})
const summaries = computed(() => {
  game.rev
  return [...game.engine!.w.summaries].reverse().slice(0, 60)
})
const discipline = computed(() => {
  game.rev
  return disciplineScore(game.engine!)
})
function closePlan(id: string) {
  const p = game.engine?.w.plans.find((x) => x.id === id)
  if (p) {
    p.status = p.status === 'active' ? 'closed' : 'active'
    game.engine!.markDirty(true)
    game.after()
  }
}
function exportJournal(fmt: 'json' | 'md') {
  const e = game.engine
  if (!e) return
  const w = e.w
  const name = `pixel-stock-journal-${w.meta.worldSeed}-D${w.clock.tradingDay}`
  if (fmt === 'json') {
    downloadText(name + '.json', JSON.stringify({ note: '像素证券城模拟交易日志（虚构数据）', plans: w.plans, reviews: w.reviews, summaries: w.summaries }, null, 2), 'application/json')
  } else {
    const L: string[] = [`# 像素证券城交易日志`, '', `> 模拟数据，非投资建议。存档：${w.meta.name}，种子 ${w.meta.worldSeed}，交易日 ${w.clock.tradingDay}`, '', '## 交易计划', '']
    for (const p of w.plans) {
      L.push(`### ${p.id} ${p.symbol}（${p.status === 'active' ? '进行中' : '已关闭'}）`, `- 创建：${fmtTime(p.createdAt)}`, `- 理由：${p.reason}`, `- 假设：${p.hypothesis}`, `- 周期：${p.horizon}`, `- 证伪条件：${p.invalidation || '未填写'}`, `- 计划仓位：${fmtPct(p.targetPct, 0, false)}`, `- 关联订单：${p.linkedOrderIds.join(', ') || '无'}`, '')
    }
    L.push('## 复盘卡', '')
    for (const r of w.reviews) {
      L.push(`### ${r.id} ${SIDE_LABEL[r.side]} ${r.symbol} ${r.qty} 股 @ ${(r.avgPrice / 100).toFixed(2)}`, `- 订单：${r.orderId}，费用 ${(r.fees / 100).toFixed(2)}，已实现盈亏 ${(r.realizedPnl / 100).toFixed(2)}`, `- 计划：${r.planSummary ?? '无'}`, `- 是否按计划：${r.followedPlan ?? '—'}`, `- 过程分：${r.processScore ?? '—'}`, `- 系统提示：${r.biasHints.join('；') || '无'}`, `- 自评：${r.selfBiasTags.map((t) => BIAS_TAGS.find((b) => b.id === t)?.label ?? t).join('、') || '无'}`, `- 记录：${r.note || '—'}`, '')
    }
    L.push('## 收盘总结', '')
    for (const s of w.summaries) L.push(`- ${s.date}：净值 ${(s.equity / 100).toFixed(2)}（${fmtPct(s.equityChangePct)}），费用 ${(s.fees / 100).toFixed(2)}；${s.note || '（未记录）'}${s.biasTag ? ` [${BIAS_TAGS.find((b) => b.id === s.biasTag)?.label ?? s.biasTag}]` : ''}`)
    downloadText(name + '.md', L.join('\n'), 'text/markdown')
  }
  e.setFlag('exported_journal')
  e.bump('exports')
  game.after()
}

onMounted(() => {
  if (tab.value === 'journal' && pendingReviews.value.length === 0 && game.pageArg === 'journal') tab.value = 'journal'
})
</script>

<template>
  <div v-if="game.engine">
    <PixelBanner scene="bank" />
    <div class="page-title">
      <h1>我的账户</h1>
      <span class="muted small">账户中心 · 虚拟资金，仅用于模拟</span>
    </div>
    <div class="tabs" role="tablist">
      <button v-for="t in TABS" :key="t.id" class="tab" :class="{ active: tab === t.id }" role="tab" @click="tab = t.id">
        {{ t.label }}<span v-if="t.id === 'journal' && pendingReviews.length" class="tag tag-warn" style="margin-left: 4px">{{ pendingReviews.length }}</span>
      </button>
    </div>

    <!-- 总览 -->
    <template v-if="tab === 'overview'">
      <div class="grid-4">
        <div class="panel stat"><span class="label"><Gloss id="net_value">账户净值</Gloss></span><span class="value">{{ money(sum.eq) }}</span><Chg :v="sum.dayPnl" kind="money" :sym="sym" /></div>
        <div class="panel stat"><span class="label">总收益率（按单位净值，已剔除入金影响）</span><span class="value"><Chg :v="sum.ret" /></span><span class="tiny muted">单位净值 {{ sum.nav.toFixed(4) }}</span></div>
        <div class="panel stat"><span class="label">现金余额 / <Gloss id="frozen_cash">冻结</Gloss></span><span class="value">{{ money(sum.cash) }}</span><span class="tiny muted">可用 {{ money(sum.avail) }} · 冻结 {{ money(sum.frozen) }}</span></div>
        <div class="panel stat"><span class="label">持仓市值（净）</span><span class="value">{{ money(sum.mv) }}</span><span class="tiny muted">最大回撤 {{ fmtPct(sum.maxDD, 1, false) }}</span></div>
      </div>
      <div class="grid-4 mt">
        <div class="panel stat"><span class="label"><Gloss id="realized_pnl">已实现盈亏</Gloss></span><Chg :v="sum.realized" kind="money" :sym="sym" /></div>
        <div class="panel stat"><span class="label"><Gloss id="unrealized_pnl">未实现盈亏</Gloss></span><Chg :v="sum.unreal" kind="money" :sym="sym" /></div>
        <div class="panel stat"><span class="label">累计费用 / 利息与借券费</span><span class="num">{{ money(sum.fees) }} / {{ money(sum.interest) }}</span></div>
        <div class="panel stat"><span class="label">累计税后股息 / 净入金</span><span class="num">{{ money(sum.div) }} / {{ money(sum.deposits) }}</span></div>
      </div>
      <div class="panel mt">
        <div class="panel-h">
          <span class="title-cn">净值曲线</span>
          <div class="row">
            <div class="seg">
              <button :class="{ active: curveMode === 'nav' }" @click="curveMode = 'nav'">单位净值</button>
              <button :class="{ active: curveMode === 'equity' }" @click="curveMode = 'equity'">账户净值</button>
            </div>
            <button v-if="canBench" class="btn btn-xs" :class="{ active: showBench }" :disabled="curveMode !== 'nav'" @click="toggleBench">基准比较</button>
            <span v-else class="tag" title="达到等级后解锁">🔒 基准比较 Lv3</span>
          </div>
        </div>
        <LineChart :series="curve.series" :labels="curve.labels" :height="230" :percent="curveMode === 'nav'" />
        <div class="tiny muted mt-sm">单位净值法：追加资金按当时净值折算份额，因此收益率不会因入金而失真。基准仅用于比较，组合表现需同时结合回撤与波动来理解。</div>
      </div>
      <div class="grid-2 mt">
        <div class="panel">
          <div class="panel-h"><span class="title-cn">今日净值走势</span></div>
          <LineChart :series="intraday.series" :labels="intraday.labels" :height="150" />
        </div>
        <div class="panel">
          <div class="panel-h"><span class="title-cn">追加虚拟资金</span></div>
          <p class="small muted">追加的是游戏内虚拟资金，不涉及任何真实充值。系统按当前单位净值折算新增份额，收益率与回撤按单位净值计算，不会因入金被放大或稀释。</p>
          <div class="row">
            <input v-model.number="depositAmt" type="number" min="100" step="1000" class="input-num" style="max-width: 180px" />
            <button class="btn btn-primary" @click="doDeposit">追加</button>
          </div>
          <div class="kv mt">
            <span>账户币种</span><span>{{ game.engine.rules.currency }}（单一币种，未模拟汇率）</span>
            <span>规则包</span><span>{{ game.engine.rules.name }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- 持仓 -->
    <template v-if="tab === 'positions'">
      <div class="panel flush">
        <div class="panel-h"><span class="title-cn">当前持仓</span><span class="tiny muted">成本采用移动加权平均，含交易费用</span></div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>股票</th><th class="num">持仓</th><th class="num"><Gloss id="sellable_qty">可卖</Gloss></th><th class="num"><Gloss id="settlement_t1">未到可卖日</Gloss></th>
                <th class="num">挂单冻结</th><th class="num"><Gloss id="avg_cost">成本价</Gloss></th><th class="num">最新</th><th class="num">今日</th><th class="num">市值</th>
                <th class="num">浮动盈亏</th><th class="num">已实现</th><th class="num">股息</th><th class="num">占净值</th><th class="num">持有天数</th><th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in positions" :key="x.p.symbol" class="clickable" @click="game.openStock(x.p.symbol)">
                <td><span class="row"><Logo :symbol="x.p.symbol" :size="18" /><b>{{ x.p.symbol }}</b> {{ x.name }}<span v-if="x.p.qty < 0" class="tag tag-warn">空头</span><span v-if="x.status !== 'normal'" class="tag tag-danger">{{ x.status === 'suspended' ? '停牌' : x.status === 'delisting' ? '退市整理' : '已退市' }}</span></span></td>
                <td class="num">{{ fmtQty(x.p.qty) }}</td>
                <td class="num">{{ fmtQty(x.sellable) }}</td>
                <td class="num" :title="x.locked ? '当日买入的股份需到下一交易日才能卖出（交易引擎校验，不仅是界面限制）' : ''" @mouseenter="x.locked && game.engine?.setFlag('viewed_t1_hint')">{{ x.locked ? fmtQty(x.locked) + ' 🔒' : '—' }}</td>
                <td class="num">{{ x.p.frozenQty ? fmtQty(x.p.frozenQty) : '—' }}</td>
                <td class="num">{{ fmtPrice(Math.round(x.s.avg)) }}</td>
                <td class="num">{{ fmtPrice(x.s.px) }}</td>
                <td class="num"><Chg :v="x.dayChg" /></td>
                <td class="num">{{ money(x.s.mv) }}</td>
                <td class="num"><Chg :v="x.s.unreal" kind="money" :sym="sym" /></td>
                <td class="num"><Chg :v="x.p.realizedPnl" kind="money" :sym="sym" :arrow="false" /></td>
                <td class="num">{{ money(x.p.dividendsReceived) }}</td>
                <td class="num">{{ fmtPct(x.weight, 1, false) }}</td>
                <td class="num">{{ x.days }}</td>
                <td><button class="btn btn-xs" @click.stop="game.openTrade(x.p.symbol)">交易</button></td>
              </tr>
              <tr v-if="!positions.length"><td colspan="15" class="empty">暂无持仓。可在交易终端提交订单。</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="grid-2 mt">
        <div class="panel">
          <div class="panel-h"><span class="title-cn">按股票分布</span></div>
          <div v-for="x in positions" :key="x.p.symbol" class="row small mb">
            <span style="width: 120px" class="ellipsis">{{ x.p.symbol }} {{ x.name }}</span>
            <div class="bar grow"><i :style="{ width: Math.min(100, Math.abs(x.weight) * 100) + '%', background: x.p.qty < 0 ? 'var(--warn)' : 'var(--accent)' }" /></div>
            <span class="num" style="width: 56px; text-align: right">{{ fmtPct(x.weight, 1, false) }}</span>
          </div>
          <div v-if="!positions.length" class="muted small">—</div>
          <div class="row small">
            <span style="width: 120px">现金</span>
            <div class="bar grow"><i :style="{ width: Math.max(0, Math.min(100, (sum.cash / Math.max(1, sum.eq)) * 100)) + '%', background: 'var(--accent2)' }" /></div>
            <span class="num" style="width: 56px; text-align: right">{{ fmtPct(sum.cash / Math.max(1, sum.eq), 1, false) }}</span>
          </div>
        </div>
        <div class="panel">
          <div class="panel-h"><span class="title-cn">按行业分布</span><span class="tiny muted">币种：{{ game.engine.rules.currency }} 100%</span></div>
          <div v-for="s in sectors" :key="s.sector" class="row small mb">
            <span style="width: 80px">{{ sectorName(s.sector) }}</span>
            <div class="bar grow"><i :style="{ width: Math.min(100, Math.abs(s.weight) * 100) + '%', background: SECTOR_MAP[s.sector as SectorId]?.color }" /></div>
            <span class="num" style="width: 56px; text-align: right">{{ fmtPct(s.weight, 1, false) }}</span>
          </div>
          <div v-if="!sectors.length" class="muted small">暂无行业暴露</div>
          <div class="note mt small">分散化可以降低单一公司特有风险，但无法消除整体市场风险；同一行业的股票往往同涨同跌。</div>
        </div>
      </div>
    </template>

    <!-- 风险 -->
    <template v-if="tab === 'risk'">
      <div class="grid-4">
        <div class="panel stat"><span class="label">最大单股占比</span><span class="value" :class="risk.maxWeight > 0.4 ? 'warn' : ''">{{ fmtPct(risk.maxWeight, 1, false) }}</span></div>
        <div class="panel stat"><span class="label"><Gloss id="concentration">行业集中度（HHI）</Gloss></span><span class="value">{{ risk.hhi.toFixed(2) }}</span><span class="tiny muted">{{ risk.topSector ? `最大：${sectorName(risk.topSector.sector)} ${fmtPct(risk.topSector.weight, 1, false)}` : '无持仓' }}</span></div>
        <div class="panel stat"><span class="label"><Gloss id="leverage">杠杆（总敞口/净值）</Gloss></span><span class="value" :class="risk.leverage > 1.5 ? 'danger' : ''">{{ risk.leverage.toFixed(2) }}x</span></div>
        <div class="panel stat"><span class="label"><Gloss id="drawdown">当前回撤 / 最大回撤</Gloss></span><span class="value">{{ fmtPct(risk.drawdown, 1, false) }}</span><span class="tiny muted">最大 {{ fmtPct(risk.maxDD, 1, false) }}</span></div>
      </div>
      <div class="panel mt flush">
        <div class="panel-h"><span class="title-cn"><Gloss id="liquidity">流动性风险</Gloss></span><span class="tiny muted">按日均成交量的 10% 估算清仓所需交易日</span></div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>股票</th><th class="num">流动性档位</th><th class="num">估计清仓天数</th><th>评估</th></tr></thead>
            <tbody>
              <tr v-for="l in risk.liq" :key="l.sym">
                <td>{{ l.sym }} {{ l.name }}</td>
                <td class="num">{{ l.tier }}</td>
                <td class="num">{{ l.days.toFixed(2) }}</td>
                <td><span class="tag" :class="l.days > 1 ? 'tag-danger' : l.days > 0.3 ? 'tag-warn' : 'tag-ok'">{{ l.days > 1 ? '较难快速退出' : l.days > 0.3 ? '可能产生明显冲击成本' : '流动性充足' }}</span></td>
              </tr>
              <tr v-if="!risk.liq.length"><td colspan="4" class="empty">暂无持仓</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div v-if="risk.marginEnabled" class="panel mt">
        <div class="panel-h"><span class="title-cn">保证金账户</span><span v-if="risk.call" class="tag tag-danger blink">追加保证金通知</span></div>
        <div class="grid-4">
          <div class="stat"><span class="label">净值</span><span class="num">{{ money(sum.eq) }}</span></div>
          <div class="stat"><span class="label">总敞口</span><span class="num">{{ money(risk.gross) }}</span></div>
          <div class="stat"><span class="label"><Gloss id="margin">保证金比例</Gloss></span><span class="num" :class="risk.ratio < risk.maint ? 'danger' : ''">{{ isFinite(risk.ratio) ? fmtPct(risk.ratio, 1, false) : '—（无敞口）' }}</span></div>
          <div class="stat"><span class="label">购买力</span><span class="num">{{ money(risk.bp) }}</span></div>
        </div>
        <div class="mt">
          <div class="bar" style="height: 14px">
            <i :style="{ width: Math.min(100, (isFinite(risk.ratio) ? risk.ratio : 1) * 100) + '%', background: risk.ratio < risk.liqLine ? 'var(--danger)' : risk.ratio < risk.maint ? 'var(--warn)' : 'var(--ok)' }" />
          </div>
          <div class="tiny muted mt-sm">初始保证金 {{ fmtPct(risk.init, 0, false) }} · 维持保证金 {{ fmtPct(risk.maint, 0, false) }} · 强制平仓线 {{ fmtPct(risk.liqLine, 0, false) }} · 融资负债 {{ money(risk.loan) }}</div>
        </div>
        <div v-if="risk.call" class="note danger mt small">
          保证金缺口约 {{ money(risk.call.deficit) }}，须在第 {{ risk.call.deadlineDay }} 个交易日收盘前补足（追加资金或减仓），否则将被强制平仓。<Gloss id="margin_call" /> <Gloss id="forced_liquidation" />
        </div>
        <div class="tbl-wrap mt">
          <table class="tbl">
            <thead><tr><th>空头持仓</th><th class="num">股数</th><th class="num">市值</th><th class="num"><Gloss id="borrow_fee">借券年化费率</Gloss></th><th class="num">日借券费估算</th></tr></thead>
            <tbody>
              <tr v-for="s in risk.shorts" :key="s.sym"><td>{{ s.sym }}</td><td class="num">{{ fmtQty(s.qty) }}</td><td class="num">{{ money(s.value) }}</td><td class="num">{{ fmtPct(s.rate, 1, false) }}</td><td class="num">{{ money(Math.round((s.value * s.rate) / 252)) }}</td></tr>
              <tr v-if="!risk.shorts.length"><td colspan="5" class="empty">无空头持仓</td></tr>
            </tbody>
          </table>
        </div>
        <div class="note warn mt small">杠杆会同时放大收益与亏损；卖空的理论亏损没有上限。极端行情下强制平仓可能以不利价格成交。</div>
      </div>
      <div v-else class="note mt small">未开启保证金账户（进阶模式）。可在投资者公寓设置中了解并开启，开启前请先完成风险管理学习。</div>
    </template>

    <!-- 订单 / 成交 / 流水 通用筛选 -->
    <div v-if="tab === 'orders' || tab === 'execs' || tab === 'ledger'" class="panel mb">
      <div class="row wrap">
        <input v-model="q" placeholder="搜索代码、名称、编号、说明…" style="min-width: 200px" class="grow" />
        <select v-if="tab === 'orders'" v-model="fStatus">
          <option value="">全部状态</option>
          <option value="open">未完成</option>
          <option v-for="(l, k) in STATUS_LABEL" :key="k" :value="k">{{ l }}</option>
        </select>
        <select v-if="tab !== 'ledger'" v-model="fSide">
          <option value="">全部方向</option>
          <option v-for="(l, k) in SIDE_LABEL" :key="k" :value="k">{{ l }}</option>
        </select>
        <select v-if="tab === 'orders'" v-model="fType">
          <option value="">全部类型</option>
          <option v-for="(l, k) in ORDER_TYPE_LABEL" :key="k" :value="k">{{ l }}</option>
        </select>
        <select v-if="tab === 'ledger'" v-model="fLedger">
          <option value="">全部类型</option>
          <option v-for="(l, k) in LEDGER_LABEL" :key="k" :value="k">{{ l }}</option>
        </select>
        <label v-if="tab === 'ledger'" class="check small"><input v-model="showFreeze" type="checkbox" />显示冻结/解冻</label>
        <span class="small muted">交易日</span>
        <input v-model.number="fFrom" type="number" placeholder="起" style="width: 70px" />
        <input v-model.number="fTo" type="number" placeholder="止" style="width: 70px" />
        <button class="btn btn-xs" @click="exportRows(tab as 'orders' | 'execs' | 'ledger', 'csv')">导出 CSV</button>
        <button class="btn btn-xs" @click="exportRows(tab as 'orders' | 'execs' | 'ledger', 'json')">导出 JSON</button>
      </div>
    </div>

    <div v-if="tab === 'orders'" class="panel flush">
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr><th>订单号</th><th>时间</th><th>股票</th><th>方向</th><th>类型</th><th>有效期</th><th class="num">数量</th><th class="num">已成交</th><th class="num">限价/触发</th><th class="num">成交均价</th><th class="num">费用</th><th>状态</th><th></th></tr>
          </thead>
          <tbody>
            <template v-for="o in orders" :key="o.id">
              <tr class="clickable" :class="{ sel: expandedOrder === o.id }" @click="expandedOrder = expandedOrder === o.id ? '' : o.id">
                <td>{{ o.id }}<span v-if="o.source === 'system'" class="tag tag-danger">系统</span></td>
                <td class="tiny">{{ fmtTime(o.createdAt) }}</td>
                <td>{{ o.symbol }}</td>
                <td :class="o.side === 'buy' || o.side === 'cover' ? 'up' : 'down'">{{ SIDE_LABEL[o.side] }}</td>
                <td>{{ ORDER_TYPE_LABEL[o.type] }}</td>
                <td>{{ TIF_LABEL[o.tif] }}</td>
                <td class="num">{{ fmtQty(o.qty) }}</td>
                <td class="num">{{ fmtQty(o.filledQty) }}</td>
                <td class="num">{{ o.limitPrice ? fmtPrice(o.limitPrice) : '—' }}{{ o.stopPrice ? ' / ' + fmtPrice(o.stopPrice) : '' }}</td>
                <td class="num">{{ o.filledQty ? (o.avgFillPrice / 100).toFixed(3) : '—' }}</td>
                <td class="num">{{ money(o.fees) }}</td>
                <td><span class="tag" :class="o.status === 'filled' ? 'tag-ok' : o.status === 'rejected' ? 'tag-danger' : isOpen(o) ? 'tag-info' : ''">{{ STATUS_LABEL[o.status] }}</span></td>
                <td><button v-if="isOpen(o) && o.status !== 'cancelPending'" class="btn btn-xs" @click.stop="cancel(o.id)">撤单</button></td>
              </tr>
              <tr v-if="expandedOrder === o.id">
                <td colspan="13" style="white-space: normal">
                  <div v-if="o.rejectReason" class="note danger small mb">拒单原因：{{ o.rejectReason }}</div>
                  <div class="small bold mb">状态历史</div>
                  <div v-for="(h, i) in o.history" :key="i" class="tiny">
                    {{ fmtTime(h.ts) }} · {{ h.from ? STATUS_LABEL[h.from] : '—' }} → <b>{{ STATUS_LABEL[h.to] }}</b> · {{ h.reason }} · 已成交 {{ h.filledQty }} / 剩余 {{ h.remainingQty }}<template v-if="h.fees"> · 费用 {{ money(h.fees) }}</template>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="!orders.length"><td colspan="13" class="empty">没有符合条件的订单</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="tab === 'execs'" class="panel flush">
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr><th>成交号</th><th>时间</th><th>订单</th><th>股票</th><th>方向</th><th class="num">数量</th><th class="num">价格</th><th class="num">成交额</th><th class="num">佣金</th><th class="num">税费及其他</th><th>流动性</th><th class="num"><Gloss id="slippage">滑点/股</Gloss></th><th class="num">已实现</th></tr>
          </thead>
          <tbody>
            <tr v-for="x in execs" :key="x.id">
              <td>{{ x.id }}</td>
              <td class="tiny">{{ fmtTime(x.ts) }}</td>
              <td>{{ x.orderId }}</td>
              <td>{{ x.symbol }}</td>
              <td :class="x.side === 'buy' || x.side === 'cover' ? 'up' : 'down'">{{ SIDE_LABEL[x.side] }}</td>
              <td class="num">{{ fmtQty(x.qty) }}</td>
              <td class="num">{{ fmtPrice(x.price) }}</td>
              <td class="num">{{ money(x.value) }}</td>
              <td class="num">{{ money(x.commission) }}</td>
              <td class="num" :title="`经手费 ${money(x.exchangeFee)} · 监管费 ${money(x.regulatoryFee)} · 印花税 ${money(x.stampTax)} · 过户费 ${money(x.transferFee)}（费率版本 ${x.feeVersion}）`">{{ money(x.totalFee - x.commission) }}</td>
              <td>{{ x.liquidity === 'taker' ? '主动' : x.liquidity === 'maker' ? '被动' : '竞价' }}</td>
              <td class="num" :class="x.slippage > 0 ? 'warn' : ''">{{ (x.slippage / 100).toFixed(3) }}</td>
              <td class="num"><Chg v-if="x.realizedPnl !== undefined" :v="x.realizedPnl" kind="money" :sym="sym" :arrow="false" /><span v-else>—</span></td>
            </tr>
            <tr v-if="!execs.length"><td colspan="13" class="empty">暂无成交记录</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="tab === 'ledger'" class="panel flush">
      <div class="panel-h"><span class="tiny muted">流水不可变；更正通过补偿记录完成。冻结/解冻只改变冻结金额，不改变现金余额。</span></div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>流水号</th><th>时间</th><th>类型</th><th class="num">金额</th><th class="num">现金余额</th><th class="num">冻结余额</th><th>关联</th><th>说明</th></tr></thead>
          <tbody>
            <tr v-for="l in ledgerRows" :key="l.id">
              <td>{{ l.id }}</td>
              <td class="tiny">{{ fmtTime(l.ts) }}</td>
              <td><span class="tag">{{ LEDGER_LABEL[l.type] }}</span></td>
              <td class="num"><Chg :v="l.amount" kind="money" :sym="sym" :arrow="false" /></td>
              <td class="num">{{ money(l.balanceAfter) }}</td>
              <td class="num">{{ money(l.frozenAfter) }}</td>
              <td class="tiny">{{ [l.symbol, l.orderId, l.execId].filter(Boolean).join(' · ') }}</td>
              <td class="small" style="white-space: normal; min-width: 220px">{{ l.note }}</td>
            </tr>
            <tr v-if="!ledgerRows.length"><td colspan="8" class="empty">暂无流水</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 交易日志 -->
    <template v-if="tab === 'journal'">
      <div class="grid-2">
        <div class="panel">
          <div class="panel-h"><span class="title-cn">交易纪律分</span><span class="mid-num accent">{{ discipline.score }}</span></div>
          <div v-for="p in discipline.parts" :key="p.label" class="row small mb">
            <span class="grow">{{ p.label }}</span>
            <div class="bar thin" style="width: 90px"><i :style="{ width: p.value * 100 + '%' }" /></div>
            <span class="num tiny" style="width: 70px; text-align: right">{{ fmtPct(p.value, 0, false) }} ×{{ p.weight }}</span>
          </div>
          <div class="tiny muted">纪律分只由可验证的过程指标构成，不包含收益率。</div>
        </div>
        <div class="panel">
          <div class="panel-h"><span class="title-cn">导出交易日志</span></div>
          <p class="small muted">导出交易计划、复盘卡与收盘总结，便于离线回顾。</p>
          <div class="row">
            <button class="btn btn-sm" @click="exportJournal('json')">导出 JSON</button>
            <button class="btn btn-sm" @click="exportJournal('md')">导出 Markdown</button>
          </div>
        </div>
      </div>
      <h3 class="section-title mt">待完成复盘（{{ pendingReviews.length }}）</h3>
      <div v-if="!pendingReviews.length" class="muted small mb">暂无待复盘的交易。订单结束（全部成交/撤销/过期且有成交）后会自动生成复盘卡。</div>
      <ReviewCard v-for="r in pendingReviews" :key="r.id" :review-id="r.id" />
      <h3 class="section-title mt">交易计划（{{ plans.length }}）</h3>
      <div class="panel flush">
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>计划</th><th>股票</th><th>创建</th><th>周期</th><th>理由 / 假设</th><th>证伪条件</th><th class="num">计划仓位</th><th class="num">止损/目标</th><th>关联订单</th><th>状态</th></tr></thead>
            <tbody>
              <tr v-for="p in plans" :key="p.id">
                <td>{{ p.id }}</td>
                <td>{{ p.symbol }}</td>
                <td class="tiny">{{ fmtTime(p.createdAt) }}</td>
                <td>{{ { short: '短期', medium: '中期', long: '长期' }[p.horizon] }}</td>
                <td class="small" style="white-space: normal; min-width: 200px">{{ p.reason }}<br /><span class="muted">{{ p.hypothesis }}</span></td>
                <td class="small" style="white-space: normal; min-width: 140px">{{ p.invalidation || '—' }}</td>
                <td class="num">{{ fmtPct(p.targetPct, 0, false) }}</td>
                <td class="num">{{ p.stopPrice ? fmtPrice(p.stopPrice) : '—' }} / {{ p.targetPrice ? fmtPrice(p.targetPrice) : '—' }}</td>
                <td class="tiny">{{ p.linkedOrderIds.join(', ') || '—' }}<template v-if="p.tranches?.length"><br />分批 {{ p.tranches.length }} 档</template></td>
                <td><button class="btn btn-xs" @click="closePlan(p.id)">{{ p.status === 'active' ? '进行中 · 关闭' : '已关闭 · 重开' }}</button></td>
              </tr>
              <tr v-if="!plans.length"><td colspan="10" class="empty">暂无交易计划。可在交易终端的订单票据中创建。</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <h3 class="section-title mt">收盘总结</h3>
      <div class="panel flush">
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>日期</th><th class="num">净值</th><th class="num">当日</th><th class="num">费用</th><th class="num">综指</th><th>一句话总结</th><th>偏差标签</th></tr></thead>
            <tbody>
              <tr v-for="s in summaries" :key="s.tradingDay">
                <td>{{ s.date }}</td>
                <td class="num">{{ money(s.equity) }}</td>
                <td class="num"><Chg :v="s.equityChangePct" /></td>
                <td class="num">{{ money(s.fees) }}</td>
                <td class="num"><Chg :v="s.indexChanges[0]?.changePct ?? 0" /></td>
                <td class="small" style="white-space: normal; min-width: 200px">{{ s.note || '—' }}</td>
                <td>{{ s.biasTag ? BIAS_TAGS.find((b) => b.id === s.biasTag)?.label ?? s.biasTag : '—' }}</td>
              </tr>
              <tr v-if="!summaries.length"><td colspan="7" class="empty">第一个交易日收盘后生成</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <h3 class="section-title mt">已完成复盘（最近 30 张）</h3>
      <ReviewCard v-for="r in doneReviews" :key="r.id" :review-id="r.id" />
      <div v-if="!doneReviews.length" class="muted small">暂无</div>
    </template>
    <div class="tiny dim mt">所有资金与交易均为模拟，不连接任何真实账户。{{ fmtShortDate(game.engine.dayIndex) }}</div>
  </div>
</template>
