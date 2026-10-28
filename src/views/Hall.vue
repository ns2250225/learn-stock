<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGame } from '../store/game'
import PixelCity from '../components/PixelCity.vue'
import Chg from '../components/Chg.vue'
import Sparkline from '../components/Sparkline.vue'
import Logo from '../components/Logo.vue'
import Gloss from '../components/Gloss.vue'
import { fmtDate, fmtClock } from '../engine/clock'
import { SECTORS, SECTOR_MAP } from '../engine/content/sectors'
import { NPCS } from '../engine/content/npcs'
import { MACRO_LABEL, REGIME_LABEL, SOURCE_LABEL, CATEGORY_LABEL } from '../engine/state'
import type { MacroVar } from '../engine/types'
import { availableCash, equity } from '../engine/trading'
import { riskSnapshot } from '../engine/review'
import { MISSIONS, missionAvailable } from '../engine/profile'
import { fmtBig, fmtMoney, fmtNum, fmtPct, fmtPrice, std, mean } from '../engine/util'

const game = useGame()
const rankTab = ref<'gain' | 'loss' | 'amount' | 'volume'>('gain')

const status = computed(() => {
  game.rev
  const e = game.engine!
  return { date: fmtDate(e.dayIndex), clock: fmtClock(e.minuteOfDay), phase: e.phaseLabel, toClose: e.minutesToClose(), regime: REGIME_LABEL[e.w.regime.current], td: e.w.clock.tradingDay, rules: e.rules.name }
})

const indices = computed(() => {
  game.rev
  const e = game.engine!
  return Object.values(e.w.indices).map((i) => ({
    id: i.id,
    name: i.name,
    value: i.value,
    chg: i.prevClose ? i.value / i.prevClose - 1 : 0,
    spark: i.minute.length > 1 ? i.minute.map((m) => m.v) : i.daily.slice(-20).map((d) => d.c),
    base: i.minute.length > 1 ? i.prevClose : undefined,
  }))
})
const mainIdx = computed(() => indices.value.filter((i) => !i.id.startsWith('SEC_')))
const secIdx = computed(() => indices.value.filter((i) => i.id.startsWith('SEC_')))

const stocks = computed(() => {
  game.rev
  const e = game.engine!
  return Object.values(e.w.stocks)
    .filter((s) => s.status !== 'delisted')
    .map((s) => ({ s, c: e.tmpl[s.symbol], chg: s.prevClose ? s.last / s.prevClose - 1 : 0 }))
})

const breadth = computed(() => {
  const e = game.engine!
  const lim = e.rules.priceLimit.enabled
  let up = 0, down = 0, flat = 0, lu = 0, ld = 0, susp = 0
  for (const x of stocks.value) {
    if (x.s.status === 'suspended') susp++
    if (x.chg > 0) up++
    else if (x.chg < 0) down++
    else flat++
    if (lim && x.s.last >= x.s.limitUp) lu++
    if (lim && x.s.last <= x.s.limitDown) ld++
  }
  return { up, down, flat, lu, ld, susp, total: up + down + flat, lim }
})

/** 市场情绪：多个可见构成因素的平均，仅作辅助参考 */
const sentiment = computed(() => {
  game.rev
  const e = game.engine!
  const w = e.w
  const idx = w.indices.PXC
  const d = idx.daily
  const b = breadth.value
  const breadthScore = b.total ? (b.up - b.down) / b.total : 0
  const mom = d.length > 5 ? idx.value / d[d.length - 5].c - 1 : 0
  const rets = d.slice(-11).map((x, i, a) => (i ? x.c / a[i - 1].c - 1 : 0)).slice(1)
  const vol = std(rets) * Math.sqrt(252)
  const avgAmt = mean(d.slice(-20).map((x) => x.v))
  const frac = Math.max(0.05, Math.min(1, (idx.minute.length || 1) / e.T))
  const todayAmt = idx.members.reduce((s, m) => s + w.stocks[m].amount, 0)
  const volRatio = avgAmt ? todayAmt / (avgAmt * frac) : 1
  const todayEvents = w.events.filter((x) => x.tradingDay === w.clock.tradingDay)
  const tone = todayEvents.length ? mean(todayEvents.map((x) => Math.sign(x.immediateImpact) * Math.min(1, x.credibility))) : 0
  const parts = [
    { label: '市场广度（上涨 − 下跌占比）', raw: fmtPct(breadthScore, 0), score: breadthScore },
    { label: '5 日动量（综指）', raw: fmtPct(mom, 1), score: Math.max(-1, Math.min(1, mom / 0.05)) },
    { label: '波动率代理（10 日年化）', raw: fmtPct(vol, 0, false), score: Math.max(-1, Math.min(1, (0.18 - vol) / 0.15)) },
    { label: '成交活跃度（相对 20 日均值）', raw: volRatio.toFixed(2) + ' 倍', score: Math.max(-1, Math.min(1, (volRatio - 1) * (breadthScore >= 0 ? 1 : -1))) },
    { label: '今日新闻基调', raw: `${todayEvents.length} 条事件，偏${tone > 0.15 ? '正面' : tone < -0.15 ? '负面' : '中性'}`, score: tone },
    { label: '情绪惯性（模拟引擎）', raw: w.marketSentiment.toFixed(2), score: w.marketSentiment },
  ]
  const score = mean(parts.map((p) => p.score))
  const label = score < -0.45 ? '恐慌' : score < -0.15 ? '谨慎' : score <= 0.15 ? '中性' : score <= 0.45 ? '乐观' : '亢奋'
  return { parts, score, label }
})

