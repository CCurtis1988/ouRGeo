/* global document, window */ // Functions passed to Playwright execute in the renderer.
import { _electron as electron } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readdir, readFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const profile = await mkdtemp(join(tmpdir(), 'ourgeo-context-ui-'))
const userData = join(profile, 'ourgeo')
await mkdir(userData)
// Optional runtime coverage uses separately downloaded, pinned fixture assets.
// The test never downloads packages or installs in the user's actual profile.
let managedRuntimeFixture = false
if (process.platform === 'linux' && process.arch === 'x64') {
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
let app
let page
let freshApp
try {
  app = await electron.launch({ executablePath: join(root, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', root], env: { ...process.env, XDG_CONFIG_HOME: profile }, timeout: 60000 })
  page = await app.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
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
  await page.screenshot({ path: '/tmp/ourgeo-context-conversation.png' })
  await page.locator('[data-ourgeo-id="toolbar.settings"]').evaluate(el => el.click())
  await page.getByText('AI Assistant', { exact: true }).last().evaluate(el => el.closest('button').click())
  await page.getByRole('region', { name: 'Context and memory' }).waitFor()
  await page.getByLabel('Default context effort').selectOption('efficient')
  await page.getByRole('region', { name: 'Memory library' }).getByRole('button', { name: 'Project', exact: true }).click()
  await page.getByText('Save this workspace as a project to keep project memory.', { exact: true }).waitFor()
  await page.getByRole('region', { name: 'Context and memory' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: '/tmp/ourgeo-context-settings.png' })
  const library = page.getByRole('region', { name: 'Memory library' })
  await library.getByRole('button', { name: 'About you', exact: true }).evaluate(el => el.click())
  const statement = 'Prefer metric units for test distances.'
  await library.getByLabel('New memory').fill(statement)
  await library.getByRole('button', { name: 'Remember about you', exact: true }).evaluate(el => el.click())
  await library.getByText(statement, { exact: true }).first().waitFor({ timeout: 10000 })
  assert.equal((await page.evaluate(() => window.electronAPI.context.listGlobal())).length, 1)
  for (const file of await readdir(join(userData, 'context'))) assert(!(await readFile(join(userData, 'context', file))).includes(Buffer.from(statement)))
  // The real settings flow stores a protected host-owned connection and sends
  // only a health request, never a transcript or a memory ingestion request.
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
    await page.screenshot({ path: '/tmp/ourgeo-context-runtime.png' })
    // Cancellation stops staging an update while preserving the original pair.
    await runtimeView.getByRole('button', { name: 'Stage verified runtime', exact: true }).click()
    await page.waitForFunction(async () => (await window.electronAPI.context.runtimeStatus()).state === 'installing')
    await runtimeView.getByRole('button', { name: 'Cancel installation', exact: true }).click()
    await page.waitForFunction(async () => (await window.electronAPI.context.runtimeStatus()).state === 'cancelled')
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
  for (const file of await readdir(join(userData, 'context'))) {
    const bytes = await readFile(join(userData, 'context', file))
    assert(!bytes.includes(Buffer.from('SYNTHETIC_CONNECTION_TOKEN')))
    assert(!bytes.includes(Buffer.from(`${url}/memory`)))
  }
  assert.equal(connectionRequests.length, 0)
  await connections.getByRole('button', { name: 'Test connection', exact: true }).click()
  await connections.getByText('reachable · certification pending', { exact: false }).waitFor()
  assert.deepEqual(connectionRequests, [{ method: 'GET', body: '', authenticated: true }])
  assert.equal(requests.length, 1)
  assert.equal(await connections.getByLabel('Memory connection authentication', { exact: true }).inputValue(), '')
  await connections.scrollIntoViewIfNeeded()
  await page.screenshot({ path: '/tmp/ourgeo-context-connections.png' })
  await connections.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await connections.getByText('Authentication removed.', { exact: false }).waitFor()
  assert.equal((await page.evaluate(() => window.electronAPI.context.connections()))[0].authenticated, false)
  await connections.getByRole('button', { name: 'Remove these settings', exact: true }).click()
  await page.waitForFunction(async () => (await window.electronAPI.context.connections()).length === 0)
  await connections.locator(':scope > summary').click()
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
  // Defaults do not learn from scratch, including suggestions.
  const sourceId = crypto.randomUUID()
  assert.equal(await page.evaluate(({ sourceId }) => window.electronAPI.context.learnGlobal(sourceId, 'I prefer metric units.'), { sourceId }), null)
  await page.getByLabel('Allow preference learning from scratch conversations').check()
  await page.waitForFunction(async () => (await window.electronAPI.context.learningSettings()).scratchLearning)
  const suggestion = await page.evaluate(({ sourceId }) => window.electronAPI.context.learnGlobal(sourceId, 'I prefer metric units.'), { sourceId })
  assert.equal(suggestion.status, 'candidate')
  await library.getByRole('button', { name: 'Conversation', exact: true }).click()
  await library.getByText('Derived working state', { exact: false }).waitFor()
  await library.getByRole('button', { name: 'About you', exact: true }).click()
  // Reopen the app-owned library view to pick up a simulated completed-turn
  // candidate through its ordinary initialisation path (no Zustand mutation).
  await page.reload()
  await page.waitForSelector('[data-ourgeo-id="toolbar.settings"]')
  const secondOnboarding = page.getByRole('button', { name: 'Maybe later', exact: true })
  if (await secondOnboarding.isVisible()) await secondOnboarding.click()
  await page.locator('[data-ourgeo-id="toolbar.settings"]').evaluate(el => el.click())
  await page.getByText('AI Assistant', { exact: true }).last().evaluate(el => el.closest('button').click())
  const recoveredLibrary = page.getByRole('region', { name: 'Memory library' })
  await recoveredLibrary.getByText('I prefer metric units', { exact: true }).waitFor({ timeout: 10000 })
  await recoveredLibrary.getByRole('button', { name: 'Accept suggestion', exact: true }).click()
  // Personal pins commit asynchronously in main. Click once, then wait for
  // the protected transaction instead of assuming a synchronous DOM update.
  await recoveredLibrary.getByLabel('Always apply', { exact: false }).click()
  await page.waitForFunction(async () => (await window.electronAPI.context.listGlobal())[0]?.pinned === true)
  assert.equal(await recoveredLibrary.getByLabel('Always apply', { exact: false }).isChecked(), true)
  const accepted = await page.evaluate(() => window.electronAPI.context.listGlobal())
  assert.equal(accepted[0].status, 'active')
  assert.equal(accepted[0].revision, 3)
  await recoveredLibrary.getByRole('button', { name: 'Forget', exact: true }).click()
  await page.waitForFunction(async () => (await window.electronAPI.context.listGlobal()).length === 0)
  assert.equal(await page.evaluate(({ sourceId }) => window.electronAPI.context.learnGlobal(sourceId, 'I prefer metric units.'), { sourceId }), null)
  await page.screenshot({ path: '/tmp/ourgeo-context-learning.png' })
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
    await page.getByText('AI Assistant', { exact: true }).last().evaluate(el => el.closest('button').click())
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
  let releaseReset
  let resetStarted
  const resetReady = new Promise(resolve => { resetStarted = resolve })
  const holdReset = new Promise(resolve => { releaseReset = resolve })
  await page.route('**/session/reset', async route => { resetStarted(); await holdReset; await route.continue() })
  await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, forkPath)
  await projectAction('Load…')
  await Promise.race([resetReady, new Promise((_, reject) => setTimeout(() => reject(new Error('Project reset did not start')), 15000))])
  // The R transition is deliberately held. A context-free question can answer
  // in the incoming project's chat without leaking scratch or waiting for R.
  await send('Generate 100 rows of dummy data.', 3)
  assert(!JSON.stringify(requests[2]).includes('CTX_PRIVATE_SCRATCH'))
  assert(!JSON.stringify(requests[2]).includes('Retrieved evidence'))
  releaseReset()
  await readyProject('Context copy')
  await page.unroute('**/session/reset')
  const previousQuestions = fork.manifest.ui.chats.chats.find(chat => chat.id === fork.manifest.ui.chats.activeChatId)?.messages.filter(message => message.role === 'user' && message.content === 'Generate 100 rows of dummy data.').length ?? 0
  assert.equal(await page.getByText('Generate 100 rows of dummy data.', { exact: true }).count(), previousQuestions + 1)
  assert.equal(await page.getByTitle('Unsaved changes', { exact: true }).count(), 1)
  const reopenedView = await projectLibrary()
  await reopenedView.getByText(projectDecision, { exact: true }).waitFor()
  assert.equal(await reopenedView.getByText('Discard this unsaved project decision.', { exact: true }).count(), 0)
  await page.screenshot({ path: '/tmp/ourgeo-context-project.png' })
  await page.keyboard.press('Escape')
  const decisionQuery = 'Which EPSG:27700 did we decide to use for this project?'
  await send(decisionQuery, 4)
  assert(JSON.stringify(requests[3]).includes(projectDecision))
  await page.getByText(`Context: ${projectDecision}`, { exact: true }).evaluate(el => el.click())
  await page.getByText(`Context: ${projectDecision}`, { exact: true }).locator('..').locator('details > summary').first().evaluate(el => el.click())
  await page.getByRole('button', { name: 'Exclude from future retrieval', exact: true }).click()
  const excludedId = `memory:${fork.memories[0].id}`
  await page.waitForFunction(async id => {
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
  await page.getByText('Source exclusions (1)', { exact: true }).evaluate(el => el.click())
  await page.getByLabel(`Allow source Memory: ${projectDecision}`, { exact: true }).waitFor()
  await page.screenshot({ path: '/tmp/ourgeo-context-exclusions.png' })
  await page.getByLabel(`Allow source Memory: ${projectDecision}`, { exact: true }).click()
  await page.waitForFunction(async () => (await window.electronAPI.context.exclusions((await window.electronAPI.context.lease()).id)).every(selection => selection.ids.length === 0))
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
    await page.screenshot({ path: '/tmp/ourgeo-context-retention.png' })
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
  await page.getByText('AI Assistant', { exact: true }).last().evaluate(el => el.closest('button').click())
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
  freshApp = await electron.launch({ executablePath: join(root, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', '--password-store=basic', root], env: { ...process.env, XDG_CONFIG_HOME: freshProfile }, timeout: 60000 })
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
  const backend = await freshApp.evaluate(({ safeStorage }) => safeStorage.getSelectedStorageBackend())
  assert.equal(backend, 'basic_text')
  await mkdir(join(freshData, 'context'))
  await writeFile(join(freshData, 'context', 'key'), 'synthetic unreadable protected policy')
  const unavailable = await freshPage.evaluate(async () => {
    try { await window.electronAPI.context.exclusions((await window.electronAPI.context.lease()).id); return false }
    catch (error) { return String(error).includes('Protected storage is unavailable') }
  })
  assert.equal(unavailable, true)
  await freshApp.close()
  freshApp = undefined
  const runtime = await app.evaluate(({ safeStorage }) => ({ encryptedStorage: safeStorage.isEncryptionAvailable(), backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform }))
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ profile, mockRequests: requests.length, simpleRequestCount: 2, auxiliaryContext: false, electronSqliteWorker: runtime, memoryEditsAndTombstone: true, protectedConnectionSetupAndHealthOnly: true, ...(managedRuntimeFixture ? { experimentalRuntimeStagingAndCancellation: true } : {}), suggestionsPinsAndSuppression: true, projectSaveForkAndDiscard: true, responsiveDuringRLoadWithoutScopeLeak: true, scopedPersistentExclusions: true, duplicateProjectFork: true, hostMemoryCommandsWithoutInference: true, relevantUnitPreferencesAndSupersession: true, conversationDerivedDeletionAndEditedRetention: true, freshSourceDiscoveryWithoutKeyring: true, unreadablePolicyFailsClosed: true, screenshots: ['/tmp/ourgeo-context-conversation.png', '/tmp/ourgeo-context-settings.png', '/tmp/ourgeo-context-learning.png', '/tmp/ourgeo-context-project.png', '/tmp/ourgeo-context-exclusions.png', '/tmp/ourgeo-context-retention.png', '/tmp/ourgeo-context-connections.png', ...(managedRuntimeFixture ? ['/tmp/ourgeo-context-runtime.png'] : [])] }))
} catch (error) {
  console.log(JSON.stringify({ requests: requests.length, visible: await page?.locator('body').innerText() }))
  await page?.screenshot({ path: '/tmp/ourgeo-context-ui-failure.png' })
  throw error
} finally {
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
