// 可复现随机数：sfc32，按「世界种子 + 流名称」派生独立随机流。
// 玩家下单/撤单不消耗任何行情、事件随机流，保证同一种子可复现。

export type RngState = [number, number, number, number]

export function hashString(str: string): number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^= h >>> 16) >>> 0
}

export class Rng {
  s: RngState
  private spare: number | null = null

  constructor(state: RngState) {
    this.s = [state[0] >>> 0, state[1] >>> 0, state[2] >>> 0, state[3] >>> 0]
  }

  static from(seed: string, stream: string): Rng {
    const base = `${seed}::${stream}`
    const r = new Rng([hashString(base + 'a'), hashString(base + 'b'), hashString(base + 'c'), hashString(base + 'd')])
    for (let i = 0; i < 15; i++) r.next()
    return r
  }

  state(): RngState {
    return [this.s[0], this.s[1], this.s[2], this.s[3]]
  }

  next(): number {
    let [a, b, c, d] = this.s
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    this.s = [a >>> 0, b >>> 0, c >>> 0, d >>> 0]
    return (t >>> 0) / 4294967296
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next()
  }

  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1))
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  normal(): number {
    // Box-Muller（不缓存 spare，保证状态可完全序列化）
    let u = 0
    while (u === 0) u = this.next()
    const v = this.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }

  weighted<T>(items: readonly T[], weight: (t: T) => number): T | undefined {
    let total = 0
    for (const it of items) total += Math.max(0, weight(it))
    if (total <= 0) return undefined
    let r = this.next() * total
    for (const it of items) {
      r -= Math.max(0, weight(it))
      if (r <= 0) return it
    }
    return items[items.length - 1]
  }

  sample<T>(arr: readonly T[], n: number): T[] {
    const copy = arr.slice()
    const out: T[] = []
    while (out.length < n && copy.length) {
      out.push(copy.splice(Math.floor(this.next() * copy.length), 1)[0])
    }
    return out
  }
}
