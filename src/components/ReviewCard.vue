<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGame } from '../store/game'
import { completeReview, dismissReview } from '../engine/review'
import { BIAS_TAGS } from '../engine/content/learning'
import { SIDE_LABEL, ORDER_TYPE_LABEL } from '../engine/rules'
import { fmtTime } from '../engine/clock'
import { fmtMoney, fmtPrice, fmtQty } from '../engine/util'
import Chg from './Chg.vue'
import Gloss from './Gloss.vue'
import Logo from './Logo.vue'
import type { TradeReview } from '../engine/types'

const props = defineProps<{ reviewId: string }>()
const game = useGame()
const r = computed(() => {
  game.rev
  return game.engine?.w.reviews.find((x) => x.id === props.reviewId)
})
const order = computed(() => {
  game.rev
  return game.engine?.w.orders.find((o) => o.id === r.value?.orderId)
})
const sym = computed(() => game.engine?.rules.currencySymbol ?? '¥')
const followed = ref<TradeReview['followedPlan']>(r.value?.planId ? 'yes' : 'noplan')
const tags = ref<string[]>([])
const note = ref('')
const expanded = ref(!r.value?.completed)

function toggleTag(id: string) {
  tags.value = tags.value.includes(id) ? tags.value.filter((x) => x !== id) : [...tags.value, id]
}
function submit() {
  const e = game.engine
  if (!e || !r.value) return
  completeReview(e, r.value.id, { followedPlan: followed.value, selfBiasTags: tags.value, note: note.value })
  game.after()
}
function skip() {
  const e = game.engine
  if (!e || !r.value) return
  dismissReview(e, r.value.id)
  game.after()
}
const tagLabel = (id: string) => BIAS_TAGS.find((b) => b.id === id)?.label ?? id
</script>

<template>
  <div v-if="r" class="panel review">
    <div class="panel-h">
      <span class="row">
        <Logo :symbol="r.symbol" :size="20" />
        <span class="title-cn">复盘卡 · {{ SIDE_LABEL[r.side] }} {{ r.symbol }}</span>
        <span class="tag" :class="r.completed ? (r.processScore !== undefined ? 'tag-ok' : '') : 'tag-warn'">{{ r.completed ? (r.processScore !== undefined ? '已复盘' : '已跳过') : '待复盘' }}</span>
      </span>
      <button class="btn btn-xs" @click="expanded = !expanded">{{ expanded ? '收起' : '展开' }}</button>
    </div>
    <div class="grid-4 small">
      <div class="stat"><span class="label">成交数量 / 均价</span><span class="num">{{ fmtQty(r.qty) }} @ {{ fmtPrice(Math.round(r.avgPrice)) }}</span></div>
      <div class="stat"><span class="label">费用 / 滑点合计</span><span class="num">{{ fmtMoney(r.fees, sym) }} / {{ fmtMoney(r.slippageTotal, sym) }}</span></div>
      <div class="stat"><span class="label">已实现盈亏</span><Chg :v="r.realizedPnl" kind="money" :sym="sym" /></div>
      <div class="stat"><span class="label">对总账户影响</span><Chg :v="r.equityImpactPct" /></div>
    </div>
    <template v-if="expanded">
      <div class="divider" />
      <div class="grid-2 small">
        <div>
          <div class="bold mb">下单时快照</div>
          <div class="kv">
            <span>订单</span><span>{{ r.orderId }} · {{ order ? ORDER_TYPE_LABEL[order.type] : '' }}</span>
            <span>下单时间</span><span>{{ order ? fmtTime(order.createdAt) : '—' }}</span>
            <span>最新 / 买一 / 卖一</span><span>{{ fmtPrice(r.snapshot.last) }} / {{ fmtPrice(r.snapshot.bid) }} / {{ fmtPrice(r.snapshot.ask) }}</span>
            <span>综指</span><span>{{ r.snapshot.index.toFixed(2) }}</span>
            <span>当时净值</span><span>{{ fmtMoney(r.snapshot.equity, sym) }}</span>
          </div>
          <div v-if="r.snapshot.news.length" class="mt-sm">
            <div class="muted tiny">当时可见新闻：</div>
            <div v-for="(n, i) in r.snapshot.news" :key="i" class="tiny">· {{ n }}</div>
          </div>
        </div>
        <div>
          <div class="bold mb">交易前计划</div>
          <div v-if="r.planSummary" class="note">{{ r.planSummary }}</div>
          <div v-else class="note warn">本次交易没有关联交易计划。</div>
          <div class="bold mt mb">可能的行为偏差（系统依据交易记录推断，仅供参考）</div>
          <div v-if="!r.biasHints.length" class="muted tiny">未从交易记录中观察到明显的风险行为模式。</div>
          <div v-for="(h, i) in r.biasHints" :key="i" class="note warn tiny mt-sm">{{ h }}</div>
        </div>
      </div>
      <div class="note mt small">
        学习点：<Gloss :id="r.learnTag" /> · 思考：{{ r.question }}
      </div>
      <div v-if="!r.completed" class="col mt">
        <label class="field">
          <span>这笔交易是否按计划执行？</span>
          <select v-model="followed">
            <option value="yes">是，按计划执行</option>
            <option value="partial">部分按计划</option>
            <option value="no">没有按计划</option>
            <option value="noplan">没有计划</option>
          </select>
        </label>
        <div>
          <div class="small muted mb">自评行为偏差标签（可多选）：</div>
          <div class="chip-list">
            <button v-for="b in BIAS_TAGS" :key="b.id" class="btn btn-xs" :class="{ active: tags.includes(b.id) }" :title="b.desc" @click="toggleTag(b.id)">{{ b.label }}</button>
          </div>
        </div>
        <label class="field"><span>复盘记录（学到了什么？下次会怎么做？）</span><textarea v-model="note" maxlength="1000" /></label>
        <div class="row end">
          <button class="btn btn-ghost btn-sm" @click="skip">跳过复盘</button>
          <button class="btn btn-primary btn-sm" @click="submit">完成复盘</button>
        </div>
      </div>
      <div v-else-if="r.processScore !== undefined" class="mt">
        <div class="row">
          <span class="bold">过程评分</span><span class="mid-num accent">{{ r.processScore }}</span><span class="muted">/ 100</span>
        </div>
        <div class="tiny muted mb">评分只依据交易过程（计划、仓位、执行、记录、风险控制），与这笔交易是否赚钱无关：遵循纪律但亏损的交易可以是合理决策，冲动交易即使盈利也可能是高风险行为。</div>
        <div v-for="b in r.scoreBreakdown" :key="b.label" class="row small">
          <span class="grow">{{ b.label }}</span>
          <div class="bar thin" style="width: 100px"><i :style="{ width: (b.points / b.max) * 100 + '%' }" /></div>
          <span class="num" style="width: 52px; text-align: right">{{ b.points }}/{{ b.max }}</span>
        </div>
        <div v-if="r.selfBiasTags.length" class="tiny mt-sm">自评标签：{{ r.selfBiasTags.map(tagLabel).join('、') }}</div>
        <div v-if="r.note" class="note mt-sm small">{{ r.note }}</div>
      </div>
      <div v-else class="muted tiny mt">{{ r.note }}</div>
    </template>
  </div>
</template>

<style scoped>
.review {
  margin-bottom: 12px;
}
</style>
