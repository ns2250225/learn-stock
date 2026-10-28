import type {
  CashLedgerEntry,
  Cents,
  DailySummary,
  EventCategory,
  Execution,
  MacroState,
  MacroVar,
  MarketEvent,
  Notice,
  Order,
  PlayerStats,
  Position,
  PriceAlert,
  Regime,
  RulesId,
  SectorId,
  SimTime,
  SourceType,
  TradePlan,
  TradeReview,
} from './types'
import type { RngState } from './rng'

export type GameMode = 'tutorial' | 'free' | 'challenge'
export type Difficulty = 'easy' | 'normal' | 'hard'
export type StockStatus = 'normal' | 'suspended' | 'delisting' | 'delisted'

export interface Bar {
  t: number // 日线：交易日序号；分时：SimTime
  o: Cents
  h: Cents
  l: Cents
  c: Cents
  v: number // 股
  a: Cents // 成交额
}

export interface BookLevel {
  price: Cents
  qty: number
}

export interface Book {
  bids: BookLevel[]
  asks: BookLevel[]
  spreadTicks: number
}

export interface Tape {
  t: SimTime
  price: Cents
  qty: number
  side: 'B' | 'S'
  player?: boolean
}

export interface FinancialReport {
  id: string
  symbol: string
  period: string // 2031Q1
  publishDay: number
  publishAt: SimTime
  revenue: number // 百万元
  revenueYoY: number
  grossMargin: number
  netIncome: number // 百万元
  netMargin: number
  eps: number // 元
  operatingCashFlow: number // 百万元
  freeCashFlow: number
  totalAssets: number
  totalLiabilities: number
  equity: number
  debtRatio: number
  roe: number // 年化
  expectedEps: number
  expectedRevenue: number
  guidance: 'raise' | 'maintain' | 'lower'
  outcome: 'beat' | 'meet' | 'miss' | 'mixed'
  outcomeNote: string
  dps?: number
}

export interface Fundamentals {
  revenueAnnual: number // 百万元（当前年化）
  growth: number
  growthLR: number
  grossMargin: number
  netMargin: number
  marginBase: number
  debtRatio: number
  ocfRatio: number
  equity: number // 百万元
  shares: number // 股（实际股数）
  floatShares: number
  earningsPower: number // log 调整（事件对盈利能力的持久影响）
  ep0: number // 开局盈利能力基准
  nextQuarterK: number // 下一份待发布财报对应的季度序号
  epsTTM: number
  dpsTTM: number
  bvps: number
}

export interface Expectation {
  nextPeriod: string
  eps: number
  revenue: number
  revisions: { day: number; eps: number; note: string }[]
}

export interface ImpactQueue {
  eventId: string
  remaining: number // 剩余待释放 log 收益
  rate: number // 每步释放比例
  label: string
}

export interface Modifier {
  eventId: string
  vol: number
  volume: number
  spread: number
  untilStep: number
}

export interface Attribution {
  market: number
  sector: number
  fundamental: number
  sentiment: number
  noise: number
  reversion: number
  events: Record<string, number>
}

export interface MoveRecord {
  day: number
  ret: number
  parts: { label: string; value: number; eventId?: string }[]
}

export interface StockState {
  symbol: string
  status: StockStatus
  riskWarning: boolean
  suspendUntilDay?: number
  delistDay?: number
  lowPriceDays: number
  // 价格（分）
  last: Cents
  prevClose: Cents
  open: Cents
  high: Cents
  low: Cents
  volume: number
  amount: Cents
  limitUp: Cents
  limitDown: Cents
  // 潜在价格分解（log 元）
  lnFund: number
  dev: number
  lnFund0: number
  valMult0: number
  sentiment: number
  volState: number
  overnightGap: number
  stepIndex: number
  impacts: ImpactQueue[]
  modifiers: Modifier[]
  // 行情
  daily: Bar[]
  minute: Bar[]
  book: Book
  tape: Tape[]
  adv: number // 近 20 日平均成交量（股）
  minuteBase: number
  // 基本面
  f: Fundamentals
  reports: FinancialReport[]
  expectation: Expectation
  nextEarningsDay: number
  earningsOffset: number
  borrowAvailable: number
  borrowRate: number
  attrToday: Attribution
  attrHistory: { day: number; a: Attribution; ret: number }[]
  moves: MoveRecord[]
  splitFactor: number // 累计复权因子（拆合股）
  shareHistory: { day: number; shares: number; note: string }[]
}

export interface IndexState {
  id: string
  name: string
  members: string[]
  divisor: number
  value: number
  prevClose: number
  open: number
  high: number
  low: number
  daily: { t: number; o: number; h: number; l: number; c: number; v: number }[]
  minute: { t: number; v: number }[]
}

export type CorpActionType =
  | 'dividend'
  | 'split'
  | 'rights'
  | 'offering'
  | 'buyback'
  | 'suspension'
  | 'riskWarning'
  | 'delisting'

export interface CorporateAction {
  id: string
  symbol: string
  type: CorpActionType
  announceDay: number
  exDay?: number
  payDay?: number
  effectiveDay?: number
  endDay?: number
  dps?: Cents
  ratio?: number
  price?: Cents
  amount?: number // 百万元或股数
  residual?: Cents
  status: 'announced' | 'active' | 'completed' | 'cancelled'
  title: string
  description: string
  entitledQty?: number
  subscribedQty?: number
  shortQtyAtEx?: number
}

