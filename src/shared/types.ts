// Shared types used across the main process, preload bridge and renderer.
// Keep this file free of any Node or DOM specific imports so both sides compile.

export type OperationId = 'deletePosts' | 'deleteReplies'

export const OPERATIONS: { id: OperationId; label: string; destructive: boolean; confirmWord: string }[] = [
  { id: 'deletePosts', label: 'Delete all posts', destructive: true, confirmWord: 'DELETE' },
  { id: 'deleteReplies', label: 'Delete all replies', destructive: true, confirmWord: 'DELETE' }
]

/** User-tunable pacing / safety settings, persisted to disk. */
export interface Settings {
  /** Minimum delay between actions, in milliseconds. */
  minDelayMs: number
  /** Maximum delay between actions, in milliseconds (a random value in [min,max] is used). */
  maxDelayMs: number
  /** Soft cap on destructive actions per rolling 24h window. 0 = no cap. */
  dailyCap: number
  /** When true, nothing is actually deleted — actions are only logged. */
  dryRun: boolean
  /** Backoff base (ms) applied when a rate-limit wall is detected. */
  backoffBaseMs: number
  /** Maximum number of consecutive failures before a job aborts. */
  maxConsecutiveFailures: number
  /** Stop a single run after this many items. 0 = no limit. */
  limitPerRun: number
  /** Keep the Threads login between launches. When false, it's cleared on quit. */
  persistLogin: boolean
  /** Write the activity log to disk. When false, it's kept only in memory. */
  persistLog: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  minDelayMs: 3000,
  maxDelayMs: 6000,
  dailyCap: 0,
  dryRun: true,
  backoffBaseMs: 60_000,
  maxConsecutiveFailures: 8,
  limitPerRun: 0,
  persistLogin: true,
  persistLog: false
}

export type JobStatus = 'idle' | 'running' | 'paused' | 'stopping' | 'done' | 'error'

export interface JobState {
  operation: OperationId | null
  status: JobStatus
  processed: number
  failed: number
  /** null when unknown (Threads does not always expose a total). */
  total: number | null
  startedAt: number | null
  message: string
}

export const IDLE_JOB: JobState = {
  operation: null,
  status: 'idle',
  processed: 0,
  failed: 0,
  total: null,
  startedAt: null,
  message: ''
}

export type LogLevel = 'info' | 'action' | 'skip' | 'warn' | 'error' | 'success'

export interface LogEntry {
  ts: number
  level: LogLevel
  operation: OperationId | null
  message: string
  /** Optional identifier of the affected item (post id, username, etc.). */
  target?: string
  /** True when the action was simulated because dry-run was on. */
  dryRun?: boolean
}

export interface StartJobRequest {
  operation: OperationId
  /** Must equal the operation's confirmWord for destructive ops (unless dry-run). */
  confirm: string
}

export interface SessionState {
  loggedIn: boolean
  username: string | null
  url: string
}

/** Names of the IPC channels. Centralised to avoid typos across the boundary. */
export const IPC = {
  // renderer -> main (invoke)
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  getJobState: 'job:get',
  startJob: 'job:start',
  pauseJob: 'job:pause',
  resumeJob: 'job:resume',
  stopJob: 'job:stop',
  getLog: 'log:get',
  clearLog: 'log:clear',
  getSession: 'session:get',
  navigateProfile: 'session:navigateProfile',
  clearSession: 'session:clear',
  // main -> renderer (send)
  onJobState: 'job:state',
  onLog: 'log:entry',
  onSession: 'session:state'
} as const
