<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useGame } from '../store/game'
import { useSettings } from '../store/settings'
import Modal from './Modal.vue'
import Gloss from './Gloss.vue'
import PlanModal from './PlanModal.vue'
import { estimateOrder, equity, type SubmitResult } from '../engine/trading'
import { ORDER_TYPE_LABEL, SIDE_LABEL, STATUS_LABEL, TIF_LABEL } from '../engine/rules'
import { UNLOCKS } from '../engine/params'
import { fmtMoney, fmtPct, fmtPrice, fmtQty } from '../engine/util'
import type { OrderSide, OrderType, TimeInForce } from '../engine/types'

const props = defineProps<{ symbol: string }>()
const game = useGame()
const settings = useSettings()

const side = ref<OrderSide>('buy')
const type = ref<OrderType>('limit')
const tif = ref<TimeInForce>('DAY')
const qty = ref(0)
const limitYuan = ref('')
const stopYuan = ref('')
const planId = ref('')
const confirmOpen = ref(false)
const planOpen = ref(false)
const submitting = ref(false)
const result = ref<SubmitResult | null>(null)
const qtyInput = ref<HTMLInputElement>()
const newKey = () => 'CK' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
const clientKey = ref(newKey())

const e = computed(() => {
  game.rev
  return game.engine
})
const st = computed(() => {
  game.rev
  return e.value?.w.stocks[props.symbol]
})
const lot = computed(() => e.value?.rules.lotSize ?? 1)
const tick = computed(() => e.value?.rules.tickSize ?? 1)
const sym = computed(() => e.value?.rules.currencySymbol ?? '¥')
const margin = computed(() => {
  game.rev
  return !!e.value?.w.account.marginEnabled
})
const sides = computed<OrderSide[]>(() => (margin.value ? ['buy', 'sell', 'short', 'cover'] : ['buy', 'sell']))
const stopUnlocked = computed(() => {
  game.rev
  return !!e.value?.isUnlocked('stopOrders')
})
const types = computed(() => e.value?.rules.orderTypes ?? [])
const plans = computed(() => {
  game.rev
  return (e.value?.w.plans ?? []).filter((p) => p.symbol === props.symbol && p.status === 'active')
})

const toCents = (s: string) => {
  const v = parseFloat(s)
  return isFinite(v) && v > 0 ? Math.round(v * 100) : undefined
}
const limitPrice = computed(() => (type.value === 'limit' || type.value === 'stopLimit' ? toCents(limitYuan.value) : undefined))
const stopPrice = computed(() => (type.value === 'stop' || type.value === 'stopLimit' ? toCents(stopYuan.value) : undefined))

const est = computed(() => {
  game.rev
  if (!e.value || !st.value) return null
  return estimateOrder(e.value, {
    symbol: props.symbol,
    side: side.value,
    type: type.value,
    tif: tif.value,
    qty: Math.floor(qty.value) || 0,
    limitPrice: limitPrice.value,
    stopPrice: stopPrice.value,
    planId: planId.value || undefined,
  })
})

watch(
  () => est.value?.locked,
  (l) => {
    if (l && side.value === 'sell') e.value?.setFlag('viewed_t1_hint')
  },
)

function resetPrice() {
  const s = st.value
  if (!s) return
  limitYuan.value = (s.last / 100).toFixed(2)
  const offset = Math.max(tick.value, Math.round(s.last * 0.03))
  const sp = side.value === 'buy' || side.value === 'cover' ? s.last + offset : s.last - offset
  stopYuan.value = (Math.max(tick.value, sp) / 100).toFixed(2)
}
watch(
  () => props.symbol,
  () => {
    qty.value = lot.value
    planId.value = ''
    result.value = null
    resetPrice()
  },
  { immediate: true },
)
watch(side, resetPrice)
watch([side, type, tif, qty, limitYuan, stopYuan, planId], () => {
  if (!submitting.value) clientKey.value = newKey()
})

