import { IpcMain, dialog, app, shell, powerSaveBlocker } from 'electron'
import { readFile, writeFile, readdir, stat, unlink } from 'fs/promises'
import { existsSync, readdirSync, realpathSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import AdmZip from 'adm-zip'
import { rBridge } from './r-bridge'
import {
  openPlotWindow,
  updatePlotWindow,
  forwardPlotNavigate,
  togglePlotFullscreen,
  type PlotPopoutState
} from './plot-window'
import { openWidgetWindow } from './widget-window'

const R_CONFIG_FILE = 'r-config.json'

function getRConfigPath(): string {
  return join(app.getPath('userData'), R_CONFIG_FILE)
}

async function readRConfig(): Promise<{ rscriptPath: string | null }> {
  try {
    const raw = await readFile(getRConfigPath(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { rscriptPath: null }
  }
}

async function writeRConfig(rscriptPath: string | null): Promise<void> {
  await writeFile(getRConfigPath(), JSON.stringify({ rscriptPath }), 'utf-8')
}

function getRVersion(rscriptPath: string): string {
  try {
    // `Rscript --version` prints to stderr on some versions
    let output = ''
    try {
      output = execFileSync(rscriptPath, ['--version'], { timeout: 5000, encoding: 'utf-8' })
    } catch (e: unknown) {
      // Some R versions write --version output to stderr
      if (e && typeof e === 'object' && 'stderr' in e) {
        output = String((e as { stderr: string }).stderr)
      }
    }
    const match = output.match(/R\s+version\s+[\d.]+\s+\([^)]+\)/)
    return match ? match[0] : output.trim().split('\n')[0] || 'Unknown version'
  } catch {
    return 'Unknown version'
  }
}

function resolveRealPath(candidate: string): string | null {
  const isBare = !candidate.includes('/') && !candidate.includes('\\')
  try {
    if (isBare) {
      // Resolve bare name (e.g. 'Rscript') to absolute path via which/where
      const cmd = process.platform === 'win32' ? 'where.exe' : 'which'
      const resolved = execFileSync(cmd, [candidate], { timeout: 3000, encoding: 'utf-8' })
        .trim()
        .split('\n')[0]
        .trim()
      return realpathSync(resolved)
    }
    return realpathSync(candidate)
  } catch {
    return null
  }
}

function detectRInstallations(configuredPath: string | null): { path: string; version: string }[] {
  const candidates: string[] = []

  if (process.platform === 'win32') {
    const base = 'C:\\Program Files\\R'
    if (existsSync(base)) {
      try {
        const dirs = readdirSync(base)
        for (const dir of dirs) {
          candidates.push(join(base, dir, 'bin', 'Rscript.exe'))
          candidates.push(join(base, dir, 'bin', 'x64', 'Rscript.exe'))
        }
      } catch { /* ignore */ }
    }
    candidates.push('Rscript.exe')
  } else {
    candidates.push(
      '/usr/bin/Rscript',
      '/usr/local/bin/Rscript',
      '/opt/homebrew/bin/Rscript',
      '/Library/Frameworks/R.framework/Versions/Current/Resources/bin/Rscript'
    )
    // rig-managed installations
    const rigBase = '/opt/R'
    if (existsSync(rigBase)) {
      try {
        const dirs = readdirSync(rigBase)
        for (const dir of dirs) {
          candidates.push(join(rigBase, dir, 'bin', 'Rscript'))
        }
      } catch { /* ignore */ }
    }
    candidates.push('Rscript')
  }

  if (configuredPath) candidates.push(configuredPath)

  // Deduplicate by resolved real path — prevents showing the same binary twice
  // (e.g. '/usr/bin/Rscript' and bare 'Rscript' resolving to the same file)
  const seenRealPaths = new Set<string>()
  const results: { path: string; version: string }[] = []

  for (const candidate of candidates) {
    const realPath = resolveRealPath(candidate)
    if (!realPath) continue
    if (seenRealPaths.has(realPath)) continue
    seenRealPaths.add(realPath)

    // Prefer the absolute resolved path as the display/stored path
    const displayPath = candidate.includes('/') || candidate.includes('\\') ? candidate : realPath
    const version = getRVersion(displayPath)
    if (version !== 'Unknown version') {
      results.push({ path: displayPath, version })
    }
  }

  return results
}

export function setupIpcHandlers(ipcMain: IpcMain): void {
  // File dialog: open R scripts
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open R Script',
      filters: [
        { name: 'R Scripts', extensions: ['R', 'r'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // File dialog: save R script
  ipcMain.handle('dialog:saveFile', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Save R Script',
      filters: [
        { name: 'R Scripts', extensions: ['R'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    return result.canceled ? null : result.filePath
  })

  // File dialog: open .RData files
  ipcMain.handle('dialog:openRData', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open R Data',
      filters: [
        { name: 'R Data', extensions: ['RData', 'rdata', 'rda'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // File dialog: save .RData file
  ipcMain.handle('dialog:saveRData', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Save R Data',
      filters: [
        { name: 'R Data', extensions: ['RData'] }
      ]
    })
    return result.canceled ? null : result.filePath
  })

  // Project bundle dialogs (.ourgeoproj = zip of project.json + environment.RData)
  ipcMain.handle('dialog:openProject', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open ouRGeo Project',
      filters: [
        { name: 'ouRGeo Project', extensions: ['ourgeoproj'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:saveProject', async (_evt, defaultName?: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Save ouRGeo Project',
      defaultPath: defaultName ? `${defaultName}.ourgeoproj` : undefined,
      filters: [{ name: 'ouRGeo Project', extensions: ['ourgeoproj'] }]
    })
    return result.canceled ? null : result.filePath
  })

  // A fresh temp path the R server can write the env snapshot (.RData) to before
  // it gets folded into the project bundle. R writes it; project:pack consumes it.
  ipcMain.handle('project:tempEnvPath', () =>
    join(app.getPath('temp'), `ourgeo-env-${Date.now()}-${Math.round(Math.random() * 1e6)}.RData`)
  )

  // Build a .ourgeoproj zip from the manifest JSON + the env .RData temp file,
  // then delete the temp .RData. envRDataPath may be null (no env snapshot).
  ipcMain.handle(
    'project:pack',
    async (_evt, bundlePath: string, projectJson: string, envRDataPath: string | null) => {
      const zip = new AdmZip()
      zip.addFile('project.json', Buffer.from(projectJson, 'utf-8'))
      if (envRDataPath && existsSync(envRDataPath)) {
        zip.addLocalFile(envRDataPath, '', 'environment.RData')
      }
      zip.writeZip(bundlePath)
      if (envRDataPath) {
        try { await unlink(envRDataPath) } catch { /* temp may already be gone */ }
      }
    }
  )

  // Extract a .ourgeoproj: return the manifest JSON string and the temp path of
  // the extracted environment.RData (null if the bundle has no env snapshot).
  ipcMain.handle('project:unpack', (_evt, bundlePath: string) => {
    const zip = new AdmZip(bundlePath)
    const projectJson = zip.readAsText('project.json')
    let envRDataPath: string | null = null
    const envEntry = zip.getEntry('environment.RData')
    if (envEntry) {
      const outDir = mkdtempSync(join(tmpdir(), 'ourgeo-proj-'))
      zip.extractEntryTo(envEntry, outDir, false, true)
      envRDataPath = join(outDir, 'environment.RData')
    }
    return { projectJson, envRDataPath }
  })

  // File read/write for R scripts
  ipcMain.handle('file:read', async (_evt, filePath: string) => {
    return await readFile(filePath, 'utf-8')
  })

  ipcMain.handle('file:write', async (_evt, filePath: string, content: string) => {
    await writeFile(filePath, content, 'utf-8')
  })

  // File dialog: open R package files
  ipcMain.handle('dialog:openPackageFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select R Package File',
      filters: [
        { name: 'R Package Files', extensions: ['gz', 'zip', 'tgz'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // File dialog: open directory
  ipcMain.handle('dialog:openDirectory', async (_evt, title?: string) => {
    const result = await dialog.showOpenDialog({
      title: title ?? 'Select Folder',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // File dialog: export objects to filesystem
  ipcMain.handle('dialog:saveExportFile', async (_evt, format: string) => {
    const filters: Record<string, { name: string; extensions: string[] }[]> = {
      csv:  [{ name: 'CSV',      extensions: ['csv'] }, { name: 'All Files', extensions: ['*'] }],
      txt:  [{ name: 'Text',     extensions: ['txt'] }, { name: 'All Files', extensions: ['*'] }],
      xlsx: [{ name: 'Excel',    extensions: ['xlsx'] }, { name: 'All Files', extensions: ['*'] }],
      r:    [{ name: 'R Script', extensions: ['R', 'r'] }, { name: 'All Files', extensions: ['*'] }],
    }
    const result = await dialog.showSaveDialog({
      title: 'Export',
      filters: filters[format] ?? [{ name: 'All Files', extensions: ['*'] }],
    })
    return result.canceled ? null : result.filePath
  })

  // File dialog: open data files (tabular + spatial + raster)
  ipcMain.handle('dialog:openDataFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Load Data File',
      filters: [
        {
          name: 'All Supported',
          extensions: ['csv', 'tsv', 'tab', 'txt', 'xlsx', 'xls', 'ods', 'json', 'geojson',
                       'parquet', 'feather', 'sas7bdat', 'sav', 'dta',
                       'shp', 'gpkg', 'kml', 'kmz', 'gml', 'dxf', 'gpx', 'fgb',
                       'tif', 'tiff', 'img', 'vrt', 'asc', 'nc', 'jp2', 'grd', 'hgt', 'dem']
        },
        { name: 'Tabular', extensions: ['csv', 'tsv', 'tab', 'txt', 'xlsx', 'xls', 'ods', 'json', 'parquet', 'feather', 'sas7bdat', 'sav', 'dta'] },
        { name: 'Spatial (vector)', extensions: ['geojson', 'json', 'shp', 'gpkg', 'kml', 'kmz', 'gml', 'dxf', 'gpx', 'fgb'] },
        { name: 'Raster', extensions: ['tif', 'tiff', 'img', 'vrt', 'asc', 'nc', 'jp2', 'grd', 'hgt', 'dem'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // .Rgeo file dialogs
  ipcMain.handle('dialog:openRgeo', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open .Rgeo Database',
      filters: [
        { name: 'ouRGeo Databases', extensions: ['Rgeo'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:openWorkspaceFolder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose Workspace Folder',
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Recursively walk a directory and return all .Rgeo files (capped depth)
  ipcMain.handle('fs:scanRgeo', async (_evt, folder: string) => {
    const SKIP = new Set(['.git', 'node_modules', '.cache', 'dist', 'build', 'out'])
    const results: string[] = []
    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > 5) return
      try {
        const entries = await readdir(dir, { withFileTypes: true, encoding: 'utf-8' })
        for (const e of entries) {
          const name = e.name
          if (name.startsWith('.') && name !== '.') continue
          if (SKIP.has(name)) continue
          const p = join(dir, name)
          if (e.isDirectory()) {
            await walk(p, depth + 1)
          } else if (e.isFile() && name.toLowerCase().endsWith('.rgeo')) {
            results.push(p)
          }
        }
      } catch { /* ignore */ }
    }
    if (!folder) return []
    await walk(folder, 0)
    return results
  })

  // Shallow directory listing — used by the workspace file browser
  ipcMain.handle('fs:listDirectory', async (_evt, folder: string) => {
    const SKIP = new Set(['.git', 'node_modules', '.cache', 'dist', 'build', 'out'])
    if (!folder) return []
    try {
      const entries = await readdir(folder, { withFileTypes: true, encoding: 'utf-8' })
      const out = entries
        .filter(e => !e.name.startsWith('.') && !SKIP.has(e.name))
        .map(e => ({
          name: e.name,
          path: join(folder, e.name),
          isDirectory: e.isDirectory(),
        }))
      out.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      })
      return out
    } catch {
      return []
    }
  })

  ipcMain.handle('fs:fileStat', async (_evt, filePath: string) => {
    try {
      const s = await stat(filePath)
      return { exists: true, size: s.size, mtimeMs: s.mtimeMs }
    } catch {
      return { exists: false, size: 0, mtimeMs: 0 }
    }
  })

  ipcMain.handle('shell:showItemInFolder', (_evt, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  // App data path
  ipcMain.handle('app:getDataPath', () => app.getPath('userData'))

  // R bridge status
  ipcMain.handle('r:getPort', () => rBridge.port)
  ipcMain.handle('r:isReady', () => rBridge.isReady)

  // R version management
  ipcMain.handle('r:detectInstallations', async () => {
    const config = await readRConfig()
    return detectRInstallations(config.rscriptPath)
  })

  ipcMain.handle('r:getConfiguredPath', async () => {
    const config = await readRConfig()
    return config.rscriptPath
  })

  ipcMain.handle('r:setAndRestartR', async (_evt, path: string | null) => {
    await writeRConfig(path)
    rBridge.setPath(path)
    await rBridge.restart()
  })

  ipcMain.handle('r:interrupt', () => {
    rBridge.interrupt()
  })

  // Long R operations (imports, raster registration) can outlive the OS idle
  // timeout — the machine suspends mid-request, and on resume Chromium aborts
  // every in-flight request (even to localhost) with ERR_NETWORK_CHANGED.
  // The renderer refcounts block/unblock around long requests; a single
  // blocker here inhibits idle-suspend while any of them is in flight.
  let powerBlockId: number | null = null

  ipcMain.handle('power:block', () => {
    if (powerBlockId === null || !powerSaveBlocker.isStarted(powerBlockId)) {
      powerBlockId = powerSaveBlocker.start('prevent-app-suspension')
    }
  })

  ipcMain.handle('power:unblock', () => {
    if (powerBlockId !== null && powerSaveBlocker.isStarted(powerBlockId)) {
      powerSaveBlocker.stop(powerBlockId)
    }
    powerBlockId = null
  })

  ipcMain.handle('r:browseRscript', async () => {
    const filters =
      process.platform === 'win32'
        ? [{ name: 'Rscript', extensions: ['exe'] }, { name: 'All Files', extensions: ['*'] }]
        : [{ name: 'All Files', extensions: ['*'] }]
    const result = await dialog.showOpenDialog({
      title: 'Select Rscript Executable',
      filters,
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Plot window
  ipcMain.handle('plot:open-popout', (evt, state: PlotPopoutState) => {
    openPlotWindow(state, evt.sender)
  })

  ipcMain.handle('plot:sync-state', (_evt, state: PlotPopoutState) => {
    updatePlotWindow(state)
  })

  ipcMain.handle('plot:navigate', (_evt, index: number) => {
    forwardPlotNavigate(index)
  })

  ipcMain.handle('plot:toggle-fullscreen', () => {
    togglePlotFullscreen()
  })

  ipcMain.handle('widget:open-popout', (_evt, id: string) => {
    const port = rBridge.port
    if (port) openWidgetWindow(id, port)
  })

  // Save plot file dialog
  ipcMain.handle('dialog:savePlot', async (_evt, format: string) => {
    const filters: Record<string, { name: string; extensions: string[] }[]> = {
      png: [{ name: 'PNG Image', extensions: ['png'] }, { name: 'All Files', extensions: ['*'] }],
      jpg: [{ name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }, { name: 'All Files', extensions: ['*'] }],
      pdf: [{ name: 'PDF Document', extensions: ['pdf'] }, { name: 'All Files', extensions: ['*'] }],
    }
    const result = await dialog.showSaveDialog({
      title: 'Export Plot',
      filters: filters[format] ?? [{ name: 'All Files', extensions: ['*'] }],
    })
    return result.canceled ? null : result.filePath
  })

  // Write binary file (base64 encoded content)
  ipcMain.handle('file:writeBinary', async (_evt, filePath: string, base64: string) => {
    const buffer = Buffer.from(base64, 'base64')
    await writeFile(filePath, buffer)
  })
}
