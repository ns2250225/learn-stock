import { defineStore } from 'pinia'
import { reactive, watch } from 'vue'

export type ColorScheme = 'auto' | 'redUp' | 'greenUp' | 'colorblind'

export const SHORTCUT_ACTIONS: Record<string, string> = {
  search: '搜索股票',
  pause: '暂停 / 继续',
  buy: '买入并聚焦数量',
  sell: '卖出并聚焦数量',
  orders: '打开订单列表',
  hall: '市场大厅',
  trade: '交易终端',
  account: '我的账户',
  news: '新闻社',
  research: '研究室',
  learn: '学习中心',
  home: '投资者公寓',
  step: '单步推进',
}

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  search: '/',
  pause: ' ',
  buy: 'b',
  sell: 's',
  orders: 'o',
  hall: '1',
  trade: '2',
  account: '3',
  news: '4',
  research: '5',
  learn: '6',
  home: '7',
  step: '.',
}

export interface Settings {
  colorScheme: ColorScheme
  theme: 'dark' | 'light'
  fontScale: number
  reduceFlash: boolean
  reduceMotion: boolean
  highContrast: boolean
  confirmLowRisk: boolean // 低风险订单（金额 < 阈值）也二次确认
  confirmThresholdPct: number
  shortcutsEnabled: boolean
  shortcuts: Record<string, string>
  tutorialHints: boolean
  tutorialPause: boolean
  pauseAtClose: boolean
  unlockAll: boolean
  maxOrderPct: number
  showChartTable: boolean
  sound: boolean
}

const KEY = 'pixel-stock-settings'

export function defaultSettings(): Settings {
  return {
    colorScheme: 'auto',
    theme: 'dark',
    fontScale: 1,
    reduceFlash: false,
    reduceMotion: false,
    highContrast: false,
    confirmLowRisk: true,
    confirmThresholdPct: 0.1,
    shortcutsEnabled: true,
    shortcuts: { ...DEFAULT_SHORTCUTS },
    tutorialHints: true,
    tutorialPause: true,
    pauseAtClose: true,
    unlockAll: false,
    maxOrderPct: 1,
    showChartTable: false,
    sound: false,
  }
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw)
      const d = defaultSettings()
      return { ...d, ...s, shortcuts: { ...d.shortcuts, ...(s.shortcuts ?? {}) } }
    }
  } catch {
    /* 忽略 */
  }
  return defaultSettings()
}

export const useSettings = defineStore('settings', () => {
  const s = reactive<Settings>(load())
  watch(
    s,
    () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(s))
      } catch {
        /* 忽略 */
      }
      applyDom(s)
    },
    { deep: true, immediate: true },
  )
  function replace(n: Partial<Settings>) {
    Object.assign(s, defaultSettings(), n)
  }
  function reset() {
    Object.assign(s, defaultSettings())
  }
  return { s, replace, reset }
})

function applyDom(s: Settings) {
  if (typeof document === 'undefined') return
  const r = document.documentElement
  r.style.setProperty('--font-scale', String(s.fontScale))
  r.dataset.theme = s.theme
  r.classList.toggle('reduce-motion', s.reduceMotion)
  r.classList.toggle('reduce-flash', s.reduceFlash || s.reduceMotion)
  r.classList.toggle('high-contrast', s.highContrast)
}
