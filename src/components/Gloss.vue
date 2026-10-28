<script setup lang="ts">
import { computed } from 'vue'
import { GLOSSARY } from '../engine/content/learning'
import { openGlossary } from '../store/ui'
const props = defineProps<{ id: string }>()
const entry = computed(() => GLOSSARY.find((g) => g.id === props.id))
</script>

<template>
  <span
    class="gloss"
    role="button"
    tabindex="0"
    :title="entry ? `${entry.term}：${entry.short}（点击查看详解）` : ''"
    @click.stop="openGlossary(id)"
    @keydown.enter="openGlossary(id)"
    ><slot>{{ entry?.term ?? id }}</slot><sup aria-hidden="true">?</sup></span
  >
</template>

<style scoped>
.gloss {
  border-bottom: 1px dotted var(--accent2);
  cursor: help;
}
.gloss sup {
  color: var(--accent2);
  font-size: 0.7em;
  margin-left: 1px;
}
</style>
