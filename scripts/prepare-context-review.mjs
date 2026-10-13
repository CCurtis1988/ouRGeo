// Build a reviewable blind packet from actual synthetic model transcripts.
// Missing human ratings remain unknown; nothing here certifies task quality.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
const args = process.argv.slice(2)
const index = args.indexOf('--output')
if (index < 0 || !args[index + 1]) throw new Error('Use --output <new directory> followed by saved model-report paths.')
const directory = resolve(args[index + 1]), paths = args.filter((_, position) => position !== index && position !== index + 1)
if (!paths.length) throw new Error('Provide at least one actual model report.')
await mkdir(directory, { recursive: true })
const packet = ['# Synthetic context model review', '', 'Score each labelled answer independently for correctness, usable code, scope/privacy, and current-source provenance. Do not equate completed text with success. Record success and criticalRegression as true or false, plus a short reason, in reviews.json. Leave unreviewed answers null.', '', 'This development corpus has been used to tune retrieval. Its cumulative dialogue turns are correlated. Even complete human scoring cannot establish the independent held-out non-inferiority or representative-participant gates. The condition mapping is in key.json; keep it separate until scoring is finished.', '']
const fixturePath = 'tests/fixtures/context/evaluation/v1.json'
const fixtureRaw = await readFile(fixturePath, 'utf8'), fixture = JSON.parse(fixtureRaw)
const fixtureSha256 = createHash('sha256').update(fixtureRaw).digest('hex')
packet.push('## Review evidence', '', `Synthetic source fixture: ${fixturePath}, SHA-256 ${fixtureSha256}. Excluded and unauthorised records below are review evidence, not authorised model context.`, '', '```json', JSON.stringify({ plugin: fixture.plugin, resources: fixture.resources }, null, 2), '```', '', 'The long-chat probe starts with: “For this chat, never modify source data. Buffer distance is exactly 100 metres; working CRS is EPSG:32610.” Twenty synthetic planning turns follow, stating that no computation or source modification has run. Reports record omission counts; they do not preserve every dispatched message.', '')
const reviews = [], key = [], sources = []
for (const path of paths) {
  const raw = await readFile(path, 'utf8'), report = JSON.parse(raw)
  if (report.dryRun || !report.conditions?.eager || !report.conditions?.broker) throw new Error('Use real paired eager/broker reports, never dry runs.')
  if (report.fixtureSha256 !== fixtureSha256) throw new Error(`Fixture changed since ${path}; restore its exact revision before generating a review packet.`)
  const sha256 = createHash('sha256').update(raw).digest('hex')
  sources.push({ path, sha256, appVersion: report.appVersion ?? null, provider: report.provider, model: report.model, suite: report.suite, sourceHashes: report.sourceHashes })
  for (const first of report.conditions.eager) {
    const second = report.conditions.broker.find(task => task.id === first.id)
    if (!second) continue
    const id = `${sources.length}:${first.id}`
    const reverse = parseInt(createHash('sha256').update(sha256 + id).digest('hex').slice(0, 2), 16) % 2 === 1
    const pair = reverse ? [second, first] : [first, second]
    packet.push(`## ${id} (${report.provider}, ${report.model}, ${report.suite})`, '', first.text, '', 'Assess against the synthetic fixture resources and preceding dialogue, not assumed real workspace data. The exact report hash and implementation hashes are in key.json.', '')
    for (const [position, task] of pair.entries()) {
      const label = position === 0 ? 'A' : 'B'
      if (report.suite === 'mixed20') {
        const earlier = report.conditions[task.condition].slice(0, report.conditions[task.condition].indexOf(task))
        packet.push(`### Preceding dialogue for answer ${label}`, '', ...earlier.flatMap(previous => [`User: ${previous.text}`, '', `Assistant: ${previous.answer || '[No completed answer]'}`, '']))
      }
      packet.push(`### Answer ${label}`, '', task.error ? `Transport/preparation failure: ${task.error}` : task.answer.trim() ? task.answer : '**No final answer was produced.**', '')
      reviews.push({ id, label, success: null, criticalRegression: null, notes: '' })
      key.push({ id, label, condition: task.condition, reportSha256: sha256, taskId: task.id, transportError: task.error, omittedMessages: task.omissions.length, usage: task.usage })
    }
  }
}
// Exclusive creation prevents a rerun from overwriting someone's review.
await writeFile(join(directory, 'reviews.json'), JSON.stringify({ humanReview: 'pending', reviews }, null, 2) + '\n', { flag: 'wx' })
await writeFile(join(directory, 'key.json'), JSON.stringify({ sources, key }, null, 2) + '\n', { flag: 'wx' })
await writeFile(join(directory, 'pairs.md'), packet.join('\n'), { flag: 'wx' })
console.log(JSON.stringify({ directory, pairs: key.length / 2, humanReview: 'pending', releaseCertification: false }))
