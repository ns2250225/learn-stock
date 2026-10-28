<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGame } from '../store/game'
import PixelBanner from '../components/PixelBanner.vue'
import StockList from '../components/StockList.vue'
import KChart from '../components/KChart.vue'
import Attribution from '../components/Attribution.vue'
import OrderBook from '../components/OrderBook.vue'
import OrderTicket from '../components/OrderTicket.vue'
import OrdersPanel from '../components/OrdersPanel.vue'
import Logo from '../components/Logo.vue'
import Chg from '../components/Chg.vue'
import Gloss from '../components/Gloss.vue'
import { tradablePrice } from '../engine/market'
import { SECTOR_MAP } from '../engine/content/sectors'
import { fmtBig, fmtPrice, fmtQty, fmtPct } from '../engine/util'

const game = useGame()
const mode = ref<'intraday' | 'day' | 'week'>('intraday')
const mtab = ref<'list' | 'chart' | 'ticket' | 'orders'>('chart')
const showAttr = ref(true)

const h = computed(() => {
  game.rev
  const e = game.engine
  if (!e) return null
  const st = e.w.stocks[game.symbol]
  if (!st) return null
  const c = e.tmpl[game.symbol]
  const ph = e.phase
  const pl = e.rules.priceLimit.enabled
  return {
    st,
    c,
    sector: SECTOR_MAP[c.sector].name,
    chg: st.prevClose ? st.last / st.prevClose - 1 : 0,
    indicative: ph === 'opening' && st.status !== 'suspended' ? tradablePrice(e, st) : null,
    limitUp: pl && st.last >= st.limitUp && st.status === 'normal',
    limitDown: pl && st.last <= st.limitDown && st.status === 'normal',
    spread: st.book.asks[0] && st.book.bids[0] ? st.book.asks[0].price - st.book.bids[0].price : 0,
    watched: e.w.watchlist.includes(game.symbol),
    sym: e.rules.currencySymbol,
    earnSoon: st.nextEarningsDay - e.w.clock.tradingDay,
  }
})
function toggleWatch() {
  game.engine?.toggleWatch(game.symbol)
  game.after()
}
</script>

