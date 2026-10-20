/* global window, document, Node, getComputedStyle */
// The built renderer, playback controller, native IPC and image protocol remain
// production code. Only native picker results and disposable artwork are fixtures.
import { _electron as electron } from 'playwright-core'
import electronExecutable from 'electron'
import { mkdir, mkdtemp, writeFile, readFile, readdir, rename, symlink, stat, chmod, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { waitForAsync } from './lib/wait-async.mjs'

const root = resolve(import.meta.dirname, '..'), output = join(root, '.cache/theme-backgrounds')
const packaged = process.argv.includes('--packaged') ? resolve(process.argv[process.argv.indexOf('--packaged') + 1]) : undefined
const completeArt = process.argv.includes('--complete-art')
await mkdir(output, { recursive: true })
const directory = await mkdtemp(join(output, 'run-')), profile = join(directory, 'profile'), data = join(profile, 'ourgeo'), temporary = join(directory, 'tmp'), pictures = join(directory, 'Linked artwork'), movedPictures = join(directory, 'Moved artwork')
await mkdir(data, { recursive: true }); await chmod(data, 0o700); await mkdir(temporary); await mkdir(pictures)
const png = join(pictures, 'Field lake.png'), jpeg = join(pictures, 'Terraces.jpg'), gif = join(pictures, 'Peaceful loop.gif'), outside = join(directory, 'Outside private image.png')
const draw = (path, first, second, size = '480x270') => execFileSync('magick', ['-size', size, `gradient:${first}-${second}`, path])
draw(png, '#173e58', '#87aa99', '6000x4000'); draw(jpeg, '#55452d', '#ddad65'); draw(outside, '#703366', '#99bbaa')
execFileSync('magick', ['-delay', '40', '-size', '240x135', 'xc:#203b49', '-delay', '40', '-size', '240x135', 'xc:#416a61', '-loop', '0', gif])
await writeFile(join(pictures, 'Unsupported.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
await writeFile(join(pictures, 'Broken.png'), 'Not an image')
await symlink(outside, join(pictures, 'Outside symlink.png'))
await writeFile(join(data, '.context-acceptance'), 'synthetic-context-profile-v1\n', { mode: 0o600 })
await writeFile(join(data, 'health-check.json'), JSON.stringify({ prompted: true, report: null }))
const zone = (order, size, axis = 'row', mode = 'split') => ({ order, size, axis, mode, weights: Object.fromEntries(order.map(id => [id, 1])), active: order[0] ?? null })
await writeFile(join(data, 'layout.json'), JSON.stringify({ layout: { version: 1, zones: { left: zone([], 260), center: zone(['editor', 'editor#2'], 0), right: zone([], 400), bottom: zone(['console', 'terminal', 'projectFiles'], 210, 'row', 'tabs') }, open: { editor: true, 'editor#2': true, console: true, terminal: true, projectFiles: true }, toolbar: { order: [], hidden: [] } }, presets: [], dragEnabled: false }))
const tabs = [{ id: 'theme-r', fileName: 'Background study.R', panelId: 'editor', language: 'r', content: '# A quiet workspace\n# Project background settings remain independent of syntax colours.\n\nmeasurements <- data.frame(\n  site = c("North shore", "Mountain refuge", "Forest stream"),\n  clearance_m = c(0.65, 0.82, 0.74)\n)\n\nsummary(measurements$clearance_m)\n' }, { id: 'theme-md', fileName: 'Reference notes.md', panelId: 'editor#2', language: 'markdown', content: '# Reference notes\n\nA comfortable workspace keeps the focus on your work.\n\n## Project requirements\n\n- Preserve source material.\n- Keep document and image analysis independent.\n- Make background movement optional.\n\nA fixed image or a quiet slideshow can follow each app theme.\n' }].map(tab => ({ ...tab, filePath: null, savedContent: tab.content, isDirty: false, type: 'code', viewMode: 'source' }))
await writeFile(join(data, 'session.json'), JSON.stringify({ tabs, activeTabId: 'theme-md', activeByPanel: { editor: 'theme-r', 'editor#2': 'theme-md' }, untitledCounter: 1 }))
const report = { version: 1, measuredAt: new Date().toISOString(), directory, mode: packaged ? 'packaged' : 'built', platform: `${process.platform}-${process.arch}`, completeArt, passed: false, checks: {}, screenshots: [], limitations: ['Native picker results are deterministic fixtures; operating-system picker pointer interaction is deferred.', 'Windows and macOS qualification remains deferred until suitable machines are available.', 'Visual editing keeps its existing solid background; source artwork must resume when returning to Source.'] }
const errors = [], consoleErrors = [], consoleErrorDetails = [], blockedRequests = []
let app, page
const click = locator => locator.evaluate(element => element.click())
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
async function launch() {
  const wrapper = join(profile, 'launch.cjs')
  await writeFile(wrapper, `const {app,session}=require('electron');app.setPath('userData',${JSON.stringify(data)});globalThis.themeAcceptanceBlocked=[];app.on('ready',()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>{const deny=!['127.0.0.1','localhost','[::1]'].includes(new URL(details.url).hostname);if(deny)globalThis.themeAcceptanceBlocked.push(details.url);callback({cancel:deny});}));require(${JSON.stringify(join(root, 'out/main/index.js'))});`)
  app = await electron.launch({ executablePath: packaged ?? electronExecutable, args: ['--no-sandbox', ...(packaged ? [] : [wrapper])], cwd: root, env: { ...process.env, TMPDIR: temporary, XDG_CONFIG_HOME: profile, OURGEO_CONTEXT_TEST_PROFILE: await realpath(data) }, timeout: 60_000 })
  app.process().stderr.on('data', chunk => { void writeFile(join(directory, 'stderr.log'), chunk, { flag: 'a' }) })
  // Packaged mode cannot use a wrapper, so install the same deny rule before
  // interacting with any network-capable part of the interface.
  if (packaged) await app.evaluate(({ session }) => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => callback({ cancel: !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(details.url).hostname) })))
  page = app.windows().find(item => !item.url().startsWith('devtools:')) ?? await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') { consoleErrors.push(message.text()); consoleErrorDetails.push({ text: message.text(), location: message.location() }) } })
  await page.waitForSelector('[data-ourgeo-id="project.dropdown"]', { timeout: 60_000 })
  assert.equal(resolve(await app.evaluate(({ app }) => app.getPath('userData'))), resolve(data))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setBounds({ width: 1440, height: 1000 }))
  await page.setViewportSize({ width: 1440, height: 1000 })
  const later = page.getByRole('button', { name: 'Maybe later', exact: true }); if (await later.count()) await click(later)
  await page.waitForFunction(() => document.querySelectorAll('[data-theme-background]').length === 2, undefined, { timeout: 60_000 })
}
async function close() {
  if (!app) return
  blockedRequests.push(...await app.evaluate(() => globalThis.themeAcceptanceBlocked ?? []).catch(() => []))
  await page?.evaluate(() => window.electronAPI.app.confirmQuit()).catch(() => undefined)
  await app.close().catch(() => undefined); app = undefined; page = undefined
}
async function gallery() {
  if (await page.locator('[data-ourgeo-id="themeBackgrounds.dialog"]').count()) return
  await click(page.locator('[data-ourgeo-id="toolbar.settings"]'))
  await click(page.locator('[data-ourgeo-id="settings.themeBackgrounds"]'))
  await page.locator('[data-ourgeo-id="themeBackgrounds.dialog"]').waitFor()
  await page.waitForFunction(() => !document.querySelector('[data-ourgeo-id="themeBackgrounds.linkFolder"]')?.disabled)
}
const done = () => click(page.getByRole('button', { name: 'Done', exact: true }))
const frame = () => page.locator('[data-theme-background]').first().getAttribute('data-theme-background')
const saved = async () => JSON.parse(await readFile(join(data, 'theme-backgrounds.json'), 'utf8'))
async function settleButton(locator, pressed) { await page.waitForFunction(({ name, pressed }) => [...document.querySelectorAll('[data-ourgeo-id="themeBackgrounds.dialog"] button[aria-pressed]')].find(element => element.getAttribute('aria-label') === name)?.getAttribute('aria-pressed') === String(pressed), { name: await locator.getAttribute('aria-label'), pressed }) }
async function only(name) {
  const target = page.getByRole('button', { name, exact: true })
  if (await target.getAttribute('aria-pressed') !== 'true') { await click(target); await settleButton(target, true) }
  const otherNames = await page.locator('[data-ourgeo-id="themeBackgrounds.dialog"] button[aria-pressed="true"]').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')).filter(Boolean))
  for (const other of otherNames.filter(other => other !== name)) { const button = page.getByRole('button', { name: other, exact: true }); await click(button); await settleButton(button, false) }
}
async function pick(path) { await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, path) }
async function shot(name) {
  if (name !== 'failure') await page.waitForFunction(() => {
    const dialog = document.querySelector('[data-ourgeo-id="themeBackgrounds.dialog"]')
    if (!dialog) return [...document.querySelectorAll('[data-theme-background] img')].every(image => image.complete && image.naturalWidth > 0)
    const viewport = dialog.children[1].getBoundingClientRect()
    return [...dialog.querySelectorAll('button[aria-pressed]')].filter(card => {
      const bounds = card.getBoundingClientRect()
      return bounds.bottom > viewport.top && bounds.top < viewport.bottom
    }).every(card => { const image = card.querySelector('img'); return image?.complete && image.naturalWidth > 0 })
  }, undefined, { timeout: 30_000 })
  const path = join(directory, `${name}.png`); await page.screenshot({ path, animations: 'disabled' }); report.screenshots.push(path)
}
async function folderList() { return page.evaluate(() => window.electronAPI.themeBackgrounds.list()) }
async function contrast() {
  return page.evaluate(() => {
    const parse = value => { const channels = value.match(/[\d.]+/g)?.map(Number) ?? []; return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0, channels[3] ?? 1] }
    const over = (front, back) => { const alpha = front[3] + back[3] * (1 - front[3]); return [...front.slice(0, 3).map((channel, i) => (channel * front[3] + back[i] * back[3] * (1 - front[3])) / alpha), alpha] }
    const luminance = colour => colour.slice(0, 3).map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0)
    return [...document.querySelector('[data-ourgeo-id="themeBackgrounds.dialog"]').querySelectorAll('p,label,span,button,h3,h4')].filter(element => element.getClientRects().length && !element.closest('button:disabled') && [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())).map(element => {
      const style = getComputedStyle(element), ancestors = []; for (let current = element; current; current = current.parentElement) ancestors.unshift(current)
      const background = ancestors.reduce((colour, ancestor) => over(parse(getComputedStyle(ancestor).backgroundColor), colour), [255, 255, 255, 1]), foreground = over(parse(style.color), background), a = luminance(foreground), b = luminance(background)
      return { text: element.textContent.trim().slice(0, 100), ratio: Number(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2)) }
    })
  })
}
try {
  const assets = await readdir(join(root, 'src/assets/themes/gallery'))
  report.checks.artwork = Object.fromEntries(['dark', 'bespin', 'neonLights', 'forest', 'midnightDream', 'candyAddiction', 'heaven', 'volcanic', 'arctic', 'retroTerminal'].map(id => [id, { newStills: assets.filter(name => new RegExp(`^${id}-[1-5]\\.webp$`).test(name)).length, loop: assets.includes(`${id}-loop.gif`), poster: assets.includes(`${id}-loop-poster.webp`) }]))
  if (completeArt) for (const [id, art] of Object.entries(report.checks.artwork)) { assert.equal(art.newStills, 5, `${id} must offer the original and five distinct new stills.`); assert(art.loop && art.poster, `${id} needs its loop and static poster.`) }
  await launch(); await shot('initial-dark-two-editors'); await gallery()
  assert.equal(await page.locator('[role="dialog"]').count(), 1, 'The gallery must be a sibling of Settings, with a single modal focus scope.')
  await page.keyboard.press('Tab')
  assert(await page.evaluate(() => document.querySelector('[data-ourgeo-id="themeBackgrounds.dialog"]')?.contains(document.activeElement)), 'Keyboard focus must remain in the gallery.')
  await page.keyboard.press('Escape'); await page.locator('[data-ourgeo-id="themeBackgrounds.dialog"]').waitFor({ state: 'hidden' }); await gallery()
  report.checks.keyboardModalAndEscape = true
  assert.equal(await page.getByRole('button', { name: 'Original artwork', exact: true }).getAttribute('aria-pressed'), 'true')
  assert(await page.getByRole('spinbutton', { name: 'Switch every', exact: true }).isDisabled())
  await shot('dark-gallery'); const darkContrast = await contrast(); assert(darkContrast.every(sample => sample.ratio >= 4.5), JSON.stringify(darkContrast.filter(sample => sample.ratio < 4.5)))
  report.checks.darkTextContrast = { minimum: Math.min(...darkContrast.map(sample => sample.ratio)), samples: darkContrast }
  await pick(pictures); await click(page.getByRole('button', { name: 'Link image folder…', exact: true }))
  await page.getByRole('button', { name: 'Field lake.png', exact: true }).waitFor()
  let linked = (await folderList())[0]
  assert.equal(linked.images.length, 3, 'Only supported regular images should be indexed; malformed images and symlinks stay out.')
  report.checks.scanNames = linked.images.map(image => image.name)
  const photoCard = page.getByRole('button', { name: 'Field lake.png', exact: true })
  await photoCard.scrollIntoViewIfNeeded()
  await page.waitForFunction(() => [...document.querySelectorAll('button[aria-label="Field lake.png"] img')].some(image => image.src.startsWith('blob:') && image.complete && image.naturalWidth === 480 && image.naturalHeight === 320), undefined, { timeout: 30_000 })
  assert.equal(linked.images.find(image => image.name === 'Field lake.png').width, 6000)
  report.checks.largeStaticPhotoUsesBoundedThumbnail = true
  const gifCard = page.getByRole('button', { name: 'Peaceful loop.gif, GIF', exact: true })
  await gifCard.scrollIntoViewIfNeeded()
  await page.waitForFunction(() => [...document.querySelectorAll('button[aria-label="Peaceful loop.gif, GIF"] img')].some(image => image.src.startsWith('blob:') && image.complete && image.naturalWidth > 0), undefined, { timeout: 30_000 })
  const gifPoster = await gifCard.locator('img').getAttribute('src')
  assert(gifPoster.startsWith('blob:'), 'External GIF thumbnails must be actual frozen first frames, not a fallback drawing or a live GIF.')
  report.checks.actualExternalGifPoster = true
  await only('Field lake.png'); const fixedId = linked.images.find(image => image.name === 'Field lake.png').id
  await done(); await page.waitForFunction(id => [...document.querySelectorAll('[data-theme-background]')].every(element => element.getAttribute('data-theme-background') === id), fixedId)
  await page.waitForFunction(() => document.querySelectorAll('[data-theme-background] img').length === 2)
  assert.equal(await page.locator('[data-theme-background] img').count(), 2)
  await pause(5300); assert.equal(await frame(), fixedId); await shot('external-single-fixed')
  report.checks.singleImageStaysFixed = true
  await gallery(); await click(page.getByRole('button', { name: 'Terraces.jpg', exact: true })); await settleButton(page.getByRole('button', { name: 'Terraces.jpg', exact: true }), true)
  const interval = page.getByRole('spinbutton', { name: 'Switch every', exact: true }); await interval.fill('5'); await interval.press('Tab')
  await waitForAsync(page, async () => JSON.parse(await window.electronAPI.file.read(`${await window.electronAPI.app.getDataPath()}/theme-backgrounds.json`)).preferences.dark.intervalSeconds === 5)
  await done(); const firstId = await frame(), switchStarted = Date.now(); await page.waitForFunction(id => document.querySelector('[data-theme-background]')?.getAttribute('data-theme-background') !== id, firstId, { timeout: 8000 })
  const switchElapsedMs = Date.now() - switchStarted; assert(switchElapsedMs >= 4000, `The configured five-second interval switched too early: ${switchElapsedMs} ms.`)
  const changedId = await frame(); assert.notEqual(changedId, firstId)
  const paneFrames = await page.locator('[data-theme-background]').evaluateAll(elements => elements.map(element => element.getAttribute('data-theme-background')))
  assert.equal(new Set(paneFrames).size, 1, 'Two editors must share the same playback frame.'); await shot('external-slideshow-two-editors')
  report.checks.twoEditorsShareOneClock = { firstId, changedId, paneFrames, switchElapsedMs }
  await page.emulateMedia({ reducedMotion: 'reduce' }); await pause(800); const reducedFrame = await frame(); await pause(5300); assert.equal(await frame(), reducedFrame)
  await page.emulateMedia({ reducedMotion: 'no-preference' }); report.checks.reducedMotionStopsSlideshow = true
  await click(page.getByRole('button', { name: 'Visual', exact: true }))
  await page.locator('.ourgeo-visual .ProseMirror').waitFor(); assert.equal(await page.locator('.ourgeo-visual [data-theme-background]').count(), 0)
  await click(page.getByRole('button', { name: 'Source', exact: true })); await page.locator('[data-panel-id="editor#2"] .monaco-editor').waitFor()
  assert.equal(await page.locator('[data-theme-background]').count(), 2); report.checks.sourceVisualSourceRetainsBackground = true
  await gallery(); await only('Peaceful loop.gif, GIF'); await page.getByRole('button', { name: 'Play GIF preview', exact: true }).waitFor(); await click(page.getByRole('button', { name: 'Play GIF preview', exact: true }))
  assert((await page.getByRole('img', { name: 'Peaceful loop.gif preview', exact: true }).getAttribute('src')).startsWith('ourgeo-theme-image:'))
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.getByText('Reduced motion is enabled on this device.', { exact: false }).waitFor()
  assert(await page.getByRole('button', { name: /GIF preview/, exact: false }).isDisabled())
  await done(); await page.waitForFunction(() => [...document.querySelectorAll('[data-theme-background] > img:last-child')].every(image => image.src.startsWith('blob:')))
  const reducedSrc = await page.locator('[data-theme-background] > img:last-child').first().getAttribute('src'); await pause(800); assert.equal(await page.locator('[data-theme-background] > img:last-child').first().getAttribute('src'), reducedSrc)
  report.checks.reducedMotionUsesActualFrozenGifFrame = true
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await gallery(); await only('Field lake.png')
  linked = (await folderList())[0]; const oldUrl = linked.images.find(image => image.name === 'Field lake.png').url
  draw(png, '#254e61', '#bbd2a0', '512x288'); draw(join(pictures, 'New coast.png'), '#193553', '#779999')
  await click(page.getByRole('button', { name: 'Rescan Linked artwork', exact: true })); await page.getByRole('button', { name: 'New coast.png', exact: true }).waitFor()
  linked = (await folderList())[0]; assert.equal(linked.images.length, 4); assert.notEqual(linked.images.find(image => image.name === 'Field lake.png').url, oldUrl)
  await page.waitForFunction(url => [...document.querySelectorAll('[data-theme-background] > img:last-child')].every(image => image.src === url && image.complete && image.naturalWidth === 512), linked.images.find(image => image.name === 'Field lake.png').url)
  report.checks.rescanFindsNewAndChangedFiles = true
  await rename(pictures, movedPictures); await click(page.getByRole('button', { name: 'Rescan Linked artwork', exact: true })); await page.getByText('Folder unavailable', { exact: true }).waitFor()
  assert.equal((await folderList())[0].status, 'missing'); await page.getByText(/selected image is unavailable/).waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('[data-theme-background]')].every(element => element.getAttribute('data-theme-background') === 'default'))
  await pick(movedPictures); await click(page.getByRole('button', { name: 'Locate Linked artwork', exact: true })); await page.getByRole('button', { name: 'Field lake.png', exact: true }).waitFor()
  linked = (await folderList())[0]; assert.equal(linked.status, 'ready'); assert.equal(linked.images.length, 4)
  await page.waitForFunction(id => [...document.querySelectorAll('[data-theme-background]')].every(element => element.getAttribute('data-theme-background') === id), fixedId)
  await shot('linked-folder-gallery'); report.checks.missingFolderRelinks = true
  const darkChoice = (await saved()).preferences.dark
  await done(); await click(page.locator('[data-ourgeo-id="toolbar.settings"]')); await click(page.getByRole('button', { name: 'Heaven', exact: true }).first()); await click(page.locator('[data-ourgeo-id="settings.themeBackgrounds"]'))
  assert.equal(await page.getByRole('button', { name: 'Original artwork', exact: true }).getAttribute('aria-pressed'), 'true')
  const lightContrast = await contrast(); assert(lightContrast.every(sample => sample.ratio >= 4.5), JSON.stringify(lightContrast.filter(sample => sample.ratio < 4.5))); await shot('light-gallery')
  report.checks.lightTextContrast = { minimum: Math.min(...lightContrast.map(sample => sample.ratio)), samples: lightContrast }
  await done(); await shot('light-editor-background'); await click(page.locator('[data-ourgeo-id="toolbar.settings"]')); await click(page.getByRole('button', { name: 'Dark', exact: true }).first()); await click(page.locator('[data-ourgeo-id="settings.themeBackgrounds"]'))
  assert.equal(await page.getByRole('button', { name: 'Field lake.png', exact: true }).getAttribute('aria-pressed'), 'true'); assert.deepEqual((await saved()).preferences.dark, darkChoice)
  report.checks.themeChoicesRemainIndependent = true
  await done(); await close(); await launch(); await gallery()
  assert.equal(await page.getByRole('button', { name: 'Field lake.png', exact: true }).getAttribute('aria-pressed'), 'true'); assert.equal(await page.getByRole('spinbutton', { name: 'Switch every', exact: true }).inputValue(), '5')
  report.checks.selectionsIntervalAndFolderSurviveRestart = true
  linked = (await folderList())[0]; const forgottenUrl = linked.images[0].url
  await click(page.getByRole('button', { name: `Forget ${linked.name}`, exact: true })); await page.getByText('No image folders linked to this theme yet.', { exact: true }).waitFor()
  assert.equal((await folderList()).length, 0); assert((await stat(join(movedPictures, 'Field lake.png'))).isFile()); assert((await stat(join(movedPictures, 'Peaceful loop.gif'))).isFile())
  await page.waitForFunction(() => [...document.querySelectorAll('[data-theme-background]')].every(element => element.getAttribute('data-theme-background') === 'default'))
  const revoked = await page.evaluate(async url => { try { return { status: (await fetch(url)).status } } catch { return { blocked: true } } }, forgottenUrl)
  assert(revoked.status === 404 || revoked.blocked === true, 'Forgotten image URLs must no longer return source bytes.')
  report.checks.forgetRevokesAccessAndPreservesOriginals = true
  assert.equal(errors.length, 0, errors.join('; ')); report.rendererErrors = errors; report.rendererConsoleErrors = consoleErrors
  report.passed = true
} catch (error) {
  report.error = error.stack ?? String(error)
  if (page) await shot('failure').catch(() => undefined)
  process.exitCode = 1
} finally {
  await close(); report.blockedExternalRequests = [...new Set(blockedRequests)]; report.rendererErrors = errors; report.rendererConsoleErrors = consoleErrors; report.rendererConsoleErrorDetails = consoleErrorDetails
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.passed, directory, checks: Object.keys(report.checks), error: report.error }, null, 2))
}
