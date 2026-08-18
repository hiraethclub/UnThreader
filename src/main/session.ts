import type { WebContents } from 'electron'
import { type SessionState } from '@shared/types.js'
import { INJECTED_RUNTIME } from './automation/injected.js'
import { SELECTORS } from './automation/selectors.js'

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

  async getState(): Promise<SessionState> {
    const wc = this.getGuest()
    if (!wc) return { loggedIn: false, username: null, url: '' }
    try {
      await wc.executeJavaScript(
        '(window.__unthreader&&window.__unthreader.__v===1)?1:(' + INJECTED_RUNTIME + ')',
        true
      )
      const res = (await wc.executeJavaScript('window.__unthreader.getSession()', true)) as {
        loggedIn: boolean
        username: string | null
      }
      if (res?.username) this.lastUsername = res.username
      return { loggedIn: !!res?.loggedIn, username: res?.username ?? null, url: wc.getURL() }
    } catch {
      return { loggedIn: false, username: this.lastUsername, url: wc.getURL() }
    }
  }

  async navigateProfile(): Promise<void> {
    const wc = this.getGuest()
    if (!wc) return
    const state = await this.getState()
    const user = state.username ?? this.lastUsername
    const url = user ? `${SELECTORS.baseUrl}/@${user}` : SELECTORS.baseUrl
    await wc.loadURL(url)
  }

  private async emit(): Promise<void> {
    if (!this.onChange) return
    this.onChange(await this.getState())
  }
}

export const threadsSession = new ThreadsSession()
