// Run tasks against one student arm and grade them (spec §4–§5).
//
//   node scripts/skill-training/run.mjs --model haiku --split val [--runs 2]
//        [--mode episode|probe|oracle|null|wrong] [--overlay cand.json] [--ids a,b]
//
// Modes `oracle`, `null` and `wrong` are the §5.5 controls: they replay the
// task's reference solution, an empty answer, or its known-wrong solution
// through the same graders, with no model involved. Results append to
// .cache/skill-training/ledger/<label>.jsonl, content-addressed so an identical
// configuration is never re-run.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { launchApp, CACHE, ROOT, BUILD_ID } from './lib/app.mjs'
import { MODELS } from './lib/models.mjs'
import { gradeEpisode, setActionIds } from './lib/graders.mjs'
import { acquireLocal, foreignWorkload } from './lib/duty-cycle.mjs'
import { loadTasks } from './lib/tasks.mjs'
import { waitForQuota } from './lib/claude.mjs'

const args = process.argv.slice(2)
const opt = (name, fallback) => args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback
const modelKey = opt('model', 'haiku'), split = opt('split', 'val'), runs = Number(opt('runs', '1'))
const mode = opt('mode', 'episode'), overlayFile = opt('overlay', ''), ids = opt('ids', '').split(',').filter(Boolean)
const label = opt('label', `${modelKey}-${split}-${mode}`)
const arm = MODELS[modelKey]
if (!arm) throw new Error(`Unknown model ${modelKey}`)
const controls = ['oracle', 'null', 'wrong'].includes(mode)

const sha = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex').slice(0, 16)

const tasks = loadTasks(split, { sealed: args.includes('--sealed') }).filter(t => !ids.length || ids.includes(t.id))
if (!tasks.length) throw new Error(`No tasks for split ${split}${ids.length ? ` and ids ${ids}` : ''}`)
const overlay = overlayFile ? JSON.parse(fs.readFileSync(overlayFile, 'utf8')) : null
const surface = overlay ? sha(overlay) : 'baseline'
const commit = BUILD_ID
const ledgerDir = path.join(CACHE, 'ledger'); fs.mkdirSync(ledgerDir, { recursive: true })
const ledger = path.join(ledgerDir, `${label}.jsonl`)
const done = new Set(fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).key) : [])
const log = (...x) => console.log(new Date().toISOString().slice(11, 19), ...x)

/** Replay a reference (or wrong) solution through bridge-level primitives. */
async function replay(app, steps, answer) {
  const tools = []
  for (const step of steps ?? []) {
    if (step.r !== undefined) {
      const res = await app.call('r', step.r)
      tools.push({ name: 'execute_r_code', input: { code: step.r }, result: JSON.stringify({ output: res.output || res.error || '(no output)' }), ms: 0 })
    } else if (step.action) {
      const res = await app.page.evaluate(async ([id, params]) => window.__ourgeoEval.action(id, params), [step.action, step.params ?? {}])
      tools.push({ name: 'run_ui_action', input: { id: step.action, params: step.params ?? {} }, result: res, ms: 0 })
    } else if (step.document !== undefined) {
      await app.call('document', step.document)
      tools.push({ name: 'write_document', input: { content: step.document }, result: 'Written.', ms: 0 })
    } else if (step.tool) {
      tools.push({ name: step.tool, input: step.input ?? {}, result: step.result ?? '', ms: 0 })
    }
  }
  return { ms: 0, error: null, final: answer ?? '', probe: null, tools, trace: null, console: [] }
}

let app = null
async function ensureApp() {
  if (app) return app
  app = await launchApp({ id: `${label}-${process.pid}`, ...arm })
  setActionIds(await app.page.evaluate(() => window.__ourgeoEval.actionIds()))
  if (overlay) await app.call('overlay', overlay)
  return app
}
async function dropApp() { if (app) { const old = app; app = null; await old.close() } }

