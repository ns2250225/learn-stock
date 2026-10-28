<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGame } from '../store/game'
import PixelBanner from '../components/PixelBanner.vue'
import Gloss from '../components/Gloss.vue'
import Chg from '../components/Chg.vue'
import Logo from '../components/Logo.vue'
import { SOURCE_LABEL, CATEGORY_LABEL, type NewsArticle } from '../engine/state'
import { SECTOR_MAP } from '../engine/content/sectors'
import { GLOSSARY } from '../engine/content/learning'
import { UNLOCKS } from '../engine/params'
import { fmtTime, fmtClock } from '../engine/clock'
import { fmtPrice, fmtPct } from '../engine/util'
import type { SectorId, SourceType } from '../engine/types'

const game = useGame()
type Tab = 'feed' | 'calendar' | 'archive' | 'watched' | 'later'
const tab = ref<Tab>('feed')
const fCat = ref('')
const fSrc = ref<'' | SourceType>('')
const fRel = ref<'' | 'holding' | 'watch' | 'sector'>('')
const fImp = ref(0)
const q = ref('')
const selId = ref('')
const layer = ref<'flash' | 'detail' | 'analysis' | 'retro'>('detail')

const CATS = ['macro', 'sector', 'company', 'regulatory', 'disaster', 'geopolitical', 'sentiment', 'liquidity', 'earnings', 'corporate', 'market', 'calendar']
const SRC_NOTE: Record<SourceType, string> = {
  official: '事实：官方发布的数据或决议',
  announcement: '事实：公司或交易所的正式公告',
  media: '媒体报道：通常可信，但可能存在信息不完整',
  rumor: '传闻：未经证实，可能被证实也可能被否认',
  opinion: '评论：作者观点，不是事实陈述',
}

const held = computed(() => {
  game.rev
  return new Set(Object.keys(game.engine?.w.account.positions ?? {}))
})
const focusSectors = computed(() => {
  game.rev
  const e = game.engine!
  const s = new Set<string>()
  for (const sym of [...held.value, ...e.w.watchlist]) if (e.tmpl[sym]) s.add(e.tmpl[sym].sector)
  return s
})

function related(n: NewsArticle) {
  const e = game.engine!
  if (fRel.value === 'holding') return n.symbols.some((s) => held.value.has(s))
  if (fRel.value === 'watch') return n.symbols.some((s) => e.w.watchlist.includes(s))
  if (fRel.value === 'sector') return n.sectors.some((s) => focusSectors.value.has(s)) || n.symbols.some((s) => focusSectors.value.has(e.tmpl[s]?.sector))
  return true
}

const list = computed(() => {
  game.rev
  const e = game.engine!
  let src = [...e.w.news].reverse()
  if (tab.value === 'archive') src = src.filter((n) => n.sourceType === 'announcement' || n.category === 'corporate' || n.category === 'earnings')
  if (tab.value === 'watched') src = src.filter((n) => e.w.watchedEvents.includes(n.id))
  if (tab.value === 'later') src = src.filter((n) => e.w.reviewLater.includes(n.id))
  const s = q.value.trim()
  return src
    .filter(
      (n) =>
        (!fCat.value || n.category === fCat.value) &&
        (!fSrc.value || n.sourceType === fSrc.value) &&
        n.importance >= fImp.value &&
        related(n) &&
        (!s || n.title.includes(s) || n.summary.includes(s) || n.symbols.some((x) => x.includes(s.toUpperCase()))),
    )
    .slice(0, 250)
})

const sel = computed(() => {
  game.rev
  return game.engine?.w.news.find((n) => n.id === selId.value)
})

function open(id: string) {
  const e = game.engine
  if (!e) return
  const n = e.w.news.find((x) => x.id === id)
  if (!n) return
  selId.value = id
  layer.value = 'detail'
  e.bump('newsOpened')
  if (n.category === 'earnings') {
    e.bump('earningsNewsOpened')
    if (n.tags.includes('mixed')) e.bump('mixedEarningsOpened')
  }
  game.after()
}
function setLayer(l: typeof layer.value) {
  layer.value = l
  const e = game.engine
  if (!e) return
  if (l === 'analysis') e.bump('newsAnalysisViewed')
  if (l === 'retro') e.bump('newsRetroViewed')
  game.after()
}
if (game.pageArg && game.engine?.w.news.some((n) => n.id === game.pageArg)) open(game.pageArg)

