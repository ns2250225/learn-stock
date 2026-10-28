// ============================================================================
// 像素证券城 · 共享类型定义
// 金额与价格统一使用整数「分」(Cents)；数量为整数股；时间为模拟分钟时间戳。
// ============================================================================

export type Cents = number

/** 模拟时间戳：自开局日 00:00 起经过的模拟分钟数 */
export type SimTime = number

export type SectorId =
  | 'tech'
  | 'consumer'
  | 'health'
  | 'industrial'
  | 'energy'
  | 'finance'
  | 'materials'
  | 'utilities'
  | 'realestate'
  | 'telecom'

export type CompanyStyle =
  | 'growth'
  | 'value'
  | 'cyclical'
  | 'dividend'
  | 'leveraged'
  | 'speculative'
  | 'stable'
  | 'turnaround'

export type LiquidityTier = 1 | 2 | 3 | 4 | 5

export interface SectorDef {
  id: SectorId
  name: string
  short: string
  color: string
  basePE: number
  cyclical: number // 0..1 周期属性
  defensive: number // 0..1 防御属性
  description: string
}

// ---------------------------------------------------------------------------
// 公司内容模板（数据驱动）
// ---------------------------------------------------------------------------
export interface CompanyTemplate {
  symbol: string // 4 位大写字母代码，唯一
  name: string // 中文简称
  sector: SectorId
  styles: CompanyStyle[] // 1~2 个
  listedYear: number // 上市年份（虚构世界 2005~2029）
  description: string // 一两句公司简介
  business: string // 主营业务与收入来源
  ceo: string // 虚构管理层姓名
  district: string // 所在公司园区
  sharesOutstanding: number // 总股本（百万股）
  floatRatio: number // 自由流通比例 0.3..1
  basePrice: number // 开局参考股价（元）
  revenue: number // 年营收（百万元）
  revenueGrowth: number // 营收增速 0.12 = 12%
  grossMargin: number // 毛利率
  netMargin: number // 净利率（可为负）
  debtRatio: number // 资产负债率 0..1
  pb: number // 开局市净率
  ocfToNetIncome: number // 经营现金流 / 净利润
  payoutRatio: number // 分红率 0..1
  beta: number // 市场敏感度 0.4..2
  sectorSensitivity: number // 行业敏感度 0.5..1.5
  volatility: number // 年化特质波动率 0.15..0.8
  liquidityTier: LiquidityTier // 1 最好 5 最差
  rateSensitivity: number // -1..1 负值=加息受损
  commoditySensitivity: number // -1..1 正值=大宗商品上涨受益
  consumerSensitivity: number // -1..1 正值=消费景气受益
  eventSensitivity: number // 0.5..2
  mgmtCredibility: number // 0..1 管理层信誉
  reportReliability: number // 0..1 财报可靠性
  transparency: number // 0..1 信息透明度
  customerConcentration: number // 0..1 大客户集中度
  products: string[] // 2~4 个虚构产品/项目名，供事件文本使用
  logoColors: [string, string]
}

// ---------------------------------------------------------------------------
// 市场规则包
// ---------------------------------------------------------------------------
export type RulesId = 'teaching' | 'ashare' | 'us'
export type OrderType = 'market' | 'limit' | 'stop' | 'stopLimit'
export type TimeInForce = 'DAY' | 'GTC' | 'IOC'
export type OrderSide = 'buy' | 'sell' | 'short' | 'cover'
export type MarketPhase =
  | 'closed' // 休市（夜间/周末/节假日）
  | 'preopen' // 盘前准备
  | 'opening' // 开盘阶段（集合竞价）
  | 'continuous' // 连续交易
  | 'break' // 午间休市
  | 'closing' // 收盘阶段
  | 'postclose' // 盘后结算

export interface SessionConfig {
  preopen: [number, number] // 分钟（自 00:00）
  opening: [number, number]
  continuous: [number, number][]
  closing: [number, number]
  postclose: [number, number]
  openingAuction: boolean // 开盘阶段是否为集合竞价（统一开盘价撮合）
  closingAuction: boolean // 收盘阶段是否为集合竞价
}

