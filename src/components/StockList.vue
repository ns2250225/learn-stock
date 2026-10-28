<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGame } from '../store/game'
import Chg from './Chg.vue'
import { COMPANIES } from '../engine/content/companies'
import { SECTORS, SECTOR_MAP } from '../engine/content/sectors'
import { fmtBig, fmtPrice } from '../engine/util'
import type { SectorId } from '../engine/types'

const game = useGame()
const tab = ref<'watch' | 'all' | 'held' | 'sector'>('watch')
const sector = ref<SectorId>('tech')
const q = ref('')
const sortKey = ref<'none' | 'chg' | 'vol'>('none')
const prev = new Map<string, number>()

const rows = computed(() => {
  game.rev
  const e = game.engine
  if (!e) return []
  const w = e.w
  let list = COMPANIES.map((c) => c.symbol)
  if (tab.value === 'watch') list = w.watchlist.slice()
  if (tab.value === 'held') list = Object.keys(w.account.positions)
  if (tab.value === 'sector') list = COMPANIES.filter((c) => c.sector === sector.value).map((c) => c.symbol)
  const s = q.value.trim().toLowerCase()
  if (s) list = COMPANIES.filter((c) => c.symbol.toLowerCase().includes(s) || c.name.includes(s)).map((c) => c.symbol)
  const out = list.map((sym) => {
    const st = w.stocks[sym]
    const c = e.tmpl[sym]
    const p = prev.get(sym)
    const flash = p === undefined || p === st.last ? '' : st.last > p ? 'flash-up' : 'flash-down'
    prev.set(sym, st.last)
    return {
      sym,
      name: c.name,
      sector: SECTOR_MAP[c.sector].short,
      last: st.last,
      chg: st.prevClose ? st.last / st.prevClose - 1 : 0,
      vol: st.amount / 100,
      status: st.status,
      rw: st.riskWarning,
      watched: w.watchlist.includes(sym),
      held: !!w.account.positions[sym]?.qty,
      flash,
    }
  })
  if (sortKey.value === 'chg') out.sort((a, b) => b.chg - a.chg)
  if (sortKey.value === 'vol') out.sort((a, b) => b.vol - a.vol)
  return out
})

function star(sym: string) {
  game.engine?.toggleWatch(sym)
  game.after()
}
function cycleSort(k: 'chg' | 'vol') {
  sortKey.value = sortKey.value === k ? 'none' : k
}
</script>

<template>
  <section class="panel flush slist">
    <div class="panel-h"><span class="title">Watchlist</span><span class="tiny muted">{{ rows.length }} 只</span></div>
    <div style="padding: 8px">
      <div class="seg mb" style="display: flex">
        <button :class="{ active: tab === 'watch' }" @click="tab = 'watch'">自选</button>
        <button :class="{ active: tab === 'all' }" @click="tab = 'all'">全部</button>
        <button :class="{ active: tab === 'held' }" @click="tab = 'held'">持仓</button>
        <button :class="{ active: tab === 'sector' }" @click="tab = 'sector'">行业</button>
      </div>
      <select v-if="tab === 'sector'" v-model="sector" style="width: 100%" class="mb">
        <option v-for="s in SECTORS" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
      <input v-model="q" placeholder="搜索代码/名称" style="width: 100%" aria-label="搜索股票" />
    </div>
    <div class="tbl-wrap list">
      <table class="tbl">
        <thead>
          <tr>
            <th></th><th>股票</th><th class="num">现价</th>
            <th class="num sortable" @click="cycleSort('chg')">涨跌{{ sortKey === 'chg' ? '▾' : '' }}</th>
            <th class="num sortable hide-narrow" @click="cycleSort('vol')">成交额{{ sortKey === 'vol' ? '▾' : '' }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.sym + ':' + r.last" class="clickable" :class="[{ sel: game.symbol === r.sym }, r.flash]" @click="game.symbol = r.sym">
            <td><button class="icon-btn star" :class="{ on: r.watched }" :aria-label="r.watched ? '取消自选' : '加入自选'" @click.stop="star(r.sym)">{{ r.watched ? '★' : '☆' }}</button></td>
            <td>
              <div class="bold">{{ r.sym }}<span v-if="r.held" class="accent tiny"> ●</span></div>
              <div class="tiny muted ellipsis" style="max-width: 90px">
                {{ r.rw ? '*' : '' }}{{ r.name }}
                <span v-if="r.status === 'suspended'" class="warn">停牌</span>
                <span v-if="r.status === 'delisting'" class="danger">退市整理</span>
                <span v-if="r.status === 'delisted'" class="danger">已退市</span>
              </div>
            </td>
            <td class="num">{{ fmtPrice(r.last) }}</td>
            <td class="num"><Chg :v="r.chg" :digits="2" /></td>
            <td class="num tiny hide-narrow">{{ fmtBig(r.vol) }}</td>
          </tr>
          <tr v-if="!rows.length"><td colspan="5" class="empty">{{ tab === 'watch' ? '自选为空，点击 ☆ 添加' : '无匹配股票' }}</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.list { max-height: 640px; overflow-y: auto; }
.star { color: var(--dim); padding: 0; }
.star.on { color: var(--accent); }
.slist td { padding: 4px 5px; }
@media (max-width: 1500px) and (min-width: 861px) {
  .hide-narrow { display: none; }
}
</style>
