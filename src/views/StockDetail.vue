<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGame } from '../store/game'
import KChart from '../components/KChart.vue'
import Logo from '../components/Logo.vue'
import Chg from '../components/Chg.vue'
import Gloss from '../components/Gloss.vue'
import PlanModal from '../components/PlanModal.vue'
import { COMPANIES } from '../engine/content/companies'
import { SECTOR_MAP } from '../engine/content/sectors'
import { TIER_LABEL } from '../engine/params'
import { SOURCE_LABEL } from '../engine/state'
import { ORDER_TYPE_LABEL, SIDE_LABEL, STATUS_LABEL } from '../engine/rules'
import { fmtTime } from '../engine/clock'
import { hashString } from '../engine/rng'
import { fmtBig, fmtMoney, fmtNum, fmtPct, fmtPrice, fmtQty, fmtSignedMoney } from '../engine/util'
import type { CompanyStyle } from '../engine/types'

type Tab = 'quote' | 'profile' | 'financials' | 'valuation' | 'news' | 'shares' | 'actions' | 'history'
const TABS: { id: Tab; label: string }[] = [
  { id: 'quote', label: '行情' },
  { id: 'profile', label: '公司概览' },
  { id: 'financials', label: '财务报表' },
  { id: 'valuation', label: '估值' },
  { id: 'news', label: '新闻公告' },
  { id: 'shares', label: '股东/股本' },
  { id: 'actions', label: '公司行动' },
  { id: 'history', label: '交易历史' },
]
const game = useGame()
const tab = ref<Tab>(TABS.some((t) => t.id === game.pageArg) ? (game.pageArg as Tab) : 'quote')
const mode = ref<'intraday' | 'day' | 'week'>('day')
const planOpen = ref(false)
const viewed = new Set<string>()
const rightsQty = ref<Record<string, number>>({})
const rightsMsg = ref('')

watch(
  tab,
  (t) => {
    const e = game.engine
    if (!e || viewed.has(t)) return
    viewed.add(t)
    if (t === 'financials') e.bump('financialsViewed')
    if (t === 'valuation') e.bump('valuationViewed')
    game.after()
  },
  { immediate: true },
)

const STYLE_LABEL: Record<CompanyStyle, string> = {
  growth: '成长型', value: '价值型', cyclical: '周期型', dividend: '高股息', leveraged: '高负债', speculative: '高投机', stable: '稳定现金流', turnaround: '困境反转',
}

