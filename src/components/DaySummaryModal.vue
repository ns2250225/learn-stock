<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Modal from './Modal.vue'
import Chg from './Chg.vue'
import { useGame } from '../store/game'
import { saveSummaryNote } from '../engine/review'
import { BIAS_TAGS } from '../engine/content/learning'
import { SECTOR_MAP } from '../engine/content/sectors'
import { fmtMoney, fmtPct, fmtQty } from '../engine/util'
import type { SectorId } from '../engine/types'

const game = useGame()
const s = computed(() => {
  game.rev
  return game.engine?.w.summaries.find((x) => x.tradingDay === game.summaryDay) ?? null
})
const sym = computed(() => game.engine?.rules.currencySymbol ?? '¥')
const note = ref(s.value?.note ?? '')
const bias = ref(s.value?.biasTag ?? '')
onMounted(() => {
  game.engine?.setFlag('opened_daily_summary')
  game.after()
})
function save() {
  const e = game.engine
  if (e && s.value && (note.value.trim() || bias.value)) saveSummaryNote(e, s.value.tradingDay, note.value.trim(), bias.value || undefined)
}
function close(resume: boolean) {
  save()
  game.summaryDay = null
  game.after()
  if (resume) game.setSpeed(1)
}
const secName = (id: SectorId) => SECTOR_MAP[id]?.name ?? id
const name = (sy: string) => game.engine?.tmpl[sy]?.name ?? sy
</script>

<template>
  <Modal v-if="s" :title="`收盘总结 · ${s.date}`" size="wide" @close="close(false)">
    <div class="grid-3">
      <div class="panel inset">
        <div class="section-title">市场表现</div>
        <div v-for="i in s.indexChanges" :key="i.id" class="row between small"><span>{{ i.name }}</span><span class="num">{{ i.close.toFixed(2) }} <Chg :v="i.changePct" /></span></div>
        <div class="tiny muted mt-sm">上涨 <span class="up">{{ s.breadth.up }}</span> · 下跌 <span class="down">{{ s.breadth.down }}</span> · 平盘 {{ s.breadth.flat }}</div>
      </div>
      <div class="panel inset">
        <div class="section-title">我的账户</div>
        <div class="kv">
          <span>收盘净值</span><span>{{ fmtMoney(s.equity, sym) }}</span>
          <span>当日盈亏</span><span><Chg :v="s.dayPnl" kind="money" :sym="sym" /></span>
          <span>净值变化</span><span><Chg :v="s.equityChangePct" /></span>
          <span>当日费用</span><span>{{ fmtMoney(s.fees, sym) }}</span>
        </div>
      </div>
      <div class="panel inset">
        <div class="section-title">风险暴露（开盘 → 收盘）</div>
        <div class="kv">
          <span>最大单股占比</span><span>{{ fmtPct(s.riskBefore.maxWeight, 1, false) }} → {{ fmtPct(s.riskAfter.maxWeight, 1, false) }}</span>
          <span>当前回撤</span><span>{{ fmtPct(s.riskBefore.drawdown, 1, false) }} → {{ fmtPct(s.riskAfter.drawdown, 1, false) }}</span>
          <span>杠杆</span><span>{{ s.riskBefore.leverage.toFixed(2) }}x → {{ s.riskAfter.leverage.toFixed(2) }}x</span>
        </div>
      </div>
    </div>
    <div class="grid-2 mt">
      <div class="panel inset">
        <div class="section-title">行业轮动</div>
        <div class="tiny muted">领涨</div>
        <div v-for="r in s.sectorRanks.slice(0, 3)" :key="r.sector" class="row between small"><span>{{ secName(r.sector) }}</span><Chg :v="r.changePct" /></div>
        <div class="tiny muted mt-sm">领跌</div>
        <div v-for="r in s.sectorRanks.slice(-3).reverse()" :key="r.sector" class="row between small"><span>{{ secName(r.sector) }}</span><Chg :v="r.changePct" /></div>
      </div>
      <div class="panel inset">
        <div class="section-title">重要新闻</div>
        <div v-if="!s.topNews.length" class="muted small">今日无重要新闻</div>
        <div v-for="(n, i) in s.topNews" :key="i" class="small">· {{ n }}</div>
      </div>
      <div class="panel inset">
        <div class="section-title">持仓变化</div>
        <div v-if="!s.positionChanges.length" class="muted small">今日持仓无变化</div>
        <div v-for="p in s.positionChanges" :key="p.symbol" class="row between small"><span>{{ name(p.symbol) }}（{{ p.symbol }}）</span><span class="num">{{ fmtQty(p.before) }} → {{ fmtQty(p.after) }}</span></div>
      </div>
      <div class="panel inset">
        <div class="section-title">待办事件</div>
        <div v-if="!s.upcoming.length" class="muted small">未来几日无已知日历事件</div>
        <div v-for="(u, i) in s.upcoming" :key="i" class="small">📅 {{ u }}</div>
      </div>
    </div>
    <div class="panel mt">
      <div class="section-title">今日一句话总结</div>
      <input v-model="note" maxlength="140" placeholder="例如：按计划持有，未因盘中波动改变决定" style="width: 100%" />
      <div class="tiny muted mt-sm">如果今天的决策可能受到某种偏差影响，可以选择一个标签（可选）：</div>
      <div class="chip-list mt-sm">
        <button v-for="b in BIAS_TAGS" :key="b.id" class="btn btn-xs" :class="{ active: bias === b.id }" :title="b.desc" @click="bias = bias === b.id ? '' : b.id">{{ b.label }}</button>
      </div>
    </div>
    <template #footer>
      <button class="btn btn-ghost" @click="close(false)">稍后</button>
      <button class="btn btn-primary" @click="close(true)">保存并继续</button>
    </template>
  </Modal>
</template>
