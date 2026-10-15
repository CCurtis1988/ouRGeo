import { build } from 'esbuild'
import { access, mkdir, mkdtemp, writeFile, readFile, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { createHash, createHmac } from 'node:crypto'
import assert from 'node:assert/strict'

// Actual upstream API and PostgreSQL, isolated synthetic records only.
// Install private dependencies separately from the documented immutable pin.
// No LLM, paid calls, ambient credentials, user databases or semantic claims.
const root = resolve(import.meta.dirname, '..'), cache = join(root, '.cache/stage34/hindsight')
const maintain = process.argv.includes('--retention-maintenance')
const gateway = process.argv.includes('--gateway')
const qualificationSources = ['scripts/check-context-hindsight-isolated.mjs', 'scripts/fixtures/context-hindsight-audit.py', 'scripts/fixtures/stop-hindsight-fixture.py', 'electron/main/context/providers/hindsight.ts', 'electron/main/context/providers/transport.ts', 'electron/main/context/providers/shared.ts', 'src/lib/context/providers/conformance.ts', 'electron/main/context/hindsight-local-server.py', 'electron/main/context/hindsight-gateway.py', 'electron/main/context/hindsight-retention.py']
const hashSources = async () => Object.fromEntries(await Promise.all(qualificationSources.map(async name => [name, createHash('sha256').update(await readFile(join(root, name))).digest('hex')])))
const qualificationSourceHashes = await hashSources()
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
if (gateway) await unlink(bundle)
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
  const server = child(python, [...(gateway ? ['-I', '-B'] : []), join(root, gateway ? 'electron/main/context/hindsight-local-server.py' : 'scripts/fixtures/context-hindsight-server.py'), '--state', directory, '--port', String(port), ...(gateway ? ['--postgres', option('--postgres') ?? join(homedir(), '.pg0/installation/18.1.0/bin/postgres')] : [])], label)
  const deadline = Date.now() + 60000
  while (true) {
    if (server.process.exitCode !== null) throw new Error(`Fixture startup failed: ${server.output().slice(-3000)}`)
    try { const token = gateway ? await bankToken('00000000-0000-4000-8000-000000000001') : undefined; const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(500), headers: token ? { Authorization: `Bearer ${token}` } : {} }); if (response.ok && ['healthy', 'ok'].includes((await response.json()).status)) return server } catch { /* Await private migrations. */ }
    if (Date.now() > deadline) throw new Error('Private Hindsight startup timed out; inspect the preserved fixture log.')
    await new Promise(done => setTimeout(done, 100))
  }
}
async function stop(server, label) {
  if (server.process.exitCode === null) {
    try { const { pid } = JSON.parse(await readFile(join(directory, gateway ? 'server.json' : 'fixture-processing.json'), 'utf8')); process.kill(pid, 'SIGTERM') } catch { process.kill(-server.process.pid, 'SIGTERM') }
    const timer = setTimeout(() => { try { process.kill(-server.process.pid, 'SIGKILL') } catch { /* Already exited. */ } }, 10000)
    await server.exited; clearTimeout(timer)
  }
  await writeFile(join(directory, `${label}.log`), server.output())
}
const namespace = () => gateway ? crypto.randomUUID() : `ourgeo_fixture_${crypto.randomUUID().replaceAll('-', '')}`
async function bankToken(bank) { return `${bank}.${createHmac('sha256', await readFile(join(directory, 'server-secret'))).update(bank).digest('hex')}` }
const ids = new Set(), statements = new Set(), namespaces = { first: namespace(), second: namespace() }
const diagnostics = []
const resources = { peakPythonRssBytes: 0, peakPostgresRssBytes: 0 }
let sampling
const resourceTimer = gateway && setInterval(() => {
  if (sampling) return
  sampling = (async () => {
    try {
      const metadata = JSON.parse(await readFile(join(directory, 'server.json'), 'utf8'))
      const databasePid = Number((await readFile(join(directory, 'postgres-data/postmaster.pid'), 'utf8')).split('\n')[0])
      for (const [key, pid] of [['peakPythonRssBytes', metadata.pid], ['peakPostgresRssBytes', databasePid]]) {
        const status = await readFile(`/proc/${pid}/status`, 'utf8')
        const rss = Number(status.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1]) * 1024
        if (Number.isFinite(rss)) resources[key] = Math.max(resources[key], rss)
      }
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
  })().catch(error => { diagnostics.push({ resourceSampling: String(error) }) }).finally(() => { sampling = undefined })
}, 20)
if (resourceTimer) resourceTimer.unref()
async function cleanupOrphanDatabase() {
  try {
    await access(join(directory, 'postgres-data/postmaster.pid'))
    const cleanup = child(python, [join(root, 'scripts/fixtures/stop-hindsight-fixture.py'), directory], 'orphan-database-cleanup')
    await cleanup.exited
    assert.equal(cleanup.process.exitCode, 0, cleanup.output())
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
let server, report, deletionAudit, baselineDeletionAudit, restartVerified = false, observation, unrelatedMemoryPreserved = false, postRestartDeletionAudit, crashRecoveryVerified = false
try {
  server = await start('initial')
  const processing = JSON.parse(await readFile(join(directory, gateway ? 'server.json' : 'fixture-processing.json'), 'utf8'))
  assert.equal(processing.llm, 'none'); if (!gateway) assert.equal(processing.paidProcessing, false)
  if (gateway) {
    assert.equal((await fetch(`${endpoint}/health`)).status, 403)
    const headers = { Authorization: `Bearer ${await bankToken(namespaces.first)}` }
    assert.equal((await fetch(`${endpoint}/v1/default/banks/${namespaces.second}/documents/${crypto.randomUUID()}`, { headers })).status, 403)
    assert.equal((await fetch(`${endpoint}/health`, { headers: { ...headers, Origin: 'https://foreign.example.invalid' } })).status, 403)
    assert.equal((await fetch(`${endpoint}/v1/default/banks/${namespaces.first}/reflect`, { method: 'POST', headers, body: '{}' })).status, 403)
  }
  const transport = gateway ? async (path, method, body, host, ...rest) => createJsonTransport({ endpoint, local: true, token: await bankToken(host.namespace) })(path, method, body, host, ...rest) : createJsonTransport({ endpoint, local: true })
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
  const retained = { id: crypto.randomUUID(), statement: `SYNTHETIC_RETAINED_BANK_${crypto.randomUUID()}`, revision: 1, updatedAt: new Date().toISOString() }
  const retainedHost = { ...host('first'), namespace: namespace() }
  assert.equal((await dispatch({ operation: 'upsert', records: [retained] }, retainedHost)).status, 'ok')
  if (gateway) {
    const interrupted = { id: crypto.randomUUID(), statement: `SYNTHETIC_INTERRUPTED_DELETE_${crypto.randomUUID()}`, revision: 1, updatedAt: new Date().toISOString() }
    assert.equal((await provider.dispatch({ operation: 'upsert', records: [interrupted] }, host('first'))).status, 'ok')
    const deletion = provider.dispatch({ operation: 'delete', ids: [interrupted.id] }, host('first'))
    const deadline = Date.now() + 5000
    while (true) {
      try { await access(join(directory, 'retention-pending')); break } catch { /* Wait for the durable pre-mutation journal. */ }
      assert(Date.now() < deadline, 'The controlled deletion did not reach its durable journal.')
      await new Promise(done => setTimeout(done, 1))
    }
    const { pid } = JSON.parse(await readFile(join(directory, 'server.json'), 'utf8'))
    process.kill(pid, 'SIGKILL')
    await server.exited; await deletion
    await writeFile(join(directory, 'interrupted.log'), server.output()); server = undefined
    server = await start('crash-recovery')
    await assert.rejects(access(join(directory, 'retention-pending')))
    assert.equal((await provider.dispatch({ operation: 'delete', ids: [interrupted.id] }, host('first'))).status, 'ok')
    crashRecoveryVerified = true
  }
  await writeFile(join(directory, 'records.json'), JSON.stringify({ ids: [...ids], statements: [...statements], namespaces: Object.values(namespaces) }))
  const auditor = child(python, [join(root, 'scripts/fixtures/context-hindsight-audit.py'), '--state', directory, '--records', join(directory, 'records.json'), '--check-guards'], 'audit')
  await auditor.exited; await writeFile(join(directory, 'audit.log'), auditor.output())
  assert.equal(auditor.process.exitCode, 0, auditor.output().slice(-2000))
  deletionAudit = JSON.parse(auditor.output().trim())
  await stop(server, 'initial'); server = undefined
  if (maintain || gateway) {
    baselineDeletionAudit = deletionAudit
    const maintenance = !gateway && child(python, [join(root, 'scripts/fixtures/context-hindsight-audit.py'), '--state', directory, '--records', join(directory, 'records.json'), '--maintain'], 'retention-maintenance')
    if (maintenance) {
    await maintenance.exited; await writeFile(join(directory, 'retention-maintenance.log'), maintenance.output())
    assert.equal(maintenance.process.exitCode, 0, maintenance.output().slice(-3000))
    deletionAudit = JSON.parse(maintenance.output().trim())
    }
  }
  server = await start('restart')
  for (const id of ids) for (const name of ['first', 'second']) {
    const result = await provider.dispatch({ operation: 'read', id }, host(name))
    assert.equal(result.status, 'ok'); assert.deepEqual(result.evidence, [])
  }
  const preserved = await dispatch({ operation: 'read', id: retained.id }, { ...retainedHost, idempotencyKey: crypto.randomUUID() })
  assert.equal(preserved.status, 'ok'); assert.equal(preserved.evidence[0]?.text, retained.statement)
  unrelatedMemoryPreserved = true
  if (maintain || gateway) {
    const audit = child(python, [join(root, 'scripts/fixtures/context-hindsight-audit.py'), '--state', directory, '--records', join(directory, 'records.json')], 'post-restart-audit')
    await audit.exited; assert.equal(audit.process.exitCode, 0, audit.output().slice(-2000))
    postRestartDeletionAudit = JSON.parse(audit.output().trim())
    assert.equal(postRestartDeletionAudit.plaintextDeletionPassed, true)
    assert.equal(postRestartDeletionAudit.physicalDeletionPassed, true)
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
  if (resourceTimer) clearInterval(resourceTimer)
  await sampling
  if (server) await stop(server, 'failed-server')
  for (const item of children) if (item.process.exitCode === null) { try { process.kill(-item.process.pid, 'SIGTERM') } catch { /* Owned process already exited. */ } }
  if (gateway) await cleanupOrphanDatabase()
  assert.deepEqual(await hashSources(), qualificationSourceHashes, 'Qualification sources changed during this run.')
  const evidence = { version: 2, measuredAt: new Date().toISOString(), directory, upstreamCommit: '5fc4ce20917b916240cef27c212c387a177f115b', qualificationSourceHashes, resources: { ...resources, boundary: 'Separate Python/API and PostgreSQL process RSS maxima sampled every 20 ms over this small synthetic conformance/crash workload; not aggregate desktop RSS or a capacity benchmark.' }, sourceHashes: Object.fromEntries(await Promise.all(['hindsight-local-server.py', 'hindsight-gateway.py', 'hindsight-retention.py'].map(async name => [name, createHash('sha256').update(await readFile(join(root, 'electron/main/context', name))).digest('hex')]))), serverFixtureSha256: createHash('sha256').update(await readFile(join(root, 'scripts/fixtures/context-hindsight-server.py'))).digest('hex'), retentionHelperSha256: createHash('sha256').update(await readFile(join(root, 'electron/main/context/hindsight-retention.py'))).digest('hex'), runtime: 'Upstream 0.10.2; private PostgreSQL; lexical hash vectors; LLM disabled; RRF reranker', gateway, authenticationVerified: gateway, crashRecoveryVerified, report, baselineDeletionAudit, deletionAudit, postRestartDeletionAudit, restartVerified, unrelatedMemoryPreserved, networkObservation: observation, qualification: gateway ? 'Named dedicated Linux local chunks server with automatic quiescent retention; no arbitrary external deployment, managed installer or semantic retrieval claim.' : 'Synthetic API/recovery and optional quiescent maintenance evidence only; no automatic personal-memory deployment approval or semantic retrieval claim.' }
  await writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence))
  await writeFile(join(directory, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2))
}
