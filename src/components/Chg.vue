<script setup lang="ts">
import { computed } from 'vue'
import { fmtPct, fmtSignedMoney } from '../engine/util'
/** 涨跌展示：颜色 + 箭头 + 正负号 + 文字（不只依赖颜色） */
const props = withDefaults(defineProps<{ v: number; kind?: 'pct' | 'money' | 'num'; digits?: number; arrow?: boolean; sym?: string; word?: boolean }>(), {
  kind: 'pct',
  digits: 2,
  arrow: true,
  sym: '¥',
  word: false,
})
const dir = computed(() => (props.v > 1e-12 ? 'up' : props.v < -1e-12 ? 'down' : 'flat'))
const text = computed(() => {
  if (props.kind === 'money') return fmtSignedMoney(Math.round(props.v), props.sym)
  if (props.kind === 'num') return (props.v > 0 ? '+' : '') + props.v.toFixed(props.digits)
  return fmtPct(props.v, props.digits)
})
const label = computed(() => (dir.value === 'up' ? '上涨' : dir.value === 'down' ? '下跌' : '持平'))
</script>

<template>
  <span class="num nowrap" :class="dir" :title="label">
    <span v-if="arrow" aria-hidden="true">{{ dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■' }}</span>
    {{ text }}<span v-if="word" class="tiny"> {{ label }}</span>
    <span class="sr-only">{{ label }}</span>
  </span>
</template>
