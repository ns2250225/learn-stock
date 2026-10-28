<script setup lang="ts">
import { computed } from 'vue'
import Modal from './Modal.vue'
import { GLOSSARY } from '../engine/content/learning'
import { uiState } from '../store/ui'
import { useGame } from '../store/game'
const game = useGame()
const entry = computed(() => GLOSSARY.find((g) => g.id === uiState.glossaryId))
function close() {
  game.engine?.setFlag('viewed_glossary')
  uiState.glossaryId = ''
}
function openLearn() {
  uiState.glossaryId = ''
  game.go('learn', 'glossary')
}
</script>

<template>
  <Modal v-if="entry" :title="`词典 · ${entry.term}`" size="narrow" @close="close">
    <div class="muted small mb">{{ entry.en }}</div>
    <p class="bold">{{ entry.short }}</p>
    <div class="prose">
      <p v-for="(p, i) in entry.detail.split('\n')" :key="i">{{ p }}</p>
    </div>
    <div v-if="entry.example" class="note mt">例：{{ entry.example }}</div>
    <template #footer>
      <button class="btn btn-ghost" @click="openLearn">打开词典</button>
      <button class="btn btn-primary" @click="close">知道了</button>
    </template>
  </Modal>
</template>
