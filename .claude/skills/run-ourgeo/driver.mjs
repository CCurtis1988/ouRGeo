// REPL driver for the ouRGeo Electron app.
//
// Designed for agents: wrap in tmux, send-keys commands, capture-pane output.
// Launch is slow (~10s: Electron boot + the R server handshake), so a REPL beats
// relaunching per interaction.
//
// Run from the repo root:  node .claude/skills/run-ourgeo/driver.mjs
// Headless Linux:          xvfb-run -a node .claude/skills/run-ourgeo/driver.mjs

import { _electron as electron } from 'playwright-core'
import * as readline from 'node:readline'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'

const APP_DIR = path.resolve(import.meta.dirname, '../../..')
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/ourgeo-shots'
fs.mkdirSync(SHOT_DIR, { recursive: true })

const electronBin = process.platform === 'darwin'
  ? path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(APP_DIR, 'node_modules/electron/dist/electron')

let app = null
let page = null

/** R servers that were already running when this driver launched the app.
 *
 *  The sweep on quit used to be `pkill -f server.R`, which is every R server on
 *  the machine — including the one belonging to a developer's own `npm run dev`
 *  session sitting open in another window. Killing that wipes their live R
 *  environment (r-bridge restarts the process, so nothing looks broken until
 *  they go looking for their objects). Only servers that appeared after our
 *  launch can be ours. */
let preexistingR = new Set()

function rServerPids() {
  try {
    return execSync("pgrep -f 'server\\.R' 2>/dev/null").toString().trim().split(/\s+/)
      .filter(Boolean)
  } catch { return [] }   // pgrep exits 1 when nothing matches
}

/** Session/workspace files ouRGeo restores on launch. Clearing them makes a run
 *  deterministic — otherwise you inherit whatever tabs the last session left. */
const SESSION_FILES = [
  'session.json', 'console.json', 'spatial-layers.json', 'spatial-ui.json',
  'object-tabs.json', 'plots.json',
  // `layout.json` is a PREFERENCE, not session state — the app deliberately
  // keeps it between runs. It is wiped here anyway, because `launch clean`
  // promises a deterministic starting UI and a layout carried over from the
  // last run means panels are open that this run never opened.
  'layout.json',
]

function userDataDir() {
  const home = process.env.HOME || ''
  if (process.platform === 'darwin') return path.join(home, 'Library/Application Support/ourgeo')
  if (process.platform === 'win32') return path.join(process.env.APPDATA || '', 'ourgeo')
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'ourgeo')
}

