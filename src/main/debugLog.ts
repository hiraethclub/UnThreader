import { app } from 'electron'
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Verbose debug log written to a plain text file, separate from the in-app
 * activity log. Always on, so a failing run can be inspected or shared. Truncated
 * once per app launch; each job writes a header.
 */
class DebugLog {
  private path = ''

  init(): void {
    this.path = join(app.getPath('userData'), 'unthreader-debug.log')
    try {
      writeFileSync(
        this.path,
        `UnThreader debug log — ${new Date().toISOString()} — v${app.getVersion()}\n`,
        'utf8'
      )
    } catch {
      /* ignore */
    }
  }

  getPath(): string {
    return this.path
  }

  line(msg: string): void {
    if (!this.path) return
    const ts = new Date().toISOString().slice(11, 23) // HH:MM:SS.mmm
    try {
      appendFileSync(this.path, `${ts}  ${msg}\n`, 'utf8')
    } catch {
      /* never let logging crash a job */
    }
  }

  header(msg: string): void {
    this.line('')
    this.line('──────────────────────────────────────────────')
    this.line(msg)
  }
}

export const debugLog = new DebugLog()
