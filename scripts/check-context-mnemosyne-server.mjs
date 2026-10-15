import { build } from 'esbuild'
import { access, mkdtemp, mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir, cpus, totalmem } from 'node:os'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'

// This certifies a named owned loopback bridge; it never certifies arbitrary
// upstream MCP endpoints from a probe. All inputs and profiles are synthetic.
const root = resolve(import.meta.dirname, '..'), cache = join(root, '.cache/stage34/mnemosyne-server')
await mkdir(cache, { recursive: true })
const tracer = process.env.OURGEO_CONTEXT_STRACE_PATH
if (tracer && !process.argv.includes('--observed')) {
  await access(tracer)
  const directory = await mkdtemp(join(cache, 'audit-')), trace = join(directory, 'whole-process.network.trace')
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'LANG', 'LC_ALL', 'TMPDIR'].includes(key)))
  async function run(args, file) {
    const child = spawn(tracer, ['-f', '-qq', '--kill-on-exit', '-e', 'trace=%network', '-o', file, process.execPath, ...args], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', errors = ''; child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { errors += data })
    const [exitCode] = await once(child, 'close'); await writeFile(`${file}.log`, output + errors)
    assert.equal(exitCode, 0, errors.slice(-3000)); return output
  }
  const report = JSON.parse((await run([import.meta.filename, '--observed'], trace)).trim())
  const controlFile = join(directory, 'positive-control.network.trace')
  await run(['-e', "require('node:net').createServer().listen(0,'127.0.0.1',function(){this.close()})"], controlFile)
  const control = await readFile(controlFile, 'utf8'); assert(/socket\(/.test(control) && /bind\(/.test(control))
  const text = await readFile(trace, 'utf8'), connections = text.split('\n').filter(line => /\bconnect\(/.test(line) && /AF_INET6?/.test(line))
  const external = connections.filter(line => !/127\.0\.0\.1|::1/.test(line))
  assert.equal(external.length, 0, 'Owned loopback bridge attempted an external connection.')
  report.networkObservation = { positiveControl: true, scope: 'Whole Node fixture, listener, HTTP client and pinned Python descendants from startup through shutdown', loopbackConnectAttempts: connections.length, externalConnectAttempts: external.length, trace, observationOnly: true }
  await writeFile(join(directory, 'evidence.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); process.exit(0)
}
const directory = await mkdtemp(join(tmpdir(), 'ourgeo-mnemosyne-server-')), bundle = join(directory, 'profile.mjs')
await build({ stdin: { contents: 'export * from "./electron/main/context/runtime-archive"; export * from "./electron/main/context/runtime-catalogue"; export * from "./electron/main/context/runtimes"; export * from "./electron/main/context/providers/local-server"; export * from "./electron/main/context/providers/local-server-mnemosyne"; export * from "./electron/main/context/providers/managed-mnemosyne"; export * from "./electron/main/context/providers/transport"; export { MemoryStorage } from "./electron/main/context/storage"; export { runProviderConformance } from "./src/lib/context/providers/conformance";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: bundle })
const { unpackRuntimeArchive, MNEMOSYNE_LOCAL_CANDIDATE: candidate, MemoryRuntime, mnemosyneEnvironment, MnemosyneLocalServer, createManagedMnemosyne, createLocalServerMnemosyne, createJsonTransport, runProviderConformance, MemoryStorage } = await import(pathToFileURL(bundle).href)
const python = await unpackRuntimeArchive('/tmp/ourgeo-mnemosyne-python.tar.gz', directory, candidate.python.profiles['linux-x64'])
const source = await unpackRuntimeArchive('/tmp/ourgeo-mnemosyne-source.tar.gz', directory, candidate.provider.archive)
const yaml = await unpackRuntimeArchive('/tmp/ourgeo-mnemosyne-pyyaml.tar.gz', directory, candidate.yaml.archive)
const data = join(directory, 'derived'); await mkdir(data, { mode: 0o700 })
const runtime = new MemoryRuntime({ executable: join(python, 'python/bin/python3'), arguments: ['-I', '-S', join(root, 'electron/main/context/mnemosyne-sidecar.py'), join(source, candidate.provider.archive.root), join(yaml, candidate.yaml.archive.root, 'lib'), data], directory, environment: mnemosyneEnvironment(data), profile: candidate.id })
const server = new MnemosyneLocalServer(runtime), records = new Map(), ids = new Set(), registrations = {}
let conformance, recoveryVerified = false, derivativeAudit, authentication, comparison
try {
  for (const name of ['first', 'second']) {
    const id = crypto.randomUUID(), namespace = crypto.randomUUID(), registration = await server.register(id, namespace, 'global')
    registrations[name] = { id, namespace, ...registration }
    records.set(namespace, { generation: 1, records: [] })
  }
  const scopes = Object.fromEntries(Object.entries(registrations).map(([name, registration]) => {
    const canonical = { snapshot: async namespace => ({ namespace, ...records.get(namespace) }), current: async snapshot => records.get(snapshot.namespace).generation === snapshot.generation }
    return [name, { isolatedFixture: true, provider: createLocalServerMnemosyne(registration.id, createJsonTransport({ endpoint: registration.endpoint, local: true, token: registration.token }), canonical),
      host: operationId => ({ namespace: registration.namespace, signal: new AbortController().signal, timeoutMs: 15000, maxTokens: 2000, maxResults: 5, policyRevision: 1, idempotencyKey: operationId, paidProcessingAllowed: false, authorised: () => true }),
      commitCanonical: async next => { for (const record of next) ids.add(record.id); records.set(registration.namespace, { generation: records.get(registration.namespace).generation + 1, records: structuredClone(next) }) } }]
  }))
  const { first, second } = registrations
  const rpc = (registration, namespace, token = registration.token) => fetch(`${registration.endpoint}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ operation: 'probe', namespace }) })
  assert.equal((await rpc(first, first.namespace, 'wrong-secret')).status, 403)
  assert.equal((await rpc(first, second.namespace)).status, 403)
  authentication = { invalidTokenRefused: true, crossNamespaceRefused: true, credentialsReported: false }
  conformance = await runProviderConformance({ writesAcknowledged: true, scopes })
  assert(!conformance.checks.some(check => check.status === 'failed'), 'Actual local-server conformance failed.')
  const corpus = Array.from({ length: 512 }, (_, index) => ({ id: crypto.randomUUID(), revision: 1, scope: 'global', projectId: null, category: 'preference', statement: `Synthetic corpus benchmark_token_${String(index).padStart(4, '0')}: use metric units.`, assertion: 'user-declared', evidence: [], status: 'active', supersedes: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }))
  for (const record of corpus) ids.add(record.id)
  records.set(first.namespace, { generation: records.get(first.namespace).generation + 1, records: corpus })
  const copied = await scopes.first.provider.dispatch({ operation: 'upsert', records: [corpus[0]] }, scopes.first.host(crypto.randomUUID()))
  assert.equal(copied.status, 'ok')
  const store = new MemoryStorage(':memory:', randomBytes(32))
  for (const record of corpus) store.save(record)
  const direct = createManagedMnemosyne(candidate.id, runtime)
  const p = (values, percentile) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * percentile) - 1]
  const measurements = []
  try {
    const variants = [
      ['built-in', async query => store.search(query).map(record => record.id)],
      ['managed lexical', async query => { const value = await direct.dispatch({ operation: 'search', query }, scopes.first.host(crypto.randomUUID())); assert.equal(value.status, 'ok'); return value.evidence.map(record => record.canonicalId) }],
      ['authenticated local server', async query => { const value = await scopes.first.provider.dispatch({ operation: 'search', query }, scopes.first.host(crypto.randomUUID())); assert.equal(value.status, 'ok'); return value.evidence.map(record => record.canonicalId) }],
    ]
    for (const [label, search] of variants) {
      const times = []; let correct = 0
      for (let index = 0; index < 25; index++) {
        const query = `benchmark_token_${String(index).padStart(4, '0')}`, start = performance.now(), found = await search(query)
        times.push(performance.now() - start)
        if (found.includes(corpus[index].id)) correct++
      }
      assert.equal(correct, 25)
      measurements.push({ label, correct, queries: 25, medianMs: p(times, 0.5), p95Ms: p(times, 0.95) })
    }
  } finally { store.close() }
  comparison = { corpusRecords: corpus.length, measurements, nodePeakResidentBytes: process.resourceUsage().maxRSS * 1024, hardware: { cpu: cpus()[0]?.model, memoryBytes: totalmem() }, boundary: 'Synthetic exact lexical token lookup; sequential warmed process including fixture startup and compilation. Not semantic quality, complete desktop RSS, human usability or model inference.', decision: 'Keep built-in as default. No demonstrated semantic/reflection benefit in this lexical comparison; enable neither without an appropriate model-quality benchmark.' }
  records.set(first.namespace, { generation: records.get(first.namespace).generation + 1, records: [] })
  assert.equal((await scopes.first.provider.dispatch({ operation: 'delete', ids: [corpus[0].id] }, scopes.first.host(crypto.randomUUID()))).status, 'ok')
  await runtime.stop()
  for (const id of ids) for (const name of ['first', 'second']) {
    const result = await scopes[name].provider.dispatch({ operation: 'read', id }, scopes[name].host(crypto.randomUUID()))
    assert.equal(result.status, 'ok'); assert.deepEqual(result.evidence, [])
  }
  recoveryVerified = true
  server.revoke(first.id)
  assert.equal((await rpc(first, first.namespace)).status, 403)
  assert.equal((await rpc(second, second.namespace)).status, 200)
  authentication.scopeRevocationPreservesOtherScope = true
  await server.close(); await runtime.stop()
  const files = await readdir(data, { recursive: true }), residual = []
  for (const name of files) { const path = join(data, name); if ((await stat(path)).isFile()) { const body = await readFile(path); if ([...ids].some(id => body.includes(Buffer.from(id)))) residual.push(name) } }
  derivativeAudit = { removedSourceIds: ids.size, residualIds: residual.length, temporaryCopies: files.filter(name => name.startsWith('.rebuild-') || /(?:-wal|-shm|-journal)$/.test(name)).length, inspectedFiles: files.length }
  assert.equal(derivativeAudit.residualIds, 0); assert.equal(derivativeAudit.temporaryCopies, 0)
} finally { await server.close(); await runtime.stop() }
const sourceHashes = {}
for (const path of ['electron/main/context/providers/local-server.ts', 'electron/main/context/providers/local-server-mnemosyne.ts', 'electron/main/context/mnemosyne-sidecar.py']) sourceHashes[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex')
const evidence = { version: 1, profile: 'mnemosyne-local-server-v1', observedAt: new Date().toISOString(), directory, upstreamCommit: candidate.provider.commit, bridgeSha256: sourceHashes['electron/main/context/mnemosyne-sidecar.py'], sourceHashes, conformance, authentication, recoveryVerified, derivativeAudit, comparison, qualification: 'Named owned experimental Linux x64 loopback lexical profile; arbitrary external MCP endpoints, semantic retrieval and other platforms are not qualified.' }
await writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence))