function adjPrice(which: 'limit' | 'stop', dir: number) {
  const r = which === 'limit' ? limitYuan : stopYuan
  const c = toCents(r.value) ?? st.value?.last ?? 0
  r.value = (Math.max(tick.value, c + dir * tick.value) / 100).toFixed(2)
}
function adjQty(dir: number) {
  qty.value = Math.max(0, (Math.floor(qty.value / lot.value) + dir) * lot.value)
}
function quick(frac: number) {
  const m = est.value?.maxQty ?? 0
  if (frac === 1) {
    qty.value = m
    return
  }
  qty.value = Math.max(0, Math.floor((m * frac) / lot.value) * lot.value)
}

const needsConfirm = computed(() => {
  if (!e.value || !est.value) return true
  if (side.value === 'short' || side.value === 'cover' || margin.value) return true
  if (settings.s.confirmLowRisk) return true
  return est.value.notional >= settings.s.confirmThresholdPct * equity(e.value)
})

function trySubmit() {
  if (submitting.value) return
  if (needsConfirm.value) confirmOpen.value = true
  else doSubmit()
}

function doSubmit() {
  const en = e.value
  if (!en || submitting.value) return
  submitting.value = true
  confirmOpen.value = false
  const res = en.submit({
    clientKey: clientKey.value,
    symbol: props.symbol,
    side: side.value,
    type: type.value,
    tif: tif.value,
    qty: Math.floor(qty.value),
    limitPrice: limitPrice.value,
    stopPrice: stopPrice.value,
    planId: planId.value || undefined,
  })
  result.value = res
  game.after()
  // 冷却后再生成新的幂等键，防止连点产生重复订单
  setTimeout(() => {
    submitting.value = false
    clientKey.value = newKey()
  }, 700)
}

function focusQty() {
  nextTick(() => {
    qtyInput.value?.focus()
    qtyInput.value?.select()
  })
}
watch(
  () => game.ticketPreset?.n,
  () => {
    const p = game.ticketPreset
    if (!p) return
    if (sides.value.includes(p.side)) side.value = p.side
    if (p.qty) qty.value = p.qty
    if (p.price) limitYuan.value = (p.price / 100).toFixed(2)
    focusQty()
  },
  { immediate: true },
)
defineExpose({ focusQty })

const resultOrder = computed(() => {
  game.rev
  const id = result.value?.order?.id
  return id ? e.value?.w.orders.find((o) => o.id === id) : undefined
})
function onPlanCreated(id: string) {
  planId.value = id
  planOpen.value = false
}
const sideBtnClass = (s: OrderSide) => (side.value !== s ? 'btn-ghost' : s === 'buy' || s === 'cover' ? 'btn-buy' : 'btn-sell')
</script>