<template>
  <div class="trade">
    <PixelBanner scene="broker" :height="110" class="hide-mobile" />
    <div class="seg show-mobile mb" style="display: flex">
      <button :class="{ active: mtab === 'list' }" @click="mtab = 'list'">列表</button>
      <button :class="{ active: mtab === 'chart' }" @click="mtab = 'chart'">图表</button>
      <button :class="{ active: mtab === 'ticket' }" @click="mtab = 'ticket'">下单</button>
      <button :class="{ active: mtab === 'orders' }" @click="mtab = 'orders'">订单</button>
    </div>

    <!-- 头部（所有尺寸可见，保留关键价格信息） -->
    <section v-if="h" class="panel head mb">
      <div class="row wrap between">
        <div class="row wrap">
          <Logo :symbol="game.symbol" :size="36" />
          <div>
            <div class="row wrap gap-sm">
              <a class="bold" style="font-size: 1.15em" @click="game.openStock(game.symbol)">{{ h.st.riskWarning ? '*' : '' }}{{ h.c.name }}</a>
              <span class="muted">{{ game.symbol }} · {{ h.sector }}</span>
              <span v-if="h.st.status === 'suspended'" class="tag tag-warn">停牌</span>
              <span v-if="h.st.riskWarning" class="tag tag-danger">风险警示</span>
              <span v-if="h.st.status === 'delisting'" class="tag tag-danger">退市整理期</span>
              <span v-if="h.st.status === 'delisted'" class="tag tag-danger">已退市</span>
              <span v-if="h.limitUp" class="tag tag-danger">▲ 涨停</span>
              <span v-if="h.limitDown" class="tag tag-ok">▼ 跌停</span>
              <span v-if="h.earnSoon >= 0 && h.earnSoon <= 3" class="tag tag-info">{{ h.earnSoon === 0 ? '今日' : h.earnSoon + ' 日后' }}财报</span>
            </div>
            <div class="row wrap gap-sm">
              <span class="big-num" :class="h.chg > 0 ? 'up' : h.chg < 0 ? 'down' : 'flat'">{{ fmtPrice(h.st.last) }}</span>
              <Chg :v="h.chg" word />
              <Chg :v="h.st.last - h.st.prevClose" kind="money" :sym="h.sym" :arrow="false" />
            </div>
          </div>
        </div>
        <div class="kv small quote">
          <span>今开</span><span>{{ fmtPrice(h.st.open) }}</span>
          <span>最高</span><span>{{ fmtPrice(h.st.high) }}</span>
          <span>最低</span><span>{{ fmtPrice(h.st.low) }}</span>
          <span>昨收</span><span>{{ fmtPrice(h.st.prevClose) }}</span>
          <span>成交量</span><span>{{ fmtQty(h.st.volume) }} 股</span>
          <span>成交额</span><span>{{ fmtBig(h.st.amount / 100) }}</span>
          <span><Gloss id="bid_ask_spread">价差</Gloss></span><span>{{ fmtPrice(h.spread) }} ({{ fmtPct(h.st.last ? h.spread / h.st.last : 0, 2, false) }})</span>
          <span><Gloss id="price_limit">涨跌停</Gloss></span><span>{{ game.engine!.rules.priceLimit.enabled ? `${fmtPrice(h.st.limitDown)}/${fmtPrice(h.st.limitUp)}` : '不限' }}</span>
        </div>
        <div class="col gap-sm">
          <button class="btn btn-sm" @click="toggleWatch">{{ h.watched ? '★ 已自选' : '☆ 加自选' }}</button>
          <button class="btn btn-sm btn-ghost" @click="game.openStock(game.symbol)">股票详情</button>
        </div>
      </div>
      <div v-if="h.indicative !== null" class="note warn mt-sm small">
        <Gloss id="call_auction">开盘集合竞价</Gloss>进行中：参考开盘价 <b class="num">{{ fmtPrice(h.indicative) }}</b>（较昨收 {{ fmtPct(h.indicative / h.st.prevClose - 1) }}），最终开盘价在竞价结束时确定。
      </div>
    </section>

    <div class="tgrid">
      <div class="c-list" :class="{ 'm-hide': mtab !== 'list' }"><StockList /></div>
      <div class="c-main" :class="{ 'm-hide': mtab !== 'chart' }">
        <section class="panel">
          <div class="row between wrap mb">
            <div class="seg">
              <button :class="{ active: mode === 'intraday' }" @click="mode = 'intraday'">分时</button>
              <button :class="{ active: mode === 'day' }" @click="mode = 'day'">日K</button>
              <button :class="{ active: mode === 'week' }" @click="mode = 'week'">周K</button>
            </div>
            <label class="check tiny"><input v-model="showAttr" type="checkbox" />显示行情归因</label>
          </div>
          <KChart :symbol="game.symbol" :mode="mode" :height="340" />
        </section>
        <Attribution v-if="showAttr" :symbol="game.symbol" class="mt" />
      </div>
      <div class="c-side" :class="{ 'm-hide': mtab !== 'ticket' }">
        <OrderBook :symbol="game.symbol" />
        <OrderTicket :symbol="game.symbol" class="mt" />
      </div>
      <div class="c-bottom" :class="{ 'm-hide': mtab !== 'orders' }"><OrdersPanel :symbol="game.symbol" /></div>
    </div>
  </div>
</template>

<style scoped>
.tgrid {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr) 320px;
  grid-template-areas: 'list main side' 'bottom bottom bottom';
  gap: 12px;
}
.c-list { grid-area: list; min-width: 0; }
.c-main { grid-area: main; min-width: 0; }
.c-side { grid-area: side; min-width: 0; }
.c-bottom { grid-area: bottom; min-width: 0; }
.quote { min-width: 260px; grid-template-columns: auto 1fr auto 1fr; }
@media (max-width: 1500px) {
  .tgrid { grid-template-columns: 220px minmax(0, 1fr) 300px; }
}
@media (max-width: 1150px) {
  .tgrid { grid-template-columns: minmax(0, 1fr) 300px; grid-template-areas: 'main side' 'list side' 'bottom bottom'; }
}
@media (max-width: 860px) {
  .tgrid { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'list' 'main' 'side' 'bottom'; }
  .m-hide { display: none; }
  .quote { grid-template-columns: auto 1fr auto 1fr; min-width: 0; width: 100%; }
}
</style>