const credLabel = (c: number) => (c >= 0.75 ? { t: '可信度高', c: 'tag-ok' } : c >= 0.5 ? { t: '可信度中', c: 'tag-warn' } : { t: '可信度低', c: 'tag-danger' })
const glossOf = (tags: string[]) => tags.filter((t) => GLOSSARY.some((g) => g.id === t))

const retro = computed(() => {
  game.rev
  const e = game.engine!
  const n = sel.value
  if (!n) return null
  const td = e.w.clock.tradingDay
  const elapsed = td - n.tradingDay
  const rows = n.symbols.slice(0, 12).map((sym) => {
    const st = e.w.stocks[sym]
    const p0 = n.priceAtPublish[sym] || st.prevClose
    const bar = (k: number) => st.daily.find((b) => b.t === n.tradingDay + k)
    const before = st.daily.filter((b) => b.t < n.tradingDay).slice(-5)
    const avgVol = before.length ? before.reduce((a, b) => a + b.v, 0) / before.length : 0
    const d0 = bar(0)
    return {
      sym,
      name: e.tmpl[sym].name,
      p0,
      d1: bar(1) ? bar(1)!.c / p0 - 1 : null,
      d5: bar(5) ? bar(5)!.c / p0 - 1 : null,
      now: st.last / p0 - 1,
      vol: d0 && avgVol ? d0.v / avgVol : null,
    }
  })
  const idxNow = e.w.indices.PXC.value / n.indexAtPublish - 1
  const ev = n.eventId ? e.w.events.find((x) => x.id === n.eventId) : undefined
  const follow = e.w.news.filter((x) => (n.eventId && x.followUpOf === n.eventId) || (ev?.parentEventId && x.eventId === ev.parentEventId))
  return { elapsed, rows, idxNow, follow, ev }
})

// ---------------- 日历 ----------------
const calUnlocked = computed(() => {
  game.rev
  return game.engine?.isUnlocked('eventCalendar') ?? false
})
watch(
  tab,
  (t) => {
    if (t === 'calendar' && calUnlocked.value && game.engine) {
      game.engine.setFlag('viewed_calendar')
      game.engine.bump('calendarViewed')
      game.after()
    }
  },
  { immediate: true },
)
const calFilter = ref<'all' | 'mine'>('all')
const calendar = computed(() => {
  game.rev
  const e = game.engine!
  const td = e.w.clock.tradingDay
  const items: { day: number; time: string; kind: string; title: string; detail: string; sym?: string; mine: boolean }[] = []
  for (const r of e.w.releases) {
    if (r.day < td - 1) continue
    items.push({
      day: r.day,
      time: fmtClock(r.minute),
      kind: '宏观数据',
      title: r.name,
      detail: r.released ? `实际 ${r.actual}${r.unit}（预期 ${r.expected}${r.unit}）` : `市场预期 ${r.expected}${r.unit}`,
      mine: true,
    })
  }
  for (const st of Object.values(e.w.stocks)) {
    if (st.status === 'delisted' || st.nextEarningsDay < td || st.nextEarningsDay > td + 30) continue
    items.push({
      day: st.nextEarningsDay,
      time: '盘前',
      kind: '财报',
      title: `${e.tmpl[st.symbol].name}（${st.symbol}）${st.expectation.nextPeriod} 财报`,
      detail: `一致预期 EPS ${st.expectation.eps.toFixed(3)} 元，营收 ${st.expectation.revenue.toFixed(0)} 百万`,
      sym: st.symbol,
      mine: held.value.has(st.symbol) || e.w.watchlist.includes(st.symbol),
    })
  }
  const lab: Record<string, string> = { dividend: '分红', split: '拆合股', rights: '配股', offering: '增发', buyback: '回购', suspension: '停复牌', riskWarning: '风险警示', delisting: '退市' }
  for (const a of e.w.actions) {
    if (a.status === 'completed' || a.status === 'cancelled') continue
    const dates: [number | undefined, string][] = [
      [a.exDay, a.type === 'dividend' ? '除息日' : '除权/登记日'],
      [a.payDay, '派息日'],
      [a.effectiveDay, a.type === 'suspension' ? '停牌' : a.type === 'rights' ? '新股上市' : '生效日'],
      [a.endDay, a.type === 'suspension' ? '预计复牌' : a.type === 'rights' ? '认购截止' : a.type === 'delisting' ? '终止上市' : '结束'],
    ]
    for (const [d, what] of dates) {
      if (d === undefined || d < td) continue
      items.push({ day: d, time: '—', kind: lab[a.type] ?? a.type, title: `${e.tmpl[a.symbol].name}：${what}`, detail: a.title, sym: a.symbol, mine: held.value.has(a.symbol) || e.w.watchlist.includes(a.symbol) })
    }
  }
  return items.filter((x) => calFilter.value === 'all' || x.mine).sort((a, b) => a.day - b.day || a.time.localeCompare(b.time)).slice(0, 200)
})