/** A bridge call that never returns must not freeze the batch for ever. */
const within = (promise, ms, what) => {
  let timer
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} did not return in ${Math.round(ms / 1000)} s`)), ms) })
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer))
}
const OWN_APP_DOMAINS = new Set(['themes', 'plugins', 'layout'])
const APP_STATE_ACTION = /^(env:workIn$|theme:|plugin:|store:|layout:)/
const BRIDGE_MS = 5 * 60 * 1000, SEND_MARGIN_MS = 2 * 60 * 1000, MAX_ATTEMPTS = 3, SLEEP_GAP_MS = 30_000

/**
 * One attempt at one episode. Returns true when it is settled (row recorded, or
 * the fixture itself failed), false when the harness failed and the row must not
 * exist: a model is only scored on a turn it actually got.
 */
async function episode(task, run, key) {
  if (arm.local && !controls) {
    for (;;) { const foreign = await foreignWorkload([arm.model]); if (!foreign.length) break; log(`waiting: smart-box has ${foreign.join(', ')} loaded`); await new Promise(r => setTimeout(r, 300000)) }
    await acquireLocal(arm.worstCaseMs, log)
  }
  const wall = Date.now(), mono = performance.now()
  const a = await ensureApp()
  const call = (method, ...rest) => within(a.call(method, ...rest), method === 'send' ? arm.worstCaseMs + SEND_MARGIN_MS : BRIDGE_MS, method)
  await a.setApprove((task.confirm ?? 'approve') === 'approve')
  const sw = task.switches ?? {}
  await call('configure', { autopilot: sw.autopilot ?? true, web: sw.web ?? false, terminal: sw.terminal ?? false })
  const reset = await call('reset', { dir: a.work, r: task.fixture?.r, layers: task.fixture?.layers, documents: task.fixture?.documents, skills: task.fixture?.skills })
  if (!reset.ok) { log(`${task.id}: FIXTURE FAILED ${reset.output}`); return true }
  let ep
  if (mode === 'oracle') ep = await replay(a, task.reference?.steps, task.reference?.answer)
  else if (mode === 'wrong') ep = await replay(a, task.wrong?.steps, task.wrong?.answer)
  else if (mode === 'null') ep = await replay(a, [], task.nullAnswer ?? '')
  else {
    ep = null
    for (const [index, turn] of task.turns.entries()) {
      const out = await call('send', turn.user, { mode, confirm: task.confirm ?? 'approve', timeoutMs: arm.worstCaseMs })
      ep = ep ? { ...out, tools: [...ep.tools, ...out.tools], final: out.final, ms: ep.ms + out.ms, turns: [...ep.turns, out] } : { ...out, turns: [out] }
      if (out.error || index === task.turns.length - 1) break
    }
  }
  // performance.now() stops while the machine sleeps; Date.now() does not. A turn
  // that spanned a sleep has lost sockets and its timing is meaningless.
  if (!controls && Date.now() - wall - (performance.now() - mono) > SLEEP_GAP_MS) throw new Error('machine slept during the episode')
  // Nothing said, nothing done: the turn never reached a model, so it says nothing
  // about the model. The panel's error line says why; a usage limit is waited out,
  // anything else is an app failure to report, never a task failure to score.
  if (!controls && mode !== 'probe' && !ep.error && !ep.tools.length && !ep.final.trim()) {
    const reason = ep.sendError ?? 'no error line'
    log(`${task.id} r${run}: HARNESS empty turn: ${String(reason).slice(0, 200)} (not recorded)`); await dropApp()
    if (!arm.local) await waitForQuota()
    return false
  }
  const grade = mode === 'probe' ? gradeProbe(task, ep) : await gradeEpisode(task, ep, { call, task, work: a.work, rEnv: { R_LIBS_USER: process.env.R_LIBS_USER ?? '' } })
  total++; if (grade.pass) passed++
  const usage = (ep.turns ?? []).flatMap(t => t.trace?.usage ?? [])
  const record = { key, label, task: task.id, split, domains: task.domains, modules: task.modules, model: modelKey, modelId: arm.model, mode, run, surface, commit, at: new Date().toISOString(),
    pass: grade.pass, timedOut: grade.timedOut ?? false, results: grade.results, ms: ep.ms, toolCalls: ep.tools.length,
    inputTokens: usage.reduce((s, u) => s + (u.inputTokens ?? 0), 0), outputTokens: usage.reduce((s, u) => s + (u.outputTokens ?? 0), 0),
    episode: { final: ep.final, error: ep.error, sendError: ep.sendError ?? null, probe: ep.probe, tools: ep.tools.map(t => ({ ...t, result: String(t.result).slice(0, 20000) })) } }
  fs.appendFileSync(ledger, JSON.stringify(record) + '\n')
  // A timed-out or failed turn can leave the panel mid-stream; the next send
  // would then be a silent no-op. Relaunch rather than trust that instance.
  // `reset` clears the session, not app-level state: the working environment, custom
  // themes, plugins and the layout survive it, so a later task (or the next run of
  // this one) would inherit them. launchApp wipes the sandbox, so a relaunch is clean.
  if (ep.error || task.domains?.some(d => OWN_APP_DOMAINS.has(d)) || ep.tools.some(t => APP_STATE_ACTION.test(String(t.input?.id)))) await dropApp()
  log(`${grade.pass ? 'PASS' : 'FAIL'} ${task.id} r${run} ${Math.round(ep.ms / 1000)}s ${ep.tools.length} calls${grade.pass ? '' : ' — ' + grade.results.filter(r => !r.pass).map(r => `${r.type}: ${r.detail}`).join('; ').slice(0, 300)}`)
  return true
}

let passed = 0, total = 0, unrecorded = 0
for (const task of tasks) {
  for (let run = 0; run < (controls ? 1 : runs); run++) {
    const key = sha([commit, surface, sha(task), controls ? mode : arm.model, mode, run])
    if (done.has(key)) continue
    for (let attempt = 1; ; attempt++) {
      let settled = false
      try { settled = await episode(task, run, key) }
      catch (e) { log(`${task.id} r${run}: HARNESS ${String(e.message ?? e).split('\n')[0]} (attempt ${attempt}, not recorded)`); await dropApp() }
      if (settled) break
      if (attempt >= MAX_ATTEMPTS) { unrecorded++; log(`${task.id} r${run}: GAVE UP after ${attempt} attempts`); break }
    }
  }
}
log(`${label}: ${passed}/${total} passed${unrecorded ? `, ${unrecorded} UNRECORDED` : ''}`)
await dropApp()
process.exit(0)

/** Probe grading: the first call is the expected one, or on-path discovery. */
function gradeProbe(task, ep) {
  const first = ep.probe
  const expect = task.probe ?? {}
  const name = first?.name?.replace(/^mcp__ourgeo__/, '')
  const direct = Boolean(first && name === expect.tool && (!expect.where || (() => { try { return new Function('i', `return (${expect.where})`)({ ...first.input, ...(first.input.toolId ? { tool: first.input.toolId, id: first.input.toolId } : {}) }) } catch { return false } })()))
  // A trigger probe (`probe.skill`): did that skill reach the model, by the host
  // attaching it at the start of the turn or by the model's first call loading it?
  if (expect.skill) {
    const attached = (ep.turns ?? []).some(t => (t.trace?.selected ?? []).some(e => e.sourceId === `skill:${expect.skill}`))
    // The old build's only loader was ourgeo_docs with a topic, so a before/after compares like with like.
    const loaded = (name === 'use_skill' && first?.input?.name === expect.skill) || (name === 'ourgeo_docs' && String(first?.input?.topic ?? '').toLowerCase() === expect.skill)
    return { pass: attached || loaded, direct: loaded, discovery: attached, results: [{ type: 'probe', pass: attached || loaded, detail: `skill ${expect.skill}: ${attached ? 'attached by the host' : loaded ? 'loaded by the model' : `not reached; first call ${name ?? 'none'}(${JSON.stringify(first?.input ?? {}).slice(0, 100)})`}` }] }
  }
  const discovered = Boolean(first && (expect.discovery ?? ['list_ui_actions', 'toolbox_tools', 'context_search', 'ourgeo_docs', 'use_skill']).includes(name))
  // On path means the call actually surfaced the expected item in its top five.
  const discovery = discovered && (!expect.item || String(first.result ?? '').split('\n').filter(l => l.trim()).slice(0, 6).join('\n').includes(expect.item))
  return { pass: direct || discovery, direct, discovery, results: [{ type: 'probe', pass: direct || discovery, detail: `first call ${name ?? 'none'}(${JSON.stringify(first?.input ?? {}).slice(0, 120)}); expected ${expect.tool}${expect.where ? ` where ${expect.where}` : ''}` }] }
}
