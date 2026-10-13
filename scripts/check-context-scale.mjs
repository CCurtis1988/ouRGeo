/* global window, document, HTMLInputElement */
// Native Electron dev renderer, actual stores/adapters/broker/source-browser.
// Synthetic metadata only. Normal editor/console/object panes are deliberately
// closed by default. --whole-app retains the ordinary layout to measure its
// visible tab/console rendering alongside context discovery.
import { _electron as electron } from 'playwright-core'
import executablePath from 'electron'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir, cpus } from 'node:os'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
const root = resolve('.'), profile = await mkdtemp(join(tmpdir(), 'ourgeo-context-scale-')), data = join(profile, 'ourgeo')
const wholeApp = process.argv.includes('--whole-app')
await mkdir(data, { mode: 0o700 })
await writeFile(join(data, '.context-acceptance'), 'synthetic-context-profile-v1\n', { mode: 0o600 })
await writeFile(join(data, 'health-check.json'), JSON.stringify({ prompted: true, report: null }))
const requests = []
const model = createHttpServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk
  res.setHeader('Content-Type', 'application/json')
  if (req.url === '/api/chat') {
    requests.push(JSON.parse(body)); res.setHeader('Content-Type', 'application/x-ndjson')
    res.end(JSON.stringify({ message: { content: 'Native scale fixture completed.' }, done: true, prompt_eval_count: 700, eval_count: 10 }) + '\n')
  } else if (req.url === '/api/tags') res.end(JSON.stringify({ models: [{ name: 'scale-fixture', details: {} }] }))
  else if (req.url === '/api/ps') res.end(JSON.stringify({ models: [{ name: 'scale-fixture', context_length: 32768 }] }))
  else res.end('{}')
})
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve))
await writeFile(join(data, 'ai-preferences.json'), JSON.stringify({ provider: 'ollama', modelByProvider: { ollama: 'scale-fixture' }, webAccessEnabled: false, autopilotWarningDismissed: true }))
await writeFile(join(data, 'api-keys.json'), JSON.stringify({ ollama_url: `http://127.0.0.1:${model.address().port}`, ollama_ctx: '32768' }))
const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const server = await createServer({ configFile: false, root: join(root, 'src'), plugins: [react()], resolve: { alias: { '@': join(root, 'src') } }, define: { __APP_VERSION__: JSON.stringify(version) }, server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const wrapper = join(profile, 'launch.cjs')
await writeFile(wrapper, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(data)});require(${JSON.stringify(join(root, 'out/main/index.js'))});`)
let app
let phase = 'launch'
const mark = value => { phase = value; console.log(JSON.stringify({ phase })) }
const watchdog = setTimeout(() => {
  console.error(`Native scale benchmark exceeded five minutes in phase: ${phase}`)
  app?.process().kill('SIGKILL')
}, 300000)
try {
  app = await electron.launch({ executablePath, args: ['--no-sandbox', '--js-flags=--expose-gc', wrapper], cwd: root,
    env: { ...process.env, OURGEO_CONTEXT_TEST_PROFILE: data, ELECTRON_RENDERER_URL: `http://127.0.0.1:${server.httpServer.address().port}` }, timeout: 60000 })
  const page = await app.firstWindow(); page.setDefaultTimeout(30000)
  const bodyReads = [], errors = []
  page.on('request', req => { if (req.url().includes('/context/schema')) bodyReads.push(req.url()) })
  page.on('pageerror', error => errors.push(String(error)))
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus() })
  await page.waitForFunction(() => document.body.innerText.includes('R session ready.'))
  // These imports resolve to the same Vite modules used by the actual app.
  await page.evaluate(async wholeApp => {
    const { useLayoutStore } = await import('/store/layout.ts')
    const { panelInfoList } = await import('/lib/layout/panel-meta.ts')
    useLayoutStore.getState().setPanelOpen('ai', true)
    if (wholeApp) return
    // Essential editor/console panels are reopened by normalisation. This
    // synthetic context-only fixture deliberately suppresses their rendering;
    // it must not time construction of 100,000 DOM tab buttons as retrieval.
    const isolate = ({ layout }) => {
      if (panelInfoList().some(panel => layout.open[panel.id] !== (panel.id === 'ai'))) {
        useLayoutStore.setState({ layout: { ...layout, open: Object.fromEntries(panelInfoList().map(panel => [panel.id, panel.id === 'ai'])) } })
      }
    }
    useLayoutStore.subscribe(isolate)
    isolate(useLayoutStore.getState())
  }, wholeApp)
  const input = page.getByPlaceholder('Message… (Enter to send, Shift+Enter for new line)')
  const send = async () => {
    const count = requests.length
    await input.fill('Generate 100 rows of dummy data.')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await page.getByText('Native scale fixture completed.', { exact: true }).nth(count).waitFor()
    assert.equal(requests.length, count + 1)
    assert(!JSON.stringify(requests.at(-1)).includes('Retrieved evidence'))
  }
  await send()
  mark('seed-inputs')
  const metrics = async label => {
    await page.evaluate(() => { if (typeof window.gc === 'function') window.gc() })
    return app.evaluate(({ app, BrowserWindow }, label) => {
      const pid = BrowserWindow.getAllWindows()[0].webContents.getOSProcessId()
      const metric = app.getAppMetrics().find(item => item.pid === pid)
      return { label, pid, residentBytes: metric.memory.workingSetSize * 1024, peakResidentBytes: metric.memory.peakWorkingSetSize * 1024 }
    }, label)
  }
  const snapshots = [await metrics('before-inputs')]
  const corpus = await page.evaluate(async wholeApp => {
    const [{ useEnvironmentStore }, { useSessionStore }, { useEditorStore }, { registerPluginTopics }] = await Promise.all([
      import('/store/environment.ts'), import('/store/session.ts'), import('/store/editor.ts'), import('/lib/ai-skill-ourgeo.ts')])
    useSessionStore.setState({ consoleHistory: Array.from({ length: 100000 }, (_, index) => ({ id: `scale-event-${index}`, type: index % 4 === 0 ? 'input' : index % 4 === 3 ? 'error' : 'output', text: `scale event ${index}`, timestamp: index })) })
    useEnvironmentStore.setState({ environments: [{ name: '.GlobalEnv', isSearchPath: false, objects: Array.from({ length: 10000 }, (_, index) => ({ name: `object_${index}`, class: ['data.frame'], dim: [10, 2], columns: [{ name: 'id', type: 'integer' }, { name: 'value', type: 'numeric' }] })) }] })
    const tabs = Array.from({ length: 100000 }, (_, index) => ({ id: `scale-document-${index}`, type: 'code', language: 'markdown', fileName: `document_${index}.md`, filePath: null, content: `# Method ${index}\n# ${index % 97 === 0 ? 'flood parcel exposure' : 'unrelated reference'}\n`, savedContent: '', isDirty: false, viewMode: 'source' }))
    useEditorStore.setState({ tabs, activeTabId: wholeApp ? tabs[0].id : null, activeByPanel: wholeApp ? { editor: tabs[0].id } : {} })
    registerPluginTopics(Array.from({ length: 200 }, (_, index) => ({ topic: `scale-plugin-${index}`, summary: 'Synthetic capability', body: 'Synthetic plugin help.', context: { version: '1', triggers: ['synthetic'], exclusions: [] } })))
    return { objects: 10000, consoleEvents: 100000, documents: tabs.length, plugins: 200 }
  }, wholeApp)
  await page.waitForTimeout(500)
  if (wholeApp) {
    const strip = page.getByRole('region', { name: 'Open document tabs', exact: true }).first()
    assert(await strip.getByRole('button').count() < 30, 'A huge workspace must not render a header for every document.')
    await page.evaluate(async () => { const { useEditorStore } = await import('/store/editor.ts'); useEditorStore.getState().setActiveTab('scale-document-99999') })
    await strip.getByRole('button', { name: 'document_99999.md', exact: true }).waitFor()
    await strip.getByRole('button', { name: 'document_99999.md', exact: true }).click()
    await page.evaluate(async () => { const { useEditorStore } = await import('/store/editor.ts'); useEditorStore.getState().setActiveTab('scale-document-0') })
    await strip.getByRole('button', { name: 'document_0.md', exact: true }).waitFor()
    const output = page.getByRole('region', { name: 'R console output', exact: true }).first()
    assert(await output.locator('[data-index]').count() < 100, 'Long console history must keep rendered output bounded.')
    await output.evaluate(element => { element.scrollTop = 0 })
    await output.locator('[data-index="0"]').waitFor()
    assert((await output.locator('[data-index="0"]').innerText()).includes('> scale event 0'))
    await page.evaluate(async () => {
      const { useSessionStore } = await import('/store/session.ts'), history = useSessionStore.getState().consoleHistory
      useSessionStore.setState({ consoleHistory: [...history.slice(0, -1), { ...history.at(-1), text: 'Synthetic multiline output\n' + 'Measured complete output line.\n'.repeat(20) }] })
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.contextBenchmarkCopy = text } } })
    })
    await output.locator('[data-index="99999"]').waitFor()
    await page.waitForFunction(() => document.querySelector('[aria-label="R console output"] [data-index="99999"]')?.getBoundingClientRect().height > 200)
    await page.getByRole('button', { name: 'Copy all console output', exact: true }).click()
    await page.waitForFunction(() => window.contextBenchmarkCopy?.startsWith('> scale event 0\n') && window.contextBenchmarkCopy.includes('Synthetic multiline output\n') && window.contextBenchmarkCopy.includes('scale event 99998'))
    await page.evaluate(() => { delete window.contextBenchmarkCopy })
  }
  snapshots.push(await metrics('inputs-before-discovery'))
  mark('open-browser')
  await page.getByText('Conversation only', { exact: true }).first().evaluate(el => { el.closest('details').open = true })
  const coldStart = performance.now()
  await page.getByRole('button', { name: 'Browse current context sources' }).click()
  await page.getByLabel('Search current context sources', { exact: true }).waitFor()
  const coldMs = performance.now() - coldStart
  mark('warm-search')
  snapshots.push(await metrics('cold-browser'))
  const timings = []
  for (const query of ['flood parcel exposure', '', 'scale', '.GlobalEnv::object_9876']) {
    const samples = []
    for (let iteration = 0; iteration < 10; iteration++) {
      samples.push(await page.evaluate(query => {
        const field = document.querySelector('input[aria-label="Search current context sources"]')
        // Always dispatch a real React change, even on repeated search text.
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(field, `${query} `); field.dispatchEvent(new Event('input', { bubbles: true }))
        const start = performance.now()
        setter.call(field, query); field.dispatchEvent(new Event('input', { bubbles: true }))
        return performance.now() - start
      }, query))
      await page.waitForTimeout(20)
      if (query === '.GlobalEnv::object_9876') assert(await page.getByRole('region', { name: 'Current context sources' }).innerText().then(text => text.includes('.GlobalEnv::object_9876')))
      snapshots.push(await metrics(`browser-${query}-${iteration}`))
    }
    timings.push({ query, warmP95Ms: [...samples.slice(2)].sort((a, b) => a - b).at(-1), samples })
  }
  await send()
  mark('capture-report')
  assert.deepEqual(bodyReads, [])
  assert.deepEqual(errors, [])
  await page.getByLabel('Search current context sources', { exact: true }).fill('.GlobalEnv::object_9876')
  await page.getByRole('region', { name: 'Current context sources' }).first().locator('li').first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  const screenshot = join(profile, 'native-context-scale.png')
  const captured = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(screenshot, Buffer.from(captured, 'base64'))
  const sourceHashes = Object.fromEntries(await Promise.all(['scripts/check-context-scale.mjs', 'package-lock.json', 'src/components/editor/TabBar.tsx', 'src/lib/editor-tab-window.ts', 'src/components/console/Console.tsx', 'src/components/console/ConsoleHistory.tsx', 'src/components/ai/ContextSourceBrowser.tsx', 'src/lib/context/source-browser.ts', 'src/lib/context/descriptor-index.ts', 'src/lib/context/descriptor-identity.ts', 'src/lib/context/sources/workspace.ts', 'src/lib/context/sources/console-index.ts'].map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])))
  const report = { version: 1, measuredAt: new Date().toISOString(), appVersion: version, profile, screenshot, platform: `${process.platform}-${process.arch}`, cpu: cpus()[0]?.model, corpus, coldMs, timings, snapshots,
    managerPeakAdditionalResidentBytes: Math.max(...snapshots.slice(2).map(item => item.residentBytes)) - snapshots[1].residentBytes,
    inputAndManagerAdditionalResidentBytes: snapshots.at(-1).residentBytes - snapshots[0].residentBytes, sourceHashes, bodyReads: bodyReads.length,
    contextFreeTurns: requests.map(payload => ({ hasAuxiliaryEvidence: JSON.stringify(payload).includes('Retrieved evidence'), bytes: Buffer.byteLength(JSON.stringify(payload)) })),
    methodology: 'Actual native Electron dev renderer, production UI and stores, packed default adapters and source browser. Synthetic metadata; editor/console/environment panes closed, normal AI/context UI rendered. Timings include synchronous React search handlers; cold time includes Playwright and UI mount. Resident memory measured with Electron process metrics after forced GC; transient pre-GC peaks and whole-app pane rendering are not certified. Loopback mock model, no real inference or R source reads.' }
  report.gates = {
    warmSearchBelow200Ms: timings.every(item => item.warmP95Ms < 200),
    additionalManagerBelow150MiB: report.managerPeakAdditionalResidentBytes < 150 * 1024 * 1024,
    contextFreeNoAuxiliarySources: report.contextFreeTurns.every(turn => !turn.hasAuxiliaryEvidence),
    noSchemaReads: bodyReads.length === 0,
  }
  report.passed = Object.values(report.gates).every(Boolean)
  report.wholeApp = wholeApp
  report.normalLayoutAccessChecks = wholeApp ? { firstAndLastDocumentReachable: true, consoleScrollsToOldestEntry: true, multilineOutputMeasured: true, completeHistoryCopyVerifiedWithoutSystemClipboardWrite: true } : null
  if (wholeApp) report.methodology = report.methodology
    .replace('editor/console/environment panes closed, normal AI/context UI rendered.', 'normal layout retained, with the first of 100,000 document buffers active; no pane-suppression override. Input DOM allocations precede the manager baseline.')
    .replace('transient pre-GC peaks and whole-app pane rendering are not certified.', 'production file ingestion, other panel/view combinations and transient pre-GC peaks are not certified.')
  await writeFile(wholeApp ? '/tmp/ourgeo-context-whole-app-scale.json' : '/tmp/ourgeo-context-native-scale.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
  if (!report.passed) process.exitCode = 1
} catch (error) {
  console.error(error)
  await writeFile(join(profile, 'failure.json'), JSON.stringify({ phase, wholeApp, error: String(error), passed: false }, null, 2))
  if (app) {
    const page = await app.firstWindow()
    try { await writeFile(join(profile, 'failure.txt'), await page.locator('body').innerText({ timeout: 5000 })); await page.screenshot({ path: join(profile, 'failure.png'), timeout: 5000 }) } catch { /* Preserve the original failure when the renderer is blocked. */ }
    console.error(`Failure evidence: ${profile}`)
  }
  throw error
} finally {
  // The benchmark owns every buffer in its marked synthetic profile. Destroy
  // those windows to bypass an unsaved-work prompt before normal quit cleanup.
  if (app) {
    await app.evaluate(({ BrowserWindow, app }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); app.quit() }).catch(() => undefined)
    await app.close().catch(() => undefined)
  }
  clearTimeout(watchdog); await server.close(); await new Promise(resolve => model.close(resolve))
}
