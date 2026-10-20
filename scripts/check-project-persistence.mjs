/* global window, document */
// Acceptance checks for docs/project-persistence-spec.md §5, against the BUILT
// app (`npm run build` first) in isolated, disposable profiles. Never touches
// the regular user profile. Kills are SIGKILL to the Electron main process;
// a restart is a fresh launch on the same profile.
//
//   node scripts/check-project-persistence.mjs [--only N1,C1,...]
//
// Writes report.json and screenshots under .cache/project-persistence-review/.
import { _electron as electron } from 'playwright-core'
import electronExecutable from 'electron'
import { mkdir, mkdtemp, writeFile, readFile, chmod, realpath, rm, readdir } from 'node:fs/promises'
import { existsSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import { waitForAsync } from './lib/wait-async.mjs'

const root = resolve(import.meta.dirname, '..')
const output = join(root, '.cache/project-persistence-review')
await mkdir(output, { recursive: true })
const directory = await mkdtemp(join(output, 'run-'))
const temporary = join(directory, 'tmp')
await mkdir(temporary)
const files = join(directory, 'files')
await mkdir(files)
const only = process.argv.includes('--only') ? new Set(process.argv[process.argv.indexOf('--only') + 1].split(',')) : null
const report = { version: 1, measuredAt: new Date().toISOString(), directory, platform: `${process.platform}-${process.arch}`, checks: {}, failures: [], limitations: ['Native Windows and macOS verification is deferred.', 'Native file pickers are stubbed in the main process; the dialogs ouRGeo draws are driven for real.'] }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const rPids = () => { try { return execSync("pgrep -f 'server\\.R' 2>/dev/null").toString().trim().split(/\s+/).filter(Boolean) } catch { return [] } }
const before = new Set(rPids())
const draftKey = path => createHash('sha256').update(resolve(path)).digest('hex').slice(0, 32)

// ── Profiles and launching ────────────────────────────────────────────────────
const profiles = {}
async function profile(name) {
  if (profiles[name]) return profiles[name]
  const base = join(directory, name), data = join(base, 'ourgeo')
  await mkdir(data, { recursive: true, mode: 0o700 }); await chmod(data, 0o700)
  await writeFile(join(data, '.context-acceptance'), 'synthetic-context-profile-v1\n', { mode: 0o600 })
  await writeFile(join(data, 'health-check.json'), JSON.stringify({ prompted: true, report: null }))
  await writeFile(join(data, 'app-updates.json'), JSON.stringify({ automatic: false }))
  const wrapper = join(base, 'launch.cjs')
  await writeFile(wrapper, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(data)});require(${JSON.stringify(join(root, 'out/main/index.js'))});`)
  profiles[name] = { base, data: await realpath(data), wrapper }
  return profiles[name]
}
const setting = async (name, patch) => {
  const p = await profile(name), file = join(p.data, 'project-settings.json')
  const current = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : {}
  await writeFile(file, JSON.stringify({ ...current, ...patch }))
}

class App {
  constructor(name) { this.name = name; this.errors = [] }
  async launch(extraEnv = {}) {
    const p = await profile(this.name)
    this.app = await electron.launch({ executablePath: electronExecutable, args: ['--no-sandbox', p.wrapper], cwd: root, timeout: 60_000,
      env: { ...process.env, TMPDIR: temporary, XDG_CONFIG_HOME: p.base, OURGEO_CONTEXT_TEST_PROFILE: p.data, ...extraEnv } })
    this.pid = this.app.process().pid
    this.app.process().stderr.on('data', chunk => { void writeFile(join(directory, `${this.name}-stderr.log`), chunk, { flag: 'a' }) })
    this.page = this.app.windows().find(w => !w.url().startsWith('devtools:')) ?? await this.app.firstWindow()
    this.page.setDefaultTimeout(30_000)
    this.page.on('pageerror', error => this.errors.push(error.message))
    await this.page.waitForSelector('[data-ourgeo-id="project.dropdown"]', { timeout: 60_000 })
    assert.equal(resolve(await this.app.evaluate(({ app }) => app.getPath('userData'))), resolve(p.data), 'Never open the regular user profile.')
    await this.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setBounds({ width: 1280, height: 900 }))
    return this
  }
  async ready() {
    await this.page.waitForFunction(() => document.body.innerText.includes('R session ready'), undefined, { timeout: 90_000 })
    await this.page.waitForFunction(() => document.querySelector('[data-ourgeo-id="project.dropdown"]')?.title === 'R connected', undefined, { timeout: 60_000 })
    // The launch restore — the project open at quit, with its draft — runs
    // after R is ready; the project menu says when it has finished.
    await this.page.waitForFunction(() => document.querySelector('[data-ourgeo-id="project.dropdown"]')?.dataset.restored === 'true', undefined, { timeout: 120_000 })
    await sleep(500)
    return this
  }
  async r(code) {
    return this.page.evaluate(async code => {
      const port = await window.electronAPI.r.getPort()
      const res = await fetch(`http://127.0.0.1:${port}/r/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      return res.json()
    }, code)
  }
  async rValue(expr) {
    const res = await this.r(`cat(jsonlite::toJSON(${expr}, auto_unbox = TRUE))`)
    return JSON.parse(String(res.output ?? res.result ?? 'null').trim() || 'null')
  }
  async click(selector) { await this.page.locator(selector).first().evaluate(el => el.click()) }
  async clickText(text, scope = 'body') { await this.page.locator(scope).getByRole('button', { name: text, exact: true }).first().evaluate(el => el.click()) }
  /** The title of the question ouRGeo is asking, or null. */
  async asking(timeout = 8000) {
    try { await this.page.waitForSelector('[data-ourgeo-id="project.ask"]', { timeout }) } catch { return null }
    return this.page.locator('[data-ourgeo-id="project.ask"] h2').first().innerText()
  }
  async askText() { return this.page.locator('[data-ourgeo-id="project.ask"]').innerText() }
  async answer(label, { check = false } = {}) {
    const dialog = this.page.locator('[data-ourgeo-id="project.ask"]')
    if (check) await dialog.locator('input[type="checkbox"]').evaluate(el => el.click())
    await dialog.getByRole('button', { name: label, exact: true }).evaluate(el => el.click())
    await this.page.waitForFunction(title => document.querySelector('[data-ourgeo-id="project.ask"] h2')?.textContent !== title, await dialog.locator('h2').innerText().catch(() => ''), { timeout: 10_000 }).catch(() => {})
  }
  async menu(label) {
    await this.click('[data-ourgeo-id="project.dropdown"]')
    await this.page.waitForSelector('[data-ourgeo-id="project.files"]')
    if (label) await this.page.locator('div.absolute').getByRole('button', { name: label }).first().evaluate(el => el.click())
  }
  /** A recent project, by its exact path — names can appear inside paths. */
  async openRecent(path) {
    await this.menu()
    await this.page.locator(`div.absolute button[title=${JSON.stringify(path)}]`).first().evaluate(el => el.click())
    await this.waitIdle()
  }
  async closeMenu() { await this.page.mouse.click(5, 450) }
  async stubSave(path) { await this.app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => p ? { canceled: false, filePath: p } : { canceled: true } }, path) }
  async stubOpen(path) { await this.app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] } }, path) }
  async projectName() { return (await this.page.locator('[data-ourgeo-id="project.dropdown"] span.truncate').innerText()).trim() }
  async tabs() { return this.page.evaluate(() => [...document.querySelectorAll('[role="region"][aria-label="Open document tabs"] button[data-active]')].map(b => b.textContent.trim())) }
  async newUntitled(text) {
    await this.click('[data-ourgeo-id="editor.newTab"]')
    await sleep(400)
    await this.type(text)
  }
  /** A real click: focusing Monaco's edit context through the DOM reports
   *  success and drops every keystroke (see the run-ourgeo driver). */
  async focusEditor() {
    const box = await this.page.locator('.monaco-editor .view-lines').first().boundingBox()
    await this.page.mouse.click(box.x + Math.min(60, box.width / 2), box.y + 10)
    await sleep(150)
  }
  /** Type at the caret. `at: 'start'` first puts it at the top of the document. */
  async type(text, { at = 'start' } = {}) {
    if (at !== 'caret') { await this.focusEditor(); if (at === 'start') await this.page.keyboard.press('Control+Home'); else await this.page.keyboard.press('Control+End') }
    // insertText, not type(): typed keys open R autocomplete, and Enter then
    // accepts a suggestion — "one\n" arrived as "function".
    await this.page.keyboard.insertText(text)
    await this.page.keyboard.press('Escape')
    await sleep(300)
  }
  async editorText() { return this.page.evaluate(() => document.querySelector('.monaco-editor .view-lines')?.innerText.replace(/\u00a0/g, ' ') ?? '') }
  /** Ctrl+W reaches the editor only when it has focus. */
  async closeActive() { await this.focusEditor(); await this.page.keyboard.press('Control+w') }
  async selectTab(name) { await this.page.locator('[aria-label="Open document tabs"] button[data-active]').filter({ hasText: name }).first().evaluate(el => el.click()); await sleep(300) }
  async cursor() { return this.page.evaluate(() => { const c = document.querySelector('.monaco-editor .cursors-layer .cursor'); return c ? { top: c.style.top, left: c.style.left } : null }) }
  async openFile(path) { await this.stubOpen(path); await this.click('[data-ourgeo-id="toolbar.openFile"]'); await sleep(800) }
  async saveProjectAs(path) { await this.stubSave(path); await this.menu('Save As…'); await this.waitIdle() }
  async waitIdle() { await this.page.waitForFunction(() => !document.querySelector('[data-ourgeo-id="project.dropdown"]')?.disabled, undefined, { timeout: 120_000 }); await sleep(500) }
  /** Close the window the way a user does: it runs the leave flow. */
  async quit(handle) {
    const exited = new Promise(resolve => this.app.process().once('exit', resolve))
    await this.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    if (handle) await handle(this)
    await Promise.race([exited, sleep(60_000).then(() => { throw new Error(`${this.name} did not exit after quit`) })])
    await sleep(500)
  }
  /** Close requested; returns whether the app is still running after `ms`. */
  async closeRequested(ms = 3000) { await this.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close()); await sleep(ms) }
  async kill() {
    const pid = this.pid
    let alive = true
    try { process.kill(pid, 0) } catch { alive = false }
    if (alive) {
      const exited = new Promise(resolve => { try { this.app.process().once('exit', resolve) } catch { resolve() } })
      try { process.kill(pid, 'SIGKILL') } catch { /* gone */ }
      await Promise.race([exited, sleep(5000)])
    }
    // The R child outlives a SIGKILL'd parent: it is this run's, so it goes.
    for (const r of rPids()) if (!before.has(r)) { try { process.kill(Number(r), 'SIGKILL') } catch { /* gone */ } }
    await sleep(800)
  }
  async shot(name) { try { await this.page.screenshot({ path: join(directory, `${name}.png`), timeout: 5000 }) } catch { /* animating */ } }
}