const COMMANDS = {
  /** `launch` — start the app. `launch clean` wipes the persisted session first. */
  async launch(arg) {
    if (app) return console.log('already launched')

    if (arg === 'clean') {
      const dir = userDataDir()
      for (const f of SESSION_FILES) {
        try { fs.unlinkSync(path.join(dir, f)) } catch { /* absent is fine */ }
      }
      console.log('cleared session files in', dir)
    }

    preexistingR = new Set(rServerPids())

    if (!fs.existsSync(path.join(APP_DIR, 'out/main/index.js'))) {
      console.log('ERROR: out/main/index.js missing — run `npm run build` first')
      return
    }

    app = await electron.launch({
      executablePath: electronBin,
      args: ['--no-sandbox', APP_DIR],
      env: { ...process.env },
      timeout: 60_000,
    })
    page = app.windows().find((w) => !w.url().startsWith('devtools://')) ?? await app.firstWindow()

    // Wait for the renderer to mount rather than sleeping a fixed amount.
    try {
      await page.waitForSelector('[role="tablist"], .monaco-editor', { timeout: 30_000 })
    } catch { console.log('WARN: editor did not appear within 30s') }
    console.log('launched:', await page.title())
  },

  /** `ready` — block until the R server reports the session is up. */
  async ready() {
    if (!page) return console.log('ERROR: launch first')
    try {
      await page.waitForFunction(
        () => document.body.innerText.includes('R session ready'),
        { timeout: 60_000 },
      )
      console.log('R session ready')
    } catch { console.log('TIMEOUT: R session did not become ready') }
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first')
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png')
    await page.screenshot({ path: f })
    console.log('screenshot:', f)
  },

  // DOM click, not locator.click() — coordinate math is unreliable against the
  // absolutely-positioned layers behind the Monaco canvas.
  async click(sel) {
    if (!page) return console.log('ERROR: launch first')
    console.log('click', sel, '→', await page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return 'NOT_FOUND'
      el.click(); return 'OK'
    }, sel))
  },

  async 'click-text'(text) {
    if (!page) return console.log('ERROR: launch first')
    console.log('click-text', JSON.stringify(text), '→', await page.evaluate((t) => {
      const els = [...document.querySelectorAll('button, a, [role="button"], [role="tab"]')]
      const el = els.find((e) => e.textContent?.trim() === t)
              ?? els.find((e) => e.textContent?.includes(t))
      if (!el) return 'NOT_FOUND'
      el.click(); return 'OK: ' + el.tagName + ' ' + JSON.stringify(el.textContent?.trim().slice(0, 40))
    }, text))
  },

  /** `title <substr>` — click a button by its title attribute (ribbons use title=""). */
  async title(sub) {
    if (!page) return console.log('ERROR: launch first')
    console.log('title', JSON.stringify(sub), '→', await page.evaluate((t) => {
      const el = [...document.querySelectorAll('[title]')].find((e) => e.getAttribute('title')?.includes(t))
      if (!el) return 'NOT_FOUND'
      el.click(); return 'OK: ' + JSON.stringify(el.getAttribute('title'))
    }, sub))
  },

  /** `type <text>` — literal `\n` in the argument is sent as Enter, since a
   *  piped script cannot embed a real newline inside one command. */
  async type(text) {
    if (!page) return console.log('ERROR: launch first')
    for (const [i, part] of text.split('\\n').entries()) {
      if (i > 0) await page.keyboard.press('Enter')
      if (part) await page.keyboard.type(part, { delay: 20 })
    }
  },
  async press(key) { if (page) await page.keyboard.press(key) },

  /** `focus-editor` — put the caret in Monaco so `type`/`press` reach it.
   *  A real mouse click is required: focusing Monaco's hidden textarea via the
   *  DOM reports success but leaves the editor without a cursor, so subsequent
   *  keystrokes are silently dropped. This is the one place a DOM click is NOT
   *  the right tool. */
  async 'focus-editor'() {
    if (!page) return console.log('ERROR: launch first')
    const box = await page.locator('.monaco-editor .view-lines').first().boundingBox()
    if (!box) return console.log('NOT_FOUND')
    await page.mouse.click(box.x + Math.min(60, box.width / 2), box.y + 10)
    // Monaco >= 0.5x focuses a `div.native-edit-context` (the EditContext API),
    // NOT the legacy hidden textarea — accept either.
    const ok = await page.evaluate(() => {
      const a = document.activeElement
      return !!a && (a.classList?.contains('native-edit-context') ||
        (a.tagName === 'TEXTAREA' && !!a.closest('.monaco-editor')))
    })
    console.log(ok ? 'focused' : 'CLICKED BUT NOT FOCUSED')
  },

  /** Native dialogs can't be driven by Playwright — stub them in the MAIN
   *  process instead, then click the UI control that opens them. */
  async 'stub-open'(filePath) {
    if (!app) return console.log('ERROR: launch first')
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
    }, filePath)
    console.log('open dialog stubbed →', filePath)
  },

  /**
   * `stub-images <path> [path...]` — stub the multi-select image picker.
   *
   * Separate from `stub-open` because the point of that dialog is that it
   * returns SEVERAL files, and a stub that can only return one cannot exercise
   * the thing being tested.
   */
  async 'stub-images'(arg) {
    if (!app) return console.log('ERROR: launch first')
    // The REPL hands a command its whole argument string, so the list is split
    // here. Paths with spaces in them cannot be expressed — same limitation as
    // every other command.
    const list = String(arg).split(/\s+/).filter(Boolean)
    await app.evaluate(async ({ dialog }, ps) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ps })
    }, list)
    console.log('image dialog stubbed →', list.join(', '))
  },

  async 'stub-save'(filePath) {
    if (!app) return console.log('ERROR: launch first')
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p })
    }, filePath)
    console.log('save dialog stubbed →', filePath)
  },

  /** `open <path>` — stub + click Open in one step. The usual way to load a file. */
  async open(filePath) {
    await COMMANDS['stub-open'](filePath)
    await COMMANDS.title('Open')
    await new Promise((r) => setTimeout(r, 1200))
    await COMMANDS.tabs()
  },

  /** `tabs` — list open tabs with the active one marked. */
  async tabs() {
    if (!page) return console.log('ERROR: launch first')
    console.log(await page.evaluate(() =>
      [...document.querySelectorAll('[data-active]')]
        .map((e) => (e.getAttribute('data-active') === 'true' ? '* ' : '  ') + e.textContent?.trim())
        .join('\n') || '(no tabs found)'
    ))
  },

  /** `lang` — read the editor toolbar's document-type selector. */
  async lang() {
    if (!page) return console.log('ERROR: launch first')
    console.log(await page.evaluate(() =>
      document.querySelector('[title="Document type"]')?.textContent?.trim() ?? 'NOT_FOUND'))
  },

  /** `tokens` — Monaco's rendered token classes for the visible lines. Proves
   *  syntax highlighting actually applied, which a screenshot only hints at. */
  async tokens() {
    if (!page) return console.log('ERROR: launch first')
    console.log(await page.evaluate(() =>
      [...document.querySelectorAll('.view-line')].slice(0, 30).map((l) =>
        [...l.querySelectorAll('span span')]
          .map((s) => `${JSON.stringify(s.textContent)}:${s.className}`).join(' ')
      ).join('\n') || '(no lines)'
    ))
  },

  /** `r <code>` — run R through the console input, as a user would. */
  async r(code) {
    if (!page) return console.log('ERROR: launch first')
    const ok = await page.evaluate(() => {
      const ta = [...document.querySelectorAll('textarea')].find((t) =>
        (t.placeholder || '').includes('Type R code'))
      if (!ta) return false
      ta.focus(); return true
    })
    if (!ok) return console.log('console input NOT_FOUND')
    await page.keyboard.type(code, { delay: 10 })
    await page.keyboard.press('Enter')
    console.log('sent:', code)
  },

  /** `console` — tail of the R console pane. */
  async console(n) {
    if (!page) return console.log('ERROR: launch first')
    const lines = Number(n) || 20
    console.log(await page.evaluate((k) => {
      const hdr = [...document.querySelectorAll('*')].find((e) => e.textContent?.trim() === 'R Console')
      const pane = hdr?.closest('div')?.parentElement
      return (pane?.innerText ?? document.body.innerText).split('\n').slice(-k).join('\n')
    }, lines))
  },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first')
    try { await page.waitForSelector(sel, { timeout: 15_000 }); console.log('found:', sel) }
    catch { console.log('TIMEOUT:', sel) }
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first')
    try { console.log(JSON.stringify(await page.evaluate(expr))) }
    catch (e) { console.log('ERROR:', e.message) }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first')
    console.log(await page.evaluate(
      (s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)', sel || null))
  },

  /** `errors` — renderer console errors collected since launch. */
  async errors() { console.log(errorLog.length ? errorLog.join('\n') : '(none)') },

  async windows() {
    if (!app) return console.log('ERROR: launch first')
    for (const w of app.windows()) console.log(' ', w.url())
  },

  async quit() {
    if (app) await app.close().catch(() => {})
    app = null; page = null
    // The R server is a child of Electron but can outlive a hard kill. A stray
    // one holds a random port and confuses the next run. Ours only — see
    // `preexistingR`.
    for (const pid of rServerPids()) {
      if (preexistingR.has(pid)) continue
      try { process.kill(Number(pid)) } catch { /* already gone */ }
    }
  },

  help() { console.log('commands:', Object.keys(COMMANDS).join(', ')) },
}

