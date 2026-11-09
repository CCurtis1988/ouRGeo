// Re-apply numbers_grounded to recorded rows after a grader fix, from the stored
// answer and tool results. No model runs. Every row with that grader is regraded,
// pass or fail, so the correction cannot favour one direction; re-running only the
// failures would give them a second draw.
//
//   node scripts/skill-training/regrade.mjs base-qwen-train base-haiku-train ...

import fs from 'node:fs'
import path from 'node:path'
import { launchApp, CACHE } from './lib/app.mjs'
import { MODELS } from './lib/models.mjs'
import { GRADERS } from './lib/graders.mjs'
import { loadTasks } from './lib/tasks.mjs'

const tasks = new Map(['train', 'val', 'pilot'].flatMap(split => loadTasks(split)).map(t => [t.id, t]))
const app = await launchApp({ id: `regrade-${process.pid}`, ...MODELS.haiku })
for (const label of process.argv.slice(2)) {
  const file = path.join(CACHE, 'ledger', `${label}.jsonl`)
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  let changed = 0
  for (const row of rows) {
    const task = tasks.get(row.task), unrun = row.results.find(r => r.type === 'no_unrun_claims')
    if (unrun) {
      const next = await GRADERS.no_unrun_claims(true, { final: row.episode.final, tools: row.episode.tools }, {})
      if (next.pass !== unrun.pass) { changed++; console.log(`${label} ${row.task} r${row.run}: unrun ${unrun.pass} → ${next.pass}`) }
      Object.assign(unrun, next)
      row.pass = !row.timedOut && row.results.every(r => r.pass)
    }
    const result = row.results.find(r => r.type === 'numbers_grounded')
    if (!result || !task) continue
    const reset = await app.call('reset', { dir: app.work, r: task.fixture?.r, layers: [], documents: [] })
    if (!reset.ok) { console.log(`${row.task}: fixture failed, left as recorded`); continue }
    const next = await GRADERS.numbers_grounded(true, { final: row.episode.final, tools: row.episode.tools }, { task, call: app.call })
    if (next.pass !== result.pass) { changed++; console.log(`${label} ${row.task} r${row.run}: ${result.pass} → ${next.pass}`) }
    Object.assign(result, next)
    row.pass = !row.timedOut && row.results.every(r => r.pass)
  }
  fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
  console.log(`${label}: ${rows.length} rows, ${changed} verdicts changed`)
}
await app.close()
process.exit(0)
