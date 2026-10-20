/* global window, document, getComputedStyle */
// Drive the shipped theme picker/gallery against real offline artwork. Disposable
// profiles keep the developer's theme, folders and R session out of this check.
import { _electron as electron } from 'playwright-core'
import electronExecutable from 'electron'
import { mkdir, mkdtemp, writeFile, readFile, chmod, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const root = resolve(import.meta.dirname, '..'), output = join(root, '.cache/field-themes-ui')
const packagedAt = process.argv.indexOf('--packaged'), packaged = packagedAt < 0 ? undefined : resolve(process.argv[packagedAt + 1])
const manifest = JSON.parse(await readFile(join(root, 'src/assets/themes/gallery/field-prompts.json'), 'utf8'))
const entries = [
  ['dev', 'Dev'], ['slate', 'Slate'], ['basalt', 'Basalt'], ['forest', 'Forest'], ['trout', 'Trout'],
  ['high-alpine', 'High Alpine'], ['wood', 'Wood'], ['sextant', 'Sextant'], ['glacier', 'Glacier'],
  ['field-notes', 'Field Notes'], ['rainproof', 'Rainproof'], ['albany', 'Albany'], ['linen', 'Linen'],
]
await mkdir(output, { recursive: true })
const directory = await mkdtemp(join(output, 'run-')), profile = join(directory, 'profile'), data = join(profile, 'ourgeo'), temporary = join(directory, 'tmp')
await mkdir(data, { recursive: true }); await chmod(data, 0o700); await mkdir(temporary)
await writeFile(join(data, '.context-acceptance'), 'synthetic-context-profile-v1\n', { mode: 0o600 })
await writeFile(join(data, 'health-check.json'), JSON.stringify({ prompted: true, report: null }))
await writeFile(join(data, 'theme.json'), JSON.stringify({ theme: 'field-dev', codeTheme: 'field-dev', markdownTheme: 'field-dev', uiScale: 1 }))
const zone = (order, size, axis = 'row', mode = 'split') => ({ order, size, axis, mode, weights: Object.fromEntries(order.map(id => [id, 1])), active: order[0] ?? null })
await writeFile(join(data, 'layout.json'), JSON.stringify({ layout: { version: 1, zones: { left: zone([], 260), center: zone(['editor', 'editor#2'], 0), right: zone([], 400), bottom: zone(['console', 'terminal', 'projectFiles'], 180, 'row', 'tabs') }, open: { editor: true, 'editor#2': true, console: true, terminal: true, projectFiles: true }, toolbar: { order: [], hidden: [] } }, presets: [], dragEnabled: false }))
const tabs = [
  { id: 'field-r', panelId: 'editor', fileName: 'Field survey.R', language: 'r', content: '# Field survey\n# Preserve units and site references.\n\nflow <- data.frame(\n  site = c("Upper creek", "Moraine"),\n  discharge_m3_s = c(0.74, 1.28)\n)\n\nif (all(flow$discharge_m3_s > 0)) {\n  summary(flow)\n}\n' },
  { id: 'field-md', panelId: 'editor#2', fileName: 'Field notes.md', language: 'markdown', content: '# Field notes\n\n## River measurements\n\n- Keep **units** with each observation.\n- Record the weather and source.\n\n> Wet rock, cold water, clear evidence.\n\nUse `discharge_m3_s` for flow.\n\n[Survey reference](https://example.invalid)\n' },
].map(tab => ({ ...tab, filePath: null, savedContent: tab.content, isDirty: false, type: 'code', viewMode: 'source' }))
await writeFile(join(data, 'session.json'), JSON.stringify({ tabs, activeTabId: 'field-r', activeByPanel: { editor: 'field-r', 'editor#2': 'field-md' }, untitledCounter: 1 }))
const report = { measuredAt: new Date().toISOString(), directory, packaged, version: JSON.parse(await readFile(join(root, 'package.json'))).version, passed: false, cases: [], screenshots: [], rendererErrors: [], checks: {} }
let app, page
const click = locator => locator.evaluate(element => element.click())
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
function textContrast(foreground, background) {
  const luminance = colour => colour.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
  const a = luminance(foreground), b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
async function checkHoveredFills() {
  const results = []
  for (const fill of ['accent', 'error']) {
    await page.evaluate(fill => {
      const button = document.createElement('button')
      button.id = 'field-hover-probe'
      button.textContent = 'Colour check'
      button.className = `bg-geo-${fill} text-white hover:bg-geo-${fill}/80`
      button.style.cssText = 'position:fixed;left:8px;top:8px;width:100px;height:30px;z-index:2147483647;pointer-events:auto'
      // Radix intentionally makes body siblings inert while the Studio is open.
      // Keep the temporary CSS probe inside that modal's pointer scope.
      ;(document.querySelector('[role="dialog"]') ?? document.body).append(button)
    }, fill)
    const probe = page.locator('#field-hover-probe')
    await probe.hover()
    const colours = await probe.evaluate(element => ({ foreground: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }))
    const ratio = textContrast(colours.foreground, colours.background)
    assert(ratio >= 4.5, `${fill} hover contrast ${ratio}`)
    results.push({ fill, ...colours, ratio })
    await probe.evaluate(element => element.remove())
  }
  return results
}
async function shot(name) {
  const path = join(directory, `${name}.png`)
  await page.screenshot({ path, animations: 'disabled', caret: 'hide' })
  report.screenshots.push(path)
}
async function settings() { await click(page.locator('[data-ourgeo-id="toolbar.settings"]')) }
async function select(slug, label) {
  await settings()
  await click(page.locator('[data-ourgeo-id="settings.fieldThemes"]'))
  await click(page.getByRole('button', { name: label, exact: true }).first())
  await click(page.getByRole('button', { name: 'Close settings', exact: true }))
  await page.waitForFunction(id => document.documentElement.dataset.geoThemeCollection === 'field' && [...document.querySelectorAll('[data-theme-background]')].length === 2 && [...document.querySelectorAll('[data-theme-background]')].every(element => {
    const image = element.querySelector('img:last-child')
    return image?.complete && image.naturalWidth === 1600 && image.src.includes(`${id}-`)
  }), `field-${slug}`)
}
async function gallery() { await settings(); await click(page.locator('[data-ourgeo-id="settings.themeBackgrounds"]')); await page.locator('[data-ourgeo-id="themeBackgrounds.dialog"]').waitFor() }
async function idle() { await page.waitForFunction(() => !document.querySelector('[data-ourgeo-id="themeBackgrounds.reset"]')?.disabled) }
try {
  const wrapper = join(profile, 'launch.cjs')
  await writeFile(wrapper, `const {app,session}=require('electron');app.setPath('userData',${JSON.stringify(data)});app.on('ready',()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>callback({cancel:!['127.0.0.1','localhost','[::1]'].includes(new URL(details.url).hostname)})));require(${JSON.stringify(join(root, 'out/main/index.js'))});`)
  app = await electron.launch({ executablePath: packaged ?? electronExecutable, args: ['--no-sandbox', ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : []), ...(packaged ? [] : [wrapper])], cwd: root, env: { ...process.env, TMPDIR: temporary, XDG_CONFIG_HOME: profile, OURGEO_CONTEXT_TEST_PROFILE: await realpath(data) }, timeout: 60_000 })
  if (packaged) await app.evaluate(({ session }) => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => callback({ cancel: !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(details.url).hostname) })))
  page = app.windows().find(item => !item.url().startsWith('devtools:')) ?? await app.firstWindow()
  page.on('pageerror', error => report.rendererErrors.push(error.message))
  app.process().stderr.on('data', chunk => { void writeFile(join(directory, 'stderr.log'), chunk, { flag: 'a' }) })
  await page.waitForSelector('[data-ourgeo-id="toolbar.settings"]', { timeout: 60_000 })
  assert.equal(resolve(await app.evaluate(({ app }) => app.getPath('userData'))), resolve(data))
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setFullScreen(true); window.show(); window.focus() })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  for (const [slug, label] of entries) {
    const id = `field-${slug}`, images = manifest.images.filter(image => image.theme === id).sort((a, b) => a.index - b.index)
    await select(slug, label)
    const metadata = await page.evaluate(() => {
      const buttons = ['accent', 'error'].map(fill => {
        const button = document.createElement('button')
        button.className = `bg-geo-${fill} text-white`
        button.style.cssText = 'position:fixed;left:-10000px;top:0'
        document.body.append(button)
        const style = getComputedStyle(button), colours = { fill, foreground: style.color, background: style.backgroundColor }
        button.remove()
        return colours
      })
      return { collection: document.documentElement.dataset.geoThemeCollection, dark: document.documentElement.classList.contains('dark'), foreground: getComputedStyle(document.documentElement).getPropertyValue('--geo-fg'), syntax: getComputedStyle(document.documentElement).getPropertyValue('--ourgeo-code-keyword'), markdown: getComputedStyle(document.documentElement).getPropertyValue('--ourgeo-md-heading'), buttons, frames: [...document.querySelectorAll('[data-theme-background]')].map(element => ({ id: element.dataset.themeBackground, opacity: getComputedStyle(element).opacity, src: element.querySelector('img:last-child')?.src })) }
    })
    assert.equal(metadata.dark, entries.findIndex(([key]) => key === slug) < 8)
    assert(metadata.syntax.trim() && metadata.markdown.trim())
    for (const button of metadata.buttons) {
      button.ratio = textContrast(button.foreground, button.background)
      assert(button.ratio >= 4.5, `${id} ${button.fill} button label contrast ${button.ratio}`)
    }
    metadata.hoveredButtons = await checkHoveredFills()
    await shot(`${slug}-editors`)
    await gallery()
    const cards = page.locator('[data-ourgeo-id="themeBackgrounds.dialog"] button[aria-pressed]')
    assert.equal(await cards.count(), 6)
    assert.equal(await page.getByRole('button', { name: 'Play GIF preview', exact: true }).count(), 0)
    const decoded = []
    for (const image of images) {
      const card = page.getByRole('button', { name: image.label, exact: true })
      await card.scrollIntoViewIfNeeded(); await click(card)
      await page.waitForFunction(label => { const image = document.querySelector(`img[alt="${label} preview"]`); return image?.complete && image.naturalWidth === 1600 && image.naturalHeight === 900 }, image.label)
      await idle()
      decoded.push({ label: image.label, src: await page.locator('img[alt$=" preview"]').getAttribute('src') })
    }
    await shot(`${slug}-gallery`)
    await click(page.locator('[data-ourgeo-id="themeBackgrounds.reset"]'))
    await idle()
    if (slug === 'dev' || slug === 'linen') {
      await click(page.getByRole('button', { name: images[2].label, exact: true }))
      await idle()
      const interval = page.getByRole('spinbutton', { name: 'Switch every', exact: true })
      await interval.fill('5'); await interval.press('Tab')
      await click(page.getByRole('button', { name: 'Done', exact: true }))
      const initial = await page.locator('[data-theme-background]').first().getAttribute('data-theme-background')
      await page.waitForFunction(initial => document.querySelector('[data-theme-background]')?.dataset.themeBackground !== initial, initial, { timeout: 12_000 })
      report.checks[`${slug}Slideshow`] = true
      await gallery(); await click(page.locator('[data-ourgeo-id="themeBackgrounds.reset"]')); await idle()
    }
    await click(page.getByRole('button', { name: 'Done', exact: true }))
    const saved = JSON.parse(await readFile(join(data, 'theme.json'), 'utf8'))
    assert.equal(saved.theme, id); assert.equal(saved.codeTheme, id); assert.equal(saved.markdownTheme, id)
    report.cases.push({ id, label, metadata, decoded, persistence: saved })
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
  }
  await page.setViewportSize({ width: 1000, height: 900 })
  for (const slug of ['dev', 'forest', 'glacier', 'linen']) { await select(slug, entries.find(([key]) => key === slug)[1]); await shot(`${slug}-narrow-editors`) }
  await settings(); await click(page.locator('[data-ourgeo-id="settings.themeStudio"]'))
  await click(page.getByRole('button', { name: 'Dev · Field', exact: true }))
  await click(page.getByRole('button', { name: 'Duplicate to edit', exact: true }))
  await click(page.getByRole('button', { name: 'Use this theme', exact: true }))
  await page.waitForFunction(() => document.documentElement.dataset.geoThemeCollection === '' && document.documentElement.dataset.geoThemeInks === 'field')
  report.checks.customCopyHoveredButtons = await checkHoveredFills()
  await page.keyboard.press('Escape')
  await page.locator('[role="dialog"]').waitFor({ state: 'hidden' })
  await settings()
  assert.equal(await page.locator('[data-ourgeo-id="settings.customThemes"]').getAttribute('aria-selected'), 'true')
  report.checks.customCopyInCustomCollection = true
  await click(page.getByRole('button', { name: 'Close settings', exact: true }))
  await settings(); await click(page.locator('[data-ourgeo-id="settings.fieldThemes"]')); await shot('field-collection-picker')
  await click(page.locator('[data-ourgeo-id="settings.illustratedThemes"]'))
  await click(page.getByRole('button', { name: 'Forest', exact: true }).first())
  assert.equal(await page.evaluate(() => document.documentElement.dataset.geoThemeCollection), '')
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--geo-on-accent')), '')
  await page.waitForFunction(async () => JSON.parse(await window.electronAPI.file.read(`${await window.electronAPI.app.getDataPath()}/theme.json`)).theme === 'forest')
  assert.equal(JSON.parse(await readFile(join(data, 'theme.json'), 'utf8')).theme, 'forest')
  report.checks.originalForestPreserved = true
  assert.equal(await page.locator('details[open]').count(), 0)
  await click(page.getByRole('button', { name: 'Close settings', exact: true }))
  assert.deepEqual(report.rendererErrors, [])
  assert.equal(report.cases.flatMap(item => item.decoded).length, 78)
  await pause(200)
  report.passed = true
} catch (error) { report.error = error.stack ?? String(error); process.exitCode = 1 }
finally {
  if (app) { await page?.evaluate(() => window.electronAPI.app.confirmQuit()).catch(() => undefined); await app.close().catch(() => undefined) }
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ directory, passed: report.passed, cases: report.cases.length, error: report.error }))
}
