import type { WebContents } from 'electron'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jitter = (base: number, spread: number) => base + (Math.random() * 2 - 1) * spread

/**
 * Dispatches realistic, coordinate-based mouse input into a WebContents via the
 * Chrome DevTools Protocol. Using synthetic OS-level mouse events (rather than
 * element.click()) makes the automation look human and avoids some bot heuristics.
 */
export class CdpMouse {
  private attached = false

  constructor(private wc: WebContents) {}

  ensureAttached(): void {
    if (this.attached) return
    try {
      if (!this.wc.debugger.isAttached()) this.wc.debugger.attach('1.3')
      this.attached = true
    } catch (err) {
      // Another client (e.g. open DevTools) may hold the debugger. Fall back to
      // in-page clicks handled by the caller.
      this.attached = false
      throw err
    }
  }

  detach(): void {
    try {
      if (this.attached && this.wc.debugger.isAttached()) this.wc.debugger.detach()
    } catch {
      /* ignore */
    }
    this.attached = false
  }

  private async send(method: string, params: Record<string, unknown>): Promise<void> {
    await this.wc.debugger.sendCommand(method, params)
  }

  /** Move the pointer to (x,y) with a couple of intermediate steps. */
  async moveTo(x: number, y: number): Promise<void> {
    const steps = 3 + Math.floor(Math.random() * 3)
    for (let i = 1; i <= steps; i++) {
      const px = (x * i) / steps + jitter(0, 1.5)
      const py = (y * i) / steps + jitter(0, 1.5)
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: px,
        y: py,
        pointerType: 'mouse'
      })
      await sleep(jitter(12, 6))
    }
  }

  /** Human-like click at a point slightly randomized around (x,y). */
  async click(x: number, y: number): Promise<void> {
    const px = x + jitter(0, 2)
    const py = y + jitter(0, 2)
    await this.moveTo(px, py)
    await sleep(jitter(40, 20))
    const common = { x: px, y: py, button: 'left', clickCount: 1, buttons: 1, pointerType: 'mouse' }
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...common })
    await sleep(jitter(60, 30))
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...common })
  }
}
