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
await build({ stdin: { contents: 'export { CompactDescriptorIndex } from "./src/lib/context/descriptor-index"; export { ContextBroker } from "./src/lib/context/broker"; export { routeContext } from "./src/lib/context/router"; export { ConsoleIndex } from "./src/lib/context/sources/console-index";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: bundle })
const { ContextBroker, routeContext, ConsoleIndex, CompactDescriptorIndex } = await import(pathToFileURL(bundle).href)
global.gc?.()
const memorySnapshots = []
const memory = label => {
  const usage = process.memoryUsage(), processPeakResidentBytes = process.resourceUsage().maxRSS * 1024
  const snapshot = { label, ...usage, processPeakResidentBytes }
  memorySnapshots.push(snapshot)
  return snapshot
}
// The OS high-water mark includes this runner's startup too. Do not subtract
// corpus allocations or move them outside the measured process to pass RSS.
const initialMemory = memory('baseline-after-bundle-and-gc'), initialResident = initialMemory.rss
let fetches = 0
const read = () => { fetches++; throw new Error('The descriptor benchmark must not fetch content.') }
const sourceRepresentation = process.env.OURGEO_CONTEXT_DESCRIPTOR_INDEX === 'compact' ? 'compact' : 'objects'
function* corpus() {
for (const [kind, count] of [['environment', 10000], ['console', 100000], ['document', 100000], ['skill', 200], ['action', 200]]) {
  for (let index = 0; index < count; index++) yield { id: `${kind}:synthetic-${index}`, kind, scope: ['skill', 'action'].includes(kind) ? 'application' : 'workspace',
    title: kind === 'environment' ? `.GlobalEnv::object_${index}` : `${kind} synthetic ${index}`, summary: `${kind} source ${index}; ${index % 97 === 0 ? 'flood parcel exposure' : 'unrelated reference'}`,
    revision: 'fixture-v1', trust: kind === 'environment' ? 'observed' : 'untrusted', ...(kind === 'environment' ? { resource: { environment: '.GlobalEnv', name: `object_${index}` } } : {}), read }
}
}
const constructionStart = performance.now()
const sources = sourceRepresentation === 'compact' ? CompactDescriptorIndex.from(corpus(), { read }) : [...corpus()]
const constructionMs = performance.now() - constructionStart
const sourceCount = sourceRepresentation === 'compact' ? sources.count : sources.length
const descriptors = kinds => sourceRepresentation === 'compact' ? sources.scan(kinds) : kinds ? sources.filter(source => kinds.includes(source.kind)) : sources
memory('descriptors-before-gc')
global.gc?.()
const descriptorMemory = memory('descriptors-after-gc'), descriptorResident = descriptorMemory.rss
let discoveries = 0
const broker = () => new ContextBroker({ identity: { chatId: 'synthetic-chat', projectId: null, workspaceEpoch: 1, policyRevision: 1 }, target: 'benchmark/no-model', effort: 'balanced', signal: new AbortController().signal, current: () => true,
  sources: kinds => { discoveries++; return descriptors(kinds) }, excluded: () => [] })
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
  memory(`lexical-query-${iteration}`)
}
assert.equal(fetches, 0)
global.gc?.()
const lexicalMemory = memory('lexical-queries-after-gc')
// Broad discovery must retain only the requested page while preserving total
// coverage. It is still charged to the same process/corpus memory measurement.
const broadDiscovery = []
for (const query of ['', 'synthetic']) {
  const timings = []
  let expected = 0
  for (const source of descriptors()) if (!query || source.title.toLowerCase().includes('synthetic')) expected++
  let delivered = 0
  for (let iteration = 0; iteration < 5; iteration++) {
    const turn = broker(), seen = new Set()
    let cursor
    for (let page = 0; page < 3; page++) {
      const start = performance.now(), result = JSON.parse(turn.search({ query, cursor }))
      const elapsed = performance.now() - start
      if (iteration > 0) timings.push(elapsed)
      assert.equal(result.status, 'ok')
      assert.equal(result.results.length, 5)
      assert.equal(result.omitted, expected - (page + 1) * 5)
      assert.equal(typeof result.nextCursor, 'string')
      for (const hit of result.results) {
        assert.ok(!seen.has(hit.title), 'Pagination must not repeat a descriptor.')
        seen.add(hit.title)
      }
      cursor = result.nextCursor
    }
    assert.equal(seen.size, 15)
    delivered += seen.size
    memory(`broad-query-${query || 'empty'}-${iteration}`)
  }
  broadDiscovery.push({ query, matchingDescriptors: expected, iterations: 5, pagesPerIteration: 3, resultsPerPage: 5, returnedResults: delivered, warmP95Ms: percentile(timings), coverageAndUniquePages: true })
}
assert.equal(fetches, 0)
global.gc?.()
const queryMemory = memory('all-queries-after-gc')
const report = { fixtureVersion: 1, measuredAt: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length, systemMemoryBytes: totalmem(), descriptorCount: sourceCount, sourceRepresentation, constructionMs, ...(sourceRepresentation === 'compact' ? { conservativePackedBytes: sources.estimatedBytes } : {}),
  corpus: { objects: 10000, consoleDescriptors: 100000, documentDescriptors: 100000, pluginSkills: 200, pluginActions: 200 },
  contextFree: { warmP95Ms: percentile(simple), sourceDiscoveries: 0, contentFetches: 0, auxiliarySources: 0 }, lexical: { warmP95Ms: percentile(retrieval), identifierRecallAt5: recall.filter(Boolean).length / recall.length },
  broadDiscovery, memorySnapshots,
  descriptorResidentBytes: Math.max(0, descriptorResident - initialResident), queryAdditionalResidentBytes: Math.max(0, queryMemory.rss - descriptorResident),
  additionalResidentBytes: Math.max(0, queryMemory.rss - initialResident),
  memoryDiagnostics: { units: 'bytes; process.resourceUsage().maxRSS converted from KiB', baseline: initialMemory, descriptors: descriptorMemory, afterLexical: lexicalMemory, afterAllQueries: queryMemory,
    queryHeapUsedGrowthBytes: queryMemory.heapUsed - descriptorMemory.heapUsed, queryHeapTotalGrowthBytes: queryMemory.heapTotal - descriptorMemory.heapTotal,
    processPeakAdditionalResidentBytes: Math.max(0, queryMemory.processPeakResidentBytes - initialResident), residentTargetBytes: 150 * 1024 * 1024,
    genericCorpusResidentTargetMet: queryMemory.rss - initialResident < 150 * 1024 * 1024,
    measurement: 'Baseline precedes all 210,400 corpus descriptors. All corpus, query allocations and broad pages remain counted. OS peak includes runner startup; GC does not reset it.' }, modelTaskQuality: 'not measured', monetaryCost: 'no billable operations issued' }
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
const consoleMemory = memory('additional-console-adapter-fixture-after-clear')
report.memoryDiagnostics.combinedRunner = { ...consoleMemory, additionalResidentBytes: Math.max(0, consoleMemory.rss - initialResident), processPeakAdditionalResidentBytes: Math.max(0, consoleMemory.processPeakResidentBytes - initialResident), note: 'Includes generic descriptor corpus plus a separate extra 100,000-event console fixture concurrently; no allocation excluded.' }
report.consoleIndex = { events: 100000, executions: initialConsole.length, coldMs, unchangedP95Ms: percentile(warm), appendP95Ms: percentile(appended), clearRemovesDescriptors: true, contentBodiesFetched: 0 }
await writeFile('/tmp/ourgeo-context-benchmark.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
