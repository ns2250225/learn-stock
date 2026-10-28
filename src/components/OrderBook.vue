<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGame } from '../store/game'
import Modal from './Modal.vue'
import Gloss from './Gloss.vue'
import { fmtPrice, fmtQty } from '../engine/util'
import { fmtClock } from '../engine/clock'

const props = defineProps<{ symbol: string }>()
const game = useGame()
const help = ref(false)

const d = computed(() => {
  game.rev
  const e = game.engine
  if (!e) return null
  const st = e.w.stocks[props.symbol]
  if (!st) return null
  const asks = st.book.asks.slice(0, 5)
  const bids = st.book.bids.slice(0, 5)
  const maxQ = Math.max(1, ...asks.map((x) => x.qty), ...bids.map((x) => x.qty))
  const bid1 = bids[0]?.price
  const ask1 = asks[0]?.price
  const mid = bid1 && ask1 ? (bid1 + ask1) / 2 : st.last
  const spread = bid1 && ask1 ? ask1 - bid1 : 0
  const ph = e.phase
  const trading = ph === 'continuous' || ph === 'closing'
  return {
    st,
    asks: asks.slice().reverse().map((x, i) => ({ ...x, lv: asks.length - i, w: x.qty / maxQ })),
    bids: bids.map((x, i) => ({ ...x, lv: i + 1, w: x.qty / maxQ })),
    spread,
    spreadTicks: spread ? Math.round(spread / e.rules.tickSize) : 0,
    bps: mid ? (spread / mid) * 10000 : 0,
    limitUp: e.rules.priceLimit.enabled && st.last >= st.limitUp,
    limitDown: e.rules.priceLimit.enabled && st.last <= st.limitDown,
    trading,
    phaseLabel: e.phaseLabel,
    tape: st.tape.slice(-14).reverse(),
    limits: e.rules.priceLimit.enabled ? `${fmtPrice(st.limitDown)} ~ ${fmtPrice(st.limitUp)}` : '无涨跌幅限制',
  }
})
function openHelp() {
  help.value = true
  game.engine?.setFlag('viewed_order_book_help')
  game.after()
}
const priceCls = (p: number) => (!d.value ? '' : p > d.value.st.prevClose ? 'up' : p < d.value.st.prevClose ? 'down' : 'flat')
</script>

<template>
  <section class="panel">
    <div class="panel-h">
      <span class="title">Order Book</span>
      <button class="btn btn-xs btn-ghost" @click="openHelp">盘口说明</button>
    </div>
    <template v-if="d">
      <div v-if="d.st.status === 'suspended'" class="note warn mb">停牌中：暂停撮合，盘口不更新。复牌时价格可能跳空。</div>
      <div v-else-if="d.st.status === 'delisted'" class="note danger mb">已退市，不再交易。</div>
      <div v-else-if="!d.trading" class="note mb small">当前为「{{ d.phaseLabel }}」，盘口为最近一次快照，非实时可成交报价。</div>
      <div v-if="d.limitUp" class="tag tag-danger mb">▲ 涨停：卖盘稀少</div>
      <div v-if="d.limitDown" class="tag tag-ok mb">▼ 跌停：买盘稀少</div>
      <table class="tbl book">
        <tbody>
          <tr v-for="a in d.asks" :key="'a' + a.lv">
            <td class="muted">卖{{ a.lv }}</td>
            <td class="num" :class="priceCls(a.price)">{{ fmtPrice(a.price) }}</td>
            <td class="num qcell"><i class="qbar down-bar" :style="{ width: a.w * 100 + '%' }" />{{ fmtQty(a.qty) }}</td>
          </tr>
          <tr v-if="!d.asks.length"><td colspan="3" class="muted center tiny">无卖盘</td></tr>
          <tr class="mid">
            <td class="muted tiny">最新</td>
            <td class="num bold" :class="priceCls(d.st.last)">{{ fmtPrice(d.st.last) }}</td>
            <td class="num tiny muted">价差 {{ d.spreadTicks }} 跳 / {{ d.bps.toFixed(1) }}bp</td>
          </tr>
          <tr v-for="b in d.bids" :key="'b' + b.lv">
            <td class="muted">买{{ b.lv }}</td>
            <td class="num" :class="priceCls(b.price)">{{ fmtPrice(b.price) }}</td>
            <td class="num qcell"><i class="qbar up-bar" :style="{ width: b.w * 100 + '%' }" />{{ fmtQty(b.qty) }}</td>
          </tr>
          <tr v-if="!d.bids.length"><td colspan="3" class="muted center tiny">无买盘</td></tr>
        </tbody>
      </table>
      <div class="tiny muted mt-sm">涨跌幅区间：{{ d.limits }} · <Gloss id="bid_ask_spread">买卖价差</Gloss></div>
      <div class="divider" />
      <div class="tiny muted mb-sm">最近成交（模拟成交带）</div>
      <div class="tape">
        <div v-for="(t, i) in d.tape" :key="i" class="row between tiny" :class="{ me: t.player }">
          <span class="muted">{{ fmtClock(t.t % 1440) }}</span>
          <span class="num" :class="priceCls(t.price)">{{ fmtPrice(t.price) }}</span>
          <span class="num">{{ fmtQty(t.qty) }}</span>
          <span :class="t.side === 'B' ? 'up' : 'down'">{{ t.side === 'B' ? '买' : '卖' }}{{ t.player ? '·我' : '' }}</span>
        </div>
        <div v-if="!d.tape.length" class="muted tiny">暂无成交</div>
      </div>
    </template>
    <Modal v-if="help" title="盘口说明" @close="help = false">
      <div class="prose">
        <p>这里显示的是模拟引擎按股票的<b>流动性档位</b>、波动率、市场压力和交易时段生成的虚拟盘口（买一至买五、卖一至卖五），<b>并不是真实参与者的订单</b>。</p>
        <p><Gloss id="market_order">市价单</Gloss>会从卖一（买入）或买一（卖出）开始逐档成交，数量超过某一档就继续吃下一档，所以大单的平均成交价会变差，这就是<Gloss id="slippage">滑点</Gloss>。</p>
        <p><Gloss id="limit_order">限价单</Gloss>如果价格不够「激进」，会挂在盘口之外等待；引擎用本分钟的成交价格区间近似估算你的挂单能否被动成交（价格优先、时间优先）。</p>
        <p>价差会随流动性、波动、开盘/收盘时段和市场恐慌而变化。涨停时卖盘几乎消失，跌停时买盘几乎消失。</p>
        <p>你的订单不会改变公司基本面或随机事件，只会消耗本时间步的盘口深度。</p>
      </div>
      <template #footer><button class="btn btn-primary" @click="help = false">知道了</button></template>
    </Modal>
  </section>
</template>

<style scoped>
.book td { padding: 2px 6px; }
.qcell { position: relative; }
.qbar { position: absolute; right: 0; top: 2px; bottom: 2px; opacity: 0.18; }
.up-bar { background: var(--up); }
.down-bar { background: var(--down); }
.mid td { border-top: 2px solid var(--border); border-bottom: 2px solid var(--border); }
.tape { max-height: 220px; overflow-y: auto; }
.tape .me { background: rgba(244, 201, 93, 0.15); }
.mb-sm { margin-bottom: 4px; }
</style>
