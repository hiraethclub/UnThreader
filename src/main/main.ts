import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { store } from './store.js'
import { threadsSession } from './session.js'
import { registerIpc } from './ipc.js'
import { SELECTORS } from './automation/selectors.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const THREADS_PARTITION = 'persist:threads'

/** Present Threads with a clean desktop-Chrome UA (no "Electron" token). */
function cleanUserAgent(): string {
  const raw = session.fromPartition(THREADS_PARTITION).getUserAgent()
  return raw
    .replace(/ Electron\/[\d.]+/i, '')
    .replace(new RegExp(` ${app.getName()}\\/[\\d.]+`, 'i'), '')
    .trim()
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'UnThreader',
    backgroundColor: '#101014',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  })

  // Lock down the Threads <webview> guest and force it onto our persistent
  // partition with a clean UA. Runs before the guest process is created.
  win.webContents.on('will-attach-webview', (_event, prefs, params) => {
    delete (prefs as { preload?: string }).preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    params.partition = THREADS_PARTITION
  })

  // Once the guest exists, hand it to the session manager for automation.
  win.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setUserAgent(cleanUserAgent())
    guest.setZoomFactor(1)
    threadsSession.attach(guest)
    // Open target=_blank links in the user's real browser, not new windows.
    guest.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })
  })

  registerIpc(win.webContents)

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  await store.init()
  session.fromPartition(THREADS_PARTITION).setUserAgent(cleanUserAgent())

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Expose the base URL to the renderer via a simple env for the initial webview src.
process.env['UNTHREADER_BASE_URL'] = SELECTORS.baseUrl
