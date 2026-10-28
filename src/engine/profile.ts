import type { Engine } from './engine'
import type { AchievementDef, MissionCtx, MissionDef, QuizQuestion } from './types'
import { MISSIONS } from './content/missions'
import { ACHIEVEMENTS } from './content/achievements'
import { LEVEL_TITLES, LEVEL_XP, UNLOCKS } from './params'
import { accountSnapshotForCheck } from './review'

export interface WrongItem {
  qid: string
  source: string // 课程/任务/挑战名称
  question: string
  options: string[]
  answer: number
  explanation: string
  chosen: number
  at: string
  resolved: boolean
}

export interface ChallengeRecord {
  id: string
  won: boolean
  at: string
  seed: string
  metrics: { label: string; value: string }[]
  results: { label: string; pass: boolean; required: boolean; detail: string }[]
}

export interface Profile {
  schema: 'pixel-stock-profile'
  version: 1
  name: string
  xp: number
  achievements: Record<string, string>
  missionsDone: string[]
  missionsReady: string[] // 目标已完成、待答题
  lessonsDone: string[]
  wrongBook: WrongItem[]
  challengeRecords: ChallengeRecord[]
  avatar: { skin: string; hair: string; shirt: string; pants: string; hat: string }
  decor: string[]
  xpLog: { at: string; amount: number; reason: string }[]
}

export function defaultProfile(): Profile {
  return {
    schema: 'pixel-stock-profile',
    version: 1,
    name: '新手投资者',
    xp: 0,
    achievements: {},
    missionsDone: [],
    missionsReady: [],
    lessonsDone: [],
    wrongBook: [],
    challengeRecords: [],
    avatar: { skin: '#f2c9a0', hair: '#3b2a20', shirt: '#4fc3f7', pants: '#2b3a67', hat: 'none' },
    decor: [],
    xpLog: [],
  }
}

export function levelOf(xp: number): number {
  let lv = 1
  for (let i = 0; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) lv = i + 1
  return lv
}

export function levelTitle(lv: number): string {
  return LEVEL_TITLES[Math.min(LEVEL_TITLES.length - 1, lv - 1)]
}

export function levelProgress(xp: number): { lv: number; cur: number; next: number | null; pct: number } {
  const lv = levelOf(xp)
  const cur = LEVEL_XP[lv - 1]
  const next = LEVEL_XP[lv] ?? null
  return { lv, cur, next, pct: next ? (xp - cur) / (next - cur) : 1 }
}

export function addXp(p: Profile, amount: number, reason: string): { leveledUp: boolean; level: number } {
  const before = levelOf(p.xp)
  p.xp += amount
  p.xpLog.push({ at: new Date().toISOString(), amount, reason })
  if (p.xpLog.length > 200) p.xpLog.shift()
  const after = levelOf(p.xp)
  return { leveledUp: after > before, level: after }
}

export function isUnlocked(feature: keyof typeof UNLOCKS | string, level: number, unlockAll: boolean): boolean {
  const u = UNLOCKS[feature]
  if (!u) return true
  return unlockAll || level >= u.level
}

export function buildCtx(e: Engine, p: Profile): MissionCtx {
  return {
    stats: e.w.stats,
    flags: e.w.flags,
    account: accountSnapshotForCheck(e),
    level: levelOf(p.xp),
    tradingDaysElapsed: e.w.clock.tradingDay,
    lessonsDone: p.lessonsDone,
    missionsDone: p.missionsDone,
    achievements: Object.keys(p.achievements),
    challengesWon: p.challengeRecords.filter((r) => r.won).map((r) => r.id),
    advancedMode: e.w.account.marginEnabled,
  }
}

export function missionAvailable(m: MissionDef, p: Profile): boolean {
  return (m.prerequisites ?? []).every((id) => p.missionsDone.includes(id))
}

export interface ProgressResult {
  missionsCompleted: MissionDef[]
  missionsReady: MissionDef[]
  achievements: AchievementDef[]
  leveledUp: number | null
}