const ranking = computed(() => {
  const l = [...stocks.value]
  switch (rankTab.value) {
    case 'gain':
      l.sort((a, b) => b.chg - a.chg)
      break
    case 'loss':
      l.sort((a, b) => a.chg - b.chg)
      break
    case 'amount':
      l.sort((a, b) => b.s.amount - a.s.amount)
      break
    case 'volume':
      l.sort((a, b) => b.s.volume - a.s.volume)
      break
  }
  return l.slice(0, 10)
})

function heat(chg: number) {
  const a = Math.min(1, Math.abs(chg) / 0.03)
  return { background: `color-mix(in srgb, ${chg >= 0 ? 'var(--up)' : 'var(--down)'} ${Math.round(15 + a * 60)}%, var(--panel2))` }
}

const news = computed(() => {
  game.rev
  const w = game.engine!.w
  return w.news.filter((n) => n.tradingDay >= w.clock.tradingDay - 1 && n.importance >= 2).slice(-8).reverse()
})

const macro = computed(() => {
  game.rev
  const w = game.engine!.w
  return (Object.keys(MACRO_LABEL) as MacroVar[]).map((k) => ({ k, ...MACRO_LABEL[k], v: w.macro[k], d: w.macro[k] - w.macro0[k] }))
})

const calendar = computed(() => {
  game.rev
  const e = game.engine!
  const td = e.w.clock.tradingDay
  const items: { day: number; text: string; kind: string }[] = []
  for (const r of e.w.releases) if (!r.released && r.day >= td && r.day <= td + 5) items.push({ day: r.day, text: `${r.name}（预期 ${r.expected}${r.unit}）`, kind: '宏观' })
  for (const st of Object.values(e.w.stocks)) if (st.status !== 'delisted' && st.nextEarningsDay >= td && st.nextEarningsDay <= td + 5) items.push({ day: st.nextEarningsDay, text: `${e.tmpl[st.symbol].name} 财报`, kind: e.w.account.positions[st.symbol] ? '持仓财报' : '财报' })
  return items.sort((a, b) => a.day - b.day).slice(0, 12).map((x) => ({ ...x, label: x.day === td ? '今日' : e.cal.short(x.day) }))
})

const acct = computed(() => {
  game.rev
  const e = game.engine!
  const eq = equity(e)
  const r = riskSnapshot(e)
  let top = ''
  let topW = 0
  for (const p of Object.values(e.w.account.positions)) {
    const wgt = Math.abs(p.qty * e.w.stocks[p.symbol].last) / Math.max(1, eq)
    if (wgt > topW) {
      topW = wgt
      top = p.symbol
    }
  }
  return { eq, day: eq - e.w.account.dayStartEquity, avail: availableCash(e), top, topW, dd: r.drawdown, lev: r.leverage, sym: e.rules.currencySymbol, n: Object.keys(e.w.account.positions).length }
})

const mentor = NPCS.find((n) => n.id === 'mentor')!
const nextMission = computed(() => {
  game.rev
  return MISSIONS.filter((m) => !game.profile.missionsDone.includes(m.id) && missionAvailable(m, game.profile)).sort((a, b) => a.order - b.order)[0]
})
</script>

