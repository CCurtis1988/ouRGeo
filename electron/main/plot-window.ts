import { BrowserWindow, type WebContents } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

/**
 * Snapshot of the main window's plot store that the popout mirrors. The main
 * window stays the single source of truth: the popout renders this state and
 * sends navigation *intents* back through `forwardPlotNavigate`.
 */
export interface PlotPopoutState {
  dataUrl: string | null
  plotId: string | null
  index: number
  total: number
}

let plotWindow: BrowserWindow | null = null
// The window that opened the popout — where navigation intents are routed back.
let ownerContents: WebContents | null = null

function applyTitle(state: PlotPopoutState): void {
  if (!plotWindow || plotWindow.isDestroyed()) return
  plotWindow.setTitle(
    state.total > 0 ? `Plot ${state.index + 1} of ${state.total}` : 'Plot Preview'
  )
}

export function openPlotWindow(state: PlotPopoutState, owner?: WebContents): void {
  if (owner) ownerContents = owner

  if (plotWindow && !plotWindow.isDestroyed()) {
    plotWindow.focus()
    plotWindow.webContents.send('plot:state', state)
    applyTitle(state)
    return
  }

  plotWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 480,
    minHeight: 360,
    title: 'Plot Preview',
    autoHideMenuBar: true,
    backgroundColor: '#0f1117',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: process.platform === 'darwin'
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    plotWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#plot-popout`)
  } else {
    plotWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'plot-popout' })
  }

  plotWindow.webContents.on('did-finish-load', () => {
    if (plotWindow && !plotWindow.isDestroyed()) {
      plotWindow.webContents.send('plot:state', state)
      applyTitle(state)
    }
  })

  plotWindow.on('closed', () => {
    plotWindow = null
    ownerContents = null
  })
}

export function updatePlotWindow(state: PlotPopoutState): void {
  if (plotWindow && !plotWindow.isDestroyed()) {
    plotWindow.webContents.send('plot:state', state)
    applyTitle(state)
  }
}

/** Popout arrow → main window store. No-op once the opener is gone. */
export function forwardPlotNavigate(index: number): void {
  if (ownerContents && !ownerContents.isDestroyed()) {
    ownerContents.send('plot:navigate', index)
  }
}

export function togglePlotFullscreen(): void {
  if (plotWindow && !plotWindow.isDestroyed()) {
    plotWindow.setFullScreen(!plotWindow.isFullScreen())
  }
}
