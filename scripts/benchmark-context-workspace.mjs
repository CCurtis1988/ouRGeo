import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { cpus } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

// Production adapters with synthetic immutable store snapshots. GUI imports
// and network/R reads are replaced at the boundary, never the broker/index.
const root = resolve(import.meta.dirname, '..'), cache = join(root, '.cache/context-workspace-benchmark')
await mkdir(cache, { recursive: true })
const bundle = join(cache, 'workspace.mjs')
const stores = { environment: 'useEnvironmentStore', editor: 'useEditorStore', session: 'useSessionStore', ai: 'useAiStore', project: 'useProjectStore', context: 'useContextStore' }
await build({ stdin: { contents: 'export { workspaceSourceScan } from "./src/lib/context/sources/workspace"; export { ContextBroker } from "./src/lib/context/broker"; export { OURGEO_TOPICS } from "./src/lib/ai-skill-ourgeo";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: bundle, tsconfig: join(root, 'tsconfig.web.json'), plugins: [{ name: 'synthetic-store-boundary', setup(builder) {
  builder.onResolve({ filter: /^@\/store\// }, args => ({ path: args.path.split('/').at(-1), namespace: 'fixture' }))
  builder.onResolve({ filter: /document-snapshots$/ }, () => ({ path: 'snapshots', namespace: 'fixture' }))
  builder.onResolve({ filter: /^@\/lib\/(r-client|ai-actions\/registry)$/ }, args => ({ path: args.path.endsWith('r-client') ? 'r-client' : 'registry', namespace: 'fixture' }))
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
    const contents = stores[args.path] ? `export const ${stores[args.path]} = { getState: () => globalThis.__contextFixture.${args.path} };`
      : args.path === 'column-disclosure' ? 'export const hasColumnExclusions = () => false; export const columnExclusions = () => []; export const useColumnDisclosureStore = { getState: () => ({ revision: 0, loaded: true, workspaceEpoch: 1 }) };'
        : args.path === 'snapshots' ? 'export const snapshotDocument = () => { throw new Error("This fixture has no Visual editor.") };'
          : args.path === 'r-client' ? 'export const rClient = { contextSchema: () => { throw new Error("No R reads are authorised.") } };'
            : args.path === 'registry' ? 'export const actionIndex = () => "Synthetic actions"; export const actionList = () => globalThis.__contextFixture.actions;'
              : null
    if (!contents) throw new Error(`Unexpected GUI boundary: ${args.path}`)
    return { contents, loader: 'js' }
  })
} }] })
const { workspaceSourceScan, ContextBroker, OURGEO_TOPICS } = await import(pathToFileURL(bundle).href)
global.gc?.()
const snapshots = [], memory = label => { const value = { label, ...process.memoryUsage(), peakRss: process.resourceUsage().maxRSS * 1024 }; snapshots.push(value); return value }
const beforeFixtures = memory('before-synthetic-store-allocation')
const fixture = globalThis.__contextFixture = {
  environment: { environments: [{ name: '.GlobalEnv', isSearchPath: false, objects: Array.from({ length: 10000 }, (_, index) => ({ name: `object_${index}`, class: ['data.frame'], dim: [10, 2], columns: [{ name: 'id', type: 'integer' }, { name: 'value', type: 'numeric' }] })) }] },
  editor: { tabs: Array.from({ length: 100000 }, (_, index) => ({ id: `synthetic-${index}`, type: 'code', language: 'markdown', fileName: `document_${index}.md`, filePath: null, content: `# Method ${index}\n# ${index % 97 === 0 ? 'flood parcel exposure' : 'unrelated reference'}\n`, savedContent: '', isDirty: false })) },
  session: { consoleHistory: Array.from({ length: 100000 }, (_, index) => ({ id: `event-${index}`, type: index % 4 === 0 ? 'input' : index % 4 === 3 ? 'error' : 'output', text: index % 4 === 0 ? `inspect(object_${index})` : `synthetic console event ${index}`, timestamp: index })), rGeneration: 1, rPort: 0, rStatus: 'ready' },
  ai: { chats: [], activeChatId: '', terminalEnabled: false, autoPilotEnabled: false }, project: { workspaceEpoch: 1, path: null, projectId: null, phase: 'ready' },
  context: { globals: [], projectContext: { memories: [] } },
  actions: Array.from({ length: 200 }, (_, index) => ({ id: `synthetic:action${index}`, summary: 'Synthetic action', group: 'data', tier: 'always', params: [] })),
}
for (let index = 0; index < 200; index++) OURGEO_TOPICS[`synthetic-${index}`] = 'Synthetic plugin documentation.'
globalThis.window = { electronAPI: { context: {} } }
global.gc?.()
const beforeManager = memory('immutable-store-inputs-before-manager')
const broker = () => new ContextBroker({ identity: { chatId: 'synthetic', projectId: null, workspaceEpoch: 1, policyRevision: 0 }, target: 'benchmark/no-model', effort: 'balanced', signal: new AbortController().signal, current: () => true, sources: kinds => workspaceSourceScan(kinds, () => { throw new Error('No R reads are authorised.') }), excluded: () => [] })
const coldStart = performance.now()
const first = JSON.parse(broker().search({ query: 'flood parcel exposure', kinds: ['document'] }))
const coldMs = performance.now() - coldStart
assert.equal(first.results.length, 5)
memory('document-index-cold')
const timings = [], queries = ['flood parcel exposure', '', 'synthetic', '[object_9876]']
for (const query of queries) {
  const samples = []
  for (let iteration = 0; iteration < 8; iteration++) {
    const start = performance.now(), result = JSON.parse(broker().search({ query }))
    samples.push(performance.now() - start)
    assert.equal(result.status, 'ok')
    assert.equal(result.results.length, query === '[object_9876]' ? 1 : 5)
    if (query === '[object_9876]') assert(result.results.some(hit => hit.title === '.GlobalEnv::object_9876'))
    memory(`query-${query}-${iteration}`)
  }
  timings.push({ query, warmP95Ms: [...samples.slice(2)].sort((a, b) => a - b).at(-1) })
}
global.gc?.()
const after = memory('after-warm-discovery-and-gc')
const sourceHashes = Object.fromEntries(await Promise.all(['src/lib/context/sources/workspace.ts', 'src/lib/context/sources/document-index.ts', 'src/lib/context/sources/snapshot-index.ts', 'src/lib/context/descriptor-index.ts', 'src/lib/context/sources/console-index.ts', 'src/lib/context/broker.ts', 'src/lib/context/rank.ts', 'scripts/benchmark-context-workspace.mjs'].map(async path => [path, createHash('sha256').update(await readFile(join(root, path))).digest('hex')])))
const peak = Math.max(...snapshots.slice(2).map(value => value.rss))
const report = { version: 1, measuredAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, node: process.version, cpu: cpus()[0]?.model, corpus: { objects: 10000, consoleEvents: 100000, consoleExecutions: 25000, documents: fixture.editor.tabs.length, plugins: 200, actions: 200 }, sourceHashes, coldDocumentMs: coldMs, timings, snapshots,
  managerAdditionalResidentBytes: after.rss - beforeManager.rss, managerPeakAdditionalResidentBytes: peak - beforeManager.rss,
  totalFixtureAndManagerResidentBytes: after.rss - beforeFixtures.rss,
  methodology: 'Actual default workspace/document/console adapters and broker. All manager construction and query allocations counted from immutable input snapshots. Input-store allocations and combined total also reported separately; no R/model/read dispatch. Node synthetic adapter evidence, not native UI/platform or task-quality certification.' }
await writeFile('/tmp/ourgeo-context-workspace-benchmark.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
