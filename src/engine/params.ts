import type { LiquidityTier, Regime } from './types'
import type { Difficulty } from './state'

export const QUARTER_DAYS = 63
export const HISTORY_DAYS = 250

export const REGIME_PARAMS: Record<Regime, { mu: number; sigma: number; spread: number; events: number; sentiment: number }> = {
  bull: { mu: 0.2, sigma: 0.13, spread: 1, events: 1, sentiment: 0.15 },
  bear: { mu: -0.22, sigma: 0.2, spread: 1.2, events: 1.15, sentiment: -0.15 },
  sideways: { mu: 0.02, sigma: 0.11, spread: 1, events: 0.9, sentiment: 0 },
  volatile: { mu: 0, sigma: 0.26, spread: 1.4, events: 1.3, sentiment: -0.05 },
  bubble: { mu: 0.45, sigma: 0.2, spread: 0.9, events: 1.2, sentiment: 0.4 },
  crisis: { mu: -0.7, sigma: 0.45, spread: 2.2, events: 1.6, sentiment: -0.5 },
}

export const REGIME_TRANSITIONS: Record<Regime, Partial<Record<Regime, number>>> = {
  bull: { sideways: 0.008, volatile: 0.004, bubble: 0.002, bear: 0.001 },
  bear: { sideways: 0.01, volatile: 0.006, crisis: 0.002, bull: 0.002 },
  sideways: { bull: 0.006, bear: 0.005, volatile: 0.004 },
  volatile: { sideways: 0.012, bear: 0.008, bull: 0.006, crisis: 0.003 },
  bubble: { volatile: 0.03, crisis: 0.015, sideways: 0.01 },
  crisis: { bear: 0.04, volatile: 0.03, sideways: 0.01 },
}

/** 日换手率（占流通股） */
export const TIER_TURNOVER: Record<LiquidityTier, number> = { 1: 0.009, 2: 0.008, 3: 0.007, 4: 0.006, 5: 0.004 }
/** 基础价差（基点） */
export const TIER_SPREAD_BPS: Record<LiquidityTier, number> = { 1: 2, 2: 5, 3: 10, 4: 22, 5: 45 }
/** 盘口每档深度相对每分钟成交量的倍数 */
export const TIER_DEPTH: Record<LiquidityTier, number> = { 1: 4, 2: 3, 3: 2, 4: 1.3, 5: 0.8 }
export const TIER_LABEL: Record<LiquidityTier, string> = { 1: '极佳', 2: '良好', 3: '一般', 4: '偏弱', 5: '很差' }

export const DIFFICULTY_PARAMS: Record<Difficulty, { eventsPerDay: number; vol: number; crisis: number; label: string; desc: string }> = {
  easy: { eventsPerDay: 2.5, vol: 0.85, crisis: 0.5, label: '轻松', desc: '事件较少、波动较低，适合熟悉流程' },
  normal: { eventsPerDay: 4, vol: 1, crisis: 1, label: '标准', desc: '事件频率与波动适中' },
  hard: { eventsPerDay: 6, vol: 1.2, crisis: 1.6, label: '困难', desc: '事件更密集、波动更大、危机更频繁，部分预期数据更模糊' },
}

// 价格模型参数（每交易日）
export const K_DEV = Math.log(2) / 20 // 个股偏离半衰期 20 日
export const K_L = 0.006 // 市场水平回归宏观隐含水平
export const K_S = 0.02 // 行业因子回归
export const SECTOR_SIGMA = 0.1
export const SENT_COEF = 0.015
export const MARKET_SENT_COEF = 0.004
export const PROTECT_BAND = 0.05 // 市价单保护价

export const LEVEL_XP = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000]
export const LEVEL_TITLES = [
  '实习投资者',
  '见习交易员',
  '初级研究员',
  '投资助理',
  '投资经理',
  '资深研究员',
  '组合经理',
  '风控专家',
  '首席策略师',
  '像素城名宿',
  '传奇投资人',
]

/** 功能解锁等级（自由/挑战模式可在设置中「解锁全部工具」） */
export const UNLOCKS: Record<string, { level: number; label: string }> = {
  stopOrders: { level: 2, label: '止损单 / 止损限价单' },
  eventCalendar: { level: 2, label: '事件日历' },
  alerts: { level: 2, label: '价格提醒（止损提醒）' },
  valuationCompare: { level: 3, label: '估值对比 / 同行比较' },
  sectorPanel: { level: 3, label: '行业面板' },
  benchmark: { level: 3, label: '组合基准比较' },
  riskExposure: { level: 4, label: '风险敞口分析' },
  screener: { level: 4, label: '估值筛选器' },
  tranchePlan: { level: 4, label: '分批建仓计划' },
  advancedMode: { level: 5, label: '进阶模式（保证金与卖空）' },
}
