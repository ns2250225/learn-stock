<script setup lang="ts">
import { useGame } from '../store/game'
const game = useGame()
</script>

<template>
  <div class="toasts" role="status" aria-live="polite">
    <div v-for="t in game.toasts" :key="t.id" class="toast" :class="t.level" @click="game.toasts = game.toasts.filter((x) => x.id !== t.id)">
      <div class="t">{{ t.title }}</div>
      <div v-if="t.body" class="small muted">{{ t.body }}</div>
    </div>
  </div>
</template>