<template>
  <section class="panel" v-if="e && st">
    <div class="panel-h">
      <span class="title">Order Ticket</span>
      <span class="tiny muted">模拟交易 · {{ e.rules.name }}</span>
    </div>
    <div class="row wrap gap-sm mb">
      <button v-for="s in sides" :key="s" class="btn btn-sm" :class="sideBtnClass(s)" @click="side = s">{{ SIDE_LABEL[s] }}</button>
    </div>
    <div class="col">
      <label class="field">
        <span>订单类型</span>
        <select v-model="type">
          <option v-for="t in types" :key="t" :value="t" :disabled="(t === 'stop' || t === 'stopLimit') && !stopUnlocked">
            {{ ORDER_TYPE_LABEL[t] }}{{ (t === 'stop' || t === 'stopLimit') && !stopUnlocked ? `（🔒 Lv.${UNLOCKS.stopOrders.level} 解锁）` : '' }}
          </option>
        </select>
      </label>
      <div class="tiny muted">
        <template v-if="type === 'market'"><Gloss id="market_order">市价单</Gloss>：尽快按盘口成交，不保证价格（保护价 ±5%）。</template>
        <template v-else-if="type === 'limit'"><Gloss id="limit_order">限价单</Gloss>：成交价不劣于限价，但可能不成交。</template>
        <template v-else-if="type === 'stop'"><Gloss id="stop_order">止损单</Gloss>：最新价触及触发价后转为市价单，跳空时可能有较大<Gloss id="slippage">滑点</Gloss>。</template>
        <template v-else><Gloss id="stop_limit_order">止损限价单</Gloss>：触发后转为限价单，控价但可能无法成交。</template>
      </div>
      <label v-if="type === 'stop' || type === 'stopLimit'" class="field">
        <span>触发价（{{ sym }}）</span>
        <div class="stepper"><button @click="adjPrice('stop', -1)">−</button><input v-model="stopYuan" inputmode="decimal" class="num" /><button @click="adjPrice('stop', 1)">+</button></div>
      </label>
      <label v-if="type === 'limit' || type === 'stopLimit'" class="field">
        <span>限价（{{ sym }}）</span>
        <div class="stepper"><button @click="adjPrice('limit', -1)">−</button><input v-model="limitYuan" inputmode="decimal" class="num" /><button @click="adjPrice('limit', 1)">+</button></div>
      </label>
      <label class="field">
        <span>数量（股，最小单位 {{ lot }} 股）</span>
        <div class="stepper"><button @click="adjQty(-1)">−</button><input ref="qtyInput" v-model.number="qty" type="number" min="0" :step="lot" class="num" /><button @click="adjQty(1)">+</button></div>
      </label>
      <div class="row gap-sm wrap">
        <button class="btn btn-xs" @click="quick(0.25)">1/4</button>
        <button class="btn btn-xs" @click="quick(0.5)">1/2</button>
        <button class="btn btn-xs" @click="quick(1)">全部</button>
        <span class="tiny muted">最大可{{ SIDE_LABEL[side] }} {{ fmtQty(est?.maxQty ?? 0) }} 股</span>
      </div>
      <label class="field">
        <span>有效期</span>
        <select v-model="tif">
          <option v-for="t in e.rules.tifs" :key="t" :value="t">{{ TIF_LABEL[t] }}</option>
        </select>
      </label>
      <label class="field">
        <span>关联交易计划</span>
        <div class="row">
          <select v-model="planId" class="grow">
            <option value="">不关联（自由模式可跳过）</option>
            <option v-for="p in plans" :key="p.id" :value="p.id">{{ p.id }} · {{ p.reason.slice(0, 16) }}</option>
          </select>
          <button class="btn btn-xs" @click="planOpen = true">新建计划</button>
        </div>
      </label>
    </div>

    <div v-if="est" class="panel inset mt">
      <div class="kv">
        <span>预计成交额</span><span>{{ fmtMoney(est.notional, sym) }}</span>
        <span>预计费用</span><span>{{ fmtMoney(est.fees.total, sym) }}</span>
        <span class="tiny">　佣金 / 经手 / 监管</span><span class="tiny">{{ fmtMoney(est.fees.commission, sym) }} / {{ fmtMoney(est.fees.exchangeFee, sym) }} / {{ fmtMoney(est.fees.regulatoryFee, sym) }}</span>
        <span class="tiny">　印花税 / 过户费</span><span class="tiny">{{ fmtMoney(est.fees.stampTax, sym) }} / {{ fmtMoney(est.fees.transferFee, sym) }}</span>
        <template v-if="side === 'buy' || side === 'cover'"><span>预计冻结资金</span><span>{{ fmtMoney(est.freeze, sym) }}</span></template>
        <template v-if="est.netProceeds !== undefined"><span>预计净收入</span><span>{{ fmtMoney(est.netProceeds, sym) }}</span></template>
        <span>可用现金</span><span>{{ fmtMoney(est.available, sym) }}</span>
        <template v-if="side === 'sell'">
          <span><Gloss id="sellable_qty">可卖数量</Gloss></span><span>{{ fmtQty(est.sellable) }} 股</span>
          <span><Gloss id="settlement_t1">{{ e.rules.settlement.label }}</Gloss> 未到可卖日</span><span>{{ fmtQty(est.locked) }} 股</span>
          <span>挂单占用</span><span>{{ fmtQty(e.w.account.positions[symbol]?.frozenQty ?? 0) }} 股</span>
        </template>
        <template v-if="side === 'cover'"><span>可平空</span><span>{{ fmtQty(est.coverable) }} 股</span></template>
        <template v-if="type === 'market' || type === 'stop'"><span>估计滑点范围</span><span>{{ fmtPct(est.slippageRange[0], 2, false) }} ~ {{ fmtPct(est.slippageRange[1], 2, false) }}</span></template>
      </div>
      <div v-if="est.locked && side === 'sell'" class="note warn mt-sm tiny">今日买入的 {{ fmtQty(est.locked) }} 股须按 {{ e.rules.settlement.label }} 规则在下一交易日起才能卖出，交易引擎会拒绝超出可卖数量的卖单。</div>
      <ul v-if="est.warnings.length" class="warns tiny">
        <li v-for="(w, i) in est.warnings" :key="i">⚠ {{ w }}</li>
      </ul>
      <div v-if="est.error && qty > 0" class="note danger mt-sm small">✘ {{ est.error }}</div>
    </div>

    <button
      class="btn btn-block mt"
      :class="side === 'buy' || side === 'cover' ? 'btn-buy' : 'btn-sell'"
      :disabled="submitting || !qty || qty <= 0"
      @click="trySubmit"
    >
      {{ submitting ? '提交中…' : `提交${SIDE_LABEL[side]}订单` }}
    </button>

    <div v-if="result" class="mt-sm">
      <div v-if="result.ok && resultOrder" class="note ok small">
        <div>{{ result.duplicate ? '检测到重复提交，已返回原订单（未生成新订单）。' : '订单已提交至模拟交易引擎。' }}</div>
        <div>
          订单 <b>{{ resultOrder.id }}</b> 当前状态：<b>{{ STATUS_LABEL[resultOrder.status] }}</b>
          <template v-if="resultOrder.filledQty">（已成交 {{ fmtQty(resultOrder.filledQty) }} / {{ fmtQty(resultOrder.qty) }} 股，均价 {{ fmtPrice(resultOrder.avgFillPrice) }}）</template>
          <template v-else>（尚未成交）</template>
        </div>
      </div>
      <div v-else class="note danger small">
        <div>订单被拒绝：{{ result.error }}</div>
        <div v-if="result.suggestion" class="muted">修正建议：{{ result.suggestion }}</div>
      </div>
    </div>

    <Modal v-if="confirmOpen" title="确认订单" size="narrow" @close="confirmOpen = false">
      <div class="kv">
        <span>股票</span><span>{{ symbol }} {{ e.tmpl[symbol].name }}</span>
        <span>方向</span><span :class="side === 'buy' || side === 'cover' ? 'up' : 'down'" class="bold">{{ SIDE_LABEL[side] }}</span>
        <span>类型</span><span>{{ ORDER_TYPE_LABEL[type] }}</span>
        <span>数量</span><span>{{ fmtQty(qty) }} 股</span>
        <template v-if="limitPrice"><span>限价</span><span>{{ fmtPrice(limitPrice) }}</span></template>
        <template v-if="stopPrice"><span>触发价</span><span>{{ fmtPrice(stopPrice) }}</span></template>
        <span>有效期</span><span>{{ TIF_LABEL[tif] }}</span>
        <span>预计成交额</span><span>{{ fmtMoney(est?.notional ?? 0, sym) }}</span>
        <span>预计费用</span><span>{{ fmtMoney(est?.fees.total ?? 0, sym) }}</span>
        <template v-if="side === 'buy' || side === 'cover'"><span>冻结资金</span><span>{{ fmtMoney(est?.freeze ?? 0, sym) }}</span></template>
        <span>交易计划</span><span>{{ planId || '未关联' }}</span>
      </div>
      <ul v-if="est?.warnings.length" class="warns tiny">
        <li v-for="(w, i) in est.warnings" :key="i">⚠ {{ w }}</li>
      </ul>
      <div v-if="side === 'short' || margin" class="note danger mt-sm small">保证金/卖空订单：亏损可能超过投入，价格不利变化可能触发追加保证金或强制平仓。</div>
      <div class="note mt-sm tiny">这是模拟交易，使用虚拟资金，不会影响任何真实账户。「已接受」不代表已成交。</div>
      <template #footer>
        <button class="btn btn-ghost" @click="confirmOpen = false">返回修改</button>
        <button class="btn" :class="side === 'buy' || side === 'cover' ? 'btn-buy' : 'btn-sell'" :disabled="submitting" @click="doSubmit">确认提交</button>
      </template>
    </Modal>
    <PlanModal v-if="planOpen" :symbol="symbol" @close="planOpen = false" @created="onPlanCreated" />
  </section>
</template>

<style scoped>
.warns {
  margin: 8px 0 0;
  padding-left: 4px;
  list-style: none;
  color: var(--warn);
}
</style>
