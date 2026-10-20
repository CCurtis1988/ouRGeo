/* global window, document, getComputedStyle */
// Isolated native verification: preferences, both editor panes and collection navigation.
import { _electron as electron } from 'playwright-core'
import electronExecutable from 'electron'
import { mkdir, mkdtemp, writeFile, readFile, chmod, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
const root = resolve(import.meta.dirname, '..')
const output = join(root, '.cache/theme-appearance')
await mkdir(output, { recursive: true })
const directory = await mkdtemp(join(output, 'run-')), profile = join(directory, 'profile'), data = join(profile, 'ourgeo'), temporary = join(directory, 'tmp')
await mkdir(data, { recursive: true }); await chmod(data, 0o700); await mkdir(temporary)
await writeFile(join(data, '.context-acceptance'), 'synthetic-context-profile-v1\n', { mode: 0o600 })
await writeFile(join(data, 'health-check.json'), JSON.stringify({ prompted: true, report: null }))
await writeFile(join(data, 'theme.json'), JSON.stringify({ theme: 'field-linen', codeTheme: 'field-linen', markdownTheme: 'field-linen', uiScale: 1 }))
await writeFile(join(data, 'theme-backgrounds.json'), JSON.stringify({ version: 1, preferences: { 'field-linen': { selectedIds: ['default'], intervalSeconds: 75 } } }))
const zone = (order, size) => ({ order, size, axis: 'row', mode: 'split', weights: Object.fromEntries(order.map(id => [id, 1])), active: order[0] ?? null })
await writeFile(join(data, 'layout.json'), JSON.stringify({ layout: { version: 1, zones: { left: zone([], 260), center: zone(['editor', 'editor#2'], 0), right: zone([], 400), bottom: zone(['console'], 180) }, open: { editor: true, 'editor#2': true, console: true }, toolbar: { order: [], hidden: [] } }, presets: [], dragEnabled: false }))
const tabs = ['editor', 'editor#2'].map((panelId, i) => ({ id: `appearance-${i}`, panelId, fileName: `Project notes ${i}.R`, language: 'r', content: '# Project notes\n\nflow <- 1.25\nsummary(flow)\n', filePath: null, savedContent: '# Project notes\n\nflow <- 1.25\nsummary(flow)\n', isDirty: false, type: 'code', viewMode: 'source' }))
await writeFile(join(data, 'session.json'), JSON.stringify({ tabs, activeTabId: tabs[0].id, activeByPanel: { editor: tabs[0].id, 'editor#2': tabs[1].id }, untitledCounter: 1 }))
const wrapper = join(profile, 'launch.cjs')
await writeFile(wrapper, `const {app,session}=require('electron');app.setPath('userData',${JSON.stringify(data)});app.on('ready',()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>callback({cancel:!['127.0.0.1','localhost','[::1]'].includes(new URL(details.url).hostname)})));require(${JSON.stringify(join(root, 'out/main/index.js'))});`)
const report = { directory, passed: false, screenshots: [], rendererErrors: [], checks: [] }
let app, page
const click = locator => locator.evaluate(element => element.click())
const saved = async () => JSON.parse(await readFile(join(data, 'theme-backgrounds.json'), 'utf8')).preferences
async function launch() {
  app = await electron.launch({ executablePath: electronExecutable, args: ['--no-sandbox', '--ozone-platform=x11', wrapper], cwd: root, env: { ...process.env, TMPDIR: temporary, XDG_CONFIG_HOME: profile, OURGEO_CONTEXT_TEST_PROFILE: await realpath(data) }, timeout: 60000 })
  page = app.windows().find(item => !item.url().startsWith('devtools:')) ?? await app.firstWindow()
  page.on('pageerror', error => report.rendererErrors.push(error.message))
  await page.waitForSelector('[data-ourgeo-id="toolbar.settings"]', { timeout: 60000 })
  assert.equal(resolve(await app.evaluate(({ app }) => app.getPath('userData'))), resolve(data))
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setFullScreen(true); w.show(); w.focus() })
  await page.setViewportSize({ width: 1600, height: 1000 })
}
async function close() { if (app) { await page.evaluate(() => window.electronAPI.app.confirmQuit()).catch(() => undefined); await app.close().catch(() => undefined); app = undefined } }
async function settings() { await click(page.locator('[data-ourgeo-id="toolbar.settings"]')) }
async function dismiss() { await click(page.getByRole('button', { name: 'Close settings', exact: true })) }
async function shot(name) { const path = join(directory, `${name}.png`); await page.screenshot({ path, animations: 'disabled', caret: 'hide' }); report.screenshots.push(path) }
async function panes(value) {
  await page.waitForFunction(value => {
    const panes = [...document.querySelectorAll('[data-theme-background]')]
    return panes.length === 2 && panes.every(pane => Math.abs(Number(getComputedStyle(pane).opacity) - value / 100) < .001 && (value === 35 || getComputedStyle(pane).filter === 'none') && pane.querySelector('img:last-child')?.naturalWidth === 1600)
  }, value)
}
async function strength(value) {
  const slider = page.getByRole('slider', { name: 'Background visibility' })
  await slider.focus()
  await slider.press(value === 100 ? 'End' : 'Home')
  if (value !== 100) for (let i = 0; i < value; i++) await slider.press('ArrowRight')
  await page.waitForFunction(value => document.querySelector('[data-ourgeo-id="themeBackgrounds.visibility"]').value === String(value), value)
  await panes(value)
  for (let tries = 0; tries < 100; tries++) { if (Object.values(await saved()).some(p => p.imageStrength === value)) return; await new Promise(resolve => setTimeout(resolve, 30)) }
  throw new Error(`Visibility ${value} was not saved`)
}
try {
  await launch(); await panes(35); await shot('linen-default-35')
  await settings()
  assert.deepEqual(await page.getByRole('tab', { name: /^(Illustrated|Legacy|Field collection|Custom)$/ }).allTextContents(), ['Illustrated', 'Legacy', 'Field collection', 'Custom'])
  assert.equal(await page.getByRole('tab', { name: 'Field collection' }).getAttribute('aria-selected'), 'true')
  await shot('appearance-four-tabs')
  await strength(0); await dismiss(); await shot('linen-faded-0')
  await settings(); await strength(100); await dismiss(); await shot('linen-original-100')
  await settings(); await click(page.getByRole('button', { name: 'Glacier', exact: true })); await strength(0); await dismiss(); await panes(0)
  await settings(); await click(page.getByRole('button', { name: 'Linen', exact: true })); await panes(100)
  await click(page.locator('[data-ourgeo-id="themeBackgrounds.resetVisibility"]'))
  await panes(35)
  let preferences = await saved()
  assert.deepEqual(preferences['field-linen'], { selectedIds: ['default'], intervalSeconds: 75 })
  assert.equal(preferences['field-glacier'].imageStrength, 0)
  await click(page.locator('[data-ourgeo-id="settings.themeBackgrounds"]'))
  await page.locator('[data-ourgeo-id="themeBackgrounds.dialog"]').waitFor()
  assert.equal(await page.getByRole('slider', { name: 'Background visibility' }).inputValue(), '35')
  await strength(100); await shot('gallery-visibility')
  await click(page.getByRole('button', { name: 'Done', exact: true }))
  await settings(); await click(page.locator('[data-ourgeo-id="settings.themeStudio"]'))
  const dialog = page.getByRole('dialog')
  const summaries = dialog.locator('details > summary')
  assert.deepEqual(await summaries.allTextContents(), ['Illustrated', 'Legacy', 'Field collection', 'Custom'])
  assert.equal(await summaries.filter({ hasText: 'Field collection' }).evaluate(el => el.parentElement.open), true)
  await shot('studio-four-groups')
  report.checks.push('Four collection tabs; keyboard visibility endpoints; both editor panes; independent themes; reset preserves selection/timing; shared gallery control; four Studio groups')
  await close(); await launch(); await panes(100)
  preferences = await saved()
  assert.equal(preferences['field-linen'].imageStrength, 100); assert.equal(preferences['field-glacier'].imageStrength, 0)
  report.checks.push('100% and 0% survive native app restart')
  assert.deepEqual(report.rendererErrors, [])
  report.passed = true
} catch (error) { report.error = error.stack; if (page && !page.isClosed()) await shot('failure').catch(() => undefined); process.exitCode = 1 }
finally { await close(); await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)) }
