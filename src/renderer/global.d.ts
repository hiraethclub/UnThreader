import type {
  JobState,
  LogEntry,
  Settings,
  SessionState,
  StartJobRequest
} from '@shared/types.js'

export interface UnthreaderApi {
  baseUrl: string
  getSettings(): Promise<Settings>
  setSettings(partial: Partial<Settings>): Promise<Settings>
  getJobState(): Promise<JobState>
  startJob(req: StartJobRequest): Promise<{ started: boolean }>
  pauseJob(): Promise<JobState>
  resumeJob(): Promise<JobState>
  stopJob(): Promise<JobState>
  getLog(limit?: number): Promise<LogEntry[]>
  clearLog(): Promise<void>
  getSession(): Promise<SessionState>
  navigateProfile(): Promise<void>
  onJobState(cb: (s: JobState) => void): () => void
  onLog(cb: (e: LogEntry) => void): () => void
  onSession(cb: (s: SessionState) => void): () => void
}

declare global {
  interface Window {
    unthreader: UnthreaderApi
  }
}
