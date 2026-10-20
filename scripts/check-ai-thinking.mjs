/* global window, document */
// Native UI and production inference transport, with a synthetic loopback model.
import { _electron as electron } from 'playwright-core'
import electronExecutable from 'electron'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, writeFile, chmod, realpath } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
const root = resolve(import.meta.dirname, '..'), output = join(root, '.cache/ai-thinking-ui')
await mkdir(output, { recursive: true })
const directory = await mkdtemp(join(output, 'run-')), profile = join(directory, 'profile'), data = join(profile, 'ourgeo'), temporary = join(directory, 'tmp')
await mkdir(data, { recursive: true }); await chmod(data, 0o700); await mkdir(temporary)
const requests = []
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const payload = raw ? JSON.parse(raw) : {}
  res.setHeader('Content-Type', 'application/json')
  if (req.url === '/api/tags') return res.end(JSON.stringify({ models: ['gpt-oss:20b', 'qwen3:8b', 'llama3.1:8b'].map(name => ({ name })) }))
  if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: ['completion', ...(payload.model === 'llama3.1:8b' ? [] : ['thinking'])], model_info: { 'fixture.context_length': 32768 }, ...(payload.model === 'llama3.1:8b' ? {} : { thinking: payload.model === 'qwen3:8b' ? { values: [false, true], default: true } : { values: ['low', 'medium', 'high'], default: 'medium' } }) }))
  if (req.url === '/api/chat') {
    requests.push(payload)
    await new Promise(resolve => setTimeout(resolve, 1000))
    return res.end(JSON.stringify({ message: { role: 'assistant', content: 'THINKING_FIXTURE: hello from the selected model.' }, done: true, prompt_eval_count: 1200, eval_count: 20 }) + '\n')
  }
  res.end('{}')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
await writeFile(join(data, '.context-acceptance'), 'synthetic-context-profile-v1\n', { mode: 0o600 })
await writeFile(join(data, 'health-check.json'), JSON.stringify({ prompted: true, report: null }))
await writeFile(join(data, 'ai-preferences.json'), JSON.stringify({ provider: 'ollama', modelByProvider: { ollama: 'gpt-oss:20b', openai: 'o3', anthropic: 'claude-sonnet-4-6', google: 'gemini-2.5-pro' }, webAccessEnabled: false, autopilotWarningDismissed: true }))
await writeFile(join(data, 'api-keys.json'), JSON.stringify({ ollama_url: `http://127.0.0.1:${server.address().port}`, ollama_ctx: '32768' }))
const wrapper = join(profile, 'launch.cjs')
await writeFile(wrapper, `const {app,session}=require('electron');app.setPath('userData',${JSON.stringify(data)});app.on('ready',()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>callback({cancel:!['127.0.0.1','localhost','[::1]'].includes(new URL(details.url).hostname)})));require(${JSON.stringify(join(root, 'out/main/index.js'))});`)
const report = { directory, passed: false, checks: [], screenshots: [], rendererErrors: [] }
let app, page
const click = locator => locator.evaluate(el => el.click())
const selector = () => page.locator('[data-ourgeo-id="ai.thinkingEffort"]')
async function launch() {
  app = await electron.launch({ executablePath: electronExecutable, args: ['--no-sandbox', '--ozone-platform=x11', wrapper], cwd: root, env: { ...process.env, TMPDIR: temporary, XDG_CONFIG_HOME: profile, OURGEO_CONTEXT_TEST_PROFILE: await realpath(data) }, timeout: 60000 })
  page = app.windows().find(p => !p.url().startsWith('devtools:')) ?? await app.firstWindow()
  page.on('pageerror', error => report.rendererErrors.push(error.message))
  await page.waitForSelector('[data-ourgeo-id="toolbar.ai"]', { timeout: 60000 })
  assert.equal(resolve(await app.evaluate(({ app }) => app.getPath('userData'))), resolve(data))
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ width: 1440, height: 1000 }); w.show(); w.focus() })
  await page.setViewportSize({ width: 1440, height: 1000 })
  if (!await page.getByPlaceholder('Message… (Enter to send, Shift+Enter for new line)').count()) await click(page.locator('[data-ourgeo-id="toolbar.ai"]'))
  await selector().waitFor()
  await page.waitForFunction(() => document.querySelector('[data-ourgeo-id="project.dropdown"]')?.title === 'R connected', undefined, { timeout: 60000 })
}
async function close() { if (app) { await page.evaluate(() => window.electronAPI.app.confirmQuit()).catch(() => undefined); await app.close().catch(() => undefined); app = undefined } }
async function shot(name) { const path = join(directory, `${name}.png`); await page.screenshot({ path, animations: 'disabled', caret: 'hide' }); report.screenshots.push(path) }
async function choose(model) {
  await click(page.getByRole('button', { name: /^(gpt-oss:20b|qwen3:8b|llama3.1:8b)$/ }).first())
  await click(page.getByRole('button', { name: model, exact: true }).last())
}
async function waitValue(value) { await page.waitForFunction(value => document.querySelector('[data-ourgeo-id="ai.thinkingEffort"]')?.value === value, value) }
try {
  await launch()
  assert.deepEqual(await selector().locator('option').allTextContents(), ['Provider default · Medium', 'Low', 'Medium', 'High'])
  await selector().selectOption('high'); await waitValue('high'); await shot('named-effort')
  await page.getByPlaceholder('Message… (Enter to send, Shift+Enter for new line)').fill('Give a brief greeting.')
  await page.getByPlaceholder('Message… (Enter to send, Shift+Enter for new line)').press('Enter')
  await page.waitForFunction(() => document.querySelector('[data-ourgeo-id="ai.thinkingEffort"]')?.disabled)
  await page.getByText('THINKING_FIXTURE: hello from the selected model.', { exact: true }).waitFor({ timeout: 60000 })
  assert.equal(requests.at(-1).think, 'high')
  await choose('qwen3:8b')
  await page.waitForFunction(() => [...document.querySelectorAll('[data-ourgeo-id="ai.thinkingEffort"] option')].some(el => el.value === 'off'))
  await selector().selectOption('off'); await waitValue('off'); await shot('boolean-thinking')
  await choose('llama3.1:8b')
  await selector().waitFor({ state: 'hidden' }); await shot('unsupported-model')
  await choose('gpt-oss:20b'); await waitValue('high')
  report.checks.push('Advertised native Ollama levels; provider default label; per-model persistence; boolean controls; unsupported models hidden; selector disabled while streaming; production request carries think=high')
  await close(); await launch(); await waitValue('high')
  report.checks.push('Choice survives app restart')
  assert.deepEqual(report.rendererErrors, [])
  report.passed = true
} catch (error) { report.error = error.stack; if (page && !page.isClosed()) await shot('failure').catch(() => undefined); process.exitCode = 1 }
finally { await close(); await new Promise(resolve => server.close(resolve)); report.requests = requests.map(req => ({ model: req.model, think: req.think })); await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)) }
