import { ipcMain, type WebContents } from 'electron'
import {
  IPC,
  OPERATIONS,
  type JobState,
  type LogEntry,
  type Settings,
  type StartJobRequest
} from '@shared/types.js'
import { store } from './store.js'
import { threadsSession } from './session.js'
import { AutomationEngine } from './automation/engine.js'

let engine: AutomationEngine | null = null

/** Wire all IPC channels. `panel` is the control-panel renderer (for events). */
export function registerIpc(panel: WebContents): void {
  const send = (channel: string, payload: unknown) => {
    if (!panel.isDestroyed()) panel.send(channel, payload)
  }

  engine = new AutomationEngine({
    getGuest: () => threadsSession.getGuest(),
    getSettings: () => store.getSettings(),
    emitState: (state: JobState) => send(IPC.onJobState, state),
    emitLog: (entry: LogEntry) => {
      store.appendLog(entry)
      send(IPC.onLog, entry)
    },
    ensureProfile: () => threadsSession.navigateProfile()
  })

  threadsSession.attachChangeForwarder((s) => send(IPC.onSession, s))

  ipcMain.handle(IPC.getSettings, () => store.getSettings())
  ipcMain.handle(IPC.setSettings, (_e, partial: Partial<Settings>) => store.saveSettings(partial))

  ipcMain.handle(IPC.getJobState, () => engine!.getState())

  ipcMain.handle(IPC.startJob, async (_e, req: StartJobRequest) => {
    const op = OPERATIONS.find((o) => o.id === req.operation)
    if (!op) throw new Error(`Unknown operation: ${req.operation}`)

    if (engine!.isRunning()) throw new Error('A job is already running.')

    const settings = store.getSettings()
    // Destructive operations require the typed confirmation word unless dry-run.
    if (op.destructive && !settings.dryRun && req.confirm !== op.confirmWord) {
      throw new Error(`Type "${op.confirmWord}" to confirm this action.`)
    }
    // Fire and forget; progress is delivered via events. Surface async failures
    // to the log instead of leaving an unhandled rejection.
    engine!.start(req.operation).catch((err) => {
      send(IPC.onLog, {
        ts: Date.now(),
        level: 'error',
        operation: req.operation,
        message: err instanceof Error ? err.message : String(err)
      })
    })
    return { started: true }
  })

  ipcMain.handle(IPC.pauseJob, () => {
    engine!.pause()
    return engine!.getState()
  })
  ipcMain.handle(IPC.resumeJob, () => {
    engine!.resume()
    return engine!.getState()
  })
  ipcMain.handle(IPC.stopJob, () => {
    engine!.stop()
    return engine!.getState()
  })

  ipcMain.handle(IPC.getLog, (_e, limit?: number) => store.readLog(limit))
  ipcMain.handle(IPC.clearLog, () => store.clearLog())

  ipcMain.handle(IPC.getSession, () => threadsSession.getState())
  ipcMain.handle(IPC.navigateProfile, () => threadsSession.navigateProfile())
}