const d = computed(() => {
  game.rev
  const e = game.engine
  if (!e) return null
  const sym = game.symbol
  const st = e.w.stocks[sym]
  const c = e.tmpl[sym]
  if (!st || !c) return null
  const td = e.w.clock.tradingDay
  const price = st.last / 100
  const sharesM = st.f.shares / 1e6
  const last4 = st.reports.slice(-4)
  const ni4 = last4.reduce((a, r) => a + r.netIncome, 0)
  const peTTM = st.f.epsTTM > 0 ? price / st.f.epsTTM : NaN
  const fwdEps = st.expectation.eps * 4
  const peFwd = fwdEps > 0 ? price / fwdEps : NaN
  const pb = st.f.bvps > 0 ? price / st.f.bvps : NaN
  const dy = st.f.dpsTTM / Math.max(0.01, price)
  const roe = st.f.equity > 0 ? ni4 / st.f.equity : NaN
  const mcap = price * st.f.shares
  const model = Math.exp(st.lnFund)
  const lastRep = st.reports[st.reports.length - 1]
  const tags: string[] = []
  if (c.volatility >= 0.45) tags.push('高波动')
  if (c.liquidityTier >= 4) tags.push('低流动性')
  if (st.f.debtRatio >= 0.65) tags.push('高负债')
  if (c.styles.includes('cyclical') || SECTOR_MAP[c.sector].cyclical >= 0.8) tags.push('周期性')
  if (c.eventSensitivity >= 1.4) tags.push('事件敏感')
  if (st.f.ocfRatio < 0.7) tags.push('经营现金流弱')
  if (c.customerConcentration >= 0.5) tags.push('客户集中')
  if (st.f.netMargin < 0) tags.push('尚未盈利')
  const daily = st.daily.slice(-250)
  const hi52 = Math.max(...daily.map((b) => b.h), st.high)
  const lo52 = Math.min(...daily.map((b) => b.l), st.low || Infinity)
  const peers = COMPANIES.filter((x) => x.sector === c.sector).map((x) => {
    const s = e.w.stocks[x.symbol]
    const p = s.last / 100
    const n4 = s.reports.slice(-4).reduce((a, r) => a + r.netIncome, 0)
    return {
      sym: x.symbol,
      name: x.name,
      pe: s.f.epsTTM > 0 ? p / s.f.epsTTM : NaN,
      pb: s.f.bvps > 0 ? p / s.f.bvps : NaN,
      dy: s.f.dpsTTM / Math.max(0.01, p),
      roe: s.f.equity > 0 ? n4 / s.f.equity : NaN,
      margin: s.f.netMargin,
      debt: s.f.debtRatio,
      mcap: p * s.f.shares,
    }
  })
  const h = hashString(sym + 'holders')
  const inst = 0.25 + ((h & 255) / 255) * 0.35
  const insider = 0.05 + (((h >>> 8) & 255) / 255) * (1 - c.floatRatio) * 0.8
  const pos = e.w.account.positions[sym]
  const holders = [
    { label: '机构投资者（模拟）', pct: inst },
    { label: '管理层与战略股东（模拟）', pct: Math.min(insider, 0.6) },
    { label: '个人投资者（模拟）', pct: Math.max(0, 1 - inst - Math.min(insider, 0.6)) },
  ]
  const orders = e.w.orders.filter((o) => o.symbol === sym && o.source === 'player').slice().reverse()
  const execs = e.w.executions.filter((x) => x.symbol === sym).slice().reverse()
  const realized = execs.reduce((a, x) => a + (x.realizedPnl ?? 0), 0)
  const fees = execs.reduce((a, x) => a + x.totalFee, 0)
  return {
    e, st, c, td, price, sharesM, peTTM, peFwd, pb, dy, roe, mcap, model, lastRep, tags, hi52, lo52, peers, holders, pos, orders, execs, realized, fees,
    sym: e.rules.currencySymbol,
    chg: st.prevClose ? st.last / st.prevClose - 1 : 0,
    news: e.w.news.filter((n) => n.symbols.includes(sym)).slice().reverse().slice(0, 80),
    actions: e.w.actions.filter((a) => a.symbol === sym).slice().reverse(),
    watched: e.w.watchlist.includes(sym),
    reports: st.reports.slice().reverse(),
    nextEarn: st.nextEarningsDay,
  }
})

const ACTION_LABEL: Record<string, string> = { dividend: '现金分红', split: '拆股/合股', rights: '配股', offering: '定向增发', buyback: '回购', suspension: '停牌', riskWarning: '风险警示', delisting: '退市' }
const ASTATUS: Record<string, string> = { announced: '已公告', active: '进行中', completed: '已完成', cancelled: '已取消' }
const OUTCOME: Record<string, { t: string; c: string }> = { beat: { t: '超预期', c: 'tag-ok' }, meet: { t: '符合预期', c: 'tag-info' }, miss: { t: '低于预期', c: 'tag-danger' }, mixed: { t: '数据混合', c: 'tag-warn' } }
const GUIDE: Record<string, string> = { raise: '上调', maintain: '维持', lower: '下调' }
const n2 = (x: number, dg = 2) => (isFinite(x) ? x.toFixed(dg) : '—')

function toggleWatch() {
  game.engine?.toggleWatch(game.symbol)
  game.after()
}
function subscribe(id: string) {
  const r = game.engine!.corp.subscribeRights(id, Math.floor(rightsQty.value[id] ?? 0))
  rightsMsg.value = r.message
  game.after()
}
function openNews(id: string) {
  game.go('news', id)
}
</script>

