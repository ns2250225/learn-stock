<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useGame } from '../store/game'
import { useSettings, SHORTCUT_ACTIONS, DEFAULT_SHORTCUTS, type ColorScheme } from '../store/settings'
import PixelBanner from '../components/PixelBanner.vue'
import Avatar from '../components/Avatar.vue'
import Modal from '../components/Modal.vue'
import { ACHIEVEMENTS, levelProgress, levelTitle } from '../engine/profile'
import { disciplineScore } from '../engine/review'
import { CHALLENGE_MAP } from '../engine/challenge'
import { LESSONS } from '../engine/content/learning'
import { RULE_PACKS } from '../engine/rules'
import { DIFFICULTY_PARAMS, UNLOCKS } from '../engine/params'
import { downloadText, fmtMoney } from '../engine/util'

const game = useGame()
const settings = useSettings()
const s = settings.s
type Tab = 'profile' | 'achievements' | 'records' | 'saves' | 'settings' | 'world'
const tab = ref<Tab>((['profile', 'achievements', 'records', 'saves', 'settings', 'world'] as Tab[]).includes(game.pageArg as Tab) ? (game.pageArg as Tab) : 'profile')

// ---------------------------------------------------------------- 形象
const SKINS = ['#f2c9a0', '#e0ac69', '#c68642', '#8d5524', '#ffdbac']
const HAIRS = ['#3b2a20', '#2b2b2b', '#d9d9d9', '#b5523b', '#f4c95d', '#6a4c93']
const SHIRTS: { c: string; lv: number }[] = [
  { c: '#4fc3f7', lv: 1 }, { c: '#e57373', lv: 1 }, { c: '#81c784', lv: 1 }, { c: '#ffb74d', lv: 2 },
  { c: '#9575cd', lv: 3 }, { c: '#f4c95d', lv: 4 }, { c: '#222222', lv: 6 },
]
const PANTS = ['#2b3a67', '#3b2a20', '#555555', '#1d3557']
const HATS: { c: string; lv: number; label: string }[] = [
  { c: 'none', lv: 1, label: '无' }, { c: '#c1121f', lv: 2, label: '红帽' }, { c: '#2a9d8f', lv: 3, label: '青帽' },
  { c: '#f4c95d', lv: 5, label: '金帽' }, { c: '#111111', lv: 7, label: '礼帽' },
]
function setAvatar(k: keyof typeof game.profile.avatar, v: string) {
  game.profile.avatar[k] = v
  game.engine?.setFlag('customized_avatar')
  void game.saveProfile()
  game.after()
}
const lp = computed(() => levelProgress(game.profile.xp))
const disc = computed(() => {
  game.rev
  return disciplineScore(game.engine!)
})
const unlockList = computed(() => Object.entries(UNLOCKS).map(([k, u]) => ({ k, ...u, ok: game.engine!.isUnlocked(k) })))

// ---------------------------------------------------------------- 成就
const achievements = computed(() =>
  ACHIEVEMENTS.map((a) => ({ a, at: game.profile.achievements[a.id] })).sort((x, y) => (x.at ? 0 : 1) - (y.at ? 0 : 1)),
)

// ---------------------------------------------------------------- 挑战记录
function metric(r: (typeof game.profile.challengeRecords)[number], label: string) {
  return r.metrics.find((m) => m.label === label)?.value ?? '—'
}
const records = computed(() => [...game.profile.challengeRecords].reverse())
const leaderboard = computed(() => {
  const best: Record<string, (typeof game.profile.challengeRecords)[number]> = {}
  for (const r of game.profile.challengeRecords) {
    const cur = best[r.id]
    const ex = parseFloat(metric(r, '超额收益'))
    if (!cur || (r.won && !cur.won) || (r.won === cur.won && ex > parseFloat(metric(cur, '超额收益')))) best[r.id] = r
  }
  return Object.values(best)
})
function compliance(r: (typeof game.profile.challengeRecords)[number]) {
  const req = r.results.filter((x) => x.required)
  return `${req.filter((x) => x.pass).length}/${req.length}`
}