export interface FeeConfig {
  version: string
  commissionRate: number // 佣金费率（成交额比例）
  minCommission: Cents // 每笔订单最低佣金
  exchangeFeeRate: number // 交易所/经手费（双向）
  regulatoryFeeRate: number // 监管费（仅卖出）
  stampTaxSellRate: number // 卖出印花税
  transferFeeRate: number // 过户费（双向）
  mode: 'perOrder' // 部分成交按订单累计计费：每笔成交收取「累计应收 - 已收」
}

export interface MarketRules {
  id: RulesId
  name: string
  version: string
  effectiveDate: string
  source: string
  notes: string[] // 简化说明
  timezone: string
  currency: string
  currencySymbol: string
  sessions: SessionConfig
  holidays: string[] // MM-DD 固定节假日
  tickSize: Cents
  lotSize: number // 买入最小单位
  oddLotSellAllowed: boolean // 是否允许零股卖出
  orderTypes: OrderType[]
  tifs: TimeInForce[]
  phaseOrderTypes: Partial<Record<MarketPhase, OrderType[]>> // 各阶段允许提交的订单类型
  marketRemainder: 'continue' | 'cancel' // 市价单剩余部分处理
  maxGtcDays: number
  fees: FeeConfig
  priceLimit: { enabled: boolean; pct: number; riskWarningPct: number }
  settlement: { sharesSellableAfterDays: number; saleCashAvailableAfterDays: number; label: string }
  shortSelling: { enabled: boolean; baseBorrowRate: number }
  margin: {
    enabled: boolean
    initialMargin: number
    maintenanceMargin: number
    liquidationMargin: number
    interestRate: number
    callGraceDays: number
  }
  dividendTaxRate: number
  colorConvention: 'redUp' | 'greenUp'
  stopTrigger: 'last'
  riskLimit: { maxOrderPctOfEquity: number } // 单笔订单不超过净值比例（风险限额）
}

// ---------------------------------------------------------------------------
// 宏观与市场状态
// ---------------------------------------------------------------------------
export type MacroVar =
  | 'rate'
  | 'inflation'
  | 'growth'
  | 'unemployment'
  | 'riskAppetite'
  | 'commodity'
  | 'consumerConfidence'
  | 'yield10y'

export interface MacroState {
  rate: number // 政策利率 %
  inflation: number // CPI 同比 %
  growth: number // GDP 同比 %
  unemployment: number // 失业率 %
  riskAppetite: number // -1..1
  commodity: number // 大宗商品指数，基准 100
  consumerConfidence: number // 消费者信心，基准 100
  yield10y: number // 10 年期国债收益率 %
}

export type Regime = 'bull' | 'bear' | 'sideways' | 'volatile' | 'bubble' | 'crisis'

// ---------------------------------------------------------------------------
// 事件与新闻
// ---------------------------------------------------------------------------
export type EventCategory =
  | 'macro'
  | 'sector'
  | 'company'
  | 'regulatory'
  | 'geopolitical'
  | 'disaster'
  | 'sentiment'
  | 'liquidity'

export type SourceType = 'official' | 'announcement' | 'media' | 'rumor' | 'opinion'

export interface CompanyFilter {
  styles?: CompanyStyle[] // 命中任一风格
  minDebtRatio?: number
  maxDebtRatio?: number
  minVolatility?: number
  minLiquidityTier?: number // tier >= 该值（流动性更差）
  maxLiquidityTier?: number
  minCustomerConcentration?: number
  maxReportReliability?: number
  maxMgmtCredibility?: number
  minPayoutRatio?: number
  negativeMarginOnly?: boolean
}

export interface FollowUpDef {
  templateId: string
  delayDays: [number, number] // 交易日
  probability: number // 0..1
  sameTarget: boolean // 是否沿用同一公司/行业
}

