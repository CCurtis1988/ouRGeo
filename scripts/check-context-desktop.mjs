/* global window */
// Register the actual packaged desktop metadata in a private XDG directory,
// launch it through GTK, and exercise protected local memory in that window.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { mkdir, mkdtemp, readFile, writeFile, chmod, unlink, open, copyFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
if (process.platform !== 'linux') throw new Error('This native desktop check runs on Linux.')
const root = resolve('.'), { version } = JSON.parse(await readFile('package.json', 'utf8'))
const directory = await mkdtemp(join(root, '.cache/context-desktop-'))
const data = join(directory, 'profile'), xdgData = join(directory, 'desktop'), applications = join(xdgData, 'applications')
await mkdir(data, { mode: 0o700 }); await mkdir(applications, { recursive: true })
await writeFile(join(data, '.context-acceptance'), 'synthetic-context-profile-v1\n', { mode: 0o600 })
await writeFile(join(data, 'health-check.json'), JSON.stringify({ prompted: true, report: null }))
const command = (program, args, env = process.env) => new Promise((resolveRun, reject) => {
  const child = spawn(program, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
  child.on('error', reject); child.on('close', code => resolveRun({ code, output }))
})
const artifact = join(root, 'dist', `ouRGeo-${version}.AppImage`)
const deb = join(directory, 'ouRGeo.deb')
await copyFile(join(root, 'dist', `ouRGeo-${version}.deb`), deb)
const installed = join(directory, 'ouRGeo.AppImage')
await copyFile(artifact, installed); await chmod(installed, 0o700)
const members = await command('ar', ['t', deb]); assert.equal(members.code, 0)
const member = members.output.split('\n').find(name => /^data\.tar\.(?:xz|gz|zst)$/.test(name))
assert(member)
const template = await new Promise((resolveTemplate, reject) => {
  const archive = spawn('ar', ['p', deb, member], { stdio: ['ignore', 'pipe', 'pipe'] })
  const extract = spawn('tar', [member.endsWith('.xz') ? '--xz' : member.endsWith('.gz') ? '--gzip' : '--zstd', '-xOf', '-', './usr/share/applications/ourgeo.desktop'], { stdio: ['pipe', 'pipe', 'pipe'] })
  archive.stdout.pipe(extract.stdin)
  extract.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error) })
  let output = '', errors = ''
  archive.stderr.on('data', chunk => { errors += chunk }); extract.stderr.on('data', chunk => { errors += chunk })
  extract.stdout.on('data', chunk => { output += chunk })
  archive.on('error', reject); extract.on('error', reject)
  extract.on('close', code => code === 0 ? resolveTemplate(output) : reject(new Error(errors)))
})
await writeFile(join(directory, 'packaged.desktop'), template)
const probe = createTcpServer()
await new Promise(resolvePort => probe.listen(0, '127.0.0.1', resolvePort))
const port = probe.address().port
await new Promise(resolveClose => probe.close(resolveClose))
let requests = 0
const model = createServer((req, res) => {
  if (req.url === '/api/chat') requests++
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ models: [{ name: 'desktop-fixture', context_length: 32768 }] }))
})
await new Promise(resolveModel => model.listen(0, '127.0.0.1', resolveModel))
await writeFile(join(data, 'ai-preferences.json'), JSON.stringify({ provider: 'ollama', modelByProvider: { ollama: 'desktop-fixture' }, autopilotWarningDismissed: true }))
await writeFile(join(data, 'api-keys.json'), JSON.stringify({ ollama_url: `http://127.0.0.1:${model.address().port}`, ollama_ctx: '32768' }))
const id = `ourgeo-stage02-${directory.split('-').at(-1)}`
const desktop = join(applications, `${id}.desktop`)
const quote = value => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`
const registered = template.replace(/^Exec=.*$/m, `Exec=${quote(installed)} --no-sandbox --remote-debugging-port=${port}`)
assert.notEqual(registered, template, 'Use the actual package desktop template with a private launch destination.')
await writeFile(desktop, registered, { mode: 0o700 }); await chmod(desktop, 0o700)
const validation = await command('desktop-file-validate', [desktop]); assert.equal(validation.code, 0, validation.output)
const env = { ...process.env, XDG_DATA_HOME: xdgData, XDG_CONFIG_HOME: join(directory, 'config'), XDG_CACHE_HOME: join(directory, 'cache'), OURGEO_CONTEXT_TEST_PROFILE: data }
let browser, desktopPage
try {
  const log = await open(join(directory, 'launch.log'), 'w')
  const exit = await new Promise((resolveExit, reject) => {
    const child = spawn('gtk-launch', [id], { cwd: root, env, stdio: ['ignore', log.fd, log.fd] })
    child.on('error', reject); child.on('exit', resolveExit)
  })
  await log.close()
  assert.equal(exit, 0, 'GTK desktop launch failed; inspect launch.log.')
  let endpoint
  for (let attempt = 0; attempt < 120; attempt++) {
    try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (response.ok) { endpoint = await response.json(); break } } catch { /* Native startup is asynchronous. */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
  }
  assert(endpoint?.webSocketDebuggerUrl, 'Desktop-launched window did not start its private test debugger.')
  browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl)
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: 30000 })
  desktopPage = page
  await page.waitForSelector('[data-ourgeo-id="toolbar.settings"]', { timeout: 30000 })
  assert.equal(await page.evaluate(() => window.electronAPI.app.getDataPath()), data, 'Desktop launch must remain in its marked private profile.')
  const onboarding = page.getByRole('button', { name: 'Maybe later', exact: true })
  if (await onboarding.count()) await onboarding.evaluate(element => element.click())
  await page.locator('[data-ourgeo-id="toolbar.settings"]').evaluate(element => element.click())
  await page.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: 'AI Assistant', exact: true }).click()
  await page.getByRole('tab', { name: 'Memory Library', exact: true }).click()
  await page.getByText(`ouRGeo v${version}`, { exact: true }).waitFor()
  const library = page.getByRole('region', { name: 'Memory library' })
  await library.getByLabel('New memory', { exact: true }).fill('Native desktop acceptance: prefer readable labels.')
  await library.getByRole('button', { name: 'Remember about you', exact: true }).click()
  const memory = library.locator('p').filter({ hasText: /^Native desktop acceptance: prefer readable labels\.$/ })
  await memory.waitFor()
  assert.equal(requests, 0, 'Native desktop memory entry must not dispatch a model.')
  await memory.locator('..').getByRole('button', { name: 'Forget', exact: true }).click()
  await page.waitForFunction(async () => !(await window.electronAPI.context.listGlobal()).some(memory => memory.statement === 'Native desktop acceptance: prefer readable labels.'))
  await page.screenshot({ path: join(directory, 'desktop-memory.png') })
  await page.evaluate(() => window.electronAPI.app.confirmQuit()).catch(() => undefined)
  await browser.close(); browser = undefined
  await unlink(desktop)
  const report = { version: 1, appVersion: version, measuredAt: new Date().toISOString(), directory, artifactSha256: createHash('sha256').update(await readFile(installed)).digest('hex'), desktopPackageSha256: createHash('sha256').update(await readFile(deb)).digest('hex'), templateSha256: createHash('sha256').update(template).digest('hex'), privateXdgRegistration: true, gtkDesktopLaunch: true, privateProfileVerified: true, localMemoryAddAndForget: true, modelDispatches: requests, registeredEntryRemoved: true, passed: true, scope: 'Actual packaged desktop template, private XDG applications directory and GTK launch of the AppImage. Regular menus, associations and user profiles are untouched. Debian installation and offline certification are separate.' }
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
  await writeFile('/tmp/ourgeo-context-desktop-evidence.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} catch (error) {
  if (desktopPage && !desktopPage.isClosed()) { await writeFile(join(directory, 'failure.txt'), await desktopPage.locator('body').innerText()); await desktopPage.screenshot({ path: join(directory, 'failure.png') }) }
  throw error
} finally {
  if (desktopPage && !desktopPage.isClosed()) await desktopPage.evaluate(() => window.electronAPI.app.confirmQuit()).catch(() => undefined)
  if (browser) await browser.close()
  await new Promise(resolveModel => model.close(resolveModel))
}
