<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGame } from '../store/game'
import PixelBanner from '../components/PixelBanner.vue'
import LineChart from '../components/LineChart.vue'
import Chg from '../components/Chg.vue'
import Logo from '../components/Logo.vue'
import Gloss from '../components/Gloss.vue'
import { SECTORS, SECTOR_MAP } from '../engine/content/sectors'
import { COMPANIES } from '../engine/content/companies'
import { UNLOCKS, TIER_LABEL } from '../engine/params'
import { REGIME_LABEL, MACRO_LABEL } from '../engine/state'
import { equity } from '../engine/trading'
import { sectorWeights } from '../engine/review'
import { fmtPct, fmtPrice, fmtBig, fmtMoney } from '../engine/util'
import type { CompanyStyle, MacroVar, SectorId } from '../engine/types'

const game = useGame()
type Tab = 'sector' | 'peers' | 'cashflow' | 'screener' | 'risk' | 'macro'
const TABS: { id: Tab; label: string; unlock?: string }[] = [
  { id: 'sector', label: '行业面板', unlock: 'sectorPanel' },
  { id: 'peers', label: '同行比较', unlock: 'valuationCompare' },
  { id: 'cashflow', label: '现金流对比' },
  { id: 'screener', label: '估值筛选', unlock: 'screener' },
  { id: 'risk', label: '风险敞口分析', unlock: 'riskExposure' },
  { id: 'macro', label: '宏观仪表盘' },
]
const tab = ref<Tab>((TABS.find((t) => t.id === game.pageArg)?.id) ?? 'sector')
const unlocked = (t: { unlock?: string }) => {
  game.rev
  return !t.unlock || !!game.engine?.isUnlocked(t.unlock)
}
const curTab = computed(() => TABS.find((t) => t.id === tab.value)!)
const curUnlocked = computed(() => unlocked(curTab.value))
const sym = computed(() => game.engine?.rules.currencySymbol ?? '¥')

watch(
  tab,
  (t) => {
    const e = game.engine
    if (!e || !curUnlocked.value) return
    if (t === 'sector') e.bump('sectorPanelViewed')
    if (t === 'peers') e.bump('peersCompared')
    if (t === 'cashflow') {
      e.setFlag('compared_cashflow')
      e.bump('cashflowCompared')
    }
    if (t === 'screener') e.setFlag('used_screener')
    if (t === 'risk') {
      e.setFlag('viewed_risk_panel')
      e.bump('riskPanelViewed')
    }
    game.after()
  },
  { immediate: true },
)

// ---------------- 公司指标 ----------------
interface Metrics {
  sym: string
  name: string
  sector: SectorId
  styles: CompanyStyle[]
  price: number
  chg: number
  mcap: number
  pe: number | null
  fpe: number | null
  pb: number | null
  yld: number
  roe: number
  debt: number
  growth: number
  margin: number
  ocfNi: number | null
  beta: number
  vol: number
  tier: number
  status: string
}
const metrics = computed<Metrics[]>(() => {
  game.rev
  const e = game.engine!
  return COMPANIES.map((c) => {
    const st = e.w.stocks[c.symbol]
    const p = st.last / 100
    const last4 = st.reports.slice(-4)
    const ni = last4.reduce((a, r) => a + r.netIncome, 0)
    const ocf = last4.reduce((a, r) => a + r.operatingCashFlow, 0)
    return {
      sym: c.symbol,
      name: c.name,
      sector: c.sector,
      styles: c.styles,
      price: st.last,
      chg: st.prevClose ? st.last / st.prevClose - 1 : 0,
      mcap: p * st.f.shares,
      pe: st.f.epsTTM > 0 ? p / st.f.epsTTM : null,
      fpe: st.expectation.eps > 0 ? p / (st.expectation.eps * 4) : null,
      pb: st.f.bvps > 0 ? p / st.f.bvps : null,
      yld: p > 0 ? st.f.dpsTTM / p : 0,
      roe: st.reports[st.reports.length - 1]?.roe ?? 0,
      debt: st.f.debtRatio,
      growth: st.f.growth,
      margin: st.f.netMargin,
      ocfNi: ni > 0 ? ocf / ni : null,
      beta: c.beta,
      vol: c.volatility,
      tier: c.liquidityTier,
      status: st.status,
    }
  })
})
const median = (a: number[]) => {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}
const f1 = (v: number | null, d = 1) => (v === null || !isFinite(v) ? '—' : v.toFixed(d))

