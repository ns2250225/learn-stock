<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
const props = withDefaults(defineProps<{ title: string; size?: 'narrow' | 'normal' | 'wide'; closable?: boolean }>(), { size: 'normal', closable: true })
const emit = defineEmits<{ close: [] }>()
function onKey(ev: KeyboardEvent) {
  if (ev.key === 'Escape' && props.closable) emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="modal-backdrop" @mousedown.self="closable && emit('close')">
    <div class="modal" :class="size === 'normal' ? '' : size" role="dialog" aria-modal="true" :aria-label="title">
      <div class="modal-h">
        <h3>{{ title }}</h3>
        <button v-if="closable" class="icon-btn" aria-label="关闭" @click="emit('close')">✕</button>
      </div>
      <div class="modal-b"><slot /></div>
      <div v-if="$slots.footer" class="modal-f"><slot name="footer" /></div>
    </div>
  </div>
</template>
