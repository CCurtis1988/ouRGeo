// P5 results: the skill system (build AFTER) against the baseline (BEFORE),
// paired by task, with a bootstrap CI, a sign test and Holm correction across all
// comparisons. Writes Markdown to stdout.
//
//   node scripts/skill-training/p5-report.mjs > docs/agent-skill-results.md

import fs from 'node:fs'
import path from 'node:path'
import { CACHE } from './lib/app.mjs'
import { pairedDiff, signTest, holm } from './lib/stats.mjs'

const load = label => { const f = path.join(CACHE, 'ledger', `${label}.jsonl`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [] }
const rates = rows => { const m = new Map(); for (const r of rows) { const a = m.get(r.task) ?? [0, 0]; a[0] += r.pass ? 1 : 0; a[1]++; m.set(r.task, a) } return new Map([...m].map(([k, [p, n]]) => [k, p / n])) }
const pct = x => `${Math.round(100 * x)}%`

const PAIRS = [
  ['Locked test', 'Haiku', 'p5-before-haiku-test', 'p5-after-haiku-test'],
  ['Locked test', 'Sonnet', 'p5-before-sonnet-test', 'p5-after-sonnet-test'],
  ['Locked test', 'Qwen', 'p5-before-qwen-test', 'p5-after-qwen-test'],
  ['Tuning set', 'Haiku', 'base-haiku-val', 'p5-after-haiku-val'],
  ['Tuning set', 'Sonnet', 'base-sonnet-val', 'p5-after-sonnet-val'],
  ['Tuning set', 'Opus', 'base-opus-val', 'p5-after-opus-val'],
  ['Tuning set', 'Qwen', 'base-qwen-val', 'p5-after-qwen-val'],
  ['Skill reaches the model (60 probes)', 'Haiku', 'trigger-804274f41e8c-haiku', 'trigger-cbd55cab280d-haiku'],
  ['Skill reaches the model (60 probes)', 'Qwen', 'trigger-804274f41e8c-qwen', 'trigger-cbd55cab280d-qwen'],
]

const rows = []
for (const [set, model, before, after] of PAIRS) {
  const B = rates(load(before)), A = rates(load(after))
  const tasks = [...A.keys()].filter(k => B.has(k))
  if (!tasks.length) { rows.push({ set, model, missing: true }); continue }
  const d = pairedDiff(new Map(tasks.map(k => [k, B.get(k)])), new Map(tasks.map(k => [k, A.get(k)])))
  const up = tasks.filter(k => A.get(k) > B.get(k)).length, down = tasks.filter(k => A.get(k) < B.get(k)).length
  rows.push({ set, model, tasks: tasks.length, before: d.baseline, after: d.candidate, diff: d.diff, ci: d.ci95, up, down, p: signTest(up, down) })
}
const measured = rows.filter(r => !r.missing)
const adjusted = holm(measured.map(r => r.p))
measured.forEach((r, i) => { r.pAdj = adjusted[i] })

console.log('| Test | Model | Tasks | Before | After | Change (95% CI) | Better / worse | p (Holm) |')
console.log('|---|---|---|---|---|---|---|---|')
for (const r of rows) {
  if (r.missing) { console.log(`| ${r.set} | ${r.model} | not run | | | | | |`); continue }
  console.log(`| ${r.set} | ${r.model} | ${r.tasks} | ${pct(r.before)} | ${pct(r.after)} | ${r.diff >= 0 ? '+' : ''}${Math.round(100 * r.diff)} (${Math.round(100 * r.ci[0])} to ${Math.round(100 * r.ci[1])}) | ${r.up} / ${r.down} | ${r.pAdj < 0.001 ? '<0.001' : r.pAdj.toFixed(3)} |`)
}

console.log('\n**Skill tasks** (the skill system itself; after only, since the baseline has no skills):\n')
console.log('(measured build, then the shipped build with manual skills made unsearchable)\n')
console.log('| Model | Measured build | Shipped build |')
console.log('|---|---|---|')
for (const model of ['haiku', 'sonnet', 'opus', 'qwen']) {
  const cell = label => { const r = load(label); return r.length ? `${r.filter(x => x.pass).length}/${r.length}` : 'pending' }
  console.log(`| ${model[0].toUpperCase()}${model.slice(1)} | ${cell(`p5-after-${model}-skills`)} | ${cell(`final-${model}-skills`)} |`)
}
const failed = ['haiku', 'sonnet', 'opus', 'qwen'].flatMap(m => load(`p5-after-${m}-skills`).filter(r => !r.pass).map(r => `${m} ${r.task}: ${r.results.filter(x => !x.pass).map(x => x.detail).join('; ').slice(0, 160)}`))
if (failed.length) console.log(`\nFailures:\n${failed.map(f => `- ${f}`).join('\n')}`)
