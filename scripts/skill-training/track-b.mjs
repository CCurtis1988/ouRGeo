// Track B (spec §8): do the coding-agent skills make a Claude better at changing
// this repository? `claude plugin eval` has no script graders, so per §8's
// fallback each case runs through `claude -p` in a disposable worktree, graded by
// the repository's own checks.
//
//   node scripts/skill-training/track-b.mjs --arm with|without|null --model haiku [--runs 3] [--ids a,b]
//
// `null` is the control: no agent, so the seeded or unchanged tree must FAIL.
// Agents and checks run under bwrap, writable only in their worktree and the
// CLI's own state, so nothing here can touch the developer's ~/.config/ourgeo.

import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CACHE, ROOT } from './lib/app.mjs'
import { waitForQuota } from './lib/claude.mjs'

const args = process.argv.slice(2)
const opt = (name, fallback) => args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback
const arm = opt('arm', 'null'), model = opt('model', 'haiku'), runs = arm === 'null' ? 1 : Number(opt('runs', '3')), ids = opt('ids', '').split(',').filter(Boolean)
if (!['with', 'without', 'null'].includes(arm)) throw new Error(`Unknown arm ${arm}`)

const AGENT_TIMEOUT_MS = 20 * 60 * 1000, CHECK_TIMEOUT_MS = 5 * 60 * 1000
const TOOLS = 'Bash Edit Write Read Grep Glob Skill'
const HEAD = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim()
const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/agent-skills-track-b/cases.json'), 'utf8')).filter(c => !ids.length || ids.includes(c.id))
const ledgerFile = path.join(CACHE, 'ledger', `trackb-${arm}-${arm === 'null' ? 'control' : model}.jsonl`)
const done = new Set(fs.existsSync(ledgerFile) ? fs.readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).key) : [])
const log = (...x) => console.log(new Date().toISOString().slice(11, 19), ...x)
const git = (cwd, ...rest) => execFileSync('git', rest, { cwd, stdio: 'pipe' }).toString()

function sandbox(tree, argv, { input, timeout }) {
  const home = os.homedir(), admin = git(tree, 'rev-parse', '--absolute-git-dir').trim()
  const rw = [tree, admin, path.join(home, '.claude'), path.join(home, '.claude.json')].filter(p => fs.existsSync(p))
  const res = spawnSync('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp', ...rw.flatMap(p => ['--bind', p, p]), '--chdir', tree, '--die-with-parent', ...argv], {
    input, timeout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CLAUDECODE: '', XDG_CONFIG_HOME: path.join(tree, '.xdg'), XDG_CACHE_HOME: path.join(tree, '.xdg-cache') },
  })
  return res
}

function makeTree(testCase, name) {
  const tree = path.join(CACHE, 'trackb', name)
  fs.rmSync(tree, { recursive: true, force: true }); git(ROOT, 'worktree', 'prune')
  git(ROOT, 'worktree', 'add', '--detach', tree, HEAD)
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tree, 'node_modules'))
  for (const [file, from, to] of testCase.seed ?? []) {
    const full = path.join(tree, file), text = fs.readFileSync(full, 'utf8')
    if (!text.includes(from)) throw new Error(`${testCase.id}: seed text not found in ${file}`)
    fs.writeFileSync(full, text.replace(from, to))
  }
  // Seeds are part of the starting point: the diff graded below is the agent's alone.
  git(tree, 'add', '-A', ':!node_modules'); git(tree, '-c', 'user.name=eval', '-c', 'user.email=eval@local', 'commit', '-qm', 'seed', '--allow-empty')
  if (arm === 'without') { fs.rmSync(path.join(tree, '.claude/skills'), { recursive: true, force: true }); git(tree, 'add', '-A', ':!node_modules'); git(tree, '-c', 'user.name=eval', '-c', 'user.email=eval@local', 'commit', '-qm', 'no skills') }
  return tree
}

function grade(testCase, tree) {
  const results = []
  for (const check of testCase.checks) {
    const res = sandbox(tree, ['bash', '-c', check], { timeout: CHECK_TIMEOUT_MS })
    results.push({ type: 'check', detail: check, pass: res.status === 0, tail: res.status === 0 ? '' : `${res.stdout ?? ''}${res.stderr ?? ''}`.slice(-600) })
  }
  git(tree, 'add', '-A', ':!node_modules', ':!.xdg', ':!.xdg-cache')
  const added = git(tree, 'diff', '--cached', '--', '.', ':!.claude').split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).join('\n')
  // No diff means nothing was fixed, whatever the checks say. A driver case's
  // output is a binary screenshot, which adds no diff lines, so it opts out.
  if (!testCase.anyChange) results.push({ type: 'changed', pass: added.length > 0, detail: `${added.split('\n').length} added lines` })
  for (const pattern of testCase.require ?? []) results.push({ type: 'require', detail: pattern, pass: new RegExp(pattern).test(added) })
  for (const pattern of testCase.deny ?? []) results.push({ type: 'deny', detail: pattern, pass: !new RegExp(pattern).test(added) })
  return { pass: results.every(r => r.pass), results }
}

for (const testCase of cases) {
  for (let run = 0; run < runs; run++) {
    const key = crypto.createHash('sha256').update(JSON.stringify([HEAD, testCase, arm, model, run])).digest('hex').slice(0, 16)
    if (done.has(key)) continue
    const name = `${testCase.id}-${arm}-${model}-${run}`
    const tree = makeTree(testCase, name)
    let usage = {}, seconds = 0, skill = false
    if (arm !== 'null') {
      await waitForQuota()
      const started = Date.now()
      const res = sandbox(tree, ['claude', '-p', '--model', model, '--output-format', 'stream-json', '--verbose', '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence', '--allowedTools', TOOLS], { input: testCase.prompt, timeout: AGENT_TIMEOUT_MS })
      seconds = Math.round((Date.now() - started) / 1000)
      const lines = (res.stdout ?? '').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
      const result = lines.findLast(l => l.type === 'result')
      if (!result || result.is_error) { log(`${name}: HARNESS ${String(result?.result ?? res.error ?? res.stderr).slice(0, 160)} (not recorded)`); continue }
      usage = result.usage ?? {}
      skill = lines.some(l => l.type === 'assistant' && l.message?.content?.some?.(c => c.type === 'tool_use' && c.name === 'Skill'))
    }
    const grading = grade(testCase, tree)
    fs.mkdirSync(path.dirname(ledgerFile), { recursive: true })
    fs.appendFileSync(ledgerFile, JSON.stringify({ key, case: testCase.id, kind: testCase.kind, arm, model, run, head: HEAD, at: new Date().toISOString(), seconds, skill, usage, ...grading }) + '\n')
    log(`${grading.pass ? 'PASS' : 'FAIL'} ${name} ${seconds}s${grading.pass ? '' : ' — ' + grading.results.filter(r => !r.pass).map(r => `${r.type} ${r.detail}`).join('; ').slice(0, 160)}`)
    fs.rmSync(tree, { recursive: true, force: true }); git(ROOT, 'worktree', 'prune')
  }
}
process.exit(0)
