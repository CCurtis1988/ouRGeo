/* global window, document, Node, getComputedStyle */
// Native renderer, IPC, source authority, dispatch and usage accounting remain
// production code. Only model HTTP responses and native picker results are fixtures.
import { _electron as electron } from 'playwright-core'
import electronExecutable from 'electron'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, writeFile, readFile, chmod, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import { waitForAsync } from './lib/wait-async.mjs'

const root = resolve(import.meta.dirname, '..'), output = join(root, '.cache/file-analysis-models')
const packaged = process.argv.includes('--packaged') ? resolve(process.argv[process.argv.indexOf('--packaged') + 1]) : undefined
const sharedCatalogue = process.argv.includes('--shared-catalogue')
await mkdir(output, { recursive: true })
const directory = await mkdtemp(join(output, 'run-')), profile = join(directory, 'profile'), data = join(profile, 'ourgeo'), temporary = join(directory, 'tmp')
await mkdir(data, { recursive: true, mode: 0o700 }); await chmod(data, 0o700); await mkdir(temporary)
const projectPath = join(directory, 'Independent analysis.ourgeoproj'), documentPath = join(directory, 'Design criteria.md'), unrelatedPath = join(directory, 'Unrelated private reference.md'), autoPath = join(directory, 'Automatic catalogue description.md'), linkedPath = join(directory, 'Linked references')
await mkdir(linkedPath)
const linkedFile = join(linkedPath, 'Changing linked criteria.md'), imagePath = join(root, 'tests/fixtures/project-files/visual-reference.png')
await writeFile(documentPath, '# Design criteria\nFA_SOURCE_REQUIREMENT: maintain 0.65 m clearance.\n')
await writeFile(unrelatedPath, '# Unrelated reference\nFA_UNRELATED_BODY_MUST_NOT_BE_SENT_TO_ANALYSIS\n')
await writeFile(autoPath, '# Automatic description\nFA_AUTO_SOURCE: drainage inspection guidance.\n')
await writeFile(linkedFile, '# Linked criteria\nFA_LINKED_INITIAL: retain source units.\n')
const report = { version: 1, measuredAt: new Date().toISOString(), directory, mode: packaged ? 'packaged' : 'built', scenario: sharedCatalogue ? 'shared-catalogue' : 'independent-analysis', passed: false, platform: `${process.platform}-${process.arch}`, checks: {}, screenshots: [], limitations: ['Loopback model responses verify real transport, routing, bounded evidence and persistence; they do not qualify real-model comprehension.', 'Native picker results are deterministic. Windows/macOS testing and operating-system picker pointer interaction are deferred.', ...(sharedCatalogue ? ['Existing ChatGPT account status/model lists and Claude installation status are synthetic native IPC fixtures. No external authentication or inference is performed.'] : [])] }
const requests = [], errors = [], sha = value => createHash('sha256').update(value).digest('hex')
let app, page, serverError, imageHash, callSequence = 0
const json = (res, value) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
const stream = (res, content, call) => {
  res.setHeader('Content-Type', 'text/event-stream')
  const delta = call ? { tool_calls: [{ index: 0, id: `fixture-${++callSequence}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } : { content }
  res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\n`)
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 35, total_tokens: 1235 } })}\n\n`)
  res.end('data: [DONE]\n\n')
}
const server = createServer(async (req, res) => {
  try {
    let raw = ''; for await (const part of req) raw += part
    const payload = raw ? JSON.parse(raw) : {}
    if (req.url === '/v1/models') { requests.push({ endpoint: req.url, payload }); return json(res, { data: [{ id: 'assistant-chat' }, { id: 'document-specialist' }, ...(sharedCatalogue ? [{ id: 'document-specialist' }] : [])] }) }
    if (req.url === '/api/tags') return json(res, { models: [{ name: 'vision-specialist' }, { name: 'text-only-model' }] })
    if (req.url === '/api/show') { requests.push({ endpoint: req.url, payload }); return json(res, { capabilities: payload.model === 'vision-specialist' ? ['completion', 'vision'] : ['completion'], model_info: { 'fixture.context_length': 32768 } }) }
    if (!['/v1/chat/completions', '/api/chat'].includes(req.url)) return json(res, {})
    requests.push({ endpoint: req.url, payload })
    if (payload.model === 'document-specialist' || payload.model === 'vision-specialist') {
      assert.equal(payload.messages.length, payload.model === 'vision-specialist' ? 3 : 2, 'Analysis must receive only a system instruction, fresh bounded evidence and any typed image.')
      assert.deepEqual(payload.messages.slice(0, 2).map(item => item.role), ['system', 'user'])
      assert(!payload.tools?.length, 'Analysis must not acquire assistant tools.')
      assert(raw.length < 40_000, 'The analysis request must remain bounded.')
      assert(!raw.includes('FA_UNRELATED_BODY_MUST_NOT_BE_SENT_TO_ANALYSIS'), 'Unselected project bodies must not reach a specialist.')
      const content = payload.messages[1].content
      assert(content.includes('Question:') && content.includes('Reference:') && content.includes('Coverage:'))
      if (payload.model === 'vision-specialist') {
        const images = payload.messages.flatMap(item => item.images ?? [])
        assert.equal(images.length, 1, 'The selected image model must receive actual pixels.')
        assert.equal(sha(Buffer.from(images[0], 'base64')), imageHash)
        assert.equal(payload.options.num_predict, 320)
        res.setHeader('Content-Type', 'application/x-ndjson')
        res.end(JSON.stringify({ message: { role: 'assistant', content: 'FA_VISION_FINDING: the reference contains a blue line and labelled axes.' }, done: true, prompt_eval_count: 1200, eval_count: 35 }) + '\n')
      } else {
        assert.equal(payload.max_tokens, 320)
        assert(!JSON.stringify(payload).includes('data:image/'))
        const automatic = content.includes('Write a concise catalogue description')
        assert(content.includes(automatic ? 'FA_AUTO_SOURCE' : 'FA_SOURCE_REQUIREMENT') || content.includes('FA_LINKED_'))
        stream(res, automatic ? 'FA_AUTO_DESCRIPTION: guidance describing the selected project reference.' : 'FA_DOCUMENT_FINDING: the selected requirement specifies 0.65 m clearance.')
      }
      return
    }
    assert.equal(payload.model, 'assistant-chat', 'The assistant model must remain unchanged.')
    assert(!payload.messages.some(item => Array.isArray(item.content) && item.content.some(part => part.type === 'image_url')), 'The assistant must receive text findings, not specialist pixels.')
    assert(!raw.includes('data:image/'))
    const users = payload.messages.filter(item => item.role === 'user'), task = [...users].reverse().map(item => typeof item.content === 'string' ? item.content.match(/\bFA_(?:DOCUMENT|IMAGE|UNSUPPORTED)\b/)?.[0] : undefined).find(Boolean)
    if (task === 'FA_DOCUMENT') {
      const last = payload.messages.filter(item => item.role === 'tool').at(-1), result = last?.content.startsWith('{') ? JSON.parse(last.content) : undefined
      if (!result) return stream(res, '', { name: 'context_search', arguments: { query: 'FA_SOURCE_REQUIREMENT', kinds: ['document'], group: 'project-files' } })
      if (result.results) { assert(result.results.length); return stream(res, '', { name: 'context_read', arguments: { ref: result.results[0].ref } }) }
      assert.equal(result.status, 'ok'); assert(result.content.includes('FA_SOURCE_REQUIREMENT')); assert(result.analysis.text.includes('FA_DOCUMENT_FINDING')); assert(result.analysis.model.includes('document-specialist')); assert(result.citation.startsWith('ourgeo-project-file:'))
      return stream(res, `FA_DOCUMENT_CONFIRMED: source and independent analysis agree. [Design criteria](${result.citation})`)
    }
    if (task === 'FA_IMAGE') { assert(raw.includes('FA_VISION_FINDING')); return stream(res, 'FA_IMAGE_CONFIRMED: the separate vision model supplied a textual finding.') }
    if (task === 'FA_UNSUPPORTED') { assert(raw.includes('Image not inspected.')); assert(raw.includes('image capability is unknown') || raw.includes('unsupported') || raw.includes('cannot') || raw.includes('not qualified')); return stream(res, 'FA_UNSUPPORTED_CONFIRMED: image inspection is unavailable; no fallback was used.') }
    throw new Error(`Unexpected assistant task ${task}`)
  } catch (error) { serverError = error; res.statusCode = 500; json(res, { error: { message: `Acceptance assertion: ${error.message}` } }) }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
await writeFile(join(data, '.context-acceptance'), 'synthetic-context-profile-v1\n', { mode: 0o600 })
await writeFile(join(data, 'health-check.json'), JSON.stringify({ prompted: true, report: null }))
const chatModels = sharedCatalogue ? { lmstudio: 'saved-custom-chat', 'claude-cli': 'saved-custom-claude', openai: 'shared-model-id', 'openai-subscription': 'shared-model-id' } : { lmstudio: 'assistant-chat' }
await writeFile(join(data, 'ai-preferences.json'), JSON.stringify({ provider: 'lmstudio', modelByProvider: chatModels, webAccessEnabled: false, autopilotWarningDismissed: true }))
const connection = { lmstudio_url: `http://127.0.0.1:${server.address().port}/v1`, lmstudio_ctx: '32768', ollama_url: `http://127.0.0.1:${server.address().port}`, ollama_ctx: '32768', ...(sharedCatalogue ? { openai: 'synthetic-existing-api-key' } : {}) }
await writeFile(join(data, 'api-keys.json'), JSON.stringify(connection))
const click = locator => locator.evaluate(element => element.click())
async function launch() {
  const wrapper = join(profile, 'launch.cjs')
  await writeFile(wrapper, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(data)});require(${JSON.stringify(join(root, 'out/main/index.js'))});`)
  app = await electron.launch({ executablePath: packaged ?? electronExecutable, args: ['--no-sandbox', ...(packaged ? [] : [wrapper])], cwd: root, env: { ...process.env, TMPDIR: temporary, XDG_CONFIG_HOME: profile, OURGEO_CONTEXT_TEST_PROFILE: await realpath(data) }, timeout: 60_000 })
  app.process().stderr.on('data', chunk => { void writeFile(join(directory, 'stderr.log'), chunk, { flag: 'a' }) })
  page = app.windows().find(item => !item.url().startsWith('devtools:')) ?? await app.firstWindow()
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
async function close() { if (app) { await page?.evaluate(() => window.electronAPI.app.confirmQuit()).catch(() => undefined); await app.close().catch(() => undefined); app = undefined; page = undefined } }
async function menu(name) { await page.waitForFunction(() => !document.querySelector('[data-ourgeo-id="project.dropdown"]')?.disabled); await click(page.locator('[data-ourgeo-id="project.dropdown"]')); await click(page.getByRole('button', { name, exact: true })) }
const catalogue = () => page.evaluate(async () => window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id))
async function settled(count) { await waitForAsync(page, async count => { const current = await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id); return (!count || current.files.length === count) && !current.operation && current.files.every(item => !['queued', 'indexing'].includes(item.status)) }, count, { timeout: 90_000, retryError: error => /SCOPE_CHANGED/.test(error.message) }) }
async function settings() { await click(page.locator('[data-ourgeo-id="toolbar.settings"]')); await click(page.getByRole('button', { name: 'AI Assistant', exact: true })); await click(page.getByRole('tab', { name: 'File analysis models', exact: true })); await page.getByLabel('Document analysis model', { exact: true }).waitFor() }
const closeSettings = () => click(page.getByRole('button', { name: 'Close settings', exact: true }))
async function apply(kind, model) {
  const label = kind === 'document' ? 'Document analysis' : 'Image interpretation'
  await page.getByLabel(`${label} model`, { exact: true }).selectOption('separate')
  await page.getByLabel(`${label} provider`, { exact: true }).selectOption(kind === 'document' ? 'lmstudio' : 'ollama')
  await page.getByLabel(`${label} model ID`, { exact: true }).fill(model)
  await click(page.locator(`[data-ourgeo-id="settings.${kind}ModelApply"]`))
}
async function importFiles(paths) { await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }) }, paths); await menu('Project Files'); const back = page.getByRole('button', { name: /Back to project files|Close file details/ }); if (await back.count()) await click(back); await click(page.locator('[data-ourgeo-id="projectFiles.add"]')) }
async function attach(file) {
  await menu('Project Files'); const back = page.getByRole('button', { name: /Back to project files|Close file details/ }); if (await back.count()) await click(back)
  await click(page.getByRole('listbox', { name: 'Project files' }).getByRole('option').filter({ hasText: file.name }))
  const preview = page.getByRole('button', { name: 'Preview / details', exact: true }); if (await preview.count()) await click(preview)
  await click(page.locator('[data-ourgeo-id="projectFiles.attach"]')); await page.getByRole('button', { name: new RegExp(`^Staged: ${file.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).waitFor()
}
async function send(text, marker) { await page.getByPlaceholder('Message… (Enter to send, Shift+Enter for new line)').fill(text); await click(page.getByRole('button', { name: 'Send', exact: true })); await page.getByText(marker, { exact: false }).first().waitFor({ timeout: 90_000 }); await page.getByRole('button', { name: 'Send', exact: true }).waitFor(); if (serverError) throw serverError }
async function shot(name) { const path = join(directory, `${name}.png`); await page.screenshot({ path, animations: 'disabled' }); report.screenshots.push(path) }
async function settingsContrast() {
  return page.evaluate(() => {
    const parse = colour => { const values = colour.match(/[\d.]+/g)?.map(Number) ?? []; return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1] }
    const over = (front, back) => { const alpha = front[3] + back[3] * (1 - front[3]); return [...front.slice(0, 3).map((channel, i) => (channel * front[3] + back[i] * back[3] * (1 - front[3])) / alpha), alpha] }
    const luminance = colour => colour.slice(0, 3).map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0)
    const container = document.querySelector('[data-ourgeo-id="settings.documentModelMode"]').closest('fieldset').parentElement
    return [...container.querySelectorAll('p,legend,span,button')].filter(element => element.getClientRects().length && [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())).map(element => {
      const style = getComputedStyle(element), ancestors = []; for (let current = element; current; current = current.parentElement) ancestors.unshift(current)
      const background = ancestors.reduce((colour, ancestor) => over(parse(getComputedStyle(ancestor).backgroundColor), colour), [255, 255, 255, 1]), foreground = over(parse(style.color), background)
      const a = luminance(foreground), b = luminance(background), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      return { text: element.textContent.trim().slice(0, 120), foreground: style.color, background: background.slice(0, 3).map(Math.round), ratio: Number(ratio.toFixed(2)) }
    })
  })
}
async function waitDescription(name) { await waitForAsync(page, async name => { const file = (await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id)).files.find(item => item.name === name); return file?.aiDescription?.revision === file?.revision && file?.aiDescription?.model === 'document-specialist' }, name, { timeout: 90_000 }); return (await catalogue()).files.find(item => item.name === name) }
async function connectedAccountFixtures() {
  await app.evaluate(({ ipcMain }) => {
    const calls = { status: 0, models: 0, signIn: 0, selectAccount: 0, setCliPath: 0, cliAuthStatus: 0 }
    globalThis.fileAnalysisAccountFixtureCalls = calls
    const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
    replace('chatgpt:status', () => { ++calls.status; return { activeId: 'already-connected-account', signingIn: false, error: null, persistent: true, signedIn: true, planEnabled: true, accounts: [{ id: 'already-connected-account', email: 'existing@example.invalid', signedIn: true, planEnabled: true }] } })
    replace('chatgpt:models', () => { ++calls.models; return [{ id: 'shared-model-id', label: 'Existing plan model' }, { id: 'plan-only-model', label: 'Additional plan model' }, { id: 'shared-model-id', label: 'Existing plan model' }] })
    replace('chatgpt:signIn', () => { ++calls.signIn; throw new Error('Acceptance forbids reconnecting an existing account.') })
    replace('chatgpt:select', () => { ++calls.selectAccount; throw new Error('Acceptance forbids changing the account when selecting an analysis model.') })
    replace('claude:getPath', () => '/fixture/already-installed/claude')
    replace('claude:detect', () => ({ path: '/fixture/already-installed/claude', version: 'fixture-existing-installation' }))
    replace('claude:authStatus', () => { ++calls.cliAuthStatus; return { loggedIn: true, authMethod: 'oauth_token', subscriptionType: 'max', email: 'existing@example.invalid' } })
    replace('claude:setPath', () => { ++calls.setCliPath; throw new Error('Acceptance forbids registering another CLI installation.') })
  })
}
async function checkSharedCatalogue() {
  await connectedAccountFixtures(); await settings()
  await page.getByLabel('Document analysis model', { exact: true }).selectOption('separate')
  const provider = page.getByLabel('Document analysis provider', { exact: true })
  const available = page.getByLabel('Document analysis available models', { exact: true })
  const values = () => available.locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean))
  const waitOption = model => waitForAsync(page, model => [...document.querySelectorAll('select[aria-label="Document analysis available models"] option')].some(option => option.value === model), model, { timeout: 30_000 })
  await provider.selectOption('lmstudio'); await waitOption('saved-custom-chat'); await waitOption('document-specialist')
  assert(requests.some(item => item.endpoint === '/v1/models'), 'Opening the model picker must discover the configured local server without clicking Refresh.')
  const local = await values(); assert.equal(local.filter(model => model === 'document-specialist').length, 1); assert.equal(new Set(local).size, local.length)
  await available.selectOption('saved-custom-chat'); assert.equal(await page.getByLabel('Document analysis model ID', { exact: true }).inputValue(), 'saved-custom-chat')
  await click(page.locator('[data-ourgeo-id="settings.documentModelApply"]'))
  await page.getByText('Saved. Your assistant model and connection are unchanged.', { exact: true }).first().waitFor()
  assert.deepEqual(JSON.parse(await readFile(join(data, 'ai-task-models.json'), 'utf8')).selections.document, { provider: 'lmstudio', model: 'saved-custom-chat' })
  report.checks.savedCustomChatModelSelectableWithoutReentry = true
  report.checks.automaticLocalDiscoveryAndDeduplicatedChoices = { candidates: local, discoveryRequests: requests.filter(item => item.endpoint === '/v1/models').length }
  await shot('shared-local-model-catalogue')
  await provider.selectOption('claude-cli'); await waitOption('saved-custom-claude'); const claude = await values()
  for (const alias of ['opus', 'sonnet', 'haiku']) assert(claude.includes(alias), `Missing Claude alias ${alias}`)
  await available.selectOption('saved-custom-claude'); await click(page.locator('[data-ourgeo-id="settings.documentModelApply"]'))
  await waitForAsync(page, async path => JSON.parse(await window.electronAPI.file.read(path)).selections.document.provider === 'claude-cli', join(data, 'ai-task-models.json'), { timeout: 10_000 })
  report.checks.existingClaudeCustomModelAndAliasesSelectableWithoutRegistration = { candidates: claude }
  await shot('shared-claude-model-catalogue')
  await provider.selectOption('openai'); await waitOption('shared-model-id')
  await available.selectOption('shared-model-id'); await click(page.locator('[data-ourgeo-id="settings.documentModelApply"]'))
  await page.getByText('Saved. Your assistant model and connection are unchanged.', { exact: true }).first().waitFor()
  assert.equal(JSON.parse(await readFile(join(data, 'ai-task-models.json'), 'utf8')).selections.document.provider, 'openai')
  await provider.selectOption('openai-subscription'); await waitOption('plan-only-model'); const subscription = await values()
  assert.equal(subscription.filter(model => model === 'shared-model-id').length, 1)
  assert.equal(new Set(subscription).size, subscription.length)
  await available.selectOption('shared-model-id'); await click(page.locator('[data-ourgeo-id="settings.documentModelApply"]'))
  await page.getByText('Saved. Your assistant model and connection are unchanged.', { exact: true }).first().waitFor()
  assert.equal(JSON.parse(await readFile(join(data, 'ai-task-models.json'), 'utf8')).selections.document.provider, 'openai-subscription')
  const labels = await provider.locator('option').evaluateAll(options => options.map(option => ({ value: option.value, label: option.textContent })))
  assert.notEqual(labels.find(item => item.value === 'openai').label, labels.find(item => item.value === 'openai-subscription').label)
  report.checks.apiAndChatGptModelsKeepDistinctProviders = { candidates: subscription, providerLabels: labels }
  await shot('shared-chatgpt-model-catalogue')
  const calls = await app.evaluate(() => globalThis.fileAnalysisAccountFixtureCalls)
  assert(calls.models > 0); assert.equal(calls.signIn, 0); assert.equal(calls.selectAccount, 0); assert.equal(calls.setCliPath, 0)
  report.checks.existingConnectionsNeverRegisteredAgain = calls
  assert.deepEqual(JSON.parse(await readFile(join(data, 'api-keys.json'), 'utf8')), connection)
  const preferences = JSON.parse(await readFile(join(data, 'ai-preferences.json'), 'utf8')); assert.equal(preferences.provider, 'lmstudio'); assert.equal(preferences.modelByProvider.lmstudio, 'saved-custom-chat')
  report.checks.chatModelAndCredentialsUnchanged = true
  assert.equal(requests.filter(item => ['/v1/chat/completions', '/api/chat'].includes(item.endpoint)).length, 0)
  report.checks.discoveryPerformsNoInference = true
  assert.equal(errors.length, 0, errors.join('; ')); report.rendererErrors = errors; report.passed = true
}
try {
  await launch()
  if (sharedCatalogue) await checkSharedCatalogue()
  else {
  await settings()
  assert.equal(await page.getByLabel('Generate AI descriptions on import and rescan', { exact: true }).isChecked(), false)
  await apply('document', 'document-specialist'); await page.getByText('Saved. Your assistant model and connection are unchanged.', { exact: true }).first().waitFor()
  await apply('image', 'vision-specialist'); await page.locator('fieldset').filter({ has: page.getByText('Image interpretation', { exact: true }) }).getByText('Saved. Your assistant model and connection are unchanged.', { exact: true }).waitFor()
  const contrast = await settingsContrast(); report.checks.newSettingsTextContrast = { minimumRatio: Math.min(...contrast.map(item => item.ratio)), samples: contrast }
  assert(contrast.every(item => item.ratio >= 4.5), `Settings text contrast below 4.5:1: ${JSON.stringify(contrast.filter(item => item.ratio < 4.5))}`)
  await shot('independent-model-settings'); await closeSettings()
  assert.equal(JSON.parse(await readFile(join(data, 'ai-preferences.json'), 'utf8')).provider, 'lmstudio')
  assert.deepEqual(JSON.parse(await readFile(join(data, 'api-keys.json'), 'utf8')), connection)
  report.checks.actualSettingsSelectIndependentModelsWithoutChatMutation = true
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, projectPath)
  await menu('Save As…'); await importFiles([documentPath, unrelatedPath, imagePath]); await settled(3)
  assert.equal(requests.filter(item => item.payload.model === 'document-specialist' || item.payload.model === 'vision-specialist').filter(item => item.endpoint.endsWith('/chat') || item.endpoint.endsWith('/completions')).length, 0)
  report.checks.backgroundAnalysisDefaultsOff = true
  const image = (await catalogue()).files.find(item => item.name === 'visual-reference.png')
  const rendition = await page.evaluate(async id => { const lease = await window.electronAPI.context.lease(), file = (await window.electronAPI.projectFiles.catalogue(lease.id)).files.find(item => item.id === id); return window.electronAPI.projectFiles.preview(id, file.revision, lease.id) }, image.id)
  imageHash = sha(Buffer.from(rendition.url.split(',')[1], 'base64'))
  if (!await page.getByPlaceholder('Message… (Enter to send, Shift+Enter for new line)').count()) await click(page.locator('[data-ourgeo-id="toolbar.ai"]'))
  await send('FA_DOCUMENT: find and interpret the project clearance criterion.', 'FA_DOCUMENT_CONFIRMED:')
  report.checks.documentToolReadUsesSeparateBoundedModelAndReturnsOriginalPlusAnalysis = true
  await attach(image); await send('FA_IMAGE: inspect the attached reference.', 'FA_IMAGE_CONFIRMED:')
  report.checks.actualImageBytesReachOnlySelectedVisionModel = true
  await settings(); await apply('image', 'text-only-model'); await page.getByRole('alert').filter({ hasText: 'does not advertise vision support' }).waitFor()
  assert.equal(JSON.parse(await readFile(join(data, 'ai-task-models.json'), 'utf8')).selections.image.model, 'vision-specialist')
  report.checks.unsupportedSelectionRejectedWithoutFallback = true
  await page.getByLabel('Image interpretation model', { exact: true }).selectOption('assistant'); await click(page.locator('[data-ourgeo-id="settings.imageModelApply"]')); await closeSettings()
  const beforeUnsupported = requests.filter(item => ['/api/chat', '/v1/chat/completions'].includes(item.endpoint) && item.payload.model !== 'assistant-chat').length
  await attach(image); await send('FA_UNSUPPORTED: inspect the attached image using the current image route.', 'FA_UNSUPPORTED_CONFIRMED:')
  assert.equal(requests.filter(item => ['/api/chat', '/v1/chat/completions'].includes(item.endpoint) && item.payload.model !== 'assistant-chat').length, beforeUnsupported)
  report.checks.unsupportedRuntimeRouteReportsLimitationWithoutSpecialistFallback = true
  await settings(); await apply('image', 'vision-specialist'); await page.locator('[data-ourgeo-id="settings.analyseFilesOnImport"]').check(); await closeSettings()
  await importFiles([autoPath]); await settled(4)
  let automatic = await waitDescription('Automatic catalogue description.md')
  assert(automatic.aiDescription.text.includes('FA_AUTO_DESCRIPTION')); assert.equal(automatic.aiDescription.provider, 'lmstudio'); assert(automatic.aiDescription.createdAt); assert(automatic.aiDescription.coverage.includes('bounded'))
  await page.evaluate(async id => { const lease = await window.electronAPI.context.lease(), file = (await window.electronAPI.projectFiles.catalogue(lease.id)).files.find(item => item.id === id); await window.electronAPI.projectFiles.update(id, file.revision, { userDescription: 'Human description remains authoritative.' }, lease.id) }, automatic.id)
  automatic = (await catalogue()).files.find(item => item.id === automatic.id)
  assert.equal(automatic.userDescription, 'Human description remains authoritative.'); assert.equal(automatic.aiDescription.revision, automatic.revision)
  report.checks.explicitOptInImportGeneratesProvenanceWithoutOverwritingHumanDescription = true
  await menu('Project Files'); const back = page.getByRole('button', { name: /Back to project files|Close file details/ }); if (await back.count()) await click(back)
  await click(page.locator('[data-ourgeo-id="projectFiles.linkedFolders"]'))
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, linkedPath)
  await click(page.locator('[data-ourgeo-id="projectFiles.linkFolder"]')); await settled(5)
  const linked = await waitDescription('Changing linked criteria.md'), priorRevision = linked.revision
  await writeFile(linkedFile, '# Linked criteria revised\nFA_LINKED_UPDATED: retain source units and map attribution.\n')
  await click(page.locator('[data-ourgeo-id="projectFiles.rescanFolders"]')); await settled(5)
  const revised = await waitDescription('Changing linked criteria.md'); assert.notEqual(revised.revision, priorRevision)
  report.checks.explicitLinkedRescanRegeneratesChangedDescription = true
  await page.getByRole('button', { name: 'Close linked folders', exact: true }).click()
  await shot('generated-project-descriptions')
  await menu('Save'); await waitForAsync(page, async () => { const current = await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id); return current.revision === current.savedRevision }, undefined, { timeout: 60_000 })
  const bundle = new AdmZip(await readFile(projectPath)), catalogueEntry = bundle.getEntries().find(entry => entry.entryName === 'files/catalogue.json')
  assert(catalogueEntry, 'Saved project must contain its portable file catalogue.')
  assert(bundle.readAsText(catalogueEntry).includes('FA_AUTO_DESCRIPTION'))
  const savedPreferences = JSON.parse(await readFile(join(data, 'ai-preferences.json'), 'utf8')); assert.equal(savedPreferences.provider, 'lmstudio'); assert.equal(savedPreferences.modelByProvider.lmstudio, 'assistant-chat')
  const beforeReopen = requests.filter(item => ['/api/chat', '/v1/chat/completions'].includes(item.endpoint)).length
  await close(); await launch()
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, projectPath); await menu('Load…'); await settled(5)
  await settings(); assert.equal(await page.getByLabel('Document analysis model ID', { exact: true }).inputValue(), 'document-specialist'); assert.equal(await page.getByLabel('Image interpretation model ID', { exact: true }).inputValue(), 'vision-specialist'); assert(await page.getByLabel('Generate AI descriptions on import and rescan', { exact: true }).isChecked())
  await closeSettings(); await waitForAsync(page, async () => { const current = await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id); return current.linkedFolders?.every(item => item.status === 'ready') }, undefined, { timeout: 30_000 })
  await new Promise(done => setTimeout(done, 1200))
  assert.equal(requests.filter(item => ['/api/chat', '/v1/chat/completions'].includes(item.endpoint)).length, beforeReopen, 'Reopening must not trigger library-wide background inference.')
  const reopened = (await catalogue()).files.find(item => item.id === automatic.id); assert.equal(reopened.aiDescription.text, automatic.aiDescription.text); assert.equal(reopened.userDescription, automatic.userDescription)
  report.checks.settingsAndDescriptionsPersistWithoutInferenceOnReopen = true
  if (serverError) throw serverError
  assert.equal(errors.length, 0, errors.join('; ')); report.rendererErrors = errors
  report.checks.requestCounts = Object.fromEntries(['assistant-chat', 'document-specialist', 'vision-specialist', 'text-only-model'].map(model => [model, requests.filter(item => ['/api/chat', '/v1/chat/completions'].includes(item.endpoint) && item.payload.model === model).length]))
  report.passed = true
  }
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error)
  if (page && !page.isClosed()) { await writeFile(join(directory, 'failure.txt'), await page.locator('body').innerText()); await shot('failure').catch(() => undefined) }
  throw error
} finally {
  await close(); await new Promise(done => server.close(done))
  await writeFile(join(directory, 'requests.json'), JSON.stringify(requests, null, 2)); await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2)); await writeFile(join(output, 'latest.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report))
}