export interface EventTemplate {
  id: string
  category: EventCategory
  scope: 'market' | 'sector' | 'company'
  sectors?: SectorId[] // 可触发的行业；空=全部
  filter?: CompanyFilter
  sourceType: SourceType
  /**
   * 文本占位符：{company} 公司名 {symbol} 代码 {sector} 行业名 {peer} 同行公司名
   * {product} 公司产品名 {n1} {n2} 数值（见 nums）
   */
  title: string
  summary: string // 快讯：一句话
  detail: string // 详情：背景、市场预期、关键数据
  analysis: string[] // 分析：多种合理解释 + 需要核实的信息（至少 2 条）
  nums?: [number, number][] // {n1} {n2}... 的取值区间（保留 1 位小数）
  credibility: [number, number] // 0..1
  surprise: [number, number] // 相对预期的标准化差值，可正可负
  immediateImpact: [number, number] // 对直接目标的即时收益率冲击，例 [-0.06,-0.02]
  fundamentalImpact: [number, number] // 对公允价值（基本面）的长期影响比例
  sectorSpill?: number // 对同行业其他公司的传导系数（可负：竞争受益）
  marketSpill?: number // 对全市场的传导系数
  sectorEffects?: Partial<Record<SectorId, number>> // 宏观/行业类事件对各行业的差异化系数（乘以 immediateImpact 的符号与强度）
  macroEffects?: Partial<Record<MacroVar, number>> // 对宏观变量的增量
  durationSteps: [number, number] // 影响持续步数（1 步 = 1 模拟分钟，一个交易日约 240 步）
  volatilityMultiplier?: number
  volumeMultiplier?: number
  spreadMultiplier?: number // 流动性冲击：价差放大倍数
  sentimentShock?: number // -1..1 对情绪的冲击
  affectsMetrics: string[] // 可能影响的财务指标，如 ['营收','毛利率']
  educationalTags: string[] // 词典条目 id
  weight: number // 抽取基础权重（0.2..3）
  cooldownDays: number // 同一目标的冷却交易日
  highImpact?: boolean // 高影响事件（受风险预算约束）
  followUps?: FollowUpDef[]
  scriptOnly?: boolean // 仅由日历/剧本/连锁触发，不进入随机池
  suspendDays?: [number, number] // 触发停牌（交易日）
  riskWarning?: boolean // 触发风险警示
  delistChain?: boolean // 推进退市流程
  regimeBias?: Partial<Record<Regime, number>> // 不同市场状态下的权重乘数
}

export interface MarketEvent {
  id: string
  templateId: string
  category: EventCategory
  title: string
  summary: string
  detail: string
  analysis: string[]
  sourceType: SourceType
  publishAt: SimTime
  knownAt?: SimTime
  affectedSymbols: string[]
  affectedSectors: SectorId[]
  marketWide: boolean
  credibility: number
  surprise: number
  immediateImpact: number
  fundamentalImpact: number
  durationSteps: number
  volatilityMultiplier?: number
  volumeMultiplier?: number
  followUpEventIds: string[]
  parentEventId?: string
  educationalTags: string[]
  affectsMetrics: string[]
  highImpact: boolean
  /** 发布时各相关股票价格（用于事后复盘） */
  priceAtPublish: Record<string, Cents>
  indexAtPublish: number
  tradingDay: number
}

// ---------------------------------------------------------------------------
// 学习、任务、挑战、成就（内容）
// ---------------------------------------------------------------------------
export type LessonModuleId =
  | 'stock_basics'
  | 'trading_basics'
  | 'money_mgmt'
  | 'risk_mgmt'
  | 'financials'
  | 'valuation'
  | 'macro'
  | 'behavioral'
  | 'portfolio'
  | 'advanced_margin'

export interface QuizQuestion {
  id: string
  question: string
  options: string[]
  answer: number // 正确选项下标
  explanation: string
}

export interface LessonDef {
  id: string
  module: LessonModuleId
  title: string
  simple: string // 简明解释（段落用 \n\n 分隔）
  advanced: string // 进阶细节
  keyPoints: string[]
  quiz: QuizQuestion[]
  glossary: string[] // 相关词典 id
  practice: string // 对应的游戏操作建议（“你可以考虑……”语气）
}

export interface LessonModuleDef {
  id: LessonModuleId
  title: string
  goal: string
  gameAction: string
  icon: string // 单个 emoji 或字符
}

export interface GlossaryEntry {
  id: string
  term: string
  en: string
  short: string
  detail: string
  example?: string
}

export interface CaseStudy {
  id: string
  title: string
  story: string
  question: string
  discussion: string
  tags: string[]
}

