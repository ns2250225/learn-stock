import type { WorldState } from './state'
import { RULE_PACKS } from './rules'
import { COMPANIES } from './content/companies'
import { validateProfile, type Profile } from './profile'

export const SAVE_SCHEMA_VERSION = 1
export const MAX_IMPORT_BYTES = 40 * 1024 * 1024

export interface SaveSlotMeta {
  slot: string
  name: string
  mode: string
  rulesId: string
  savedAt: string
  tradingDay: number
  equity: number
  seed: string
}

export interface ExportBundle {
  kind: 'pixel-stock-export'
  version: number
  exportedAt: string
  world: WorldState
  profile?: Profile
  settings?: Record<string, unknown>
}

/** 校验存档结构；不兼容时返回错误说明，绝不部分写入 */
export function validateWorld(x: unknown): { ok: true; world: WorldState } | { ok: false; error: string } {
  const w = x as WorldState
  if (!w || typeof w !== 'object') return { ok: false, error: '文件内容不是有效的存档对象' }
  if (w.schema !== 'pixel-stock-save') return { ok: false, error: '不是像素证券城的存档文件' }
  if (typeof w.schemaVersion !== 'number') return { ok: false, error: '缺少存档版本号' }
  if (w.schemaVersion > SAVE_SCHEMA_VERSION) return { ok: false, error: `存档版本 v${w.schemaVersion} 高于当前游戏支持的 v${SAVE_SCHEMA_VERSION}，请升级游戏后再导入` }
  if (!w.meta || !RULE_PACKS[w.meta.rulesId]) return { ok: false, error: '存档中的规则包无法识别' }
  if (typeof w.meta.worldSeed !== 'string') return { ok: false, error: '缺少世界随机种子' }
  if (!w.clock || typeof w.clock.time !== 'number' || typeof w.clock.tradingDay !== 'number') return { ok: false, error: '模拟时钟数据损坏' }
  if (!w.stocks || typeof w.stocks !== 'object') return { ok: false, error: '缺少行情数据' }
  for (const c of COMPANIES) {
    const st = w.stocks[c.symbol]
    if (!st || !Array.isArray(st.daily) || typeof st.last !== 'number' || !st.f) return { ok: false, error: `股票 ${c.symbol} 数据缺失或损坏` }
  }
  if (!w.indices?.PXC) return { ok: false, error: '缺少指数数据' }
  const a = w.account
  if (!a || typeof a.cash !== 'number' || typeof a.frozen !== 'number' || typeof a.positions !== 'object') return { ok: false, error: '账户数据损坏' }
  for (const k of ['orders', 'executions', 'ledger', 'news', 'events', 'actions', 'plans', 'reviews', 'summaries'] as const) {
    if (!Array.isArray(w[k])) return { ok: false, error: `存档字段 ${k} 损坏` }
  }
  if (!w.rng || typeof w.rng !== 'object') return { ok: false, error: '随机数状态缺失' }
  if (!isFinite(a.cash) || Object.values(a.positions).some((p) => !Number.isInteger(p.qty))) return { ok: false, error: '账户数值异常' }
  return { ok: true, world: migrateWorld(w) }
}

export function migrateWorld(w: WorldState): WorldState {
  // v1 为首个版本；后续版本在此按 schemaVersion 逐级迁移
  if (w.account.peakNav === undefined) (w.account as { peakNav: number }).peakNav = 100
  w.schemaVersion = SAVE_SCHEMA_VERSION
  return w
}

export function parseImport(text: string): { ok: true; world: WorldState; profile?: Profile; settings?: Record<string, unknown> } | { ok: false; error: string } {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: `文件过大（上限 ${MAX_IMPORT_BYTES / 1024 / 1024}MB）` }
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return { ok: false, error: '文件不是有效的 JSON' }
  }
  const b = obj as ExportBundle
  const world = b && b.kind === 'pixel-stock-export' ? b.world : obj
  const v = validateWorld(world)
  if (!v.ok) return v
  const profile = b && b.kind === 'pixel-stock-export' && validateProfile(b.profile) ? b.profile : undefined
  return { ok: true, world: v.world, profile, settings: b?.settings }
}
