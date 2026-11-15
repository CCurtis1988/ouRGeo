// Memory study report: do saved project memories reach the model, and are they
// followed? One row per model × arm, from .cache/skill-training/ledger/mem-*.jsonl.
//
//   node scripts/skill-training/mem-report.mjs
//
// Memories are seeded by tests/fixtures/agent-skills/memory/memory.json:
// eval-memory-0 "Always make all plot dark themed", eval-memory-1 "Always use
// metric units in charts and reports" (plus two unrelated project memories).

import fs from 'node:fs'
import path from 'node:path'
import { CACHE } from './lib/app.mjs'

const ledgerDir = path.join(CACHE, 'ledger')
const MEMORY = { dark: 'memory:eval-memory-0', metric: 'memory:eval-memory-1' }
const ARMS = ['base', 'thorough', 'pin', 'f1', 'f2a', 'f2c', 'f2b', 'shipped', 'final']
const ARM_LABEL = { base: 'Balanced (today)', thorough: 'Thorough (today)', pin: 'Pinned "Always apply" (ceiling)', f1: 'F1 prompt sentence', f2a: 'F2a routing, no keyword gate', f2c: 'F2c routing + graphics category', f2b: 'F2b saved-instructions card', shipped: 'F2c in production code (memory reads still cost lookups)', final: '**Final fix (as committed)**' }
const pct = (n, d) => d ? `${Math.round(100 * n / d)}%` : '–'

function how(row, id) {
  const hits = row.selected.flat().filter(s => s.sourceId === id)
  if (!hits.length) return null
  const reasons = new Set(hits.map(s => s.reason))
  if (reasons.has('user marked Always apply')) return 'pinned'
  if (reasons.has('saved instruction')) return 'card'
  if (reasons.has('local task routing')) return 'routed'
  return 'searched'
}

const rows = []
for (const model of ['haiku', 'sonnet', 'opus', 'qwen']) for (const arm of ARMS) {
  const file = path.join(ledgerDir, `mem-${model}-${arm}.jsonl`)
  if (!fs.existsSync(file)) continue
  const data = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  const s = { model, arm, n: data.length, need: 0, reached: 0, followed: 0, followedGivenReached: 0, reachedN: 0, via: {}, darkN: 0, dark: 0, metricN: 0, metric: 0, noPlot: 0, ctrlTokens: [], tokens: [], calls: [], budget: 0, ctrlPass: 0, ctrlN: 0 }
  for (const row of data) {
    s.tokens.push(row.inputTokens); s.calls.push(row.toolCalls)
    if (row.episode.tools.some(t => String(t.result).includes('BUDGET_LIMIT'))) s.budget++
    if (row.task === 'memory-control-mean') { s.ctrlN++; if (row.pass) s.ctrlPass++; s.ctrlTokens.push(row.inputTokens); continue }
    const result = type => row.results.find(r => r.type === type)
    const checks = []
    const dark = result('plot_dark')
    if (dark) {
      if (!result('plot_made')?.pass) s.noPlot++
      else checks.push(['dark', dark.pass])
    }
    const metric = result('r_code_regex') ?? result('output_regex')
    if (metric) checks.push(['metric', metric.pass])
    for (const [memory, followed] of checks) {
      s.need++
      const via = how(row, MEMORY[memory])
      if (via) { s.reached++; s.via[via] = (s.via[via] ?? 0) + 1; s.reachedN++; if (followed) s.followedGivenReached++ }
      if (followed) s.followed++
      if (memory === 'dark') { s.darkN++; if (followed) s.dark++ } else { s.metricN++; if (followed) s.metric++ }
    }
  }
  rows.push(s)
}
const mean = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0

console.log('| Model | Arm | Episodes | Memory reached the model | How | Followed (all) | Followed when reached | Dark plots | Metric | Mean input tokens | Control-question input tokens | Lookup-limit refusals |')
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|')
for (const s of rows) {
  console.log(`| ${s.model[0].toUpperCase()}${s.model.slice(1)} | ${ARM_LABEL[s.arm]} | ${s.n} | ${s.reached}/${s.need} (${pct(s.reached, s.need)}) | ${Object.entries(s.via).map(([k, v]) => `${k} ${v}`).join(', ') || '–'} | ${s.followed}/${s.need} (${pct(s.followed, s.need)}) | ${s.followedGivenReached}/${s.reachedN} (${pct(s.followedGivenReached, s.reachedN)}) | ${s.dark}/${s.darkN} | ${s.metric}/${s.metricN} | ${mean(s.tokens).toLocaleString()} | ${mean(s.ctrlTokens).toLocaleString()} | ${s.budget} |`)
}
const noPlot = rows.filter(s => s.noPlot).map(s => `${s.model} ${s.arm}: ${s.noPlot}`)
if (noPlot.length) console.log(`\nPlot tasks with no R plot made (not counted for "dark"): ${noPlot.join('; ')}`)

// Held-out instructions no routing category was written for (memory-heldout split).
// Rows recorded before the uppercase grader was made case-sensitive are regraded
// from the R they ran, with the same rule applied case-sensitively.
const UPPER = /\$\s*[A-Z][A-Z0-9_]{2,}\s*<-|\[\[\s*["'][A-Z][A-Z0-9_]{2,}["']\s*\]\]\s*<-|\[\s*,?\s*["'][A-Z][A-Z0-9_]{2,}["']\s*\]\s*<-|(?:mutate|transform|within)\s*\([^)]*\b[A-Z][A-Z0-9_]{2,}\s*=/
console.log('\n**Held-out instructions** (caption on figures, UPPER CASE column names, row count in reports):\n')
console.log('| Model | Arm | Passed | caption | upper case | rows (weak: often stated anyway) |')
console.log('|---|---|---|---|---|---|')
for (const model of ['haiku', 'sonnet', 'qwen']) for (const arm of ARMS) {
  const file = path.join(ledgerDir, `memho-${model}-${arm}.jsonl`)
  if (!fs.existsSync(file)) continue
  const data = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  const ok = row => row.task.includes('upper') && row.results.some(r => r.type === 'r_code_regex')
    ? row.episode.tools.filter(t => /execute_r_code/.test(t.name)).some(t => UPPER.test(String(t.input.code))) : row.pass
  const cell = key => { const rows = data.filter(r => r.task.includes(key)); return `${rows.filter(ok).length}/${rows.length}` }
  console.log(`| ${model[0].toUpperCase()}${model.slice(1)} | ${ARM_LABEL[arm]} | ${data.filter(ok).length}/${data.length} | ${cell('caption')} | ${cell('upper')} | ${cell('rows')} |`)
}
