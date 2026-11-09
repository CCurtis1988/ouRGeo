// Launch the BUILT app in eval mode inside a throwaway sandbox.
//
// Isolation (spec §4.1): HOME and XDG_CONFIG_HOME point into
// .cache/skill-training/sandboxes/<id>, so the app's userData, R's working
// directory and anything model-written R code drops in "~" land there — the
// maintainer's ~/.config/ourgeo is never read or written. R loses ~/.Rprofile
// with the real HOME, so the library paths it set are passed explicitly.
// The `claude` CLI finds its OWN login through a symlink to ~/.claude; ouRGeo
// never reads it (CLAUDE.md: never read, copy or reuse the CLI's credentials).

import { _electron as electron } from 'playwright-core'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const ROOT = path.resolve(import.meta.dirname, '../../..')
export const CACHE = path.join(ROOT, '.cache/skill-training')
const ELECTRON = path.join(ROOT, 'node_modules/electron/dist/electron')
/** The frozen build to launch (snapshot.mjs); falls back to the repo's out/. */
// SKILL_BUILD selects a frozen build, so a treatment can run beside a baseline that
// is still measuring the build `current` points at.
export const APP_DIR = process.env.SKILL_BUILD ? fs.realpathSync(path.join(CACHE, 'apps', process.env.SKILL_BUILD)) : fs.existsSync(path.join(CACHE, 'apps/current/out/main/index.js')) ? fs.realpathSync(path.join(CACHE, 'apps/current')) : ROOT
export const BUILD_ID = APP_DIR === ROOT ? 'repo-out' : path.basename(APP_DIR)
const REAL_HOME = os.homedir()

function rLibs() {
  try {
    return execSync(`HOME=${JSON.stringify(REAL_HOME)} Rscript -e 'cat(.libPaths(), sep=":")'`).toString().trim()
  } catch { return '' }
}

/** R servers spawned by this Electron process, and no one else's. */
function childR(parent) {
  try { return execSync(`pgrep -P ${parent} -f 'server\\.R' 2>/dev/null`).toString().trim().split(/\s+/).filter(Boolean) }
  catch { return [] }
}

/**
 * @param {{ id: string, provider: string, model: string, localUrl?: string, contextOverride?: number }} arm
 */
export async function launchApp(arm) {
  if (!fs.existsSync(path.join(APP_DIR, 'out/main/index.js'))) throw new Error('Run `npm run build` first.')
  const box = path.join(CACHE, 'sandboxes', arm.id)
  fs.rmSync(box, { recursive: true, force: true })
  const home = path.join(box, 'home'), config = path.join(box, 'config'), work = path.join(box, 'work')
  const userData = path.join(config, 'ourgeo')
  for (const dir of [home, userData, work]) fs.mkdirSync(dir, { recursive: true })
  for (const entry of ['.claude', '.claude.json']) {
    if (fs.existsSync(path.join(REAL_HOME, entry))) fs.symlinkSync(path.join(REAL_HOME, entry), path.join(home, entry))
  }
  const write = (name, value) => fs.writeFileSync(path.join(userData, name), JSON.stringify(value))
  write('ai-preferences.json', { provider: arm.provider, modelByProvider: { [arm.provider]: arm.model }, autopilotWarningDismissed: true, terminalEnabled: false, webAccessEnabled: false })
  const keys = {}
  if (arm.localUrl) keys[`${arm.provider}_url`] = arm.localUrl
  if (arm.contextOverride) keys[`${arm.provider}_ctx`] = String(arm.contextOverride)
  write('api-keys.json', keys)

  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['--no-sandbox', APP_DIR],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: config, OURGEO_EVAL: '1', R_LIBS_USER: rLibs(), ELECTRON_ENABLE_LOGGING: '0' },
    timeout: 90_000,
  })
  const page = app.windows().find(w => !w.url().startsWith('devtools://')) ?? await app.firstWindow()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.waitForFunction(() => Boolean(window.__ourgeoEval), null, { timeout: 90_000 })
  await page.waitForFunction(() => window.__ourgeoEval.state().rReady, null, { timeout: 120_000 })

  // Native dialogs have no human in a hidden window, and an unanswered one holds its
  // tool call for ever. The data-preflight review is the case that was measured:
  // every Toolbox run needing a CRS review hung. Answered per the task's `confirm`.
  await app.evaluate(({ dialog }) => {
    globalThis.__evalApprove = true
    dialog.showMessageBox = async (...args) => {
      const options = args.at(-1), approve = (options.buttons ?? []).findIndex(b => /^(approve|ok|yes|continue|replace|save)/i.test(b))
      return { response: globalThis.__evalApprove && approve >= 0 ? approve : options.cancelId ?? 0, checkboxChecked: false }
    }
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
    dialog.showSaveDialog = async () => ({ canceled: true })
  })
  const setApprove = approve => app.evaluate((_, value) => { globalThis.__evalApprove = value }, approve)

  /** Call a bridge method in the page; args must be JSON. */
  const call = (method, ...args) => page.evaluate(([m, a]) => window.__ourgeoEval[m](...a), [method, args])
  const close = async () => {
    // Closing goes through the app's leave-workspace prompt, which nothing in a
    // harness answers, so a graceful close can wait for ever. The sandbox is
    // disposable: give it a moment, then kill our own process tree.
    const proc = app.process()
    // Taken before the kill, while R is still Electron's child. Matching every
    // new server.R would also hit a parallel runner's R or the developer's app.
    const ownR = childR(proc.pid)
    await Promise.race([app.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000))])
    try { process.kill(-proc.pid, 'SIGKILL') } catch { try { proc.kill('SIGKILL') } catch { /* gone */ } }
    for (const pid of ownR) { try { process.kill(Number(pid), 'SIGKILL') } catch { /* gone */ } }
  }
  return { app, page, call, close, errors, box, work, setApprove }
}
