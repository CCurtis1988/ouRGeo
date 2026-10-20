/* global window, getComputedStyle */
// Native mouse gestures against the built app, with a version-one saved layout.
import { _electron as electron } from 'playwright-core'
import electronExecutable from 'electron'
import { mkdir, mkdtemp, writeFile, readFile, chmod, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
const root = resolve(import.meta.dirname, '..'), output = join(root, '.cache/pane-docking-ui')
await mkdir(output, { recursive: true })
const directory = await mkdtemp(join(output, 'run-')), profile = join(directory, 'profile'), data = join(profile, 'ourgeo'), temporary = join(directory, 'tmp')
await mkdir(data, { recursive: true }); await chmod(data, 0o700); await mkdir(temporary)
await writeFile(join(data, '.context-acceptance'), 'synthetic-context-profile-v1\n', { mode: 0o600 })
await writeFile(join(data, 'health-check.json'), JSON.stringify({ prompted: true, report: null }))
const zone = (order, size, axis = 'row', mode = 'split') => ({ order, size, axis, mode, weights: Object.fromEntries(order.map(id => [id, 1])), active: order[0] ?? null })
await writeFile(join(data, 'layout.json'), JSON.stringify({ layout: { version: 1, zones: { left: zone(['environment', 'packages'], 260, 'col'), center: zone(['editor', 'editor#2'], 0), right: zone([], 400), bottom: zone(['console', 'terminal', 'projectFiles'], 240, 'row', 'tabs') }, open: { editor: true, 'editor#2': true, environment: true, packages: true, console: true, terminal: true, projectFiles: true }, toolbar: { order: [], hidden: [] } }, presets: [], dragEnabled: true }))
const tabs = ['editor', 'editor#2'].map((panelId, index) => ({ id: `dock-${index}`, panelId, fileName: `Workspace ${index + 1}.R`, language: 'r', content: `# Document ${index + 1}\nvalue <- ${index + 1}\n`, savedContent: `# Document ${index + 1}\nvalue <- ${index + 1}\n`, filePath: null, isDirty: false, type: 'code', viewMode: 'source' }))
await writeFile(join(data, 'session.json'), JSON.stringify({ tabs, activeTabId: tabs[0].id, activeByPanel: { editor: tabs[0].id, 'editor#2': tabs[1].id }, untitledCounter: 1 }))
const wrapper = join(profile, 'launch.cjs')
await writeFile(wrapper, `const {app,session}=require('electron');app.setPath('userData',${JSON.stringify(data)});app.on('ready',()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>callback({cancel:!['127.0.0.1','localhost','[::1]'].includes(new URL(details.url).hostname)})));require(${JSON.stringify(join(root, 'out/main/index.js'))});`)
const report = { directory, passed: false, checks: [], screenshots: [], rendererErrors: [] }
let app, page
const click = locator => locator.evaluate(el => el.click())
const panel = id => page.locator(`[data-panel-id="${id}"]`)
const grip = id => page.locator(`[data-ourgeo-id="panel.grip.${id}"]`)
const menu = () => page.locator('[data-ourgeo-id="layout.dropDialog"]')
const saved = async () => JSON.parse(await readFile(join(data, 'layout.json'), 'utf8')).layout
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function launch() {
  app = await electron.launch({ executablePath: electronExecutable, args: ['--no-sandbox', '--ozone-platform=x11', wrapper], cwd: root, env: { ...process.env, TMPDIR: temporary, XDG_CONFIG_HOME: profile, OURGEO_CONTEXT_TEST_PROFILE: await realpath(data) }, timeout: 60000 })
  page = app.windows().find(item => !item.url().startsWith('devtools:')) ?? await app.firstWindow()
  page.on('pageerror', error => report.rendererErrors.push(error.message))
  await page.waitForSelector('[data-panel-id="editor"]', { timeout: 60000 })
  assert.equal(resolve(await app.evaluate(({ app }) => app.getPath('userData'))), resolve(data))
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setFullScreen(true); w.show(); w.focus() })
  await page.setViewportSize({ width: 1600, height: 1000 })
}
async function close() { if (app) { await page.evaluate(() => window.electronAPI.app.confirmQuit()).catch(() => undefined); await app.close().catch(() => undefined); app = undefined } }
async function shot(name) { const path = join(directory, `${name}.png`); await page.screenshot({ path, animations: 'disabled', caret: 'hide' }); report.screenshots.push(path) }
async function drag(source, target, tab = false) {
  const from = await (tab ? page.locator(`[data-pane-tab="${source}"]`) : grip(source)).boundingBox(), to = await panel(target).boundingBox()
  assert(from && to, `Missing drag endpoints ${source} -> ${target}`)
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 16 })
}
async function drop(source, target, tab = false) { await drag(source, target, tab); await page.mouse.up(); await menu().waitFor() }
async function choice(axis, side) { await click(page.locator(`[data-ourgeo-id="layout.drop${axis}"]`)); await shot(`${axis.toLowerCase()}-preview`); await click(page.locator(`[data-ourgeo-id="layout.drop.${side}"]`)); await menu().waitFor({ state: 'hidden' }); await wait(350) }
async function savedTree() { for (let i = 0; i < 80; i++) { const layout = await saved(); if (layout.zones.center.tree) return layout; await wait(50) } throw new Error('Grouped layout did not save') }
try {
  await launch(); await shot('initial-version-one')
  await drag('editor#2', 'editor')
  const target = page.locator('[data-drop-panel="editor"]')
  assert.notEqual(await target.evaluate(el => getComputedStyle(el).borderTopColor), 'rgba(0, 0, 0, 0)')
  await shot('highlighted-target')
  await page.mouse.up(); await menu().waitFor(); await shot('drop-menu')
  await page.keyboard.press('Escape'); await menu().waitFor({ state: 'hidden' })
  assert.equal((await saved()).zones.center.tree, undefined)
  await drop('editor#2', 'editor'); await choice('Vertical', 'right')
  let a = await panel('editor').boundingBox(), b = await panel('editor#2').boundingBox()
  assert(b.x > a.x + a.width - 8); assert(Math.abs(a.y - b.y) < 4)
  await drop('console', 'editor#2', true); await choice('Horizontal', 'bottom')
  const c = await panel('console').boundingBox(); b = await panel('editor#2').boundingBox(); a = await panel('editor').boundingBox()
  assert(c.y > b.y + b.height - 8); assert(Math.abs(c.x - b.x) < 4); assert(a.height > b.height * 1.5)
  await shot('mixed-splits')
  await drop('environment', 'console'); await click(page.locator('[data-ourgeo-id="layout.dropTabs"]')); await menu().waitFor({ state: 'hidden' })
  await page.locator('[data-pane-tab="environment"]').waitFor(); await shot('tab-group')
  await click(page.locator('[data-pane-tab="console"]')); await panel('console').waitFor()
  await drag('packages', 'console')
  const tabHeader = await page.locator('[data-pane-tab="console"]').boundingBox()
  assert(tabHeader); await page.mouse.move(tabHeader.x + tabHeader.width / 2, tabHeader.y + tabHeader.height / 2); await page.mouse.up(); await menu().waitFor()
  await choice('Vertical', 'left')
  assert.equal(await page.locator('[data-pane-tab="environment"]').count(), 1)
  await drop('environment', 'editor', true); await click(page.locator('[data-ourgeo-id="layout.dropTabs"]')); await menu().waitFor({ state: 'hidden' })
  await click(page.locator('[data-pane-tab="editor"]')); await panel('editor').waitFor()
  await shot('tab-extracted')
  // Resizing a local split changes its own two boxes.
  const divider = page.getByRole('separator', { name: 'Resize pane split' }).first(), rect = await divider.boundingBox()
  assert(rect)
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down(); await page.mouse.move(rect.x + 50, rect.y + rect.height / 2, { steps: 8 }); await page.mouse.up()
  await wait(400)
  await divider.dblclick(); await wait(350)
  const firstEditor = await panel('editor').boundingBox(), secondEditor = await panel('editor#2').boundingBox()
  assert(Math.abs(firstEditor.width - secondEditor.width) < 8, 'Double-click restores equal split widths')
  const before = await savedTree()
  await drag('packages', 'console'); await page.keyboard.press('Escape'); await page.mouse.up()
  assert.equal(await menu().count(), 0)
  assert.deepEqual(await saved(), before)
  // Empty-zone targets retain their direct placement gesture.
  const source = await grip('packages').boundingBox()
  await page.mouse.move(source.x + 7, source.y + 7); await page.mouse.down(); await page.mouse.move(source.x + 40, source.y + 30, { steps: 5 })
  const empty = await page.locator('[data-drop-zone="right"]').boundingBox()
  assert(empty); await page.mouse.move(empty.x + empty.width / 2, empty.y + empty.height / 2, { steps: 8 }); await page.mouse.up(); await wait(400)
  assert((await saved()).zones.right.order.includes('packages'))
  const persisted = await savedTree()
  assert.equal(persisted.version, 2)
  report.checks.push('Version-one migration; target border highlight; cancellation before commit; real mouse vertical/horizontal drops; local mixed axes; existing tab groups retained; dragging a tab out; local resize; Escape during drag; direct empty-zone drop')
  await close(); await launch()
  await page.locator('[data-pane-tab="editor"]').waitFor()
  const reopened = await saved()
  assert.deepEqual(reopened.zones.center.tree, persisted.zones.center.tree)
  await shot('reopened-groups')
  report.checks.push('Grouped arrangement survives native restart; no renderer exceptions')
  assert.deepEqual(report.rendererErrors, [])
  report.passed = true
} catch (error) { report.error = error.stack; process.exitCode = 1; if (page && !page.isClosed()) await shot('failure').catch(() => undefined) }
finally { await close(); await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)) }
