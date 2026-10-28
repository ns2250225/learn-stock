<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useGame } from '../store/game'
import { RULE_PACKS } from '../engine/rules'
import { DIFFICULTY_PARAMS } from '../engine/params'
import { CHALLENGES } from '../engine/challenge'
import { REGIME_LABEL, type Difficulty, type GameMode } from '../engine/state'
import type { RulesId } from '../engine/types'
import { fmtMoney } from '../engine/util'

const game = useGame()
const agreed = ref(false)
const mode = ref<GameMode>('tutorial')
const rulesId = ref<RulesId>('teaching')
const difficulty = ref<Difficulty>('easy')
const cashPreset = ref(100000)
const customCash = ref(200000)
const useCustom = ref(false)
const name = ref(game.profile.name || '新手投资者')
const seed = ref(randomSeed())
const challengeId = ref(CHALLENGES[0]?.id ?? '')
const starting = ref(false)
const err = ref('')

function randomSeed() {
  return 'PX-' + Math.random().toString(36).slice(2, 8).toUpperCase()
}

const def = computed(() => CHALLENGES.find((c) => c.id === challengeId.value))
const forcedRules = computed(() => (mode.value === 'challenge' ? def.value?.rulesId : undefined))
const effectiveRules = computed<RulesId>(() => forcedRules.value ?? rulesId.value)
const rules = computed(() => RULE_PACKS[effectiveRules.value])
const initialCash = computed(() => {
  if (mode.value === 'challenge') return def.value?.startCash ?? 100000
  if (mode.value === 'tutorial') return 100000
  return useCustom.value ? Math.max(10000, Math.min(1e9, Number(customCash.value) || 0)) : cashPreset.value
})

watch(mode, (m) => {
  if (m === 'tutorial') difficulty.value = 'easy'
  else if (difficulty.value === 'easy') difficulty.value = 'normal'
})

onMounted(() => void game.refreshSlots())

async function start() {
  if (!agreed.value || starting.value) return
  starting.value = true
  err.value = ''
  try {
    game.profile.name = name.value.trim() || '新手投资者'
    await game.newGame({
      name: game.profile.name,
      mode: mode.value,
      rulesId: effectiveRules.value,
      difficulty: difficulty.value,
      seed: seed.value.trim() || randomSeed(),
      initialCash: initialCash.value,
      challengeId: mode.value === 'challenge' ? challengeId.value : undefined,
    })
    game.engine?.setFlag('read_disclaimer')
    void game.saveProfile()
    game.after()
  } catch (e) {
    err.value = '开局失败：' + String(e)
  } finally {
    starting.value = false
  }
}

async function load(slot: string) {
  const ok = await game.loadSlot(slot)
  if (ok) game.showNewGame = false
  else err.value = '该存档无法读取'
}

const MODES: { id: GameMode; label: string; icon: string; desc: string }[] = [
  { id: 'tutorial', label: '新手教学', icon: '🎓', desc: '任务驱动、事件节奏较慢，关键事件会暂停并解释发生了什么。' },
  { id: 'free', label: '自由模拟', icon: '🌆', desc: '市场长期运行，自由交易；支持暂停、单步与时间倍率。' },
  { id: 'challenge', label: '情景挑战', icon: '🏆', desc: '从指定资金与市场环境开始，在限定交易日内达成多维目标。' },
]
const PRESETS = [100000, 500000, 1000000]
const MODE_LABEL: Record<string, string> = { tutorial: '新手教学', free: '自由模拟', challenge: '情景挑战' }
</script>