export interface PlayerStats {
  ordersSubmitted: number
  marketOrders: number
  limitOrders: number
  stopOrders: number
  stopLimitOrders: number
  ordersAccepted: number
  ordersRejected: number
  ordersCancelled: number
  ordersExpired: number
  partialFills: number // 经历过部分成交的订单数
  ordersFilled: number // 全部成交订单数
  limitFilled: number // 全部成交的限价单
  marketFilled: number
  stopTriggered: number
  stopLimitTriggered: number
  stopGapFills: number // 止损触发后成交价劣于触发价 ≥1% 的次数
  fills: number
  buys: number // 买入/平空成交笔数
  sells: number // 卖出/卖空成交笔数
  feesPaid: Cents
  smallTrades: number // 成交额 < 5000 元的订单数
  plansCreated: number
  plansWithExit: number
  tradesWithPlan: number
  reviewsCompleted: number
  reviewStreak: number
  bestReviewStreak: number
  dailySummaries: number
  biasTags: number
  newsOpened: number
  newsAnalysisViewed: number
  newsRetroViewed: number
  earningsNewsOpened: number
  mixedEarningsOpened: number // 打开「数据混合」类财报新闻
  watchlistAdds: number
  eventsWatched: number
  stockDetailViews: number
  financialsViewed: number
  valuationViewed: number
  peersCompared: number
  cashflowCompared: number
  riskPanelViewed: number
  sectorPanelViewed: number
  calendarViewed: number
  attributionViewed: number
  lessonsCompleted: number
  quizCorrect: number
  quizWrong: number
  wrongReviewed: number
  dividendsReceived: number
  exDividendHeld: number
  splitsHeld: number
  rightsSubscribed: number
  daysPlayed: number
  daysHeldMax: number
  maxSectorsHeld: number
  maxPositionsHeld: number
  shortsOpened: number
  marginCalls: number
  forcedLiquidations: number
  leverageUsedMax: number
  exports: number
  manualSaves: number
  alertsSet: number
  tranchePlans: number
  heldThroughEarnings: number
  suspensionsHeld: number
  cashRatioUnderStress: number // 指数单日跌幅 >2.5% 时收盘现金占比 ≥30% 的次数
  crisisDaysSurvived: number
  notesWritten: number
}

export interface AccountSnapshotForCheck {
  equity: number // 元
  cash: number // 元
  available: number // 元
  frozen: number // 元
  positions: number // 持仓只数
  sectorsHeld: number
  maxWeight: number // 0..1 最大单股占净值比例
  cashRatio: number // 0..1
  drawdown: number // 当前回撤 0..1
  maxDrawdown: number // 0..1
  returnPct: number // 总收益率（资金流入调整后）
  realizedPnl: number // 元
  feesTotal: number // 元
}

export interface MissionCtx {
  stats: PlayerStats
  flags: Record<string, boolean>
  account: AccountSnapshotForCheck
  level: number
  tradingDaysElapsed: number
  lessonsDone: string[]
  missionsDone: string[]
  achievements: string[]
  challengesWon: string[]
  advancedMode: boolean
}

export interface MissionObjective {
  text: string
  check: (c: MissionCtx) => boolean
}

export interface MissionDef {
  id: string
  order: number
  module: LessonModuleId
  title: string
  npc: string // NpcDef.id
  brief: string // 任务说明，使用「你可以考虑……」的语气
  objectives: MissionObjective[]
  quiz?: QuizQuestion[] // 完成目标后需作答（答错计入错题本，可重试）
  hint: string
  rewardXp: number
  prerequisites?: string[]
  learnMore: string[] // 词典 id
}

export interface AchievementDef {
  id: string
  title: string
  description: string
  icon: string // 单个 emoji
  check: (c: MissionCtx) => boolean
  hidden?: boolean
}

export interface NpcDef {
  id: string
  name: string
  role: string
  location: LocationId
  palette: { skin: string; hair: string; shirt: string; pants: string }
  lines: string[] // 闲聊台词（不得给出买卖建议）
}

export type LocationId =
  | 'exchange' // 交易所大楼 → 市场大厅
  | 'broker' // 券商营业厅 → 交易终端
  | 'bank' // 账户中心 → 我的账户
  | 'newsroom' // 财经新闻社 → 新闻社
  | 'library' // 研究图书馆 → 研究室
  | 'academy' // 投资学院 → 学习中心
  | 'cafe' // 投资者咖啡馆 → 闲聊/情绪
  | 'apartment' // 交易者公寓 → 投资者公寓
  | 'campus' // 上市公司园区 → 公司档案