function act(kind: 'watch' | 'later') {
  const e = game.engine
  if (!e || !sel.value) return
  if (kind === 'watch') e.toggleWatchEvent(sel.value.id)
  else e.toggleReviewLater(sel.value.id)
  game.after()
}
const watched = computed(() => {
  game.rev
  return !!sel.value && !!game.engine?.w.watchedEvents.includes(sel.value.id)
})
const later = computed(() => {
  game.rev
  return !!sel.value && !!game.engine?.w.reviewLater.includes(sel.value.id)
})
</script>

<template>
  <div v-if="game.engine">
    <PixelBanner scene="newsroom" />
    <div class="page-title">
      <h1>新闻社</h1>
      <span class="muted small">所有新闻均为虚构模拟内容。事实、媒体报道、传闻与评论以不同标签区分。</span>
    </div>
    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'feed' }" @click="tab = 'feed'">新闻流</button>
      <button class="tab" :class="{ active: tab === 'calendar' }" @click="tab = 'calendar'">事件日历<span v-if="!calUnlocked"> 🔒</span></button>
      <button class="tab" :class="{ active: tab === 'archive' }" @click="tab = 'archive'">公告档案</button>
      <button class="tab" :class="{ active: tab === 'watched' }" @click="tab = 'watched'">观察列表（{{ game.engine.w.watchedEvents.length }}）</button>
      <button class="tab" :class="{ active: tab === 'later' }" @click="tab = 'later'">稍后复盘（{{ game.engine.w.reviewLater.length }}）</button>
    </div>

    <template v-if="tab === 'calendar'">
      <div v-if="!calUnlocked" class="panel lock">
        <div class="mid-num">🔒</div>
        <div>事件日历需要 Lv.{{ UNLOCKS.eventCalendar.level }}（{{ UNLOCKS.eventCalendar.label }}）</div>
        <div class="tiny">完成任务获得经验即可解锁；设置中可解锁全部工具。</div>
      </div>
      <div v-else class="panel flush">
        <div class="panel-h">
          <span class="title-cn">未来 30 个交易日日历</span>
          <div class="seg">
            <button :class="{ active: calFilter === 'all' }" @click="calFilter = 'all'">全部</button>
            <button :class="{ active: calFilter === 'mine' }" @click="calFilter = 'mine'">持仓/自选 + 宏观</button>
          </div>
        </div>
        <div class="note small" style="margin: 8px">日历事件的时间提前公开，市场会在发布前形成预期；价格反应取决于「实际 vs 预期」的差异。</div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>日期</th><th>时间</th><th>类型</th><th>事件</th><th>预期 / 说明</th></tr></thead>
            <tbody>
              <tr v-for="(c, i) in calendar" :key="i" :class="{ clickable: !!c.sym }" @click="c.sym && game.openStock(c.sym)">
                <td>{{ game.engine.cal.label(c.day) }}<span v-if="c.day === game.engine.w.clock.tradingDay" class="tag tag-accent">今日</span></td>
                <td>{{ c.time }}</td>
                <td><span class="tag" :class="c.kind === '宏观数据' ? 'src-official' : c.kind === '财报' ? 'tag-info' : ''">{{ c.kind }}</span></td>
                <td :class="c.mine && c.sym ? 'bold' : ''">{{ c.title }}</td>
                <td class="small muted" style="white-space: normal">{{ c.detail }}</td>
              </tr>
              <tr v-if="!calendar.length"><td colspan="5" class="empty">暂无日历事件</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="panel mb">
        <div class="row wrap">
          <input v-model="q" placeholder="搜索标题/代码…" class="grow" style="min-width: 160px" />
          <select v-model="fCat">
            <option value="">全部分类</option>
            <option v-for="c in CATS" :key="c" :value="c">{{ CATEGORY_LABEL[c] }}</option>
          </select>
          <select v-model="fSrc">
            <option value="">全部来源</option>
            <option v-for="(l, k) in SOURCE_LABEL" :key="k" :value="k">{{ l }}</option>
          </select>
          <select v-model="fRel">
            <option value="">全部相关性</option>
            <option value="holding">与持仓相关</option>
            <option value="watch">与自选相关</option>
            <option value="sector">关注行业</option>
          </select>
          <select v-model.number="fImp">
            <option :value="0">全部重要性</option>
            <option :value="2">重要及以上</option>
            <option :value="3">仅重大</option>
          </select>
        </div>
      </div>
      <div class="news-grid">
        <div class="panel flush list">
          <div v-if="!list.length" class="empty">没有符合条件的新闻</div>
          <div v-for="n in list" :key="n.id" class="list-item" :class="{ active: n.id === selId }" @click="open(n.id)">
            <div class="row wrap gap-sm">
              <span class="tag" :class="'src-' + n.sourceType">{{ SOURCE_LABEL[n.sourceType] }}</span>
              <span class="tag">{{ CATEGORY_LABEL[n.category] }}</span>
              <span v-if="n.importance >= 3" class="tag tag-danger">重大</span>
              <span v-if="n.symbols.some((s) => held.has(s))" class="tag tag-accent">持仓</span>
              <span class="tiny muted">{{ fmtTime(n.ts) }}</span>
            </div>
            <div class="small mt-sm" :class="n.importance >= 3 ? 'bold' : ''">{{ n.title }}</div>
          </div>
        </div>
        <div class="panel detail">
          <div v-if="!sel" class="empty">选择左侧新闻查看详情</div>
          <template v-else>
            <div class="row wrap gap-sm mb">
              <span class="tag" :class="'src-' + sel.sourceType">{{ SOURCE_LABEL[sel.sourceType] }}</span>
              <span class="tag">{{ sel.sourceName }}</span>
              <span class="tag" :class="credLabel(sel.credibility).c">{{ credLabel(sel.credibility).t }}（{{ (sel.credibility * 100).toFixed(0) }}%）</span>
              <span class="tag" :class="sel.knownBefore ? 'tag-info' : ''">{{ sel.knownBefore ? '日历事件 · 发布时间已提前公开' : '突发信息 · 发布前市场未知' }}</span>
              <span class="tiny muted">{{ fmtTime(sel.ts) }}</span>
            </div>
            <h3>{{ sel.title }}</h3>
            <div class="note small mb" :class="sel.sourceType === 'rumor' ? 'warn' : ''">{{ SRC_NOTE[sel.sourceType] }}</div>
            <div class="tabs">
              <button class="tab" :class="{ active: layer === 'flash' }" @click="setLayer('flash')">快讯</button>
              <button class="tab" :class="{ active: layer === 'detail' }" @click="setLayer('detail')">详情</button>
              <button class="tab" :class="{ active: layer === 'analysis' }" @click="setLayer('analysis')">分析</button>
              <button class="tab" :class="{ active: layer === 'retro' }" @click="setLayer('retro')">事后复盘</button>
            </div>
            <div v-if="layer === 'flash'" class="prose">{{ sel.summary }}</div>
            <div v-if="layer === 'detail'" class="prose">
              <p>{{ sel.summary }}</p>
              <p v-for="(p, i) in sel.detail.split('\n')" :key="i">{{ p }}</p>
            </div>
            <div v-if="layer === 'analysis'">
              <div class="small muted mb">以下是多种合理解释及需要进一步核实的信息，不代表确定结论，也不是交易建议。</div>
              <div v-for="(a, i) in sel.analysis" :key="i" class="note mb small">解读 {{ i + 1 }}：{{ a }}</div>
              <div v-if="!sel.analysis.length" class="muted small">暂无分析。</div>
            </div>
            <div v-if="layer === 'retro' && retro">
              <div class="small muted mb">发布后已过去 {{ retro.elapsed }} 个交易日。以下为实际发生的价格与成交量变化（自发布时价格计算）。价格变化可能还受其他因素影响。</div>
              <div class="kv mb">
                <span>综指自发布以来</span><span><Chg :v="retro.idxNow" /></span>
                <template v-if="retro.ev">
                  <span>模拟引擎记录的预期差</span><span>{{ retro.ev.surprise.toFixed(2) }} σ</span>
                  <span>模拟设定的即时影响强度</span><span>{{ fmtPct(retro.ev.immediateImpact) }}（各股实际反应不同）</span>
                </template>
              </div>
              <div class="tbl-wrap">
                <table class="tbl">
                  <thead><tr><th>股票</th><th class="num">发布时价格</th><th class="num">+1 日</th><th class="num">+5 日</th><th class="num">至今</th><th class="num">当日量比</th></tr></thead>
                  <tbody>
                    <tr v-for="r in retro.rows" :key="r.sym" class="clickable" @click="game.openStock(r.sym)">
                      <td>{{ r.sym }} {{ r.name }}</td>
                      <td class="num">{{ fmtPrice(r.p0) }}</td>
                      <td class="num"><Chg v-if="r.d1 !== null" :v="r.d1" /><span v-else class="muted">待观察</span></td>
                      <td class="num"><Chg v-if="r.d5 !== null" :v="r.d5" /><span v-else class="muted">待观察</span></td>
                      <td class="num"><Chg :v="r.now" /></td>
                      <td class="num">{{ r.vol !== null ? r.vol.toFixed(2) + 'x' : '—' }}</td>
                    </tr>
                    <tr v-if="!retro.rows.length"><td colspan="6" class="empty">该新闻未直接关联个股（全市场/行业事件可查看行业指数）</td></tr>
                  </tbody>
                </table>
              </div>
              <div v-if="retro.follow.length" class="mt">
                <div class="bold small mb">后续 / 关联事件</div>
                <div v-for="f in retro.follow" :key="f.id" class="list-item small" @click="open(f.id)">{{ fmtTime(f.ts) }} · {{ f.title }}</div>
              </div>
            </div>
            <div class="divider" />
            <div v-if="sel.metrics.length" class="small mb">可能影响的指标：<span v-for="m in sel.metrics" :key="m" class="tag" style="margin-right: 4px">{{ m }}</span></div>
            <div v-if="sel.sectors.length && sel.sectors.length < 10" class="small mb">相关行业：{{ sel.sectors.map((s) => SECTOR_MAP[s as SectorId]?.name ?? s).join('、') }}</div>
            <div v-if="glossOf(sel.tags).length" class="small mb">相关概念：<span v-for="t in glossOf(sel.tags)" :key="t" style="margin-right: 8px"><Gloss :id="t" /></span></div>
            <div v-if="sel.symbols.length" class="row wrap mb">
              <span class="small muted">关联股票：</span>
              <button v-for="s in sel.symbols.slice(0, 10)" :key="s" class="btn btn-xs" @click="game.openStock(s)"><Logo :symbol="s" :size="14" />{{ s }}</button>
            </div>
            <div class="row wrap">
              <button class="btn btn-sm" :class="{ active: watched }" @click="act('watch')">{{ watched ? '★ 已加入观察' : '☆ 加入观察' }}</button>
              <button class="btn btn-sm" :disabled="!sel.symbols.length" @click="sel.symbols[0] && game.openStock(sel.symbols[0])">查看关联股票</button>
              <button class="btn btn-sm" :class="{ active: later }" @click="act('later')">{{ later ? '已标记稍后复盘' : '稍后复盘' }}</button>
            </div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.news-grid {
  display: grid;
  grid-template-columns: minmax(260px, 2fr) minmax(0, 3fr);
  gap: 12px;
  align-items: start;
}
.list {
  max-height: 72vh;
  overflow-y: auto;
}
.detail {
  position: sticky;
  top: 80px;
  max-height: 80vh;
  overflow-y: auto;
}
@media (max-width: 900px) {
  .news-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .list {
    max-height: 45vh;
  }
  .detail {
    position: static;
    max-height: none;
  }
}
</style>