// ---------------------------------------------------------------- 存档
const SLOT_NAMES = ['auto', 'slot1', 'slot2', 'slot3']
const slotMeta = (slot: string) => game.slots.find((m) => m.slot === slot)
const confirmLoad = ref('')
const importMsg = ref<{ ok: boolean; text: string } | null>(null)
const withProfile = ref(true)
const resetOpen = ref(false)
const resetText = ref('')
const newGameOpen = ref(false)
onMounted(() => void game.refreshSlots())
async function doLoad() {
  const slot = confirmLoad.value
  confirmLoad.value = ''
  const ok = await game.loadSlot(slot)
  game.toast(ok ? 'success' : 'danger', ok ? '存档已读取' : '读取失败', ok ? `已从「${slot}」恢复` : '该存档不存在或已损坏')
}
async function onImport(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0]
  ;(ev.target as HTMLInputElement).value = ''
  if (!f) return
  if (f.size > 40 * 1024 * 1024) {
    importMsg.value = { ok: false, text: '文件过大（上限 40MB），当前存档未受影响。' }
    return
  }
  const text = await f.text()
  const r = await game.importSave(text, withProfile.value)
  importMsg.value = { ok: r.ok, text: r.ok ? r.message : `${r.message}。当前有效存档未被覆盖。` }
}
async function doReset() {
  resetOpen.value = false
  resetText.value = ''
  await game.resetAll()
}
function exportSave() {
  game.exportSave()
  game.engine?.setFlag('exported_journal')
  game.after()
}

// ---------------------------------------------------------------- 设置
const schemes: { v: ColorScheme; label: string }[] = [
  { v: 'auto', label: '跟随规则包' },
  { v: 'redUp', label: '红涨绿跌（A 股习惯）' },
  { v: 'greenUp', label: '绿涨红跌（美股习惯）' },
  { v: 'colorblind', label: '色盲友好（蓝涨橙跌）' },
]
const capturing = ref('')
function capture(ev: KeyboardEvent, act: string) {
  ev.preventDefault()
  ev.stopPropagation()
  if (ev.key === 'Escape') {
    capturing.value = ''
    return
  }
  s.shortcuts[act] = ev.key === 'Backspace' ? '' : ev.key.length === 1 ? ev.key.toLowerCase() : ev.key
  capturing.value = ''
}
function keyLabel(k: string) {
  return k === ' ' ? '空格' : k || '（未设置）'
}

// ---------------------------------------------------------------- 进阶模式
const marginOpen = ref(false)
const marginAck = ref(false)
const marginInfo = computed(() => {
  game.rev
  const e = game.engine!
  const lessonDone = LESSONS.some((l) => l.module === 'advanced_margin' && game.profile.lessonsDone.includes(l.id))
  const unlocked = e.isUnlocked('advancedMode') || lessonDone || !!e.w.flags.challenge_allow_margin
  return { enabled: e.w.account.marginEnabled, unlocked, rulesOk: e.rules.margin.enabled && e.rules.shortSelling.enabled, m: e.rules.margin, rules: e.rules.name, lessonDone }
})
function enableMargin() {
  const r = game.engine!.setMargin(true)
  marginOpen.value = false
  marginAck.value = false
  game.toast(r.ok ? 'warn' : 'danger', r.ok ? '进阶模式已开启' : '无法开启', r.message)
  game.after()
}
function disableMargin() {
  const r = game.engine!.setMargin(false)
  game.toast(r.ok ? 'info' : 'danger', r.ok ? '进阶模式已关闭' : '无法关闭', r.message)
  game.after()
}

// ---------------------------------------------------------------- 世界
const world = computed(() => {
  game.rev
  const e = game.engine!
  const m = e.w.meta
  return { m, rules: RULE_PACKS[m.rulesId], diff: DIFFICULTY_PARAMS[m.difficulty], initial: fmtMoney(m.initialCash, e.rules.currencySymbol) }
})
function exportDebug() {
  const e = game.engine!
  const attr = Object.fromEntries(Object.values(e.w.stocks).map((st) => [st.symbol, { attrHistory: st.attrHistory, moves: st.moves }]))
  downloadText(
    `pixel-stock-debug-${e.w.meta.worldSeed}-D${e.w.clock.tradingDay}.json`,
    JSON.stringify({ note: '模拟引擎调试日志（虚构数据）', seed: e.w.meta.worldSeed, rulesVersion: e.w.meta.rulesVersion, debug: e.w.debug, commandLog: e.w.commandLog, attribution: attr }, null, 1),
    'application/json',
  )
}
function saveName() {
  void game.saveProfile()
}
</script>

