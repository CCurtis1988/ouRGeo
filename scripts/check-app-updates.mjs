import { waitForAsync } from './lib/wait-async.mjs'
/* global window, document */
// Real startup/controller/IPC/network/parser/dialog. Only published responses,
// packaged state/version and external-browser launch are deterministic fixtures.
import { _electron as electron } from 'playwright-core'
import electronExecutable from 'electron'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, writeFile, readFile, chmod, realpath, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
const root = resolve(import.meta.dirname, '..'), output = join(root, '.cache/app-updates-ui')
await mkdir(output, { recursive: true })
const directory = await mkdtemp(join(output, 'run-')), profile = join(directory, 'profile'), data = join(profile, 'ourgeo'), temporary = join(directory, 'tmp')
await mkdir(data, { recursive: true }); await chmod(data, 0o700); await mkdir(temporary)
await writeFile(join(data, '.context-acceptance'), 'synthetic-context-profile-v1\n', { mode: 0o600 })
await writeFile(join(data, 'health-check.json'), JSON.stringify({ prompted: true, report: null }))
// Simulated packaging must still point the real R bridge at bundled resources.
const resources = join(directory, 'resources')
await mkdir(resources); await symlink(join(root, 'r'), join(resources, 'r'), 'dir')
const requests = []
let fixture = 'available', release = '2.0.0'
const server = createServer((req, res) => {
  requests.push({ method: req.method, path: req.url })
  if (fixture === 'offline') { res.statusCode = 503; return res.end('Unavailable') }
  if (req.method === 'HEAD') { res.setHeader('Content-Type', 'application/octet-stream'); return res.end() }
  res.setHeader('Content-Type', 'text/html')
  res.end(`<h1>Source release 99.0.0</h1><a class="download-card" href="download.php?file=ouRGeo-${release}.AppImage" download>AppImage</a><a class="download-card" href="download.php?file=ouRGeo-${release}.exe" download>Windows</a><div class="download-card soon">macOS coming soon</div>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const report = { directory, passed: false, checks: [], screenshots: [], rendererErrors: [], limitations: ['Native Linux UI uses synthetic release responses and packaged/version state. No installer is downloaded or executed and no actual browser opens.', 'Windows/macOS native verification is deferred.'] }
let app, page
const click = locator => locator.evaluate(element => element.click())
const dialog = () => page.locator('[data-ourgeo-id="updates.dialog"]')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function shot(name) { const path = join(directory, `${name}.png`); await page.screenshot({ path, animations: 'disabled', caret: 'hide' }); report.screenshots.push(path) }
async function launch(version = '1.0.0', packaged = true) {
  const wrapper = join(profile, 'launch.cjs'), base = `http://127.0.0.1:${server.address().port}`
  await writeFile(wrapper, `const {app,net,shell,session}=require('electron');app.setPath('userData',${JSON.stringify(data)});Object.defineProperty(app,'isPackaged',{value:${packaged},configurable:true});app.getVersion=()=>${JSON.stringify(version)};Object.defineProperty(process,'resourcesPath',{value:${JSON.stringify(resources)}});global.__updateOpened=[];global.__updateErrors=[];shell.openExternal=async url=>{global.__updateOpened.push(url)};const original=net.fetch.bind(net);net.fetch=(input,init)=>{const url=String(input);return original(url.startsWith('https://ourgeo.dev/')?${JSON.stringify(base)}+'/'+(url.includes('download.php')?'installer':'page'):input,{...init,bypassCustomProtocolHandlers:true}).catch(error=>{global.__updateErrors.push(String(error));throw error})};app.on('ready',()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>callback({cancel:!['127.0.0.1','localhost','[::1]'].includes(new URL(details.url).hostname)})));require(${JSON.stringify(join(root, 'out/main/index.js'))});`)
  app = await electron.launch({ executablePath: electronExecutable, args: ['--no-sandbox', '--ozone-platform=x11', wrapper], cwd: root, env: { ...process.env, APPIMAGE: '/tmp/synthetic-ouRGeo.AppImage', TMPDIR: temporary, XDG_CONFIG_HOME: profile, OURGEO_CONTEXT_TEST_PROFILE: await realpath(data) }, timeout: 60000 })
  page = app.windows().find(item => !item.url().startsWith('devtools:')) ?? await app.firstWindow()
  page.on('pageerror', error => report.rendererErrors.push(error.message))
  await page.waitForSelector('[data-ourgeo-id="toolbar.settings"]', { timeout: 60000 })
  assert.equal(resolve(await app.evaluate(({ app }) => app.getPath('userData'))), resolve(data))
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setFullScreen(true); w.show(); w.focus() })
  await page.setViewportSize({ width: 1400, height: 950 })
}
async function close() { if (app) { await page.evaluate(() => window.electronAPI.app.confirmQuit()).catch(() => undefined); await app.close().catch(() => undefined); app = undefined } }
async function checked() {
  await waitForAsync(page, async () => !!(await window.electronAPI.updates.status()).checkedAt, undefined, { timeout: 20000 })
  await wait(400)
}
async function manual() {
  await click(page.locator('[data-ourgeo-id="toolbar.settings"]'))
  await click(page.getByRole('button', { name: 'Updates', exact: true }))
  await click(page.locator('[data-ourgeo-id="settings.checkUpdates"]'))
  await dialog().waitFor()
  await page.waitForFunction(() => !document.querySelector('[data-ourgeo-id="updates.checkAgain"]')?.disabled)
}
try {
  await launch(); await dialog().waitFor({ timeout: 20000 }); await shot('startup-update')
  assert.match(await dialog().innerText(), /2\.0\.0 is available/)
  assert.equal(await app.evaluate(() => global.__updateOpened.length), 0)
  assert.deepEqual(requests.map(req => req.method), ['GET', 'HEAD'])
  await click(page.locator('[data-ourgeo-id="updates.download"]'))
  await page.getByText(/download was opened in your browser/).waitFor()
  assert.deepEqual(await app.evaluate(() => global.__updateOpened), ['https://ourgeo.dev/download.php?file=ouRGeo-2.0.0.AppImage'])
  await page.waitForFunction(() => document.body.innerText.includes('R session ready.'), { timeout: 30000 })
  await shot('update-instructions')
  assert(!page.isClosed())
  const projectPath = join(directory, 'update-save.ourgeoproj')
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, projectPath)
  await click(page.locator('[data-ourgeo-id="updates.saveProject"]'))
  await page.getByText('Project saved.', { exact: true }).waitFor()
  assert((await readFile(projectPath)).byteLength > 0)
  await click(page.locator('[data-ourgeo-id="updates.later"]')); await dialog().waitFor({ state: 'hidden' })
  const input = page.getByPlaceholder(/Type R code/)
  await input.fill('update_save_fixture <- 42'); await input.press('Enter')
  await page.getByTitle('Unsaved changes', { exact: true }).waitFor()
  await manual(); await click(page.locator('[data-ourgeo-id="updates.closeApp"]'))
  await page.getByRole('heading', { name: 'Unsaved changes', exact: true }).waitFor()
  await shot('close-save-prompt')
  await click(page.getByRole('button', { name: 'Cancel', exact: true }))
  assert(!page.isClosed())
  await manual(); await click(page.locator('[data-ourgeo-id="updates.skipVersion"]')); await dialog().waitFor({ state: 'hidden' })
  assert.equal(JSON.parse(await readFile(join(data, 'app-updates.json'), 'utf8')).skippedVersion, '2.0.0')
  report.checks.push('Startup prompt only after a newer compatible published installer; source-only versions ignored; GET metadata and HEAD validation only; official download requires a click; browser hand-off and install steps; Later and Skip version')
  report.checks.push('Real R session connects; Save project writes a bundle; Close ouRGeo preserves the normal unsaved-project prompt and Cancel keeps the workspace open')
  await close(); requests.length = 0
  await launch(); await checked(); assert.equal(await dialog().count(), 0)
  await manual(); assert.match(await dialog().innerText(), /2\.0\.0 is available/)
  await click(page.getByRole('button', { name: 'Close updates', exact: true }))
  await click(page.locator('[data-ourgeo-id="toolbar.settings"]')); await click(page.getByRole('button', { name: 'Updates', exact: true }))
  await click(page.locator('[data-ourgeo-id="updates.automatic"]'))
  await waitForAsync(page, async () => !(await window.electronAPI.updates.status()).preferences.automatic)
  await shot('updates-settings')
  await close(); requests.length = 0
  await launch(); await wait(3600); assert.equal(requests.length, 0); assert.equal(await dialog().count(), 0)
  await manual(); assert.match(await dialog().innerText(), /2\.0\.0 is available/)
  report.checks.push('Skip version survives restart; explicit manual check bypasses skip; disabled automatic checking makes zero startup network requests; manual checks still work')
  await close()
  await writeFile(join(data, 'app-updates.json'), JSON.stringify({ automatic: true, skippedVersion: '2.0.0' }))
  release = '2.0.1'; requests.length = 0
  await launch(); await dialog().waitFor({ timeout: 20000 }); assert.match(await dialog().innerText(), /2\.0\.1 is available/)
  report.checks.push('Skipping one version does not hide a newer release')
  await close()
  release = '2.0.0'; requests.length = 0
  await launch('2.0.0'); await checked(); assert.equal(await dialog().count(), 0); assert.deepEqual(requests.map(req => req.method), ['GET'], JSON.stringify({ status: await page.evaluate(() => window.electronAPI.updates.status()), network: await app.evaluate(() => global.__updateErrors) }))
  await manual(); assert.match(await dialog().innerText(), /Latest published installer/); await shot('already-current')
  report.checks.push('Current version is quiet at startup, with an accurate manual status and no binary probe')
  await close(); fixture = 'offline'; requests.length = 0
  await launch(); await checked(); assert.equal(await dialog().count(), 0)
  await manual(); await page.getByRole('alert').waitFor(); await shot('offline-manual-retry')
  assert.equal(await app.evaluate(() => global.__updateOpened.length), 0)
  report.checks.push('Offline startup is silent; manual failure gives a retry path')
  await close(); fixture = 'available'; requests.length = 0
  await launch('1.0.0', false); await wait(3600); assert.equal(requests.length, 0); assert.equal(await dialog().count(), 0)
  await manual(); assert.match(await dialog().innerText(), /running ouRGeo from source/)
  assert.equal(await page.locator('[data-ourgeo-id="updates.download"]').count(), 0)
  report.checks.push('Development startup makes zero requests; manual source-build guidance does not offer an installer')
  assert.deepEqual(report.rendererErrors, [])
  report.passed = true
} catch (error) { report.error = error.stack; process.exitCode = 1; if (page && !page.isClosed()) await shot('failure').catch(() => undefined) }
finally { await close(); await new Promise(resolve => server.close(resolve)); await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)) }
