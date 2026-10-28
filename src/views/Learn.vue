<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGame } from '../store/game'
import PixelBanner from '../components/PixelBanner.vue'
import Gloss from '../components/Gloss.vue'
import Quiz from '../components/Quiz.vue'
import Modal from '../components/Modal.vue'
import { LESSON_MODULES, LESSONS, GLOSSARY, CASES } from '../engine/content/learning'
import { NPCS } from '../engine/content/npcs'
import { MISSIONS, missionAvailable, objectiveStatus, gradeQuiz, addXp, completeMissionQuiz, type WrongItem } from '../engine/profile'
import { CHALLENGES } from '../engine/challenge'
import { REGIME_LABEL } from '../engine/state'
import { ORDER_TYPE_LABEL, TIF_LABEL, STATUS_LABEL, PHASE_LABEL, tradingMinutes } from '../engine/rules'
import { fmtClock } from '../engine/clock'
import { cumulativeFees } from '../engine/trading'
import { fmtMoney, fmtPct } from '../engine/util'
import type { ChallengeDef, LessonDef, LessonModuleId, MissionDef, OrderSide, QuizQuestion } from '../engine/types'

const game = useGame()
type Tab = 'lessons' | 'missions' | 'challenges' | 'wrong' | 'cases' | 'glossary' | 'rules' | 'fees' | 'orders'
const TABS: { id: Tab; label: string }[] = [
  { id: 'lessons', label: '课程' },
  { id: 'missions', label: '任务' },
  { id: 'challenges', label: '情景挑战' },
  { id: 'wrong', label: '错题本' },
  { id: 'cases', label: '案例' },
  { id: 'glossary', label: '词典' },
  { id: 'rules', label: '规则说明' },
  { id: 'fees', label: '费用计算器' },
  { id: 'orders', label: '订单状态' },
]
const initial = TABS.find((t) => t.id === game.pageArg)?.id ?? (game.pageArg === 'wrongbook' ? 'wrong' : 'lessons')
const tab = ref<Tab>(initial)
const FLAG: Partial<Record<Tab, string>> = { wrong: 'viewed_wrongbook', cases: 'viewed_case', glossary: 'viewed_glossary', rules: 'viewed_rules', fees: 'used_fee_calculator' }
watch(
  tab,
  (t) => {
    const f = FLAG[t]
    if (f && game.engine) {
      game.engine.setFlag(f)
      game.after()
    }
  },
  { immediate: true },
)

// ---------------- 课程 ----------------
const moduleSel = ref<LessonModuleId | null>(null)
const lessonSel = ref<LessonDef | null>(null)
const advanced = ref(false)
const lessonsOf = (m: LessonModuleId) => LESSONS.filter((l) => l.module === m)
const doneCount = (m: LessonModuleId) => lessonsOf(m).filter((l) => game.profile.lessonsDone.includes(l.id)).length
function openLesson(l: LessonDef) {
  lessonSel.value = l
  advanced.value = false
}
function onLessonQuiz(l: LessonDef, answers: number[]) {
  const g = gradeQuiz(game.engine, game.profile, `课程：${l.title}`, l.quiz, answers)
  if (g.allCorrect && !game.profile.lessonsDone.includes(l.id)) {
    game.profile.lessonsDone.push(l.id)
    const r = addXp(game.profile, 25, `完成课程：${l.title}`)
    game.engine?.bump('lessonsCompleted')
    game.toast('success', `课程完成：${l.title}`, '+25 经验' + (r.leveledUp ? ` · 升级到 Lv.${r.level}` : ''))
  } else if (!g.allCorrect) game.toast('warn', '有题目答错', '错题已加入错题本，可以查看解析后重新作答。')
  void game.saveProfile()
  game.after()
}