// ---------------- 行业面板 ----------------
const sectorRows = computed(() => {
  game.rev
  const e = game.engine!
  return SECTORS.map((s) => {
    const idx = e.w.indices['SEC_' + s.id]
    const d = idx.daily
    const ch = (k: number) => (d.length > k ? idx.value / d[d.length - k].c - 1 : 0)
    const ms = metrics.value.filter((m) => m.sector === s.id && m.status !== 'delisted')
    return {
      s,
      value: idx.value,
      d1: idx.value / idx.prevClose - 1,
      d5: ch(5),
      d20: ch(20),
      pe: median(ms.map((m) => m.pe).filter((x): x is number => x !== null)),
      up: ms.filter((m) => m.chg > 0).length,
      down: ms.filter((m) => m.chg < 0).length,
      n: ms.length,
      sentiment: e.w.sectorFactors[s.id].sentiment,
    }
  })
})
const sectorChart = computed(() => {
  game.rev
  const e = game.engine!
  const n = 60
  const ref0 = e.w.indices.PXC.daily.slice(-n)
  return {
    labels: ref0.map((b) => e.cal.short(b.t)),
    series: SECTORS.map((s) => ({ name: s.name, color: s.color, values: e.w.indices['SEC_' + s.id].daily.slice(-n).map((b) => b.c) })),
  }
})

// ---------------- 同行比较 ----------------
const peerSector = ref<SectorId>('tech')
const sortKey = ref<keyof Metrics>('mcap')
const sortDir = ref(-1)
function sortBy(k: keyof Metrics) {
  if (sortKey.value === k) sortDir.value *= -1
  else {
    sortKey.value = k
    sortDir.value = -1
  }
}
function sorted(rows: Metrics[]) {
  const k = sortKey.value
  return [...rows].sort((a, b) => {
    const x = a[k] as number | null
    const y = b[k] as number | null
    if (x === null) return 1
    if (y === null) return -1
    return (x > y ? 1 : x < y ? -1 : 0) * sortDir.value
  })
}
const peers = computed(() => sorted(metrics.value.filter((m) => m.sector === peerSector.value)))
const COLS: { k: keyof Metrics; label: string; gloss?: string }[] = [
  { k: 'price', label: '价格' },
  { k: 'mcap', label: '市值', gloss: 'market_cap' },
  { k: 'pe', label: 'P/E(TTM)', gloss: 'pe_ratio' },
  { k: 'fpe', label: '预期P/E', gloss: 'forward_pe' },
  { k: 'pb', label: 'P/B', gloss: 'pb_ratio' },
  { k: 'yld', label: '股息率', gloss: 'dividend_yield' },
  { k: 'roe', label: 'ROE', gloss: 'roe' },
  { k: 'debt', label: '负债率', gloss: 'debt_ratio' },
  { k: 'growth', label: '营收增速', gloss: 'revenue' },
  { k: 'margin', label: '净利率', gloss: 'net_margin' },
  { k: 'ocfNi', label: '现金流/利润', gloss: 'earnings_quality' },
  { k: 'beta', label: 'Beta', gloss: 'beta' },
  { k: 'vol', label: '特质波动', gloss: 'volatility' },
  { k: 'tier', label: '流动性档', gloss: 'liquidity' },
]
function cell(m: Metrics, k: keyof Metrics): string {
  const v = m[k]
  switch (k) {
    case 'price':
      return fmtPrice(v as number)
    case 'mcap':
      return fmtBig(v as number)
    case 'pe':
    case 'fpe':
    case 'pb':
      return f1(v as number | null)
    case 'yld':
    case 'roe':
    case 'debt':
    case 'growth':
    case 'margin':
    case 'vol':
      return fmtPct(v as number, 1, false)
    case 'ocfNi':
      return f1(v as number | null, 2)
    case 'beta':
      return (v as number).toFixed(2)
    case 'tier':
      return `${v} ${TIER_LABEL[v as 1]}`
    default:
      return String(v)
  }
}

