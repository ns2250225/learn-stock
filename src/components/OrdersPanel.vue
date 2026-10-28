<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGame } from '../store/game'
import Gloss from './Gloss.vue'
import Chg from './Chg.vue'
import { equity, isOpen, lockedQty, positionSummary, sellableQty } from '../engine/trading'
import { ORDER_TYPE_LABEL, SIDE_LABEL, STATUS_LABEL, TIF_LABEL } from '../engine/rules'
import { fmtClock, fmtTime } from '../engine/clock'
import { fmtMoney, fmtPct, fmtPrice, fmtQty, fmtSignedMoney } from '../engine/util'
import type { Order } from '../engine/types'

const props = defineProps<{ symbol?: string }>()
const game = useGame()
const tab = ref<'open' | 'fills' | 'history' | 'positions' | 'ledger'>('open')
const onlySym = ref(false)
const expanded = ref<string>('')
const msg = ref('')

const sym = computed(() => game.engine?.rules.currencySymbol ?? '¥')
const filt = (s: string) => !onlySym.value || !props.symbol || s === props.symbol
const td = computed(() => {
  game.rev
  return game.engine?.w.clock.tradingDay ?? 0
})
const openOrders = computed(() => {
  game.rev
  return (game.engine?.w.orders ?? []).filter((o) => isOpen(o) && filt(o.symbol)).reverse()
})
const fills = computed(() => {
  game.rev
  return (game.engine?.w.executions ?? []).filter((x) => x.tradingDay === td.value && filt(x.symbol)).reverse()
})
const history = computed(() => {
  game.rev
  return (game.engine?.w.orders ?? []).filter((o) => !isOpen(o) && filt(o.symbol)).slice(-80).reverse()
})
const positions = computed(() => {
  game.rev
  const e = game.engine
  if (!e) return []
  const eq = Math.max(1, equity(e))
  return Object.values(e.w.account.positions)
    .filter((p) => filt(p.symbol))
    .map((p) => {
      const s = positionSummary(e, p)
      return { p, ...s, sellable: sellableQty(e, p.symbol), locked: lockedQty(e, p.symbol), weight: s.mv / eq, name: e.tmpl[p.symbol].name }
    })
})
const ledger = computed(() => {
  game.rev
  return (game.engine?.w.ledger ?? []).filter((l) => l.tradingDay === td.value && (!l.symbol || filt(l.symbol))).slice(-60).reverse()
})

function cancel(o: Order) {
  const r = game.engine!.cancel(o.id)
  msg.value = `${o.id}：${r.message}`
  game.after()
}
const statusClass = (s: string) => (s === 'filled' ? 'tag-ok' : s === 'rejected' ? 'tag-danger' : s === 'cancelled' || s === 'expired' ? '' : s === 'cancelPending' ? 'tag-warn' : 'tag-info')
</script>

