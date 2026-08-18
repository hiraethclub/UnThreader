import type { WebContents } from 'electron'
import { type SessionState } from '@shared/types.js'
import { INJECTED_RUNTIME } from './automation/injected.js'
import { SELECTORS } from './automation/selectors.js'

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * Tracks the Threads guest WebContents (the `<webview>` in the renderer) and
 * exposes login state + navigation helpers. Re-injects the DOM runtime on every
 * navigation so the automation library is always available.
 */
class ThreadsSession {
  private guest: WebContents | null = null
  private lastUsername: string | null = null
  private onChange: ((s: SessionState) => void) | null = null

  /** Register the callback that forwards session-state changes to the renderer. */
  attachChangeForwarder(onChange: (s: SessionState) => void): void {
    this.onChange = onChange
  }

  /** Attach to the Threads guest WebContents once the `<webview>` is created. */
  attach(wc: WebContents): void {
    this.guest = wc

    const reinject = async () => {
      try {
        await wc.executeJavaScript(INJECTED_RUNTIME, true)
      } catch {
        /* page may be mid-navigation */
      }
      void this.emit()
    }

    wc.on('did-finish-load', reinject)
    wc.on('did-navigate', reinject)
    wc.on('did-navigate-in-page', () => void this.emit())
  }

  getGuest(): WebContents | null {
    return this.guest && !this.guest.isDestroyed() ? this.guest : null
  }

  private async ensureRuntime(wc: WebContents): Promise<void> {
    // INJECTED_RUNTIME is an idempotent IIFE (it early-returns if already present),
    // so we can just run it. It must NOT be wrapped in an expression: it ends in a
    // statement/semicolon and would be a syntax error inside e.g. a ternary.
    // Retry transient "Script failed to execute" during SPA navigations.
    for (let i = 0; i < 4; i++) {
      try {
        await wc.executeJavaScript(INJECTED_RUNTIME, true)
        return
      } catch {
        await new Promise((r) => setTimeout(r, 350))
      }
    }
  }

  private settle(ms = 1500): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }

  async getState(): Promise<SessionState> {
    const wc = this.getGuest()
    if (!wc) return { loggedIn: false, username: null, url: '' }
    try {
      await this.ensureRuntime(wc)
      const res = (await wc.executeJavaScript('window.__unthreader.getSession()', true)) as {
        loggedIn: boolean
        username: string | null
      }
      if (res?.username) this.lastUsername = res.username
      return { loggedIn: !!res?.loggedIn, username: res?.username ?? this.lastUsername, url: wc.getURL() }
    } catch {
      return { loggedIn: false, username: this.lastUsername, url: wc.getURL() }
    }
  }

  async navigateProfile(): Promise<void> {
    const wc = this.getGuest()
    if (!wc) return
    await this.ensureRuntime(wc)

    // Already on our own profile (e.g. the user navigated there manually)? Stay.
    const already = await wc
      .executeJavaScript('window.__unthreader.isOwnProfile()', true)
      .catch(() => false)
    if (already) {
      const h = (await wc
        .executeJavaScript('window.__unthreader.rememberMe()', true)
        .catch(() => null)) as string | null
      if (h) this.lastUsername = h
      return
    }

    // Preferred: click Threads' own Profile nav — it always routes to the
    // logged-in account, regardless of what handle we think we know.
    const clicked = await wc
      .executeJavaScript('window.__unthreader.goToOwnProfile()', true)
      .catch(() => false)
    if (clicked) {
      await this.settle()
      const handle = (await wc
        .executeJavaScript('window.__unthreader.rememberMe()', true)
        .catch(() => null)) as string | null
      if (handle) {
        this.lastUsername = handle
        return
      }
    }

    // Fallback: build the profile URL on the *live* origin from a known handle.
    const state = await this.getState()
    const user = state.username ?? this.lastUsername
    const origin = safeOrigin(wc.getURL()) ?? SELECTORS.baseUrl
    if (user) {
      await wc.loadURL(`${origin}/@${user}`)
      await this.settle()
      await wc.executeJavaScript('window.__unthreader.rememberMe()', true).catch(() => null)
    }
  }

  private async emit(): Promise<void> {
    if (!this.onChange) return
    this.onChange(await this.getState())
  }
}

export const threadsSession = new ThreadsSession()