// ---------------- 现金流对比 ----------------
const cfA = ref(COMPANIES[0].symbol)
const cfB = ref(COMPANIES[1].symbol)
const cf = computed(() => {
  game.rev
  const e = game.engine!
  return [cfA.value, cfB.value].map((s) => {
    const st = e.w.stocks[s]
    const reps = st.reports.slice(-8)
    const ni = reps.reduce((a, r) => a + r.netIncome, 0)
    const ocf = reps.reduce((a, r) => a + r.operatingCashFlow, 0)
    const fcf = reps.reduce((a, r) => a + r.freeCashFlow, 0)
    return {
      sym: s,
      name: e.tmpl[s].name,
      reps,
      ni,
      ocf,
      fcf,
      ratio: ni > 0 ? ocf / ni : null,
      chart: {
        labels: reps.map((r) => r.period),
        series: [
          { name: '净利润', color: '#f4c95d', values: reps.map((r) => r.netIncome) },
          { name: '经营现金流', color: '#6fd3e8', values: reps.map((r) => r.operatingCashFlow) },
          { name: '自由现金流', color: '#c3a6ff', values: reps.map((r) => r.freeCashFlow), dashed: true },
        ],
      },
    }
  })
})

// ---------------- 筛选器 ----------------
const sc = ref({ peMin: 0, peMax: 60, yldMin: 0, debtMax: 1, sector: '' as '' | SectorId, style: '' as '' | CompanyStyle, tierMax: 5, onlyProfit: false })
const STYLE_LABEL: Record<CompanyStyle, string> = { growth: '成长', value: '价值', cyclical: '周期', dividend: '高股息', leveraged: '高负债', speculative: '高波动/题材', stable: '稳定现金流', turnaround: '困境反转' }
const screened = computed(() =>
  sorted(
    metrics.value.filter((m) => {
      const s = sc.value
      if (m.status === 'delisted') return false
      if (s.onlyProfit && m.pe === null) return false
      if (m.pe !== null && (m.pe < s.peMin || m.pe > s.peMax)) return false
      if (m.pe === null && s.peMin > 0) return false
      if (m.yld < s.yldMin / 100) return false
      if (m.debt > s.debtMax) return false
      if (s.sector && m.sector !== s.sector) return false
      if (s.style && !m.styles.includes(s.style)) return false
      if (m.tier > s.tierMax) return false
      return true
    }),
  ),
)

// ---------------- 风险敞口 ----------------
const exposure = computed(() => {
  game.rev
  const e = game.engine!
  const eq = Math.max(1, equity(e))
  let beta = 0, rate = 0, com = 0, cons = 0, gross = 0
  const rows = Object.values(e.w.account.positions)
    .filter((p) => p.qty !== 0)
    .map((p) => {
      const c = e.tmpl[p.symbol]
      const w = (p.qty * e.w.stocks[p.symbol].last) / eq
      beta += w * c.beta
      rate += w * c.rateSensitivity
      com += w * c.commoditySensitivity
      cons += w * c.consumerSensitivity
      gross += Math.abs(w)
      return { sym: p.symbol, name: c.name, w, beta: c.beta, rate: c.rateSensitivity, com: c.commoditySensitivity, cons: c.consumerSensitivity }
    })
  return { rows, beta, rate, com, cons, gross, sectors: sectorWeights(e), eq, shock: beta * -0.1 * eq }
})

// ---------------- 宏观 ----------------
const macroKeys: MacroVar[] = ['rate', 'inflation', 'growth', 'unemployment', 'yield10y']
const macroChart = computed(() => {
  game.rev
  const e = game.engine!
  const h = e.w.macroHistory.slice(-120)
  const colors = ['#f4c95d', '#ff6b6b', '#7bd389', '#c3a6ff', '#6fd3e8']
  return {
    labels: h.map((x) => 'D' + x.day),
    series: macroKeys.map((k, i) => ({ name: MACRO_LABEL[k].name, color: colors[i], values: h.map((x) => x[k] as number) })),
  }
})
const macro = computed(() => {
  game.rev
  return game.engine!.w
})
</script>

