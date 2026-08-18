import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type JobState,
  type LogEntry,
  type Settings,
  type SessionState,
  type StartJobRequest
} from '@shared/types.js'

const sub = <T>(channel: string, cb: (payload: T) => void): (() => void) => {
  const listener = (_e: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  baseUrl: 'https://www.threads.net',

  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (partial: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke(IPC.setSettings, partial),

  getJobState: (): Promise<JobState> => ipcRenderer.invoke(IPC.getJobState),
  startJob: (req: StartJobRequest): Promise<{ started: boolean }> => ipcRenderer.invoke(IPC.startJob, req),
  pauseJob: (): Promise<JobState> => ipcRenderer.invoke(IPC.pauseJob),
  resumeJob: (): Promise<JobState> => ipcRenderer.invoke(IPC.resumeJob),
  stopJob: (): Promise<JobState> => ipcRenderer.invoke(IPC.stopJob),

  getLog: (limit?: number): Promise<LogEntry[]> => ipcRenderer.invoke(IPC.getLog, limit),
  clearLog: (): Promise<void> => ipcRenderer.invoke(IPC.clearLog),

  getSession: (): Promise<SessionState> => ipcRenderer.invoke(IPC.getSession),
  navigateProfile: (): Promise<void> => ipcRenderer.invoke(IPC.navigateProfile),

  onJobState: (cb: (s: JobState) => void) => sub<JobState>(IPC.onJobState, cb),
  onLog: (cb: (e: LogEntry) => void) => sub<LogEntry>(IPC.onLog, cb),
  onSession: (cb: (s: SessionState) => void) => sub<SessionState>(IPC.onSession, cb)
}

export type UnthreaderApi = typeof api

contextBridge.exposeInMainWorld('unthreader', api)
