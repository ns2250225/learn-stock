<script setup lang="ts">
import { computed } from 'vue'
import { useGame } from '../store/game'
import { MISSIONS, missionAvailable, objectiveStatus } from '../engine/profile'
import { DAILY_TIPS } from '../engine/content/learning'
import { SOURCE_LABEL } from '../engine/state'
import { fmtClock } from '../engine/clock'
import { isOpen } from '../engine/trading'
import { STATUS_LABEL, SIDE_LABEL } from '../engine/rules'

const game = useGame()
const missions = computed(() => {
  game.rev
  const e = game.engine
  if (!e) return []
  return MISSIONS.filter((m) => !game.profile.missionsDone.includes(m.id) && missionAvailable(m, game.profile))
    .sort((a, b) => a.order - b.order)
    .slice(0, 2)
    .map((m) => ({ m, st: objectiveStatus(e, game.profile, m), ready: game.profile.missionsReady.includes(m.id) }))
})
const news = computed(() => {
  game.rev
  return [...(game.engine?.w.news ?? [])].reverse().slice(0, 8)
})
const open = computed(() => {
  game.rev
  return (game.engine?.w.orders ?? []).filter(isOpen).slice(-6).reverse()
})
const pendingReviews = computed(() => {
  game.rev
  return (game.engine?.w.reviews ?? []).filter((r) => !r.completed).length
})
const tip = computed(() => DAILY_TIPS[(game.engine?.w.clock.tradingDay ?? 0) % DAILY_TIPS.length])
</script>

<template>
  <aside class="col gap-lg" aria-label="信息栏">
    <section class="panel">
      <div class="panel-h"><span class="title">Missions</span><a class="tiny" @click="game.go('learn', 'missions')">全部任务</a></div>
      <div v-if="!missions.length" class="muted small">所有可接任务已完成 🎉</div>
      <div v-for="x in missions" :key="x.m.id" class="mb">
        <div class="bold small">{{ x.m.title }} <span v-if="x.ready" class="tag tag-accent">待答题</span></div>
        <div v-for="(o, i) in x.m.objectives" :key="i" class="tiny" :class="x.st[i] ? 'ok' : 'muted'">{{ x.st[i] ? '☑' : '☐' }} {{ o.text }}</div>
      </div>
    </section>
    <section v-if="pendingReviews" class="panel">
      <div class="row between">
        <span class="small">📝 有 <b class="accent">{{ pendingReviews }}</b> 张复盘卡待完成</span>
        <button class="btn btn-xs" @click="game.go('account', 'journal')">去复盘</button>
      </div>
    </section>
    <section class="panel">
      <div class="panel-h"><span class="title">Orders</span><a class="tiny" @click="game.go('account', 'orders')">订单列表</a></div>
      <div v-if="!open.length" class="muted small">暂无挂单</div>
      <div v-for="o in open" :key="o.id" class="tiny row between hover-row clickable" @click="game.openTrade(o.symbol)">
        <span>{{ SIDE_LABEL[o.side] }} {{ o.symbol }} {{ o.filledQty }}/{{ o.qty }}</span>
        <span class="tag">{{ STATUS_LABEL[o.status] }}</span>
      </div>
    </section>
    <section class="panel">
      <div class="panel-h"><span class="title">News</span><a class="tiny" @click="game.go('news')">新闻社</a></div>
      <div v-for="n in news" :key="n.id" class="tiny list-item" style="padding: 5px 0" @click="game.go('news', n.id)">
        <span class="tag" :class="'src-' + n.sourceType">{{ SOURCE_LABEL[n.sourceType] }}</span>
        <span class="muted"> {{ fmtClock(n.ts % 1440) }} </span>
        <span :class="n.importance >= 3 ? 'bold' : ''">{{ n.title }}</span>
      </div>
    </section>
    <section class="panel">
      <div class="panel-h"><span class="title">Tip</span></div>
      <div class="small muted">💡 {{ tip }}</div>
    </section>
  </aside>
</template>