<template>
  <div v-if="game.engine">
    <PixelBanner scene="library" />
    <div class="page-title">
      <h1>研究室</h1>
      <span class="muted small">研究图书馆 · 数据为模拟，估值指标仅供学习比较，不构成建议</span>
    </div>
    <div class="tabs">
      <button v-for="t in TABS" :key="t.id" class="tab" :class="{ active: tab === t.id }" @click="tab = t.id">{{ t.label }}<span v-if="!unlocked(t)"> 🔒</span></button>
    </div>

    <div v-if="!curUnlocked" class="panel lock">
      <div class="mid-num">🔒</div>
      <div>需要 Lv.{{ UNLOCKS[curTab.unlock!].level }} 解锁：{{ UNLOCKS[curTab.unlock!].label }}</div>
      <div class="tiny">完成学习任务获得经验即可升级；设置中可解锁全部工具。</div>
    </div>

    <!-- 行业面板 -->
    <template v-else-if="tab === 'sector'">
      <div class="panel flush">
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>行业</th><th class="num">指数</th><th class="num">今日</th><th class="num">5 日</th><th class="num">20 日</th><th class="num">P/E 中位数</th><th class="num">涨/跌</th><th class="num">行业情绪</th></tr></thead>
            <tbody>
              <tr v-for="r in sectorRows" :key="r.s.id">
                <td><span class="tag" :style="{ color: r.s.color, boxShadow: '0 0 0 1px ' + r.s.color }">{{ r.s.name }}</span></td>
                <td class="num">{{ r.value.toFixed(2) }}</td>
                <td class="num"><Chg :v="r.d1" /></td>
                <td class="num"><Chg :v="r.d5" /></td>
                <td class="num"><Chg :v="r.d20" /></td>
                <td class="num">{{ f1(r.pe) }}</td>
                <td class="num"><span class="up">{{ r.up }}</span> / <span class="down">{{ r.down }}</span> / {{ r.n }}</td>
                <td class="num"><Chg :v="r.sentiment" kind="num" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="panel mt">
        <div class="panel-h"><span class="title-cn">近 60 日行业指数（归一化）</span></div>
        <LineChart :series="sectorChart.series" :labels="sectorChart.labels" :height="260" percent />
        <div class="tiny muted mt-sm">行业轮动难以预测；过去的相对强弱不代表未来表现。</div>
      </div>
    </template>

    <!-- 同行比较 -->
    <template v-else-if="tab === 'peers'">
      <div class="panel mb row wrap">
        <span class="small">行业</span>
        <div class="seg wrap">
          <button v-for="s in SECTORS" :key="s.id" :class="{ active: peerSector === s.id }" @click="peerSector = s.id">{{ s.name }}</button>
        </div>
      </div>
      <div class="panel flush">
        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>公司</th>
                <th v-for="c in COLS" :key="c.k" class="num sortable" @click="sortBy(c.k)">{{ c.label }}{{ sortKey === c.k ? (sortDir > 0 ? ' ▲' : ' ▼') : '' }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in peers" :key="m.sym" class="clickable" @click="game.openStock(m.sym, 'valuation')">
                <td><span class="row"><Logo :symbol="m.sym" :size="16" /><b>{{ m.sym }}</b> {{ m.name }}</span></td>
                <td v-for="c in COLS" :key="c.k" class="num">{{ cell(m, c.k) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="note mt small">
        口径说明：<Gloss id="pe_ratio">P/E(TTM)</Gloss> 基于最近四个季度已公布 EPS；<Gloss id="forward_pe">预期 P/E</Gloss> 基于分析师对下一季度 EPS 的一致预期 ×4（市场预期值，可能被修正）；P/B 基于最近一期每股净资产。亏损公司的 P/E 显示为「—」。低估值可能反映真实风险（<Gloss id="valuation_trap">估值陷阱</Gloss>），高估值也可能反映较高的增长预期。
      </div>
    </template>

    <!-- 现金流对比 -->
    <template v-else-if="tab === 'cashflow'">
      <div class="panel mb row wrap">
        <span class="small">公司 A</span>
        <select v-model="cfA"><option v-for="c in COMPANIES" :key="c.symbol" :value="c.symbol">{{ c.symbol }} {{ c.name }}</option></select>
        <span class="small">公司 B</span>
        <select v-model="cfB"><option v-for="c in COMPANIES" :key="c.symbol" :value="c.symbol">{{ c.symbol }} {{ c.name }}</option></select>
      </div>
      <div class="grid-2">
        <div v-for="x in cf" :key="x.sym" class="panel">
          <div class="panel-h"><span class="title-cn row"><Logo :symbol="x.sym" :size="18" />{{ x.sym }} {{ x.name }}</span></div>
          <div class="kv mb">
            <span>近 8 季净利润（百万元）</span><span>{{ x.ni.toFixed(1) }}</span>
            <span><Gloss id="operating_cash_flow">近 8 季经营现金流</Gloss></span><span>{{ x.ocf.toFixed(1) }}</span>
            <span><Gloss id="free_cash_flow">近 8 季自由现金流</Gloss></span><span>{{ x.fcf.toFixed(1) }}</span>
            <span><Gloss id="earnings_quality">经营现金流 / 净利润</Gloss></span>
            <span :class="x.ratio !== null && x.ratio < 0.7 ? 'warn' : 'ok'">{{ f1(x.ratio, 2) }}</span>
          </div>
          <LineChart :series="x.chart.series" :labels="x.chart.labels" :height="170" />
          <div v-if="x.ratio !== null && x.ratio < 0.7" class="note warn mt-sm small">经营现金流明显低于利润，可以考虑检查应收账款、存货等营运资本变化，以及利润的可持续性。</div>
        </div>
      </div>
      <div class="note mt small">利润相近的两家公司，现金流可能差异很大。利润是会计结果，现金流反映真实收付；两者长期背离时需要警惕盈利质量。数据单位：百万元，季度口径。</div>
    </template>

    <!-- 筛选器 -->
    <template v-else-if="tab === 'screener'">
      <div class="panel mb">
        <div class="row wrap">
          <label class="field"><span>P/E 下限</span><input v-model.number="sc.peMin" type="number" style="width: 80px" /></label>
          <label class="field"><span>P/E 上限</span><input v-model.number="sc.peMax" type="number" style="width: 80px" /></label>
          <label class="field"><span>股息率 ≥ (%)</span><input v-model.number="sc.yldMin" type="number" step="0.5" style="width: 80px" /></label>
          <label class="field"><span>负债率 ≤ {{ fmtPct(sc.debtMax, 0, false) }}</span><input v-model.number="sc.debtMax" type="range" min="0.1" max="1" step="0.05" /></label>
          <label class="field"><span>行业</span><select v-model="sc.sector"><option value="">全部</option><option v-for="s in SECTORS" :key="s.id" :value="s.id">{{ s.name }}</option></select></label>
          <label class="field"><span>风格</span><select v-model="sc.style"><option value="">全部</option><option v-for="(l, k) in STYLE_LABEL" :key="k" :value="k">{{ l }}</option></select></label>
          <label class="field"><span>流动性档位 ≤</span><select v-model.number="sc.tierMax"><option v-for="t in [1, 2, 3, 4, 5]" :key="t" :value="t">{{ t }}</option></select></label>
          <label class="check small"><input v-model="sc.onlyProfit" type="checkbox" />仅盈利公司</label>
        </div>
      </div>
      <div class="panel flush">
        <div class="panel-h"><span class="tiny muted">筛选结果 {{ screened.length }} 家 · 筛选只是缩小研究范围，不是买入名单</span></div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>公司</th><th>行业</th>
                <th v-for="c in COLS" :key="c.k" class="num sortable" @click="sortBy(c.k)">{{ c.label }}{{ sortKey === c.k ? (sortDir > 0 ? ' ▲' : ' ▼') : '' }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in screened" :key="m.sym" class="clickable" @click="game.openStock(m.sym)">
                <td><b>{{ m.sym }}</b> {{ m.name }}</td>
                <td>{{ SECTOR_MAP[m.sector].name }}</td>
                <td v-for="c in COLS" :key="c.k" class="num">{{ cell(m, c.k) }}</td>
              </tr>
              <tr v-if="!screened.length"><td :colspan="COLS.length + 2" class="empty">没有符合条件的公司</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- 风险敞口 -->
    <template v-else-if="tab === 'risk'">
      <div class="grid-4">
        <div class="panel stat"><span class="label"><Gloss id="beta">组合 Beta（净值加权）</Gloss></span><span class="value">{{ exposure.beta.toFixed(2) }}</span></div>
        <div class="panel stat"><span class="label">利率敏感度（负=加息受损）</span><span class="value">{{ exposure.rate.toFixed(2) }}</span></div>
        <div class="panel stat"><span class="label">大宗商品敏感度</span><span class="value">{{ exposure.com.toFixed(2) }}</span></div>
        <div class="panel stat"><span class="label">消费景气敏感度</span><span class="value">{{ exposure.cons.toFixed(2) }}</span></div>
      </div>
      <div class="panel mt">
        <div class="panel-h"><span class="title-cn">情景估算：指数下跌 10%</span></div>
        <p>按组合 Beta 粗略估算，账户净值可能变动约 <Chg :v="exposure.shock" kind="money" :sym="sym" />（约 {{ fmtPct(exposure.beta * -0.1) }}）。</p>
        <div class="note warn small">这是基于 Beta 的线性近似：真实情况中，压力时期股票之间的<Gloss id="correlation">相关性</Gloss>往往上升、流动性变差，实际损失可能更大；个股事件也不在此估算中。</div>
      </div>
      <div class="grid-2 mt">
        <div class="panel flush">
          <div class="panel-h"><span class="title-cn">持仓敏感度明细</span></div>
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>股票</th><th class="num">占净值</th><th class="num">Beta</th><th class="num">利率</th><th class="num">商品</th><th class="num">消费</th></tr></thead>
              <tbody>
                <tr v-for="r in exposure.rows" :key="r.sym"><td>{{ r.sym }} {{ r.name }}</td><td class="num">{{ fmtPct(r.w, 1, false) }}</td><td class="num">{{ r.beta.toFixed(2) }}</td><td class="num">{{ r.rate.toFixed(2) }}</td><td class="num">{{ r.com.toFixed(2) }}</td><td class="num">{{ r.cons.toFixed(2) }}</td></tr>
                <tr v-if="!exposure.rows.length"><td colspan="6" class="empty">暂无持仓</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-h"><span class="title-cn">行业暴露</span><span class="tiny muted">总敞口 {{ fmtPct(exposure.gross, 0, false) }}</span></div>
          <div v-for="s in exposure.sectors" :key="s.sector" class="row small mb">
            <span style="width: 80px">{{ SECTOR_MAP[s.sector as SectorId]?.name }}</span>
            <div class="bar grow"><i :style="{ width: Math.min(100, Math.abs(s.weight) * 100) + '%', background: SECTOR_MAP[s.sector as SectorId]?.color }" /></div>
            <span class="num" style="width: 56px; text-align: right">{{ fmtPct(s.weight, 1, false) }}</span>
          </div>
          <div v-if="!exposure.sectors.length" class="muted small">暂无</div>
          <div class="note small mt">同一行业的公司受相同行业因子影响，彼此相关性较高；跨行业分散能降低特有风险，但无法消除系统性风险。</div>
        </div>
      </div>
    </template>

    <!-- 宏观 -->
    <template v-else-if="tab === 'macro'">
      <div class="grid-4">
        <div class="panel stat"><span class="label">市场阶段（模拟引擎状态）</span><span class="value small">{{ REGIME_LABEL[macro.regime.current] }}</span><span class="tiny muted">自第 {{ macro.regime.since }} 交易日</span></div>
        <div v-for="k in macroKeys" :key="k" class="panel stat">
          <span class="label">{{ MACRO_LABEL[k].name }}</span><span class="value">{{ (macro.macro[k] as number).toFixed(2) }}{{ MACRO_LABEL[k].unit }}</span>
        </div>
        <div class="panel stat"><span class="label">风险偏好</span><span class="value"><Chg :v="macro.macro.riskAppetite" kind="num" /></span></div>
        <div class="panel stat"><span class="label">大宗商品指数</span><span class="value">{{ macro.macro.commodity.toFixed(1) }}</span></div>
        <div class="panel stat"><span class="label">消费者信心</span><span class="value">{{ macro.macro.consumerConfidence.toFixed(1) }}</span></div>
      </div>
      <div class="panel mt">
        <div class="panel-h"><span class="title-cn">宏观变量历史</span><span class="tiny muted">按数据发布时点记录</span></div>
        <LineChart :series="macroChart.series" :labels="macroChart.labels" :height="240" />
      </div>
      <div class="note mt small">
        <Gloss id="interest_rate">利率</Gloss>与<Gloss id="inflation">通胀</Gloss>影响折现率与融资成本；<Gloss id="gdp">经济增长</Gloss>与<Gloss id="unemployment">就业</Gloss>影响盈利预期。同一宏观数据对不同行业的影响可能相反，市场反应取决于实际值与预期的差距。
      </div>
    </template>
    <div class="tiny dim mt">虚拟数据 · {{ fmtMoney(0, sym).slice(0, 1) }} 计价</div>
  </div>
</template>
