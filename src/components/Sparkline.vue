<script setup lang="ts">
import { computed } from 'vue'
const props = withDefaults(defineProps<{ data: number[]; width?: number; height?: number; base?: number }>(), { width: 120, height: 32 })
const path = computed(() => {
  const d = props.data
  if (d.length < 2) return ''
  const min = Math.min(...d, props.base ?? Infinity)
  const max = Math.max(...d, props.base ?? -Infinity)
  const span = max - min || 1
  return d.map((v, i) => `${i ? 'L' : 'M'}${((i / (d.length - 1)) * props.width).toFixed(1)},${(props.height - 2 - ((v - min) / span) * (props.height - 4)).toFixed(1)}`).join(' ')
})
const baseY = computed(() => {
  if (props.base === undefined || props.data.length < 2) return null
  const min = Math.min(...props.data, props.base)
  const max = Math.max(...props.data, props.base)
  return props.height - 2 - ((props.base - min) / (max - min || 1)) * (props.height - 4)
})
const dir = computed(() => {
  const d = props.data
  if (d.length < 2) return 'flat'
  const ref = props.base ?? d[0]
  return d[d.length - 1] > ref ? 'up' : d[d.length - 1] < ref ? 'down' : 'flat'
})
</script>

<template>
  <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" :class="dir" role="img" aria-label="走势缩略图">
    <line v-if="baseY !== null" x1="0" :x2="width" :y1="baseY" :y2="baseY" stroke="currentColor" stroke-opacity="0.3" stroke-dasharray="2 3" />
    <path :d="path" fill="none" stroke="currentColor" stroke-width="1.6" shape-rendering="crispEdges" />
  </svg>
</template>
