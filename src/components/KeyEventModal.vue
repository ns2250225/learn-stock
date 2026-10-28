<script setup lang="ts">
import { computed } from 'vue'
import Modal from './Modal.vue'
import Gloss from './Gloss.vue'
import { useGame } from '../store/game'
import { useSettings } from '../store/settings'
import { SOURCE_LABEL, CATEGORY_LABEL } from '../engine/state'
import { SECTOR_MAP } from '../engine/content/sectors'
import { fmtPct } from '../engine/util'

const game = useGame()
const settings = useSettings()
const ev = computed(() => game.keyEvent)
const held = computed(() => {
  game.rev
  const e = game.engine
  if (!e || !ev.value) return []
  return ev.value.affectedSymbols.filter((s) => e.w.account.positions[s]?.qty)
})
const symbols = computed(() => (ev.value?.marketWide ? [] : (ev.value?.affectedSymbols ?? []).slice(0, 8)))
const credLabel = computed(() => {
  const c = ev.value?.credibility ?? 0
  return c >= 0.85 ? '高（官方/公告）' : c >= 0.6 ? '中（媒体报道）' : '低（传闻，待证实）'
})
function close(resume: boolean) {
  game.keyEvent = null
  game.after()
  if (resume) game.setSpeed(1)
}
function goto(fn: () => void) {
  game.keyEvent = null
  fn()
}
const newsId = computed(() => game.engine?.w.news.find((n) => n.eventId === ev.value?.id)?.id ?? '')
</script>

<template>
  <Modal v-if="ev" title="关键事件 · 市场已暂停" size="wide" @close="close(false)">
    <div class="row wrap gap-sm mb">
      <span class="tag" :class="'src-' + ev.sourceType">{{ SOURCE_LABEL[ev.sourceType] }}</span>
      <span class="tag">{{ CATEGORY_LABEL[ev.category] ?? ev.category }}</span>
      <span v-if="ev.highImpact" class="tag tag-danger">高影响</span>
      <span v-if="held.length" class="tag tag-warn">涉及你的持仓：{{ held.join('、') }}</span>
    </div>
    <div class="section-title">发生了什么</div>
    <h3>{{ ev.title }}</h3>
    <p>{{ ev.summary }}</p>
    <p v-if="ev.detail" class="small muted prose">{{ ev.detail }}</p>

    <div class="section-title mt">可能的影响与不确定性</div>
    <ul class="small" style="margin: 0; padding-left: 18px">
      <li v-for="(a, i) in ev.analysis" :key="i">{{ a }}</li>
    </ul>
    <div class="kv mt-sm" style="max-width: 460px">
      <span>信息可信度</span><span>{{ credLabel }}</span>
      <span>相对预期的意外程度</span><span>{{ ev.surprise >= 0 ? '+' : '' }}{{ ev.surprise.toFixed(1) }}</span>
      <span>影响范围</span><span>{{ ev.marketWide ? '全市场' : ev.affectedSectors.map((s) => SECTOR_MAP[s]?.name ?? s).join('、') }}</span>
    </div>
    <div v-if="symbols.length" class="chip-list mt-sm">
      <button v-for="s in symbols" :key="s" class="btn btn-xs" @click="goto(() => game.openStock(s))">{{ game.engine?.tmpl[s]?.name ?? s }}（{{ s }}）{{ ev.priceAtPublish[s] ? '' : '' }}</button>
    </div>
    <div class="note warn mt-sm">事件不是答案：价格反应取决于预期差、估值、流动性与整体市场环境，同样的消息可能带来不同方向的结果。模拟引擎的初步冲击估计约为 {{ fmtPct(ev.immediateImpact, 1) }}，实际走势仍有不确定性。</div>

    <div class="section-title mt">你可以考虑的操作</div>
    <div class="chip-list">
      <button class="btn btn-sm" @click="goto(() => game.go('account', 'risk'))">查看持仓风险</button>
      <button class="btn btn-sm" @click="goto(() => game.go('news', newsId))">阅读新闻详情</button>
      <button v-if="symbols.length" class="btn btn-sm" @click="goto(() => game.openStock(symbols[0], 'quote'))">查看行情归因</button>
      <button class="btn btn-sm" @click="goto(() => game.openTrade(symbols[0] ?? game.symbol))">更新/创建交易计划</button>
      <button class="btn btn-sm" @click="close(true)">继续观察</button>
    </div>
    <div v-if="ev.educationalTags.length" class="chip-list mt">
      <span class="tiny muted">相关概念：</span><Gloss v-for="t in ev.educationalTags" :key="t" :id="t" />
    </div>
    <template #footer>
      <label class="check small grow"><input type="checkbox" :checked="!settings.s.tutorialPause" @change="settings.s.tutorialPause = !($event.target as HTMLInputElement).checked" /> 不再在关键事件暂停</label>
      <button class="btn btn-ghost" @click="close(false)">保持暂停</button>
      <button class="btn btn-primary" @click="close(true)">继续</button>
    </template>
  </Modal>
</template>
