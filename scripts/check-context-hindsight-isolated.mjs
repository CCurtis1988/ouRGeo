import { build } from 'esbuild'
import { access, mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

// Actual upstream API and PostgreSQL, isolated synthetic records only.
// Install private dependencies separately from the documented immutable pin.
// No LLM, paid calls, ambient credentials, user databases or semantic claims.
const root = resolve(import.meta.dirname, '..'), cache = join(root, '.cache/stage34/hindsight')
await mkdir(cache, { recursive: true })
const directory = await mkdtemp(join(cache, 'fixture-'))
const option = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined }
const python = resolve(option('--python') ?? join(cache, 'venv/bin/python'))
await access(python)
const tracer = process.env.OURGEO_CONTEXT_STRACE_PATH
if (tracer) { assert(tracer.startsWith('/')); await access(tracer) }
const bundle = join(directory, 'adapter.mjs')
await build({ stdin: { contents: 'export { createHindsightProvider } from "./electron/main/context/providers/hindsight"; export { createJsonTransport } from "./electron/main/context/providers/transport"; export { runProviderConformance } from "./src/lib/context/providers/conformance";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: bundle })
const { createHindsightProvider, createJsonTransport, runProviderConformance } = await import(pathToFileURL(bundle).href)
const socket = createServer(); await new Promise(done => socket.listen(0, '127.0.0.1', done))
const port = socket.address().port; await new Promise(done => socket.close(done))
const endpoint = `http://127.0.0.1:${port}`
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'LANG', 'LC_ALL', 'TMPDIR'].includes(key)))
const traces = [], children = []
function child(executable, args, traceName) {
  const trace = join(directory, `${traceName}.network.trace`)
  if (tracer) traces.push(trace)
  const subprocess = spawn(tracer ?? executable, tracer ? ['-f', '-qq', '--kill-on-exit', '-e', 'trace=%network', '-o', trace, executable, ...args] : args, { cwd: directory, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''; subprocess.stdout.on('data', data => { output += data }); subprocess.stderr.on('data', data => { output += data })
  const exited = once(subprocess, 'close'); children.push({ process: subprocess, exited, output: () => output })
  return children.at(-1)
}
async function start(label) {
  const server = child(python, [join(root, 'scripts/fixtures/context-hindsight-server.py'), '--state', directory, '--port', String(port)], label)
  const deadline = Date.now() + 60000
  while (true) {
    if (server.process.exitCode !== null) throw new Error(`Fixture startup failed: ${server.output().slice(-3000)}`)
    try { const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(500) }); if (response.ok && ['healthy', 'ok'].includes((await response.json()).status)) return server } catch { /* Await private migrations. */ }
    if (Date.now() > deadline) throw new Error('Private Hindsight startup timed out; inspect the preserved fixture log.')
    await new Promise(done => setTimeout(done, 100))
  }
}
async function stop(server, label) {
  if (server.process.exitCode === null) {
    try { const { pid } = JSON.parse(await readFile(join(directory, 'fixture-processing.json'), 'utf8')); process.kill(pid, 'SIGTERM') } catch { process.kill(-server.process.pid, 'SIGTERM') }
    const timer = setTimeout(() => { try { process.kill(-server.process.pid, 'SIGKILL') } catch { /* Already exited. */ } }, 10000)
    await server.exited; clearTimeout(timer)
  }
  await writeFile(join(directory, `${label}.log`), server.output())
}
const ids = new Set(), statements = new Set(), namespaces = { first: `ourgeo_fixture_${crypto.randomUUID().replaceAll('-', '')}`, second: `ourgeo_fixture_${crypto.randomUUID().replaceAll('-', '')}` }
const diagnostics = []
let server, report, deletionAudit, restartVerified = false, observation
try {
  server = await start('initial')
  const processing = JSON.parse(await readFile(join(directory, 'fixture-processing.json'), 'utf8'))
  assert.equal(processing.llm, 'none'); assert.equal(processing.paidProcessing, false)
  const transport = createJsonTransport({ endpoint, local: true })
  const provider = createHindsightProvider('synthetic-hindsight-fixture', async (...args) => {
    const value = await transport(...args)
    if (args[0].includes('/operations')) diagnostics.push({ path: args[0], response: value })
    return value
  }, 'verified-local-chunks')
  const dispatch = provider.dispatch
  provider.dispatch = async (operation, host) => { if (operation.operation === 'upsert') for (const record of operation.records) { ids.add(record.id); statements.add(record.statement) } const result = await dispatch(operation, host); if (result.status === 'failed') diagnostics.push({ operation: operation.operation, failure: result.code }); return result }
  const host = (name, operationId = crypto.randomUUID()) => ({ namespace: namespaces[name], signal: new AbortController().signal, timeoutMs: 15000, maxTokens: 2000, maxResults: 5, policyRevision: 1, idempotencyKey: operationId, paidProcessingAllowed: false, authorised: () => true })
  const scope = name => ({ isolatedFixture: true, provider, commitCanonical: async () => undefined, host: operationId => host(name, operationId) })
  report = await runProviderConformance({ writesAcknowledged: true, scopes: { first: scope('first'), second: scope('second') } })
  await writeFile(join(directory, 'records.json'), JSON.stringify({ ids: [...ids], statements: [...statements], namespaces: Object.values(namespaces) }))
  const auditor = child(python, [join(root, 'scripts/fixtures/context-hindsight-audit.py'), '--state', directory, '--records', join(directory, 'records.json')], 'audit')
  await auditor.exited; await writeFile(join(directory, 'audit.log'), auditor.output())
  assert.equal(auditor.process.exitCode, 0, auditor.output().slice(-2000))
  deletionAudit = JSON.parse(auditor.output().trim())
  await stop(server, 'initial'); server = await start('restart')
  for (const id of ids) for (const name of ['first', 'second']) {
    const result = await provider.dispatch({ operation: 'read', id }, host(name))
    assert.equal(result.status, 'ok'); assert.deepEqual(result.evidence, [])
  }
  restartVerified = true
  await stop(server, 'restart'); server = undefined
  if (tracer) {
    const control = child(python, ['-c', 'import socket; socket.socket().close()'], 'positive-control'); await control.exited
    const controlTrace = await readFile(traces.at(-1), 'utf8'); assert(/socket\(/.test(controlTrace), 'Network observer positive control failed.')
    const lines = (await Promise.all(traces.slice(0, -1).map(path => readFile(path, 'utf8')))).flatMap(text => text.split('\n'))
    const destinations = lines.filter(line => /\bconnect\(/.test(line) && /AF_INET6?/.test(line))
    const external = destinations.filter(line => !/127\.0\.0\.1|::1/.test(line))
    observation = { positiveControl: true, tracedProcesses: traces.length - 1, internetConnectAttempts: destinations.length, externalConnectAttempts: external.length, externalAttempts: external.slice(0, 20), boundary: 'Cold start, synthetic conformance, derivative audit and restart; IPv4/IPv6 connect destinations; loopback PostgreSQL/API/embedder allowed. Observation is not an OS firewall.' }
    assert.equal(external.length, 0, 'The private fixture attempted external processing; preserve its trace.')
  }
  assert(!report.checks.some(check => check.status === 'failed'), 'Real Hindsight conformance failed; preserve the report before activation.')
  assert.equal(deletionAudit.contentRowsRemaining, 0, 'Copied operation or memory rows remain after forgetting.')
  assert.equal(deletionAudit.plaintextDeletionPassed, true, 'PostgreSQL files still contain forgotten plaintext; personal-memory qualification remains blocked.')
} finally {
  if (server) await stop(server, 'failed-server')
  for (const item of children) if (item.process.exitCode === null) { try { process.kill(-item.process.pid, 'SIGTERM') } catch { /* Owned process already exited. */ } }
  const evidence = { version: 1, measuredAt: new Date().toISOString(), directory, upstreamCommit: '5fc4ce20917b916240cef27c212c387a177f115b', serverFixtureSha256: createHash('sha256').update(await readFile(join(root, 'scripts/fixtures/context-hindsight-server.py'))).digest('hex'), runtime: 'Upstream 0.10.2; private PostgreSQL; synthetic TEI vectors; LLM disabled; RRF reranker', report, deletionAudit, restartVerified, networkObservation: observation, qualification: 'Synthetic API/recovery evidence only; physical residuals and synthetic embeddings do not qualify personal memory or semantic retrieval.' }
  await writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence))
  await writeFile(join(directory, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2))
}
