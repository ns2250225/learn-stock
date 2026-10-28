<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGame } from '../store/game'
import Modal from './Modal.vue'
import { createPlan } from '../engine/review'
import { equity } from '../engine/trading'
import { UNLOCKS } from '../engine/params'
import { fmtMoney, fmtPrice, fmtQty } from '../engine/util'

const props = defineProps<{ symbol: string }>()
const emit = defineEmits<{ close: []; created: [planId: string] }>()
const game = useGame()
const e = game.engine!
const st = e.w.stocks[props.symbol]
const sym = e.rules.currencySymbol
const lot = e.rules.lotSize

const reason = ref('')
const hypothesis = ref('')
const horizon = ref<'short' | 'medium' | 'long'>('medium')
const invalidation = ref('')
const targetPct = ref(0.1)
const stopYuan = ref('')
const targetYuan = ref('')
const tranches = ref<{ price: string; qty: number }[]>([])
const alertYuan = ref('')
const alertDir = ref<'above' | 'below'>('below')
const msg = ref('')
const placeOrders = ref(true)

const canTranche = computed(() => {
  game.rev
  return e.isUnlocked('tranchePlan')
})
const canAlert = computed(() => {
  game.rev
  return e.isUnlocked('alerts')
})
const toC = (s: string) => {
  const v = parseFloat(s)
  return isFinite(v) && v > 0 ? Math.round(v * 100) : undefined
}
const preview = computed(() => {
  game.rev
  const eq = equity(e)
  const invest = Math.round(eq * targetPct.value)
  const estFee = Math.round(Math.max(e.rules.fees.minCommission, invest * e.rules.fees.commissionRate) * 2 + invest * e.rules.fees.stampTaxSellRate)
  const stop = toC(stopYuan.value)
  const maxLoss = stop && st.last > 0 ? Math.round(invest * Math.max(0, 1 - stop / st.last)) + estFee : invest
  return { invest, estFee, maxLoss, shares: Math.floor(invest / Math.max(1, st.last) / lot) * lot }
})
const valid = computed(() => reason.value.trim().length > 0 && hypothesis.value.trim().length > 0)

function addTranche() {
  const last = st.last
  const n = tranches.value.length
  tranches.value.push({ price: ((last * (1 - 0.02 * n)) / 100).toFixed(2), qty: Math.max(lot, Math.floor(preview.value.shares / 3 / lot) * lot) })
}

function save() {
  if (!valid.value) return
  const tr = canTranche.value
    ? tranches.value.map((t) => ({ price: toC(t.price) ?? 0, qty: Math.floor(t.qty) })).filter((t) => t.price > 0 && t.qty > 0)
    : undefined
  const plan = createPlan(e, {
    symbol: props.symbol,
    reason: reason.value.trim(),
    hypothesis: hypothesis.value.trim(),
    horizon: horizon.value,
    invalidation: invalidation.value.trim(),
    targetPct: targetPct.value,
    stopPrice: toC(stopYuan.value),
    targetPrice: toC(targetYuan.value),
    tranches: tr?.length ? tr : undefined,
  })
  const errors: string[] = []
  if (tr?.length && placeOrders.value && plan.tranches) {
    for (const t of plan.tranches) {
      const r = e.submit({ clientKey: `TR-${plan.id}-${t.price}-${t.qty}`, symbol: props.symbol, side: 'buy', type: 'limit', tif: 'GTC', qty: t.qty, limitPrice: t.price, planId: plan.id })
      if (r.order) t.orderId = r.order.id
      if (!r.ok) errors.push(`${fmtPrice(t.price)}×${t.qty}：${r.error}`)
    }
  }
  game.after()
  if (errors.length) game.toast('warn', '部分分批订单被拒绝', errors.join('；'))
  else game.toast('success', '交易计划已保存', plan.id)
  emit('created', plan.id)
}

function addAlert() {
  const p = toC(alertYuan.value)
  if (!p) {
    msg.value = '请输入有效的提醒价'
    return
  }
  e.addAlert(props.symbol, p, alertDir.value)
  msg.value = `已设置：价格${alertDir.value === 'above' ? '升至' : '跌至'} ${fmtPrice(p)} 时提醒（不会自动下单）`
  game.after()
}
</script>

