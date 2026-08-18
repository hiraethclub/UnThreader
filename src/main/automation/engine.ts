import type { WebContents } from 'electron'
import {
  IDLE_JOB,
  type JobState,
  type LogEntry,
  type LogLevel,
  type OperationId,
  type Settings
} from '@shared/types.js'
import { Ctx, sleep, type StepResult } from './context.js'
import { RateLimiter } from './rateLimiter.js'
import { ACTIONS } from './actions/index.js'

interface EngineDeps {
  getGuest: () => WebContents | null
  getSettings: () => Settings
  emitState: (state: JobState) => void
  emitLog: (entry: LogEntry) => void
  /** Navigate the guest to the logged-in user's own profile and wait for load. */
  ensureProfile: () => Promise<void>
}

/**
 * Owns the lifecycle of a single running job: pause/resume/stop control, pacing
 * via the RateLimiter, rate-wall backoff, failure limits, and progress/log events.
 */
export class AutomationEngine {
  private state: JobState = { ...IDLE_JOB }
  private stopRequested = false
  private pauseRequested = false
  private running = false

  constructor(private deps: EngineDeps) {}

  getState(): JobState {
    return { ...this.state }
  }

  isRunning(): boolean {
    return this.running
  }

  pause(): void {
    if (this.running && this.state.status === 'running') {
      this.pauseRequested = true
      this.setState({ status: 'paused', message: 'Paused' })
    }
  }

  resume(): void {
    if (this.running && this.state.status === 'paused') {
      this.pauseRequested = false
      this.setState({ status: 'running', message: 'Resumed' })
    }
  }

  stop(): void {
    if (this.running) {
      this.stopRequested = true
      this.pauseRequested = false
      this.setState({ status: 'stopping', message: 'Stopping…' })
    }
  }

  async start(operation: OperationId): Promise<void> {
    if (this.running) throw new Error('A job is already running.')
    const guest = this.deps.getGuest()
    if (!guest) throw new Error('Threads is not loaded yet. Log in on the right, then try again.')

    const settings = this.deps.getSettings()
    const module = ACTIONS[operation]
    const rl = new RateLimiter(settings)

    this.running = true
    this.stopRequested = false
    this.pauseRequested = false
    this.state = {
      ...IDLE_JOB,
      operation,
      status: 'running',
      startedAt: Date.now(),
      message: settings.dryRun ? 'Dry run — nothing will be deleted' : 'Running'
    }
    this.emitStateNow()

    const ctx = new Ctx(guest, operation, settings, settings.dryRun, (level, message, target, dryRun) =>
      this.log(level, message, target, dryRun)
    )

    let consecutiveFailures = 0
    let successStreak = 0

    try {
      this.log('info', `Starting: ${operation}${settings.dryRun ? ' (dry run)' : ''}`)
      // Always operate from the user's own profile — never the home feed.
      this.log('info', 'Navigating to your profile…')
      await this.deps.ensureProfile()
      await ctx.ensureRuntime()

      let own = false
      for (let i = 0; i < 10 && !own; i++) {
        own = await ctx.rt<boolean>('isOwnProfile').catch(() => false)
        if (!own) await sleep(500)
      }
      if (!own) {
        this.log(
          'error',
          'Could not confirm your own profile is open. Log in and open your profile, then retry. Aborting for safety.'
        )
        this.setState({ status: 'error', message: 'Not on your profile — aborted' })
        return
      }

      await module.navigate(ctx)

      // Main work loop.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (this.stopRequested) break
        await this.waitWhilePaused()
        if (this.stopRequested) break

        // Daily cap check (real actions only).
        if (!settings.dryRun) {
          const capWait = rl.capBlockMs()
          if (capWait > 0) {
            this.log('warn', `Daily cap of ${settings.dailyCap} reached. Stopping — resume later.`)
            break
          }
        }

        // Detect a rate wall before acting.
        const wall = await ctx.rt<string | null>('detectRateWall')
        if (wall) {
          const backoff = rl.escalateBackoff()
          this.log('warn', `Rate wall detected ("${wall}"). Backing off ${Math.round(backoff / 1000)}s.`)
          await this.interruptibleSleep(backoff)
          continue
        }

        // Pace before the next action.
        await this.interruptibleSleep(rl.nextDelayMs())
        if (this.stopRequested) break
        await this.waitWhilePaused()
        if (this.stopRequested) break

        let result: StepResult
        try {
          result = await module.step(ctx)
        } catch (err) {
          result = { failed: true, message: err instanceof Error ? err.message : String(err) }
        }

        if (result.done) {
          this.log('success', `Finished: no more items for ${operation}.`)
          break
        }

        if (result.failed) {
          consecutiveFailures++
          successStreak = 0
          this.setState({ failed: this.state.failed + 1 })
          if (result.message) this.log('error', result.message, result.target)
          if (consecutiveFailures >= settings.maxConsecutiveFailures) {
            this.log('error', `Aborting after ${consecutiveFailures} consecutive failures.`)
            this.setState({ status: 'error', message: 'Too many consecutive failures' })
            break
          }
          continue
        }

        if (result.acted) {
          consecutiveFailures = 0
          successStreak++
          if (!settings.dryRun && !result.skipped) rl.recordAction()
          if (successStreak >= 5) rl.relaxBackoff()
          this.setState({ processed: this.state.processed + 1 })
        }
        // Neither done/failed/acted → a scroll/continue step; loop again.
      }
    } catch (err) {
      this.log('error', err instanceof Error ? err.message : String(err))
      this.setState({ status: 'error', message: 'Job error' })
    } finally {
      ctx.dispose()
      this.running = false
      if (this.state.status !== 'error') {
        const finalStatus = this.stopRequested ? 'idle' : 'done'
        this.setState({
          status: finalStatus,
          message: this.stopRequested
            ? `Stopped. ${this.state.processed} processed.`
            : `Done. ${this.state.processed} processed, ${this.state.failed} failed.`
        })
      }
      this.emitStateNow()
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async waitWhilePaused(): Promise<void> {
    while (this.pauseRequested && !this.stopRequested) {
      await sleep(150)
    }
  }

  /** Sleep that returns early if a stop is requested. */
  private async interruptibleSleep(ms: number): Promise<void> {
    const step = 150
    let waited = 0
    while (waited < ms) {
      if (this.stopRequested) return
      await this.waitWhilePaused()
      if (this.stopRequested) return
      await sleep(Math.min(step, ms - waited))
      waited += step
    }
  }

  private setState(partial: Partial<JobState>): void {
    this.state = { ...this.state, ...partial }
    this.emitStateNow()
  }

  private emitStateNow(): void {
    this.deps.emitState(this.getState())
  }

  private log(level: LogLevel, message: string, target?: string, dryRun?: boolean): void {
    const entry: LogEntry = {
      ts: Date.now(),
      level,
      operation: this.state.operation,
      message,
      target,
      dryRun
    }
    this.deps.emitLog(entry)
  }
}