<template>
  <div v-if="d">
    <section class="panel mb">
      <div class="row wrap between">
        <div class="row wrap">
          <Logo :symbol="game.symbol" :size="44" />
          <div>
            <div class="row wrap gap-sm">
              <h2 style="margin: 0">{{ d.st.riskWarning ? '*' : '' }}{{ d.c.name }}</h2>
              <span class="muted">{{ game.symbol }} · {{ SECTOR_MAP[d.c.sector].name }}</span>
              <span v-if="d.st.status === 'suspended'" class="tag tag-warn">停牌</span>
              <span v-if="d.st.riskWarning" class="tag tag-danger">风险警示</span>
              <span v-if="d.st.status === 'delisting'" class="tag tag-danger">退市整理期</span>
              <span v-if="d.st.status === 'delisted'" class="tag tag-danger">已退市</span>
              <span class="tag">模拟公司</span>
            </div>
            <div class="row wrap gap-sm">
              <span class="big-num" :class="d.chg > 0 ? 'up' : d.chg < 0 ? 'down' : 'flat'">{{ fmtPrice(d.st.last) }}</span>
              <Chg :v="d.chg" word />
              <span class="tiny muted">{{ d.e.timeLabel() }} · {{ d.e.phaseLabel }} · 单位 {{ d.e.rules.currency }}</span>
            </div>
          </div>
        </div>
        <div class="row wrap">
          <button class="btn btn-sm" @click="toggleWatch">{{ d.watched ? '★ 已自选' : '☆ 加自选' }}</button>
          <button class="btn btn-sm" @click="planOpen = true">交易计划 / 提醒</button>
          <button class="btn btn-sm btn-buy" :disabled="d.st.status === 'delisted'" @click="game.openTrade(game.symbol, 'buy')">交易</button>
        </div>
      </div>
    </section>

    <div class="tabs">
      <button v-for="t in TABS" :key="t.id" class="tab" :class="{ active: tab === t.id }" @click="tab = t.id">{{ t.label }}</button>
    </div>

    <!-- 行情 -->
    <div v-if="tab === 'quote'" class="grid" style="grid-template-columns: minmax(0, 1fr)">
      <section class="panel">
        <div class="seg mb">
          <button :class="{ active: mode === 'intraday' }" @click="mode = 'intraday'">分时</button>
          <button :class="{ active: mode === 'day' }" @click="mode = 'day'">日K</button>
          <button :class="{ active: mode === 'week' }" @click="mode = 'week'">周K</button>
        </div>
        <KChart :symbol="game.symbol" :mode="mode" :height="380" />
      </section>
      <section class="panel">
        <div class="panel-h"><span class="title-cn">报价统计</span><span class="tiny muted">截至 {{ d.e.timeLabel() }}</span></div>
        <div class="grid-4">
          <div class="kv"><span>今开</span><span>{{ fmtPrice(d.st.open) }}</span><span>最高</span><span>{{ fmtPrice(d.st.high) }}</span><span>最低</span><span>{{ fmtPrice(d.st.low) }}</span><span>昨收</span><span>{{ fmtPrice(d.st.prevClose) }}</span></div>
          <div class="kv"><span>成交量</span><span>{{ fmtQty(d.st.volume) }} 股</span><span>成交额</span><span>{{ fmtBig(d.st.amount / 100) }} 元</span><span>20日均量</span><span>{{ fmtQty(d.st.adv) }} 股</span><span>换手率</span><span>{{ fmtPct(d.st.volume / d.st.f.floatShares, 2, false) }}</span></div>
          <div class="kv"><span>近一年最高</span><span>{{ fmtPrice(d.hi52) }}</span><span>近一年最低</span><span>{{ fmtPrice(d.lo52) }}</span><span>距高点</span><span>{{ fmtPct(d.st.last / d.hi52 - 1) }}</span><span>涨跌停</span><span>{{ d.e.rules.priceLimit.enabled ? `${fmtPrice(d.st.limitDown)}~${fmtPrice(d.st.limitUp)}` : '不限' }}</span></div>
          <div class="kv"><span>总市值</span><span>{{ fmtBig(d.mcap) }}</span><span>P/E (TTM)</span><span>{{ n2(d.peTTM, 1) }}</span><span>流动性</span><span>{{ TIER_LABEL[d.c.liquidityTier] }}</span><span>下次财报</span><span>{{ d.e.cal.label(d.nextEarn) }}</span></div>
        </div>
        <div class="mt-sm">
          <div class="tiny muted">近一年区间位置</div>
          <div class="bar"><i :style="{ width: ((d.st.last - d.lo52) / Math.max(1, d.hi52 - d.lo52)) * 100 + '%' }" /></div>
        </div>
      </section>
    </div>

    <!-- 公司概览 -->
    <div v-else-if="tab === 'profile'" class="grid-2">
      <section class="panel">
        <div class="panel-h"><span class="title-cn">公司档案</span><span class="tiny muted">虚构公司</span></div>
        <p>{{ d.c.description }}</p>
        <p class="muted small">主营业务：{{ d.c.business }}</p>
        <div class="kv">
          <span>代码</span><span>{{ d.c.symbol }}</span>
          <span>行业</span><span>{{ SECTOR_MAP[d.c.sector].name }}</span>
          <span>上市年份</span><span>{{ d.c.listedYear }}</span>
          <span>交易状态</span><span>{{ d.st.status === 'normal' ? '正常交易' : d.st.status === 'suspended' ? '停牌' : d.st.status === 'delisting' ? '退市整理' : '已退市' }}{{ d.st.riskWarning ? ' · 风险警示' : '' }}</span>
          <span>管理层（CEO）</span><span>{{ d.c.ceo }}</span>
          <span>所在园区</span><span>{{ d.c.district }}</span>
          <span>主要产品/项目</span><span>{{ d.c.products.join('、') }}</span>
        </div>
        <div class="mt chip-list">
          <span v-for="s in d.c.styles" :key="s" class="tag tag-accent">{{ STYLE_LABEL[s] }}</span>
          <span v-for="t in d.tags" :key="t" class="tag tag-warn">⚠ {{ t }}</span>
        </div>
      </section>
      <section class="panel">
        <div class="panel-h"><span class="title-cn">敏感度与治理</span><span class="tiny muted">模型参数（游戏设定）</span></div>
        <div class="kv">
          <span><Gloss id="beta">市场 Beta</Gloss></span><span>{{ d.c.beta.toFixed(2) }}</span>
          <span>行业敏感度</span><span>{{ d.c.sectorSensitivity.toFixed(2) }}</span>
          <span>利率敏感度（负=加息受损）</span><span>{{ d.c.rateSensitivity.toFixed(2) }}</span>
          <span>大宗商品敏感度</span><span>{{ d.c.commoditySensitivity.toFixed(2) }}</span>
          <span>消费景气敏感度</span><span>{{ d.c.consumerSensitivity.toFixed(2) }}</span>
          <span>事件敏感度</span><span>{{ d.c.eventSensitivity.toFixed(2) }}</span>
          <span><Gloss id="volatility">特质波动率</Gloss>（年化）</span><span>{{ fmtPct(d.c.volatility, 0, false) }}</span>
          <span><Gloss id="liquidity">流动性档位</Gloss></span><span>{{ d.c.liquidityTier }} 级 · {{ TIER_LABEL[d.c.liquidityTier] }}</span>
        </div>
        <div class="divider" />
        <div v-for="g in [{ l: '管理层信誉', v: d.c.mgmtCredibility }, { l: '财报可靠性', v: d.c.reportReliability }, { l: '信息透明度', v: d.c.transparency }, { l: '大客户集中度', v: d.c.customerConcentration }]" :key="g.l" class="mb">
          <div class="row between tiny"><span class="muted">{{ g.l }}</span><span>{{ (g.v * 100).toFixed(0) }}/100</span></div>
          <div class="bar thin"><i :style="{ width: g.v * 100 + '%' }" /></div>
        </div>
      </section>
    </div>

    <!-- 财务报表 -->
    <section v-else-if="tab === 'financials'" class="panel">
      <div class="panel-h"><span class="title-cn">季度财务报表</span><span class="tiny muted">单位：营收/利润/现金流 百万元；EPS 元/股；比率为单季（ROE 年化）</span></div>
      <div class="note small mb">「实际」为公司已公布值；「预期」为发布前的分析师一致预期（市场预期值），二者分开显示。下一份报告：{{ d.st.expectation.nextPeriod }}，预计 {{ d.e.cal.label(d.nextEarn) }} 发布，当前一致预期 EPS {{ d.st.expectation.eps.toFixed(3) }} 元、营收 {{ fmtNum(d.st.expectation.revenue, 1) }} 百万元。</div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>报告期</th><th>发布日</th><th class="num">营收·实际</th><th class="num">营收·预期</th><th class="num">营收同比</th><th class="num"><Gloss id="gross_margin">毛利率</Gloss></th><th class="num"><Gloss id="net_margin">净利率</Gloss></th>
              <th class="num">净利润</th><th class="num"><Gloss id="eps">EPS</Gloss>·实际</th><th class="num">EPS·预期</th><th class="num"><Gloss id="operating_cash_flow">经营现金流</Gloss></th><th class="num">现金流/利润</th>
              <th class="num"><Gloss id="free_cash_flow">自由现金流</Gloss></th><th class="num"><Gloss id="debt_ratio">资产负债率</Gloss></th><th class="num"><Gloss id="roe">ROE</Gloss></th><th><Gloss id="guidance">指引</Gloss></th><th>结果</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in d.reports" :key="r.id">
              <td class="bold">{{ r.period }}</td><td>{{ d.e.cal.label(r.publishDay) }}</td>
              <td class="num">{{ fmtNum(r.revenue, 1) }}</td><td class="num muted">{{ fmtNum(r.expectedRevenue, 1) }}</td>
              <td class="num">{{ fmtPct(r.revenueYoY, 1) }}</td><td class="num">{{ fmtPct(r.grossMargin, 1, false) }}</td><td class="num">{{ fmtPct(r.netMargin, 1, false) }}</td>
              <td class="num">{{ fmtNum(r.netIncome, 1) }}</td><td class="num bold">{{ r.eps.toFixed(3) }}</td><td class="num muted">{{ r.expectedEps.toFixed(3) }}</td>
              <td class="num">{{ fmtNum(r.operatingCashFlow, 1) }}</td>
              <td class="num" :class="r.netIncome > 0 && r.operatingCashFlow / r.netIncome < 0.7 ? 'warn' : ''">{{ r.netIncome ? (r.operatingCashFlow / r.netIncome).toFixed(2) : '—' }}</td>
              <td class="num">{{ fmtNum(r.freeCashFlow, 1) }}</td><td class="num">{{ fmtPct(r.debtRatio, 1, false) }}</td><td class="num">{{ fmtPct(r.roe, 1, false) }}</td>
              <td>{{ GUIDE[r.guidance] }}</td>
              <td><span class="tag" :class="OUTCOME[r.outcome].c">{{ OUTCOME[r.outcome].t }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="tiny muted mt-sm">现金流/利润 低于 0.7 标为橙色：利润增长但现金流偏弱时，可以考虑检查应收账款与存货变化（盈利质量）。</div>
    </section>

    <!-- 估值 -->
    <div v-else-if="tab === 'valuation'" class="col gap-lg">
      <div class="grid-2">
        <section class="panel">
          <div class="panel-h"><span class="title-cn">估值指标</span><span class="tiny muted">价格 {{ fmtPrice(d.st.last) }} · {{ d.e.timeLabel() }}</span></div>
          <div class="kv">
            <span><Gloss id="pe_ratio">P/E（TTM，历史）</Gloss></span><span>{{ n2(d.peTTM, 1) }}</span>
            <span><Gloss id="forward_pe">P/E（预期）</Gloss></span><span>{{ n2(d.peFwd, 1) }}</span>
            <span><Gloss id="pb_ratio">P/B</Gloss></span><span>{{ n2(d.pb) }}</span>
            <span><Gloss id="dividend_yield">股息率（TTM）</Gloss></span><span>{{ fmtPct(d.dy, 2, false) }}</span>
            <span><Gloss id="roe">ROE（近四季）</Gloss></span><span>{{ isFinite(d.roe) ? fmtPct(d.roe, 1, false) : '—' }}</span>
            <span><Gloss id="debt_ratio">资产负债率</Gloss></span><span>{{ fmtPct(d.st.f.debtRatio, 1, false) }}</span>
            <span><Gloss id="market_cap">总市值</Gloss></span><span>{{ fmtBig(d.mcap) }} 元</span>
            <span>每股收益 TTM / 每股净资产</span><span>{{ d.st.f.epsTTM.toFixed(3) }} / {{ d.st.f.bvps.toFixed(2) }} 元</span>
          </div>
          <div class="note tiny mt-sm">
            P/E（TTM）= 当前价 ÷ 最近四个已公布季度 EPS 之和（历史盈利口径）；P/E（预期）= 当前价 ÷（下一季一致预期 EPS × 4），基于分析师预期，可能被修正。亏损公司 P/E 显示为「—」。
          </div>
        </section>
        <section class="panel">
          <div class="panel-h"><span class="title-cn">游戏模型估值区间</span><span class="tag tag-warn">游戏生成值 · 非投资建议</span></div>
          <div class="mid-num">{{ (d.model * 0.85).toFixed(2) }} ~ {{ (d.model * 1.15).toFixed(2) }} 元</div>
          <div class="small muted mt-sm">当前价相对模型中值：<Chg :v="d.price / d.model - 1" /></div>
          <div class="note tiny mt">这是模拟引擎内部「基本面价值」（盈利能力 × 宏观估值环境）的近似区间，由游戏生成，并非真实公允价值，也不预测未来价格。市场价格可能长期偏离该区间，情绪、事件与流动性同样会驱动价格。</div>
        </section>
      </div>
      <section class="panel">
        <div class="panel-h"><span class="title-cn">同行业比较 · {{ SECTOR_MAP[d.c.sector].name }}</span><span class="tiny muted">数据截至 {{ d.e.timeLabel() }}</span></div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>公司</th><th class="num">P/E TTM</th><th class="num">P/B</th><th class="num">股息率</th><th class="num">ROE</th><th class="num">净利率</th><th class="num">负债率</th><th class="num">市值</th></tr></thead>
            <tbody>
              <tr v-for="p in d.peers" :key="p.sym" class="clickable" :class="{ sel: p.sym === game.symbol }" @click="game.openStock(p.sym, 'valuation')">
                <td><b>{{ p.sym }}</b> {{ p.name }}</td><td class="num">{{ n2(p.pe, 1) }}</td><td class="num">{{ n2(p.pb) }}</td><td class="num">{{ fmtPct(p.dy, 2, false) }}</td>
                <td class="num">{{ isFinite(p.roe) ? fmtPct(p.roe, 1, false) : '—' }}</td><td class="num">{{ fmtPct(p.margin, 1, false) }}</td><td class="num">{{ fmtPct(p.debt, 0, false) }}</td><td class="num">{{ fmtBig(p.mcap) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="tiny muted mt-sm">低估值不必然代表「便宜」：可以考虑同时检查增长、现金流和负债，警惕<Gloss id="valuation_trap">估值陷阱</Gloss>。</div>
      </section>
    </div>

    <!-- 新闻公告 -->
    <section v-else-if="tab === 'news'" class="panel">
      <div class="panel-h"><span class="title-cn">相关新闻与公告</span><span class="tiny muted">{{ d.news.length }} 条</span></div>
      <div v-if="!d.news.length" class="empty">暂无相关新闻</div>
      <div v-for="n in d.news" :key="n.id" class="list-item" @click="openNews(n.id)">
        <div class="row wrap gap-sm">
          <span class="tag" :class="'src-' + n.sourceType">{{ SOURCE_LABEL[n.sourceType] }}</span>
          <span class="tiny muted">{{ fmtTime(n.ts) }} · {{ n.sourceName }} · 可信度 {{ (n.credibility * 100).toFixed(0) }}%</span>
        </div>
        <div :class="n.importance >= 3 ? 'bold' : ''">{{ n.title }}</div>
        <div class="tiny muted">{{ n.summary }}</div>
      </div>
    </section>

    <!-- 股东/股本 -->
    <div v-else-if="tab === 'shares'" class="grid-2">
      <section class="panel">
        <div class="panel-h"><span class="title-cn">股本结构</span><span class="tiny muted">截至 {{ d.e.cal.label(d.td) }}</span></div>
        <div class="kv">
          <span><Gloss id="share_capital">总股本</Gloss></span><span>{{ fmtNum(d.sharesM, 2) }} 百万股</span>
          <span><Gloss id="float_shares">自由流通股</Gloss></span><span>{{ fmtNum(d.st.f.floatShares / 1e6, 2) }} 百万股（{{ fmtPct(d.st.f.floatShares / d.st.f.shares, 0, false) }}）</span>
          <span>可借券数量（卖空）</span><span>{{ fmtQty(d.st.borrowAvailable) }} 股 · 年化费率 {{ fmtPct(d.st.borrowRate, 1, false) }}</span>
          <span>累计拆合股因子</span><span>{{ d.st.splitFactor }}</span>
          <span>你的持股</span><span>{{ fmtQty(d.pos?.qty ?? 0) }} 股（占总股本 {{ fmtPct((d.pos?.qty ?? 0) / d.st.f.shares, 4, false) }}）</span>
        </div>
        <div class="divider" />
        <div class="bold small mb">持有人结构（模拟估计）</div>
        <div v-for="h in d.holders" :key="h.label" class="mb">
          <div class="row between tiny"><span>{{ h.label }}</span><span>{{ fmtPct(h.pct, 1, false) }}</span></div>
          <div class="bar thin"><i :style="{ width: h.pct * 100 + '%' }" /></div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-h"><span class="title-cn">股本变动记录</span></div>
        <table class="tbl">
          <thead><tr><th>日期</th><th class="num">总股本（百万股）</th><th>说明</th></tr></thead>
          <tbody>
            <tr v-for="(s, i) in d.st.shareHistory.slice().reverse()" :key="i"><td>{{ d.e.cal.label(s.day) }}</td><td class="num">{{ fmtNum(s.shares / 1e6, 2) }}</td><td>{{ s.note }}</td></tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- 公司行动 -->
    <section v-else-if="tab === 'actions'" class="panel">
      <div class="panel-h"><span class="title-cn">公司行动</span><span class="tiny muted">分红 · 拆合股 · 配股 · 增发 · 回购 · 停牌 · 退市</span></div>
      <div v-if="rightsMsg" class="note small mb">{{ rightsMsg }}</div>
      <div v-if="!d.actions.length" class="empty">暂无公司行动</div>
      <div v-for="a in d.actions" :key="a.id" class="list-item" style="cursor: default">
        <div class="row wrap gap-sm">
          <span class="tag tag-accent">{{ ACTION_LABEL[a.type] }}</span>
          <span class="tag">{{ ASTATUS[a.status] }}</span>
          <span class="bold">{{ a.title }}</span>
        </div>
        <div class="small muted mt-sm">{{ a.description }}</div>
        <div class="tiny muted mt-sm">
          公告 {{ d.e.cal.label(a.announceDay) }}
          <template v-if="a.exDay !== undefined"> · 除权/除息 {{ d.e.cal.label(a.exDay) }}</template>
          <template v-if="a.payDay !== undefined"> · 派息 {{ d.e.cal.label(a.payDay) }}</template>
          <template v-if="a.effectiveDay !== undefined"> · 生效 {{ d.e.cal.label(a.effectiveDay) }}</template>
          <template v-if="a.endDay !== undefined"> · 截止 {{ d.e.cal.label(a.endDay) }}</template>
          <template v-if="a.entitledQty !== undefined"> · 你的登记股数 {{ fmtQty(a.entitledQty) }}</template>
          <template v-if="a.residual !== undefined"> · 每股剩余价值 {{ fmtPrice(a.residual) }}</template>
        </div>
        <div v-if="a.type === 'rights' && a.status === 'active' && d.td >= (a.exDay ?? 0) && d.td <= (a.endDay ?? 0)" class="row wrap mt-sm">
          <template v-if="(a.entitledQty ?? 0) > 0">
            <span class="small">可认购 {{ fmtQty(Math.floor((a.entitledQty ?? 0) * (a.ratio ?? 0)) - (a.subscribedQty ?? 0)) }} 股 @ {{ fmtPrice(a.price) }}</span>
            <input v-model.number="rightsQty[a.id]" type="number" min="0" style="width: 110px" />
            <button class="btn btn-sm btn-primary" @click="subscribe(a.id)">认购配股</button>
            <span v-if="a.subscribedQty" class="tiny ok">已认购 {{ fmtQty(a.subscribedQty) }} 股</span>
          </template>
          <span v-else class="tiny muted">除权日你未持有该股，无认购资格。</span>
        </div>
      </div>
    </section>

    <!-- 交易历史 -->
    <div v-else class="col gap-lg">
      <section class="panel">
        <div class="panel-h"><span class="title-cn">我在 {{ game.symbol }} 上的交易</span></div>
        <div class="row wrap gap-lg">
          <div class="stat"><span class="label">累计已实现盈亏</span><span class="value"><Chg :v="d.realized" kind="money" :sym="d.sym" /></span></div>
          <div class="stat"><span class="label">累计费用</span><span class="value">{{ fmtMoney(d.fees, d.sym) }}</span></div>
          <div class="stat"><span class="label">当前持仓</span><span class="value">{{ fmtQty(d.pos?.qty ?? 0) }} 股</span></div>
          <div class="stat"><span class="label">累计股息（税后）</span><span class="value">{{ fmtMoney(d.pos?.dividendsReceived ?? 0, d.sym) }}</span></div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-h"><span class="title-cn">订单</span></div>
        <div class="tbl-wrap" style="max-height: 300px">
          <table class="tbl">
            <thead><tr><th>订单</th><th>时间</th><th>方向</th><th>类型</th><th class="num">成交/数量</th><th class="num">均价</th><th>状态</th></tr></thead>
            <tbody>
              <tr v-for="o in d.orders" :key="o.id"><td>{{ o.id }}</td><td>{{ fmtTime(o.createdAt) }}</td><td>{{ SIDE_LABEL[o.side] }}</td><td>{{ ORDER_TYPE_LABEL[o.type] }}</td><td class="num">{{ fmtQty(o.filledQty) }}/{{ fmtQty(o.qty) }}</td><td class="num">{{ o.filledQty ? fmtPrice(o.avgFillPrice) : '—' }}</td><td>{{ STATUS_LABEL[o.status] }}</td></tr>
              <tr v-if="!d.orders.length"><td colspan="7" class="empty">暂无订单</td></tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <div class="panel-h"><span class="title-cn">成交记录</span></div>
        <div class="tbl-wrap" style="max-height: 300px">
          <table class="tbl">
            <thead><tr><th>时间</th><th>方向</th><th class="num">数量</th><th class="num">价格</th><th class="num">费用</th><th class="num">滑点/股</th><th class="num">已实现盈亏</th></tr></thead>
            <tbody>
              <tr v-for="x in d.execs" :key="x.id"><td>{{ fmtTime(x.ts) }}</td><td>{{ SIDE_LABEL[x.side] }}</td><td class="num">{{ fmtQty(x.qty) }}</td><td class="num">{{ fmtPrice(x.price) }}</td><td class="num">{{ fmtMoney(x.totalFee, d.sym) }}</td><td class="num">{{ (x.slippage / 100).toFixed(3) }}</td><td class="num">{{ x.realizedPnl !== undefined ? fmtSignedMoney(x.realizedPnl, d.sym) : '—' }}</td></tr>
              <tr v-if="!d.execs.length"><td colspan="7" class="empty">暂无成交</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <PlanModal v-if="planOpen" :symbol="game.symbol" @close="planOpen = false" @created="planOpen = false" />
  </div>
</template>
