import { BrowserWindow } from 'electron'

let widgetWindow: BrowserWindow | null = null

export function openWidgetWindow(id: string, port: number): void {
  const url = `http://127.0.0.1:${port}/widget/${id}`

  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.loadURL(url)
    widgetWindow.focus()
    return
  }

  widgetWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 400,
    minHeight: 300,
    title: 'Active View',
    autoHideMenuBar: true,
    backgroundColor: '#0f1117',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: process.platform === 'darwin'
    }
  })

  widgetWindow.loadURL(url)

  widgetWindow.on('closed', () => {
    widgetWindow = null
  })
}
