<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watchEffect } from 'vue'
import { useGame, type Page } from './store/game'
import { useSettings } from './store/settings'
import { uiState } from './store/ui'
import TopBar from './components/TopBar.vue'
import SideNav from './components/SideNav.vue'
import RightRail from './components/RightRail.vue'
import Toasts from './components/Toasts.vue'
import GlossaryModal from './components/GlossaryModal.vue'
import SearchModal from './components/SearchModal.vue'
import NotificationDrawer from './components/NotificationDrawer.vue'
import DaySummaryModal from './components/DaySummaryModal.vue'
import KeyEventModal from './components/KeyEventModal.vue'
import ChallengeEndModal from './components/ChallengeEndModal.vue'
import NewGame from './views/NewGame.vue'
import Hall from './views/Hall.vue'
import Trade from './views/Trade.vue'
import StockDetail from './views/StockDetail.vue'
import Account from './views/Account.vue'
import News from './views/News.vue'
import Research from './views/Research.vue'
import Learn from './views/Learn.vue'
import Home from './views/Home.vue'

const game = useGame()
const settings = useSettings()

const views: Record<Page, unknown> = { hall: Hall, trade: Trade, stock: StockDetail, account: Account, news: News, research: Research, learn: Learn, home: Home }
const current = computed(() => views[game.page])

/** 涨跌颜色语义：跟随规则包或玩家选择；色盲友好配色使用蓝/橙 */
watchEffect(() => {
  game.rev
  let scheme = settings.s.colorScheme as string
  if (scheme === 'auto') scheme = game.engine?.rules.colorConvention ?? 'redUp'
  const r = document.documentElement.style
  const red = '#ff5c5c'
  const green = '#3ddc84'
  const [up, down] = scheme === 'greenUp' ? [green, red] : scheme === 'colorblind' ? ['#4ea1ff', '#ff9f1c'] : [red, green]
  r.setProperty('--up', up)
  r.setProperty('--down', down)
  r.setProperty('--up-bg', up + '22')
  r.setProperty('--down-bg', down + '22')
})

const mobileItems: { page: Page; label: string; icon: string }[] = [
  { page: 'hall', label: '大厅', icon: '🏛️' },
  { page: 'trade', label: '交易', icon: '💹' },
  { page: 'account', label: '账户', icon: '🏦' },
  { page: 'news', label: '新闻', icon: '📰' },
  { page: 'learn', label: '学习', icon: '🎓' },
  { page: 'home', label: '我的', icon: '🏠' },
]

function onKey(ev: KeyboardEvent) {
  if (!settings.s.shortcutsEnabled || !game.engine || game.showNewGame) return
  const t = ev.target as HTMLElement
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return
  if (document.querySelector('.modal-backdrop')) return
  const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key
  const sc = settings.s.shortcuts
  const act = Object.keys(sc).find((a) => sc[a] && sc[a].toLowerCase() === k)
  if (!act) return
  ev.preventDefault()
  switch (act) {
    case 'search':
      uiState.searchOpen = true
      break
    case 'pause':
      game.togglePause()
      break
    case 'step':
      game.stepOnce()
      break
    case 'buy':
      game.openTrade(game.symbol, 'buy')
      break
    case 'sell':
      game.openTrade(game.symbol, 'sell')
      break
    case 'orders':
      game.go('account', 'orders')
      break
    default:
      game.go(act as Page)
  }
}

onMounted(() => {
  void game.init()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="!game.ready" class="loading pixel">LOADING…</div>
  <NewGame v-else-if="game.showNewGame || !game.engine" />
  <div v-else class="app-shell">
    <TopBar class="app-top" />
    <SideNav class="app-nav" />
    <main class="app-main" :key="game.page">
      <component :is="current" />
    </main>
    <RightRail class="app-rail" />
    <nav class="mobile-nav" aria-label="页面切换">
      <button v-for="it in mobileItems" :key="it.page" :class="{ active: game.page === it.page }" @click="game.go(it.page)">
        <span class="ico" aria-hidden="true">{{ it.icon }}</span>{{ it.label }}
      </button>
    </nav>
    <DaySummaryModal v-if="game.summaryDay !== null" />
    <KeyEventModal v-if="game.keyEvent" />
    <ChallengeEndModal v-if="game.challengeEndOpen" />
    <SearchModal v-if="uiState.searchOpen" />
    <NotificationDrawer v-if="uiState.notificationsOpen" />
  </div>
  <GlossaryModal v-if="uiState.glossaryId" />
  <Toasts />
</template>

<style>
.loading {
  display: flex;
  height: 100vh;
  align-items: center;
  justify-content: center;
  color: var(--accent);
}
</style>
