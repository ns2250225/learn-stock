import { defineStore } from 'pinia'
import { computed, markRaw, reactive, ref, shallowRef, triggerRef, watch } from 'vue'
import { Engine, type EngineEvent } from '../engine/engine'
import type { NewGameOptions } from '../engine/world'
import type { MarketEvent } from '../engine/types'
import { idb } from '../persistence/idb'
import { parseImport, validateWorld, type ExportBundle, type SaveSlotMeta, SAVE_SCHEMA_VERSION } from '../engine/save'
import { checkProgress, defaultProfile, levelOf, migrateProfile, validateProfile, type Profile } from '../engine/profile'
import { equity } from '../engine/trading'
import { useSettings } from './settings'
import { downloadText } from '../engine/util'

export type Page = 'hall' | 'trade' | 'stock' | 'account' | 'news' | 'research' | 'learn' | 'home'

export interface Toast {
  id: number
  level: 'info' | 'success' | 'warn' | 'danger'
  title: string
  body: string
  ts: number
}

export const SPEEDS = [0, 1, 2, 5, 20, 60] as const
export type Speed = (typeof SPEEDS)[number]

let toastSeq = 0

export const useGame = defineStore('game', () => {
  const settings = useSettings()
  const engine = shallowRef<Engine | null>(null)
  const rev = ref(0)
  const speed = ref<Speed>(0)
  const busy = ref(false) // 快进中
  const ready = ref(false)
  const profile = reactive<Profile>(defaultProfile())
  const page = ref<Page>('hall')
  const symbol = ref('')
  const pageArg = ref<string>('') // 子标签等
  const toasts = ref<Toast[]>([])
  const keyEvent = ref<MarketEvent | null>(null)
  const summaryDay = ref<number | null>(null)
  const challengeEndOpen = ref(false)
  const showNewGame = ref(false)
  const slots = ref<SaveSlotMeta[]>([])
  const flash = ref<Record<string, number>>({})
  const lastSaved = ref<string>('')
  const saveError = ref('')
  const ticketPreset = ref<{ side: 'buy' | 'sell' | 'short' | 'cover'; qty?: number; price?: number; n: number } | null>(null)
  const searchOpen = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastProgress = 0
  let lastSave = 0
  let offEngine: (() => void) | null = null

  // 引擎对象本身不变，靠 triggerRef 通知依赖方；e 为 engine 的别名
  const e = engine
  const mode = computed(() => engine.value?.w.meta.mode ?? 'free')
  const level = computed(() => levelOf(profile.xp))

  function bump() {
    rev.value++
    triggerRef(engine)
  }

  function toast(level: Toast['level'], title: string, body = '') {
    const t = { id: ++toastSeq, level, title, body, ts: Date.now() }
    toasts.value = [...toasts.value.slice(-4), t]
    setTimeout(() => (toasts.value = toasts.value.filter((x) => x.id !== t.id)), level === 'danger' ? 9000 : 5000)
  }

  function syncEngineSettings() {
    const en = engine.value
    if (!en) return
    en.settings.level = levelOf(profile.xp)
    en.settings.unlockAll = settings.s.unlockAll
    en.settings.maxOrderPct = settings.s.maxOrderPct
    en.settings.tutorialPause = settings.s.tutorialPause
  }
  watch(() => [profile.xp, settings.s.unlockAll, settings.s.maxOrderPct, settings.s.tutorialPause], syncEngineSettings)

  function attach(en: Engine) {
    offEngine?.()
    engine.value = markRaw(en)
    syncEngineSettings()
    offEngine = en.on(onEngineEvent)
    if (!symbol.value || !en.w.stocks[symbol.value]) symbol.value = en.w.watchlist[0] ?? Object.keys(en.w.stocks)[0]
    bump()
  }

  function onEngineEvent(ev: EngineEvent) {
    switch (ev.type) {
      case 'notice':
        toast(ev.level as Toast['level'], ev.title, ev.body)
        break
      case 'fill': {
        if (ev.order.source === 'player' || ev.order.forced) {
          const side = { buy: '买入', sell: '卖出', short: '卖空', cover: '平空' }[ev.order.side]
          toast('success', `${side}成交 · ${ev.exec.symbol}`, `${ev.exec.qty} 股 @ ${(ev.exec.price / 100).toFixed(2)}，订单 ${ev.order.id} ${ev.order.status === 'filled' ? '全部成交' : `部分成交，剩余 ${ev.order.qty - ev.order.filledQty} 股`}`)
        }
        flash.value = { ...flash.value, [ev.exec.symbol]: Date.now() }
        break
      }
      case 'keyEvent':
        if (mode.value === 'tutorial' && settings.s.tutorialPause && !keyEvent.value) {
          pause()
          keyEvent.value = ev.event
        }
        break
      case 'review':
        toast('info', '复盘卡已生成', `订单 ${ev.review.orderId} 已结束，可在「我的账户 · 交易日志」中完成复盘。`)
        break
      case 'dayClose':
        if (settings.s.pauseAtClose) pause()
        summaryDay.value = ev.day
        break
      case 'challengeEnd':
        pause()
        challengeEndOpen.value = true
        break
      case 'marginCall':
        pause()
        break
    }
  }

  // ------------------------------------------------------------------ 时钟
  function msPerStep(): number {
    const en = engine.value
    if (!en) return 2000
    const s = en.rules.sessions
    const active = en.T + (s.preopen[1] - s.preopen[0]) + (s.opening[1] - s.opening[0]) + (s.postclose[1] - s.postclose[0])
    return 600000 / active // 1 倍速下一个交易日约 10 分钟
  }

  function schedule() {
    if (timer) clearTimeout(timer)
    timer = null
    if (!engine.value || speed.value === 0 || busy.value) return
    const per = msPerStep() / speed.value
    const interval = Math.max(40, per)
    const steps = Math.max(1, Math.round(interval / per))
    timer = setTimeout(() => {
      runSteps(steps)
      schedule()
    }, interval)
  }

  function runSteps(n: number) {
    const en = engine.value
    if (!en) return
    en.running = true
    for (let i = 0; i < n; i++) {
      en.step()
      if (speed.value === 0 && !busy.value) break
      if (keyEvent.value || challengeEndOpen.value) break
    }
    afterSteps()
  }

  function afterSteps() {
    const en = engine.value
    if (!en) return
    const now = Date.now()
    if (now - lastProgress > 800) {
      lastProgress = now
      runProgress()
    }
    if (en.importantDirty && now - lastSave > 2500) void autosave()
    bump()
  }

  function runProgress() {
    const en = engine.value
    if (!en) return
    const r = checkProgress(en, profile)
    for (const m of r.missionsCompleted) toast('success', `任务完成：${m.title}`, `+${m.rewardXp} 经验`)
    for (const m of r.missionsReady) toast('info', `任务目标达成：${m.title}`, '前往学习中心完成小测验即可领取奖励。')
    for (const a of r.achievements) toast('success', `${a.icon} 成就解锁：${a.title}`, a.description)
    if (r.leveledUp) toast('success', `等级提升：Lv.${r.leveledUp}`, '新的工具或外观可能已解锁。')
    if (r.missionsCompleted.length || r.achievements.length || r.missionsReady.length) void saveProfile()
  }

  function setSpeed(s: Speed) {
    speed.value = s
    if (engine.value) engine.value.running = s > 0
    schedule()
    bump()
  }
  function pause() {
    setSpeed(0)
  }
  function togglePause() {
    setSpeed(speed.value === 0 ? 1 : 0)
  }
  function stepOnce() {
    pause()
    const en = engine.value
    if (!en) return
    en.running = true
    en.step()
    en.running = false
    afterSteps()
  }

  /** 快进到收盘结算（分批执行，避免阻塞界面） */
  function runToClose() {
    const en = engine.value
    if (!en || busy.value) return
    pause()
    busy.value = true
    en.running = true
    const startDay = en.w.clock.tradingDay
    const afterClose = en.phase === 'postclose' || (en.phase === 'closed' && en.isAfterSessionToday())
    let closed = false
    const off = en.on((ev) => {
      if (ev.type === 'dayClose') closed = true
    })
    const chunk = () => {
      for (let i = 0; i < 30 && !closed; i++) {
        en.step()
        if (keyEvent.value || challengeEndOpen.value) {
          closed = true
          break
        }
        if (en.w.clock.tradingDay > startDay + (afterClose ? 1 : 0) + 1) closed = true
      }
      bump()
      if (closed) {
        off()
        busy.value = false
        en.running = false
        afterSteps()
        return
      }
      setTimeout(chunk, 0)
    }
    chunk()
  }

  // ------------------------------------------------------------------ 存档
  function metaOf(en: Engine, slot: string): SaveSlotMeta {
    return {
      slot,
      name: en.w.meta.name,
      mode: en.w.meta.mode,
      rulesId: en.w.meta.rulesId,
      savedAt: new Date().toISOString(),
      tradingDay: en.w.clock.tradingDay,
      equity: equity(en),
      seed: en.w.meta.worldSeed,
    }
  }

  async function saveProfile() {
    try {
      await idb.set('profile', JSON.parse(JSON.stringify(profile)))
    } catch (err) {
      saveError.value = String(err)
    }
  }

  async function writeSlot(slot: string) {
    const en = engine.value
    if (!en) return
    const w = en.serialize()
    await idb.set('world:' + slot, JSON.parse(JSON.stringify(w)))
    await idb.set('meta:' + slot, metaOf(en, slot))
  }

  async function autosave() {
    const en = engine.value
    if (!en) return
    lastSave = Date.now()
    en.importantDirty = false
    en.dirty = false
    try {
      await writeSlot('auto')
      await saveProfile()
      lastSaved.value = new Date().toLocaleTimeString()
      saveError.value = ''
    } catch (err) {
      saveError.value = '自动保存失败：' + String(err)
    }
  }

  async function saveToSlot(slot: string) {
    const en = engine.value
    if (!en) return
    await writeSlot(slot)
    en.w.stats.manualSaves++
    await refreshSlots()
    toast('success', '已保存', `存档槽「${slot === 'auto' ? '自动' : slot}」`)
  }

  async function loadSlot(slot: string): Promise<boolean> {
    const raw = await idb.get<unknown>('world:' + slot)
    if (!raw) return false
    const v = validateWorld(raw)
    if (!v.ok) {
      toast('danger', '存档无法加载', v.error)
      return false
    }
    pause()
    attach(new Engine(v.world))
    if (slot !== 'auto') await writeSlot('auto')
    summaryDay.value = null
    keyEvent.value = null
    const ch = v.world.challenge
    challengeEndOpen.value = !!(ch && !ch.finished && v.world.summaries.some((s) => s.tradingDay === ch.endDay))
    return true
  }

  async function deleteSlot(slot: string) {
    await idb.del('world:' + slot)
    await idb.del('meta:' + slot)
    await refreshSlots()
  }

  async function refreshSlots() {
    const keys = await idb.keys()
    const metas: SaveSlotMeta[] = []
    for (const k of keys.filter((x) => x.startsWith('meta:'))) {
      const m = await idb.get<SaveSlotMeta>(k)
      if (m) metas.push(m)
    }
    slots.value = metas.sort((a, b) => a.slot.localeCompare(b.slot))
  }

  async function newGame(opts: NewGameOptions) {
    pause()
    const en = Engine.newGame(opts)
    attach(en)
    showNewGame.value = false
    summaryDay.value = null
    keyEvent.value = null
    challengeEndOpen.value = false
    page.value = 'hall'
    await writeSlot('auto')
    await refreshSlots()
    bump()
  }

  function exportSave() {
    const en = engine.value
    if (!en) return
    en.w.stats.exports++
    const bundle: ExportBundle = {
      kind: 'pixel-stock-export',
      version: SAVE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      world: en.serialize(),
      profile: JSON.parse(JSON.stringify(profile)),
      settings: JSON.parse(JSON.stringify(settings.s)),
    }
    downloadText(`pixel-stock-save-${en.w.meta.worldSeed}-D${en.w.clock.tradingDay}.json`, JSON.stringify(bundle), 'application/json')
    bump()
  }

  /** 导入：先完整校验，失败不覆盖当前有效存档 */
  async function importSave(text: string, withProfile: boolean): Promise<{ ok: boolean; message: string }> {
    const r = parseImport(text)
    if (!r.ok) return { ok: false, message: r.error }
    pause()
    try {
      attach(new Engine(r.world))
      if (withProfile && r.profile) Object.assign(profile, migrateProfile(r.profile))
      if (r.settings) settings.replace(r.settings as Partial<typeof settings.s>)
      await writeSlot('auto')
      await saveProfile()
      await refreshSlots()
      return { ok: true, message: '导入成功，已恢复存档' }
    } catch (err) {
      return { ok: false, message: '导入过程出错：' + String(err) }
    }
  }

  async function resetAll() {
    pause()
    offEngine?.()
    engine.value = null
    await idb.clear()
    Object.assign(profile, defaultProfile())
    settings.reset()
    slots.value = []
    showNewGame.value = true
    bump()
  }

  async function init() {
    try {
      const p = await idb.get<Profile>('profile')
      if (p && validateProfile(p)) Object.assign(profile, migrateProfile(p))
      const ok = await loadSlot('auto')
      if (!ok) showNewGame.value = true
      await refreshSlots()
    } catch (err) {
      saveError.value = '本地存储不可用：' + String(err)
      showNewGame.value = true
    }
    ready.value = true
    window.addEventListener('beforeunload', () => {
      if (engine.value?.dirty) void autosave()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && engine.value) void autosave()
    })
  }

  // ------------------------------------------------------------------ 导航
  function go(p: Page, arg = '') {
    page.value = p
    pageArg.value = arg
    window.scrollTo?.({ top: 0 })
  }
  function openStock(sym: string, tab = '') {
    symbol.value = sym
    const en = engine.value
    if (en) en.bump('stockDetailViews')
    go('stock', tab)
  }
  function openTrade(sym: string, side?: 'buy' | 'sell' | 'short' | 'cover') {
    symbol.value = sym
    if (side) ticketPreset.value = { side, n: Date.now() }
    go('trade')
  }

  /** 执行引擎命令后刷新并检查任务 */
  function after() {
    bump()
    runProgress()
    const en = engine.value
    if (en?.importantDirty) void autosave()
  }

  return {
    engine, e, rev, speed, busy, ready, profile, page, symbol, pageArg, toasts, keyEvent, summaryDay, challengeEndOpen,
    showNewGame, slots, flash, lastSaved, saveError, ticketPreset, searchOpen, mode, level,
    bump, toast, setSpeed, pause, togglePause, stepOnce, runToClose, saveToSlot, loadSlot, deleteSlot, refreshSlots,
    newGame, exportSave, importSave, resetAll, init, go, openStock, openTrade, after, autosave, saveProfile, runProgress, msPerStep,
  }
})
