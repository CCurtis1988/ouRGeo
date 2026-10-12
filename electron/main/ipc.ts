import { IpcMain, dialog, app, shell, powerSaveBlocker, clipboard } from 'electron'
import { readFile, writeFile, readdir, stat, unlink } from 'fs/promises'
import { existsSync, readdirSync, realpathSync, mkdtempSync } from 'fs'
import { join, dirname } from 'path'
import { randomUUID } from 'node:crypto'
import { rename } from 'node:fs/promises'
import { validateProjectContext, forkProjectContext } from '../../src/lib/context/memory-schema'
import { contextLease, activateContextProject } from './context/scope'
import { savedProjectDraft, requireContextOwner, registerProjectMemory, savedFileLinks, projectFileLinks, projectLocation, savedProjectLocation } from './context/ipc'
import { duplicateProjectLocation } from './context/project-location'
import { authorisedDatabaseLinks } from './context/file-links'
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

export function detectRInstallations(configuredPath: string | null): { path: string; version: string }[] {
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

  /**
   * Read the system clipboard, for the terminal's Ctrl+Shift+V.
   *
   * Here rather than `navigator.clipboard.readText()` because that needs the
   * `clipboard-read` permission, and granting it would let anything in the
   * renderer read whatever the user last copied — a password, a token —
   * silently and at any time. This read happens once, when a keystroke asks
   * for it. See the permission allowlist in index.ts.
   */
  ipcMain.handle('clipboard:readText', () => clipboard.readText())
  // File dialog: open a document (R script, Markdown, R Markdown)
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Document',
      filters: [
        { name: 'All Documents', extensions: ['R', 'r', 'Rmd', 'rmd', 'qmd', 'md', 'markdown'] },
        { name: 'R Scripts', extensions: ['R', 'r'] },
        { name: 'R Markdown', extensions: ['Rmd', 'rmd', 'qmd'] },
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // File dialog: choose screenshots. Multi-select, and image extensions only —
  // the plugin submit panel used to reach for `dialog:openFile`, whose filter
  // set is R scripts and markdown, so a PNG was hidden unless the user thought
  // to switch to "All Files". A picker that hides what it is asking for is
  // indistinguishable from one that refused the file.
  ipcMain.handle('dialog:openImages', async (_evt, title?: string) => {
    const result = await dialog.showOpenDialog({
      title: title ?? 'Add Screenshots',
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    })
    return result.canceled ? [] : result.filePaths
  })

  // File dialog: save a document. `kind` picks the filter set and the default
  // extension so a .Rmd doesn't get offered as "Save as .R"; it is optional so
  // existing callers keep the historic R-script behaviour.
  ipcMain.handle('dialog:saveFile', async (_event, kind?: string) => {
    const saveFilters: Record<string, { name: string; extensions: string[] }[]> = {
      r:         [{ name: 'R Scripts',  extensions: ['R'] }],
      markdown:  [{ name: 'Markdown',   extensions: ['md', 'markdown'] }],
      rmarkdown: [{ name: 'R Markdown', extensions: ['Rmd'] }],
    }
    const chosen = saveFilters[kind ?? 'r'] ?? saveFilters.r
    const titles: Record<string, string> = {
      r: 'Save R Script', markdown: 'Save Markdown', rmarkdown: 'Save R Markdown',
    }
    const result = await dialog.showSaveDialog({
      title: titles[kind ?? 'r'] ?? 'Save Document',
      filters: [...chosen, { name: 'All Files', extensions: ['*'] }]
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

  // Theme dialogs. A theme file is plain JSON with an `ourgeoTheme` envelope
  // naming its kind (system / code / markdown) — the renderer refuses a file
  // whose kind does not match the editor it was dropped into, so the extension
  // here is a convenience, never the check.
  ipcMain.handle('dialog:openTheme', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import ouRGeo Theme',
      filters: [
        { name: 'ouRGeo Theme', extensions: ['ourgeotheme', 'json'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:saveTheme', async (_evt, defaultName?: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Export ouRGeo Theme',
      defaultPath: defaultName ? `${defaultName}.ourgeotheme.json` : undefined,
      filters: [
        { name: 'ouRGeo Theme', extensions: ['ourgeotheme.json', 'json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    return result.canceled ? null : result.filePath
  })

  // Layout dialogs. A `.ourgeolayout.json` holds one or more named workspace
  // arrangements under an `ourgeoLayout` envelope; the renderer identifies the
  // file from that envelope, so the extension here is a convenience only.
  ipcMain.handle('dialog:openLayout', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Workspace Layout',
      filters: [
        { name: 'ouRGeo Layout', extensions: ['ourgeolayout', 'json'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:saveLayout', async (_evt, defaultName?: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Export Workspace Layout',
      defaultPath: defaultName ? `${defaultName}.ourgeolayout.json` : undefined,
      filters: [
        { name: 'ouRGeo Layout', extensions: ['ourgeolayout.json', 'json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    return result.canceled ? null : result.filePath
  })

  // Theme artwork: a background image or a picker icon. The extension list is
  // exactly what Chromium can paint from a data: URI in an <img>/background —
  // no TIFF, no PDF, no HEIC.
  ipcMain.handle('dialog:openThemeImage', async (_evt, title?: string) => {
    const result = await dialog.showOpenDialog({
      title: title ?? 'Choose Image',
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'avif'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
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
      requireContextOwner(_evt)
      const lease = contextLease()
      const contextWarnings: string[] = []
      const zip = new AdmZip()
      const manifest = JSON.parse(projectJson)
      const committedContext = validateProjectContext(manifest.context, manifest.projectId ?? null)
      if (manifest.context) {
        const context = committedContext
        zip.addFile('context/project-memory.jsonl', Buffer.from(context.memories.map(record => JSON.stringify(record)).join('\n'), 'utf8'))
        manifest.context = { version: 1, revision: context.revision }
      }
      zip.addFile('project.json', Buffer.from(JSON.stringify(manifest), 'utf-8'))
      if (envRDataPath && existsSync(envRDataPath)) {
        zip.addLocalFile(envRDataPath, '', 'environment.RData')
      }
      // Publish only a complete bundle. A failed write must preserve the last save.
      const staged = join(dirname(bundlePath), `.ourgeo-save-${randomUUID()}.tmp`)
      zip.writeZip(staged)
      try { await rename(staged, bundlePath) }
      catch (error) { try { await unlink(staged) } catch { /* preserve original failure */ }; throw error }
      if (envRDataPath) {
        try { await unlink(envRDataPath) } catch { /* temp may already be gone */ }
      }
      if (contextLease().id === lease.id) {
        if (typeof manifest.projectId === 'string' && /^[a-f0-9-]{36}$/i.test(manifest.projectId)) {
          try { await savedProjectDraft(manifest.projectId, committedContext, lease.projectId, lease.id) }
          catch (error) { contextWarnings.push(`Project saved, but its local memory transaction could not be committed: ${String(error)}. Provider ingestion remains paused for these changes; reopen the saved bundle before recovering older edits.`) }
        }
        if (manifest.projectId && contextLease().id === lease.id) {
          try { await savedFileLinks(manifest.projectId, manifest.ui?.session?.tabs ?? [], manifest.databases ?? []) }
          catch (error) { contextWarnings.push(`Project saved, but local editor file links could not be recorded: ${String(error)}. On reopen, use bundled buffers and choose Save As for local scripts.`) }
          try { await savedProjectLocation(manifest.projectId, bundlePath) }
          catch (error) { contextWarnings.push(`Project saved, but its local identity registry could not be updated: ${String(error)}. Restore protected storage before connecting external project memory.`) }
        }
        if (contextLease().id === lease.id) activateContextProject(typeof manifest.projectId === 'string' && /^[a-f0-9-]{36}$/i.test(manifest.projectId) ? manifest.projectId : null)
      }
      return { contextWarnings }
    }
  )

  // Extract a .ourgeoproj: return the manifest JSON string and the temp path of
  // the extracted environment.RData (null if the bundle has no env snapshot).
  let projectOpenGeneration = 0
  ipcMain.handle('project:unpack', async (_evt, bundlePath: string) => {
    requireContextOwner(_evt)
    const generation = ++projectOpenGeneration
    const priorLease = contextLease().id
    const contextWarnings: string[] = []
    const zip = new AdmZip(bundlePath)
    const projectEntry = zip.getEntry('project.json')
    if (!projectEntry || projectEntry.header.size > 50_000_000) throw new Error('Project manifest is missing or exceeds the import limit. Restore a valid bundle or export a smaller project.')
    const manifest = JSON.parse(zip.readAsText('project.json'))
    if (!manifest || manifest.version !== 1 || !manifest.ui || typeof manifest.ui !== 'object' || Array.isArray(manifest.ui)) throw new Error('Project manifest is unsupported. Restore a valid bundle or open it with a compatible ouRGeo version.')
    const memory = zip.getEntry('context/project-memory.jsonl')
    if (memory) {
      if (memory.header.size > 50_000_000) throw new Error('Project memory exceeds the import limit. Export a smaller selection.')
      const lines = zip.readAsText(memory).split('\n').filter(Boolean)
      if (lines.length > 10000) throw new Error('Project has too many memories. Export a smaller selection.')
      manifest.context = { ...manifest.context, memories: lines.map(line => JSON.parse(line)) }
    }
    let projectJson = JSON.stringify(manifest)
    let envRDataPath: string | null = null
    const envEntry = zip.getEntry('environment.RData')
    let projectId = typeof manifest.projectId === 'string' && /^[a-f0-9-]{36}$/i.test(manifest.projectId) ? manifest.projectId : null
    let identityForked = false
    if (projectId) {
      let previous: string | null = null
      try { previous = await projectLocation(projectId) }
      catch (error) { contextWarnings.push(`The local project identity registry is unavailable: ${String(error)}. External project memory must remain disconnected until protected storage is restored.`) }
      if (await duplicateProjectLocation(previous, bundlePath)) {
        const choice = await dialog.showMessageBox({ type: 'question', title: 'Project identity already exists', message: 'Two bundles have the same project identity.', detail: `Existing location: ${previous}\nOpening: ${bundlePath}\n\nOpen as this project preserves its identity. Open as a copy creates independent project memory with snapshot lineage and no external memory binding. Save the copy to commit its new identity.`, buttons: ['Open as this project', 'Open as a copy', 'Cancel'], defaultId: 1, cancelId: 2 })
        if (generation !== projectOpenGeneration || contextLease().id !== priorLease) throw new Error('SCOPE_CHANGED')
        if (choice.response === 2) throw new Error('PROJECT_OPEN_CANCELLED')
        identityForked = choice.response === 1
      }
    }
    let authorisedFileLinks: import('../../src/lib/context/types').AuthorisedFileLink[] = []
    if (projectId && (manifest.ui?.session?.tabs?.some((tab: { filePath?: string }) => tab?.filePath) || manifest.databases?.length)) {
      try { authorisedFileLinks = await projectFileLinks(projectId) }
      catch (error) { contextWarnings.push(`Local editor file links are unavailable: ${String(error)}. Use bundled buffers and choose Save As to link local files.`) }
    }
    manifest.context = validateProjectContext(manifest.context, projectId)
    // A committed memory export without project identity has no certified
    // namespace. Legacy bundles still open; new drafts live under their lease.
    if (!projectId && manifest.context.memories.length) {
      manifest.context.memories = []
      contextWarnings.push('Imported memory has no project identity and was excluded. The original bundle is unchanged; save an identified project before importing its memory.')
    }
    if (projectId && manifest.context?.memories?.length) {
      try {
        const allowed = new Set(await registerProjectMemory(projectId, manifest.context.memories.map((memory: { id: string }) => memory.id)))
        const excluded = manifest.context.memories.length - allowed.size
        manifest.context.memories = manifest.context.memories.filter((memory: { id: string }) => allowed.has(memory.id))
        if (excluded) contextWarnings.push(`${excluded} imported memories were excluded because they were forgotten or belong to another scope. The original bundle is unchanged.`)
      } catch (error) {
        manifest.context.memories = []
        contextWarnings.push(`Project memory is unavailable: ${String(error)}. The original bundle is unchanged; restore protected storage and reopen it.`)
      }
    }
    if (identityForked) {
      projectId = randomUUID()
      manifest.projectId = projectId
      manifest.context = forkProjectContext(manifest.context, projectId)
      // Forgotten original IDs were filtered before the fork. Generating new
      // IDs must not turn a copy into a way to resurrect a deleted statement.
      await registerProjectMemory(projectId, manifest.context.memories.map((memory: { id: string }) => memory.id))
      contextWarnings.push('Opened as an independent project copy. Save to commit its new identity; external memory connections and source exclusions are not inherited.')
    }
    projectJson = JSON.stringify(manifest)
    if (generation !== projectOpenGeneration || contextLease().id !== priorLease) throw new Error('SCOPE_CHANGED: another workspace transition superseded this open.')
    if (envEntry) {
      const outDir = mkdtempSync(join(tmpdir(), 'ourgeo-proj-'))
      zip.extractEntryTo(envEntry, outDir, false, true)
      envRDataPath = join(outDir, 'environment.RData')
    }
    if (projectId) {
      try { await savedProjectLocation(projectId, bundlePath) }
      catch (error) { contextWarnings.push(`Project opened, but its local identity registry could not be updated: ${String(error)}. Restore protected storage before connecting external project memory.`) }
    }
    if (generation !== projectOpenGeneration || contextLease().id !== priorLease) throw new Error('SCOPE_CHANGED')
    activateContextProject(projectId)
    return { projectJson, envRDataPath, identityForked, contextWarnings, authorisedFileLinks, authorisedDatabasePaths: authorisedDatabaseLinks(manifest.databases, authorisedFileLinks) }
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
  ipcMain.handle('dialog:saveExportFile', async (_evt, format: string, existing?: boolean) => {
    const filters: Record<string, { name: string; extensions: string[] }[]> = {
      gpkg: [{ name: 'GeoPackage', extensions: ['gpkg'] }],
      geojson: [{ name: 'GeoJSON', extensions: ['geojson', 'json'] }],
      csv:  [{ name: 'CSV',      extensions: ['csv'] }, { name: 'All Files', extensions: ['*'] }],
      txt:  [{ name: 'Text',     extensions: ['txt'] }, { name: 'All Files', extensions: ['*'] }],
      xlsx: [{ name: 'Excel',    extensions: ['xlsx'] }, { name: 'All Files', extensions: ['*'] }],
      r:    [{ name: 'R Script', extensions: ['R', 'r'] }, { name: 'All Files', extensions: ['*'] }],
    }
    if (existing && (format === 'gpkg' || format === 'geojson')) {
      const result = await dialog.showOpenDialog({ title: 'Choose export destination', filters: filters[format], properties: ['openFile'] })
      return result.canceled ? null : result.filePaths[0]
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

  ipcMain.handle('shell:openPath', async (_evt, filePath: string) => {
    // Returns '' on success, or the OS error message.
    return await shell.openPath(filePath)
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

  // Open an http(s) URL in the user's browser. Distinct from shell:openPath,
  // which is for files — openPath on a URL fails on every platform.
  ipcMain.handle('shell:openExternal', async (_evt, url: string): Promise<void> => {
    // Refuse anything that is not a web URL: openExternal will happily hand
    // file:// or a custom scheme to the OS, which is a way to launch things.
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) links can be opened.')
    await shell.openExternal(url)
  })

  // Base64 rather than a Buffer: structured clone would hand the renderer a
  // Uint8Array anyway, and base64 keeps the channel a plain string like every
  // other file handler here. Used by Publish to read knitted figures.
  ipcMain.handle('file:readBinary', async (_evt, filePath: string): Promise<string> => {
    return (await readFile(filePath)).toString('base64')
  })
}
