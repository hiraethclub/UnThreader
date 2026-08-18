import type { WebContents } from 'electron'
import type { LogLevel, OperationId, Settings } from '@shared/types.js'
import { INJECTED_RUNTIME } from './injected.js'
import { CdpMouse } from './cdpInput.js'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
  top: number
}

export interface RtResult {
  ok: boolean
  id?: string
  rect?: Rect
}

/** An rt() result guaranteed to carry a rect (produced by pollRect). */
export interface PolledRect {
  ok: true
  id?: string
  rect: Rect
}

export interface StepResult {
  /** No more items to process — the job for this operation is complete. */
  done?: boolean
  /** A destructive (or, in dry-run, simulated) action was performed. */
  acted?: boolean
  /** The item was intentionally skipped (e.g. dry-run enumeration). */
  skipped?: boolean
  /** The step attempted an action but could not complete it. */
  failed?: boolean
  target?: string
  message?: string
}

export interface ActionModule {
  id: OperationId
  /** Navigate to the correct page/tab and prepare the list. */
  navigate(ctx: Ctx): Promise<void>
  /** Perform (or simulate) one unit of work on the first pending item. */
  step(ctx: Ctx): Promise<StepResult>
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)))

/**
 * Everything an action module needs to drive the Threads guest page: script
 * injection, calls into the in-page runtime, human-like clicks, logging and the
 * dry-run flag. One Ctx is created per job.
 */
export class Ctx {
  readonly mouse: CdpMouse
  /** Scratch space for action modules to keep per-job counters. */
  readonly state: Record<string, number> = {}
  private cdpOk = true

  constructor(
    readonly wc: WebContents,
    readonly operation: OperationId,
    readonly settings: Settings,
    readonly dryRun: boolean,
    private logger: (level: LogLevel, message: string, target?: string, dryRun?: boolean) => void
  ) {
    this.mouse = new CdpMouse(wc)
    try {
      this.mouse.ensureAttached()
    } catch {
      this.cdpOk = false
    }
  }

  log(level: LogLevel, message: string, target?: string): void {
    this.logger(level, message, target, this.dryRun)
  }

  /**
   * Execute a script in the guest, retrying transient failures. When Threads
   * performs an SPA navigation the JS context is briefly torn down and
   * executeJavaScript rejects with "Script failed to execute"; that is not a real
   * error, so we wait and retry a few times before giving up.
   */
  async js<T = unknown>(script: string, retries = 4): Promise<T> {
    let lastErr: unknown
    for (let i = 0; i <= retries; i++) {
      try {
        return (await this.wc.executeJavaScript(script, true)) as T
      } catch (err) {
        lastErr = err
        await sleep(350)
      }
    }
    throw lastErr
  }

  /** Ensure the in-page runtime is present (idempotent). */
  async ensureRuntime(): Promise<void> {
    // INJECTED_RUNTIME is idempotent (early-returns if already loaded), so simply
    // (re)running it is safe and also self-heals after a navigation reset it.
    await this.js(INJECTED_RUNTIME)
  }

  /** Call a window.__unthreader method with a single optional string arg. */
  async rt<T = RtResult>(method: string, arg?: string): Promise<T> {
    await this.ensureRuntime()
    const a = arg === undefined ? '' : JSON.stringify(arg)
    return this.js<T>(`window.__unthreader.${method}(${a})`)
  }

  /** Click the centre of a rect using CDP, falling back to an in-page click. */
  async clickRect(rect: Rect): Promise<void> {
    if (this.cdpOk) {
      try {
        await this.mouse.click(rect.x, rect.y)
        return
      } catch {
        this.cdpOk = false
      }
    }
    // Fallback: dispatch a click at coordinates from within the page.
    await this.js(`(function(){var el=document.elementFromPoint(${Math.round(rect.x)},${Math.round(rect.y)});if(el)el.click();})()`)
  }

  /** Poll an rt() method returning {ok,rect} until it succeeds or times out. */
  async pollRect(method: string, arg: string | undefined, tries: number, delayMs: number): Promise<PolledRect | null> {
    for (let i = 0; i < tries; i++) {
      const r = await this.rt<RtResult>(method, arg)
      if (r && r.ok && r.rect) return { ok: true, id: r.id, rect: r.rect }
      await sleep(delayMs)
    }
    return null
  }

  dispose(): void {
    this.mouse.detach()
  }
}
