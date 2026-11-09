// Summarise ledgers, or compare two (spec §6).
//
//   node scripts/skill-training/report.mjs <label> [--vs <baselineLabel>] [--json out.json]

import fs from 'node:fs'
import path from 'node:path'
import { CACHE } from './lib/app.mjs'
import { perTask, pairedDiff, passHatK, ratioOfGeoMeans, holm } from './lib/stats.mjs'

const args = process.argv.slice(2)
const opt = (name) => args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null
const load = label => fs.readFileSync(path.join(CACHE, 'ledger', `${label}.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))

/** Failure classes (spec §7.1), from grader verdicts and the trace. */
export function failureClass(r) {
  if (r.pass) return null
  if (/BUDGET_LIMIT/.test(r.episode.sendError ?? '')) return 'budget-exhausted'
  if (r.episode.sendError) return 'turn-error'
  if (r.timedOut || r.episode.error) return /TIMEOUT/.test(r.episode.error ?? '') ? 'budget-exhausted' : 'transport-error'
  const failed = r.results.filter(x => !x.pass).map(x => x.type)
  if (failed.includes('no_unknown_tools')) return 'guessed-id'
  if (failed.includes('no_action_id_in_r')) return 'action-id-in-r'
  if (failed.includes('r_code_not_regex')) return 'followed-injection'
  if (failed.includes('max_retries')) return 'retry-loop'
  if (failed.includes('numbers_grounded')) return 'ungrounded-number'
  if (failed.includes('no_unrun_claims')) return 'claimed-unrun'
  if (failed.includes('max_tool_calls')) return 'over-tooling'
  if (failed.includes('knits')) return 'document-not-self-contained'
  if (r.toolCalls === 0) return 'no-action'
  if (failed.includes('tool_called')) return 'wrong-tool'
  return 'wrong-outcome'
}

function summarise(records, title) {
  const tasks = perTask(records)
  const rate = [...tasks.values()].reduce((a, b) => a + b, 0) / (tasks.size || 1)
  const byDomain = {}
  for (const r of records) for (const d of r.domains ?? ['?']) (byDomain[d] ??= []).push(r)
  const classes = {}
  for (const r of records) { const c = failureClass(r); if (c) classes[c] = (classes[c] ?? 0) + 1 }
  const med = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }
  console.log(`\n## ${title}: ${records.length} episodes, ${tasks.size} tasks`)
  console.log(`success ${(rate * 100).toFixed(1)}%  pass^2 ${fmt(passHatK(records, 2))}  pass^3 ${fmt(passHatK(records, 3))}`)
  console.log(`median: ${Math.round(med(records.map(r => r.ms)) / 1000)} s, ${med(records.map(r => r.toolCalls))} calls, ${med(records.map(r => r.inputTokens))} in / ${med(records.map(r => r.outputTokens))} out tokens`)
  console.log('by domain:', Object.entries(byDomain).map(([d, rs]) => `${d} ${Math.round(100 * rs.filter(r => r.pass).length / rs.length)}% (${rs.length})`).join(' · '))
  console.log('failure classes:', Object.entries(classes).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' · ') || 'none')
  return { episodes: records.length, tasks: tasks.size, success: rate, passHat2: passHatK(records, 2), passHat3: passHatK(records, 3), byDomain: Object.fromEntries(Object.entries(byDomain).map(([d, rs]) => [d, rs.filter(r => r.pass).length / rs.length])), classes }
}
const fmt = v => v === null ? '—' : `${(v * 100).toFixed(1)}%`

const label = args.find(a => !a.startsWith('--') && a !== opt('vs') && a !== opt('json'))
const records = load(label)
const out = { label, summary: summarise(records, label) }
const vs = opt('vs')
if (vs) {
  const base = load(vs)
  out.baseline = summarise(base, vs)
  const success = pairedDiff(perTask(base), perTask(records))
  const tokens = ratioOfGeoMeans(perTask(base, r => r.inputTokens + r.outputTokens), perTask(records, r => r.inputTokens + r.outputTokens))
  const time = ratioOfGeoMeans(perTask(base, r => r.ms), perTask(records, r => r.ms))
  const domains = [...new Set(records.flatMap(r => r.domains ?? []))]
  const perDomain = domains.map(d => ({ domain: d, ...pairedDiff(perTask(base.filter(r => r.domains?.includes(d))), perTask(records.filter(r => r.domains?.includes(d)))) }))
  holm(perDomain.map(x => x.signP)).forEach((p, i) => { perDomain[i].holmP = p })
  console.log(`\n## ${label} vs ${vs}`)
  console.log(`success ${(success.diff * 100).toFixed(1)} pp, 95% CI [${(success.ci95[0] * 100).toFixed(1)}, ${(success.ci95[1] * 100).toFixed(1)}], ${success.improved} tasks up / ${success.worsened} down, sign p=${success.signP.toFixed(3)}`)
  console.log(`tokens ×${tokens.ratio.toFixed(2)} [${tokens.ci95.map(x => x.toFixed(2)).join(', ')}]  time ×${time.ratio.toFixed(2)} [${time.ci95.map(x => x.toFixed(2)).join(', ')}]`)
  for (const d of perDomain) console.log(`  ${d.domain}: ${(d.diff * 100).toFixed(0)} pp [${(d.ci95[0] * 100).toFixed(0)}, ${(d.ci95[1] * 100).toFixed(0)}] holm p=${d.holmP.toFixed(2)}`)
  Object.assign(out, { success, tokens, time, perDomain })
}
if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify(out, null, 1))
