import type { Cents } from './types'

export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
export const toCents = (yuan: number): Cents => Math.round(yuan * 100)
export const toYuan = (c: Cents) => c / 100

/** 将浮点价格（分）按最小价格单位取整 */
export function roundTick(cents: number, tick: number, mode: 'round' | 'floor' | 'ceil' = 'round'): Cents {
  const f = mode === 'floor' ? Math.floor : mode === 'ceil' ? Math.ceil : Math.round
  return Math.max(tick, f(cents / tick + 1e-9) * tick)
}

export function fmtNum(x: number, digits = 2): string {
  if (!isFinite(x)) return '—'
  return x.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtMoney(c: Cents, sym = '¥', digits = 2): string {
  const neg = c < 0
  return (neg ? '-' : '') + sym + fmtNum(Math.abs(c) / 100, digits)
}

export function fmtSignedMoney(c: Cents, sym = '¥'): string {
  if (c === 0) return sym + '0.00'
  return (c > 0 ? '+' : '-') + sym + fmtNum(Math.abs(c) / 100)
}

export function fmtPrice(c: Cents | undefined): string {
  if (c === undefined || !isFinite(c)) return '—'
  return (c / 100).toFixed(2)
}

export function fmtPct(x: number, digits = 2, sign = true): string {
  if (!isFinite(x)) return '—'
  const v = (x * 100).toFixed(digits)
  return (sign && x > 0 ? '+' : '') + v + '%'
}

export function fmtQty(n: number): string {
  return n.toLocaleString('zh-CN')
}

export function fmtBig(yuan: number): string {
  const a = Math.abs(yuan)
  if (a >= 1e8) return (yuan / 1e8).toFixed(2) + '亿'
  if (a >= 1e4) return (yuan / 1e4).toFixed(2) + '万'
  return yuan.toFixed(0)
}

export function arrow(x: number): string {
  return x > 0 ? '▲' : x < 0 ? '▼' : '■'
}

export function dirWord(x: number): string {
  return x > 0 ? '涨' : x < 0 ? '跌' : '平'
}

export function mean(a: number[]): number {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0
}

export function std(a: number[]): number {
  if (a.length < 2) return 0
  const m = mean(a)
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1))
}

export function uid(prefix: string, n: number): string {
  return `${prefix}${n.toString().padStart(6, '0')}`
}

export function fillTemplate(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m))
}

export function downloadText(filename: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(a.href)
    a.remove()
  }, 500)
}

export function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const keys = Object.keys(rows[0])
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  return '﻿' + [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n')
}
