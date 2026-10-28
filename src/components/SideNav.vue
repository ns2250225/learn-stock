<script setup lang="ts">
import { useGame, type Page } from '../store/game'
const game = useGame()
export interface NavItem {
  page: Page
  label: string
  place: string
  icon: string
}
const items: NavItem[] = [
  { page: 'hall', label: '市场大厅', place: '交易所大楼', icon: '🏛️' },
  { page: 'trade', label: '交易终端', place: '券商营业厅', icon: '💹' },
  { page: 'account', label: '我的账户', place: '账户中心', icon: '🏦' },
  { page: 'news', label: '新闻社', place: '财经新闻社', icon: '📰' },
  { page: 'research', label: '研究室', place: '研究图书馆', icon: '🔬' },
  { page: 'learn', label: '学习中心', place: '投资学院', icon: '🎓' },
  { page: 'home', label: '投资者公寓', place: '交易者公寓', icon: '🏠' },
]
defineExpose({ items })
</script>

<template>
  <nav class="sidenav" aria-label="像素城市导航">
    <button
      v-for="(it, i) in items"
      :key="it.page"
      class="nav-item"
      :class="{ active: game.page === it.page || (it.page === 'trade' && game.page === 'stock') }"
      :title="`${it.place} · ${it.label}（快捷键 ${i + 1}）`"
      @click="game.go(it.page)"
    >
      <span class="tile" aria-hidden="true">{{ it.icon }}</span>
      <span class="lbl">{{ it.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.sidenav {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 8px;
  position: sticky;
  top: 64px;
}
.nav-item {
  background: none;
  border: 0;
  color: var(--muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 2px;
  cursor: pointer;
  font-size: 0.74em;
  font-weight: 700;
}
.tile {
  width: 46px;
  height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.7em;
  background: var(--panel2);
  box-shadow: 0 0 0 2px var(--border), 3px 3px 0 2px var(--shadow);
}
.nav-item:hover .tile {
  box-shadow: 0 0 0 2px var(--border-hi), 3px 3px 0 2px var(--shadow);
}
.nav-item.active {
  color: var(--accent);
}
.nav-item.active .tile {
  background: var(--panel3);
  box-shadow: 0 0 0 2px var(--accent), 3px 3px 0 2px var(--shadow);
}
</style>
