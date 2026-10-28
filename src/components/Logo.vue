<script setup lang="ts">
import { computed } from 'vue'
import { hashString } from '../engine/rng'
import { COMPANIES } from '../engine/content/companies'
/** 原创虚构像素 logo：由代码哈希生成左右对称 6×6 图案 */
const props = withDefaults(defineProps<{ symbol: string; size?: number }>(), { size: 28 })
const cells = computed(() => {
  const h = hashString(props.symbol + 'logo')
  const out: { x: number; y: number; c: number }[] = []
  let bit = 0
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 3; x++) {
      const v = (h >>> bit % 32) & 3
      bit += 2
      if (v === 0) continue
      out.push({ x, y, c: v === 3 ? 1 : 0 }, { x: 5 - x, y, c: v === 3 ? 1 : 0 })
    }
  return out
})
const colors = computed(() => COMPANIES.find((c) => c.symbol === props.symbol)?.logoColors ?? ['#f4c95d', '#6fd3e8'])
</script>

<template>
  <svg :width="size" :height="size" viewBox="-1 -1 8 8" shape-rendering="crispEdges" aria-hidden="true" style="flex: none">
    <rect x="-1" y="-1" width="8" height="8" fill="#0f1524" />
    <rect v-for="(c, i) in cells" :key="i" :x="c.x" :y="c.y" width="1" height="1" :fill="colors[c.c]" />
  </svg>
</template>