<template>
  <section class="panel">
    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'open' }" @click="tab = 'open'">当前挂单 ({{ openOrders.length }})</button>
      <button class="tab" :class="{ active: tab === 'fills' }" @click="tab = 'fills'">当日成交 ({{ fills.length }})</button>
      <button class="tab" :class="{ active: tab === 'history' }" @click="tab = 'history'">历史订单</button>
      <button class="tab" :class="{ active: tab === 'positions' }" @click="tab = 'positions'">持仓</button>
      <button class="tab" :class="{ active: tab === 'ledger' }" @click="tab = 'ledger'">资金变化</button>
      <label v-if="symbol" class="check tiny" style="margin-left: auto"><input v-model="onlySym" type="checkbox" />只看 {{ symbol }}</label>
    </div>
    <div v-if="msg" class="note small mb">{{ msg }}</div>
    <div class="tbl-wrap" style="max-height: 300px">
      <table v-if="tab === 'open'" class="tbl">
        <thead><tr><th>订单</th><th>时间</th><th>股票</th><th>方向</th><th>类型</th><th class="num">限价/触发</th><th class="num">已成交/数量</th><th>有效期</th><th>状态</th><th class="num">冻结</th><th></th></tr></thead>
        <tbody>
          <tr v-for="o in openOrders" :key="o.id">
            <td>{{ o.id }}</td><td>{{ fmtClock(o.createdAt % 1440) }}</td>
            <td><a @click="game.openStock(o.symbol)">{{ o.symbol }}</a></td>
            <td :class="o.side === 'buy' || o.side === 'cover' ? 'up' : 'down'">{{ SIDE_LABEL[o.side] }}</td>
            <td>{{ ORDER_TYPE_LABEL[o.type] }}</td>
            <td class="num">{{ fmtPrice(o.limitPrice) }}/{{ fmtPrice(o.stopPrice) }}</td>
            <td class="num">{{ fmtQty(o.filledQty) }}/{{ fmtQty(o.qty) }}</td>
            <td>{{ TIF_LABEL[o.tif] }}</td>
            <td><span class="tag" :class="statusClass(o.status)">{{ STATUS_LABEL[o.status] }}</span></td>
            <td class="num">{{ o.frozenCash ? fmtMoney(o.frozenCash, sym) : '—' }}</td>
            <td><button class="btn btn-xs" :disabled="o.status === 'cancelPending'" @click="cancel(o)">{{ o.status === 'cancelPending' ? '撤单中' : '撤单' }}</button></td>
          </tr>
          <tr v-if="!openOrders.length"><td colspan="11" class="empty">暂无挂单</td></tr>
        </tbody>
      </table>

      <table v-else-if="tab === 'fills'" class="tbl">
        <thead><tr><th>时间</th><th>成交号</th><th>订单</th><th>股票</th><th>方向</th><th class="num">数量</th><th class="num">价格</th><th class="num">金额</th><th class="num">费用</th><th>流动性</th><th class="num"><Gloss id="slippage">滑点</Gloss>/股</th><th class="num">已实现</th></tr></thead>
        <tbody>
          <tr v-for="x in fills" :key="x.id">
            <td>{{ fmtClock(x.ts % 1440) }}</td><td>{{ x.id }}</td><td>{{ x.orderId }}</td><td>{{ x.symbol }}</td>
            <td :class="x.side === 'buy' || x.side === 'cover' ? 'up' : 'down'">{{ SIDE_LABEL[x.side] }}</td>
            <td class="num">{{ fmtQty(x.qty) }}</td><td class="num">{{ fmtPrice(x.price) }}</td><td class="num">{{ fmtMoney(x.value, sym) }}</td>
            <td class="num">{{ fmtMoney(x.totalFee, sym) }}</td><td>{{ x.liquidity === 'taker' ? '主动' : x.liquidity === 'maker' ? '被动' : '竞价' }}</td>
            <td class="num" :class="x.slippage > 0 ? 'warn' : ''">{{ (x.slippage / 100).toFixed(3) }}</td>
            <td class="num">{{ x.realizedPnl !== undefined ? fmtSignedMoney(x.realizedPnl, sym) : '—' }}</td>
          </tr>
          <tr v-if="!fills.length"><td colspan="12" class="empty">今日暂无成交</td></tr>
        </tbody>
      </table>

      <table v-else-if="tab === 'history'" class="tbl">
        <thead><tr><th></th><th>订单</th><th>时间</th><th>股票</th><th>方向</th><th>类型</th><th class="num">成交/数量</th><th class="num">均价</th><th class="num">费用</th><th>状态</th><th>原因</th></tr></thead>
        <tbody>
          <template v-for="o in history" :key="o.id">
            <tr class="clickable" @click="expanded = expanded === o.id ? '' : o.id">
              <td>{{ expanded === o.id ? '▾' : '▸' }}</td>
              <td>{{ o.id }}<span v-if="o.forced" class="tag tag-danger">强平</span></td><td>{{ fmtTime(o.createdAt) }}</td><td>{{ o.symbol }}</td>
              <td :class="o.side === 'buy' || o.side === 'cover' ? 'up' : 'down'">{{ SIDE_LABEL[o.side] }}</td><td>{{ ORDER_TYPE_LABEL[o.type] }}</td>
              <td class="num">{{ fmtQty(o.filledQty) }}/{{ fmtQty(o.qty) }}</td><td class="num">{{ o.filledQty ? fmtPrice(o.avgFillPrice) : '—' }}</td>
              <td class="num">{{ fmtMoney(o.fees, sym) }}</td>
              <td><span class="tag" :class="statusClass(o.status)">{{ STATUS_LABEL[o.status] }}</span></td>
              <td class="ellipsis" style="max-width: 260px">{{ o.history[o.history.length - 1]?.reason }}</td>
            </tr>
            <tr v-if="expanded === o.id">
              <td colspan="11">
                <div class="timeline">
                  <div v-for="(h, i) in o.history" :key="i" class="tiny row top">
                    <span class="muted nowrap">{{ fmtTime(h.ts) }}</span>
                    <span class="tag">{{ h.from ? STATUS_LABEL[h.from] + ' → ' : '' }}{{ STATUS_LABEL[h.to] }}</span>
                    <span class="grow" style="white-space: normal">{{ h.reason }}</span>
                    <span class="nowrap muted">成交 {{ h.filledQty }} / 剩余 {{ h.remainingQty }}{{ h.fees ? ' · 费用 ' + fmtMoney(h.fees, sym) : '' }}</span>
                  </div>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="!history.length"><td colspan="11" class="empty">暂无历史订单</td></tr>
        </tbody>
      </table>

      <table v-else-if="tab === 'positions'" class="tbl">
        <thead><tr><th>股票</th><th class="num">持仓</th><th class="num"><Gloss id="sellable_qty">可卖</Gloss></th><th class="num">T+1 锁定</th><th class="num">挂单冻结</th><th class="num"><Gloss id="avg_cost">成本价</Gloss></th><th class="num">现价</th><th class="num">市值</th><th class="num"><Gloss id="unrealized_pnl">浮动盈亏</Gloss></th><th class="num"><Gloss id="realized_pnl">已实现</Gloss></th><th class="num">占净值</th></tr></thead>
        <tbody>
          <tr v-for="r in positions" :key="r.p.symbol" class="clickable" @click="game.openStock(r.p.symbol)">
            <td><b>{{ r.p.symbol }}</b> <span class="muted tiny">{{ r.name }}</span><span v-if="r.p.qty < 0" class="tag tag-warn">空头</span></td>
            <td class="num">{{ fmtQty(r.p.qty) }}</td><td class="num">{{ fmtQty(r.sellable) }}</td><td class="num">{{ fmtQty(r.locked) }}</td><td class="num">{{ fmtQty(r.p.frozenQty) }}</td>
            <td class="num">{{ fmtPrice(r.avg) }}</td><td class="num">{{ fmtPrice(r.px) }}</td><td class="num">{{ fmtMoney(r.mv, sym) }}</td>
            <td class="num"><Chg :v="r.unreal" kind="money" :sym="sym" /> <span class="tiny">({{ fmtPct(r.p.costBasis ? r.unreal / Math.abs(r.p.costBasis) : 0) }})</span></td>
            <td class="num"><Chg :v="r.p.realizedPnl" kind="money" :sym="sym" :arrow="false" /></td>
            <td class="num">{{ fmtPct(r.weight, 1, false) }}</td>
          </tr>
          <tr v-if="!positions.length"><td colspan="11" class="empty">暂无持仓</td></tr>
        </tbody>
      </table>

      <table v-else class="tbl">
        <thead><tr><th>时间</th><th>流水号</th><th>类型</th><th>股票</th><th class="num">金额</th><th class="num">余额</th><th class="num">冻结</th><th>说明</th></tr></thead>
        <tbody>
          <tr v-for="l in ledger" :key="l.id">
            <td>{{ fmtClock(l.ts % 1440) }}</td><td>{{ l.id }}</td><td>{{ l.type }}</td><td>{{ l.symbol ?? '—' }}</td>
            <td class="num" :class="l.type === 'freeze' || l.type === 'unfreeze' ? 'muted' : l.amount > 0 ? 'up' : l.amount < 0 ? 'down' : ''">{{ l.type === 'freeze' || l.type === 'unfreeze' ? '冻结 ' : '' }}{{ fmtSignedMoney(l.amount, sym) }}</td>
            <td class="num">{{ fmtMoney(l.balanceAfter, sym) }}</td><td class="num">{{ fmtMoney(l.frozenAfter, sym) }}</td>
            <td class="ellipsis" style="max-width: 320px">{{ l.note }}</td>
          </tr>
          <tr v-if="!ledger.length"><td colspan="8" class="empty">今日暂无资金变化</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.timeline { display: flex; flex-direction: column; gap: 4px; padding: 4px 8px; border-left: 2px solid var(--accent); }
</style>
