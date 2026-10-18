/* global window, document, requestAnimationFrame, getComputedStyle, KeyboardEvent */
// Disposable Linux acceptance. Native pickers return self-authored fixtures;
// the real UI, IPC, extraction workers and bundle lifecycle remain in use.
import { _electron as electron } from 'playwright-core'
import electronExecutable from 'electron'
import { mkdir, mkdtemp, writeFile, readFile, readdir, chmod, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import { jsPDF } from 'jspdf'
import { waitForAsync } from './lib/wait-async.mjs'

const root = resolve(import.meta.dirname, '..')
const output = join(root, '.cache/project-files-review')
await mkdir(output, { recursive: true })
const directory = await mkdtemp(join(output, 'run-'))
const temporary = join(directory, 'tmp')
await mkdir(temporary)
process.env.TMPDIR = temporary
const fixtures = join(directory, 'fixtures')
await mkdir(fixtures)
const projectPath = join(directory, 'Reference project.ourgeoproj')
const packaged = process.argv.includes('--packaged') ? resolve(process.argv[process.argv.indexOf('--packaged') + 1]) : undefined
const dev = process.argv.includes('--dev')
const uiMetrics = process.argv.includes('--ui-metrics')
assert(!(packaged && dev), 'Choose either a development renderer or a packaged executable.')
assert(!uiMetrics || dev, '--ui-metrics uses the live renderer module boundary; pass --dev.')
let devServer, rendererUrl
if (dev) {
  const { loadConfigFromFile } = await import('electron-vite')
  const { createServer } = await import('vite')
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, join(root, 'electron.vite.config.ts'), root)
  assert(loaded?.config.renderer, 'Development renderer configuration is unavailable.')
  devServer = await createServer({ ...loaded.config.renderer, configFile: false, server: { ...loaded.config.renderer.server, host: '127.0.0.1', port: 0, strictPort: true } })
  await devServer.listen()
  rendererUrl = `http://127.0.0.1:${devServer.httpServer.address().port}`
}

