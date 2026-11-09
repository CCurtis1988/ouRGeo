// Judge calibration (spec §5.5(4)), run before baselines count: judges grade
// answers with known labels. Must reach ≥95% agreement with the labels; Sonnet–
// Opus agreement is reported as Cohen's κ. Uses train and val only, never the
// sealed test.
//
//   node scripts/skill-training/calibrate-judge.mjs
//
// Positives are each task's reference answer. Negatives are its wrong answer and
// the reference answer of another rubric task, which must not satisfy this rubric.

import fs from 'node:fs'
import path from 'node:path'
import { CACHE } from './lib/app.mjs'
import { loadTasks } from './lib/tasks.mjs'
import { judge, rubricPass } from './lib/judge.mjs'

const rubrics = [...loadTasks('train'), ...loadTasks('val')].flatMap(task => task.graders.filter(g => g.rubric).map(g => ({ task, rubric: g.rubric })))
if (rubrics.length < 2) throw new Error(`Need at least 2 rubric graders, found ${rubrics.length}`)

const cases = rubrics.flatMap(({ task, rubric }, i) => {
  const other = rubrics[(i + 1) % rubrics.length].task
  return [
    task.reference?.answer && { id: `${task.id}/reference`, answer: task.reference.answer, rubric, label: true },
    task.wrong?.answer && { id: `${task.id}/wrong`, answer: task.wrong.answer, rubric, label: false },
    other.reference?.answer && { id: `${task.id}/other-task`, answer: other.reference.answer, rubric, label: false },
  ].filter(Boolean)
})

const rows = []
for (const c of cases) {
  const [sonnet, opus] = await Promise.all(['sonnet', 'opus'].map(async model => rubricPass(await judge(c.answer, c.rubric, { model }))))
  rows.push({ id: c.id, label: c.label, sonnet, opus })
  if (sonnet !== c.label || opus !== c.label) console.log(`MISS ${c.id}: label ${c.label}, sonnet ${sonnet}, opus ${opus}`)
}

const rate = fn => rows.filter(fn).length / rows.length
const accuracy = model => rate(r => r[model] === r.label)
const observed = rate(r => r.sonnet === r.opus)
const yesS = rate(r => r.sonnet), yesO = rate(r => r.opus)
const chance = yesS * yesO + (1 - yesS) * (1 - yesO)
const kappa = chance === 1 ? 1 : (observed - chance) / (1 - chance)
const summary = { cases: rows.length, sonnet: accuracy('sonnet'), opus: accuracy('opus'), kappa, passed: accuracy('sonnet') >= 0.95 && accuracy('opus') >= 0.95 }
fs.writeFileSync(path.join(CACHE, 'judge-calibration.json'), JSON.stringify({ summary, rows }, null, 1))
console.log(summary)
process.exit(summary.passed ? 0 : 1)
