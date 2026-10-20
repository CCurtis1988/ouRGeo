/* global window, document, getComputedStyle */
// Captures native compositor pixels from real bundled GIFs. File frame counts
// alone cannot reveal a moving region cropped out of a tall editor pane.
import { _electron as electron } from 'playwright-core'
import electronExecutable from 'electron'
import { mkdir, mkdtemp, writeFile, chmod, realpath, copyFile, readFile } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const root = resolve(import.meta.dirname, '..'), output = join(root, '.cache/theme-gif-motion')
const labels = { arctic: 'Arctic', dark: 'Dark', forest: 'Forest', retroTerminal: 'Retro Terminal', heaven: 'Heaven', bespin: 'Bespin', neonLights: 'Neon Lights', midnightDream: 'Midnight Dream', candyAddiction: 'Candy Addiction', volcanic: 'Volcanic' }
const themesAt = process.argv.indexOf('--themes'), themesArgument = themesAt < 0 ? 'all' : process.argv[themesAt + 1], themes = themesArgument === 'all' ? Object.keys(labels) : themesArgument.split(',')
const widthsAt = process.argv.indexOf('--widths'), widths = widthsAt < 0 ? [1920, 1000] : process.argv[widthsAt + 1].split(',').map(Number)
const samplesAt = process.argv.indexOf('--samples')
const millisecondsAt = process.argv.indexOf('--sample-ms'), sampleMs = millisecondsAt < 0 ? 1200 : Number(process.argv[millisecondsAt + 1])
const offsetsAt = process.argv.indexOf('--offsets'), offsets = offsetsAt >= 0 ? process.argv[offsetsAt + 1].split(',').map(Number) : samplesAt >= 0 || millisecondsAt >= 0 ? Array.from({ length: samplesAt < 0 ? 4 : Number(process.argv[samplesAt + 1]) }, (_, index) => index * sampleMs) : [0, 900, 2100, 4000]
const samples = offsets.length
const candidateAt = process.argv.indexOf('--candidate'), candidatePath = candidateAt < 0 ? null : resolve(process.argv[candidateAt + 1])
const packagedAt = process.argv.indexOf('--packaged'), packaged = packagedAt < 0 ? undefined : resolve(process.argv[packagedAt + 1])
const platformAt = process.argv.indexOf('--platform'), platform = platformAt < 0 ? process.platform === 'linux' ? 'x11' : null : process.argv[platformAt + 1]
const fullscreen = process.argv.includes('--fullscreen')
const measureOnly = process.argv.includes('--baseline') || process.argv.includes('--measure-only')
const metadataAt = process.argv.indexOf('--metadata'), metadataPath = metadataAt < 0 ? join(root, '.cache/theme-artwork/loops.json') : resolve(process.argv[metadataAt + 1])
let animationMetadata = {}
try { animationMetadata = JSON.parse(await readFile(metadataPath, 'utf8')) } catch { /* Pixel gates remain authoritative if authoring metadata has not been generated locally. */ }
const gates = { editor: { rms: 0.65, changedBy2Fraction: 0.01 }, preview: { rms: 1.5, changedBy2Fraction: 0.02 } }
assert(themes.every(theme => labels[theme]), `Choose all or ids from ${Object.keys(labels).join(', ')}.`)
assert(samples >= 3 && offsets[0] === 0 && offsets.every((value, index) => Number.isFinite(value) && value >= 0 && (index === 0 || value > offsets[index - 1])), 'Capture at least three increasing sample offsets starting at zero.')
assert(!candidatePath || themes.length === 1, 'A candidate belongs to one theme; pass --themes arctic or --themes dark.')
await mkdir(output, { recursive: true })
const directory = await mkdtemp(join(output, 'run-')), profile = join(directory, 'profile'), data = join(profile, 'ourgeo'), temporary = join(directory, 'tmp')
await mkdir(data, { recursive: true }); await chmod(data, 0o700); await mkdir(temporary)
const candidateFolder = join(directory, 'Candidate animation')
if (candidatePath) { await mkdir(candidateFolder); await copyFile(candidatePath, join(candidateFolder, basename(candidatePath))) }
await writeFile(join(data, '.context-acceptance'), 'synthetic-context-profile-v1\n', { mode: 0o600 })
await writeFile(join(data, 'health-check.json'), JSON.stringify({ prompted: true, report: null }))
await writeFile(join(data, 'theme.json'), JSON.stringify({ theme: themes[0], codeTheme: themes[0], markdownTheme: themes[0], uiScale: 1 }))
await writeFile(join(data, 'theme-backgrounds.json'), JSON.stringify({ version: 1, preferences: Object.fromEntries(themes.map(id => [id, { selectedIds: [`${id}:loop`], intervalSeconds: 30 }])) }))
const zone = (order, size, axis = 'row', mode = 'split') => ({ order, size, axis, mode, weights: Object.fromEntries(order.map(id => [id, 1])), active: order[0] ?? null })
await writeFile(join(data, 'layout.json'), JSON.stringify({ layout: { version: 1, zones: { left: zone([], 260), center: zone(['editor', 'editor#2'], 0), right: zone([], 400), bottom: zone(['console', 'terminal', 'projectFiles'], 180, 'row', 'tabs') }, open: { editor: true, 'editor#2': true, console: true, terminal: true, projectFiles: true }, toolbar: { order: [], hidden: [] } }, presets: [], dragEnabled: false }))
const tabs = ['editor', 'editor#2'].map((panelId, index) => ({ id: `motion-${index}`, panelId, fileName: `GIF motion ${index + 1}.R`, filePath: null, content: '', savedContent: '', isDirty: false, type: 'code', language: 'r', viewMode: 'source' }))
await writeFile(join(data, 'session.json'), JSON.stringify({ tabs, activeTabId: tabs[0].id, activeByPanel: { editor: tabs[0].id, 'editor#2': tabs[1].id }, untitledCounter: 1 }))
const report = { measuredAt: new Date().toISOString(), directory, samples, offsets, candidatePath, packaged, platform, fullscreen, measureOnly, gates, metadataPath, method: 'Normal page.screenshot compositor PNGs with animations allowed, never canvas.drawImage; lossless BGRA pixel comparison excludes alpha, text/caret and crossfade. Native capturePage can clip an emulated viewport and is deliberately avoided. Screenshot dimensions match requested CSS viewport clips; actual native bounds are recorded separately because tiling window managers can ignore setBounds.', initialMedia: null, results: [], rendererErrors: [], passed: false }
let app, page
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const click = locator => locator.evaluate(element => element.click())
async function capture(rect, name) {
  const clip = Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, Math.round(value)]))
  const png = await page.screenshot({ clip, animations: 'allow', caret: 'hide', scale: 'css' })
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20)
  assert.equal(width, clip.width); assert.equal(height, clip.height)
  const bitmap = execFileSync('magick', ['png:-', '-alpha', 'on', '-depth', '8', 'bgra:-'], { input: png, maxBuffer: 30 * 1024 * 1024 })
  assert.equal(bitmap.length, width * height * 4)
  const path = join(directory, `${name}.png`); await writeFile(path, png)
  return { width, height, bitmap, path }
}
function difference(a, b) {
  assert.equal(a.width, b.width); assert.equal(a.height, b.height); assert.equal(a.bitmap.length, b.bitmap.length)
  let total = 0, squareTotal = 0, changed = 0, changed2 = 0, changed5 = 0, peak = 0
  const blockSize = 32, blocksWide = Math.ceil(a.width / blockSize), sums = new Float64Array(blocksWide * Math.ceil(a.height / blockSize)), counts = new Uint32Array(sums.length)
  for (let pixel = 0; pixel < a.width * a.height; pixel++) {
    let delta = 0, max = 0
    for (let channel = 0; channel < 3; channel++) { const next = Math.abs(a.bitmap[pixel * 4 + channel] - b.bitmap[pixel * 4 + channel]); delta += next; squareTotal += next * next; max = Math.max(max, next) }
    total += delta; peak = Math.max(peak, max); if (max > 0) changed++; if (max >= 2) changed2++; if (max >= 5) changed5++
    const block = Math.floor((pixel % a.width) / blockSize) + Math.floor(Math.floor(pixel / a.width) / blockSize) * blocksWide
    sums[block] += delta; counts[block]++
  }
  const pixels = a.width * a.height, meanRgbDelta = total / (pixels * 3)
  return { meanRgbDelta, normalisedMeanRgbDelta: meanRgbDelta / 255, rmsRgbDelta: Math.sqrt(squareTotal / (pixels * 3)), changedFraction: changed / pixels, changedBy2Fraction: changed2 / pixels, changedBy5Fraction: changed5 / pixels, maxChannelDelta: peak, strongest32pxBlockMeanRgbDelta: Math.max(...sums.map((sum, index) => sum / (counts[index] * 3))) }
}
function compare(frames) {
  const pairs = []
  for (let first = 0; first < frames.length; first++) for (let second = first + 1; second < frames.length; second++) pairs.push({ first, second, ...difference(frames[first], frames[second]) })
  return { width: frames[0].width, height: frames[0].height, files: frames.map(frame => frame.path), maxDifference: pairs.reduce((best, next) => next.rmsRgbDelta > best.rmsRgbDelta ? next : best), pairs }
}
async function bounds(selector, trim = false) {
  return page.locator(selector).first().evaluate((element, trim) => {
    const box = element.getBoundingClientRect()
    return trim ? { x: box.x + 40, y: box.y + 35, width: Math.max(1, box.width - 50), height: Math.max(1, box.height - 45) } : { x: box.x, y: box.y, width: box.width, height: box.height }
  }, trim)
}
async function metadata(theme, captureRect) {
  return page.evaluate(({ theme, regions, captureRect }) => {
    const wrapper = document.querySelector('[data-theme-background]'), image = wrapper?.querySelector('img:last-child'), rect = wrapper?.getBoundingClientRect(), style = wrapper ? getComputedStyle(wrapper) : null
    let crop = null
    if (image && rect) {
      const scale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight), sourceWidth = rect.width / scale, sourceHeight = rect.height / scale
      const sourceRect = { x: (image.naturalWidth - sourceWidth) / 2, y: (image.naturalHeight - sourceHeight) / 2, width: sourceWidth, height: sourceHeight }
      const sourceCaptureRect = { x: sourceRect.x + (captureRect.x - rect.x) / scale, y: sourceRect.y + (captureRect.y - rect.y) / scale, width: captureRect.width / scale, height: captureRect.height / scale }
      const regionVisibility = regions.map(region => {
        const fraction = box => Math.max(0, Math.min(box.x + box.width, region.x + region.w) - Math.max(box.x, region.x)) * Math.max(0, Math.min(box.y + box.height, region.y + region.h) - Math.max(box.y, region.y)) / (region.w * region.h)
        return { ...region, visibleFractionInWrapper: fraction(sourceRect), visibleFractionInCapture: fraction(sourceCaptureRect) }
      })
      crop = { sourceRect, sourceCaptureRect, regions: regionVisibility, displayedScale: scale }
    }
    return { theme, frameId: wrapper?.getAttribute('data-theme-background'), src: image?.getAttribute('src'), naturalWidth: image?.naturalWidth, naturalHeight: image?.naturalHeight, opacity: style?.opacity, filter: style?.filter, visibility: document.visibilityState, hasFocus: document.hasFocus(), innerWidth: window.innerWidth, innerHeight: window.innerHeight, reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches, previewSrc: document.querySelector('img[alt$=" preview"]')?.getAttribute('src'), crop }
  }, { theme, regions: animationMetadata[theme]?.regions ?? [], captureRect })
}
try {
  const wrapper = join(profile, 'launch.cjs')
  await writeFile(wrapper, `const {app,session}=require('electron');app.setPath('userData',${JSON.stringify(data)});app.on('ready',()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>callback({cancel:!['127.0.0.1','localhost','[::1]'].includes(new URL(details.url).hostname)})));require(${JSON.stringify(join(root, 'out/main/index.js'))});`)
  app = await electron.launch({ executablePath: packaged ?? electronExecutable, args: ['--no-sandbox', ...(platform ? [`--ozone-platform=${platform}`] : []), ...(packaged ? [] : [wrapper])], cwd: root, env: { ...process.env, TMPDIR: temporary, XDG_CONFIG_HOME: profile, OURGEO_CONTEXT_TEST_PROFILE: await realpath(data) }, timeout: 60_000 })
  if (packaged) await app.evaluate(({ session }) => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => callback({ cancel: !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(details.url).hostname) })))
  app.process().stderr.on('data', chunk => { void writeFile(join(directory, 'stderr.log'), chunk, { flag: 'a' }) })
  page = app.windows().find(item => !item.url().startsWith('devtools:')) ?? await app.firstWindow()
  page.on('pageerror', error => report.rendererErrors.push(error.message))
  await page.waitForSelector('[data-ourgeo-id="toolbar.settings"]', { timeout: 60_000 })
  assert.equal(resolve(await app.evaluate(({ app }) => app.getPath('userData'))), resolve(data))
  if (fullscreen) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true))
    let fits = false
    for (let attempt = 0; attempt < 40; attempt++) {
      const actual = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds())
      if (actual.width >= Math.max(...widths) && actual.height >= 900) { fits = true; break }
      await pause(100)
    }
    assert(fits, 'The isolated fullscreen window must physically contain every requested viewport.')
  }
  report.initialMedia = await page.evaluate(() => ({ reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches, visibility: document.visibilityState }))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  let candidateId
  if (candidatePath) {
    await click(page.locator('[data-ourgeo-id="toolbar.settings"]')); await click(page.locator('[data-ourgeo-id="settings.themeBackgrounds"]'))
    await page.waitForFunction(() => !document.querySelector('[data-ourgeo-id="themeBackgrounds.linkFolder"]')?.disabled)
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, candidateFolder)
    await click(page.locator('[data-ourgeo-id="themeBackgrounds.linkFolder"]'))
    const candidate = page.getByRole('button', { name: `${basename(candidatePath)}, GIF`, exact: true })
    await candidate.waitFor(); await click(candidate)
    await page.waitForFunction(name => document.querySelector(`button[aria-label="${name}, GIF"]`)?.getAttribute('aria-pressed') === 'true', basename(candidatePath))
    const original = page.getByRole('button', { name: 'Original artwork · ambient loop, GIF', exact: true })
    await click(original); await page.waitForFunction(() => document.querySelector('button[aria-label="Original artwork · ambient loop, GIF"]')?.getAttribute('aria-pressed') === 'false')
    candidateId = await page.evaluate(async () => (await window.electronAPI.themeBackgrounds.list())[0].images[0].id)
    await click(page.getByRole('button', { name: 'Done', exact: true }))
  }
  for (const width of widths) {
    await app.evaluate(({ BrowserWindow }, width) => { const window = BrowserWindow.getAllWindows()[0]; window.setBounds({ width, height: 900 }); window.show(); window.focus() }, width)
    await page.setViewportSize({ width, height: 900 })
    for (const theme of themes) {
      await click(page.locator('[data-ourgeo-id="toolbar.settings"]'))
      await click(page.getByRole('button', { name: labels[theme], exact: true }).first())
      await click(page.getByRole('button', { name: 'Close settings', exact: true }))
      await page.waitForFunction(id => [...document.querySelectorAll('[data-theme-background]')].every(element => element.getAttribute('data-theme-background') === id && element.querySelector('img:last-child')?.complete), candidateId ?? `${theme}:loop`)
      await pause(900)
      const editor = [], preview = [], editorRect = await bounds('[data-theme-background]', true), details = await metadata(theme, editorRect)
      details.nativeWindow = await app.evaluate(({ BrowserWindow }) => ({ bounds: BrowserWindow.getAllWindows()[0].getBounds(), contentBounds: BrowserWindow.getAllWindows()[0].getContentBounds(), fullscreen: BrowserWindow.getAllWindows()[0].isFullScreen() }))
      if (fullscreen) assert(details.nativeWindow.contentBounds.width >= details.innerWidth && details.nativeWindow.contentBounds.height >= details.innerHeight, 'The emulated viewport must fit inside the physical fullscreen content bounds.')
      assert(details.naturalWidth > 0 && details.naturalHeight > 0 && details.visibility === 'visible' && details.reducedMotion === false)
      const editorStarted = Date.now()
      for (let index = 0; index < samples; index++) { await pause(Math.max(0, offsets[index] - (Date.now() - editorStarted))); editor.push(await capture(editorRect, `${theme}-${width}-editor-${index}`)) }
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.waitForFunction(() => [...document.querySelectorAll('[data-theme-background] img:last-child')].every(image => !image.src.endsWith('.gif') && !image.src.startsWith('ourgeo-theme-image:') && image.complete))
      await pause(900)
      const editorControl = [await capture(editorRect, `${theme}-${width}-editor-control-0`)]; await pause(700); editorControl.push(await capture(editorRect, `${theme}-${width}-editor-control-1`))
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.waitForFunction(() => [...document.querySelectorAll('[data-theme-background] img:last-child')].every(image => (image.src.endsWith('.gif') || image.src.startsWith('ourgeo-theme-image:')) && image.complete))
      await click(page.locator('[data-ourgeo-id="toolbar.settings"]')); await click(page.locator('[data-ourgeo-id="settings.themeBackgrounds"]'))
      await page.getByRole('button', { name: 'Play GIF preview', exact: true }).waitFor()
      await page.waitForFunction(() => document.querySelector('img[alt$=" preview"]')?.complete)
      const previewRect = await bounds('img[alt$=" preview"]'), previewControl = [await capture(previewRect, `${theme}-${width}-preview-control-0`)]
      await pause(700); previewControl.push(await capture(previewRect, `${theme}-${width}-preview-control-1`))
      await click(page.getByRole('button', { name: 'Play GIF preview', exact: true }))
      await page.waitForFunction(() => { const image = document.querySelector('img[alt$=" preview"]'); return image?.src.endsWith('.gif') || image?.src.startsWith('ourgeo-theme-image:') })
      await pause(300)
      const previewStarted = Date.now()
      for (let index = 0; index < samples; index++) { await pause(Math.max(0, offsets[index] - (Date.now() - previewStarted))); preview.push(await capture(previewRect, `${theme}-${width}-preview-${index}`)) }
      const result = { theme, width, metadata: { ...details, previewSrc: await page.locator('img[alt$=" preview"]').getAttribute('src') }, editor: compare(editor), preview: compare(preview), editorControl: compare(editorControl), previewControl: compare(previewControl) }
      assert.equal(result.editorControl.maxDifference.maxChannelDelta, 0, 'Static editor controls must have identical pixels; movement elsewhere cannot qualify the GIF.')
      assert.equal(result.previewControl.maxDifference.maxChannelDelta, 0, 'Paused GIF preview controls must have identical pixels.')
      result.motionVisible = { editor: result.editor.maxDifference.rmsRgbDelta >= gates.editor.rms && result.editor.maxDifference.changedBy2Fraction >= gates.editor.changedBy2Fraction, preview: result.preview.maxDifference.rmsRgbDelta >= gates.preview.rms && result.preview.maxDifference.changedBy2Fraction >= gates.preview.changedBy2Fraction }
      report.results.push(result); await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
      console.log(JSON.stringify({ theme, width, visible: result.motionVisible, editor: result.editor.maxDifference, preview: result.preview.maxDifference }))
      await click(page.getByRole('button', { name: 'Done', exact: true }))
    }
  }
  assert.equal(report.rendererErrors.length, 0, report.rendererErrors.join('; '))
  if (!measureOnly) {
    const failures = report.results.filter(result => !result.motionVisible.editor || !result.motionVisible.preview)
    assert.equal(failures.length, 0, `GIF motion did not clear visible pixel gates: ${JSON.stringify(failures.map(({ theme, width, motionVisible, editor, preview }) => ({ theme, width, motionVisible, editor: editor.maxDifference, preview: preview.maxDifference })))}`)
  }
  report.passed = true
} catch (error) { report.error = error.stack ?? String(error); process.exitCode = 1 }
finally {
  if (app) { await page?.evaluate(() => window.electronAPI.app.confirmQuit()).catch(() => undefined); await app.close().catch(() => undefined) }
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.passed, directory, error: report.error }))
}
