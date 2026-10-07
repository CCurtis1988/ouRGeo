import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { cpus, totalmem } from 'node:os'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

// Synthetic descriptor-only measurement. No user content, R, Python, network,
// model calls or provider ingestion. Latency targets are observations, not CI
// assertions or evidence of task quality. Full delivery includes model evals.
const root = resolve(import.meta.dirname, '..'), directory = join(root, '.cache', 'context-benchmark')
await mkdir(directory, { recursive: true })
const bundle = join(directory, 'benchmark.mjs')
await build({ stdin: { contents: 'export { ContextBroker } from "./src/lib/context/broker"; export { routeContext } from "./src/lib/context/router"; export { ConsoleIndex } from "./src/lib/context/sources/console-index";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: bundle })
const { ContextBroker, routeContext, ConsoleIndex } = await import(pathToFileURL(bundle).href)
global.gc?.()
const initialResident = process.memoryUsage().rss
let fetches = 0
const read = () => { fetches++; throw new Error('The descriptor benchmark must not fetch content.') }
const sources = []
for (const [kind, count] of [['environment', 10000], ['console', 100000], ['document', 100000], ['skill', 200], ['action', 200]]) {
  for (let index = 0; index < count; index++) sources.push({ id: `${kind}:synthetic-${index}`, kind, scope: ['skill', 'action'].includes(kind) ? 'application' : 'workspace',
    title: kind === 'environment' ? `.GlobalEnv::object_${index}` : `${kind} synthetic ${index}`, summary: `${kind} source ${index}; ${index % 97 === 0 ? 'flood parcel exposure' : 'unrelated reference'}`,
    revision: 'fixture-v1', trust: kind === 'environment' ? 'observed' : 'untrusted', ...(kind === 'environment' ? { resource: { environment: '.GlobalEnv', name: `object_${index}` } } : {}), read })
}
global.gc?.()
const descriptorResident = process.memoryUsage().rss
let discoveries = 0
const broker = () => new ContextBroker({ identity: { chatId: 'synthetic-chat', projectId: null, workspaceEpoch: 1, policyRevision: 1 }, target: 'benchmark/no-model', effort: 'balanced', signal: new AbortController().signal, current: () => true,
  sources: kinds => { discoveries++; return kinds ? sources.filter(source => kinds.includes(source.kind)) : sources }, excluded: () => [] })
const percentile = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1]
const simple = []
for (let iteration = 0; iteration < 200; iteration++) {
  const start = performance.now(), route = routeContext('Generate 100 rows of dummy data.')
  assert.deepEqual(route, { topics: [], environment: false, console: false, documents: false, memory: false })
  const turn = broker(); assert.deepEqual(await turn.prefetch([]), [])
  assert.equal(turn.trace.selected.length, 0)
  simple.push(performance.now() - start)
}
assert.equal(discoveries, 0)
const retrieval = [], recall = []
for (let iteration = 0; iteration < 12; iteration++) {
  const start = performance.now()
  const result = JSON.parse(broker().search({ query: iteration % 2 ? '[object_9876]' : 'flood parcel exposure' }))
  assert.equal(result.status, 'ok')
  if (iteration % 2) recall.push(result.results.some(hit => hit.title === '.GlobalEnv::object_9876'))
  if (iteration > 1) retrieval.push(performance.now() - start)
}
assert.equal(fetches, 0)
global.gc?.()
const report = { fixtureVersion: 1, measuredAt: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length, systemMemoryBytes: totalmem(), descriptorCount: sources.length,
  corpus: { objects: 10000, consoleDescriptors: 100000, documentDescriptors: 100000, pluginSkills: 200, pluginActions: 200 },
  contextFree: { warmP95Ms: percentile(simple), sourceDiscoveries: 0, contentFetches: 0, auxiliarySources: 0 }, lexical: { warmP95Ms: percentile(retrieval), identifierRecallAt5: recall.filter(Boolean).length / recall.length },
  descriptorResidentBytes: Math.max(0, descriptorResident - initialResident), queryAdditionalResidentBytes: Math.max(0, process.memoryUsage().rss - descriptorResident),
  additionalResidentBytes: Math.max(0, process.memoryUsage().rss - initialResident), modelTaskQuality: 'not measured', monetaryCost: 'no billable operations issued' }
// Exercise the actual incremental console adapter separately from the generic
// descriptor corpus. Existing session events are immutable, with append/clear.
const consoleIndex = new ConsoleIndex()
let events = Array.from({ length: 100000 }, (_, index) => ({ id: `event-${index}`, type: index % 4 === 0 ? 'input' : index % 4 === 3 ? 'error' : 'output', text: index % 4 === 0 ? `inspect(object_${index})` : `synthetic console event ${index}`, timestamp: index }))
const coldStart = performance.now()
const initialConsole = consoleIndex.update(events, 'workspace:1')
const coldMs = performance.now() - coldStart, warm = [], appended = []
for (let iteration = 0; iteration < 50; iteration++) {
  const start = performance.now()
  assert.equal(consoleIndex.update(events, 'workspace:1'), initialConsole)
  warm.push(performance.now() - start)
}
let current = initialConsole
for (let iteration = 0; iteration < 20; iteration++) {
  events = [...events, { id: `new-event-${iteration}`, type: 'error', text: `new exact failure ${iteration}`, timestamp: 100000 + iteration }]
  const start = performance.now(), next = consoleIndex.update(events, 'workspace:1')
  appended.push(performance.now() - start)
  assert.notEqual(next[0].revision, current[0].revision)
  assert.equal(next[1], current[1])
  current = next
}
assert.equal(consoleIndex.update([], 'workspace:1').length, 0)
report.consoleIndex = { events: 100000, executions: initialConsole.length, coldMs, unchangedP95Ms: percentile(warm), appendP95Ms: percentile(appended), clearRemovesDescriptors: true, contentBodiesFetched: 0 }
await writeFile('/tmp/ourgeo-context-benchmark.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
