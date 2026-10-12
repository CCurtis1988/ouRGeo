import type { BrowserWindow } from 'electron'
const nudging = new WeakSet<BrowserWindow>()

export function repaintWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  try {
    win.webContents.invalidate()
    if (!nudging.has(win) && !win.isMaximized() && !win.isFullScreen() && !win.isMinimized()) {
      nudging.add(win)
      const [width, height] = win.getSize()
      win.setSize(width, height + 1)
      setTimeout(() => {
        nudging.delete(win)
        if (!win.isDestroyed() && !win.isMaximized() && !win.isFullScreen()) {
          const [currentWidth, currentHeight] = win.getSize()
          if (currentWidth === width && currentHeight === height + 1) win.setSize(width, height)
        }
        if (!win.isDestroyed()) win.webContents.invalidate()
      }, 80)
    }
  } catch (e) { console.error('[Main] Wake repaint failed:', e) }
}

export function createSleepRecovery(getWindow: () => BrowserWindow | null, bridge: {
  readonly shouldRestart: boolean
  readonly port: number | null
  start(): Promise<void>
}): { suspend(): void; resume(): Promise<void> } {
  let visibleBeforeSleep = false
  let recovering: Promise<void> | null = null
  const send = (channel: string) => {
    const win = getWindow()
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel)
  }
  return {
    suspend() {
      const win = getWindow()
      visibleBeforeSleep = !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()
    },
    async resume() {
      const win = getWindow()
      if (visibleBeforeSleep && win && !win.isDestroyed() && !win.isVisible() && !win.isMinimized()) win.show()
      visibleBeforeSleep = false
      repaintWindow(win)
      send('system:resume')
      if (recovering) return recovering
      if (!bridge.shouldRestart) return
      recovering = (async () => {
        try {
          // start() also coalesces a concurrent unexpected-exit recovery. Never
          // restart() a surviving or newly starting R process on wake.
          await bridge.start()
          console.log('[Main] R recovered after wake, port:', bridge.port)
          send('r:restarted')
        } catch (e) { console.error('[Main] R recovery after wake failed:', e) }
      })()
      try { await recovering } finally { recovering = null }
    },
  }
}
