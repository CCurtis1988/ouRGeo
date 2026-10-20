/* global window, document, Image */
// Check native X11 icon pixels, not just a screenshot of the web contents.
import { _electron as electron } from 'playwright-core'
import electronExecutable from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, chmod, writeFile, readFile, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const run = promisify(execFile)
const root = resolve(import.meta.dirname, '..'), output = join(root, '.cache/app-icons-ui')
await mkdir(output, { recursive: true })
const directory = await mkdtemp(join(output, 'run-')), data = join(directory, 'profile')
await mkdir(data); await chmod(data, 0o700)
await writeFile(join(data, '.context-acceptance'), 'synthetic-context-profile-v1\n', { mode: 0o600 })
await writeFile(join(data, 'health-check.json'), JSON.stringify({ prompted: true, report: null }))
const packaged = process.argv[2] ? resolve(process.argv[2]) : null
const wrapper = join(directory, 'launch.cjs')
await writeFile(wrapper, `const {app,session}=require('electron');app.setPath('userData',${JSON.stringify(data)});app.on('ready',()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>callback({cancel:!['127.0.0.1','localhost','[::1]'].includes(new URL(details.url).hostname)})));require(${JSON.stringify(join(root, 'out/main/index.js'))});`)
const report = { directory, packaged: !!packaged, passed: false, icons: [], rendererErrors: [], limitations: ['Linux X11 verification; Windows/macOS native appearance and Wayland desktop integration remain deferred. No system launcher caches or pinned shortcuts are changed.'] }
let app, page, child
let rProcesses = []
const step = message => console.log(message)
try {
  // Packaged launches use an isolated XDG_CONFIG_HOME, without replacing the
  // actual installed application or opening the user's profile.
  step('Launching disposable app')
  app = await electron.launch({ executablePath: packaged ?? electronExecutable, args: ['--no-sandbox', '--ozone-platform=x11', ...(!packaged ? [wrapper] : [])], cwd: root,
    env: { ...process.env, XDG_CONFIG_HOME: data, OURGEO_CONTEXT_TEST_PROFILE: await realpath(data) }, timeout: 60000 })
  child = app.process()
  child.stderr.on('data', data => console.log(String(data).trim()))
  step('App launched')
  page = app.windows().find(item => !item.url().startsWith('devtools:')) ?? await app.firstWindow()
  page.on('pageerror', error => report.rendererErrors.push(error.message))
  await page.waitForSelector('[data-ourgeo-id="toolbar.settings"]', { timeout: 60000 })
  await page.waitForFunction(() => document.body.innerText.includes('R session ready.'), { timeout: 30000 })
  const children = await run('ps', ['-o', 'pid=,args=', '--ppid', String(child.pid)])
  rProcesses = children.stdout.split('\n').filter(line => line.includes('/r/server.R')).map(line => Number(line.trim().split(/\s+/)[0]))
  step('Workspace and R ready')
  assert.equal(resolve(await app.evaluate(({ app }) => app.getPath('userData'))), resolve(data))
  const favicon = await page.locator('link[rel="icon"]').getAttribute('href')
  assert(favicon?.includes('app-icon'))
  assert.equal(await page.evaluate(async () => { const link = document.querySelector('link[rel="icon"]'); const image = new Image(); image.src = link.href; await image.decode(); return image.naturalWidth }), 32)
  await page.evaluate(async () => {
    await window.electronAPI.plot.openPopout({ dataUrl: null, plotId: null, index: 0, total: 0 })
    await window.electronAPI.widget.openPopout('app-icon-fixture')
  })
  step('Popouts created')
  const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ title: window.getTitle(), id: window.getNativeWindowHandle().readUInt32LE(0) })))
  assert.equal(windows.length, 3)
  const bitmap = Buffer.from(await app.evaluate(({ nativeImage }, path) => nativeImage.createFromPath(path).toBitmap().toString('base64'), join(root, 'build/icon.png')), 'base64')
  for (const pixel of [0, 1023, 1023 * 1024, 1024 * 1024 - 1]) assert.equal(bitmap[pixel * 4 + 3], 0, 'Logo corners must be transparent')
  assert.equal(bitmap[(512 * 1024 + 512) * 4 + 3], 255, 'Logo artwork must stay opaque')
  for (const window of windows) {
    step(`Inspecting ${window.title}`)
    const { stdout } = await run('xprop', ['-id', `0x${window.id.toString(16)}`, '-len', '16000000', '-f', '_NET_WM_ICON', '32c', '_NET_WM_ICON'], { timeout: 15000, maxBuffer: 24 * 1024 * 1024 })
    const values = stdout.slice(stdout.indexOf('=') + 1).match(/\d+/g)?.map(Number) ?? []
    assert.deepEqual(values.slice(0, 2), [1024, 1024], `${window.title}: missing native icon`)
    assert.equal(values.length, 1024 * 1024 + 2)
    // X11 stores ARGB integers; nativeImage's bitmap is BGRA on little endian.
    for (let pixel = 0; pixel < 1024 * 1024; pixel += 7919) assert.equal(values[pixel + 2], bitmap.readUInt32LE(pixel * 4), `${window.title}: wrong icon artwork at ${pixel}`)
    const { stdout: identity } = await run('xprop', ['-id', `0x${window.id.toString(16)}`, 'WM_CLASS'])
    // An external launch.cjs wrapper has Electron's own bootstrap identity;
    // only a real packaged launch can prove desktop-entry grouping.
    if (packaged) assert(identity.includes('"ourgeo"'), identity)
    report.icons.push({ title: window.title, size: 1024, checkedPixels: 133, identity: identity.trim() })
  }
  await page.screenshot({ path: join(directory, 'workspace.png'), animations: 'disabled' })
  await writeFile(join(directory, 'native-icon.png'), await readFile(join(root, 'build/icon.png')))
  assert.deepEqual(report.rendererErrors, [])
  report.passed = true
} catch (error) { report.error = error.stack; process.exitCode = 1 }
finally {
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  if (app) {
    await Promise.race([(async () => { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined); await app.close().catch(() => undefined) })(), new Promise(resolve => setTimeout(resolve, 10000))])
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
  for (const pid of rProcesses) { try { process.kill(pid, 'SIGTERM') } catch { /* Normal exit already stopped this test's R child. */ } }
  // A disconnected Playwright inspector can retain sockets after Electron has
  // exited. This standalone driver has already written its report and cleaned
  // its owned processes; do not leave the verification shell waiting forever.
  process.exit(process.exitCode ?? 0)
}