async function draftMeta(profileName, projectPath) {
  const p = await profile(profileName)
  const file = join(p.data, 'project-drafts', projectPath ? draftKey(projectPath) : 'scratch', 'meta.json')
  return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null
}
async function lastSession(profileName) { return JSON.parse(await readFile(join((await profile(profileName)).data, 'last-session.json'), 'utf8')) }
function bundle(path) {
  const zip = new AdmZip(path)
  return { manifest: JSON.parse(zip.readAsText('project.json')), hasEnv: !!zip.getEntry('environment.RData') }
}
const sha = async path => createHash('sha256').update(await readFile(path)).digest('hex')

async function check(id, description, fn) {
  if (only && !only.has(id)) return
  const started = Date.now()
  process.stdout.write(`${id} ${description} … `)
  try {
    // A hang is a failure, not a stalled run.
    const detail = await Promise.race([fn(), sleep(8 * 60_000).then(() => { throw new Error('check timed out after 8 minutes') })])
    report.checks[id] = { passed: true, description, ms: Date.now() - started, ...(detail ? { detail } : {}) }
    console.log('pass')
  } catch (error) {
    report.checks[id] = { passed: false, description, ms: Date.now() - started, error: String(error?.stack ?? error) }
    report.failures.push(id)
    console.log(`FAIL\n  ${String(error?.message ?? error).split('\n').slice(0, 6).join('\n  ')}`)
    for (const a of running) { try { await a.shot(`${id}-failure-${a.name}`) } catch { /* ignore */ } }
    for (const a of running.splice(0)) { try { await a.kill() } catch { /* ignore */ } }
    // That kill was ours, not the app's: mark it clean so the next check does
    // not open behind a crash warning it never asked for.
    for (const name of Object.keys(profiles)) {
      const file = join(profiles[name].data, 'last-session.json')
      try { const last = JSON.parse(await readFile(file, 'utf8')); await writeFile(file, JSON.stringify({ ...last, cleanExit: true })) } catch { /* none */ }
    }
  }
}
const running = []
async function start(name, env) { const a = await new App(name).launch(env); running.push(a); await a.ready(); return a }
async function stop(a, how = 'quit', handle) {
  if (how === 'kill') await a.kill(); else await a.quit(handle)
  running.splice(running.indexOf(a), 1)
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
const script = join(files, 'analysis.R')
const original = 'x <- 1\ny <- 2\n'
await writeFile(script, original)
const project = join(files, 'Persist.ourgeoproj')

// ── Scratch ───────────────────────────────────────────────────────────────────
await check('S1', 'scratch with only untitled text: no prompt on quit; text and cursor back, nothing else', async () => {
  let a = await start('A')
  await a.newUntitled('scratch note one\nsecond line')
  await a.page.keyboard.press('Control+Home')
  await sleep(800)
  const cursor = await a.cursor()
  await stop(a, 'quit', async app => { assert.equal(await app.asking(3000), null, 'no question when only untitled text') })
  assert.equal((await lastSession('A')).cleanExit, true)
  a = await start('A')
  assert.equal(await a.projectName(), 'scratch')
  const tabs = await a.tabs()
  assert(tabs.some(t => t.startsWith('Untitled-2')), `untitled tab restored: ${tabs}`)
  await a.selectTab('Untitled-2')
  assert.match(await a.editorText(), /scratch note one/)
  assert.deepEqual(await a.cursor(), cursor, 'cursor restored')
  assert.deepEqual(await a.rValue('setdiff(ls(.GlobalEnv), .ourgeo_env$system_names)'), [])
  await stop(a)
})

await check('S2', 'scratch with objects and a file tab: prompt 1 counts them; Cancel keeps the app open', async () => {
  const a = await start('A')
  await a.r('scratch_obj <- 1:10; plot(1:10)')
  await a.openFile(script)
  await a.type('# edited in scratch\n')
  await a.closeRequested(500)
  assert.equal(await a.asking(), 'Save scratch as a project?')
  const text = await a.askText()
  assert.match(text, /1 R object/); assert.match(text, /1 plot/); assert.match(text, /1 open file/)
  await a.answer('Cancel')
  await sleep(1500)
  assert.equal(a.app.process().exitCode, null, 'still running')
  await stop(a, 'quit', async app => {
    assert.equal(await app.asking(), 'Save scratch as a project?')
    await app.answer("Don't save")
    assert.equal(await app.asking(), 'Apply your edits to analysis.R?')
    await app.answer('Drop')
  })
  assert.equal(await readFile(script, 'utf8'), original, 'Drop leaves the file as it was')
})

await check('S7', 'dropped file tabs are in Recently closed; reopening reads the disk; a deleted file says so', async () => {
  const gone = join(files, 'gone.R')
  await writeFile(gone, 'z <- 3\n')
  let a = await start('A')
  await a.openFile(gone)
  await stop(a, 'quit', async app => { if (await app.asking(4000)) await app.answer("Don't save") })
  await rm(gone)
  await writeFile(script, original + '# changed on disk\n')
  a = await start('A')
  await a.menu()
  const listed = await a.page.locator('[data-ourgeo-id="project.recentlyClosed"]').innerText()
  assert.match(listed, /analysis\.R/); assert.match(listed, /gone\.R[\s\S]*file not found/)
  await a.page.locator('[data-ourgeo-id="project.recentlyClosed"] button').filter({ hasText: 'analysis.R' }).evaluate(el => el.click())
  await sleep(800)
  await a.selectTab('analysis.R')
  assert.match(await a.editorText(), /changed on disk/)
  await writeFile(script, original)
  await stop(a, 'quit', async app => { if (await app.asking(4000)) await app.answer("Don't save") })
})

await check('S4', "Don't save → prompt 2 for three dirty files: Apply, Drop, Apply to all; a read-only file stops with its name", async () => {
  const f = n => join(files, `s4-${n}.R`)
  for (const n of ['a', 'b', 'c', 'd']) await writeFile(f(n), `${n} <- 1\n`)
  let a = await start('A')
  await a.r('s4 <- 1')
  for (const n of ['a', 'b', 'c', 'd']) { await a.openFile(f(n)); await a.type(`# ${n} edit\n`) }
  await stop(a, 'quit', async app => {
    assert.equal(await app.asking(), 'Save scratch as a project?')
    await app.answer("Don't save")
    assert.equal(await app.asking(), 'Apply your edits to s4-a.R?'); await app.answer('Apply')
    assert.equal(await app.asking(), 'Apply your edits to s4-b.R?'); await app.answer('Drop')
    assert.equal(await app.asking(), 'Apply your edits to s4-c.R?'); await app.answer('Apply', { check: true })
  })
  assert.match(await readFile(f('a'), 'utf8'), /# a edit/)
  assert.doesNotMatch(await readFile(f('b'), 'utf8'), /# b edit/)
  assert.match(await readFile(f('c'), 'utf8'), /# c edit/)
  assert.match(await readFile(f('d'), 'utf8'), /# d edit/)
  // A read-only file: the failure is named and nothing is dropped silently.
  await writeFile(f('ro'), 'ro <- 1\n'); chmodSync(f('ro'), 0o444)
  a = await start('A')
  await a.openFile(f('ro')); await a.type('# ro edit\n')
  await a.closeRequested(300)
  if (await a.asking() === 'Save scratch as a project?') await a.answer("Don't save")
  assert.equal(await a.asking(), 'Apply your edits to s4-ro.R?'); await a.answer('Apply')
  assert.equal(await a.asking(), 'Could not write s4-ro.R')
  assert.match(await a.askText(), /Save As…|Save the edits to a new file/)
  await a.answer('Cancel')
  await sleep(1000)
  assert.equal(a.app.process().exitCode, null, 'Cancel keeps the app open')
  await stop(a, 'quit', async app => { if (await app.asking() === 'Save scratch as a project?') await app.answer("Don't save"); if (await app.asking()) await app.answer('Drop') })
  chmodSync(f('ro'), 0o644)
})

await check('S5', "prompt 1 \"Don't ask again\" persists; Settings → Prompts turns it back on", async () => {
  let a = await start('A')
  await a.r('s5 <- 1')
  await stop(a, 'quit', async app => { assert.equal(await app.asking(), 'Save scratch as a project?'); await app.answer("Don't save", { check: true }) })
  a = await start('A')
  await a.r('s5 <- 2')
  await stop(a, 'quit', async app => { assert.equal(await app.asking(3000), null, 'silenced') })
  a = await start('A')
  await a.click('[data-ourgeo-id="toolbar.settings"]')
  await a.page.getByRole('button', { name: 'Prompts', exact: true }).first().evaluate(el => el.click())
  const toggle = a.page.locator('[data-ourgeo-id="settings.promptsScratchSave"]')
  assert.equal(await toggle.getAttribute('aria-checked'), 'false')
  await toggle.evaluate(el => el.click())
  assert.equal(await toggle.getAttribute('aria-checked'), 'true')
  await a.page.keyboard.press('Escape')
  await a.r('s5 <- 3')
  await stop(a, 'quit', async app => { assert.equal(await app.asking(), 'Save scratch as a project?'); await app.answer("Don't save") })
})

await check('S3', 'prompt 1 → Save as project…: everything goes into the project, file edits unsaved inside it; files untouched; no prompt 2', async () => {
  const a = await start('A')
  await a.r('s3_obj <- data.frame(a = 1:3); plot(3:1)')
  await a.openFile(script)
  await a.type('# held in project\n')
  await a.stubSave(join(files, 'FromScratch.ourgeoproj'))
  await stop(a, 'quit', async app => { assert.equal(await app.asking(), 'Save scratch as a project?'); await app.answer('Save as project…'); assert.equal(await app.asking(4000), null, 'no prompt 2') })
  assert.equal(await readFile(script, 'utf8'), original, 'file on disk unchanged')
  const saved = bundle(join(files, 'FromScratch.ourgeoproj'))
  const tab = saved.manifest.ui.session.tabs.find(t => t.fileName === 'analysis.R')
  assert(tab && tab.isDirty && tab.content.includes('# held in project'), 'edit held unsaved in the bundle')
  assert.equal(saved.manifest.ui.plots.plots.length, 1)
  assert(saved.hasEnv)
  // Reopening it next launch: it was open at quit.
  assert.equal((await lastSession('A')).project, join(files, 'FromScratch.ourgeoproj'))
  const b = await start('A')
  assert.equal(await b.projectName(), 'FromScratch')
  assert.deepEqual(await b.rValue('exists("s3_obj")'), true)
  await b.selectTab('analysis.R')
  assert.match(await b.editorText(), /held in project/)
  assert(((await b.tabs()).find(t => t.startsWith('analysis.R')) ?? '').includes('*'), 'still dirty')
  await stop(b)
  await rm(join(files, 'FromScratch.ourgeoproj'))
  await writeFile(join((await profile('A')).data, 'last-session.json'), JSON.stringify({ cleanExit: true, project: null }))
})

await check('S6', 'scratch → named → scratch in one session: scratch is clean except untitled documents', async () => {
  const a = await start('A')
  await a.r('s6 <- 1; plot(1)')
  const target = join(files, 'S6.ourgeoproj')
  await a.saveProjectAs(target)
  await a.menu('New')
  await a.waitIdle()
  assert.equal(await a.projectName(), 'scratch')
  assert.deepEqual(await a.rValue('exists("s6")'), false)
  assert((await a.tabs()).some(t => t.startsWith('Untitled-2')), 'untitled note still there')
  await stop(a)
  await rm(target)
})

// ── Named projects ────────────────────────────────────────────────────────────
let cursorN1, tabsN1
await check('N1', 'named project: quit with no prompt; restart restores documents, edits, cursor, objects, plots and the indicator', async () => {
  let a = await start('A')
  await a.saveProjectAs(project)
  await a.r('n1_df <- data.frame(id = 1:5); n1_env <- new.env(); assign("inside", 42, n1_env); library(tools); plot(1:5)')
  await a.newUntitled('project note\nline two\nline three')
  const note = (await a.tabs()).at(-1).replace(/\*$/, '')
  await a.openFile(script)
  await a.type('# unsaved edit\n')
  await a.selectTab(note)
  await a.page.keyboard.press('Control+End')
  await sleep(900)
  cursorN1 = await a.cursor()
  tabsN1 = await a.tabs()
  await sleep(2500) // the debounced draft write
  await stop(a, 'quit', async app => { assert.equal(await app.asking(3000), null, 'no prompt by default') })
  assert.equal((await draftMeta('A', project)).changed, true)
  assert.equal(await readFile(script, 'utf8'), original)
  a = await start('A')
  assert.equal(await a.projectName(), 'Persist')
  assert.deepEqual(await a.tabs(), tabsN1)
  assert.deepEqual(await a.cursor(), cursorN1, 'cursor of the active document')
  assert.match(await a.editorText(), /line three/)
  await a.selectTab('analysis.R')
  assert.match(await a.editorText(), /unsaved edit/)
  assert.deepEqual(await a.rValue('c(nrow(n1_df), get("inside", n1_env), "tools" %in% (.packages()))'), [5, 42, 1])
  assert.equal(await a.page.locator('[data-ourgeo-id="project.dropdown"]').innerText().then(t => t.includes('•')), true)
  await a.menu()
  assert.equal(await a.page.locator('[data-ourgeo-id="project.keptLocally"]').count(), 1, 'indicator present')
  await a.closeMenu()
  await stop(a)
})

await check('N2', 'switching to another project and back restores the same state, without prompting', async () => {
  const other = join(files, 'Other.ourgeoproj')
  let a = await start('A')
  await a.r('n2_marker <- "here"')
  await sleep(2500)
  await a.saveProjectAs(other) // Save As makes Other the open project; Persist keeps its own draft
  await a.openRecent(project)
  assert.equal(await a.asking(2000), null)
  assert.equal(await a.projectName(), 'Persist')
  assert.deepEqual(await a.tabs(), tabsN1)
  await a.selectTab('analysis.R')
  assert.match(await a.editorText(), /unsaved edit/)
  await stop(a)
  await rm(other)
  const p = await profile('A')
  await rm(join(p.data, 'project-drafts', draftKey(other)), { recursive: true, force: true })
})

await check('N6', 'Save writes the bundle and clears the draft; file edits stay unsaved and the file is unchanged', async () => {
  const a = await start('A')
  await a.menu('Save')
  await a.waitIdle()
  const meta = await draftMeta('A', project)
  assert.equal(meta.changed, false)
  assert.equal(meta.baseSignature, await sha(project))
  assert.equal(await readFile(script, 'utf8'), original)
  const saved = bundle(project)
  assert(saved.manifest.ui.session.tabs.find(t => t.fileName === 'analysis.R').content.includes('unsaved edit'))
  await a.menu()
  assert.equal(await a.page.locator('[data-ourgeo-id="project.keptLocally"]').count(), 0, 'indicator gone (N8)')
  await a.closeMenu()
  await stop(a)
})

await check('N3', 'closing a dirty file tab: Cancel, Discard and Save each do what they say', async () => {
  const a = await start('A')
  await a.selectTab('analysis.R')
  await a.closeActive()
  assert.equal(await a.asking(), 'Save changes to analysis.R?')
  await a.answer('Cancel')
  assert((await a.tabs()).some(t => t.startsWith('analysis.R')))
  await a.closeActive()
  await a.asking(); await a.answer('Discard')
  assert(!(await a.tabs()).some(t => t.startsWith('analysis.R')))
  assert.equal(await readFile(script, 'utf8'), original)
  await a.openFile(script)
  await a.type('# saved on close\n')
  await a.closeActive()
  await a.asking(); await a.answer('Save')
  await sleep(500)
  assert.match(await readFile(script, 'utf8'), /saved on close/)
  await writeFile(script, original)
  await stop(a)
})

await check('N4', 'closing an untitled tab with text: Save to file… (picker cancelled keeps it), Discard, Cancel', async () => {
  const a = await start('A')
  await a.newUntitled('n4 text')
  const name = (await a.tabs()).at(-1).replace(/\*$/, '')
  await a.stubSave(null)
  await a.closeActive()
  assert.match(await a.asking(), /to a file\?$/)
  await a.answer('Save to file…')
  await sleep(500)
  assert((await a.tabs()).some(t => t.startsWith(name)), 'cancelled picker keeps the tab')
  await a.closeActive()
  await a.asking(); await a.answer('Cancel')
  assert((await a.tabs()).some(t => t.startsWith(name)))
  const target = join(files, 'n4.R')
  await a.stubSave(target)
  await a.closeActive()
  await a.asking(); await a.answer('Save to file…')
  await sleep(600)
  assert.equal(await readFile(target, 'utf8'), 'n4 text')
  await stop(a)
})

await check('N5', 'Close All with three dirty tabs and "Apply to all remaining": one question', async () => {
  const a = await start('A')
  for (const n of [1, 2, 3]) await a.newUntitled(`close all ${n}`)
  const tab = a.page.locator('[aria-label="Open document tabs"] button[data-active]').last()
  await tab.dispatchEvent('contextmenu', { clientX: 300, clientY: 80 })
  await a.page.getByText('Close All', { exact: true }).evaluate(el => el.click())
  const titles = []
  titles.push(await a.asking())
  await a.answer('Discard', { check: true })
  await sleep(800)
  titles.push(await a.asking(1500))
  assert.equal(titles[1], null, `only one question: ${titles}`)
  assert(!(await a.tabs()).some(t => t.includes('close all')))
  await stop(a)
})

await check('N7', 'Revert lists what will be lost; afterwards the workspace is the bundle and the draft is gone', async () => {
  const a = await start('A')
  await a.r('n7_new <- 99')
  await a.newUntitled('to be reverted')
  await sleep(2500)
  await a.menu()
  await a.click('[data-ourgeo-id="project.revert"]')
  assert.match(await a.asking(), /^Revert Persist/)
  const text = await a.askText()
  assert.match(text, /document with unsaved edits/); assert.match(text, /R object changed/)
  await a.answer('Revert')
  await a.waitIdle()
  assert.deepEqual(await a.rValue('exists("n7_new")'), false)
  assert(!(await a.tabs()).some(t => t.includes('to be reverted')))
  assert.equal((await draftMeta('A', project)).changed, false)
  await stop(a)
})

await check('N9', 'When closing a saved project: Keep / Save automatically / Ask', async () => {
  await setting('A', { closeBehavior: 'ask' })
  let a = await start('A')
  await a.r('n9 <- 1')
  await a.closeRequested(300)
  assert.equal(await a.asking(), 'Unsaved changes')
  await a.answer('Cancel'); await sleep(800)
  assert.equal(a.app.process().exitCode, null)
  await stop(a, 'quit', async app => { await app.asking(); await app.answer("Don't Save") })
  assert.equal((await draftMeta('A', project)).changed, true, "Don't Save keeps the draft")
  await setting('A', { closeBehavior: 'save' })
  const before = await sha(project)
  a = await start('A')
  await a.r('n9 <- 2')
  await stop(a, 'quit', async app => { assert.equal(await app.asking(3000), null) })
  assert.notEqual(await sha(project), before, 'saved on quit')
  assert.equal((await draftMeta('A', project)).changed, false)
  await setting('A', { closeBehavior: 'keep' })
})

await check('N6a', 'Save document edits when saving the project: files written on save and on an automatic save at switch; a read-only file offers Save As / Skip / Cancel', async () => {
  await setting('A', { saveDocumentsWithProject: true, closeBehavior: 'save' })
  let a = await start('A')
  await a.openFile(script)
  await a.type('# written by project save\n')
  await a.menu('Save'); await a.waitIdle()
  assert.match(await readFile(script, 'utf8'), /written by project save/)
  await a.type('# written at switch\n')
  await a.menu('New'); await a.waitIdle()
  assert.match(await readFile(script, 'utf8'), /written at switch/)
  await writeFile(script, original)
  await a.openRecent(project)
  const ro = join(files, 'readonly.R'); await writeFile(ro, 'r <- 1\n'); chmodSync(ro, 0o444)
  await a.openFile(ro); await a.type('# cannot write\n')
  await a.menu('Save')
  assert.equal(await a.asking(), 'Could not save readonly.R')
  await a.answer('Cancel'); await a.waitIdle()
  await a.menu('New')
  assert.equal(await a.asking(), 'Could not save readonly.R')
  await a.answer('Cancel'); await a.waitIdle()
  assert.equal(await a.projectName(), 'Persist', 'Cancel cancelled the switch')
  await a.menu('Save'); await a.asking(); await a.answer('Skip this file'); await a.waitIdle()
  assert.equal((await draftMeta('A', project)).changed, false, 'saved with the file skipped')
  chmodSync(ro, 0o644)
  await stop(a)
  await setting('A', { saveDocumentsWithProject: false, closeBehavior: 'keep' })
})

await check('C1', 'crash in a named project: text back; checkpointed objects back; the later one named as missing', async () => {
  await setting('A', { checkpointInterval: 10 })
  let a = await start('A')
  const previous = (await draftMeta('A', project))?.checkpointAt ?? null
  await a.newUntitled('typed before the crash')
  await a.r('c1_early <- 1:3')
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline && (await draftMeta('A', project))?.checkpointAt === previous) await sleep(500)
  const checkpointed = await draftMeta('A', project)
  assert.notEqual(checkpointed.checkpointAt, previous, 'an idle checkpoint happened after the object was made')
  await a.r('c1_late <- 4:6')
  await sleep(2500)
  await stop(a, 'kill')
  assert.equal((await lastSession('A')).cleanExit, false)
  a = await start('A')
  assert.equal(await a.asking(), 'ouRGeo did not close properly')
  const text = await a.askText()
  assert.match(text, /restored from the checkpoint at/)
  assert.match(text, /need re-running/)
  await a.answer('Dismiss')
  assert.deepEqual(await a.rValue('c(exists("c1_early"), exists("c1_late"))'), [true, false])
  assert((await a.tabs()).some(t => t.startsWith('Untitled-')))
  await stop(a)
})

await check('N12a', 'snapshot interval: 10 s checkpoints after idle; "only when closing" does not; a command during a snapshot is not held up', async () => {
  await setting('A', { checkpointInterval: 0 })
  let a = await start('A')
  const t0 = (await draftMeta('A', project)).checkpointAt
  await a.r('n12a <- 1')
  await sleep(15_000)
  assert.equal((await draftMeta('A', project)).checkpointAt, t0, 'no idle checkpoint when set to closing only')
  await stop(a)
  assert.notEqual((await draftMeta('A', project)).checkpointAt, t0, 'checkpoint on close')
  await setting('A', { checkpointInterval: 10 })
  a = await start('A')
  const t1 = (await draftMeta('A', project)).checkpointAt
  await a.r('big <- runif(6e7)')
  const deadline = Date.now() + 40_000
  let timed = null
  while (Date.now() < deadline) {
    const status = await a.page.evaluate(async () => { const port = await window.electronAPI.r.getPort(); return (await fetch(`http://127.0.0.1:${port}/session/checkpoint/status`)).json() })
    if (status.state === 'running') {
      const t = Date.now(); const res = await a.r('1 + 1'); timed = { ms: Date.now() - t, ok: res.success }
      break
    }
    await sleep(100)
  }
  assert(timed, 'caught a checkpoint while it was running')
  assert(timed.ms < 1500, `command answered in ${timed.ms} ms during a snapshot`)
  await waitForAsync(a.page, async t => (await window.electronAPI.drafts.read((await window.electronAPI.drafts.launch()).project ?? null)).meta.checkpointAt !== t, t1, { timeout: 60_000 }).catch(() => {})
  const after = await draftMeta('A', project)
  assert.notEqual(after.checkpointAt, t1)
  await a.r('rm(big)')
  await stop(a)
  await setting('A', { checkpointInterval: 30 })
  return { commandMsDuringSnapshot: timed.ms, snapshotMs: after.checkpointMs }
})

await check('C4', 'R killed, app alive: documents untouched; objects back from the checkpoint; R-specific message', async () => {
  await setting('A', { checkpointInterval: 10 })
  const a = await start('A')
  await a.r('c4_obj <- "kept"')
  await sleep(14_000)
  const tabs = await a.tabs()
  // The app's own R — its direct child. A forked snapshot child also matches
  // server.R, and killing that one proves nothing.
  const rpid = execSync(`pgrep -P ${a.pid} -f 'server\\.R'`).toString().trim().split(/\s+/)[0]
  assert(rpid, 'found the R server')
  process.kill(Number(rpid), 'SIGKILL')
  assert.equal(await a.asking(60_000), 'R restarted')
  assert.match(await a.askText(), /checkpoint at/)
  await a.answer('OK')
  assert.deepEqual(await a.rValue('exists("c4_obj")'), true)
  assert.deepEqual(await a.tabs(), tabs)
  await stop(a)
  await setting('A', { checkpointInterval: 30 })
})

await check('N14', 'restore: in-memory raster rebuilt; closed connection and deleted temp raster named; silenced warning still logs; Prompts re-enables it', async () => {
  let a = await start('A')
  await a.r(`suppressMessages(library(terra)); n14_mem <- rast(nrows = 3, ncols = 3, vals = 1:9)
f <- file.path(tempdir(), "n14.tif"); writeRaster(n14_mem, f, overwrite = TRUE); n14_tmp <- rast(f)
n14_con <- DBI::dbConnect(RSQLite::SQLite(), ":memory:"); DBI::dbDisconnect(n14_con)`)
  const tif = await a.rValue('f')
  await sleep(2500)
  await stop(a)
  // R is stopped, not quit, so its temp folder survives; a temp file that is
  // gone by the next session is what this checks.
  await rm(tif)
  a = await start('A')
  assert.equal(await a.asking(), 'Some R objects could not be restored')
  const text = await a.askText()
  assert.match(text, /n14_con \(database connection\)/); assert.match(text, /n14_tmp \(temporary raster file is gone\)/)
  await a.answer('OK', { check: true })
  assert.deepEqual(await a.rValue('sum(terra::values(n14_mem))'), 45)
  await a.r('rm(n14_con, n14_tmp)')
  await stop(a)
  a = await start('A')
  assert.equal(await a.asking(4000), null, 'silenced')
  await a.r(`n14_con2 <- DBI::dbConnect(RSQLite::SQLite(), ":memory:"); DBI::dbDisconnect(n14_con2)`)
  await sleep(2500)
  await stop(a)
  a = await start('A')
  assert.equal(await a.asking(4000), null)
  assert.match(await a.page.locator('body').innerText(), /Not restored: n14_con2 \(database connection\)/)
  await a.click('[data-ourgeo-id="toolbar.settings"]')
  await a.page.getByRole('button', { name: 'Prompts', exact: true }).first().evaluate(el => el.click())
  await a.click('[data-ourgeo-id="settings.promptsNotRestored"]')
  await a.page.keyboard.press('Escape')
  await a.r(`n14_con3 <- DBI::dbConnect(RSQLite::SQLite(), ":memory:"); DBI::dbDisconnect(n14_con3); rm(n14_mem)`)
  await sleep(2500)
  await stop(a)
  a = await start('A')
  assert.equal(await a.asking(), 'Some R objects could not be restored')
  await a.answer('OK')
  await a.r('rm(list = intersect(ls(), c("n14_con2", "n14_con3", "f")))')
  await stop(a)
})

await check('N13', 'a second window cannot open the same project; a stale lock from a killed process is taken over', async () => {
  const a = await start('A')
  const b = await new App('A').launch(); running.push(b)
  await b.page.waitForFunction(() => document.body.innerText.includes('R session ready'), undefined, { timeout: 90_000 })
  assert.equal(await b.asking(30_000), 'Persist is already open')
  await b.answer('OK')
  await sleep(1500)
  assert.equal(await b.projectName(), 'scratch')
  await stop(b, 'kill')
  await stop(a, 'kill')
  const lock = JSON.parse(await readFile(join((await profile('A')).data, 'project-drafts', draftKey(project), 'lock.json'), 'utf8'))
  assert(lock.pid > 0, 'the killed process left its lock')
  const c = await start('A')
  if (await c.asking(4000) === 'ouRGeo did not close properly') await c.answer('Dismiss')
  assert.equal(await c.projectName(), 'Persist', 'stale lock taken over')
  await stop(c)
})

await check('C3', 'a corrupt document recovery file: the others recover, the bad one is named', async () => {
  let a = await start('A')
  await a.newUntitled('c3 survives')
  await a.newUntitled('c3 corrupted')
  await sleep(2500)
  await stop(a, 'kill')
  const docs = join((await profile('A')).data, 'project-drafts', draftKey(project), 'docs')
  let corrupted = null
  for (const name of await readdir(docs)) {
    const doc = JSON.parse(await readFile(join(docs, name), 'utf8'))
    if (doc.content === 'c3 corrupted') { await writeFile(join(docs, name), '{"content": "c3 cor'); corrupted = name }
  }
  assert(corrupted)
  a = await start('A')
  assert.equal(await a.asking(), 'ouRGeo did not close properly')
  assert.match(await a.askText(), /Could not be recovered[\s\S]*Untitled-/)
  await a.answer('Dismiss')
  const tabsNow = await a.tabs()
  await a.selectTab(tabsNow.find(t => t.startsWith('Untitled-')))
  let found = false
  for (const t of tabsNow.filter(t => t.startsWith('Untitled-'))) { await a.selectTab(t); if ((await a.editorText()).includes('c3 survives')) found = true }
  assert(found, 'the readable document recovered')
  await stop(a)
})

await check('C5', 'killed between a draft write and its rename: the previous draft is intact and loads', async () => {
  let a = await start('A')
  await a.newUntitled('c5 before the fault')
  await sleep(2500)
  await stop(a)
  // With the fault armed, the first draft write after launch kills the app
  // between writing its temp file and renaming it over the previous one.
  a = new App('A')
  const p = await profile('A')
  a.app = await electron.launch({ executablePath: electronExecutable, args: ['--no-sandbox', p.wrapper], cwd: root, timeout: 60_000,
    env: { ...process.env, TMPDIR: temporary, XDG_CONFIG_HOME: p.base, OURGEO_CONTEXT_TEST_PROFILE: p.data, OURGEO_TEST_DRAFT_FAULT: 'kill-before-rename' } })
  const child = a.app.process()
  const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve))
  // Raced against the exit: killed during startup, Playwright's firstWindow()
  // would wait for ever for a window that is never coming.
  await Promise.race([exited, (async () => {
    try {
      a.page = await a.app.firstWindow({ timeout: 60_000 })
      await a.page.waitForFunction(() => document.querySelector('[data-ourgeo-id="project.dropdown"]')?.dataset.restored === 'true', undefined, { timeout: 120_000 })
      await a.selectTab('Untitled-')
      await a.type(' — and after', { at: 'end' })
    } catch { /* killed by the fault part-way through */ }
  })()])
  const code = await Promise.race([exited.then(() => 'exited'), sleep(30_000).then(() => 'running')])
  if (code !== 'exited') { try { process.kill(child.pid, 'SIGKILL') } catch { /* gone */ } }
  assert.equal(code, 'exited', 'the fault fired')
  for (const r of rPids()) if (!before.has(r)) { try { process.kill(Number(r), 'SIGKILL') } catch { /* gone */ } }
  const draftDir = join((await profile('A')).data, 'project-drafts', draftKey(project))
  for (const name of await readdir(join(draftDir, 'docs'))) JSON.parse(await readFile(join(draftDir, 'docs', name), 'utf8'))
  a = await start('A')
  if (await a.asking() === 'ouRGeo did not close properly') await a.answer('Dismiss')
  let found = false
  for (const t of (await a.tabs()).filter(t => t.startsWith('Untitled-'))) { await a.selectTab(t); if ((await a.editorText()).includes('c5 before the fault')) found = true }
  assert(found, 'previous draft loaded')
  await stop(a)
})

// ── Conflicts ─────────────────────────────────────────────────────────────────
async function theirChange(code, docText) {
  const b = await start('B')
  await b.stubOpen(project)
  await b.menu('Load…'); await b.waitIdle()
  if (await b.asking(2000)) await b.answer("Don't save")
  await b.waitIdle()
  assert.equal(await b.projectName(), 'Persist')
  if (code) await b.r(code)
  if (docText) { await b.selectTab('Untitled-'); await b.type(docText, { at: 'end' }) }
  await b.menu('Save'); await b.waitIdle()
  await stop(b)
}

await check('N10', 'file changed from a second profile: three choices; Discard opens theirs; Overwrite keeps mine', async () => {
  let a = await start('A')
  await a.r('mine_only <- "A"')
  await sleep(2500)
  await stop(a)
  await theirChange('theirs_only <- "B"')
  a = await new App('A').launch(); running.push(a)
  await a.page.waitForFunction(() => document.body.innerText.includes('R session ready'), undefined, { timeout: 90_000 })
  assert.equal(await a.asking(30_000), 'Persist was changed elsewhere')
  const text = await a.askText()
  for (const label of ['Discard my changes and open theirs', 'Open my version and save it over theirs', 'Resolve conflicts…']) assert(text.includes(label), label)
  await a.answer('Open my version and save it over theirs')
  assert.equal(await a.asking(), 'Save over their version?')
  assert.match(await a.askText(), /was last saved on/)
  await a.answer('Save over it')
  await a.waitIdle()
  assert.deepEqual(await a.rValue('c(exists("mine_only"), exists("theirs_only"))'), [true, false])
  assert.equal((await draftMeta('A', project)).baseSignature, await sha(project))
  await a.r('mine_again <- 1')
  await sleep(2500)
  await stop(a)
  await theirChange('theirs_again <- 2')
  a = await new App('A').launch(); running.push(a)
  await a.page.waitForFunction(() => document.body.innerText.includes('R session ready'), undefined, { timeout: 90_000 })
  assert.equal(await a.asking(30_000), 'Persist was changed elsewhere')
  await a.answer('Discard my changes and open theirs')
  await a.waitIdle()
  assert.deepEqual(await a.rValue('c(exists("mine_again"), exists("theirs_again"))'), [false, true])
  await stop(a)
})

await check('N11', 'Resolve conflicts: one-sided changes combine; a text hunk, an R object and a layer conflict resolved; the bundle holds the choices; Cancel writes nothing', async () => {
  let a = await start('A')
  await a.r('shared <- "base"; doc_obj <- 1')
  await a.newUntitled('alpha\nbeta\ngamma')
  await a.menu('Save'); await a.waitIdle()
  await a.r('shared <- "mine"; mine_new <- TRUE')
  await a.selectTab('Untitled-')
  await sleep(300)
  await stop(a)
  // Mine edits line 2 of the note; theirs edits it too, differently.
  a = await start('A')
  for (const t of (await a.tabs()).filter(t => t.startsWith('Untitled-'))) { await a.selectTab(t); if ((await a.editorText()).includes('alpha')) break }
  await a.focusEditor(); await a.page.keyboard.press('Control+Home'); await a.page.keyboard.press('ArrowDown'); await a.page.keyboard.press('End'); await a.type(' MINE', { at: 'caret' })
  await sleep(2500)
  await stop(a)
  const b = await start('B')
  await b.stubOpen(project); await b.menu('Load…'); await b.waitIdle()
  for (const t of (await b.tabs()).filter(t => t.startsWith('Untitled-'))) { await b.selectTab(t); if ((await b.editorText()).includes('alpha')) break }
  await b.focusEditor(); await b.page.keyboard.press('Control+Home'); await b.page.keyboard.press('ArrowDown'); await b.page.keyboard.press('End'); await b.type(' THEIRS', { at: 'caret' })
  await b.r('shared <- "theirs"; theirs_new <- TRUE')
  await b.menu('Save'); await b.waitIdle()
  await stop(b)
  const theirSignature = await sha(project)
  // Cancel first: nothing written.
  a = await new App('A').launch(); running.push(a)
  await a.page.waitForFunction(() => document.body.innerText.includes('R session ready'), undefined, { timeout: 90_000 })
  assert.equal(await a.asking(30_000), 'Persist was changed elsewhere')
  await a.answer('Resolve conflicts…')
  await a.page.waitForSelector('[data-ourgeo-id="project.mergeDialog"]', { timeout: 60_000 })
  await a.shot('N11-merge')
  const list = await a.page.locator('[data-ourgeo-id="project.mergeDialog"] ul').innerText()
  assert.match(list, /Needs your choice/i); assert.match(list, /shared/); assert.match(list, /Combined automatically/i); assert.match(list, /mine_new/); assert.match(list, /theirs_new/)
  await a.page.locator('[data-ourgeo-id="project.mergeDialog"]').getByRole('button', { name: 'Cancel', exact: true }).evaluate(el => el.click())
  await a.waitIdle()
  assert.equal(await sha(project), theirSignature, 'Cancel wrote nothing')
  // Again, and finish.
  await a.menu('Save')
  assert.equal(await a.asking(), 'Persist was changed elsewhere')
  await a.answer('Resolve conflicts…')
  const dialog = a.page.locator('[data-ourgeo-id="project.mergeDialog"]')
  await dialog.waitFor()
  await dialog.locator('ul button').filter({ hasText: 'shared' }).evaluate(el => el.click())
  assert.match(await dialog.innerText(), /chr "mine"|"mine"/)
  await dialog.getByRole('button', { name: 'Keep both', exact: true }).evaluate(el => el.click())
  const docRow = dialog.locator('ul button').filter({ hasText: 'Untitled-' })
  await docRow.first().evaluate(el => el.click())
  await dialog.getByRole('button', { name: 'Both (mine first)', exact: true }).first().evaluate(el => el.click())
  await dialog.getByRole('button', { name: 'Finish and save', exact: true }).evaluate(el => el.click())
  await a.waitIdle()
  const merged = bundle(project)
  const note = merged.manifest.ui.session.tabs.find(t => t.content.includes('alpha'))
  assert.match(note.content, /beta MINE\nbeta THEIRS/)
  assert.deepEqual(await a.rValue('c(shared, shared_mine, exists("mine_new"), exists("theirs_new"))'), ['theirs', 'mine', 'TRUE', 'TRUE'])
  assert.equal((await draftMeta('A', project)).baseSignature, await sha(project))
  await stop(a)
})

await check('N12', 'a draft without a base copy: Resolve conflicts is absent, and the dialog says why', async () => {
  let a = await start('A')
  await a.r('n12 <- 1')
  await sleep(2500)
  await stop(a)
  await rm(join((await profile('A')).data, 'project-drafts', draftKey(project), 'base.ourgeoproj'))
  await theirChange('n12_theirs <- 1')
  a = await new App('A').launch(); running.push(a)
  await a.page.waitForFunction(() => document.body.innerText.includes('R session ready'), undefined, { timeout: 90_000 })
  assert.equal(await a.asking(30_000), 'Persist was changed elsewhere')
  const text = await a.askText()
  assert(!text.includes('Resolve conflicts…'))
  assert.match(text, /needs a copy of the project as you opened it/)
  await a.answer('Discard my changes and open theirs')
  await a.waitIdle()
  await stop(a)
})

await check('C2', 'crash in scratch: untitled text recovered; objects, map and plots gone; warning shown', async () => {
  let a = await start('A')
  await a.menu('New'); await a.waitIdle()
  await a.newUntitled('scratch crash note')
  await a.r('c2 <- 1; plot(1)')
  await sleep(2500)
  await stop(a, 'kill')
  a = await start('A')
  assert.equal(await a.asking(), 'ouRGeo did not close properly')
  assert.match(await a.askText(), /This was scratch/)
  await a.answer('Dismiss')
  let found = false
  for (const t of (await a.tabs()).filter(t => t.startsWith('Untitled-'))) { await a.selectTab(t); if ((await a.editorText()).includes('scratch crash note')) found = true }
  assert(found)
  assert.deepEqual(await a.rValue('exists("c2")'), false)
  await stop(a)
})

await check('M1', 'Settings → Projects lists drafts with sizes; Delete removes only the draft', async () => {
  const doomed = join(files, 'Doomed.ourgeoproj')
  let a = await start('A')
  await a.saveProjectAs(doomed)
  await a.r('doomed <- 1')
  await sleep(2500)
  await a.menu('New'); await a.waitIdle()
  await a.click('[data-ourgeo-id="toolbar.settings"]')
  await a.page.getByRole('button', { name: 'Projects', exact: true }).first().evaluate(el => el.click())
  const panel = a.page.locator('[data-ourgeo-id="settings.projectsDrafts"]')
  await panel.getByText('Doomed', { exact: false }).first().waitFor()
  assert.match(await panel.innerText(), /KB|MB|B/)
  await panel.getByRole('button', { name: 'Delete the draft of Doomed' }).evaluate(el => el.click())
  assert.match(await a.asking(), /Delete the draft of Doomed/)
  await a.answer('Delete draft')
  await sleep(800)
  assert(!existsSync(join((await profile('A')).data, 'project-drafts', draftKey(doomed))))
  assert(existsSync(doomed), 'the project file is untouched')
  await a.page.keyboard.press('Escape')
  await stop(a)
})

for (const a of running.splice(0)) { try { await a.kill() } catch { /* ignore */ } }
for (const r of rPids()) if (!before.has(r)) { try { process.kill(Number(r), 'SIGKILL') } catch { /* gone */ } }
report.passed = report.failures.length === 0
await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
console.log(`\n${Object.values(report.checks).filter(c => c.passed).length}/${Object.keys(report.checks).length} passed · report: ${join(directory, 'report.json')}`)
process.exit(report.passed ? 0 : 1)