const report = { version: 1, measuredAt: new Date().toISOString(), directory, mode: packaged ? 'packaged' : dev ? 'development-renderer' : 'built', platform: `${process.platform}-${process.arch}`, passed: false, checks: {}, screenshots: [], limitations: ['Native Windows and macOS verification is deferred.', 'This driver uses deterministic native-picker results; it does not certify pointer interaction with operating-system dialogs.'] }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
let app, page
const errors = []
// Saving or opening a project commits authority between these two IPC reads.
// Retry that specific revoked-lease response; extraction and storage errors
// must still fail acceptance immediately.
const projectScopeTransition = error => error instanceof Error && /\bSCOPE_CHANGED: reopen Project Files in the active project\./.test(error.message)
async function launch(name) {
  const profileRoot = join(directory, name), data = join(profileRoot, 'ourgeo')
  await mkdir(data, { recursive: true, mode: 0o700 }); await chmod(data, 0o700)
  await writeFile(join(data, '.context-acceptance'), 'synthetic-context-profile-v1\n', { mode: 0o600 })
  await writeFile(join(data, 'health-check.json'), JSON.stringify({ prompted: true, report: null }))
  const wrapper = join(profileRoot, 'launch.cjs')
  await writeFile(wrapper, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(data)});require(${JSON.stringify(join(root, 'out/main/index.js'))});`)
  app = await electron.launch({ executablePath: packaged ?? electronExecutable, args: ['--no-sandbox', ...(packaged ? [] : [wrapper])], cwd: root, env: { ...process.env, TMPDIR: temporary, XDG_CONFIG_HOME: profileRoot, OURGEO_CONTEXT_TEST_PROFILE: await realpath(data), ...(rendererUrl ? { ELECTRON_RENDERER_URL: rendererUrl } : {}) }, timeout: 60_000 })
  app.process().stderr.on('data', chunk => { void writeFile(join(directory, `${name}-stderr.log`), chunk, { flag: 'a' }) })
  page = app.windows().find(window => !window.url().startsWith('devtools:')) ?? await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForSelector('[data-ourgeo-id="project.dropdown"]', { timeout: 60_000 })
  assert.equal(resolve(await app.evaluate(({ app }) => app.getPath('userData'))), resolve(data), 'Never open the regular user profile.')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setBounds({ width: 1280, height: 900 }))
  await page.setViewportSize({ width: 1280, height: 900 })
  await app.evaluate(({ session }) => {
    globalThis.projectFilesNetwork = { external: [] }
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const host = new URL(details.url).hostname
      if (['127.0.0.1', 'localhost', '[::1]'].includes(host)) callback({})
      else { globalThis.projectFilesNetwork.external.push(host); callback({ cancel: true }) }
    })
  })
  const later = page.getByRole('button', { name: 'Maybe later', exact: true })
  if (await later.count()) await later.evaluate(element => element.click())
  await page.waitForFunction(() => document.querySelector('[data-ourgeo-id="project.dropdown"]')?.title === 'R connected', undefined, { timeout: 60_000 })
  await page.waitForFunction(() => typeof window.electronAPI.projectFiles?.catalogue === 'function')
  return data
}
async function click(locator) { await locator.evaluate(element => element.click()) }
async function action(label, savePath) {
  if (savePath !== undefined) await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => filePath ? { canceled: false, filePath } : { canceled: true } }, savePath)
  await page.waitForFunction(() => !document.querySelector('[data-ourgeo-id="project.dropdown"]')?.disabled, undefined, { timeout: 60_000 })
  await click(page.locator('[data-ourgeo-id="project.dropdown"]'))
  await click(page.getByRole('button', { name: label, exact: true }))
}
async function library() {
  return page.evaluate(async () => { const lease = await window.electronAPI.context.lease(); return window.electronAPI.projectFiles.catalogue(lease.id) })
}
async function shot(name) { const target = join(directory, `${name}.png`); await page.screenshot({ path: target, animations: 'disabled' }); report.screenshots.push(target) }
async function enlargePane() {
  const bounds = await page.locator('.cursor-row-resize').first().boundingBox()
  assert(bounds, 'The bottom pane must remain resizable.')
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, Math.max(180, y - 350), { steps: 8 }); await page.mouse.up()
}
async function close() {
  if (!app) return
  await page.evaluate(() => window.electronAPI.app.confirmQuit()).catch(() => undefined)
  await app.close().catch(() => undefined)
  app = undefined; page = undefined
}
async function chooseFile(id) {
  const name = (await library()).files.find(file => file.id === id)?.name
  assert(name)
  const list = page.getByRole('listbox', { name: 'Project files' })
  await list.getByRole('option').filter({ hasText: name }).evaluate(element => element.click())
  const details = page.getByRole('button', { name: 'Preview / details', exact: true })
  if (await details.count()) await click(details)
}

try {
  await writeFile(join(fixtures, 'Project report.md'), '# Project report\n\n' + Array.from({ length: 150 }, (_, index) => `Line ${index + 1}: reference material.`).join('\n') + '\n\n## Drainage requirement\nPF_DEEP_REQUIREMENT: minimum freeboard is 0.6 m.\n')
  const pdf = new jsPDF(); pdf.text('Project figure standards: use labelled axes.', 20, 20); pdf.addPage(); pdf.text('PF_PDF_PAGE_TWO: retain north arrows.', 20, 20)
  await writeFile(join(fixtures, 'Figure standard.pdf'), Buffer.from(pdf.output('arraybuffer')))
  const docx = new AdmZip()
  docx.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'))
  docx.addFile('word/document.xml', Buffer.from('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>PF_WORD_REQUIREMENT: use accessible labels.</w:t></w:r></w:p></w:body></w:document>'))
  await writeFile(join(fixtures, 'Reporting guidance.docx'), docx.toBuffer())
  await writeFile(join(fixtures, 'Measurements.csv'), 'Site,Freeboard,Units\nA,0.6,m\nB,0.8,m\n')
  const workbook = new AdmZip()
  workbook.addFile('[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'))
  workbook.addFile('xl/workbook.xml', Buffer.from('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Measurements" sheetId="1" r:id="r1"/><sheet name="Hidden notes" sheetId="2" state="hidden" r:id="r2"/></sheets></workbook>'))
  workbook.addFile('xl/_rels/workbook.xml.rels', Buffer.from('<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>'))
  workbook.addFile('xl/worksheets/sheet1.xml', Buffer.from('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Site</t></is></c><c r="B1" t="inlineStr"><is><t>Freeboard</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>A</t></is></c><c r="B2"><f>0.3+0.3</f><v>0.6</v></c></row></sheetData></worksheet>'))
  workbook.addFile('xl/worksheets/sheet2.xml', Buffer.from('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>PF_HIDDEN_WORKBOOK_CONTENT</t></is></c></row></sheetData></worksheet>'))
  await writeFile(join(fixtures, 'Measurements.xlsx'), workbook.toBuffer())
  await writeFile(join(fixtures, 'Stored original.bin'), Buffer.from([0, 255, 7, 19, 0, 188]))
  await launch('original-profile')
  const image = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 240; const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, 400, 240); context.fillStyle = '#244c82'; context.fillRect(80, 90, 70, 110); context.fillRect(230, 50, 70, 150); context.fillStyle = '#111111'; context.font = '18px sans-serif'; context.fillText('Reference figure: site freeboard', 30, 30); context.fillText('A', 105, 225); context.fillText('B', 255, 225); return canvas.toDataURL('image/png') })
  await writeFile(join(fixtures, 'Example figure.png'), Buffer.from(image.split(',')[1], 'base64'))
  const names = ['Project report.md', 'Figure standard.pdf', 'Reporting guidance.docx', 'Measurements.csv', 'Measurements.xlsx', 'Stored original.bin', 'Example figure.png']
  const paths = names.map(name => join(fixtures, name))
  const tabs = await page.locator('[data-ourgeo-id="zone.tabs.bottom"] [role="tab"]').allTextContents()
  assert.deepEqual(tabs, ['R console', 'Terminal', 'Project Files'])
  assert.equal(await page.getByRole('tab', { name: 'R console', exact: true }).getAttribute('aria-selected'), 'true')
  report.checks.defaultTabs = true
  await action('Project Files')
  await app.evaluate(({ dialog }) => { globalThis.projectFilesPickers = { saves: 0, opens: 0 }; dialog.showSaveDialog = async () => { globalThis.projectFilesPickers.saves++; return { canceled: true } }; dialog.showOpenDialog = async () => { globalThis.projectFilesPickers.opens++; return { canceled: true, filePaths: [] } } })
  await click(page.locator('[data-ourgeo-id="projectFiles.add"]'))
  const saveDeadline = Date.now() + 30_000
  while ((await app.evaluate(() => globalThis.projectFilesPickers.saves)) === 0 && Date.now() < saveDeadline) await new Promise(resolve => setTimeout(resolve, 50))
  await waitForAsync(page, async () => (await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id)).files.length === 0)
  assert.deepEqual(await app.evaluate(() => globalThis.projectFilesPickers), { saves: 1, opens: 0 })
  report.checks.scratchCancelledSaveImportsNothing = true
  await app.evaluate(({ dialog }, { projectPath, paths }) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: projectPath }); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }) }, { projectPath, paths })
  await click(page.locator('[data-ourgeo-id="projectFiles.add"]'))
  await waitForAsync(page, async count => (await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id)).files.length === count, names.length, { timeout: 60_000, retryError: projectScopeTransition })
  await waitForAsync(page, async () => (await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id)).files.every(file => !['queued', 'indexing'].includes(file.status)), undefined, { timeout: 90_000, retryError: projectScopeTransition })
  let catalogue = await library()
  assert(catalogue.projectId && catalogue.files.every(file => !file.saved))
  report.checks.saveFirstImport = true
  await shot('default-library')
  await enlargePane()
  report.checks.resizablePane = true
  report.checks.extractionStatuses = Object.fromEntries(catalogue.files.map(file => [file.name, file.status]))
  const reportFile = catalogue.files.find(file => file.name === 'Project report.md')
  assert(reportFile)
  const deep = await page.evaluate(async () => window.electronAPI.projectFiles.search('PF_DEEP_REQUIREMENT', (await window.electronAPI.context.lease()).id))
  assert(deep.some(hit => hit.id === reportFile.id && hit.excerpt.includes('0.6')))
  report.checks.deepRequirementSearch = true
  await chooseFile(reportFile.id)
  await page.getByRole('textbox', { name: 'File description', exact: true }).fill('Project drainage requirements; retain the freeboard criterion.')
  await page.getByRole('combobox', { name: 'Logical folder', exact: true }).fill('Standards')
  await page.getByRole('combobox', { name: 'File role', exact: true }).selectOption('standard')
  await click(page.getByRole('button', { name: 'Save details', exact: true }))
  await waitForAsync(page, async id => { const file = (await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id)).files.find(file => file.id === id); return file?.folder === 'Standards' && file.role === 'standard' && file.userDescription.includes('freeboard') }, reportFile.id)
  report.checks.editDescriptionRoleAndFolder = true
  await page.getByRole('region', { name: /Details for/ }).evaluate(element => { element.scrollTop = 0 })
  await shot('report-details')
  await click(page.getByRole('button', { name: /Back to project files|Close file details/ }))
  catalogue = await library()
  await chooseFile(catalogue.files.find(file => file.name === 'Measurements.csv').id)
  await page.getByRole('table', { name: 'Measurements.csv preview', exact: true }).waitFor()
  await click(page.getByRole('button', { name: 'B2: 0.6', exact: true }))
  await page.getByText('Type: string', { exact: true }).waitFor()
  assert.equal(await page.getByRole('combobox', { name: 'Preview worksheet', exact: true }).count(), 0)
  await page.getByRole('table', { name: 'Measurements.csv preview', exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }))
  await shot('csv-grid')
  report.checks.csvStringGridAndCellEvidence = true
  await click(page.getByRole('button', { name: /Back to project files|Close file details/ }))
  const workbookFile = catalogue.files.find(file => file.name === 'Measurements.xlsx')
  await chooseFile(workbookFile.id)
  await page.getByRole('table', { name: 'Measurements.xlsx preview', exact: true }).waitFor()
  assert.equal(await page.getByRole('option', { name: 'Hidden notes', exact: true }).count(), 0)
  await page.getByRole('checkbox', { name: 'Show hidden contents in preview', exact: true }).check()
  await page.getByRole('option', { name: 'Hidden notes', exact: true }).waitFor({ state: 'attached' })
  assert.equal(await page.getByRole('checkbox', { name: 'Include hidden workbook contents for the assistant', exact: true }).isChecked(), false)
  const hiddenHits = await page.evaluate(async () => window.electronAPI.projectFiles.search('PF_HIDDEN_WORKBOOK_CONTENT', (await window.electronAPI.context.lease()).id))
  assert.equal(hiddenHits.length, 0, 'Human preview must not authorise hidden assistant retrieval.')
  report.checks.humanHiddenPreviewDoesNotAuthoriseAssistant = true
  await click(page.getByRole('button', { name: 'B2: 0.6', exact: true }))
  await page.getByText(/Formula: 0.3\+0.3/).waitFor()
  await page.getByRole('table', { name: 'Measurements.xlsx preview', exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }))
  await shot('xlsx-grid')
  report.checks.workbookGridFormulaAndHiddenPolicy = true
  await click(page.getByRole('button', { name: /Back to project files|Close file details/ }))
  const pdfFile = catalogue.files.find(file => file.name === 'Figure standard.pdf')
  await chooseFile(pdfFile.id)
  await page.getByRole('img', { name: 'Figure standard.pdf, page 1', exact: true }).waitFor({ timeout: 45_000 })
  await click(page.getByRole('button', { name: 'Next page', exact: true }))
  await page.getByRole('img', { name: 'Figure standard.pdf, page 2', exact: true }).waitFor({ timeout: 45_000 })
  await page.getByRole('img', { name: 'Figure standard.pdf, page 2', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }))
  report.checks.pdfCanvasPagesAndBundledWorker = true
  await shot('pdf-page-two')
  await click(page.getByRole('button', { name: /Back to project files|Close file details/ }))
  const list = page.getByRole('listbox', { name: 'Project files' })
  await list.focus(); await page.keyboard.press('Home'); await page.keyboard.press('Delete')
  await click(page.getByRole('button', { name: 'Remove from project', exact: true }))
  await waitForAsync(page, async count => (await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id)).files.length === count, names.length - 1)
  await click(page.getByRole('button', { name: 'Undo removal', exact: true }))
  await waitForAsync(page, async count => (await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id)).files.length === count, names.length)
  report.checks.removeAndUndo = true
  await action('Save')
  await waitForAsync(page, async () => { const catalogue = await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id); return catalogue.revision === catalogue.savedRevision && catalogue.files.every(file => file.saved) }, undefined, { timeout: 60_000 })
  const archive = new AdmZip(await readFile(projectPath))
  assert(archive.getEntry('environment.RData'), 'The native fixture must include an R snapshot to verify open-workspace cleanup.')
  const manifest = JSON.parse(archive.readAsText('project.json'))
  report.checks.manifestVersion = manifest.version
  // Archive entry paths are implementation-owned; byte hashes verify originals
  // without guessing display-name-to-storage-path mappings.
  const archived = new Set(archive.getEntries().filter(entry => !entry.isDirectory).map(entry => sha(entry.getData())))
  for (const path of paths) assert(archived.has(sha(await readFile(path))), `Original bytes missing from project: ${path}`)
  report.checks.originalBytesPreserved = true
  await shot('saved-library')
  await close()
  const reopenedData = await launch('fresh-profile')
  await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, projectPath)
  await action('Load…')
  await waitForAsync(page, async count => (await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id)).files.length === count, names.length, { timeout: 90_000, retryError: projectScopeTransition })
  catalogue = await library()
  const restored = catalogue.files.find(file => file.id === reportFile.id)
  assert(restored && restored.saved && restored.role === 'standard' && restored.folder === 'Standards' && restored.userDescription.includes('freeboard'))
  report.checks.freshProfilePortableReopen = true
  await action('Project Files')
  assert(!(await readdir(reopenedData)).some(name => name.startsWith('project-open-')), 'Completed project loads must release extracted R snapshots and temporary originals.')
  report.checks.temporaryOpenSnapshotsReleased = true
  await chooseFile(catalogue.files.find(file => file.name === 'Example figure.png').id)
  await page.getByRole('img', { name: 'Preview of Example figure.png', exact: true }).waitFor()
  await enlargePane()
  await page.setViewportSize({ width: 640, height: 800 })
  await page.getByRole('button', { name: 'Back to project files', exact: true }).waitFor()
  report.checks.narrowDetailsNavigation = true
  await page.getByRole('img', { name: 'Preview of Example figure.png', exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }))
  await shot('fresh-profile-image')
  report.checks.localImagePreview = true
  if (uiMetrics) {
    // The 2,000-file case measures rendering only. It never imports fake
    // originals or claims to benchmark extraction/storage/search throughput.
    report.uiMetrics = await page.evaluate(async () => {
      const files = await import('/store/project-files.ts')
      const layout = await import('/store/layout.ts')
      const model = await import('/lib/layout/model.ts')
      const persistence = await import('/lib/layout-persistence.ts')
      const navigation = await import('/lib/project-files-ui.ts')
      const themes = await import('/lib/themes.ts')
      const themeStore = await import('/store/theme.ts')
      const previousFiles = files.useProjectFilesStore.getState(), previousLayout = layout.useLayoutStore.getState().layout
      const themeId = themeStore.useThemeStore.getState().current
      const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const result = { fixture: '2,000 synthetic metadata entries; no backend originals or indexing', openingMilliseconds: [], themes: [] }
      try {
        files.useProjectFilesStore.getState().select([], undefined, false)
        for (let sample = 0; sample < 5; sample++) {
          layout.useLayoutStore.getState().setActivePanel('console'); await frame()
          const started = performance.now()
          navigation.openProjectFiles(); await frame()
          if (!document.querySelector('[data-ourgeo-id="projectFiles.panel"]')) throw new Error('Project Files did not mount')
          result.openingMilliseconds.push(performance.now() - started)
        }
        const luminance = color => {
          const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number)
          if (!channels || channels.length !== 3) throw new Error(`Cannot measure rendered colour ${color}`)
          const linear = channels.map(value => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
          return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
        }
        const contrast = (first, second) => { const a = luminance(first), b = luminance(second); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
        for (const id of Object.keys(themes.BUILTIN_THEMES)) {
          themes.applyTheme(id); await frame()
          const pane = document.querySelector('[data-ourgeo-id="projectFiles.panel"]')
          const control = document.querySelector('[data-ourgeo-id="projectFiles.search"]')
          const surface = getComputedStyle(pane), input = getComputedStyle(control)
          result.themes.push({ id, paneText: contrast(surface.color, surface.backgroundColor), controlText: contrast(input.color, input.backgroundColor), placeholder: contrast(getComputedStyle(control, '::placeholder').color, input.backgroundColor) })
        }
        themes.applyTheme(themeId)
        const source = previousFiles.catalogue.files[0], now = new Date().toISOString()
        const synthetic = Array.from({ length: 2000 }, (_, index) => ({ ...source, id: `synthetic-ui-${index}`, name: `Synthetic reference ${String(index).padStart(4, '0')}.md`, originalName: 'synthetic.md', folder: '', role: 'reference', userDescription: 'Synthetic metadata fixture only', generatedDescription: '', bytes: 100, status: 'stored', saved: true, importedAt: now, updatedAt: now }))
        const began = performance.now()
        files.useProjectFilesStore.setState({ catalogue: { ...previousFiles.catalogue, files: synthetic }, selected: [], detailsOpen: false, preview: null, filters: files.INITIAL_PROJECT_FILE_FILTERS })
        await frame()
        const list = document.querySelector('[role="listbox"][aria-label="Project files"]')
        if (!list) throw new Error('Synthetic catalogue list is missing')
        result.catalogueRenderMilliseconds = performance.now() - began
        result.syntheticFileCount = files.useProjectFilesStore.getState().catalogue.files.length
        result.renderedRowsAtStart = list.querySelectorAll('[role="option"]').length
        list.scrollTop = list.scrollHeight; list.dispatchEvent(new Event('scroll')); await frame()
        result.renderedRowsAtEnd = list.querySelectorAll('[role="option"]').length
        list.focus()
        list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
        await frame()
        list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true })); await frame()
        result.keyboardSelected = files.useProjectFilesStore.getState().selected.length
        layout.useLayoutStore.getState().movePanel('projectFiles', 'left')
        layout.useLayoutStore.getState().setPanelOpen('projectFiles', false)
        navigation.openProjectFiles(); await frame()
        result.reopenedAtMovedZone = model.zoneOf(layout.useLayoutStore.getState().layout, 'projectFiles') === 'left'
        await layout.flushLayout()
        result.persistedMovedZone = model.zoneOf(await persistence.loadLayout(), 'projectFiles') === 'left'
        layout.useLayoutStore.getState().reset(); await frame()
        const reset = layout.useLayoutStore.getState().layout
        result.resetDefaultTabs = reset.zones.bottom.mode === 'tabs' && reset.zones.bottom.order.join(',') === 'console,terminal,projectFiles' && reset.zones.bottom.active === 'console'
        return result
      } finally {
        themes.applyTheme(themeId)
        files.useProjectFilesStore.setState(previousFiles)
        layout.useLayoutStore.getState().transform(() => previousLayout)
        await layout.flushLayout()
      }
    })
    assert(report.uiMetrics.openingMilliseconds.every(value => value < 300), 'Warm pane opening exceeded the 300 ms acceptance target; inspect the measured samples.')
    assert(report.uiMetrics.themes.every(theme => Math.min(theme.paneText, theme.controlText, theme.placeholder) >= 4.5), 'A rendered theme failed 4.5:1 text contrast; inspect measured theme ratios.')
    assert.equal(report.uiMetrics.syntheticFileCount, 2000)
    assert(report.uiMetrics.renderedRowsAtStart < 100 && report.uiMetrics.renderedRowsAtEnd < 100, 'The virtual list mounted an unbounded number of rows.')
    assert.equal(report.uiMetrics.keyboardSelected, 2)
    assert(report.uiMetrics.reopenedAtMovedZone && report.uiMetrics.persistedMovedZone && report.uiMetrics.resetDefaultTabs)
    report.checks.syntheticVirtualisationKeyboardThemesAndLayout = true
  }
  report.rendererErrors = errors
  assert.equal(errors.length, 0, `Renderer errors: ${errors.join('; ')}`)
  report.passed = true
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error)
  if (page && !page.isClosed()) { await writeFile(join(directory, 'failure.txt'), await page.locator('body').innerText()); await shot('failure').catch(() => undefined) }
  throw error
} finally {
  await close()
  await devServer?.close()
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
  await writeFile(join(output, 'latest.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