<template>
  <Modal :title="`交易计划 · ${symbol} ${e.tmpl[symbol].name}`" size="wide" @close="emit('close')">
    <div class="note mb small">交易前计划帮助你在事后判断：交易是否按预期执行。系统不会因你选择的方向打分，只看计划是否清晰、风险是否被理解。</div>
    <div class="grid-2">
      <div class="col">
        <label class="field"><span>为什么关注这家公司？*</span><textarea v-model="reason" placeholder="例如：财报显示现金流改善，估值低于同行中位数…" /></label>
        <label class="field"><span>交易假设是什么？*</span><textarea v-model="hypothesis" placeholder="例如：若下季度毛利率维持，盈利预期可能上修…" /></label>
        <label class="field"><span>什么情况说明判断可能错了？（证伪/退出条件）</span><textarea v-model="invalidation" placeholder="例如：毛利率连续两季下滑，或跌破某价格…" /></label>
        <label class="field">
          <span>预期持有周期</span>
          <div class="seg">
            <button :class="{ active: horizon === 'short' }" @click="horizon = 'short'">短期</button>
            <button :class="{ active: horizon === 'medium' }" @click="horizon = 'medium'">中期</button>
            <button :class="{ active: horizon === 'long' }" @click="horizon = 'long'">长期</button>
          </div>
        </label>
      </div>
      <div class="col">
        <label class="field">
          <span>计划投入账户净值比例：{{ (targetPct * 100).toFixed(0) }}%</span>
          <input v-model.number="targetPct" type="range" min="0.01" max="1" step="0.01" />
        </label>
        <div class="grid-2">
          <label class="field"><span>止损/退出价（{{ sym }}）</span><input v-model="stopYuan" inputmode="decimal" :placeholder="fmtPrice(Math.round(st.last * 0.92))" /></label>
          <label class="field"><span>目标价（{{ sym }}）</span><input v-model="targetYuan" inputmode="decimal" /></label>
        </div>
        <div class="panel inset">
          <div class="kv">
            <span>当前价</span><span>{{ fmtPrice(st.last) }}</span>
            <span>计划投入</span><span>{{ fmtMoney(preview.invest, sym) }}（约 {{ fmtQty(preview.shares) }} 股）</span>
            <span>预计往返费用</span><span>{{ fmtMoney(preview.estFee, sym) }}</span>
            <span>预计潜在亏损{{ stopYuan ? '（至退出价）' : '（未设退出价=全部投入）' }}</span><span class="down">{{ fmtMoney(preview.maxLoss, sym) }}</span>
          </div>
          <div class="tiny muted mt-sm">跳空时实际亏损可能超过按退出价估算的金额。</div>
        </div>
        <div class="panel inset">
          <div class="bold small mb-sm">分批建仓</div>
          <div v-if="!canTranche" class="lock tiny">🔒 Lv.{{ UNLOCKS.tranchePlan.level }} 解锁分批建仓计划</div>
          <template v-else>
            <div v-for="(t, i) in tranches" :key="i" class="row mt-sm">
              <input v-model="t.price" inputmode="decimal" placeholder="价格" style="width: 90px" />
              <input v-model.number="t.qty" type="number" :step="lot" style="width: 100px" />
              <span class="tiny muted">股</span>
              <button class="icon-btn" @click="tranches.splice(i, 1)">✕</button>
            </div>
            <div class="row mt-sm">
              <button class="btn btn-xs" @click="addTranche">＋ 添加一档</button>
              <label v-if="tranches.length" class="check tiny"><input v-model="placeOrders" type="checkbox" />保存时为每档提交「撤销前有效」限价买单</label>
            </div>
          </template>
        </div>
        <div class="panel inset">
          <div class="bold small mb-sm">价格提醒（止损提醒）</div>
          <div v-if="!canAlert" class="lock tiny">🔒 Lv.{{ UNLOCKS.alerts.level }} 解锁价格提醒</div>
          <div v-else class="row wrap">
            <select v-model="alertDir"><option value="below">跌至</option><option value="above">升至</option></select>
            <input v-model="alertYuan" inputmode="decimal" placeholder="提醒价" style="width: 100px" />
            <button class="btn btn-xs" @click="addAlert">设置提醒</button>
          </div>
          <div v-if="msg" class="tiny ok mt-sm">{{ msg }}</div>
        </div>
      </div>
    </div>
    <template #footer>
      <span v-if="!valid" class="tiny muted">请至少填写关注理由与交易假设</span>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button class="btn btn-primary" :disabled="!valid" @click="save">保存计划</button>
    </template>
  </Modal>
</template>

<style scoped>
.mb-sm { margin-bottom: 4px; }
</style>