<template>
  <div class="ng">
    <header class="hero center">
      <div class="pixel title">像素<span class="accent">证券城</span></div>
      <div class="pixel-sm muted mt-sm">PIXEL STOCK CITY · 股票市场模拟</div>
      <div class="skyline" aria-hidden="true">
        <i v-for="n in 18" :key="n" :style="{ height: 14 + ((n * 37) % 46) + 'px' }" />
      </div>
    </header>

    <div class="wrapper col gap-lg">
      <div v-if="game.engine" class="note warn row between wrap">
        <span>开始新游戏会替换当前「自动存档」。如需保留进度，可以考虑先在「投资者公寓 · 存档」中手动保存。</span>
        <button class="btn btn-sm" @click="game.showNewGame = false">返回游戏</button>
      </div>

      <section class="panel">
        <div class="panel-h"><span class="title">Disclaimer</span><span class="title-cn">模拟声明</span></div>
        <ul class="small prose" style="margin: 0; padding-left: 18px">
          <li>游戏内所有资金均为<b>虚拟资金</b>，不涉及充值、提现或任何真实资产。</li>
          <li>所有上市公司、代码、财报、新闻与行情均为<b>虚构模拟数据</b>，与任何真实公司无关。</li>
          <li>本游戏<b>不连接任何真实券商</b>，下单不会影响任何真实账户。</li>
          <li>游戏结果与提示<b>不构成投资建议</b>，也不能用来推断真实市场的未来收益。</li>
        </ul>
        <label class="check mt"><input v-model="agreed" type="checkbox" /> 我已阅读并理解以上声明</label>
      </section>

      <section class="panel">
        <div class="panel-h"><span class="title">Mode</span><span class="title-cn">游戏模式</span></div>
        <div class="grid-3">
          <button v-for="m in MODES" :key="m.id" class="choice" :class="{ active: mode === m.id }" @click="mode = m.id">
            <div class="big-icon">{{ m.icon }}</div>
            <div class="bold">{{ m.label }}</div>
            <div class="tiny muted">{{ m.desc }}</div>
          </button>
        </div>
        <div v-if="mode === 'challenge'" class="mt col">
          <div class="auto-grid">
            <button v-for="c in CHALLENGES" :key="c.id" class="choice left" :class="{ active: challengeId === c.id }" @click="challengeId = c.id">
              <div class="row between"><span class="bold">{{ c.title }}</span><span class="accent tiny">{{ '★'.repeat(c.difficulty) }}{{ '☆'.repeat(5 - c.difficulty) }}</span></div>
              <div class="tiny muted">{{ c.subtitle }}</div>
              <div class="tiny">{{ c.days }} 个交易日 · 初始 {{ fmtMoney(c.startCash * 100) }} · {{ REGIME_LABEL[c.regime] }}</div>
            </button>
          </div>
          <div v-if="def" class="panel inset">
            <div class="bold">{{ def.title }}</div>
            <p class="small muted mt-sm">{{ def.story }}</p>
            <div class="small bold">挑战目标：</div>
            <ul class="small" style="margin: 4px 0; padding-left: 18px">
              <li v-for="(g, i) in def.goals" :key="i">{{ g.label }} <span class="tag" :class="g.required ? 'tag-accent' : ''">{{ g.required ? '必须' : '加分' }}</span></li>
            </ul>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-h"><span class="title">Rules</span><span class="title-cn">市场规则包</span></div>
        <div class="seg mb">
          <button v-for="r in Object.values(RULE_PACKS)" :key="r.id" :class="{ active: effectiveRules === r.id }" :disabled="!!forcedRules" @click="rulesId = r.id">{{ r.name }}</button>
        </div>
        <div v-if="forcedRules" class="note mb">该挑战指定使用「{{ rules.name }}」规则包。</div>
        <div class="kv">
          <span>版本</span><span>{{ rules.version }}</span>
          <span>参数日期</span><span>{{ rules.effectiveDate }}</span>
          <span>最小交易单位</span><span>{{ rules.lotSize }} 股</span>
          <span>涨跌幅限制</span><span>{{ rules.priceLimit.enabled ? '±' + (rules.priceLimit.pct * 100).toFixed(0) + '%' : '无' }}</span>
          <span>交收</span><span>{{ rules.settlement.label }}</span>
          <span>涨跌颜色</span><span>{{ rules.colorConvention === 'redUp' ? '红涨绿跌' : '绿涨红跌' }}</span>
        </div>
        <div class="tiny muted mt-sm">来源：{{ rules.source }}</div>
        <ul class="tiny muted" style="margin: 6px 0 0; padding-left: 18px">
          <li v-for="(n, i) in rules.notes" :key="i">{{ n }}</li>
        </ul>
      </section>

      <section class="panel">
        <div class="panel-h"><span class="title">Setup</span><span class="title-cn">开局设置</span></div>
        <div class="grid-2">
          <label class="field"><span>玩家名称</span><input v-model="name" maxlength="20" /></label>
          <label class="field">
            <span>难度</span>
            <select v-model="difficulty">
              <option v-for="(d, k) in DIFFICULTY_PARAMS" :key="k" :value="k">{{ d.label }} — {{ d.desc }}</option>
            </select>
          </label>
          <div class="field">
            <span class="bold muted small">初始虚拟资金</span>
            <div v-if="mode === 'free'" class="row wrap">
              <button v-for="p in PRESETS" :key="p" class="btn btn-sm" :class="{ active: !useCustom && cashPreset === p }" @click="(cashPreset = p), (useCustom = false)">{{ p / 10000 }} 万</button>
              <button class="btn btn-sm" :class="{ active: useCustom }" @click="useCustom = true">自定义</button>
              <input v-if="useCustom" v-model.number="customCash" type="number" min="10000" step="10000" style="width: 140px" />
            </div>
            <div v-else class="num">{{ fmtMoney(initialCash * 100) }} <span class="tiny muted">（{{ mode === 'tutorial' ? '教学模式固定' : '由挑战设定' }}）</span></div>
          </div>
          <label class="field">
            <span>世界种子</span>
            <div class="row"><input v-model="seed" class="grow" maxlength="32" /><button class="btn btn-sm" @click="seed = randomSeed()">🎲</button></div>
            <span class="tiny dim">同一种子、相同规则与相同操作会生成完全相同的市场，便于复盘或与朋友比较。</span>
          </label>
        </div>
        <div v-if="err" class="note danger mt">{{ err }}</div>
        <div class="row end mt">
          <span v-if="!agreed" class="tiny warn">请先勾选模拟声明</span>
          <button class="btn btn-primary" :disabled="!agreed || starting" @click="start">{{ starting ? '正在生成市场…' : '▶ 进入像素证券城' }}</button>
        </div>
      </section>

      <section v-if="game.slots.length" class="panel">
        <div class="panel-h"><span class="title">Saves</span><span class="title-cn">读取存档</span></div>
        <div v-for="s in game.slots" :key="s.slot" class="list-item row between wrap">
          <span>
            <b>{{ s.slot === 'auto' ? '自动存档' : '存档槽 ' + s.slot }}</b>
            <span class="small muted"> · {{ s.name }} · {{ MODE_LABEL[s.mode] ?? s.mode }} · {{ RULE_PACKS[s.rulesId as RulesId]?.name }} · 交易日 #{{ s.tradingDay }} · 净值 {{ fmtMoney(s.equity) }}</span>
            <span class="tiny dim"> · {{ new Date(s.savedAt).toLocaleString() }}</span>
          </span>
          <button class="btn btn-sm" @click="load(s.slot)">读取</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ng { min-height: 100vh; padding-bottom: 40px; }
.hero { padding: 36px 16px 0; background: linear-gradient(#0b1020, var(--bg)); }
.title { font-size: 1.8em; color: var(--text); }
.skyline { display: flex; align-items: flex-end; justify-content: center; gap: 4px; height: 70px; margin-top: 18px; }
.skyline i { width: 22px; background: var(--panel3); box-shadow: inset 0 0 0 2px var(--border), inset 6px 6px 0 -2px rgba(244, 201, 93, 0.25); }
.wrapper { width: min(980px, 100%); margin: 0 auto; padding: 16px; }
.choice { background: var(--panel2); color: var(--text); border: 0; box-shadow: 0 0 0 2px var(--border); padding: 12px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; align-items: center; text-align: center; font-family: var(--font-body); }
.choice.left { align-items: stretch; text-align: left; }
.choice.active { box-shadow: 0 0 0 3px var(--accent); background: var(--panel3); }
.big-icon { font-size: 2em; }
@media (max-width: 600px) { .title { font-size: 1.1em; } }
</style>
