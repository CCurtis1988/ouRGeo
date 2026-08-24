import { app, BrowserWindow, shell, ipcMain, powerMonitor } from 'electron'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { unlinkSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { rBridge } from './r-bridge'
import { setupIpcHandlers } from './ipc'
import { registerAiProxy } from './ai-proxy'

async function loadSavedRPath(): Promise<void> {
  try {
    const configPath = join(app.getPath('userData'), 'r-config.json')
    const raw = await readFile(configPath, 'utf-8')
    const config = JSON.parse(raw) as { rscriptPath?: string | null }
    if (config.rscriptPath) {
      rBridge.setPath(config.rscriptPath)
      console.log('[Main] Using saved R path:', config.rscriptPath)
    }
  } catch {
    // No saved config — use default
  }
}

let mainWindow: BrowserWindow | null = null

// Set once the renderer has resolved the unsaved-changes prompt and we may quit.
// The first close attempt is intercepted so the renderer can prompt to save the
// current project; it then calls `app:confirm-quit` to let the window close.
let quitConfirmed = false

// Force the renderer to repaint after the compositor drops the window surface
// (common on Linux after suspend/resume, leaving a black screen even though all
// app + R state is intact). invalidate() asks for a repaint; a 1px resize nudge
// makes the compositor rebuild the surface. Both preserve state — nothing
// reloads. The resize is skipped when maximized/full-screen so window geometry
// is left untouched (invalidate alone covers those).
function forceRepaint(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  try {
    win.webContents.invalidate()
    if (!win.isMaximized() && !win.isFullScreen() && !win.isMinimized()) {
      const [w, h] = win.getSize()
      win.setSize(w, h + 1)
      setTimeout(() => { if (!win.isDestroyed()) win.setSize(w, h) }, 80)
    }
  } catch (err) {
    console.error('[Main] forceRepaint failed:', err)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1117',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
      // webSecurity stays enabled (the default). External AI-provider calls go
      // through the main process via the ai-proxy IPC bridge; the R server sends
      // Access-Control-Allow-Origin: * so renderer→R requests work with it on.
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  // Intercept the first close so the renderer can prompt to save unsaved project
  // changes (env + UI state). The renderer always ends by calling `app:confirm-quit`
  // (even on cancel it just doesn't call it), which sets `quitConfirmed` + destroys
  // the window. If the renderer is already gone, let the close proceed.
  mainWindow.on('close', (e) => {
    if (quitConfirmed || !mainWindow || mainWindow.webContents.isDestroyed()) return
    e.preventDefault()
    mainWindow.webContents.send('app:before-quit')
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (!(input.control || input.meta)) return
    if (input.key === '+' || input.key === '=') {
      event.preventDefault()
      mainWindow!.webContents.send('ui:zoom', 'in')
    } else if (input.key === '-') {
      event.preventDefault()
      mainWindow!.webContents.send('ui:zoom', 'out')
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // If the renderer process itself dies (GPU driver reset on resume, OOM, …),
  // Electron leaves a blank window with no auto-recovery. Reload it — persisted
  // session/plots restore on load. 'clean-exit' happens on normal shutdown.
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[Main] Renderer process gone:', details.reason)
    if (details.reason !== 'clean-exit' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload()
    }
  })

  // The GPU process crashing (or dropping its context after resume) blacks out
  // the window; it auto-restarts, so nudge a repaint once it's back.
  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[Main] Renderer unresponsive — forcing repaint')
    forceRepaint(mainWindow)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('org.ourgeo.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  setupIpcHandlers(ipcMain)
  registerAiProxy(ipcMain)

  // The renderer calls this after resolving the unsaved-changes prompt (Save or
  // Don't Save) to allow the intercepted window close to complete.
  ipcMain.handle('app:confirm-quit', () => {
    quitConfirmed = true
    mainWindow?.destroy()
  })

  await loadSavedRPath()

  try {
    await rBridge.start()
    console.log('[Main] R bridge started, port:', rBridge.port)
  } catch (err) {
    console.error('[Main] Failed to start R bridge:', err)
  }

  // Auto-restart R when it exits unexpectedly (crash, hibernate kill, etc.)
  rBridge.onUnexpectedExit = async () => {
    console.log('[Main] R exited unexpectedly — restarting...')
    await new Promise((r) => setTimeout(r, 500))
    try {
      await rBridge.restart()
      console.log('[Main] R restarted, port:', rBridge.port)
      mainWindow?.webContents.send('r:restarted')
    } catch (err) {
      console.error('[Main] R restart failed:', err)
    }
  }

  // On system resume from sleep/hibernate: repaint the (often-blacked-out)
  // window and tell the renderer to revalidate its R connection. Only restart R
  // if it actually died — a needless restart would drop the user's R objects.
  const onResume = async (): Promise<void> => {
    console.log('[Main] System resumed — repainting + checking R health...')
    forceRepaint(mainWindow)
    mainWindow?.webContents.send('system:resume')
    if (!rBridge.isReady) {
      try {
        await rBridge.restart()
        console.log('[Main] R restarted after resume, port:', rBridge.port)
        mainWindow?.webContents.send('r:restarted')
      } catch (err) {
        console.error('[Main] R restart after resume failed:', err)
      }
    }
  }
  powerMonitor.on('resume', onResume)
  // Screen unlock can be a distinct event from resume on some desktops; repaint
  // there too so a locked-through-suspend session comes back painted.
  powerMonitor.on('unlock-screen', () => forceRepaint(mainWindow))

  // The GPU process crashing blacks out the window; it auto-restarts, so repaint
  // once it's back. (Renderer crashes are handled per-window above.)
  app.on('child-process-gone', (_e, details) => {
    if (details.type === 'GPU') {
      console.error('[Main] GPU process gone:', details.reason)
      setTimeout(() => forceRepaint(mainWindow), 400)
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  rBridge.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// On clean exit, wipe session-scoped state so the next launch starts fresh —
// EXCEPT session.json (open code/.R tabs), which we deliberately keep between
// sessions. A crash (no will-quit) leaves these intact for recovery on relaunch.
app.on('will-quit', () => {
  const dir = app.getPath('userData')
  const sessionScoped = [
    'plots.json',
    'spatial-layers.json',
    'spatial-ui.json',
    'console.json',
    'object-tabs.json'
  ]
  for (const file of sessionScoped) {
    try { unlinkSync(join(dir, file)) } catch { /* file may not exist */ }
  }
})
