/* global window, document */
// Native Linux acceptance uses disposable folders and marked application data.
// External originals deliberately remain accessible during the fresh-profile
// check: a portable catalogue must not confer filesystem authority by itself.
import { _electron as electron } from 'playwright-core'
import electronExecutable from 'electron'
import { mkdir, mkdtemp, writeFile, readFile, chmod, realpath, open, stat, copyFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import { jsPDF } from 'jspdf'
import { waitForAsync } from './lib/wait-async.mjs'

const root = resolve(import.meta.dirname, '..'), output = join(root, '.cache/linked-project-folders')
await mkdir(output, { recursive: true })
const directory = await mkdtemp(join(output, 'run-')), temporary = join(directory, 'tmp'), source = join(directory, 'External references'), embedded = join(directory, 'Embedded method.md'), projectPath = join(directory, 'Linked references.ourgeoproj')
await mkdir(temporary); await mkdir(join(source, 'Reports'), { recursive: true })
const reportPath = join(source, 'Reports', 'Design report.md')
const initialReport = '# Design report\n' + 'Supporting reference information.\n'.repeat(160) + '\nLINKED_DEEP_REQUIREMENT: retain 0.75 m freeboard.\n'
await writeFile(reportPath, initialReport)
await writeFile(embedded, '# Portable method\nEMBEDDED_REQUIREMENT: preserve source units.\n')
await writeFile(join(source, '.env'), 'PRIVATE_CREDENTIAL_FIXTURE=never-index\n')
await writeFile(join(source, '.ourgeoignore'), 'ignored.txt\n')
await writeFile(join(source, 'ignored.txt'), 'IGNORED_LINKED_CONTENT must not be discoverable.')
const pdf = new jsPDF(); pdf.text('Linked figure requirements: use labelled axes.', 20, 20); pdf.addPage(); pdf.text('LINKED_PDF_REQUIREMENT: retain north arrows.', 20, 20)
await writeFile(join(source, 'Figure requirements.pdf'), Buffer.from(pdf.output('arraybuffer')))
const large = await open(join(source, 'Large observations.bin'), 'wx')
try { await large.truncate(200 * 1024 * 1024) } finally { await large.close() }
const packaged = process.argv.includes('--packaged') ? resolve(process.argv[process.argv.indexOf('--packaged') + 1]) : undefined
const report = { version: 1, measuredAt: new Date().toISOString(), directory, mode: packaged ? 'packaged' : 'built', passed: false, checks: {}, screenshots: [], limitations: ['Native Windows and macOS verification is deferred.', 'Native picker results are deterministic fixtures; operating-system dialog pointer interaction is not certified.'] }
let app, page
const errors = [], click = locator => locator.evaluate(element => element.click())
async function launch(name) {
  const profile = join(directory, name), data = join(profile, 'ourgeo')
  await mkdir(data, { recursive: true, mode: 0o700 }); await chmod(data, 0o700)
  await writeFile(join(data, '.context-acceptance'), 'synthetic-context-profile-v1\n', { mode: 0o600 })
  await writeFile(join(data, 'health-check.json'), JSON.stringify({ prompted: true, report: null }))
  const wrapper = join(profile, 'launch.cjs')
  await writeFile(wrapper, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(data)});require(${JSON.stringify(join(root, 'out/main/index.js'))});`)
  app = await electron.launch({ executablePath: packaged ?? electronExecutable, args: ['--no-sandbox', ...(packaged ? [] : [wrapper])], cwd: root, env: { ...process.env, TMPDIR: temporary, XDG_CONFIG_HOME: profile, OURGEO_CONTEXT_TEST_PROFILE: await realpath(data) }, timeout: 60_000 })
  app.process().stderr.on('data', chunk => { void writeFile(join(directory, `${name}-stderr.log`), chunk, { flag: 'a' }) })
  page = app.windows().find(window => !window.url().startsWith('devtools:')) ?? await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForSelector('[data-ourgeo-id="project.dropdown"]', { timeout: 60_000 })
  assert.equal(resolve(await app.evaluate(({ app }) => app.getPath('userData'))), resolve(data))
  await app.evaluate(({ BrowserWindow, session }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ width: 1440, height: 1000 })
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => callback({ cancel: !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(details.url).hostname) }))
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  const later = page.getByRole('button', { name: 'Maybe later', exact: true }); if (await later.count()) await click(later)
  await page.waitForFunction(() => document.querySelector('[data-ourgeo-id="project.dropdown"]')?.title === 'R connected', undefined, { timeout: 60_000 })
}
async function menu(name) {
  await page.waitForFunction(() => !document.querySelector('[data-ourgeo-id="project.dropdown"]')?.disabled, undefined, { timeout: 90_000 })
  await click(page.locator('[data-ourgeo-id="project.dropdown"]')); await click(page.getByRole('button', { name, exact: true }))
}
async function api(method, args = [], leaseAt = args.length) {
  return page.evaluate(async ({ method, args, leaseAt }) => {
    const lease = await window.electronAPI.context.lease(), parameters = [...args]
    parameters.splice(leaseAt, 0, lease.id)
    return window.electronAPI.projectFiles[method](...parameters)
  }, { method, args, leaseAt })
}
const catalogue = () => api('catalogue')
async function folderCount(count) {
  await waitForAsync(page, async count => (await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id)).linkedFolders?.length === count, count, { timeout: 90_000, retryError: error => /SCOPE_CHANGED/.test(error.message) })
}
async function settled() {
  await waitForAsync(page, async () => {
    const current = await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id)
    return !current.operation && current.files.every(file => !['queued', 'indexing'].includes(file.status))
  }, undefined, { timeout: 90_000, retryError: error => /SCOPE_CHANGED/.test(error.message) })
}
async function load(path) {
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, path)
  await menu('Load…')
  await waitForAsync(page, async () => (await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id)).linkedFolders?.length > 0, undefined, { timeout: 90_000, retryError: error => /SCOPE_CHANGED/.test(error.message) })
  await menu('Project Files')
}
async function close() {
  if (!app) return
  await page.evaluate(() => window.electronAPI.app.confirmQuit()).catch(() => undefined)
  await app.close().catch(() => undefined)
  app = undefined; page = undefined
}
async function shot(name) { const path = join(directory, `${name}.png`); await page.screenshot({ path, animations: 'disabled' }); report.screenshots.push(path) }
try {
  await launch('original-profile')
  await assert.rejects(api('linkFolder', [source], 0), /Save project|saved project|scratch/i)
  report.checks.namedProjectRequired = true
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, projectPath)
  await menu('Save As…'); await menu('Project Files')
  await click(page.locator('[data-ourgeo-id="projectFiles.linkedFolders"]'))
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, source)
  await click(page.locator('[data-ourgeo-id="projectFiles.linkFolder"]'))
  await folderCount(1)
  await settled()
  let current = await catalogue()
  assert.equal(current.linkedFolders.length, 1)
  const folderId = current.linkedFolders[0].id
  await api('renameLinkedFolder', [folderId, 'Engineering references'])
  await settled(); await shot('linked-folder-management')
  await click(page.getByRole('button', { name: 'Close linked folders', exact: true })); await page.getByRole('dialog', { name: 'Linked folders', exact: true }).waitFor({ state: 'hidden' })
  await settled(); current = await catalogue()
  const linked = current.files.filter(file => file.storage?.folderId === folderId)
  assert.equal(linked.length, 3)
  assert(!current.files.some(file => file.name === '.env' || file.name === 'ignored.txt'))
  const document = linked.find(file => file.originalName === 'Design report.md'), imagePdf = linked.find(file => file.mediaType === 'application/pdf'), largeFile = linked.find(file => file.originalName === 'Large observations.bin')
  assert(document && imagePdf && largeFile)
  assert.equal(largeFile.bytes, 200 * 1024 * 1024)
  assert.equal((await api('preview', [largeFile.id, largeFile.revision])).kind, 'stored')
  const hits = await api('search', ['LINKED_DEEP_REQUIREMENT'])
  assert(hits.some(hit => hit.id === document.id && hit.excerpt.includes('0.75')))
  assert((await api('read', [imagePdf.id, imagePdf.revision, { kind: 'pdf', page: 2 }], 2)).text.includes('LINKED_PDF_REQUIREMENT'))
  report.checks.sharedDocumentReadersAndDeepSearch = true
  report.checks.oversizedOriginalRetainedInPlace = true
  report.checks.ignoredAndCredentialFilesOmitted = true
  await api('update', [document.id, document.revision, { userDescription: 'Follow the drainage freeboard requirement.', role: 'standard' }])
  const before = (await catalogue()).files.find(file => file.id === document.id)
  await writeFile(reportPath, initialReport.replace('0.75 m', '0.95 m').replace('LINKED_DEEP_REQUIREMENT', 'LINKED_CHANGED_REQUIREMENT'))
  await assert.rejects(api('read', [before.id, before.revision]), /STALE|changed|rescan|unavailable/i)
  await api('rescanFolders', [[folderId]]); await settled()
  current = await catalogue()
  const updated = current.files.find(file => file.id === document.id)
  assert(updated && updated.revision !== before.revision)
  assert.equal(updated.userDescription, before.userDescription); assert.equal(updated.role, 'standard')
  assert((await api('read', [updated.id, updated.revision, { kind: 'lines', start: 150, end: 170 }], 2)).text.includes('0.95'))
  report.checks.inPlaceChangeRevokesEarlierEvidence = true
  report.checks.rescanPreservesUserMetadata = true
  await click(page.locator('[data-ourgeo-id="projectFiles.linkedFolders"]'))
  await click(page.locator('[data-ourgeo-id="projectFiles.createFolder"]'))
  await page.getByRole('textbox', { name: 'New folder name', exact: true }).fill('New analysis outputs')
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, directory)
  await click(page.locator('[data-ourgeo-id="projectFiles.createFolderConfirm"]'))
  await folderCount(2)
  await settled()
  const created = (await catalogue()).linkedFolders.find(folder => folder.id !== folderId)
  assert(created && (await stat(join(directory, 'New analysis outputs'))).isDirectory())
  const createdCard = page.getByRole('group', { name: `Linked folder ${created.name}`, exact: true })
  await click(createdCard.locator('[data-ourgeo-id="projectFiles.forgetFolder"]'))
  assert.match(await page.getByRole('dialog').last().textContent(), /disk|kept|delete/i)
  await click(page.locator('[data-ourgeo-id="projectFiles.forgetFolderConfirm"]'))
  await folderCount(1)
  await settled()
  assert((await stat(join(directory, 'New analysis outputs'))).isDirectory())
  report.checks.createAndForgetLeavesDirectoryIntact = true
  await click(page.getByRole('button', { name: 'Close linked folders', exact: true })); await page.getByRole('dialog', { name: 'Linked folders', exact: true }).waitFor({ state: 'hidden' })
  await api('add', [[embedded]], 0); await settled()
  await menu('Save')
  await waitForAsync(page, async () => { const current = await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id); return current.revision === current.savedRevision }, undefined, { timeout: 60_000, retryError: error => /SCOPE_CHANGED/.test(error.message) })
  const archive = new AdmZip(await readFile(projectPath)), manifest = JSON.parse(archive.readAsText('project.json')), portable = archive.readAsText('files/catalogue.json')
  assert.equal(manifest.version, 3)
  assert(!portable.includes(source), 'Portable metadata cannot grant an absolute directory path.')
  for (const file of (await catalogue()).files.filter(file => file.storage?.kind === 'linked' && file.sha256)) assert(!archive.getEntry(`files/blobs/${file.sha256}`), 'Linked originals cannot silently become embedded originals.')
  report.checks.portableMetadataWithoutLinkedOriginalsOrPathGrants = true
  await shot('linked-library')
  await close(); await launch('original-profile'); await load(projectPath); await settled()
  assert.equal((await catalogue()).linkedFolders[0].status, 'ready')
  assert((await api('search', ['LINKED_CHANGED_REQUIREMENT'])).some(hit => hit.id === document.id))
  report.checks.localGrantSurvivesReopen = true
  const copied = join(directory, 'Portable copy.ourgeoproj'); await copyFile(projectPath, copied)
  await close(); await launch('fresh-profile'); await load(copied)
  current = await catalogue()
  assert.equal(current.linkedFolders[0].status, 'unlinked')
  const imported = current.files.find(file => file.id === document.id)
  await assert.rejects(api('read', [imported.id, imported.revision]), /relink|linked|unavailable|folder/i)
  assert.equal((await api('search', ['LINKED_CHANGED_REQUIREMENT'])).length, 0)
  report.checks.importedCatalogueDoesNotGrantDiskAccess = true
  await api('relinkFolder', [folderId, source], 1); await settled()
  assert((await api('search', ['LINKED_CHANGED_REQUIREMENT'])).some(hit => hit.id === document.id))
  await shot('relinked-library')
  const originalBytes = await readFile(reportPath)
  await api('forgetFolder', [folderId])
  assert((await readFile(reportPath)).equals(originalBytes))
  assert.equal((await stat(join(source, 'Large observations.bin'))).size, 200 * 1024 * 1024)
  assert(!(await catalogue()).files.some(file => file.storage?.folderId === folderId))
  assert.equal((await api('search', ['LINKED_CHANGED_REQUIREMENT'])).length, 0)
  report.checks.forgetRevokesAccessWithoutDeletingFiles = true
  await shot('forgotten-folder')
  report.rendererErrors = errors
  assert.deepEqual(errors, [])
  report.passed = true
} catch (error) {
  report.failure = error.stack || String(error)
  if (page) await shot('failure').catch(() => undefined)
  throw error
} finally {
  await close()
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2)); await writeFile(join(output, 'latest.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