// ---------------- 任务 ----------------
const missionGroups = computed(() => {
  game.rev
  const e = game.engine
  const groups: { module: LessonModuleId; title: string; items: { m: MissionDef; status: 'done' | 'ready' | 'active' | 'locked'; st: boolean[] }[] }[] = []
  for (const m of [...MISSIONS].sort((a, b) => a.order - b.order)) {
    let g = groups.find((x) => x.module === m.module)
    if (!g) {
      g = { module: m.module, title: LESSON_MODULES.find((x) => x.id === m.module)?.title ?? m.module, items: [] }
      groups.push(g)
    }
    const p = game.profile
    const status = p.missionsDone.includes(m.id) ? 'done' : p.missionsReady.includes(m.id) ? 'ready' : missionAvailable(m, p) ? 'active' : 'locked'
    g.items.push({ m, status, st: e ? objectiveStatus(e, p, m) : m.objectives.map(() => false) })
  }
  return groups
})
const missionPct = computed(() => game.profile.missionsDone.length / MISSIONS.length)
const npcName = (id: string) => NPCS.find((n) => n.id === id)?.name ?? id
const missionTitle = (id: string) => MISSIONS.find((m) => m.id === id)?.title ?? id
function onMissionQuiz(m: MissionDef, answers: number[]) {
  const e = game.engine
  if (!e) return
  const r = completeMissionQuiz(e, game.profile, m, answers)
  if (r.allCorrect) game.toast('success', `任务完成：${m.title}`, `+${m.rewardXp} 经验` + (r.leveledUp ? ` · 升级到 Lv.${r.leveledUp}` : ''))
  else game.toast('warn', '还有题目答错', '可以查看解析后重新作答。')
  void game.saveProfile()
  game.after()
}

// ---------------- 挑战 ----------------
const confirmCh = ref<ChallengeDef | null>(null)
function bestRecord(id: string) {
  const rs = game.profile.challengeRecords.filter((r) => r.id === id)
  return rs.find((r) => r.won) ?? rs[rs.length - 1]
}
async function startChallenge(def: ChallengeDef) {
  confirmCh.value = null
  await game.newGame({
    name: game.profile.name,
    mode: 'challenge',
    rulesId: def.rulesId ?? 'teaching',
    difficulty: 'normal',
    seed: 'CH-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    initialCash: def.startCash,
    challengeId: def.id,
  })
  game.engine?.setFlag('read_disclaimer')
  game.after()
}

// ---------------- 错题本 ----------------
const showResolved = ref(false)
const wrongList = computed(() => game.profile.wrongBook.filter((w) => w.resolved === showResolved.value).slice().reverse())
const asQ = (w: WrongItem): QuizQuestion[] => [{ id: w.qid, question: w.question, options: w.options, answer: w.answer, explanation: w.explanation }]
function onWrong(w: WrongItem, answers: number[]) {
  const g = gradeQuiz(game.engine, game.profile, w.source, asQ(w), answers)
  if (g.allCorrect) {
    game.engine?.bump('wrongReviewed')
    game.toast('success', '已掌握', '该题已移入「已掌握」。')
  }
  void game.saveProfile()
  game.after()
}

// ---------------- 案例 / 词典 ----------------
const openCase = ref<string>('')
const gq = ref('')
const glossList = computed(() => {
  const s = gq.value.trim().toLowerCase()
  return GLOSSARY.filter((g) => !s || g.term.toLowerCase().includes(s) || g.en.toLowerCase().includes(s) || g.short.includes(s)).sort((a, b) => a.term.localeCompare(b.term, 'zh'))
})
const glossSel = ref(GLOSSARY[0]?.id ?? '')
const glossEntry = computed(() => GLOSSARY.find((g) => g.id === glossSel.value))

// ---------------- 规则 ----------------
const rules = computed(() => {
  game.rev
  return game.engine?.rules
})
const range = (r: [number, number]) => `${fmtClock(r[0])} – ${fmtClock(r[1])}`

// ---------------- 费用计算器 ----------------
const feeSide = ref<OrderSide>('buy')
const feePrice = ref(20)
const feeQty = ref(1000)
const feeResult = computed(() => {
  game.rev
  const e = game.engine
  if (!e) return null
  const value = Math.round(feePrice.value * 100) * Math.max(0, Math.round(feeQty.value))
  const f = cumulativeFees(e, feeSide.value, value)
  const small = cumulativeFees(e, feeSide.value, Math.round(value / 10))
  return { value, f, tenSmall: small.total * 10, oneBig: f.total, sym: e.rules.currencySymbol }
})

