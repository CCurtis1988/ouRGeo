// Where along the chain did each failure break? (first-principles diagnosis)
// A model succeeds only if a capability is SURFACED to it, then USED, then used
// CORRECTLY. Every failed check is classified from the recorded trace.
//
//   node scripts/skill-training/funnel.mjs base-haiku-train,base-haiku-val base-sonnet-val ...
//
// Tool results are stored truncated to 4000 characters and prefetched evidence is
// not stored, so "never surfaced" is an upper bound.

import fs from 'node:fs'
import path from 'node:path'
import { CACHE } from './lib/app.mjs'
import { loadTasks } from './lib/tasks.mjs'

const tasks = new Map(['train', 'val'].flatMap(s => loadTasks(s)).map(t => [t.id, t]))
const load = label => { const f = path.join(CACHE, 'ledger', `${label}.jsonl`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [] }
const ids = where => [...String(where ?? '').matchAll(/['"]([a-z]+:[A-Za-z]+)['"]/g)].map(m => m[1])

function classify(row) {
  const task = tasks.get(row.task), out = []
  const seen = row.episode.tools.map(t => String(t.result)).join('\n'), called = row.episode.tools.map(t => t.input?.id).filter(Boolean)
  const cut = /BUDGET_LIMIT|STALE_REFERENCE|output limit/.test(row.episode.sendError ?? '') || row.episode.error
  for (const r of row.results.filter(x => !x.pass)) {
    if (r.type === 'tool_called') {
      const spec = task.graders.find(g => g.tool_called)?.tool_called, want = ids(spec?.where)
      if (!want.length) out.push(cut ? 'cut off by a limit' : 'tool not used')
      else if (want.some(id => called.includes(id))) out.push('used, wrong arguments')
      else if (want.some(id => seen.includes(id))) out.push(cut ? 'cut off by a limit' : 'SURFACED, not used')
      else out.push(cut ? 'cut off by a limit' : 'NEVER SURFACED')
    } else if (r.type === 'answer_regex') {
      const spec = r.detail.match(/\/(.*)\/i$/)?.[1]
      const inEvidence = spec && new RegExp(spec, 'i').test(seen)
      out.push(cut ? 'cut off by a limit' : inEvidence ? 'fact surfaced, not stated' : 'FACT NEVER FOUND')
    } else if (r.type === 'max_tool_calls') out.push('over-tooling')
    else if (r.type === 'numbers_grounded') out.push('ungrounded number')
    else if (r.type === 'rubric') out.push('answer wrong or incomplete')
    else out.push(cut ? 'cut off by a limit' : 'wrong outcome')
  }
  return out
}

for (const group of process.argv.slice(2)) {
  const rows = group.split(',').flatMap(load), table = {}
  for (const row of rows) for (const d of row.domains ?? []) {
    const t = table[d] ??= { n: 0, pass: 0, why: {} }
    t.n++; if (row.pass) t.pass++
    else for (const c of new Set(classify(row))) t.why[c] = (t.why[c] ?? 0) + 1
  }
  console.log(`\n## ${group} (${rows.length} rows)`)
  for (const [d, t] of Object.entries(table).sort(([, a], [, b]) => a.pass / a.n - b.pass / b.n)) console.log(`${d.padEnd(17)} ${String(Math.round(100 * t.pass / t.n)).padStart(3)}% /${String(t.n).padEnd(3)} ${Object.entries(t.why).sort(([, a], [, b]) => b - a).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
}
process.exit(0)
