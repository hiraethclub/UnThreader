import {
  OPERATIONS,
  type JobState,
  type LogEntry,
  type OperationId,
  type Settings,
  type SessionState
} from '@shared/types.js'

const api = window.unthreader
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

let settings: Settings
let jobRunning = false

// ── Settings form ────────────────────────────────────────────────────────────
const settingFields: (keyof Settings)[] = [
  'minDelayMs',
  'maxDelayMs',
  'dailyCap',
  'maxConsecutiveFailures'
]

function fillSettings(s: Settings): void {
  settings = s
  ;($('dryRun') as HTMLInputElement).checked = s.dryRun
  for (const key of settingFields) {
    ;($(key) as HTMLInputElement).value = String(s[key])
  }
  renderOps()
}

async function persist(partial: Partial<Settings>): Promise<void> {
  settings = await api.setSettings(partial)
  renderOps()
}

$('dryRun').addEventListener('change', (e) => {
  void persist({ dryRun: (e.target as HTMLInputElement).checked })
})
for (const key of settingFields) {
  $(key).addEventListener('change', (e) => {
    const val = Number((e.target as HTMLInputElement).value)
    if (!Number.isNaN(val)) void persist({ [key]: val } as Partial<Settings>)
  })
}

// ── Operations ───────────────────────────────────────────────────────────────
function renderOps(): void {
  const host = $('ops')
  host.innerHTML = ''
  for (const op of OPERATIONS) {
    const card = document.createElement('div')
    card.className = 'op'
    const needsConfirm = op.destructive && !settings?.dryRun
    card.innerHTML = `
      <div class="op-head">
        <div>
          <div class="op-title">${op.label}</div>
          <div class="op-sub">${
            settings?.dryRun ? 'Dry run — will only list items' : `Type ${op.confirmWord} to confirm`
          }</div>
        </div>
        <button class="btn ${settings?.dryRun ? 'primary' : 'danger'} small" data-run="${op.id}">Run</button>
      </div>
      <div class="confirm" data-confirm="${op.id}">
        <input type="text" placeholder="Type ${op.confirmWord}" data-confirm-input="${op.id}" />
        <button class="btn danger small" data-confirm-go="${op.id}">Confirm</button>
      </div>`
    host.appendChild(card)

    const runBtn = card.querySelector<HTMLButtonElement>(`[data-run="${op.id}"]`)!
    runBtn.addEventListener('click', () => {
      if (jobRunning) return
      if (!needsConfirm) {
        void start(op.id, op.confirmWord) // dry-run: confirm word ignored by main
      } else {
        card.querySelector(`[data-confirm="${op.id}"]`)!.classList.add('show')
      }
    })
    const goBtn = card.querySelector<HTMLButtonElement>(`[data-confirm-go="${op.id}"]`)
    goBtn?.addEventListener('click', () => {
      const input = card.querySelector<HTMLInputElement>(`[data-confirm-input="${op.id}"]`)!
      void start(op.id, input.value.trim())
    })
  }
  updateOpButtons()
}

async function start(operation: OperationId, confirm: string): Promise<void> {
  try {
    await api.startJob({ operation, confirm })
    document.querySelectorAll('.confirm.show').forEach((el) => el.classList.remove('show'))
  } catch (err) {
    pushLog({
      ts: Date.now(),
      level: 'error',
      operation,
      message: err instanceof Error ? err.message : String(err)
    })
  }
}

function updateOpButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-run]').forEach((b) => (b.disabled = jobRunning))
}

// ── Job state ────────────────────────────────────────────────────────────────
function applyJob(s: JobState): void {
  jobRunning = s.status === 'running' || s.status === 'paused' || s.status === 'stopping'
  $('stat-processed').textContent = String(s.processed)
  $('stat-failed').textContent = String(s.failed)
  const label = s.operation ? OPERATIONS.find((o) => o.id === s.operation)?.label ?? s.operation : '—'
  $('job-summary').textContent = s.status === 'idle' ? 'Idle.' : `${label} · ${s.status} · ${s.message}`
  ;($('btn-pause') as HTMLButtonElement).disabled = s.status !== 'running'
  ;($('btn-resume') as HTMLButtonElement).disabled = s.status !== 'paused'
  ;($('btn-stop') as HTMLButtonElement).disabled = !jobRunning
  updateOpButtons()
}

$('btn-pause').addEventListener('click', () => void api.pauseJob())
$('btn-resume').addEventListener('click', () => void api.resumeJob())
$('btn-stop').addEventListener('click', () => void api.stopJob())

// ── Session ──────────────────────────────────────────────────────────────────
function applySession(s: SessionState): void {
  const dot = $('session-dot')
  const text = $('session-text')
  if (s.loggedIn) {
    dot.className = 'dot on'
    text.textContent = s.username ? `Logged in as @${s.username}` : 'Logged in'
    text.className = ''
  } else {
    dot.className = 'dot off'
    text.textContent = 'Not logged in — sign in on the right'
    text.className = 'muted'
  }
}
$('btn-profile').addEventListener('click', () => void api.navigateProfile())

// ── Log ──────────────────────────────────────────────────────────────────────
const logEl = $('log')
function pushLog(e: LogEntry): void {
  const line = document.createElement('div')
  line.className = `l ${e.level}`
  const t = new Date(e.ts).toLocaleTimeString()
  const tgt = e.target ? ` <span class="tgt">${escapeHtml(e.target)}</span>` : ''
  line.innerHTML = `<time>${t}</time><span>${escapeHtml(e.message)}${tgt}</span>`
  logEl.appendChild(line)
  logEl.scrollTop = logEl.scrollHeight
  while (logEl.childElementCount > 800) logEl.removeChild(logEl.firstChild!)
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}
$('btn-clear-log').addEventListener('click', () => {
  void api.clearLog()
  logEl.innerHTML = ''
})

// ── Boot ─────────────────────────────────────────────────────────────────────
async function boot(): Promise<void> {
  fillSettings(await api.getSettings())
  applyJob(await api.getJobState())
  applySession(await api.getSession())
  ;(await api.getLog(300)).forEach(pushLog)

  api.onJobState(applyJob)
  api.onSession(applySession)
  api.onLog(pushLog)

  // Poll session periodically as a fallback for navigations we don't catch.
  setInterval(async () => applySession(await api.getSession()), 5000)
}
void boot()