// ---------------- 订单状态 ----------------
const FLOW: { from: string; to: string[]; note: string }[] = [
  { from: 'new', to: ['pendingSubmit'], note: '在订单票据中填写并确认后创建' },
  { from: 'pendingSubmit', to: ['accepted', 'rejected'], note: '交易引擎按规则检查：时段、价格、单位、资金/持仓、风险限额' },
  { from: 'accepted', to: ['waitingTrigger', 'partiallyFilled', 'filled', 'cancelPending', 'expired'], note: '已进入撮合队列，不等于已成交' },
  { from: 'waitingTrigger', to: ['accepted', 'cancelPending', 'expired'], note: '止损类订单等待最新价触及触发价' },
  { from: 'partiallyFilled', to: ['partiallyFilled', 'filled', 'cancelPending', 'expired'], note: '已成交部分保留，剩余继续挂单' },
  { from: 'cancelPending', to: ['cancelled'], note: '撤单在下一个撮合步之前处理；若已全部成交则撤单失败' },
]
const TERMINAL = ['filled', 'cancelled', 'rejected', 'expired']
</script>

<template>
  <div class="col gap-lg">
    <PixelBanner scene="academy" />
    <div class="page-title"><h1>投资学院 · 学习中心</h1><span class="muted small">所有内容只解释概念与风险，不提供买卖建议</span></div>
    <div class="tabs" role="tablist">
      <button v-for="t in TABS" :key="t.id" class="tab" :class="{ active: tab === t.id }" role="tab" @click="tab = t.id">
        {{ t.label }}<span v-if="t.id === 'wrong' && game.profile.wrongBook.some((w) => !w.resolved)" class="tag tag-danger" style="margin-left: 4px">{{ game.profile.wrongBook.filter((w) => !w.resolved).length }}</span>
      </button>
    </div>

    <!-- 课程 -->
    <template v-if="tab === 'lessons'">
      <div v-if="!moduleSel" class="auto-grid">
        <button v-for="m in LESSON_MODULES" :key="m.id" class="panel card" @click="moduleSel = m.id">
          <div class="row between"><span class="big">{{ m.icon }}</span><span class="tag">{{ doneCount(m.id) }}/{{ lessonsOf(m.id).length }}</span></div>
          <div class="bold mt-sm">{{ m.title }}</div>
          <div class="small muted">{{ m.goal }}</div>
          <div class="tiny dim mt-sm">对应操作：{{ m.gameAction }}</div>
          <div class="bar thin mt-sm"><i :style="{ width: (doneCount(m.id) / Math.max(1, lessonsOf(m.id).length)) * 100 + '%' }" /></div>
        </button>
      </div>
      <div v-else-if="!lessonSel" class="col">
        <div><button class="btn btn-sm btn-ghost" @click="moduleSel = null">← 返回模块</button></div>
        <div v-for="l in lessonsOf(moduleSel)" :key="l.id" class="panel list-item" @click="openLesson(l)">
          <div class="row between"><span class="bold">{{ l.title }}</span><span v-if="game.profile.lessonsDone.includes(l.id)" class="tag tag-ok">已完成</span></div>
          <div class="small muted">{{ l.keyPoints[0] }}</div>
        </div>
      </div>
      <div v-else class="panel">
        <div class="row between wrap mb">
          <button class="btn btn-sm btn-ghost" @click="lessonSel = null">← 返回课程列表</button>
          <div class="seg"><button :class="{ active: !advanced }" @click="advanced = false">简明</button><button :class="{ active: advanced }" @click="advanced = true">进阶</button></div>
        </div>
        <h2>{{ lessonSel.title }} <span v-if="game.profile.lessonsDone.includes(lessonSel.id)" class="tag tag-ok">已完成</span></h2>
        <div class="prose"><p v-for="(p, i) in (advanced ? lessonSel.advanced : lessonSel.simple).split('\n\n')" :key="i">{{ p }}</p></div>
        <div class="section-title">要点</div>
        <ul class="small"><li v-for="(k, i) in lessonSel.keyPoints" :key="i">{{ k }}</li></ul>
        <div class="note mt">🎮 {{ lessonSel.practice }}</div>
        <div class="chip-list mt"><Gloss v-for="g in lessonSel.glossary" :key="g" :id="g" /></div>
        <div class="section-title mt">小测验</div>
        <Quiz :key="lessonSel.id" :questions="lessonSel.quiz" @submit="(a) => onLessonQuiz(lessonSel!, a)" />
      </div>
    </template>

    <!-- 任务 -->
    <template v-else-if="tab === 'missions'">
      <div class="panel">
        <div class="row between"><span class="bold">任务进度 {{ game.profile.missionsDone.length }} / {{ MISSIONS.length }}</span><span class="muted small">{{ fmtPct(missionPct, 0, false) }}</span></div>
        <div class="bar mt-sm"><i :style="{ width: missionPct * 100 + '%' }" /></div>
      </div>
      <div v-for="g in missionGroups" :key="g.module" class="col">
        <div class="section-title">{{ g.title }}</div>
        <div v-for="x in g.items" :key="x.m.id" class="panel" :class="{ locked: x.status === 'locked' }">
          <div class="row between wrap">
            <span class="bold">{{ x.m.title }}</span>
            <span class="row gap-sm">
              <span class="tag">+{{ x.m.rewardXp }} XP</span>
              <span class="tag" :class="{ 'tag-ok': x.status === 'done', 'tag-accent': x.status === 'ready', 'tag-info': x.status === 'active' }">{{ { done: '已完成', ready: '待答题', active: '进行中', locked: '未解锁' }[x.status] }}</span>
            </span>
          </div>
          <div class="tiny muted">发布人：{{ npcName(x.m.npc) }}</div>
          <p class="small mt-sm">{{ x.m.brief }}</p>
          <div v-if="x.status === 'locked'" class="tiny dim">前置任务：{{ (x.m.prerequisites ?? []).map(missionTitle).join('、') }}</div>
          <template v-else>
            <div v-for="(o, i) in x.m.objectives" :key="i" class="small" :class="x.status === 'done' || x.st[i] ? 'ok' : 'muted'">{{ x.status === 'done' || x.st[i] ? '☑' : '☐' }} {{ o.text }}</div>
            <div v-if="x.status === 'active'" class="note mt-sm">提示：{{ x.m.hint }}</div>
            <div class="chip-list mt-sm"><Gloss v-for="g2 in x.m.learnMore" :key="g2" :id="g2" /></div>
            <div v-if="x.status === 'ready' && x.m.quiz" class="mt">
              <div class="section-title">完成小测验以领取奖励</div>
              <Quiz :questions="x.m.quiz" @submit="(a) => onMissionQuiz(x.m, a)" />
            </div>
          </template>
        </div>
      </div>
    </template>

    <!-- 挑战 -->
    <template v-else-if="tab === 'challenges'">
      <div class="note">挑战不会只看收益：回撤、分散度、费用、现金余量、复盘和答题同样计入结果。</div>
      <div class="grid-2">
        <div v-for="c in CHALLENGES" :key="c.id" class="panel col">
          <div class="row between"><span class="bold">{{ c.title }}</span><span class="accent">{{ '★'.repeat(c.difficulty) }}{{ '☆'.repeat(5 - c.difficulty) }}</span></div>
          <div class="small muted">{{ c.subtitle }}</div>
          <p class="small">{{ c.story }}</p>
          <div class="tiny">{{ c.days }} 个交易日 · 初始 {{ fmtMoney(c.startCash * 100) }} · 市场：{{ REGIME_LABEL[c.regime] }}<span v-if="c.allowMargin"> · 允许保证金</span></div>
          <ul class="small" style="margin: 0; padding-left: 18px">
            <li v-for="(g, i) in c.goals" :key="i">{{ g.label }} <span class="tag" :class="g.required ? 'tag-accent' : ''">{{ g.required ? '必须' : '加分' }}</span></li>
          </ul>
          <div class="chip-list"><span v-for="t in c.tags" :key="t" class="tag">{{ t }}</span></div>
          <div v-if="bestRecord(c.id)" class="tiny" :class="bestRecord(c.id)!.won ? 'ok' : 'warn'">
            最佳记录：{{ bestRecord(c.id)!.won ? '通过' : '未通过' }} · {{ new Date(bestRecord(c.id)!.at).toLocaleDateString() }} ·
            {{ bestRecord(c.id)!.metrics.slice(0, 4).map((m) => m.label + ' ' + m.value).join(' / ') }}
          </div>
          <div class="row end"><button class="btn btn-primary btn-sm" @click="confirmCh = c">开始挑战</button></div>
        </div>
      </div>
    </template>

    <!-- 错题本 -->
    <template v-else-if="tab === 'wrong'">
      <div class="seg"><button :class="{ active: !showResolved }" @click="showResolved = false">待复习</button><button :class="{ active: showResolved }" @click="showResolved = true">已掌握</button></div>
      <div v-if="!wrongList.length" class="empty">{{ showResolved ? '还没有已掌握的错题' : '没有待复习的错题 👍' }}</div>
      <div v-for="w in wrongList" :key="w.qid" class="panel">
        <div class="tiny muted mb">{{ w.source }} · {{ new Date(w.at).toLocaleString() }} · 当时选择：{{ w.options[w.chosen] ?? '—' }}</div>
        <Quiz v-if="!w.resolved" :questions="asQ(w)" @submit="(a) => onWrong(w, a)" />
        <template v-else>
          <div class="bold">{{ w.question }}</div>
          <div class="small ok mt-sm">正确答案：{{ w.options[w.answer] }}</div>
          <div class="note mt-sm">{{ w.explanation }}</div>
        </template>
      </div>
    </template>

    <!-- 案例 -->
    <template v-else-if="tab === 'cases'">
      <div v-for="c in CASES" :key="c.id" class="panel">
        <div class="bold">{{ c.title }}</div>
        <p class="small mt-sm prose">{{ c.story }}</p>
        <div class="note">🤔 {{ c.question }}</div>
        <button class="btn btn-sm btn-ghost mt-sm" @click="openCase = openCase === c.id ? '' : c.id">{{ openCase === c.id ? '收起讨论' : '展开讨论' }}</button>
        <p v-if="openCase === c.id" class="small prose mt-sm">{{ c.discussion }}</p>
        <div class="chip-list"><span v-for="t in c.tags" :key="t" class="tag">{{ t }}</span></div>
      </div>
    </template>

    <!-- 词典 -->
    <template v-else-if="tab === 'glossary'">
      <div class="grid-2 gloss-grid">
        <div class="panel flush">
          <div style="padding: 8px"><input v-model="gq" placeholder="搜索术语、英文或释义…" style="width: 100%" /></div>
          <div class="scroll-y" style="max-height: 60vh">
            <div v-for="g in glossList" :key="g.id" class="list-item" :class="{ active: glossSel === g.id }" @click="glossSel = g.id">
              <span class="bold">{{ g.term }}</span> <span class="tiny muted">{{ g.en }}</span>
              <div class="tiny muted ellipsis">{{ g.short }}</div>
            </div>
          </div>
        </div>
        <div v-if="glossEntry" class="panel">
          <h2>{{ glossEntry.term }}</h2>
          <div class="muted small mb">{{ glossEntry.en }}</div>
          <p class="bold">{{ glossEntry.short }}</p>
          <div class="prose"><p v-for="(p, i) in glossEntry.detail.split('\n')" :key="i">{{ p }}</p></div>
          <div v-if="glossEntry.example" class="note">例：{{ glossEntry.example }}</div>
        </div>
      </div>
    </template>

    <!-- 规则说明 -->
    <template v-else-if="tab === 'rules'">
      <div v-if="rules" class="col">
        <div class="panel">
          <h2>{{ rules.name }}</h2>
          <div class="kv">
            <span>版本</span><span>{{ rules.version }}</span>
            <span>参数日期</span><span>{{ rules.effectiveDate }}</span>
            <span>来源</span><span>{{ rules.source }}</span>
            <span>时区 / 货币</span><span>{{ rules.timezone }} / {{ rules.currency }}</span>
          </div>
          <div class="note warn mt">真实市场的交易规则、费率与交收安排会随监管调整而变化。本规则包是教学用途的参数化近似，若要了解现行规则，请以交易所、监管机构和券商的最新官方资料为准。</div>
        </div>
        <div class="grid-2">
          <div class="panel">
            <div class="section-title">交易时段</div>
            <div class="kv">
              <span>{{ PHASE_LABEL.preopen }}</span><span>{{ range(rules.sessions.preopen) }}</span>
              <span>{{ PHASE_LABEL.opening }}</span><span>{{ range(rules.sessions.opening) }}{{ rules.sessions.openingAuction ? '（集合竞价）' : '' }}</span>
              <template v-for="(c, i) in rules.sessions.continuous" :key="i"><span>{{ PHASE_LABEL.continuous }} {{ i + 1 }}</span><span>{{ range(c) }}</span></template>
              <span>{{ PHASE_LABEL.closing }}</span><span>{{ range(rules.sessions.closing) }}{{ rules.sessions.closingAuction ? '（集合竞价）' : '' }}</span>
              <span>{{ PHASE_LABEL.postclose }}</span><span>{{ range(rules.sessions.postclose) }}</span>
              <span>每日交易分钟</span><span>{{ tradingMinutes(rules) }}</span>
              <span>休市</span><span>周末及 {{ rules.holidays.join('、') }}</span>
            </div>
          </div>
          <div class="panel">
            <div class="section-title">数量与价格</div>
            <div class="kv">
              <span>最小价格变动</span><span>{{ (rules.tickSize / 100).toFixed(2) }}</span>
              <span>买入最小单位</span><span>{{ rules.lotSize }} 股</span>
              <span>零股卖出</span><span>{{ rules.oddLotSellAllowed ? '允许一次性卖出' : '不允许' }}</span>
              <span>涨跌幅限制</span><span>{{ rules.priceLimit.enabled ? `±${(rules.priceLimit.pct * 100).toFixed(0)}%，风险警示股 ±${(rules.priceLimit.riskWarningPct * 100).toFixed(0)}%` : '无' }}</span>
              <span>交收</span><span>{{ rules.settlement.label }}（买入 {{ rules.settlement.sharesSellableAfterDays }} 个交易日后可卖）</span>
              <span>单笔风险限额</span><span>净值的 {{ (rules.riskLimit.maxOrderPctOfEquity * 100).toFixed(0) }}%</span>
              <span>涨跌颜色</span><span>{{ rules.colorConvention === 'redUp' ? '红涨绿跌' : '绿涨红跌' }}（可在设置中切换）</span>
            </div>
          </div>
          <div class="panel">
            <div class="section-title">订单</div>
            <div class="kv">
              <span>订单类型</span><span>{{ rules.orderTypes.map((t) => ORDER_TYPE_LABEL[t]).join('、') }}</span>
              <span>有效期</span><span>{{ rules.tifs.map((t) => TIF_LABEL[t]).join('、') }}</span>
              <span>市价单剩余</span><span>{{ rules.marketRemainder === 'cancel' ? '自动撤销' : '当日内继续撮合' }}</span>
              <span>撤销前有效最长</span><span>{{ rules.maxGtcDays }} 个交易日</span>
              <span>止损触发依据</span><span>最新成交价</span>
            </div>
            <div class="tiny muted mt-sm">各阶段可提交的订单类型：</div>
            <div v-for="(types, ph) in rules.phaseOrderTypes" :key="ph" class="tiny">{{ PHASE_LABEL[ph] }}：{{ (types ?? []).map((t) => ORDER_TYPE_LABEL[t]).join('、') || '—' }}</div>
          </div>
          <div class="panel">
            <div class="section-title">费用（{{ rules.fees.version }}）</div>
            <div class="kv">
              <span>佣金</span><span>{{ (rules.fees.commissionRate * 10000).toFixed(2) }}‱，最低 {{ fmtMoney(rules.fees.minCommission, rules.currencySymbol) }}</span>
              <span>经手费</span><span>{{ (rules.fees.exchangeFeeRate * 10000).toFixed(3) }}‱（双向）</span>
              <span>监管费</span><span>{{ (rules.fees.regulatoryFeeRate * 10000).toFixed(3) }}‱（卖出）</span>
              <span>印花税</span><span>{{ (rules.fees.stampTaxSellRate * 1000).toFixed(2) }}‰（卖出）</span>
              <span>过户费</span><span>{{ (rules.fees.transferFeeRate * 10000).toFixed(3) }}‱（双向）</span>
              <span>部分成交计费</span><span>按订单累计成交额计算，每笔收取差额</span>
              <span>股息税</span><span>{{ (rules.dividendTaxRate * 100).toFixed(0) }}%</span>
            </div>
          </div>
          <div class="panel">
            <div class="section-title">保证金与卖空</div>
            <div class="kv">
              <span>卖空</span><span>{{ rules.shortSelling.enabled ? `允许（基础借券费年化 ${(rules.shortSelling.baseBorrowRate * 100).toFixed(1)}%）` : '未启用' }}</span>
              <span>保证金</span><span>{{ rules.margin.enabled ? '允许（需开启进阶模式）' : '未启用' }}</span>
              <template v-if="rules.margin.enabled">
                <span>初始保证金</span><span>{{ (rules.margin.initialMargin * 100).toFixed(0) }}%</span>
                <span>维持保证金</span><span>{{ (rules.margin.maintenanceMargin * 100).toFixed(0) }}%</span>
                <span>强制平仓线</span><span>{{ (rules.margin.liquidationMargin * 100).toFixed(0) }}%</span>
                <span>融资利率</span><span>年化 {{ (rules.margin.interestRate * 100).toFixed(1) }}%</span>
                <span>追保宽限期</span><span>{{ rules.margin.callGraceDays }} 个交易日</span>
              </template>
            </div>
          </div>
          <div class="panel">
            <div class="section-title">简化说明</div>
            <ul class="small" style="margin: 0; padding-left: 18px"><li v-for="(n, i) in rules.notes" :key="i">{{ n }}</li></ul>
          </div>
        </div>
      </div>
    </template>

    <!-- 费用计算器 -->
    <template v-else-if="tab === 'fees'">
      <div v-if="feeResult" class="grid-2">
        <div class="panel col">
          <div class="section-title">参数</div>
          <div class="seg"><button v-for="s in ['buy', 'sell'] as OrderSide[]" :key="s" :class="{ active: feeSide === s }" @click="feeSide = s">{{ s === 'buy' ? '买入' : '卖出' }}</button></div>
          <label class="field"><span>成交价格</span><input v-model.number="feePrice" type="number" min="0.01" step="0.01" /></label>
          <label class="field"><span>成交数量（股）</span><input v-model.number="feeQty" type="number" min="1" step="1" /></label>
          <div class="kv mt">
            <span>成交金额</span><span>{{ fmtMoney(feeResult.value, feeResult.sym) }}</span>
            <span>佣金</span><span>{{ fmtMoney(feeResult.f.commission, feeResult.sym) }}</span>
            <span>经手费</span><span>{{ fmtMoney(feeResult.f.exchangeFee, feeResult.sym) }}</span>
            <span>监管费</span><span>{{ fmtMoney(feeResult.f.regulatoryFee, feeResult.sym) }}</span>
            <span>印花税</span><span>{{ fmtMoney(feeResult.f.stampTax, feeResult.sym) }}</span>
            <span>过户费</span><span>{{ fmtMoney(feeResult.f.transferFee, feeResult.sym) }}</span>
            <span class="bold">合计</span><span class="bold">{{ fmtMoney(feeResult.f.total, feeResult.sym) }}（{{ fmtPct(feeResult.f.total / Math.max(1, feeResult.value), 3, false) }}）</span>
          </div>
        </div>
        <div class="panel col">
          <div class="section-title">频繁小额 vs 一次性交易</div>
          <div class="kv">
            <span>分 10 笔，每笔 {{ fmtMoney(Math.round(feeResult.value / 10), feeResult.sym) }}</span><span>{{ fmtMoney(feeResult.tenSmall, feeResult.sym) }}</span>
            <span>1 笔 {{ fmtMoney(feeResult.value, feeResult.sym) }}</span><span>{{ fmtMoney(feeResult.oneBig, feeResult.sym) }}</span>
            <span class="bold">差额</span><span class="bold warn">{{ fmtMoney(feeResult.tenSmall - feeResult.oneBig, feeResult.sym) }}</span>
          </div>
          <div class="note mt">
            每笔订单都有最低佣金。成交金额较小时，最低佣金在成交额中的占比会明显升高，频繁的小额交易会累积可观的费用。这里只比较费用，不代表哪种交易方式更好——分批交易也可能有控制价格与风险的好处。
          </div>
          <div class="chip-list"><Gloss id="commission" /><Gloss id="stamp_tax" /><Gloss id="overtrading" /></div>
        </div>
      </div>
      <div v-else class="empty">开局后可使用费用计算器</div>
    </template>

    <!-- 订单状态 -->
    <template v-else-if="tab === 'orders'">
      <div class="panel">
        <p class="small">订单从创建到结束会经历以下状态。每次状态变化都会记录时间、原因、成交数量、剩余数量与费用，可在订单详情中查看。<Gloss id="partial_fill" />、<Gloss id="cancel_order" />、<Gloss id="tif" />、<Gloss id="limit_order" />、<Gloss id="stop_order" /></p>
        <div class="col">
          <div v-for="f in FLOW" :key="f.from" class="row wrap flow">
            <span class="state">{{ STATUS_LABEL[f.from] }}</span>
            <span class="muted">→</span>
            <span v-for="t in f.to" :key="t" class="state" :class="{ term: TERMINAL.includes(t) }">{{ STATUS_LABEL[t] }}</span>
            <span class="tiny muted grow">{{ f.note }}</span>
          </div>
        </div>
        <div class="note mt">终止状态（不可再变化）：<span v-for="t in TERMINAL" :key="t" class="state term">{{ STATUS_LABEL[t] }}</span>。例如「已拒绝」的订单不可能再变为「全部成交」；撤单只解冻未成交部分，已成交部分保留在成交记录中。</div>
        <div class="section-title mt">常见拒单原因</div>
        <ul class="small" style="margin: 0; padding-left: 18px">
          <li>可用现金不足 / 持仓或可卖数量不足（例如 T+1 下当日买入的股份）</li>
          <li>市场休市时提交市价单；股票停牌或已退市</li>
          <li>数量不是最小交易单位的整数倍；价格不符合最小变动单位或超出涨跌幅限制</li>
          <li>超过单笔风险限额；该订单类型在当前阶段不可用</li>
        </ul>
      </div>
    </template>

    <Modal v-if="confirmCh" :title="`开始挑战：${confirmCh.title}`" size="narrow" @close="confirmCh = null">
      <p>开始挑战会生成新的市场世界，并替换当前「自动存档」。</p>
      <p class="small muted">如需保留当前进度，可以考虑先在「投资者公寓 · 存档」中手动保存。档案（等级、成就、学习进度）不受影响。</p>
      <template #footer>
        <button class="btn btn-ghost" @click="game.go('home', 'saves')">去手动存档</button>
        <button class="btn btn-ghost" @click="confirmCh = null">取消</button>
        <button class="btn btn-primary" @click="startChallenge(confirmCh!)">确认开始</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.card { text-align: left; cursor: pointer; color: var(--text); border: 0; font-family: var(--font-body); display: flex; flex-direction: column; }
.card:hover { box-shadow: 0 0 0 2px var(--accent), 4px 4px 0 2px var(--shadow); }
.big { font-size: 1.8em; }
.locked { opacity: 0.55; }
.state { display: inline-block; padding: 3px 8px; background: var(--panel3); box-shadow: 0 0 0 2px var(--border-hi); font-weight: 700; font-size: 0.85em; margin: 2px; }
.state.term { box-shadow: 0 0 0 2px var(--accent); color: var(--accent); }
.flow { padding: 4px 0; border-bottom: 1px dashed var(--border); }
.gloss-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); }
@media (max-width: 700px) { .gloss-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
