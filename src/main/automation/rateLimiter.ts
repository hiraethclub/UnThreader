import type { Settings } from '@shared/types.js'

/**
 * Paces destructive actions so the app behaves like a (fast but human) person and
 * stays under Threads' tolerance. Combines:
 *  - a randomized delay in [minDelayMs, maxDelayMs] between actions,
 *  - a rolling 24h soft cap on destructive actions,
 *  - exponential backoff when the caller reports a rate wall.
 */
export class RateLimiter {
  private actionTimestamps: number[] = []
  private backoffLevel = 0

  constructor(private settings: Settings) {}

  update(settings: Settings): void {
    this.settings = settings
  }

  /** How many destructive actions happened in the last rolling 24h. */
  private countLast24h(now: number): number {
    const cutoff = now - 24 * 60 * 60 * 1000
    this.actionTimestamps = this.actionTimestamps.filter((t) => t >= cutoff)
    return this.actionTimestamps.length
  }

  /** Returns ms until the daily cap frees up, or 0 if under cap. */
  capBlockMs(now = Date.now()): number {
    const cap = this.settings.dailyCap
    if (!cap || cap <= 0) return 0
    const count = this.countLast24h(now)
    if (count < cap) return 0
    const oldest = this.actionTimestamps[0]
    return Math.max(0, oldest + 24 * 60 * 60 * 1000 - now)
  }

  /** Randomized inter-action delay honoring the current backoff level. */
  nextDelayMs(): number {
    const { minDelayMs, maxDelayMs, backoffBaseMs } = this.settings
    const lo = Math.min(minDelayMs, maxDelayMs)
    const hi = Math.max(minDelayMs, maxDelayMs)
    const base = lo + Math.random() * (hi - lo)
    if (this.backoffLevel === 0) return Math.round(base)
    const backoff = backoffBaseMs * Math.pow(2, this.backoffLevel - 1)
    return Math.round(base + backoff)
  }

  recordAction(now = Date.now()): void {
    this.actionTimestamps.push(now)
  }

  /** Escalate backoff (called when a rate wall is detected). Returns wait ms. */
  escalateBackoff(): number {
    this.backoffLevel = Math.min(this.backoffLevel + 1, 6)
    return this.settings.backoffBaseMs * Math.pow(2, this.backoffLevel - 1)
  }

  /** Reset backoff after a clean run of successful actions. */
  relaxBackoff(): void {
    if (this.backoffLevel > 0) this.backoffLevel = 0
  }

  get backoff(): number {
    return this.backoffLevel
  }
}