export type ChallengeGoal =
  | { type: 'returnAtLeast'; value: number } // 总收益率 ≥ value（0.05=5%）
  | { type: 'maxDrawdownBelow'; value: number } // 期间最大回撤 < value
  | { type: 'minSectorsHeld'; value: number } // 结束时持有行业数 ≥ value
  | { type: 'maxSingleWeightBelow'; value: number } // 结束时最大单股占比 < value
  | { type: 'feesBelow'; value: number } // 期间费用 < value 元
  | { type: 'cashRatioAtLeast'; value: number } // 结束时现金占比 ≥ value
  | { type: 'minCashRatioThroughout'; value: number } // 每个收盘现金占比都 ≥ value
  | { type: 'beatBenchmark'; value: number } // 超额收益（相对综指）≥ value
  | { type: 'tradesAtMost'; value: number } // 成交订单数 ≤ value
  | { type: 'tradesAtLeast'; value: number }
  | { type: 'reviewsAtLeast'; value: number }
  | { type: 'plansAtLeast'; value: number }
  | { type: 'holdDaysAtLeast'; value: number } // 至少一只持仓连续持有天数 ≥ value
  | { type: 'quiz'; questions: QuizQuestion[] } // 结束时作答

export interface ScriptedEvent {
  day: number // 挑战第几个交易日（从 1 开始）
  minute?: number // 当日连续交易第几分钟（0..239），省略=盘前
  templateId: string // EventTemplate.id 或保留 ID（见下）
  target?: 'holding' | 'any' | `sector:${SectorId}` | `symbol:${string}`
}
/**
 * 保留剧本 ID：
 *  EARNINGS_SEASON  所有公司在接下来 5 个交易日内发布财报
 *  EARNINGS_BEAT / EARNINGS_MISS / EARNINGS_MIXED  让 target 公司立即发布对应结果的财报
 *  GAP_DOWN  target 公司次日开盘大幅跳空（配合止损教学）
 *  DIVIDEND  target 公司宣布分红（短除权周期）
 *  SPLIT     target 公司宣布拆股
 *  RIGHTS    target 公司宣布配股
 *  SUSPEND   target 公司停牌 2 日
 */

export interface ChallengeDef {
  id: string
  title: string
  subtitle: string
  story: string
  difficulty: 1 | 2 | 3 | 4 | 5
  days: number // 交易日数
  startCash: number // 元
  startHoldings?: { sector?: SectorId; style?: CompanyStyle; count: number; weight: number }[]
  regime: Regime
  macro?: Partial<MacroState>
  eventFrequency: number // 随机事件频率倍数
  volatilityMult: number
  scripted: ScriptedEvent[]
  goals: { goal: ChallengeGoal; label: string; required: boolean }[]
  allowMargin?: boolean
  rulesId?: RulesId
  tags: string[]
  debrief: string // 结束后讲解
}

// ---------------------------------------------------------------------------
// 交易实体
// ---------------------------------------------------------------------------
export type OrderStatus =
  | 'new' // 新建
  | 'pendingSubmit' // 待提交
  | 'accepted' // 已接受
  | 'waitingTrigger' // 等待触发
  | 'partiallyFilled' // 部分成交
  | 'filled' // 全部成交
  | 'cancelPending' // 撤单中
  | 'cancelled' // 已撤销
  | 'rejected' // 已拒绝
  | 'expired' // 已过期

export interface OrderHistoryEntry {
  ts: SimTime
  from: OrderStatus | null
  to: OrderStatus
  reason: string
  filledQty: number
  remainingQty: number
  fees: Cents
}

export interface Order {
  id: string
  clientKey: string // 幂等键
  symbol: string
  side: OrderSide
  type: OrderType
  tif: TimeInForce
  qty: number
  limitPrice?: Cents
  stopPrice?: Cents
  status: OrderStatus
  filledQty: number
  avgFillPrice: number // 分（可含小数，仅展示）
  fees: Cents
  frozenCash: Cents // 当前冻结资金（买单）
  frozenPerShare: number
  triggered: boolean
  createdAt: SimTime
  createdDay: number
  expireDay: number // 当日有效单在该交易日收盘后失效；GTC 为最长有效交易日
  frozenInitial: Cents
  triggerPrice?: Cents
  updatedAt: SimTime
  history: OrderHistoryEntry[]
  rejectReason?: string
  planId?: string
  snapshot: {
    last: Cents
    bid: Cents
    ask: Cents
    index: number
    news: string[]
    equity: Cents
    positionQty: number
  }
  arrivalMid: number
  forced?: boolean // 强制平仓单
  source: 'player' | 'system'
}

