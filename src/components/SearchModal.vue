<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import Modal from './Modal.vue'
import Logo from './Logo.vue'
import Chg from './Chg.vue'
import { COMPANIES } from '../engine/content/companies'
import { SECTOR_MAP } from '../engine/content/sectors'
import { uiState } from '../store/ui'
import { useGame } from '../store/game'
import { fmtPrice } from '../engine/util'
const game = useGame()
const q = ref('')
const sel = ref(0)
const inp = ref<HTMLInputElement>()
const results = computed(() => {
  game.rev
  const s = q.value.trim().toLowerCase()
  return COMPANIES.filter((c) => !s || c.symbol.toLowerCase().includes(s) || c.name.includes(s) || SECTOR_MAP[c.sector].name.includes(s)).slice(0, 12)
})
function close() {
  uiState.searchOpen = false
}
function pick(sym: string, trade = false) {
  close()
  if (trade) game.openTrade(sym)
  else game.openStock(sym)
}
function onKey(ev: KeyboardEvent) {
  if (ev.key === 'ArrowDown') { sel.value = Math.min(results.value.length - 1, sel.value + 1); ev.preventDefault() }
  if (ev.key === 'ArrowUp') { sel.value = Math.max(0, sel.value - 1); ev.preventDefault() }
  if (ev.key === 'Enter' && results.value[sel.value]) pick(results.value[sel.value].symbol, ev.shiftKey)
}
onMounted(() => nextTick(() => inp.value?.focus()))
</script>

<template>
  <Modal title="搜索股票" size="narrow" @close="close">
    <input ref="inp" v-model="q" placeholder="输入代码、名称或行业…" style="width: 100%" @keydown="onKey" @input="sel = 0" />
    <div class="tiny muted mt-sm">↑↓ 选择 · Enter 打开详情 · Shift+Enter 打开交易终端</div>
    <div class="mt-sm">
      <div v-for="(c, i) in results" :key="c.symbol" class="list-item row" :class="{ active: i === sel }" @click="pick(c.symbol)">
        <Logo :symbol="c.symbol" :size="22" />
        <span class="bold">{{ c.symbol }}</span>
        <span class="grow ellipsis">{{ c.name }} <span class="muted tiny">{{ SECTOR_MAP[c.sector].name }}</span></span>
        <template v-if="game.engine">
          <span class="num">{{ fmtPrice(game.engine.w.stocks[c.symbol].last) }}</span>
          <Chg :v="game.engine.w.stocks[c.symbol].last / game.engine.w.stocks[c.symbol].prevClose - 1" />
        </template>
        <button class="btn btn-xs" @click.stop="pick(c.symbol, true)">交易</button>
      </div>
    </div>
  </Modal>
</template>