const errorLog = []

const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') })
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' })

// Commands are queued and run strictly one at a time. readline does NOT await an
// async 'line' handler, so without this a piped script (no tmux available? pipe
// a heredoc) would fire every command at once and interleave them.
let chain = Promise.resolve()
let closed = false
/** rl.prompt() throws once readline is closed, which piped input does early. */
const prompt = () => { if (!closed) rl.prompt() }

rl.on('line', (line) => {
  chain = chain.then(async () => {
    const trimmed = line.trim()
    // '#' comments make piped scripts readable.
    if (!trimmed || trimmed.startsWith('#')) return prompt()
    const sp = trimmed.indexOf(' ')
    const cmd = sp < 0 ? trimmed : trimmed.slice(0, sp)
    const arg = sp < 0 ? '' : trimmed.slice(sp + 1)
    const fn = COMMANDS[cmd]
    if (!fn) { console.log('unknown:', cmd, '— try: help'); return prompt() }
    console.log(`--- ${trimmed}`)
    try { await fn(arg) } catch (e) { console.log('ERROR:', e.message) }
    if (cmd === 'quit') { closed = true; rl.close(); await COMMANDS.quit(); process.exit(0) }
    prompt()
  })
})
// With piped input, 'close' fires as soon as the last line is READ — long before
// the queued commands have run. Drain the chain first or the app is torn down
// mid-script and the run silently produces nothing.
rl.on('close', () => {
  closed = true
  chain = chain.then(async () => { await COMMANDS.quit(); process.exit(0) })
})

// Capture renderer errors so `errors` can report them after the fact.
const hookPage = setInterval(() => {
  if (page && !hookPage.done) {
    hookPage.done = true
    page.on('console', (m) => { if (m.type() === 'error') errorLog.push(m.text()) })
    page.on('pageerror', (e) => errorLog.push('pageerror: ' + e.message))
  }
}, 500)

console.log('ouRGeo driver — "help" for commands, "launch" (or "launch clean") to start')
prompt()