<template>
  <div class="col gap-lg">
    <div class="page-title">
      <h1>市场大厅</h1>
      <span class="sim-badge">虚构模拟市场</span>
      <span class="muted small">{{ status.date }} {{ status.clock }} · {{ status.phase }}<template v-if="status.toClose"> · 距收盘 {{ status.toClose }} 分钟</template> · 规则包：{{ status.rules }}</span>
    </div>

    <section class="panel">
      <PixelCity />
    </section>

    <div class="grid-4">
      <div v-for="i in mainIdx" :key="i.id" class="panel clickable" @click="game.go('research', 'sector')">
        <div class="muted small">{{ i.name }}</div>
        <div class="row between">
          <span class="big-num">{{ fmtNum(i.value) }}</span>
          <Sparkline :data="i.spark" :base="i.base" :width="90" :height="30" />
        </div>
        <Chg :v="i.chg" word />
      </div>
      <div class="panel">
        <div class="muted small">市场广度（{{ breadth.total }} 只交易中）</div>
        <div class="row gap-lg mt-sm">
          <span class="up">▲ {{ breadth.up }}</span><span class="down">▼ {{ breadth.down }}</span><span class="flat">■ {{ breadth.flat }}</span>
        </div>
        <div class="bar mt-sm"><i :style="{ width: (breadth.total ? (breadth.up / breadth.total) * 100 : 0) + '%', background: 'var(--up)' }" /></div>
        <div class="tiny muted mt-sm">
          <template v-if="breadth.lim">涨停 {{ breadth.lu }} · 跌停 {{ breadth.ld }} · </template>停牌 {{ breadth.susp }}
        </div>
      </div>
      <div class="panel">
        <div class="muted small">市场环境（模拟）</div>
        <div class="mid-num accent mt-sm">{{ status.regime }}</div>
        <div class="tiny muted">由宏观与情绪因素驱动的模拟周期，可能随时转变</div>
      </div>
    </div>

    <div class="grid-2">
      <section class="panel">
        <div class="panel-h"><span class="title">Sentiment</span><span class="tag">{{ sentiment.label }}</span></div>
        <div class="bar"><i :style="{ width: ((sentiment.score + 1) / 2) * 100 + '%', background: 'var(--accent)' }" /></div>
        <div class="row between tiny muted"><span>恐慌</span><span>中性</span><span>亢奋</span></div>
        <table class="tbl mt-sm">
          <tbody>
            <tr v-for="p in sentiment.parts" :key="p.label">
              <td>{{ p.label }}</td>
              <td class="num">{{ p.raw }}</td>
              <td class="num"><Chg :v="p.score" kind="num" /></td>
            </tr>
          </tbody>
        </table>
        <div class="note mt-sm">情绪指标只是对上述构成因素的汇总，用于帮助理解市场氛围，<b>不是买入或卖出信号</b>。情绪极端时市场可能延续，也可能反转。</div>
      </section>

      <section class="panel">
        <div class="panel-h"><span class="title">Rankings</span></div>
        <div class="tabs">
          <button class="tab" :class="{ active: rankTab === 'gain' }" @click="rankTab = 'gain'">涨幅榜</button>
          <button class="tab" :class="{ active: rankTab === 'loss' }" @click="rankTab = 'loss'">跌幅榜</button>
          <button class="tab" :class="{ active: rankTab === 'amount' }" @click="rankTab = 'amount'">成交额</button>
          <button class="tab" :class="{ active: rankTab === 'volume' }" @click="rankTab = 'volume'">成交量</button>
        </div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr><th>股票</th><th class="num">最新价</th><th class="num">涨跌幅</th><th class="num">成交额</th></tr>
            </thead>
            <tbody>
              <tr v-for="x in ranking" :key="x.s.symbol" class="clickable" @click="game.openStock(x.s.symbol)">
                <td class="row"><Logo :symbol="x.s.symbol" :size="16" /> <b>{{ x.s.symbol }}</b> <span class="ellipsis">{{ x.c.name }}</span> <span v-if="x.s.status === 'suspended'" class="tag tag-warn">停牌</span></td>
                <td class="num">{{ fmtPrice(x.s.last) }}</td>
                <td class="num"><Chg :v="x.chg" /></td>
                <td class="num">{{ fmtBig(x.s.amount / 100) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <section class="panel">
      <div class="panel-h"><span class="title">Sectors</span><span class="tiny muted">点击查看行业面板</span></div>
      <div class="heat">
        <div v-for="i in secIdx" :key="i.id" class="cell clickable" :style="heat(i.chg)" @click="game.go('research', 'sector')">
          <div class="bold">{{ SECTOR_MAP[i.id.slice(4) as keyof typeof SECTOR_MAP]?.name }}</div>
          <Chg :v="i.chg" />
          <div class="tiny">{{ fmtNum(i.value) }}</div>
        </div>
      </div>
    </section>

    <div class="grid-3">
      <section class="panel">
        <div class="panel-h"><span class="title">Headlines</span><a class="tiny" @click="game.go('news')">新闻社</a></div>
        <div v-if="!news.length" class="empty">今日暂无重要新闻</div>
        <div v-for="n in news" :key="n.id" class="list-item small" @click="game.go('news', n.id)">
          <span class="tag" :class="'src-' + n.sourceType">{{ SOURCE_LABEL[n.sourceType] }}</span>
          <span class="tag">{{ CATEGORY_LABEL[n.category] }}</span>
          <span :class="n.importance >= 3 ? 'bold' : ''"> {{ n.title }}</span>
        </div>
      </section>
      <section class="panel">
        <div class="panel-h"><span class="title">Macro</span><span class="tiny muted">模拟宏观数据</span></div>
        <div class="kv">
          <template v-for="m in macro" :key="m.k">
            <span>{{ m.name }}</span>
            <span class="num">{{ m.v.toFixed(2) }}{{ m.unit }} <span class="tiny" :class="m.d > 0 ? 'up' : m.d < 0 ? 'down' : 'flat'">({{ m.d >= 0 ? '+' : '' }}{{ m.d.toFixed(2) }})</span></span>
          </template>
        </div>
        <div class="tiny muted mt-sm">括号内为相对开局的变化。<Gloss id="interest_rate">利率</Gloss>、<Gloss id="inflation">通胀</Gloss>会影响估值与行业表现。</div>
      </section>
      <section class="panel">
        <div class="panel-h"><span class="title">Calendar</span><a class="tiny" @click="game.go('news', 'calendar')">事件日历</a></div>
        <div v-if="!calendar.length" class="empty">未来 5 个交易日无日历事件</div>
        <div v-for="(c, i) in calendar" :key="i" class="row small hover-row">
          <span class="num muted" style="width: 44px">{{ c.label }}</span>
          <span class="tag" :class="c.kind === '持仓财报' ? 'tag-warn' : c.kind === '宏观' ? 'tag-info' : ''">{{ c.kind }}</span>
          <span class="ellipsis">{{ c.text }}</span>
        </div>
      </section>
    </div>

    <div class="grid-2">
      <section class="panel">
        <div class="panel-h"><span class="title">Account</span><a class="tiny" @click="game.go('account')">我的账户</a></div>
        <div class="grid-2">
          <div class="stat"><span class="label">账户净值（虚拟资金）</span><span class="value">{{ fmtMoney(acct.eq, acct.sym) }}</span></div>
          <div class="stat"><span class="label">今日盈亏</span><span class="value"><Chg :v="acct.day" kind="money" :sym="acct.sym" /></span></div>
          <div class="stat"><span class="label">可用现金</span><span class="value">{{ fmtMoney(acct.avail, acct.sym) }}</span></div>
          <div class="stat"><span class="label">当前回撤</span><span class="value">{{ fmtPct(acct.dd, 1, false) }}</span></div>
        </div>
        <div class="note mt-sm" :class="acct.topW > 0.4 ? 'warn' : ''">
          <template v-if="acct.n">最大单股持仓 {{ acct.top }} 占净值 {{ fmtPct(acct.topW, 1, false) }}<template v-if="acct.topW > 0.4">，集中度较高，可以考虑检查风险面板</template>；杠杆 {{ acct.lev.toFixed(2) }} 倍。</template>
          <template v-else>当前空仓。可以先去研究室或新闻社了解市场，再制订交易计划。</template>
        </div>
      </section>
      <section class="panel">
        <div class="panel-h"><span class="title">Mentor</span></div>
        <div class="row top">
          <div class="tag tag-accent">{{ mentor.name }}</div>
          <div class="grow small">
            <template v-if="nextMission">
              <div class="bold">下一个任务：{{ nextMission.title }}</div>
              <div class="muted">{{ nextMission.brief }}</div>
            </template>
            <div v-else class="muted">{{ mentor.lines[(status.td || 0) % mentor.lines.length] }}</div>
          </div>
        </div>
        <div class="row end mt-sm">
          <button class="btn btn-sm" @click="game.go('learn', 'missions')">去学习中心</button>
          <button class="btn btn-sm btn-ghost" @click="game.go('trade')">继续交易</button>
        </div>
        <div class="tiny muted">任务提示不会阻断交易流程，你可以随时忽略。</div>
      </section>
    </div>
    <div class="tiny muted center">所有公司、价格、新闻与资金均为虚构模拟数据，不构成投资建议。</div>
  </div>
</template>

<style scoped>
.heat {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
}
.heat .cell {
  padding: 8px;
  box-shadow: 0 0 0 1px var(--border);
}
@media (max-width: 860px) {
  .heat {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
