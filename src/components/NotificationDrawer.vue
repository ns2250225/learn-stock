<script setup lang="ts">
import { computed } from 'vue'
import Modal from './Modal.vue'
import { useGame } from '../store/game'
import { uiState } from '../store/ui'
import { fmtTime } from '../engine/clock'
const game = useGame()
const list = computed(() => {
  game.rev
  return [...(game.engine?.w.notices ?? [])].reverse().slice(0, 150)
})
function close() {
  for (const n of game.engine?.w.notices ?? []) n.read = true
  uiState.notificationsOpen = false
  game.bump()
}
function open(sym?: string) {
  if (!sym) return
  close()
  game.openStock(sym)
}
</script>

<template>
  <Modal title="通知与风险提示历史" @close="close">
    <div v-if="!list.length" class="empty">暂无通知</div>
    <div v-for="n in list" :key="n.id" class="list-item" :class="{ active: !n.read }" @click="open(n.symbol)">
      <div class="row between">
        <span class="bold" :class="n.level === 'danger' ? 'danger' : n.level === 'warn' ? 'warn' : n.level === 'success' ? 'ok' : ''">{{ n.title }}</span>
        <span class="tiny muted nowrap">{{ fmtTime(n.ts) }}</span>
      </div>
      <div class="small muted">{{ n.body }}</div>
    </div>
    <template #footer><button class="btn btn-primary" @click="close">全部标为已读</button></template>
  </Modal>
</template>
