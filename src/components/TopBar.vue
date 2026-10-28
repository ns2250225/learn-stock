<script setup lang="ts">
import { computed } from 'vue'
import { useGame, SPEEDS, type Speed } from '../store/game'
import { uiState } from '../store/ui'
import { fmtDate, fmtClock } from '../engine/clock'
import { equity } from '../engine/trading'
import { fmtMoney } from '../engine/util'
import Chg from './Chg.vue'

const game = useGame()
const info = computed(() => {
  const e = game.e
  if (!e) return null
  const w = e.w
  const ph = e.phase
  const eq = equity(e)
  const toClose = e.minutesToClose()
  return {
    date: fmtDate(e.dayIndex),
    clock: fmtClock(e.minuteOfDay),
    phase: ph,
    phaseLabel: e.phaseLabel,
    toClose,
    eq,
    dayPnl: eq - w.account.dayStartEquity,
    td: w.clock.tradingDay,
    mode: w.meta.mode,
    sym: e.rules.currencySymbol,
    unread: w.notices.filter((n) => !n.read).length,
    challenge: w.challenge && !w.challenge.finished ? `${Math.max(0, w.challenge.endDay - w.clock.tradingDay)} 日后结束` : '',
  }
})
const phaseClass = computed(() => {
  const p = info.value?.phase
  return p === 'continuous' ? 'tag-ok' : p === 'opening' || p === 'closing' ? 'tag-warn' : p === 'preopen' ? 'tag-info' : ''
})
const speedLabel = (s: Speed) => (s === 0 ? '⏸' : s + 'x')
const MODE: Record<string, string> = { tutorial: '新手教学', free: '自由模拟', challenge: '情景挑战' }
</script>

<template>
  <header class="topbar">
    <div class="brand row">
      <span class="logo pixel">像素<span class="accent">证券城</span></span>
      <span class="sim-badge" title="所有公司、价格、新闻与资金均为虚构模拟数据">模拟数据</span>
    </div>
    <template v-if="info">
      <div class="clock row">
        <div class="col gap-sm" style="gap: 0">
          <span class="num bold date">{{ info.date }}</span>
          <span class="tiny muted">交易日 #{{ info.td }} · {{ MODE[info.mode] }}<template v-if="info.challenge"> · 挑战{{ info.challenge }}</template></span>
        </div>
        <span class="mid-num accent">{{ info.clock }}</span>
        <span class="tag" :class="phaseClass">{{ info.phaseLabel }}</span>
        <span v-if="info.toClose" class="tiny muted hide-mobile">距收盘 {{ info.toClose }} 分</span>
      </div>
      <div class="speed row gap-sm" role="group" aria-label="时间控制">
        <button
          v-for="s in SPEEDS"
          :key="s"
          class="btn btn-xs"
          :class="{ active: game.speed === s }"
          :disabled="game.busy"
          :title="s === 0 ? '暂停（行情、新闻与撮合全部冻结）' : `${s} 倍速`"
          @click="game.setSpeed(s)"
        >
          {{ speedLabel(s) }}
        </button>
        <button class="btn btn-xs" :disabled="game.busy" title="单步推进 1 个模拟分钟" @click="game.stepOnce()">⏭</button>
        <button class="btn btn-xs" :disabled="game.busy" title="快速推进到今日收盘结算" @click="game.runToClose()">⏩ <span class="hide-mobile">收盘</span>{{ game.busy ? '结算中…' : '结算' }}</button>
      </div>
      <div class="acct row hide-mobile">
        <div class="col right" style="gap: 0">
          <span class="tiny muted">账户净值</span>
          <span class="num bold">{{ fmtMoney(info.eq, info.sym) }}</span>
        </div>
        <div class="col right" style="gap: 0">
          <span class="tiny muted">今日盈亏</span>
          <Chg :v="info.dayPnl" kind="money" :sym="info.sym" />
        </div>
      </div>
      <button class="icon-btn bell" :title="`通知（${info.unread} 条未读）`" @click="uiState.notificationsOpen = !uiState.notificationsOpen">
        🔔<span v-if="info.unread" class="dot">{{ info.unread > 99 ? '99+' : info.unread }}</span>
      </button>
      <button class="icon-btn" title="搜索股票（/）" @click="uiState.searchOpen = true">🔍</button>
    </template>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 8px 14px;
  background: var(--panel3);
  border-bottom: 3px solid var(--border);
  box-shadow: 0 3px 0 var(--shadow);
}
.logo {
  font-size: 0.8em;
  color: var(--text);
}
.clock {
  flex: 1 1 auto;
  min-width: 0;
}
.bell {
  position: relative;
}
.dot {
  position: absolute;
  top: -4px;
  right: -8px;
  background: var(--danger);
  color: #fff;
  font-size: 0.62em;
  padding: 0 4px;
  font-weight: 700;
}
.date {
  white-space: nowrap;
}
@media (max-width: 860px) {
  .topbar {
    gap: 6px;
    padding: 6px 8px;
  }
  .brand .logo {
    font-size: 0.6em;
  }
  .clock {
    flex-wrap: wrap;
    row-gap: 2px;
  }
  .speed {
    order: 5;
    width: 100%;
    overflow-x: auto;
    flex-wrap: nowrap;
  }
}
</style>