<template>
  <div>
    <PixelBanner scene="apartment" />
    <div class="page-title"><h1>投资者公寓</h1><span class="muted small">个人档案 · 成就 · 存档与设置</span></div>
    <div class="tabs" role="tablist">
      <button v-for="t in [['profile', '形象与档案'], ['achievements', '成就'], ['records', '挑战记录'], ['saves', '存档'], ['settings', '设置'], ['world', '世界信息']]" :key="t[0]" class="tab" :class="{ active: tab === t[0] }" @click="tab = t[0] as Tab">
        {{ t[1] }}
      </button>
    </div>

    <!-- 形象与档案 -->
    <div v-if="tab === 'profile'" class="grid-2">
      <section class="panel">
        <div class="panel-h"><span class="title">Avatar</span></div>
        <div class="row top gap-lg wrap">
          <Avatar :avatar="game.profile.avatar" :size="120" />
          <div class="col grow">
            <div v-for="row in [['skin', '肤色', SKINS.map((c) => ({ c, lv: 1 }))], ['hair', '发色', HAIRS.map((c) => ({ c, lv: 1 }))], ['shirt', '上衣', SHIRTS], ['pants', '裤子', PANTS.map((c) => ({ c, lv: 1 }))]] as const" :key="row[0]" class="row wrap gap-sm">
              <span class="small muted" style="width: 36px">{{ row[1] }}</span>
              <button
                v-for="o in row[2]"
                :key="o.c"
                class="swatch"
                :class="{ sel: game.profile.avatar[row[0]] === o.c }"
                :style="{ background: o.c }"
                :disabled="game.level < o.lv"
                :title="game.level < o.lv ? `Lv.${o.lv} 解锁` : o.c"
                @click="setAvatar(row[0], o.c)"
              >
                <span v-if="game.level < o.lv">🔒</span>
              </button>
            </div>
            <div class="row wrap gap-sm">
              <span class="small muted" style="width: 36px">帽子</span>
              <button v-for="h in HATS" :key="h.c" class="btn btn-xs" :class="{ active: game.profile.avatar.hat === h.c }" :disabled="game.level < h.lv" @click="setAvatar('hat', h.c)">
                {{ h.label }}<template v-if="game.level < h.lv"> 🔒Lv.{{ h.lv }}</template>
              </button>
            </div>
          </div>
        </div>
        <div class="tiny muted mt">外观仅为装饰，不影响模拟行情或任何交易结果。</div>
      </section>
      <section class="panel">
        <div class="panel-h"><span class="title">Profile</span></div>
        <label class="field"><span>名称</span><input v-model="game.profile.name" maxlength="20" @change="saveName" /></label>
        <div class="mt">
          <div class="row between"><span class="bold accent">Lv.{{ lp.lv }} {{ levelTitle(lp.lv) }}</span><span class="small muted">{{ game.profile.xp }} XP<template v-if="lp.next"> / {{ lp.next }}</template></span></div>
          <div class="bar mt-sm"><i :style="{ width: lp.pct * 100 + '%' }" /></div>
        </div>
        <div class="mt">
          <div class="row between"><span class="bold">交易纪律分</span><span class="mid-num accent">{{ disc.score }}</span></div>
          <div class="tiny muted mb">由可验证的过程指标构成，不包含收益率。</div>
          <div v-for="p in disc.parts" :key="p.label" class="row small">
            <span class="grow">{{ p.label }}（权重 {{ (p.weight * 100).toFixed(0) }}%）</span>
            <div class="bar thin" style="width: 90px"><i :style="{ width: p.value * 100 + '%' }" /></div>
            <span class="num" style="width: 40px; text-align: right">{{ (p.value * 100).toFixed(0) }}%</span>
          </div>
        </div>
        <div class="mt">
          <div class="bold small mb">工具解锁</div>
          <div class="chip-list">
            <span v-for="u in unlockList" :key="u.k" class="tag" :class="u.ok ? 'tag-ok' : ''">{{ u.ok ? '✔' : '🔒' }} {{ u.label }}（Lv.{{ u.level }}）</span>
          </div>
          <div class="tiny muted mt-sm">升级只解锁分析工具、资料与外观，不提供任何价格优势或必胜提示。</div>
        </div>
      </section>
    </div>

    <!-- 成就 -->
    <section v-if="tab === 'achievements'" class="panel">
      <div class="panel-h"><span class="title">Achievements</span><span class="small muted">{{ Object.keys(game.profile.achievements).length }} / {{ ACHIEVEMENTS.length }}</span></div>
      <div class="auto-grid">
        <div v-for="x in achievements" :key="x.a.id" class="panel inset ach" :class="{ locked: !x.at }">
          <div class="row">
            <span class="ico">{{ x.at || !x.a.hidden ? x.a.icon : '❔' }}</span>
            <div class="grow">
              <div class="bold">{{ x.at || !x.a.hidden ? x.a.title : '???' }}</div>
              <div class="tiny muted">{{ x.at || !x.a.hidden ? x.a.description : '隐藏成就：满足特定条件后揭晓' }}</div>
            </div>
          </div>
          <div class="tiny mt-sm" :class="x.at ? 'ok' : 'dim'">{{ x.at ? '解锁于 ' + new Date(x.at).toLocaleString() : '未解锁' }}</div>
        </div>
      </div>
    </section>

    <!-- 挑战记录 -->
    <div v-if="tab === 'records'" class="col gap-lg">
      <section class="panel">
        <div class="panel-h"><span class="title">Leaderboard</span><span class="tiny muted">本地记录 · 每个挑战的最佳成绩</span></div>
        <div class="note mb">排行同时展示收益、回撤、波动、相对基准表现、交易频率与规则遵守度——不只奖励短期收益。</div>
        <div v-if="!leaderboard.length" class="empty">暂无挑战记录，可在学习中心开始情景挑战。</div>
        <div v-else class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr><th>挑战</th><th>结果</th><th class="num">收益率</th><th class="num">最大回撤</th><th class="num">波动率</th><th class="num">超额收益</th><th class="num">成交数</th><th class="num">必选目标</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in leaderboard" :key="r.id + r.at">
                <td>{{ CHALLENGE_MAP[r.id]?.title ?? r.id }}</td>
                <td><span class="tag" :class="r.won ? 'tag-ok' : 'tag-danger'">{{ r.won ? '达成' : '未达成' }}</span></td>
                <td class="num">{{ metric(r, '收益率') }}</td>
                <td class="num">{{ metric(r, '最大回撤') }}</td>
                <td class="num">{{ metric(r, '年化波动率') }}</td>
                <td class="num">{{ metric(r, '超额收益') }}</td>
                <td class="num">{{ metric(r, '成交订单数') }}</td>
                <td class="num">{{ compliance(r) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <div class="panel-h"><span class="title">History</span></div>
        <div v-if="!records.length" class="empty">暂无记录</div>
        <div v-for="r in records" :key="r.at" class="list-item" style="cursor: default">
          <div class="row between">
            <b>{{ CHALLENGE_MAP[r.id]?.title ?? r.id }}</b>
            <span class="tiny muted">{{ new Date(r.at).toLocaleString() }} · 种子 {{ r.seed }}</span>
          </div>
          <div class="chip-list mt-sm">
            <span v-for="g in r.results" :key="g.label" class="tag" :class="g.pass ? 'tag-ok' : g.required ? 'tag-danger' : ''">{{ g.pass ? '✔' : '✘' }} {{ g.label }}</span>
          </div>
          <div class="tiny muted mt-sm">{{ r.metrics.map((m) => `${m.label} ${m.value}`).join(' · ') }}</div>
        </div>
      </section>
    </div>

    <!-- 存档 -->
    <div v-if="tab === 'saves'" class="grid-2">
      <section class="panel">
        <div class="panel-h"><span class="title">Save Slots</span><span class="tiny muted">最近自动保存：{{ game.lastSaved || '—' }}</span></div>
        <div v-if="game.saveError" class="note danger mb">{{ game.saveError }}</div>
        <div v-for="slot in SLOT_NAMES" :key="slot" class="list-item" style="cursor: default">
          <div class="row between wrap">
            <div>
              <b>{{ slot === 'auto' ? '自动存档' : '手动存档 ' + slot.slice(4) }}</b>
              <div v-if="slotMeta(slot)" class="tiny muted">
                {{ slotMeta(slot)!.name }} · 交易日 #{{ slotMeta(slot)!.tradingDay }} · 净值 {{ fmtMoney(slotMeta(slot)!.equity) }} · {{ new Date(slotMeta(slot)!.savedAt).toLocaleString() }}
              </div>
              <div v-else class="tiny dim">空</div>
            </div>
            <div class="row">
              <button v-if="slot !== 'auto'" class="btn btn-xs" @click="game.saveToSlot(slot)">保存到此</button>
              <button class="btn btn-xs" :disabled="!slotMeta(slot)" @click="confirmLoad = slot">读取</button>
              <button v-if="slot !== 'auto'" class="btn btn-xs btn-ghost" :disabled="!slotMeta(slot)" @click="game.deleteSlot(slot)">删除</button>
            </div>
          </div>
        </div>
        <div class="tiny muted mt-sm">每次交易、事件结算与收盘结算后会自动保存到「自动存档」。</div>
      </section>
      <section class="panel">
        <div class="panel-h"><span class="title">Export / Import</span></div>
        <div class="col">
          <button class="btn" @click="exportSave">⬇ 导出存档（JSON，含档案与设置）</button>
          <label class="check small"><input v-model="withProfile" type="checkbox" /> 导入时同时恢复档案（等级、成就、任务进度）</label>
          <label class="btn btn-ghost" style="cursor: pointer">⬆ 导入存档文件<input type="file" accept=".json,application/json" hidden @change="onImport" /></label>
          <div v-if="importMsg" class="note" :class="importMsg.ok ? 'ok' : 'danger'">{{ importMsg.text }}</div>
          <div class="tiny muted">导入前会校验版本与数据结构，并限制文件大小（40MB）；校验失败时不会覆盖当前有效存档。建议导入前先导出备份。</div>
        </div>
        <div class="divider" />
        <div class="col">
          <button class="btn" @click="newGameOpen = true">🆕 开始新游戏</button>
          <button class="btn btn-danger" @click="resetOpen = true">⚠ 重置全部数据</button>
        </div>
      </section>
    </div>

    <!-- 设置 -->
    <div v-if="tab === 'settings'" class="grid-2">
      <section class="panel">
        <div class="panel-h"><span class="title">Display</span></div>
        <div class="col">
          <label class="field"
            ><span>涨跌颜色</span>
            <select v-model="s.colorScheme">
              <option v-for="o in schemes" :key="o.v" :value="o.v">{{ o.label }}</option>
            </select></label
          >
          <div class="tiny muted">A 股习惯「红涨绿跌」，美股习惯「绿涨红跌」，两者语义相反请勿混淆。无论哪种配色，涨跌都同时显示 ▲▼ 箭头与正负号。</div>
          <label class="field"
            ><span>主题</span>
            <div class="seg">
              <button :class="{ active: s.theme === 'dark' }" @click="s.theme = 'dark'">深色</button>
              <button :class="{ active: s.theme === 'light' }" @click="s.theme = 'light'">浅色</button>
            </div></label
          >
          <label class="field"><span>字号 {{ Math.round(s.fontScale * 100) }}%</span><input v-model.number="s.fontScale" type="range" min="0.85" max="1.5" step="0.05" /></label>
          <label class="check"><input v-model="s.reduceFlash" type="checkbox" /> 降低闪烁（关闭行情闪动）</label>
          <label class="check"><input v-model="s.reduceMotion" type="checkbox" /> 关闭动效（像素场景静止）</label>
          <label class="check"><input v-model="s.highContrast" type="checkbox" /> 高对比模式</label>
          <label class="check"><input v-model="s.showChartTable" type="checkbox" /> 图表下方显示数据表格/文字摘要</label>
        </div>
      </section>
      <section class="panel">
        <div class="panel-h"><span class="title">Trading & Flow</span></div>
        <div class="col">
          <label class="check"><input v-model="s.confirmLowRisk" type="checkbox" /> 低风险订单也需要二次确认</label>
          <label class="field"
            ><span>「低风险订单」阈值：订单金额 ＜ 净值的 {{ Math.round(s.confirmThresholdPct * 100) }}%</span><input v-model.number="s.confirmThresholdPct" type="range" min="0.01" max="0.3" step="0.01" :disabled="s.confirmLowRisk"
          /></label>
          <div class="tiny muted">高额订单与杠杆/卖空订单始终需要明确确认。</div>
          <label class="field"><span>单笔订单风险上限：净值的 {{ Math.round(s.maxOrderPct * 100) }}%（规则包上限另计）</span><input v-model.number="s.maxOrderPct" type="range" min="0.05" max="1" step="0.05" /></label>
          <label class="check"><input v-model="s.pauseAtClose" type="checkbox" /> 收盘后自动暂停并显示收盘总结</label>
          <label class="check"><input v-model="s.tutorialHints" type="checkbox" /> 显示教学提示</label>
          <label class="check"><input v-model="s.tutorialPause" type="checkbox" /> 新手模式：关键事件时暂停并解释</label>
          <label class="check"><input v-model="s.unlockAll" type="checkbox" /> 解锁全部工具（跳过成长解锁）</label>
        </div>
      </section>
      <section class="panel">
        <div class="panel-h"><span class="title">Shortcuts</span><label class="check small"><input v-model="s.shortcutsEnabled" type="checkbox" /> 启用</label></div>
        <table class="tbl">
          <tbody>
            <tr v-for="(label, act) in SHORTCUT_ACTIONS" :key="act">
              <td>{{ label }}</td>
              <td class="right">
                <button class="btn btn-xs" :class="{ active: capturing === act }" :disabled="!s.shortcutsEnabled" @click="capturing = act" @keydown="capturing === act && capture($event, act)">
                  {{ capturing === act ? '请按键…（Esc 取消，Backspace 清除）' : keyLabel(s.shortcuts[act]) }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="row end mt-sm"><button class="btn btn-sm btn-ghost" @click="s.shortcuts = { ...DEFAULT_SHORTCUTS }">恢复默认快捷键</button></div>
      </section>
      <section class="panel">
        <div class="panel-h"><span class="title">Advanced Mode</span><span class="tag" :class="marginInfo.enabled ? 'tag-danger' : ''">{{ marginInfo.enabled ? '已开启' : '未开启' }}</span></div>
        <p class="small">进阶模式开启保证金账户与卖空。当前规则包：{{ marginInfo.rules }}{{ marginInfo.rulesOk ? '' : '（该规则包未启用保证金/卖空）' }}。</p>
        <div v-if="!marginInfo.unlocked" class="note warn">需达到 Lv.{{ UNLOCKS.advancedMode.level }}，或完成「保证金与杠杆」相关课程后才能开启。</div>
        <div class="row mt-sm">
          <button v-if="!marginInfo.enabled" class="btn btn-danger" :disabled="!marginInfo.unlocked || !marginInfo.rulesOk" @click="marginOpen = true">了解风险并开启</button>
          <button v-else class="btn" @click="disableMargin">关闭进阶模式</button>
        </div>
      </section>
    </div>

    <!-- 世界信息 -->
    <section v-if="tab === 'world'" class="panel">
      <div class="panel-h"><span class="title">World</span><span class="sim-badge">虚构模拟</span></div>
      <div class="kv" style="max-width: 560px">
        <span>存档名称</span><span>{{ world.m.name }}</span>
        <span>模式</span><span>{{ { tutorial: '新手教学', free: '自由模拟', challenge: '情景挑战' }[world.m.mode] }}</span>
        <span>世界种子 worldSeed</span><span class="num">{{ world.m.worldSeed }}</span>
        <span>难度</span><span>{{ world.diff.label }}</span>
        <span>规则包</span><span>{{ world.rules.name }}</span>
        <span>规则包版本</span><span class="num">{{ world.m.rulesVersion }}</span>
        <span>费率版本</span><span class="num">{{ world.m.feeVersion }}</span>
        <span>规则参考日期</span><span>{{ world.rules.effectiveDate }}</span>
        <span>初始资金</span><span>{{ world.initial }}</span>
        <span>创建时间</span><span>{{ new Date(world.m.createdAt).toLocaleString() }}</span>
        <span>存档结构版本</span><span>v{{ game.engine!.w.schemaVersion }}</span>
      </div>
      <div class="note mt">同一世界种子、相同规则包与相同玩家命令会产生可复现的行情与事件。玩家的下单与撤单不会改变公司基本面或事件抽样序列。</div>
      <div class="row mt wrap">
        <button class="btn" @click="game.go('learn', 'rules')">查看规则说明</button>
        <button class="btn btn-ghost" @click="exportDebug">导出引擎调试日志（因子 / 撮合 / 命令）</button>
      </div>
    </section>

    <!-- 弹窗 -->
    <Modal v-if="confirmLoad" title="读取存档" size="narrow" @close="confirmLoad = ''">
      <p>读取「{{ confirmLoad }}」将替换当前正在进行的模拟。当前进度若未手动保存，可在自动存档中找到最近一次自动保存。确定读取吗？</p>
      <template #footer>
        <button class="btn btn-ghost" @click="confirmLoad = ''">取消</button>
        <button class="btn btn-primary" @click="doLoad">读取</button>
      </template>
    </Modal>
    <Modal v-if="newGameOpen" title="开始新游戏" size="narrow" @close="newGameOpen = false">
      <p>新游戏会生成新的模拟世界并<b>覆盖自动存档</b>。如需保留当前进度，请先保存到手动存档槽或导出存档。等级、成就等档案会保留。</p>
      <template #footer>
        <button class="btn btn-ghost" @click="newGameOpen = false">取消</button>
        <button class="btn" @click="(tab = 'saves'), (newGameOpen = false)">先去保存</button>
        <button class="btn btn-primary" @click="(newGameOpen = false), (game.showNewGame = true)">继续</button>
      </template>
    </Modal>
    <Modal v-if="resetOpen" title="⚠ 重置全部数据" size="narrow" @close="resetOpen = false">
      <div class="note danger mb">此操作将永久删除：所有存档槽（含自动存档）、等级与经验、成就、任务与课程进度、错题本、挑战记录，以及全部设置。删除后无法恢复。</div>
      <p class="small">建议先导出存档备份。若确认重置，请在下方输入「重置」。</p>
      <input v-model="resetText" placeholder="输入：重置" style="width: 100%" />
      <template #footer>
        <button class="btn btn-ghost" @click="resetOpen = false">取消</button>
        <button class="btn btn-danger" :disabled="resetText !== '重置'" @click="doReset">永久删除全部数据</button>
      </template>
    </Modal>
    <Modal v-if="marginOpen" title="开启进阶模式：保证金与卖空" @close="marginOpen = false">
      <div class="note danger mb">杠杆会同时放大收益与亏损。高杠杆不是升级捷径。</div>
      <ul class="small prose">
        <li><b>杠杆放大：</b>初始保证金 {{ (marginInfo.m.initialMargin * 100).toFixed(0) }}% 意味着最多约 {{ (1 / marginInfo.m.initialMargin).toFixed(1) }} 倍敞口，股价下跌 {{ (marginInfo.m.initialMargin * 100).toFixed(0) }}% 就可能亏光全部本金。</li>
        <li><b>维持保证金：</b>账户权益 / 总敞口 低于 {{ (marginInfo.m.maintenanceMargin * 100).toFixed(0) }}% 会收到追加保证金通知，需在 {{ marginInfo.m.callGraceDays }} 个交易日内补足或减仓。</li>
        <li><b>强制平仓：</b>低于 {{ (marginInfo.m.liquidationMargin * 100).toFixed(0) }}% 时系统立即以市价强制平仓，成交价可能很不利，跳空时亏损可能超过预期。</li>
        <li><b>卖空：</b>卖空的潜在亏损理论上没有上限；需可借券源、支付借券费，并在除息日向出借方支付股息。</li>
        <li><b>融资利息：</b>负现金余额按年化 {{ (marginInfo.m.interestRate * 100).toFixed(1) }}% 逐日计息。</li>
      </ul>
      <label class="check mt"><input v-model="marginAck" type="checkbox" /> 我已理解最大亏损、杠杆放大效应与强制平仓规则（全部为虚拟资金模拟）</label>
      <template #footer>
        <button class="btn btn-ghost" @click="marginOpen = false">取消</button>
        <button class="btn btn-danger" :disabled="!marginAck" @click="enableMargin">确认开启</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.swatch {
  width: 24px;
  height: 24px;
  border: 0;
  box-shadow: 0 0 0 2px var(--border);
  cursor: pointer;
  font-size: 10px;
  padding: 0;
}
.swatch.sel {
  box-shadow: 0 0 0 3px var(--accent);
}
.swatch:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ach .ico {
  font-size: 1.8em;
}
.ach.locked {
  opacity: 0.55;
  filter: grayscale(0.7);
}
</style>
