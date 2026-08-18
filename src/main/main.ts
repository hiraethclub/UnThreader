import { app, BrowserWindow, Menu, session, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { store } from './store.js'
import { threadsSession, THREADS_PARTITION } from './session.js'
import { registerIpc } from './ipc.js'
import { SELECTORS } from './automation/selectors.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/** Present Threads with a clean desktop-Chrome UA (no "Electron" token). */
function cleanUserAgent(): string {
  const raw = session.fromPartition(THREADS_PARTITION).getUserAgent()
  return raw
    .replace(/ Electron\/[\d.]+/i, '')
    .replace(new RegExp(` ${app.getName()}\\/[\\d.]+`, 'i'), '')
    .trim()
}

let aboutWin: BrowserWindow | null = null

function openAbout(): void {
  if (aboutWin && !aboutWin.isDestroyed()) {
    aboutWin.focus()
    return
  }
  aboutWin = new BrowserWindow({
    width: 460,
    height: 440,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'About UnThreader',
    backgroundColor: '#101014',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })
  aboutWin.setMenuBarVisibility(false)
  aboutWin.on('closed', () => {
    aboutWin = null
  })

  const setVersion = () => {
    void aboutWin?.webContents.executeJavaScript(
      `(function(){var el=document.getElementById('version');if(el)el.textContent='version ${app.getVersion()}';})()`
    )
  }
  aboutWin.webContents.on('did-finish-load', setVersion)

  if (process.env['ELECTRON_RENDERER_URL']) {
    void aboutWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/about.html`)
  } else {
    void aboutWin.loadFile(join(__dirname, '../renderer/about.html'))
  }
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ label: app.getName(), submenu: [{ role: 'quit' as const }] }]
      : []),
    { label: 'File', submenu: [{ role: isMac ? ('close' as const) : ('quit' as const) }] },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const }
      ]
    },
    { label: 'Window', submenu: [{ role: 'minimize' as const }, { role: 'close' as const }] },
    {
      label: 'Help',
      submenu: [
        {
          label: 'UnThreader on GitHub',
          click: () => void shell.openExternal('https://github.com/hiraethclub/UnThreader')
        },
        { type: 'separator' as const },
        { label: 'About UnThreader', click: openAbout }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
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

  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// If the user opted out of persistent login, clear the Threads session on quit.
app.on('before-quit', async (event) => {
  if (store.getSettings().persistLogin) return
  event.preventDefault()
  try {
    const ses = session.fromPartition(THREADS_PARTITION)
    await ses.clearStorageData()
    await ses.clearCache()
  } catch {
    /* ignore */
  }
  app.exit(0)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Expose the base URL to the renderer via a simple env for the initial webview src.
process.env['UNTHREADER_BASE_URL'] = SELECTORS.baseUrl