export interface Execution {
  id: string
  orderId: string
  ts: SimTime
  tradingDay: number
  symbol: string
  side: OrderSide
  qty: number
  price: Cents
  value: Cents
  commission: Cents
  exchangeFee: Cents
  regulatoryFee: Cents
  stampTax: Cents
  transferFee: Cents
  totalFee: Cents
  liquidity: 'taker' | 'maker' | 'auction'
  slippage: number // 相对下单时中间价的不利滑点（分/股，正=不利）
  realizedPnl?: Cents
  feeVersion: string
}

export type LedgerType =
  | 'deposit'
  | 'buy'
  | 'sell'
  | 'fee'
  | 'tax'
  | 'dividend'
  | 'dividendTax'
  | 'dividendPayShort'
  | 'cashInLieu'
  | 'rightsSubscribe'
  | 'rightsRefund'
  | 'delistSettlement'
  | 'marginInterest'
  | 'borrowFee'
  | 'shortSell'
  | 'cover'
  | 'freeze'
  | 'unfreeze'
  | 'settle'
  | 'adjustment'

export interface CashLedgerEntry {
  id: string
  ts: SimTime
  tradingDay: number
  type: LedgerType
  amount: Cents // 现金余额变化（freeze/unfreeze 为冻结金额变化，不改变余额）
  balanceAfter: Cents
  frozenAfter: Cents
  symbol?: string
  orderId?: string
  execId?: string
  note: string
}

export interface Lot {
  qty: number
  sellableDay: number // 交易日序号，>= 时可卖
}

export interface Position {
  symbol: string
  qty: number // 正=多头，负=空头
  costBasis: Cents // 多头：总成本（含费用）；空头：开仓净收入
  frozenQty: number // 被卖出/平空挂单占用
  lots: Lot[] // 多头可卖批次
  realizedPnl: Cents
  openedDay: number
  dividendsReceived: Cents
  feesPaid: Cents
}

export interface TradePlan {
  id: string
  symbol: string
  createdAt: SimTime
  reason: string // 为什么关注
  hypothesis: string // 交易假设
  horizon: 'short' | 'medium' | 'long'
  invalidation: string // 什么情况说明判断错了
  targetPct: number // 计划投入净值比例 0..1
  stopPrice?: Cents
  targetPrice?: Cents
  estFee: Cents
  estMaxLoss: Cents
  tranches?: { price: Cents; qty: number; orderId?: string }[]
  status: 'active' | 'closed'
  linkedOrderIds: string[]
}

export interface TradeReview {
  id: string
  orderId: string
  symbol: string
  side: OrderSide
  createdAt: SimTime
  completed: boolean
  qty: number
  avgPrice: number
  fees: Cents
  slippageTotal: Cents
  realizedPnl: Cents
  equityImpactPct: number
  planId?: string
  planSummary?: string
  snapshot: Order['snapshot']
  biasHints: string[] // 系统依据交易记录给出的可能偏差
  followedPlan?: 'yes' | 'partial' | 'no' | 'noplan'
  selfBiasTags: string[]
  note: string
  processScore?: number
  scoreBreakdown?: { label: string; points: number; max: number }[]
  learnTag: string
  question: string
}

export interface DailySummary {
  tradingDay: number
  date: string
  indexChanges: { id: string; name: string; close: number; changePct: number }[]
  sectorRanks: { sector: SectorId; changePct: number }[]
  topNews: string[]
  positionChanges: { symbol: string; before: number; after: number }[]
  fees: Cents
  dayPnl: Cents
  equity: Cents
  equityChangePct: number
  riskBefore: { maxWeight: number; drawdown: number; leverage: number }
  riskAfter: { maxWeight: number; drawdown: number; leverage: number }
  upcoming: string[]
  note: string
  biasTag?: string
  breadth: { up: number; down: number; flat: number }
}

export interface PriceAlert {
  id: string
  symbol: string
  price: Cents
  direction: 'above' | 'below'
  createdAt: SimTime
  triggeredAt?: SimTime
}

export interface Notice {
  id: string
  ts: SimTime
  level: 'info' | 'success' | 'warn' | 'danger'
  title: string
  body: string
  symbol?: string
  read: boolean
}