/** 检查任务与成就进度（只读 MissionCtx） */
export function checkProgress(e: Engine, p: Profile): ProgressResult {
  const ctx = buildCtx(e, p)
  const res: ProgressResult = { missionsCompleted: [], missionsReady: [], achievements: [], leveledUp: null }
  for (const m of MISSIONS) {
    if (p.missionsDone.includes(m.id) || p.missionsReady.includes(m.id) || !missionAvailable(m, p)) continue
    let ok = false
    try {
      ok = m.objectives.every((o) => o.check(ctx))
    } catch {
      ok = false
    }
    if (!ok) continue
    if (m.quiz?.length) {
      p.missionsReady.push(m.id)
      res.missionsReady.push(m)
    } else {
      p.missionsDone.push(m.id)
      const r = addXp(p, m.rewardXp, `完成任务：${m.title}`)
      if (r.leveledUp) res.leveledUp = r.level
      res.missionsCompleted.push(m)
    }
  }
  const ctx2 = buildCtx(e, p)
  for (const a of ACHIEVEMENTS) {
    if (p.achievements[a.id]) continue
    let ok = false
    try {
      ok = a.check(ctx2)
    } catch {
      ok = false
    }
    if (ok) {
      p.achievements[a.id] = new Date().toISOString()
      const r = addXp(p, 30, `解锁成就：${a.title}`)
      if (r.leveledUp) res.leveledUp = r.level
      res.achievements.push(a)
    }
  }
  return res
}

export function objectiveStatus(e: Engine, p: Profile, m: MissionDef): boolean[] {
  const ctx = buildCtx(e, p)
  return m.objectives.map((o) => {
    try {
      return o.check(ctx)
    } catch {
      return false
    }
  })
}

/** 作答：返回是否全部正确；答错计入错题本 */
export function gradeQuiz(e: Engine | null, p: Profile, source: string, questions: QuizQuestion[], answers: number[]): { allCorrect: boolean; correct: boolean[] } {
  const correct = questions.map((q, i) => answers[i] === q.answer)
  correct.forEach((ok, i) => {
    const q = questions[i]
    if (ok) {
      if (e) e.w.stats.quizCorrect++
      const w = p.wrongBook.find((x) => x.qid === q.id && !x.resolved)
      if (w) w.resolved = true
    } else {
      if (e) e.w.stats.quizWrong++
      if (!p.wrongBook.some((x) => x.qid === q.id && !x.resolved))
        p.wrongBook.push({ qid: q.id, source, question: q.question, options: q.options, answer: q.answer, explanation: q.explanation, chosen: answers[i], at: new Date().toISOString(), resolved: false })
    }
  })
  return { allCorrect: correct.every(Boolean), correct }
}

export function completeMissionQuiz(e: Engine, p: Profile, m: MissionDef, answers: number[]) {
  const g = gradeQuiz(e, p, `任务：${m.title}`, m.quiz ?? [], answers)
  let leveledUp: number | null = null
  if (g.allCorrect) {
    p.missionsReady = p.missionsReady.filter((x) => x !== m.id)
    if (!p.missionsDone.includes(m.id)) {
      p.missionsDone.push(m.id)
      const r = addXp(p, m.rewardXp, `完成任务：${m.title}`)
      if (r.leveledUp) leveledUp = r.level
    }
  }
  return { ...g, leveledUp }
}

export function validateProfile(x: unknown): x is Profile {
  const p = x as Profile
  return !!p && p.schema === 'pixel-stock-profile' && typeof p.xp === 'number' && Array.isArray(p.missionsDone) && Array.isArray(p.lessonsDone)
}

export function migrateProfile(p: Profile): Profile {
  const d = defaultProfile()
  return { ...d, ...p, avatar: { ...d.avatar, ...(p.avatar ?? {}) } }
}

export { MISSIONS, ACHIEVEMENTS }
