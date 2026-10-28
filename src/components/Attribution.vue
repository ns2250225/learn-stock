<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useGame } from '../store/game'
import { fmtPct } from '../engine/util'

const props = defineProps<{ symbol: string }>()
const game = useGame()

onMounted(() => {
  const e = game.engine
  if (!e) return
  e.setFlag('viewed_attribution')
  e.bump('attributionViewed')
  game.after()
})

const data = computed(() => {
  game.rev
  const e = game.engine
  if (!e) return null
  const st = e.w.stocks[props.symbol]
  if (!st) return null
  const a = st.attrToday
  const parts: { label: string; v: number }[] = [
    { label: '市场整体风险偏好', v: a.market },
    { label: '行业因子', v: a.sector },
    { label: '基本面 / 估值变化', v: a.fundamental },
    { label: '情绪与趋势', v: a.sentiment },
    { label: '估值回归', v: a.reversion },
    { label: '随机扰动（无法解释的部分）', v: a.noise },
  ]
  for (const [id, v] of Object.entries(a.events)) {
    const ev = e.w.events.find((x) => x.id === id)
    parts.push({ label: '事件：' + (ev?.title ?? (id === 'revision' ? '分析师预期修正' : '事件冲击')), v })
  }
  const list = parts.filter((p) => Math.abs(p.v) > 0.0003).sort((x, y) => Math.abs(y.v) - Math.abs(x.v)).slice(0, 8)
  const max = Math.max(0.005, ...list.map((p) => Math.abs(p.v) * 1.25))
  const total = st.prevClose ? st.last / st.prevClose - 1 : 0
  return {
    list: list.map((p) => ({ ...p, lo: p.v * 0.75, hi: p.v * 1.25, w: (Math.abs(p.v) / max) * 50 })),
    total,
    moves: st.moves.slice(-5).reverse(),
    cal: e.cal,
  }
})
const range = (lo: number, hi: number) => {
  const [a, b] = lo < hi ? [lo, hi] : [hi, lo]
  return `${fmtPct(a, 2)} ~ ${fmtPct(b, 2)}`
}
</script>

<template>
  <section class="panel" v-if="data">
    <div class="panel-h"><span class="title">Attribution</span><span class="tiny muted">今日行情归因（log 收益估计区间）</span></div>
    <div class="small mb">今日涨跌：<span :class="data.total > 0 ? 'up' : data.total < 0 ? 'down' : 'flat'">{{ data.total > 0 ? '▲' : data.total < 0 ? '▼' : '■' }} {{ fmtPct(data.total) }}</span></div>
    <div v-if="!data.list.length" class="muted small">今日暂无明显驱动因素。</div>
    <div v-for="(p, i) in data.list" :key="i" class="arow">
      <div class="tiny ellipsis" :title="p.label">{{ p.label }}</div>
      <div class="abar">
        <span class="mid" />
        <i :class="p.v >= 0 ? 'pos' : 'neg'" :style="p.v >= 0 ? { left: '50%', width: p.w + '%' } : { right: '50%', width: p.w + '%' }" />
      </div>
      <div class="tiny num nowrap" :class="p.v >= 0 ? 'up' : 'down'">{{ range(p.lo, p.hi) }}</div>
    </div>
    <div class="note tiny mt-sm">归因是模拟引擎提供的解释，不是唯一真实原因；数值以区间展示，体现不确定性。</div>
    <template v-if="data.moves.length">
      <div class="divider" />
      <div class="bold small mb-sm">近期大幅波动记录</div>
      <div v-for="m in data.moves" :key="m.day" class="tiny mb-sm">
        <span class="muted">{{ data.cal.label(m.day) }}</span>
        <span :class="m.ret > 0 ? 'up' : 'down'"> {{ m.ret > 0 ? '▲' : '▼' }}{{ fmtPct(m.ret, 1) }}</span>
        ：<span v-for="(p, i) in m.parts.slice(0, 3)" :key="i">{{ i ? '；' : '' }}{{ p.label }}（{{ fmtPct(p.value, 1) }}）</span>
      </div>
    </template>
  </section>
</template>

<style scoped>
.arow { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(80px, 1fr) auto; gap: 8px; align-items: center; margin-bottom: 4px; }
.abar { position: relative; height: 10px; background: var(--bg2); }
.abar .mid { position: absolute; left: 50%; top: -2px; bottom: -2px; width: 1px; background: var(--muted); }
.abar i { position: absolute; top: 1px; bottom: 1px; }
.abar i.pos { background: var(--up); opacity: 0.8; }
.abar i.neg { background: var(--down); opacity: 0.8; }
.mb-sm { margin-bottom: 4px; }
</style>