export interface NewsArticle {
  id: string
  ts: SimTime
  tradingDay: number
  category: EventCategory | 'earnings' | 'corporate' | 'market' | 'calendar'
  sourceType: SourceType
  sourceName: string
  title: string
  summary: string
  detail: string
  analysis: string[]
  symbols: string[]
  sectors: SectorId[]
  credibility: number
  knownBefore: boolean // 是否为提前公开的日历信息
  metrics: string[]
  tags: string[]
  eventId?: string
  followUpOf?: string
  importance: 1 | 2 | 3
  priceAtPublish: Record<string, Cents>
  indexAtPublish: number
}

export interface MacroRelease {
  id: string
  kind: 'cpi' | 'jobs' | 'gdp' | 'pmi' | 'cb' | 'confidence'
  name: string
  day: number // 交易日
  minute: number // 分钟（自 00:00）
  expected: number
  actual?: number
  unit: string
  released: boolean
  newsId?: string
}

export interface PendingEvent {
  id: string
  templateId: string
  day: number
  minute?: number
  target?: string // symbol 或 sector:xxx
  parentEventId?: string
  forced?: boolean
}

export interface AccountState {
  cash: Cents
  frozen: Cents
  positions: Record<string, Position>
  netDeposits: Cents
  navUnits: number
  realizedTotal: Cents
  feesTotal: Cents
  dividendsTotal: Cents
  interestTotal: Cents
  peakEquity: Cents
  peakNav: number // 单位净值峰值（用于回撤，避免入金影响）
  maxDrawdown: number
  marginEnabled: boolean
  marginCall: { issuedDay: number; deadlineDay: number; deficit: Cents } | null
  equityDaily: { day: number; equity: Cents; cash: Cents; mv: Cents; nav: number; bench: number }[]
  equityIntraday: { t: SimTime; equity: Cents }[]
  dayStartEquity: Cents
  dayStartPositions: Record<string, number>
  dayFees: Cents
  dayStartRisk?: { maxWeight: number; drawdown: number; leverage: number }
  rightsPending: { actionId: string; symbol: string; qty: number; paid: Cents; listDay: number }[]
}

export interface ChallengeRun {
  id: string
  startDay: number
  endDay: number
  startEquity: Cents
  startBench: number
  minCashRatio: number
  finished: boolean
  won?: boolean
  results?: { label: string; pass: boolean; required: boolean; detail: string }[]
  quizAnswers?: number[]
}

export interface DebugLogEntry {
  ts: SimTime
  kind: 'match' | 'factor' | 'event' | 'order' | 'corp'
  text: string
}

export interface WorldMeta {
  id: string
  name: string
  mode: GameMode
  rulesId: RulesId
  rulesVersion: string
  feeVersion: string
  difficulty: Difficulty
  worldSeed: string
  createdAt: string
  savedAt: string
  initialCash: Cents
  challengeId?: string
}

export interface WorldState {
  schema: 'pixel-stock-save'
  schemaVersion: number
  meta: WorldMeta
  clock: { time: SimTime; tradingDay: number; lastTradingDayIndex: number; dayIndexOfTradingDay: Record<number, number> }
  rng: Record<string, RngState>
  macro: MacroState
  macro0: MacroState
  macroHistory: ({ day: number } & MacroState)[]
  releases: MacroRelease[]
  regime: { current: Regime; since: number; L: number; Lstar: number }
  sectorFactors: Record<SectorId, { S: number; sentiment: number }>
  marketSentiment: number
  eventFrequency: number
  volatilityMult: number
  stocks: Record<string, StockState>
  indices: Record<string, IndexState>
  events: MarketEvent[]
  pending: PendingEvent[]
  cooldowns: Record<string, number>
  highImpactBudget: number
  news: NewsArticle[]
  actions: CorporateAction[]
  account: AccountState
  orders: Order[]
  executions: Execution[]
  ledger: CashLedgerEntry[]
  idempotency: Record<string, string>
  seq: Record<string, number>
  plans: TradePlan[]
  reviews: TradeReview[]
  summaries: DailySummary[]
  alerts: PriceAlert[]
  notices: Notice[]
  watchlist: string[]
  watchedEvents: string[]
  reviewLater: string[]
  stats: PlayerStats
  flags: Record<string, boolean>
  challenge?: ChallengeRun
  debug: DebugLogEntry[]
  commandLog: { ts: SimTime; cmd: string; args: unknown }[]
  pendingSummaryDay?: number
}

export const MACRO_LABEL: Record<MacroVar, { name: string; unit: string }> = {
  rate: { name: '政策利率', unit: '%' },
  inflation: { name: 'CPI 同比', unit: '%' },
  growth: { name: 'GDP 同比', unit: '%' },
  unemployment: { name: '失业率', unit: '%' },
  riskAppetite: { name: '风险偏好', unit: '' },
  commodity: { name: '大宗商品指数', unit: '' },
  consumerConfidence: { name: '消费者信心', unit: '' },
  yield10y: { name: '10 年期国债收益率', unit: '%' },
}

export const REGIME_LABEL: Record<Regime, string> = {
  bull: '上升周期',
  bear: '下行周期',
  sideways: '横盘整理',
  volatile: '高波动震荡',
  bubble: '过热/泡沫',
  crisis: '危机/流动性紧张',
}

export const SOURCE_LABEL: Record<SourceType, string> = {
  official: '官方数据',
  announcement: '公司公告',
  media: '媒体报道',
  rumor: '市场传闻',
  opinion: '观点评论',
}

export const CATEGORY_LABEL: Record<string, string> = {
  macro: '宏观',
  sector: '行业',
  company: '公司',
  regulatory: '监管',
  geopolitical: '地缘',
  disaster: '突发灾害',
  sentiment: '市场情绪',
  liquidity: '流动性',
  earnings: '财报',
  corporate: '公司行动',
  market: '市场',
  calendar: '日历',
}
