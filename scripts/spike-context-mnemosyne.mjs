import { build } from 'esbuild'
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Downloads are explicit and separate. This command never installs in a real
// ouRGeo profile, invokes system Python, or contacts a package/model service.
const root = resolve(import.meta.dirname, '..')
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This packaging spike currently certifies no platform; its fixture is Linux x86_64 only.')
const cache = join(root, '.cache', 'context-runtime')
await mkdir(cache, { recursive: true, mode: 0o700 })
const bundle = join(cache, 'spike-runtime.mjs')
await build({ stdin: { contents: 'export * from "./electron/main/context/runtime-archive"; export * from "./electron/main/context/runtime-catalogue"; export * from "./electron/main/context/runtimes"; export * from "./electron/main/context/providers/managed-mnemosyne";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: bundle })
const { MNEMOSYNE_LOCAL_CANDIDATE: candidate, unpackRuntimeArchive, MemoryRuntime, mnemosyneEnvironment, createManagedMnemosyne } = await import(pathToFileURL(bundle).href)
const directory = await mkdtemp(join(tmpdir(), 'ourgeo-mnemosyne-spike-'))
// Optional OS observation runs only against the freshly unpacked private
// runtime and synthetic records. A positive control prevents an empty/broken
// trace from masquerading as offline evidence. This is not an OS sandbox.
const tracer = process.env.OURGEO_CONTEXT_STRACE_PATH
if (tracer && (!tracer.startsWith('/') || !(await stat(tracer)).isFile())) throw new Error('Use an absolute path to the verified strace executable.')
const traces = []
function launch(executable, arguments_, environment, traceName) {
  const trace = join(directory, `${traceName}.network.trace`)
  if (tracer) traces.push(trace)
  return spawn(tracer ?? executable, tracer ? ['-f', '-qq', '--kill-on-exit', '-e', 'trace=%network', '-o', trace, executable, ...arguments_] : arguments_,
    { cwd: directory, env: environment, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
}
function networkCalls(trace) {
  return trace.split('\n').filter(line => /\b[a-z][a-z0-9_]*\(/.test(line))
}
const python = await unpackRuntimeArchive('/tmp/ourgeo-mnemosyne-python.tar.gz', directory, candidate.python.profiles['linux-x64'])
const source = await unpackRuntimeArchive('/tmp/ourgeo-mnemosyne-source.tar.gz', directory, candidate.provider.archive)
const yaml = await unpackRuntimeArchive('/tmp/ourgeo-mnemosyne-pyyaml.tar.gz', directory, candidate.yaml.archive)
const data = join(directory, 'synthetic-data')
await mkdir(data, { mode: 0o700 })
const executable = join(python, 'python', 'bin', 'python3.12')
const env = { LANG: 'C.UTF-8', MNEMOSYNE_HOME: data, MNEMOSYNE_DATA_DIR: data,
  MNEMOSYNE_NO_EMBEDDINGS: '1', MNEMOSYNE_FORCE_LOCAL: '1', MNEMOSYNE_LLM_ENABLED: '0', MNEMOSYNE_HOST_LLM_ENABLED: '0',
  MNEMOSYNE_LLM_CONFLICT_DETECTION: '0', MNEMOSYNE_AUTO_SLEEP_ENABLED: '0', MNEMOSYNE_PROACTIVE_LINKING: '0', MNEMOSYNE_ENHANCED_RECALL: '0', MNEMOSYNE_POLYPHONIC_RECALL: '0',
  MNEMOSYNE_MODALITY_ENABLED: '0', MNEMOSYNE_SYNC_REMOTE: '', MNEMOSYNE_CROSS_SESSION: '0',
}
const args = ['-I', '-S', join(root, 'tests', 'fixtures', 'context', 'mnemosyne-local.py'), join(source, candidate.provider.archive.root), join(yaml, candidate.yaml.archive.root, 'lib'), data]
const start = performance.now()
const result = await new Promise((resolve, reject) => {
  const child = launch(executable, args, env, 'health')
  child.stdin.end()
  let output = '', errors = ''
  const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Runtime health check timed out.')) }, 30000)
  child.on('error', error => { clearTimeout(timer); reject(error) })
  child.stdout.on('data', chunk => { output += chunk; if (output.length > 100000) child.kill('SIGKILL') })
  child.stderr.on('data', chunk => { errors += chunk; if (errors.length > 100000) child.kill('SIGKILL') })
  child.on('close', code => { clearTimeout(timer); if (code !== 0) reject(new Error(`Runtime fixture failed (${code}): ${errors.slice(-4000)}`)); else resolve(JSON.parse(output.trim())) })
})
const bridgeData = join(directory, 'bridge-data')
await mkdir(bridgeData, { mode: 0o700 })
let launches = 0
const runtime = new MemoryRuntime({ executable, arguments: ['-I', '-S', join(root, 'electron/main/context/mnemosyne-sidecar.py'), join(source, candidate.provider.archive.root), join(yaml, candidate.yaml.archive.root, 'lib'), bridgeData], directory, environment: mnemosyneEnvironment(bridgeData), profile: candidate.id },
  configuration => launch(configuration.executable, configuration.arguments, configuration.environment, `bridge-${++launches}`))
const namespace = randomUUID(), unrelated = randomUUID(), canonicalId = randomUUID(), removedId = randomUUID()
const host = { namespace, signal: new AbortController().signal, authorised: () => true, timeoutMs: 30000, policyRevision: 1, maxTokens: 2000, maxResults: 5, idempotencyKey: randomUUID(), paidProcessingAllowed: false }
const entries = [canonicalId, removedId].map(id => ({ id, revision: 1, text: 'SYNTHETIC_BRIDGE_DECISION: use EPSG:27700 for parcel buffers.', updatedAt: '2026-10-07T00:00:00Z' }))
let supervised
try {
  await runtime.request({ operation: 'replace', namespace, generation: 1, records: entries }, host)
  const adapter = createManagedMnemosyne(candidate.id, runtime)
  const found = await adapter.dispatch({ operation: 'search', query: 'EPSG:27700' }, host)
  assert.equal(found.status, 'ok')
  assert.deepEqual(new Set(found.evidence.map(item => item.canonicalId)), new Set([canonicalId, removedId]))
  const isolated = await adapter.dispatch({ operation: 'search', query: 'EPSG:27700' }, { ...host, namespace: unrelated })
  assert.deepEqual(isolated.evidence, [])
  const repeated = await runtime.request({ operation: 'replace', namespace, generation: 1, records: entries }, host)
  assert.equal(repeated.idempotent, true)
  const revised = [{ ...entries[0], revision: 2, text: 'SYNTHETIC_BRIDGE_CORRECTION: use EPSG:3857 for display only.' }]
  await assert.rejects(runtime.request({ operation: 'replace', namespace, generation: 1, records: revised }, host), /INVALID_REQUEST/)
  await runtime.request({ operation: 'replace', namespace, generation: 2, records: revised }, host)
  assert.deepEqual((await adapter.dispatch({ operation: 'read', id: removedId }, host)).evidence, [])
  await runtime.stop()
  const afterRestart = await adapter.dispatch({ operation: 'read', id: canonicalId }, host)
  assert.equal(afterRestart.evidence[0].revision, 2)
  // Force an interrupted rebuild and verify the committed generation survives.
  const abort = new AbortController()
  const rebuilding = runtime.request({ operation: 'replace', namespace, generation: 3, records: Array.from({ length: 1000 }, (_, index) => ({ ...entries[0], id: randomUUID(), text: `SYNTHETIC_INTERRUPTED_ROW_${index}` })) }, { ...host, signal: abort.signal })
  const rejected = assert.rejects(rebuilding, /cancelled/)
  const deadline = Date.now() + 5000
  while (!(await readdir(bridgeData)).some(name => name.startsWith('.rebuild-'))) {
    if (Date.now() > deadline) throw new Error('Interrupted rebuild fixture did not start.')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  abort.abort()
  await rejected
  const preserved = await adapter.dispatch({ operation: 'read', id: canonicalId }, host)
  assert.equal(preserved.evidence[0].revision, 2)
  assert.equal((await readdir(bridgeData)).some(name => name.startsWith('.rebuild-')), false)
  await runtime.request({ operation: 'replace', namespace, generation: 3, records: [] }, host)
  assert.deepEqual((await adapter.dispatch({ operation: 'read', id: canonicalId }, host)).evidence, [])
  // Exercise the provider contract through a host-owned canonical snapshot;
  // direct bridge replacement alone does not certify adapter write receipts.
  let generation = 4
  const makeRecord = id => ({ id, revision: 1, scope: 'global', projectId: null, category: 'preference', statement: `SYNTHETIC_CANONICAL_METRIC_PREFERENCE ${id}`, evidence: [], assertion: 'user-declared', createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z', status: 'active', supersedes: [] })
  let records = [makeRecord(canonicalId), makeRecord(removedId)]
  const provider = createManagedMnemosyne(candidate.id, runtime, { snapshot: async requested => { assert.equal(requested, namespace); return { namespace, generation, records } }, current: async snapshot => snapshot.namespace === namespace && snapshot.generation === generation })
  const saved = await provider.dispatch({ operation: 'upsert', records: [records[0]] }, host)
  assert.equal(saved.status, 'ok'); assert.deepEqual(saved.records, [records[0]])
  assert.equal((await provider.dispatch({ operation: 'upsert', records: [records[0]] }, host)).status, 'ok')
  records = [{ ...records[0], revision: 2, statement: 'SYNTHETIC_CANONICAL_CORRECTION: use metres.' }, records[1]]; generation++
  assert.equal((await provider.dispatch({ operation: 'upsert', records: [records[0]] }, host)).status, 'ok')
  await runtime.stop()
  assert.equal((await provider.dispatch({ operation: 'read', id: canonicalId }, host)).evidence[0].revision, 2)
  records = records.slice(1); generation++
  assert.equal((await provider.dispatch({ operation: 'delete', ids: [canonicalId] }, host)).status, 'ok')
  assert.deepEqual((await provider.dispatch({ operation: 'read', id: canonicalId }, host)).evidence, [])
  assert.equal((await provider.dispatch({ operation: 'read', id: removedId }, host)).evidence[0].canonicalId, removedId)
  supervised = { stdio: true, scopeIsolation: true, snapshotRetries: true, correction: true, restart: true, interruptedRebuild: true, deletionRebuild: true, canonicalAdapterWrites: true, canonicalAdapterDeletion: true, unrelatedMemoryPreserved: true }
} finally { await runtime.stop() }
let networkObservation
if (tracer) {
  const observed = []
  for (const trace of traces) observed.push(...networkCalls(await readFile(trace, 'utf8')))
  assert.deepEqual(observed, [], 'The local-only runtime attempted a network syscall.')
  const control = launch(executable, ['-I', '-S', '-c', 'import socket; s = socket.socket(socket.AF_INET, socket.SOCK_STREAM); s.close()'], { LANG: 'C.UTF-8' }, 'positive-control')
  control.stdin.end()
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { control.kill('SIGKILL'); reject(new Error('Network observation positive control timed out.')) }, 5000)
    control.once('error', error => { clearTimeout(timer); reject(error) })
    control.once('close', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error('Network observation positive control failed.')) })
  })
  const controlCalls = networkCalls(await readFile(traces.at(-1), 'utf8'))
  assert.ok(controlCalls.some(line => /socket\(AF_INET,/.test(line)), 'The OS observer missed the positive-control socket.')
  networkObservation = { mechanism: 'strace network syscalls with child tracing', positiveControl: true, runtimeLaunches: launches + 1, networkSyscalls: observed.length, traces: traces.slice(0, -1) }
}
async function bytes(path) {
  let total = 0
  for (const entry of await readdir(path, { withFileTypes: true })) total += entry.isDirectory() ? await bytes(join(path, entry.name)) : (await stat(join(path, entry.name))).size
  return total
}
const report = { profile: candidate.id, certification: 'pending', directory, healthMs: Math.round(performance.now() - start), materialisedBytes: await bytes(directory), supervised, ...(networkObservation ? { networkObservation } : {}), ...result }
await writeFile('/tmp/ourgeo-mnemosyne-spike-report.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
