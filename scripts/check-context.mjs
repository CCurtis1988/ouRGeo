/* global document, window */ // Functions passed to Playwright execute in the renderer.
import { waitForAsync } from './lib/wait-async.mjs'
import { _electron as electron } from 'playwright-core'
import electronExecutable from 'electron'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readdir, readFile, copyFile, symlink, unlink, chmod, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import AdmZip from 'adm-zip'
import { build } from 'esbuild'
import { appImageArchive } from './lib/context-appimage.mjs'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const profile = await mkdtemp(join(tmpdir(), 'ourgeo-context-ui-'))
const screenshot = name => join(tmpdir(), name)
const userData = join(profile, 'ourgeo')
await mkdir(userData, { mode: 0o700 })
const packagedExecutable = process.argv.includes('--packaged') ? resolve(process.argv[process.argv.indexOf('--packaged') + 1]) : undefined
if (packagedExecutable) {
  const archive = packagedExecutable.endsWith('.AppImage') ? await appImageArchive(packagedExecutable) : await readFile(process.platform === 'darwin' ? join(packagedExecutable, '../..', 'Resources/app.asar') : join(packagedExecutable, '..', 'resources/app.asar'))
  assert(archive.includes(Buffer.from('OURGEO_CONTEXT_TEST_PROFILE')), 'Package lacks the synthetic profile guard. Rebuild before launching; no user profile was opened.')
}
// Explicitly set the data directory before importing main. XDG_CONFIG_HOME
// alone does not isolate Windows/macOS, and acceptance must never reach the
// user's actual preferences, memories or project session.
async function launchIsolated(profileRoot, extraArgs = [], unavailableKeyring = false) {
  const wrapper = join(profileRoot, 'launch.cjs'), data = join(profileRoot, 'ourgeo')
  await mkdir(data, { recursive: true, mode: 0o700 })
  await chmod(data, 0o700)
  await writeFile(join(data, '.context-acceptance'), 'synthetic-context-profile-v1\n', { mode: 0o600 })
  await writeFile(wrapper, `const {app,safeStorage}=require('electron');app.setPath('userData',${JSON.stringify(data)});${unavailableKeyring ? 'safeStorage.isEncryptionAvailable=()=>false;' : ''}require(${JSON.stringify(join(root, 'out/main/index.js'))});`)
  const instance = await electron.launch({ executablePath: packagedExecutable ?? electronExecutable, args: ['--no-sandbox', ...(process.argv.includes('--diagnostic-net-log') ? [`--log-net-log=${join(profileRoot, 'chromium-netlog.json')}`, '--net-log-capture-mode=Default'] : []), ...extraArgs, ...(packagedExecutable ? [] : [wrapper])], cwd: root, env: { ...process.env, XDG_CONFIG_HOME: profileRoot, OURGEO_CONTEXT_TEST_PROFILE: await realpath(data), OURGEO_CONTEXT_TEST_NO_KEYRING: unavailableKeyring ? '1' : '0' }, timeout: 60000 })
  assert.equal(resolve(await instance.evaluate(({ app }) => app.getPath('userData'))), resolve(data))
  await instance.evaluate(({ session }) => {
    globalThis.contextAcceptanceNetwork = { loopbackRequests: 0, blockedHosts: [] }
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const host = new URL(details.url).hostname
      if (['127.0.0.1', '[::1]', 'localhost'].includes(host)) { globalThis.contextAcceptanceNetwork.loopbackRequests++; callback({}) }
      else { if (globalThis.contextAcceptanceNetwork.blockedHosts.length < 256) globalThis.contextAcceptanceNetwork.blockedHosts.push(host); callback({ cancel: true }) }
    })
  })
  return instance
}
// Optional runtime coverage uses separately downloaded, pinned fixture assets.
// The test never downloads packages or installs in the user's actual profile.
let managedRuntimeFixture = false
if (!process.argv.includes('--stages-0-2') && process.platform === 'linux' && process.arch === 'x64') {
  const catalogue = join(profile, 'runtime-catalogue.mjs')
  await build({ entryPoints: [join(root, 'electron/main/context/runtime-catalogue.ts')], outfile: catalogue, format: 'esm', platform: 'node' })
  const { MNEMOSYNE_LOCAL_CANDIDATE: candidate } = await import(pathToFileURL(catalogue).href)
  const assets = [{ file: '/tmp/ourgeo-mnemosyne-python.tar.gz', archive: candidate.python.profiles['linux-x64'] },
    { file: '/tmp/ourgeo-mnemosyne-source.tar.gz', archive: candidate.provider.archive }, { file: '/tmp/ourgeo-mnemosyne-pyyaml.tar.gz', archive: candidate.yaml.archive }]
  const available = await Promise.all(assets.map(async asset => { try { await readFile(asset.file); return true } catch { return false } }))
  if (available.every(Boolean)) {
    const downloads = join(userData, 'memory-runtimes', 'downloads')
    await mkdir(downloads, { recursive: true })
    for (const asset of assets) await copyFile(asset.file, join(downloads, `${asset.archive.sha256}.tar.gz`))
    managedRuntimeFixture = true
  }
}
const requests = []
const connectionRequests = []
const server = createServer(async (req, res) => {
  let raw = ''
  for await (const part of req) raw += part
  if (req.url === '/api/chat') {
    const payload = JSON.parse(raw)
    requests.push(payload)
    res.setHeader('Content-Type', 'application/x-ndjson')
    const lastUser = payload.messages.filter(message => message.role === 'user').at(-1)?.content ?? ''
    if (lastUser.includes('Verify packed folder retrieval fixture')) {
      const lastTool = payload.messages.filter(message => message.role === 'tool').at(-1)
      const searched = lastTool ? JSON.parse(lastTool.content) : null
      const call = !lastTool ? { name: 'context_search', arguments: { query: 'Approved note', kinds: ['document'] } }
        : searched.results ? { name: 'context_read', arguments: { ref: searched.results[0]?.ref } } : null
      res.end(JSON.stringify({ message: call ? { content: '', tool_calls: [{ function: call }] } : { content: 'Packed folder evidence verified.' }, done: true, prompt_eval_count: 1000, eval_count: 30 }) + '\n')
      return
    }
    res.end(JSON.stringify({ message: { content: 'Synthetic example: `data.frame(id = seq_len(100), value = rnorm(100))`' }, done: true, prompt_eval_count: 1000, eval_count: 30 }) + '\n')
  } else if (req.url === '/memory/health') {
    connectionRequests.push({ method: req.method, body: raw, authenticated: req.headers.authorization === 'Bearer SYNTHETIC_CONNECTION_TOKEN' })
    res.setHeader('Content-Type', 'application/json'); res.end('{"status":"ok"}')
  } else if (req.url === '/api/tags') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ models: [{ name: 'context-fixture', size: 0 }] })) }
  else { res.setHeader('Content-Type', 'application/json'); res.end('{}') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}`
await writeFile(join(userData, 'ai-preferences.json'), JSON.stringify({ provider: 'ollama', modelByProvider: { ollama: 'context-fixture' }, webAccessEnabled: false, autopilotWarningDismissed: true }))
await writeFile(join(userData, 'api-keys.json'), JSON.stringify({ ollama_url: url, ollama_ctx: '32768' }))
async function settingsPage(target, title) {
  await target.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: 'AI Assistant', exact: true }).click()
  await target.getByRole('tab', { name: title, exact: true }).click()
}

let app
let page
let freshApp
let repairApp
try {
  app = await launchIsolated(profile)
  page = await app.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  page.on('response', async response => {
    if (response.url().includes('/context/schema') && response.status() >= 400) console.log(JSON.stringify({ event: 'synthetic-schema-error', request: response.request().postData(), response: await response.text() }))
  })
  await page.waitForSelector('[data-ourgeo-id="toolbar.ai"]', { timeout: 30000 })
  await page.waitForFunction(() => document.body.innerText.includes('R session ready.'), { timeout: 30000 })
  const onboarding = page.getByRole('button', { name: 'Maybe later', exact: true })
  try { await onboarding.waitFor({ timeout: 10000 }); await onboarding.evaluate(el => el.click()) } catch { /* A profile may already have dismissed onboarding. */ }
  await page.locator('[data-ourgeo-id="toolbar.ai"]').evaluate(el => el.click())
  await page.getByText('context-fixture', { exact: false }).first().waitFor({ timeout: 10000 })
  const input = page.getByPlaceholder('Message… (Enter to send, Shift+Enter for new line)')
  await input.fill('Generate 100 rows of dummy data.')
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Send' && !button.disabled))
  await page.getByRole('button', { name: 'Send', exact: true }).evaluate(el => el.click())
  await page.getByText('Synthetic example:', { exact: false }).first().waitFor({ timeout: 30000 })
  assert.equal(requests.length, 1)
  const payload = requests[0]
  const last = payload.messages.at(-1).content
  assert(last.startsWith('Generate 100 rows of dummy data.'))
  assert(last.includes('Host scope and capability card'))
  assert(!JSON.stringify(payload).includes('Retrieved evidence'))
  assert(payload.tools.some(tool => tool.function.name === 'context_search'))
  await page.getByText('Conversation only', { exact: true }).first().evaluate(el => el.click())
  await page.getByText('Reported usage: 1,000 input; 30 output tokens.', { exact: true }).waitFor()
  await page.screenshot({ path: screenshot('ourgeo-context-conversation.png') })
  await page.locator('[data-ourgeo-id="toolbar.settings"]').evaluate(el => el.click())
  await page.setViewportSize({ width: 1120, height: 900 })
  const categories = page.getByRole('navigation', { name: 'Settings categories' })
  for (const title of await categories.getByRole('button').allTextContents()) {
    await categories.getByRole('button', { name: title, exact: true }).click()
    await page.getByRole('region', { name: `${title} settings`, exact: true }).waitFor()
    assert.equal(await page.getByRole('region', { name: / settings$/ }).count(), 1, 'Only the selected settings category should be exposed.')
    assert.equal(await categories.getByRole('button', { name: title, exact: true }).getAttribute('aria-current'), 'page')
  }
  await settingsPage(page, 'Memory Library')
  await page.getByRole('region', { name: 'Context and memory' }).waitFor()
  await settingsPage(page, 'Learning & context')
  await page.getByLabel('Default context effort').selectOption('efficient')
  await settingsPage(page, 'Storage & recovery')
  await page.getByLabel('Diagnostic evidence retention').selectOption('3')
  await page.waitForFunction(() => document.querySelector('select[aria-label="Diagnostic evidence retention"]')?.value === '3')
  await settingsPage(page, 'Memory Library')
  await page.getByRole('region', { name: 'Memory library' }).getByRole('button', { name: 'Project', exact: true }).click()
  await page.getByText('Save this workspace as a project to keep project memory.', { exact: true }).waitFor()
  await page.getByRole('region', { name: 'Context and memory' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: screenshot('ourgeo-context-settings.png') })
  const library = page.getByRole('region', { name: 'Memory library' })
  await library.getByRole('button', { name: 'About you', exact: true }).evaluate(el => el.click())
  await library.getByRole('heading', { name: 'Memory Library', exact: true }).waitFor()
  const statement = 'Prefer metric units for test distances.'
  await library.getByLabel('New memory').fill(statement)
  await library.getByRole('button', { name: 'Remember about you', exact: true }).evaluate(el => el.click())
  await library.getByText(statement, { exact: true }).first().waitFor({ timeout: 10000 })
  assert.equal((await page.evaluate(() => window.electronAPI.context.listGlobal())).length, 1)
  assert.equal(requests.length, 1, 'Creating a memory directly must not invoke the model.')
  await library.getByRole('heading', { name: 'Memory Library', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: screenshot('ourgeo-settings-memory-library.png') })
  await page.setViewportSize({ width: 620, height: 700 })
  await page.getByLabel('Settings category', { exact: true }).selectOption('AI Assistant')
  await library.getByRole('heading', { name: 'Memory Library', exact: true }).waitFor()
  const narrowOverflow = await page.getByRole('dialog', { name: 'Settings', exact: true }).evaluate(dialog => dialog.scrollWidth > dialog.clientWidth)
  assert.equal(narrowOverflow, false, 'Settings must fit the narrow application window.')
  await page.getByRole('combobox', { name: 'AI assistant settings', exact: true }).selectOption('privacy')
  await page.getByRole('region', { name: 'Memory library', exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('combobox', { name: 'AI assistant settings', exact: true }).selectOption('library')
  await library.getByRole('heading', { name: 'Memory Library', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: screenshot('ourgeo-settings-memory-narrow.png') })
  await page.setViewportSize({ width: 1120, height: 900 })
  for (const file of await readdir(join(userData, 'context'), { recursive: true, withFileTypes: true })) {
    if (file.isFile()) assert(!(await readFile(join(file.parentPath, file.name))).includes(Buffer.from(statement)))
  }
  await settingsPage(page, 'Budgets')
  const maintenance = page.getByLabel('Memory maintenance budget', { exact: true })
  await maintenance.locator(':scope > summary').click()
  const initialMaintenance = await page.evaluate(() => window.electronAPI.context.maintenanceStatus())
  assert.equal(initialMaintenance.policy.enabled, false)
  assert.equal(initialMaintenance.policy.mode, 'estimated')
  await maintenance.getByLabel('Daily memory maintenance estimate in USD', { exact: true }).fill('1')
  await maintenance.getByLabel('Monthly memory maintenance estimate in USD', { exact: true }).fill('5')
  await maintenance.getByLabel('Allow budgeted paid memory maintenance', { exact: true }).check()
  await maintenance.getByRole('button', { name: 'Save maintenance budget', exact: true }).click()
  await maintenance.getByText('Maintenance budget saved.', { exact: false }).waitFor()
  const savedMaintenance = await page.evaluate(() => window.electronAPI.context.maintenanceStatus())
  assert.equal(savedMaintenance.policy.dailyMicros, 1000000)
  assert.equal(savedMaintenance.policy.monthlyMicros, 5000000)
  assert.equal(savedMaintenance.policy.enabled, true)
  assert.equal(savedMaintenance.summary.unresolvedOperations, 0)
  const hardCapRefused = await page.evaluate(async () => {
    const current = await window.electronAPI.context.maintenanceStatus(), lease = await window.electronAPI.context.lease()
    try { await window.electronAPI.context.configureMaintenance({ ...current.policy, mode: 'hard', revision: current.policy.revision + 1 }, lease.id); return false }
    catch { return true }
  })
  assert.equal(hardCapRefused, true)
  await page.setViewportSize({ width: 1120, height: 900 })
  await maintenance.scrollIntoViewIfNeeded()
  await page.screenshot({ path: screenshot('ourgeo-context-maintenance.png') })
  await maintenance.getByLabel('Allow budgeted paid memory maintenance', { exact: true }).uncheck()
  await maintenance.getByRole('button', { name: 'Save maintenance budget', exact: true }).click()
  await waitForAsync(page, async () => !(await window.electronAPI.context.maintenanceStatus()).policy.enabled)
  await maintenance.locator(':scope > summary').click()
  // The real settings flow stores a protected host-owned connection and sends
  // only a health request, never a transcript or a memory ingestion request.
  await settingsPage(page, 'Advanced')
  const connections = page.getByLabel('Memory provider connections', { exact: true })
  await connections.locator(':scope > summary').click()
  const runtimeView = page.getByLabel('Managed memory runtime', { exact: true })
  await runtimeView.locator(':scope > summary').click()
  await runtimeView.getByText('Mnemosyne on this device · 4.0.0b4 · not-installed', { exact: true }).waitFor()
  assert.equal(await runtimeView.getByRole('button', { name: 'Stage verified runtime', exact: true }).isDisabled(), true)
  if (managedRuntimeFixture) {
    await runtimeView.getByLabel('Acknowledge experimental native memory runtime', { exact: true }).check()
    await runtimeView.getByRole('button', { name: 'Stage verified runtime', exact: true }).click()
    await runtimeView.getByText('Mnemosyne on this device · 4.0.0b4 · ready-for-certification', { exact: true }).waitFor({ timeout: 90000 })
    const runtime = await page.evaluate(() => window.electronAPI.context.runtimeStatus())
    assert.equal(runtime.certification, 'pending')
    assert.equal(runtime.state, 'ready-for-certification')
    const activePath = join(userData, 'memory-runtimes', 'active.json')
    const installed = JSON.parse(await readFile(activePath, 'utf8'))
    assert.equal(installed.artifacts.length, 3)
    assert.equal(installed.state, 'ready-for-certification')
    assert.equal((await readdir(join(userData, 'memory-runtimes', installed.folder))).some(name => name.startsWith('.health-')), false)
    await runtimeView.scrollIntoViewIfNeeded()
    await page.screenshot({ path: screenshot('ourgeo-context-runtime.png') })
    // Only this isolated test profile accepts the native activation review.
    // The first review is cancelled, proving staging grants no personal access.
    await app.evaluate(({ dialog }) => {
      globalThis.__contextOriginalDialog = dialog.showMessageBox
      dialog.showMessageBox = async options => options.title === 'Activate memory processing' ? { response: 0, checkboxChecked: false } : globalThis.__contextOriginalDialog(options)
    })
    await runtimeView.getByRole('button', { name: 'Review activation for About you', exact: true }).click()
    await waitForAsync(page, async () => (await window.electronAPI.context.activationStatus()).some(item => item.state === 'ready'))
    assert(!(await page.evaluate(() => window.electronAPI.context.activationStatus())).some(item => item.state === 'active'))
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async options => ['Activate memory processing', 'Import selected memories'].includes(options.title) ? { response: 1, checkboxChecked: false } : globalThis.__contextOriginalDialog(options) })
    await runtimeView.getByRole('button', { name: 'Review activation for About you', exact: true }).click()
    await waitForAsync(page, async () => { try { return (await window.electronAPI.context.activationStatus()).some(item => item.state === 'active') } catch { return false } })
    await page.getByRole('button', { name: 'Pause memory updates', exact: true }).waitFor({ state: 'attached' })
    assert.equal((await page.evaluate(() => window.electronAPI.context.maintenanceStatus())).policy.enabled, false)
    const existing = await page.evaluate(() => window.electronAPI.context.listGlobal())
    const syntheticId = crypto.randomUUID(), now = new Date().toISOString()
    await page.evaluate(record => window.electronAPI.context.saveGlobal(record), { id: syntheticId, revision: 1, scope: 'global', projectId: null, category: 'preference', statement: 'SYNTHETIC_MANAGED_ACTIVATION_METRIC', evidence: [], assertion: 'user-declared', createdAt: now, updatedAt: now, status: 'active', supersedes: [] })
    const derived = join(userData, 'memory-runtimes', installed.folder, 'derived')
    let database
    const dispatchDeadline = Date.now() + 20000
    while (true) {
      try {
        database = (await readdir(derived)).find(name => name.endsWith('.sqlite'))
        if (database && (await readFile(join(derived, database))).includes(Buffer.from(syntheticId))) break
      } catch { /* Wait for this fixture's lazy runtime and first atomic snapshot. */ }
      if (Date.now() > dispatchDeadline) throw new Error('Managed activation did not deliver the approved synthetic update.')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    for (const record of existing) assert(!(await readFile(join(derived, database))).includes(Buffer.from(record.id)), 'Future-only activation indexed old memory without selection.')
    const managedRecall = await page.evaluate(async () => {
      const lease = await window.electronAPI.context.lease()
      return window.electronAPI.context.recallMemory({ query: 'SYNTHETIC_MANAGED_ACTIVATION_METRIC', scope: 'global' }, crypto.randomUUID(), lease.id)
    })
    assert.equal(managedRecall.status, 'ok')
    assert.equal(managedRecall.coverage, 'provider')
    assert.deepEqual(managedRecall.hits, [{ id: syntheticId, revision: 1, scope: 'global' }])
    assert(!JSON.stringify(managedRecall).includes('SYNTHETIC_MANAGED_ACTIVATION_METRIC'))
    const importView = connections.getByLabel('Import memories to Mnemosyne on this device · experimental', { exact: true })
    await importView.locator(':scope > summary').click()
    await importView.getByRole('checkbox', { name: existing[0].statement, exact: true }).check()
    await importView.getByRole('button', { name: 'Review import of 1 memory', exact: true }).click()
    await importView.getByText('Selected memories queued for import.', { exact: false }).waitFor()
    const importDeadline = Date.now() + 20000
    while (!(await readFile(join(derived, database))).includes(Buffer.from(existing[0].id))) {
      if (Date.now() > importDeadline) throw new Error('The explicitly selected memory was not imported.')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    await page.screenshot({ path: screenshot('ourgeo-context-import.png') })
    const oldPair = join(userData, 'memory-runtimes', `installed_${crypto.randomUUID()}`, 'derived')
    await mkdir(oldPair, { recursive: true, mode: 0o700 })
    await copyFile(join(derived, database), join(oldPair, database))
    // A redirected private directory must be refused. The canonical tombstone
    // still commits and the purge receipt survives until the user repairs it.
    const badPair = join(userData, 'memory-runtimes', `installed_${crypto.randomUUID()}`)
    const badTarget = join(profile, 'synthetic-linked-runtime'); await mkdir(badTarget)
    await symlink(badTarget, badPair)
    const forgetReceipt = await page.evaluate(id => window.electronAPI.context.forget(id, { scope: 'global', projectId: null, sources: [] }), syntheticId)
    assert.equal(forgetReceipt.local, 'excluded'); assert.equal(forgetReceipt.managed, 'pending')
    assert(!(await page.evaluate(() => window.electronAPI.context.listGlobal())).some(record => record.id === syntheticId))
    await settingsPage(page, 'Storage & recovery')
    const cleanup = page.getByLabel('Local memory cleanup', { exact: true })
    await cleanup.locator(':scope > summary').click()
    await cleanup.getByRole('button', { name: 'Refresh cleanup status', exact: true }).click()
    await cleanup.getByText('Awaiting retry: 1 · Needs attention: 0.', { exact: true }).waitFor()
    await cleanup.scrollIntoViewIfNeeded()
    await page.screenshot({ path: screenshot('ourgeo-context-cleanup.png') })
    await unlink(badPair)
    await cleanup.getByRole('button', { name: 'Retry local cleanup', exact: true }).click()
    await cleanup.getByText('Awaiting retry: 0 · Needs attention: 0.', { exact: true }).waitFor()
    await cleanup.locator(':scope > summary').click()
    const deletionDeadline = Date.now() + 20000
    const currentBytes = async () => { try { return await readFile(join(derived, database)) } catch (error) { if (error.code === 'ENOENT') return Buffer.alloc(0); throw error } }
    while ((await currentBytes()).includes(Buffer.from(syntheticId)) || (await readdir(oldPair)).length) {
      if (Date.now() > deletionDeadline) throw new Error('Managed deletion left an active/rollback derived copy.')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    await settingsPage(page, 'Advanced')
    await connections.getByRole('button', { name: 'Pause memory updates', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: screenshot('ourgeo-context-activation.png') })
    const canonicalBeforeMigration = await page.evaluate(() => window.electronAPI.context.listGlobal())
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async options => options.title === 'Migrate memory provider' ? { response: 0, checkboxChecked: false } : globalThis.__contextOriginalDialog(options) })
    await connections.getByRole('button', { name: 'Use built-in memory instead', exact: true }).click()
    await waitForAsync(page, async () => (await window.electronAPI.context.memoryMigrations()).length === 0)
    assert((await page.evaluate(() => window.electronAPI.context.activationStatus())).some(item => item.state === 'active'))
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async options => options.title === 'Migrate memory provider' ? { response: 1, checkboxChecked: false } : globalThis.__contextOriginalDialog(options) })
    await connections.getByRole('button', { name: 'Use built-in memory instead', exact: true }).click()
    const migrations = page.locator('[data-ourgeo-id="context.providerMigrations"]')
    await migrations.getByRole('button', { name: 'Keep old-provider copies', exact: true }).waitFor()
    await page.screenshot({ path: screenshot('ourgeo-context-migration.png') })
    await migrations.getByRole('button', { name: 'Keep old-provider copies', exact: true }).click()
    await waitForAsync(page, async () => (await window.electronAPI.context.memoryMigrations()).some(item => item.state === 'retained'))
    assert.deepEqual(await page.evaluate(() => window.electronAPI.context.listGlobal()), canonicalBeforeMigration)
    await connections.getByText('Memory updates: paused', { exact: true }).waitFor()
    assert.equal((await page.evaluate(async () => {
      const lease = await window.electronAPI.context.lease()
      return window.electronAPI.context.recallMemory({ query: 'metric', scope: 'global' }, crypto.randomUUID(), lease.id)
    })).status, 'unavailable')
    await connections.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await connections.getByRole('button', { name: 'Remove these settings', exact: true }).click()
    await waitForAsync(page, async () => !(await window.electronAPI.context.connections()).some(item => item.location === 'managed-local'))
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = globalThis.__contextOriginalDialog; delete globalThis.__contextOriginalDialog })
    // Cancellation stops staging an update while preserving the original pair.
    await runtimeView.getByRole('button', { name: 'Stage verified runtime', exact: true }).click()
    await waitForAsync(page, async () => (await window.electronAPI.context.runtimeStatus()).state === 'installing')
    await runtimeView.getByRole('button', { name: 'Cancel installation', exact: true }).click()
    await waitForAsync(page, async () => (await window.electronAPI.context.runtimeStatus()).state === 'cancelled')
    await runtimeView.getByRole('button', { name: 'Stage verified runtime', exact: true }).waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Stage verified runtime' && !button.disabled))
    assert.deepEqual(JSON.parse(await readFile(activePath, 'utf8')), installed)
    assert.equal(requests.length, 1)
  }
  await runtimeView.locator(':scope > summary').click()
  await connections.getByLabel('Memory connection label', { exact: true }).fill('Synthetic loopback memory')
  await connections.getByLabel('Memory connection endpoint', { exact: true }).fill(`${url}/memory`)
  await connections.getByLabel('Memory connection location', { exact: true }).selectOption('loopback')
  await connections.getByLabel('Memory connection authentication', { exact: true }).fill('SYNTHETIC_CONNECTION_TOKEN')
  await connections.getByRole('button', { name: 'Save connection settings', exact: true }).click()
  await connections.getByText('configured · certification pending', { exact: false }).waitFor()
  const storedConnections = await page.evaluate(() => window.electronAPI.context.connections())
  assert.equal(storedConnections.length, 1)
  assert.equal(storedConnections[0].authenticated, true)
  assert.equal(storedConnections[0].certification, 'pending')
  assert(!Object.hasOwn(storedConnections[0], 'credentialRef'))
  assert(!Object.hasOwn(storedConnections[0], 'namespaceRef'))
  // Runtime activation now creates encrypted migration-backup directories.
  // Inspect their files too, rather than assuming the canonical root is flat.
  for (const file of await readdir(join(userData, 'context'), { recursive: true, withFileTypes: true })) {
    if (!file.isFile()) continue
    const bytes = await readFile(join(file.parentPath, file.name))
    assert(!bytes.includes(Buffer.from('SYNTHETIC_CONNECTION_TOKEN')))
    assert(!bytes.includes(Buffer.from(`${url}/memory`)))
  }
  assert.equal(connectionRequests.length, 0)
  await connections.getByRole('button', { name: 'Test connection', exact: true }).click()
  await connections.getByText('reachable · certification pending', { exact: false }).waitFor()
  assert((await page.evaluate(() => window.electronAPI.context.activationStatus())).every(item => item.state === 'review-required'))
  assert.equal(await connections.getByRole('button', { name: 'Review activation of future memory updates', exact: true }).count(), 0)
  assert.deepEqual(connectionRequests, [{ method: 'GET', body: '', authenticated: true }])
  assert.equal(requests.length, 1)
  assert.equal(await connections.getByLabel('Memory connection authentication', { exact: true }).inputValue(), '')
  await connections.scrollIntoViewIfNeeded()
  await page.screenshot({ path: screenshot('ourgeo-context-connections.png') })
  await connections.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await connections.getByText('Authentication removed.', { exact: false }).waitFor()
  assert.equal((await page.evaluate(() => window.electronAPI.context.connections()))[0].authenticated, false)
  await connections.getByRole('button', { name: 'Remove these settings', exact: true }).click()
  await waitForAsync(page, async () => (await window.electronAPI.context.connections()).length === 0)
  await connections.locator(':scope > summary').click()
  await settingsPage(page, 'Memory Library')
  await library.getByRole('button', { name: 'Edit', exact: true }).evaluate(el => el.click())
  await library.getByLabel('Edit memory').fill('Prefer metres for test distances.')
  await library.getByRole('button', { name: 'Save correction', exact: true }).evaluate(el => el.click())
  await library.getByText('Prefer metres for test distances.', { exact: true }).first().waitFor()
  const records = await page.evaluate(() => window.electronAPI.context.listGlobal())
  assert.equal(records[0].revision, 2)
  assert(Number.isFinite(Date.parse(records[0].editedAt)))
  await library.getByRole('button', { name: 'Forget', exact: true }).evaluate(el => el.click())
  await library.getByText('Forgotten from future retrieval.', { exact: false }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.electronAPI.context.listGlobal()), [])
  assert.deepEqual(await page.evaluate(id => window.electronAPI.context.filterDeleted([id]), records[0].id), [])
  if (managedRuntimeFixture) {
    for (const folder of (await readdir(join(userData, 'memory-runtimes'))).filter(folder => folder.startsWith('installed_'))) {
      const files = await readdir(join(userData, 'memory-runtimes', folder, 'derived')).catch(() => [])
      assert(!files.some(file => file.endsWith('.sqlite')), 'Forgetting after disconnect/removal retained a managed derived index.')
    }
  }
  // Defaults do not learn from scratch, including suggestions.
  const sourceId = crypto.randomUUID()
  assert.equal(await page.evaluate(({ sourceId }) => window.electronAPI.context.learnGlobal(sourceId, 'I prefer metric units.'), { sourceId }), null)
  await settingsPage(page, 'Learning & context')
  await page.getByRole('switch', { name: 'Allow preference learning from scratch conversations', exact: true }).click()
  await waitForAsync(page, async () => (await window.electronAPI.context.learningSettings()).scratchLearning)
  const suggestion = await page.evaluate(({ sourceId }) => window.electronAPI.context.learnGlobal(sourceId, 'I prefer metric units.'), { sourceId })
  assert.equal(suggestion.status, 'candidate')
  await settingsPage(page, 'Memory Library')
  await library.getByRole('button', { name: 'Conversation', exact: true }).click()
  await library.getByText('Current conversation:', { exact: false }).waitFor()
  await library.getByText('Other working context from original messages', { exact: true }).click()
  await library.getByText('Derived working state', { exact: false }).waitFor()
  await library.getByRole('button', { name: 'About you', exact: true }).click()
  // Reopen the app-owned library view to pick up a simulated completed-turn
  // candidate through its ordinary initialisation path (no Zustand mutation).
  await page.reload()
  await page.waitForSelector('[data-ourgeo-id="toolbar.settings"]')
  const secondOnboarding = page.getByRole('button', { name: 'Maybe later', exact: true })
  if (await secondOnboarding.isVisible()) await secondOnboarding.click()
  await page.locator('[data-ourgeo-id="toolbar.settings"]').evaluate(el => el.click())
  await settingsPage(page, 'Memory Library')
  const recoveredLibrary = page.getByRole('region', { name: 'Memory library' })
  await recoveredLibrary.getByText('I prefer metric units', { exact: true }).waitFor({ timeout: 10000 })
  await recoveredLibrary.getByRole('button', { name: 'Accept suggestion', exact: true }).click()
  // Personal pins commit asynchronously in main. Click once, then wait for
  // the protected transaction instead of assuming a synchronous DOM update.
  await recoveredLibrary.getByLabel('Always apply', { exact: false }).click()
  await waitForAsync(page, async () => (await window.electronAPI.context.listGlobal())[0]?.pinned === true)
  assert.equal(await recoveredLibrary.getByLabel('Always apply', { exact: false }).isChecked(), true)
  const accepted = await page.evaluate(() => window.electronAPI.context.listGlobal())
  assert.equal(accepted[0].status, 'active')
  assert.equal(accepted[0].revision, 3)
  await recoveredLibrary.getByRole('button', { name: 'Forget', exact: true }).click()
  await waitForAsync(page, async () => (await window.electronAPI.context.listGlobal()).length === 0)
  assert.equal(await page.evaluate(({ sourceId }) => window.electronAPI.context.learnGlobal(sourceId, 'I prefer metric units.'), { sourceId }), null)
  await page.screenshot({ path: screenshot('ourgeo-context-learning.png') })
  // Exercise save/fork/discard through the real UI. Native pickers are supplied
  // deterministic paths inside this isolated profile; no user bundle is opened.
  const originalPath = join(profile, 'Context original.ourgeoproj')
  const forkPath = join(profile, 'Context copy.ourgeoproj')
  const projectAction = async (name, destination) => {
    await page.keyboard.press('Escape')
    if (destination) await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, destination)
    await page.locator('[data-ourgeo-id="project.dropdown"]').click()
    await page.getByRole('button', { name, exact: true }).click()
  }
  const readyProject = async name => {
    await page.waitForFunction(name => {
      const button = document.querySelector('[data-ourgeo-id="project.dropdown"]')
      return button?.innerText.includes(name) && !button.disabled
    }, name, { timeout: 30000 })
  }
  const projectLibrary = async () => {
    await page.locator('[data-ourgeo-id="toolbar.settings"]').click()
    await settingsPage(page, 'Memory Library')
    const view = page.getByRole('region', { name: 'Memory library' })
    await view.getByRole('button', { name: 'Project', exact: true }).click()
    return view
  }
  const bundle = async path => {
    const zip = new AdmZip(await readFile(path))
    return { manifest: JSON.parse(zip.readAsText('project.json')), memories: zip.readAsText('context/project-memory.jsonl').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) }
  }
  await projectAction('Save As…', originalPath)
  await readyProject('Context original')
  const projectView = await projectLibrary()
  const projectDecision = 'Use EPSG:27700 for this synthetic project.'
  await projectView.getByLabel('New memory').fill(projectDecision)
  await projectView.getByRole('button', { name: 'Remember on project save', exact: true }).click()
  await projectView.getByText(projectDecision, { exact: true }).first().waitFor()
  await projectAction('Save')
  await readyProject('Context original')
  const original = await bundle(originalPath)
  assert.equal(original.memories[0].statement, projectDecision)
  assert.equal(original.memories[0].projectId, original.manifest.projectId)
  await projectAction('Save As…', forkPath)
  await readyProject('Context copy')
  const fork = await bundle(forkPath)
  assert.notEqual(fork.manifest.projectId, original.manifest.projectId)
  assert.notEqual(fork.memories[0].id, original.memories[0].id)
  assert.equal(fork.memories[0].lineage, original.memories[0].id)
  const forkView = await projectLibrary()
  await forkView.getByRole('button', { name: 'Edit', exact: true }).click()
  await forkView.getByLabel('Edit memory').fill('Discard this unsaved project decision.')
  await forkView.getByRole('button', { name: 'Save correction', exact: true }).click()
  await forkView.getByText('Discard this unsaved project decision.', { exact: true }).first().waitFor()
  await projectAction('New')
  await page.getByRole('button', { name: "Don't Save", exact: true }).click()
  await readyProject('scratch')
  const send = async (text, expected) => {
    await input.fill(text)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const deadline = Date.now() + 10000
    while (requests.length < expected && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(requests.length, expected)
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' })
  }
  await send('My scratch-only marker is CTX_PRIVATE_SCRATCH.', 2)
  // Local HTTP is now a custom protocol backed by Node, so CDP page.route
  // cannot hold it. Delay the actual main-process request in this private
  // synthetic instance, preserving the same pre-R-transition race.
  await app.evaluate(() => {
    const http = process.getBuiltinModule('node:http'), { Writable } = process.getBuiltinModule('node:stream')
    const original = http.request
    globalThis.contextAcceptanceResetStarted = false
    let release
    const hold = new Promise(resolve => { release = resolve })
    globalThis.contextAcceptanceReleaseReset = () => { http.request = original; release() }
    http.request = function (url, options, response) {
      if (new URL(url).pathname !== '/session/reset') return original.call(this, url, options, response)
      const chunks = []
      const pending = new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk); callback() },
        final(callback) {
          globalThis.contextAcceptanceResetStarted = true
          hold.then(() => {
            const request = original.call(http, url, options, response)
            request.on('error', error => pending.destroy(error))
            request.end(Buffer.concat(chunks)); callback()
          }).catch(callback)
        } })
      return pending
    }
  })
  await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, forkPath)
  await projectAction('Load…')
  const resetDeadline = Date.now() + 15000
  while (!await app.evaluate(() => globalThis.contextAcceptanceResetStarted)) {
    if (Date.now() > resetDeadline) throw new Error('Project reset did not start')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  // The R transition is deliberately held. A context-free question can answer
  // in the incoming project's chat without leaking scratch or waiting for R.
  await send('Generate 100 rows of dummy data.', 3)
  assert(!JSON.stringify(requests[2]).includes('CTX_PRIVATE_SCRATCH'))
  assert(!JSON.stringify(requests[2]).includes('Retrieved evidence'))
  await app.evaluate(() => globalThis.contextAcceptanceReleaseReset())
  await readyProject('Context copy')
  const previousQuestions = fork.manifest.ui.chats.chats.find(chat => chat.id === fork.manifest.ui.chats.activeChatId)?.messages.filter(message => message.role === 'user' && message.content === 'Generate 100 rows of dummy data.').length ?? 0
  assert.equal(await page.getByText('Generate 100 rows of dummy data.', { exact: true }).count(), previousQuestions + 1)
  assert.equal(await page.getByTitle('Unsaved changes', { exact: true }).count(), 1)
  const reopenedView = await projectLibrary()
  await reopenedView.getByText(projectDecision, { exact: true }).waitFor()
  assert.equal(await reopenedView.getByText('Discard this unsaved project decision.', { exact: true }).count(), 0)
  await page.screenshot({ path: screenshot('ourgeo-context-project.png') })
  await page.keyboard.press('Escape')
  const decisionQuery = 'Which EPSG:27700 did we decide to use for this project?'
  await send(decisionQuery, 4)
  assert(JSON.stringify(requests[3]).includes(projectDecision))
  await page.getByText(`Context: ${projectDecision}`, { exact: true }).evaluate(el => el.click())
  await page.getByText(`Context: ${projectDecision}`, { exact: true }).locator('..').locator('details > summary').first().evaluate(el => el.click())
  await page.getByRole('button', { name: 'Exclude from future retrieval', exact: true }).click()
  const excludedId = `memory:${fork.memories[0].id}`
  await waitForAsync(page, async id => {
    const lease = await window.electronAPI.context.lease()
    return (await window.electronAPI.context.exclusions(lease.id)).some(selection => selection.ids.includes(id))
  }, excludedId)
  await send(decisionQuery, 5)
  assert(!JSON.stringify(requests[4]).includes(projectDecision))
  assert(requests[4].messages.every(message => message.role !== 'assistant'))
  await projectAction('New')
  await page.getByRole('button', { name: "Don't Save", exact: true }).click()
  await readyProject('scratch')
  const scratchExclusions = await page.evaluate(async () => window.electronAPI.context.exclusions((await window.electronAPI.context.lease()).id))
  assert(!scratchExclusions.some(selection => selection.ids.includes(excludedId)))
  await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, forkPath)
  await projectAction('Load…')
  await readyProject('Context copy')
  await projectLibrary()
  await settingsPage(page, 'Privacy & sources')
  await page.getByText('Source exclusions (1)', { exact: true }).evaluate(el => el.click())
  await page.getByLabel(`Allow source Memory: ${projectDecision}`, { exact: true }).waitFor()
  await page.screenshot({ path: screenshot('ourgeo-context-exclusions.png') })
  await page.getByLabel(`Allow source Memory: ${projectDecision}`, { exact: true }).click()
  await waitForAsync(page, async () => (await window.electronAPI.context.exclusions((await window.electronAPI.context.lease()).id)).every(selection => selection.ids.length === 0))
  await page.keyboard.press('Escape')
  await send(decisionQuery, 6)
  assert(JSON.stringify(requests[5]).includes(projectDecision))
  await projectAction('Save')
  await readyProject('Context copy')
  const duplicatePath = join(profile, 'Context duplicate.ourgeoproj')
  await copyFile(forkPath, duplicatePath)
  await app.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox.bind(dialog)
    dialog.showMessageBox = async (...args) => {
      const options = args.length === 1 ? args[0] : args[1]
      if (options.title === 'Project identity already exists') return { response: 1, checkboxChecked: false }
      return original(...args)
    }
  })
  await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, duplicatePath)
  await projectAction('Load…')
  await readyProject('Context duplicate')
  const duplicateLease = await page.evaluate(() => window.electronAPI.context.lease())
  assert.notEqual(duplicateLease.projectId, fork.manifest.projectId)
  assert.equal(await page.getByTitle('Unsaved changes', { exact: true }).count(), 1)
  await projectAction('Save')
  await readyProject('Context duplicate')
  const duplicate = await bundle(duplicatePath)
  assert.equal(duplicate.manifest.projectId, duplicateLease.projectId)
  assert.notEqual(duplicate.memories[0].id, fork.memories[0].id)
  assert.equal(duplicate.memories[0].lineage, fork.memories[0].id)
  assert.equal((await bundle(forkPath)).manifest.projectId, fork.manifest.projectId)
  const hostCommand = async (text, receipt) => {
    const count = requests.length
    await input.fill(text)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await page.getByText(receipt, { exact: false }).first().waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' })
    assert.equal(requests.length, count, 'Explicit memory commands must not invoke a model')
  }
  await hostCommand('Remember that I prefer metric units.', 'Remembered in About you: I prefer metric units.')
  const metric = (await page.evaluate(() => window.electronAPI.context.listGlobal())).find(record => record.status === 'active')
  assert(metric)
  await hostCommand('Use miles for this project.', 'Remembered for this project (awaiting project save): Use miles for this project')
  assert.equal(await page.getByTitle('Unsaved changes', { exact: true }).count(), 1)
  await send('Explain the distance buffer units for this layer.', 7)
  const units = JSON.stringify(requests[6])
  assert(units.includes('Retrieved evidence'))
  assert(units.includes('I prefer metric units.'))
  assert(units.includes('Use miles for this project'))
  await hostCommand('Remember that I prefer imperial units.', 'Remembered in About you: I prefer imperial units.')
  const preferences = await page.evaluate(() => window.electronAPI.context.listGlobal())
  assert.equal(preferences.find(record => record.id === metric.id).status, 'superseded')
  assert.deepEqual(preferences.find(record => record.status === 'active').supersedes, [metric.id])
  await hostCommand('Forget my preference for imperial units.', 'Forgotten from future retrieval: I prefer imperial units.')
  assert(!(await page.evaluate(() => window.electronAPI.context.listGlobal())).some(record => record.status === 'active'))
  await projectAction('Save')
  await readyProject('Context duplicate')
  assert((await bundle(duplicatePath)).memories.some(record => record.statement === 'Use miles for this project'))
  const newChat = async () => {
    await page.locator('[data-ourgeo-id="ai.chatSwitcher"]').evaluate(el => el.click())
    await page.getByRole('button', { name: 'New chat', exact: true }).evaluate(el => el.click())
  }
  const deleteNewest = async keep => {
    await page.locator('[data-ourgeo-id="ai.chatSwitcher"]').evaluate(el => el.click())
    await page.getByTitle('Delete this chat', { exact: true }).first().evaluate(el => el.click())
    await page.getByText('memories derived solely from this chat', { exact: false }).waitFor()
    if (keep) await page.getByRole('checkbox', { name: /Keep 1 independently edited or pinned memories/ }).check()
    await page.screenshot({ path: screenshot('ourgeo-context-retention.png') })
    await page.getByRole('button', { name: 'Delete', exact: true }).evaluate(el => el.click())
    await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor({ state: 'hidden' })
    // The list remains open after deleting its row.
    await page.locator('[data-ourgeo-id="ai.chatSwitcher"]').evaluate(el => el.click())
  }
  await newChat()
  await hostCommand('Remember that I prefer concise answers.', 'Remembered in About you: I prefer concise answers.')
  const derived = (await page.evaluate(() => window.electronAPI.context.listGlobal())).find(record => record.statement === 'I prefer concise answers.')
  assert(derived)
  await deleteNewest(false)
  assert(!(await page.evaluate(() => window.electronAPI.context.listGlobal())).some(record => record.id === derived.id))
  assert.deepEqual(await page.evaluate(id => window.electronAPI.context.filterDeleted([id]), derived.id), [])
  assert.deepEqual(await page.evaluate(sources => window.electronAPI.context.filterLearningSources(sources), derived.evidence), [])
  await newChat()
  await hostCommand('Remember that I prefer CSV output.', 'Remembered in About you: I prefer CSV output.')
  await page.locator('[data-ourgeo-id="toolbar.settings"]').evaluate(el => el.click())
  await settingsPage(page, 'Memory Library')
  const retentionLibrary = page.getByRole('region', { name: 'Memory library' })
  await retentionLibrary.getByRole('button', { name: 'About you', exact: true }).click()
  await retentionLibrary.getByText('I prefer CSV output.', { exact: true }).locator('..').getByRole('button', { name: 'Edit', exact: true }).click()
  await retentionLibrary.getByLabel('Edit memory').fill('I prefer CSV outputs for tables.')
  await retentionLibrary.getByRole('button', { name: 'Save correction', exact: true }).click()
  await retentionLibrary.getByText('I prefer CSV outputs for tables.', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await deleteNewest(true)
  assert((await page.evaluate(() => window.electronAPI.context.listGlobal())).some(record => record.statement === 'I prefer CSV outputs for tables.' && record.editedAt))
  // A fresh profile without a protected keyring still discovers reference
  // skills. An existing unreadable policy must never be treated as empty.
  const freshProfile = await mkdtemp(join(tmpdir(), 'ourgeo-context-no-keyring-'))
  const freshData = join(freshProfile, 'ourgeo')
  await mkdir(freshData)
  await writeFile(join(freshData, 'ai-preferences.json'), JSON.stringify({ provider: 'ollama', modelByProvider: { ollama: 'context-fixture' }, webAccessEnabled: false, autopilotWarningDismissed: true }))
  await writeFile(join(freshData, 'api-keys.json'), JSON.stringify({ ollama_url: url, ollama_ctx: '32768' }))
  freshApp = await launchIsolated(freshProfile, ['--password-store=basic'], true)
  const freshPage = await freshApp.firstWindow()
  await freshPage.waitForSelector('[data-ourgeo-id="toolbar.ai"]', { timeout: 30000 })
  await freshPage.waitForFunction(() => document.body.innerText.includes('R session ready.'), { timeout: 30000 })
  const freshOnboarding = freshPage.getByRole('button', { name: 'Maybe later', exact: true })
  if (await freshOnboarding.isVisible()) await freshOnboarding.evaluate(el => el.click())
  await freshPage.locator('[data-ourgeo-id="toolbar.ai"]').evaluate(el => el.click())
  const freshInput = freshPage.getByPlaceholder('Message… (Enter to send, Shift+Enter for new line)')
  await freshInput.fill('Make an ouRGeo theme inspired by autumn.')
  await freshPage.getByRole('button', { name: 'Send', exact: true }).click()
  await freshPage.getByText('Synthetic example:', { exact: false }).first().waitFor({ timeout: 30000 })
  assert.equal(requests.length, 8)
  assert(JSON.stringify(requests[7]).includes('Retrieved evidence'))
  assert(JSON.stringify(requests[7]).includes('theme:'))
  const backend = await freshApp.evaluate(({ safeStorage }) => ({ available: safeStorage.isEncryptionAvailable(), name: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform }))
  assert.equal(backend.available, false)
  if (process.platform === 'linux') assert.equal(backend.name, 'basic_text')
  await mkdir(join(freshData, 'context'))
  await writeFile(join(freshData, 'context', 'key'), 'synthetic unreadable protected policy')
  const unavailable = await freshPage.evaluate(async () => {
    try { await window.electronAPI.context.exclusions((await window.electronAPI.context.lease()).id); return false }
    catch (error) { return String(error).includes('Protected storage is unavailable') }
  })
  assert.equal(unavailable, true)
  await freshApp.close()
  freshApp = undefined
  // Deliberate staging reads no content until send. The selected section must
  // arrive as attributed evidence, while an unrelated section stays local.
  const attachmentPath = join(profile, 'attachment-fixture.md')
  await writeFile(attachmentPath, '# Intro\nUnrelated private fixture text.\n# Method\nSelected reproducible workflow.\n```r\nmean(c(1, 2, 3))\n```\n')
  await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, attachmentPath)
  await page.locator('[data-ourgeo-id="toolbar.openFile"]').evaluate(el => el.click())
  await page.getByRole('button', { name: 'Attach context', exact: true }).click()
  await page.getByRole('button', { name: 'Method (lines 3–8)', exact: true }).click()
  await page.getByText('Staged:', { exact: false }).waitFor()
  assert.equal(requests.length, 8, 'Staging must not call the assistant')
  await page.screenshot({ path: screenshot('ourgeo-context-attachments.png') })
  await input.fill('Explain the attached workflow.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(requests.length, 9)
  const attachedPayload = JSON.stringify(requests[8])
  assert(attachedPayload.includes('Selected reproducible workflow.'))
  assert(!attachedPayload.includes('Unrelated private fixture text.'))
  assert.equal(await page.getByText('Staged:', { exact: false }).count(), 0)
  await page.getByText('Usage totals', { exact: true }).click()
  await page.getByRole('button', { name: 'Load protected usage totals', exact: true }).click()
  await page.getByText('Current conversation · protected local ledger', { exact: true }).waitFor()
  const ledger = await page.evaluate(async () => { const lease = await window.electronAPI.context.lease(); return window.electronAPI.context.inferenceUsageSummary(undefined, lease.id) })
  assert(ledger.receipts > 0 && ledger.reportedInputTokens >= 1000, 'Protected ledger must contain actual reported usage, not just an empty UI label.')
  await page.getByText('Current conversation · available receipts', { exact: true }).waitFor()
  await page.getByText('Optional estimated chat budgets use explicitly reviewed model rates', { exact: false }).last().waitFor()
  const consoleInput = page.getByPlaceholder(/Type R code/)
  await consoleInput.fill('context_privacy_fixture <- data.frame(public_field = 1, fixture_private_column = 2)')
  await consoleInput.press('Enter')
  await page.locator('[data-ourgeo-id="toolbar.settings"]').evaluate(el => el.click())
  await settingsPage(page, 'Memory Library')
  await settingsPage(page, 'Privacy & sources')
  await page.getByText('Workspace column privacy', { exact: true }).click()
  await page.getByRole('button', { name: 'Refresh workspace objects', exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Refresh workspace objects' && !button.disabled))
  await page.getByRole('option', { name: '.GlobalEnv::context_privacy_fixture', exact: true }).waitFor({ state: 'attached' })
  const columnObject = page.getByLabel('Column privacy object')
  const objectId = await columnObject.getByRole('option', { name: '.GlobalEnv::context_privacy_fixture', exact: true }).getAttribute('value')
  await columnObject.selectOption(objectId)
  await page.getByRole('checkbox', { name: 'fixture_private_column', exact: true }).check()
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(button => button.textContent === 'Reload column privacy settings'))
  await page.screenshot({ path: screenshot('ourgeo-context-column-privacy.png') })
  await page.keyboard.press('Escape')
  await input.fill('Describe the schema of context_privacy_fixture without executing R.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(requests.length, 10)
  const filteredPayload = JSON.stringify(requests[9])
  assert(filteredPayload.includes('public_field'))
  assert(!filteredPayload.includes('fixture_private_column'))
  // Saved column privacy survives rereading the protected policy.
  const privacyLease = await page.evaluate(() => window.electronAPI.context.lease())
  const columnPolicy = await page.evaluate(lease => window.electronAPI.context.columnPolicies(lease), privacyLease.id)
  assert(Object.values(columnPolicy.selections).some(columns => columns.includes('fixture_private_column')))
  await page.locator('[data-ourgeo-id="toolbar.settings"]').evaluate(el => el.click())
  await settingsPage(page, 'Memory Library')
  await settingsPage(page, 'Privacy & sources')
  await page.getByText('Workspace column privacy', { exact: true }).click()
  await page.getByRole('button', { name: 'Refresh workspace objects', exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Refresh workspace objects' && !button.disabled))
  await page.getByLabel('Column privacy object').selectOption(objectId)
  await page.getByRole('checkbox', { name: 'fixture_private_column', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: 'fixture_private_column', exact: true }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(button => button.textContent === 'Reload column privacy settings'))
  const folderPath = join(profile, 'context-source-fixture')
  await mkdir(folderPath)
  await writeFile(join(folderPath, 'notes.md'), '# Approved note\nSelected folder evidence.\n')
  await writeFile(join(folderPath, '.env'), 'SECRET_FIXTURE=not-for-indexing')
  await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, folderPath)
  await page.getByRole('button', { name: 'Choose folder…', exact: true }).click()
  await page.getByText('Folder sources updated.', { exact: false }).waitFor()
  let folderCatalogue = await page.evaluate(lease => window.electronAPI.context.folderCatalogue(lease), privacyLease.id)
  assert.equal(folderCatalogue.documents.length, 1)
  assert(!JSON.stringify(folderCatalogue).includes('SECRET_FIXTURE'))
  const file = folderCatalogue.documents[0]
  assert((await page.evaluate(({ id, revision, lease }) => window.electronAPI.context.readContextFile(id, revision, lease), { id: file.id, revision: file.revision, lease: privacyLease.id })).includes('Selected folder evidence.'))
  await page.getByText('Folder sources', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: screenshot('ourgeo-context-folders.png') })
  await writeFile(join(folderPath, 'notes.md'), '# Approved note\nChanged evidence.\n')
  await page.getByText('(refresh required)', { exact: false }).waitFor()
  folderCatalogue = await page.evaluate(lease => window.electronAPI.context.folderCatalogue(lease), privacyLease.id)
  assert.equal(folderCatalogue.documents.length, 0)
  await page.getByRole('button', { name: 'Refresh folder context-source-fixture', exact: true }).click()
  await page.getByText('Folder sources updated.', { exact: false }).waitFor()
  await settingsPage(page, 'Storage & recovery')
  await page.getByText('Memory backups and recovery', { exact: true }).first().click()
  await page.getByRole('button', { name: 'Create encrypted backup', exact: true }).click()
  await page.getByText('Encrypted backup verified.', { exact: false }).waitFor()
  const recovery = await page.evaluate(() => window.electronAPI.context.memoryRecoveryStatus())
  assert.equal(recovery.health.state, 'ready')
  assert(recovery.backups.length)
  await page.getByLabel('Local memory backup').selectOption(recovery.backups[0].id)
  await page.getByRole('button', { name: 'Inspect encrypted backup', exact: true }).click()
  await page.getByText('Backup verified:', { exact: false }).waitFor()
  await page.screenshot({ path: screenshot('ourgeo-context-backups.png') })
  await page.keyboard.press('Escape')
  await page.getByText('Context: .GlobalEnv::context_privacy_fixture', { exact: true }).evaluate(el => el.click())
  await page.getByRole('button', { name: 'Browse current context sources', exact: true }).first().click()
  await page.getByLabel('Search current context sources').first().fill('notes.md')
  await page.getByText('matching descriptions.', { exact: false }).first().waitFor()
  await hostCommand('Remember that I prefer JSON output.', 'Remembered in About you: I prefer JSON output.')
  await page.locator('[data-ourgeo-id="toolbar.settings"]').evaluate(el => el.click())
  await settingsPage(page, 'Memory Library')
  const forgetLibrary = page.getByRole('region', { name: 'Memory library' })
  await forgetLibrary.getByRole('button', { name: 'About you', exact: true }).click()
  const forgetRow = forgetLibrary.getByText('I prefer JSON output.', { exact: true }).first().locator('..')
  await forgetRow.getByRole('button', { name: 'Review transcript copies to forget', exact: true }).click()
  const review = page.getByRole('region', { name: 'Review forgetting memory and transcript copies' })
  await review.waitFor()
  const boxes = review.getByRole('checkbox')
  assert((await boxes.count()) > 0)
  for (let at = 0; at < await boxes.count(); at++) await boxes.nth(at).check()
  await page.screenshot({ path: screenshot('ourgeo-context-forget-copies.png') })
  await review.getByRole('button', { name: /Forget memory and remove \d+ selected messages/ }).click()
  await review.waitFor({ state: 'hidden' })
  assert(!(await page.evaluate(() => window.electronAPI.context.listGlobal())).some(record => record.statement === 'I prefer JSON output.'))
  await page.keyboard.press('Escape')
  assert.equal(await page.getByText('Remember that I prefer JSON output.', { exact: true }).count(), 0)
  // User-reviewed synthetic rates exercise the actual pre-dispatch host gate;
  // no live pricing, external inference or invoice claim is involved.
  await page.locator('[data-ourgeo-id="toolbar.settings"]').evaluate(el => el.click())
  await settingsPage(page, 'Memory Library')
  await settingsPage(page, 'Budgets')
  const chatBudget = page.getByLabel('Estimated chat budget', { exact: true })
  await settingsPage(page, 'Budgets')
  await chatBudget.locator('summary').click()
  await chatBudget.getByLabel('Enforce estimated chat budget', { exact: true }).check()
  await chatBudget.getByLabel('Daily chat estimate in USD').fill('0.000001')
  await chatBudget.getByLabel('Monthly chat estimate in USD').fill('5')
  for (const label of ['Input', 'Output including billed reasoning', 'Cached input', 'Cache write']) await chatBudget.getByLabel(`${label} USD per million tokens`, { exact: true }).fill('1')
  await chatBudget.getByLabel('I checked these model rates', { exact: true }).check()
  await chatBudget.getByRole('button', { name: 'Save chat budget', exact: true }).click()
  await chatBudget.getByText('Estimated chat budget saved.', { exact: false }).waitFor()
  await page.screenshot({ path: screenshot('ourgeo-context-chat-budget.png') })
  await page.keyboard.press('Escape')
  const rejectedStart = requests.length
  await input.fill('Verify estimated budget refusal before dispatch.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByText('BUDGET_LIMIT:', { exact: false }).first().waitFor()
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(requests.length, rejectedStart, 'Budget refusal must not dispatch a model request.')
  await page.locator('[data-ourgeo-id="toolbar.settings"]').evaluate(el => el.click())
  await settingsPage(page, 'Memory Library')
  await settingsPage(page, 'Budgets')
  await chatBudget.locator('summary').click()
  await chatBudget.getByLabel('Daily chat estimate in USD').fill('1')
  await chatBudget.getByRole('button', { name: 'Save chat budget', exact: true }).click()
  await chatBudget.getByText('Estimated chat budget saved.', { exact: false }).waitFor()
  await page.keyboard.press('Escape')
  const folderTurnStart = requests.length
  await input.fill('Verify packed folder retrieval fixture: inspect the Approved note from the authorised folder.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByText('Packed folder evidence verified.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(requests.length, folderTurnStart + 3)
  const folderDelivery = JSON.stringify(requests.at(-1))
  assert(folderDelivery.includes('Changed evidence.'))
  assert(!folderDelivery.includes('SECRET_FIXTURE'))
  await waitForAsync(page, async () => {
    const status = await window.electronAPI.context.chatBudgetStatus()
    return status.summary.dailyMicros === 3090 && status.summary.pendingReceipts === 0
  })
  // Owner items 4–7: ordinary named schema requests and local chat-memory
  // controls must work through the actual renderer, broker and project bundle.
  await input.fill('Describe the schema of context_privacy_fixture without executing R.')
  const unblockedStart = requests.length
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  // Preparing current schema is asynchronous; Stop can still be hidden before
  // dispatch starts. Observe the fixture request before waiting for completion.
  for (let attempt = 0; requests.length === unblockedStart && attempt < 200; attempt++) await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(requests.length, unblockedStart + 1)
  assert(JSON.stringify(requests.at(-1)).includes('fixture_private_column'), 'Unblocked named object schema must reach the assistant.')
  await page.locator('[data-ourgeo-id="toolbar.settings"]').evaluate(el => el.click())
  await settingsPage(page, 'Memory Library')
  const chatLibrary = page.getByRole('region', { name: 'Memory library' })
  await chatLibrary.getByRole('button', { name: 'Conversation', exact: true }).click()
  const chatMemoryStart = requests.length
  await chatLibrary.getByLabel('New memory', { exact: true }).fill('Acceptance chat memory: buffer distance is exactly 100 metres.')
  await chatLibrary.getByRole('button', { name: 'Remember for this conversation', exact: true }).click()
  await chatLibrary.getByText('Memory added to this conversation without running a model.', { exact: true }).waitFor()
  const noteCard = chatLibrary.getByText('Acceptance chat memory: buffer distance is exactly 100 metres.', { exact: true }).locator('..')
  await noteCard.getByRole('button', { name: 'Edit', exact: true }).click()
  await chatLibrary.getByLabel('Edit memory', { exact: true }).fill('Acceptance chat memory: buffer distance is exactly 150 metres.')
  await chatLibrary.getByRole('button', { name: 'Save correction', exact: true }).click()
  await chatLibrary.getByText('Conversation memory corrected. Original messages remain in the chat.', { exact: true }).waitFor()
  assert.equal(requests.length, chatMemoryStart, 'Adding and correcting chat memory must not dispatch a model.')
  await page.screenshot({ path: screenshot('ourgeo-context-chat-memory.png') })
  await page.keyboard.press('Escape')
  await input.fill('Give a synthetic example using the chat buffer distance.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' })
  const chatDelivery = JSON.stringify(requests.at(-1))
  assert(chatDelivery.includes('Acceptance chat memory: buffer distance is exactly 150 metres.'))
  assert(!chatDelivery.includes('Acceptance chat memory: buffer distance is exactly 100 metres.'))
  await projectAction('Save')
  await readyProject('Context duplicate')
  const savedChatBundle = await bundle(duplicatePath)
  assert(savedChatBundle.manifest.ui.chats.chats.some(chat => chat.conversationMemories?.some(note => note.statement === 'Acceptance chat memory: buffer distance is exactly 150 metres.' && note.status === 'active')), 'Conversation memory must be written into its project chat.')
  await page.locator('[data-ourgeo-id="toolbar.settings"]').evaluate(el => el.click())
  await settingsPage(page, 'Memory Library')
  const updatedLibrary = page.getByRole('region', { name: 'Memory library' })
  await updatedLibrary.getByRole('button', { name: 'Conversation', exact: true }).click()
  const updatedNote = updatedLibrary.getByText('Acceptance chat memory: buffer distance is exactly 150 metres.', { exact: true }).locator('..')
  await updatedNote.getByRole('button', { name: 'Move to About you', exact: true }).click()
  await updatedLibrary.getByText('Moved to About you.', { exact: true }).waitFor()
  assert.equal(requests.length, chatMemoryStart + 1, 'Moving chat memory must not run a model.')
  await updatedLibrary.getByRole('button', { name: 'About you', exact: true }).click()
  const movedNote = updatedLibrary.getByText('Acceptance chat memory: buffer distance is exactly 150 metres.', { exact: true }).locator('..')
  await movedNote.getByRole('button', { name: 'Move to conversation', exact: true }).click()
  await updatedLibrary.getByText('Moved to this conversation.', { exact: false }).waitFor()
  await updatedLibrary.getByRole('button', { name: 'Conversation', exact: true }).click()
  await updatedLibrary.getByText('Acceptance chat memory: buffer distance is exactly 150 metres.', { exact: true }).locator('..').getByRole('button', { name: 'Forget', exact: true }).click()
  await updatedLibrary.getByText('Removed from conversation memory.', { exact: false }).waitFor()
  assert.equal(await updatedLibrary.getByText('Acceptance chat memory: buffer distance is exactly 150 metres.', { exact: true }).count(), 0)
  await page.keyboard.press('Escape')
  const chatOnlyInstruction = 'For this chat, never modify source data. Buffer distance is exactly 100 metres; working CRS is EPSG:32610.'
  const chatInstructionStart = requests.length
  await input.fill(chatOnlyInstruction)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(requests.length, chatInstructionStart + 1, 'An ordinary chat-only instruction must receive a model response rather than being intercepted as a durable command.')
  assert(!(await page.evaluate(() => window.electronAPI.context.listGlobal())).some(memory => memory.statement.includes('For this chat')))
  await projectAction('Save')
  await readyProject('Context duplicate')
  assert(!(await bundle(duplicatePath)).memories.some(memory => memory.statement.includes('For this chat')), 'Chat-only instructions must not become project memories.')
  const consoleCommand = async (code, success) => {
    const reply = page.waitForResponse(response => response.url().endsWith('/r/execute'))
    await consoleInput.fill(code); await consoleInput.press('Enter')
    const response = await reply
    assert.equal((await response.json()).success, success)
    await page.getByTitle('Idle', { exact: true }).first().waitFor()
  }
  await consoleCommand('owner_review_parcels <- data.frame(other_id = 1L); owner_review_owners <- data.frame(parcel_id = 1L)', true)
  await consoleCommand('dplyr::left_join(owner_review_parcels, owner_review_owners, by = "parcel_id")', false)
  await page.getByText('Join columns in', { exact: false }).first().waitFor()
  await consoleCommand('owner_review_parcels <- data.frame(parcel_id = 1L)', true)
  await page.locator('[data-ourgeo-id="toolbar.settings"]').evaluate(el => el.click())
  await settingsPage(page, 'Privacy & sources')
  await page.getByText('Workspace column privacy', { exact: true }).click()
  await page.getByRole('button', { name: 'Refresh workspace objects', exact: true }).click()
  await page.getByRole('option', { name: '.GlobalEnv::owner_review_parcels', exact: true }).waitFor({ state: 'attached' })
  await page.keyboard.press('Escape')
  // Efficient intentionally prefetches one source; Balanced allows the failure
  // plus both current schemas, without bypassing the user's retrieval depth.
  await page.getByLabel('Context effort', { exact: true }).selectOption('balanced')
  await send('Explain the parcel_id join failure without changing data.', requests.length + 1)
  const failureDelivery = JSON.stringify(requests.at(-1))
  assert(failureDelivery.includes('Historical console execution'))
  assert(failureDelivery.includes('current schema only'))
  assert(failureDelivery.includes('owner_review_parcels') && failureDelivery.includes('owner_review_owners'))
  const repairProfile = join(profile, 'index-repair-fixture'), repairData = join(repairProfile, 'ourgeo')
  await mkdir(repairData, { recursive: true })
  await writeFile(join(repairData, 'ai-preferences.json'), JSON.stringify({ provider: 'ollama', modelByProvider: { ollama: 'context-fixture' }, autopilotWarningDismissed: true }))
  await writeFile(join(repairData, 'api-keys.json'), JSON.stringify({ ollama_url: url, ollama_ctx: '32768' }))
  const launchRepair = async () => {
    repairApp = await launchIsolated(repairProfile)
    const repairPage = await repairApp.firstWindow()
    await repairPage.waitForSelector('[data-ourgeo-id="toolbar.settings"]')
    await repairPage.waitForFunction(() => document.body.innerText.includes('R session ready.'), { timeout: 30000 })
    return repairPage
  }
  let repairPage = await launchRepair()
  await repairPage.evaluate(async () => {
    const lease = await window.electronAPI.context.lease(), chatId = crypto.randomUUID(), turnId = crypto.randomUUID()
    const authority = await window.electronAPI.context.beginInferenceUsage(chatId, turnId, 'ollama', lease.id, 'context-fixture')
    const input = { chatId, turnId, provider: 'ollama', invocation: 1, attempt: 0, accountingScope: 'invocation', delivery: 'prepared', final: false, estimatedInputTokens: 1000 }
    await window.electronAPI.context.prepareInferenceUsage(input, 1000, authority)
    await window.electronAPI.context.recordInferenceUsage([{ ...input, delivery: 'acknowledged', final: true, reported: { inputTokens: 1000, outputTokens: 30 } }], authority)
    await window.electronAPI.context.endInferenceUsage(authority)
  })
  await repairApp.close(); repairApp = undefined
  const repairPath = join(repairData, 'context/canonical.sqlite'), damaged = new DatabaseSync(repairPath)
  const pageNumber = Number(damaged.prepare('SELECT rootpage FROM sqlite_master WHERE name=?').get('inference_usage_scope').rootpage)
  const pageSize = Number(damaged.prepare('PRAGMA page_size').get().page_size)
  damaged.close()
  const brokenBytes = await readFile(repairPath), base = (pageNumber - 1) * pageSize
  assert.equal(brokenBytes[base], 10); assert.equal(brokenBytes.readUInt16BE(base + 3), 1)
  let repairPayload = base + brokenBytes.readUInt16BE(base + 8)
  while (brokenBytes[repairPayload++] & 128) { /* Skip the single index cell's payload-length varint. */ }
  const key = repairPayload + brokenBytes[repairPayload]
  brokenBytes[key] = brokenBytes[key] === 97 ? 98 : 97
  await writeFile(repairPath, brokenBytes)
  repairPage = await launchRepair()
  await repairPage.evaluate(() => window.electronAPI.context.listGlobal())
  const repairStatus = await repairPage.evaluate(() => window.electronAPI.context.memoryRecoveryStatus())
  assert.equal(repairStatus.health.state, 'ready')
  assert(repairStatus.indexRepair?.preservedFiles >= 1)
  assert.deepEqual(await readFile(join(repairData, 'context/recovery-copies', repairStatus.indexRepair.recoveryId, 'canonical.sqlite')), brokenBytes)
  const repairedUsage = await repairPage.evaluate(async () => { const lease = await window.electronAPI.context.lease(); return window.electronAPI.context.inferenceUsageSummary(undefined, lease.id) })
  assert.equal(repairedUsage.reportedTotalTokens, 1030)
  await repairPage.locator('[data-ourgeo-id="toolbar.settings"]').evaluate(el => el.click())
  await settingsPage(repairPage, 'Storage & recovery')
  await repairPage.getByText('Memory backups and recovery', { exact: true }).first().click()
  await repairPage.getByText('The usage lookup index was repaired', { exact: false }).waitFor()
  await repairPage.getByText('The usage lookup index was repaired', { exact: false }).scrollIntoViewIfNeeded()
  await repairPage.screenshot({ path: screenshot('ourgeo-context-index-repair.png') })
  await repairApp.close(); repairApp = undefined
  const panelRequestCount = requests.length
  await page.getByRole('button', { name: 'Memory Library', exact: true }).click()
  const panelLibrary = page.getByRole('region', { name: 'Memory library', exact: true })
  await panelLibrary.getByRole('button', { name: 'About you', exact: true }).click()
  const panelMemory = 'SYNTHETIC_DIRECT_PANEL_NOTE'
  await panelLibrary.getByLabel('New memory').fill(panelMemory)
  await panelLibrary.getByRole('button', { name: 'Remember about you', exact: true }).click()
  const panelRecord = panelLibrary.locator('p').filter({ hasText: panelMemory })
  await panelRecord.waitFor()
  assert.equal(requests.length, panelRequestCount, 'Direct entry below the conversation must not invoke the model.')
  await page.screenshot({ path: screenshot('ourgeo-settings-panel-memory.png') })
  await panelRecord.locator('..').getByRole('button', { name: 'Forget', exact: true }).click()
  await waitForAsync(page, async statement => !(await window.electronAPI.context.listGlobal()).some(record => record.statement === statement), panelMemory)
  await page.getByRole('button', { name: 'Memory Library', exact: true }).click()
  const nativeApp = await app.evaluate(({ app }) => { const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path'); return { appVersion: app.getVersion(), appPath: app.getAppPath(), filesystemType: process.platform === 'linux' ? fs.statfsSync(path.dirname(app.getAppPath())).type : null } })
  const runtime = await app.evaluate(({ safeStorage }) => ({ encryptedStorage: safeStorage.isEncryptionAvailable(), backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform }))
  const network = await app.evaluate(() => globalThis.contextAcceptanceNetwork)
  assert.deepEqual(network.blockedHosts, [], 'Local memory fixtures must not attempt external Electron HTTP(S) requests.')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ...nativeApp, profile, mockRequests: requests.length, simpleRequestCount: 2, auxiliaryContext: false, electronSqliteWorker: runtime, electronHttpAfterLaunch: { ...network, boundary: 'Electron HTTP(S) layer from attachment through fixture actions; loopback model/health calls allowed. Cold startup and subprocess traffic are not certified.' }, packaged: Boolean(packagedExecutable), settingsCategoryNavigation: true, narrowSettingsLayout: true, directMemoryWithoutInferenceInBothLocations: true, memoryEditsAndTombstone: true, estimatedMaintenanceSettingsWithoutPaidDispatch: true, protectedConnectionSetupAndHealthOnly: true, ...(managedRuntimeFixture ? { experimentalRuntimeStagingAndCancellation: true, managedFutureOnlyActivationAndNativeReview: true, managedDeletionAcrossRuntimePairs: true, managedRecallAndPauseRevocation: true, selectedCommittedMemoryImport: true, disconnectedManagedCacheDeletion: true, durableLocalCleanupFailureAndRepair: true } : {}), suggestionsPinsAndSuppression: true, projectSaveForkAndDiscard: true, responsiveDuringRLoadWithoutScopeLeak: true, scopedPersistentExclusions: true, duplicateProjectFork: true, hostMemoryCommandsWithoutInference: true, relevantUnitPreferencesAndSupersession: true, conversationDerivedDeletionAndEditedRetention: true, stagedDocumentAttachment: true, workspaceColumnPrivacy: true, unbracketedNamedSchemaBlockedAndAllowed: true, localConversationMemoryAddEditMoveForgetSaveAndDelivery: true, chatOnlyInstructionReceivesResponseWithoutDurablePromotion: true, historicalJoinFailurePairedWithCurrentSchemas: true, protectedColumnPolicy: true, authorisedFolderIndexing: true, packedFolderSearchAndRead: true, watcherRevocation: true, verifiedBackupInspection: true, nativeSecondaryIndexDamageAndPreservedRecovery: true, durableInferenceAccounting: true, estimatedChatBudgetPreDispatchAndToolReconciliation: true, currentSourceBrowser: true, reviewedTranscriptForgetting: true, scopedUsageTotals: true, diagnosticRetentionControl: true, freshSourceDiscoveryWithoutKeyring: true, unreadablePolicyFailsClosed: true, screenshots: [screenshot('ourgeo-context-chat-memory.png'), screenshot('ourgeo-settings-memory-library.png'), screenshot('ourgeo-settings-memory-narrow.png'), screenshot('ourgeo-settings-panel-memory.png'), screenshot('ourgeo-context-index-repair.png'), screenshot('ourgeo-context-chat-budget.png'), screenshot('ourgeo-context-forget-copies.png'), screenshot('ourgeo-context-folders.png'), screenshot('ourgeo-context-backups.png'), screenshot('ourgeo-context-column-privacy.png'), screenshot('ourgeo-context-attachments.png'), screenshot('ourgeo-context-conversation.png'), screenshot('ourgeo-context-settings.png'), screenshot('ourgeo-context-learning.png'), screenshot('ourgeo-context-project.png'), screenshot('ourgeo-context-exclusions.png'), screenshot('ourgeo-context-retention.png'), screenshot('ourgeo-context-connections.png'), screenshot('ourgeo-context-maintenance.png'), ...(managedRuntimeFixture ? [screenshot('ourgeo-context-runtime.png'), screenshot('ourgeo-context-activation.png'), screenshot('ourgeo-context-import.png'), screenshot('ourgeo-context-cleanup.png')] : [])] }))
} catch (error) {
  console.error(error)
  console.log(JSON.stringify({ requests: requests.length, visible: await page?.locator('body').innerText() }))
  try { await page?.screenshot({ path: screenshot('ourgeo-context-ui-failure.png'), timeout: 5000 }) } catch { /* Preserve the original failure when native capture is unavailable. */ }
  throw error
} finally {
  if (repairApp) await repairApp.close()
  if (freshApp) await freshApp.close()
  if (app) {
    // Closing a named project invokes the ordinary unsaved-work flow. Resolve
    // this fixture's own dialog rather than leaving Electron/R running after
    // all assertions passed. Never touch an independently running app.
    const closing = app.close()
    try {
      const discard = page.getByRole('button', { name: "Don't Save", exact: true })
      await discard.waitFor({ timeout: 5000 })
      await discard.evaluate(el => el.click())
    } catch { /* Clean fixtures close without a save dialog. */ }
    await closing
  }
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
