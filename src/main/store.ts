import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type LogEntry, type Settings } from '@shared/types.js'

/**
 * Dependency-free persistence in Electron's userData dir:
 *  - settings.json       user pacing / safety preferences
 *  - actions.log.jsonl   append-only audit log (one JSON object per line)
 */
class Store {
  private dir = app.getPath('userData')
  private settingsPath = join(this.dir, 'settings.json')
  private logPath = join(this.dir, 'actions.log.jsonl')
  private settings: Settings = { ...DEFAULT_SETTINGS }

  async init(): Promise<void> {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
    try {
      const raw = await fs.readFile(this.settingsPath, 'utf8')
      this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
    } catch {
      await this.saveSettings(this.settings)
    }
    // Privacy: if the on-disk log is not enabled, wipe any remnants at startup so
    // nothing from previous sessions lingers on disk.
    if (!this.settings.persistLog) await this.clearLog()
  }

  getSettings(): Settings {
    return { ...this.settings }
  }

  async saveSettings(partial: Partial<Settings>): Promise<Settings> {
    this.settings = { ...this.settings, ...partial }
    await fs.writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf8')
    // Turning disk logging off should immediately remove what's on disk.
    if (partial.persistLog === false) await this.clearLog()
    return this.getSettings()
  }

  /** Synchronous append keeps ordering guarantees even under rapid logging. */
  appendLog(entry: LogEntry): void {
    if (!this.settings.persistLog) return
    try {
      appendFileSync(this.logPath, JSON.stringify(entry) + '\n', 'utf8')
    } catch {
      /* logging must never crash a job */
    }
  }

  async readLog(limit = 500): Promise<LogEntry[]> {
    if (!this.settings.persistLog) return []
    try {
      const raw = await fs.readFile(this.logPath, 'utf8')
      const lines = raw.split('\n').filter(Boolean)
      return lines
        .slice(-limit)
        .map((l) => {
          try {
            return JSON.parse(l) as LogEntry
          } catch {
            return null
          }
        })
        .filter((x): x is LogEntry => x !== null)
    } catch {
      return []
    }
  }

  async clearLog(): Promise<void> {
    try {
      await fs.writeFile(this.logPath, '', 'utf8')
    } catch {
      /* ignore */
    }
  }
}

export const store = new Store()
