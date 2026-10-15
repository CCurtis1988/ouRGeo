import { build } from 'esbuild'
import { access, mkdir, mkdtemp, readFile, writeFile, readdir, stat, statfs, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import assert from 'node:assert/strict'

// Explicitly provisioned immutable archives only. Never touches a user profile,
// installs dependencies, inherits model credentials or calls a model/service.
const root = resolve(import.meta.dirname, '..'), cache = join(root, '.cache/stage34/runtime-lifecycle')
await mkdir(cache, { recursive: true })
const workerIndex = process.argv.indexOf('--crash-worker')
const diskIndex = process.argv.indexOf('--disk-full')
const directory = workerIndex >= 0 ? process.argv[workerIndex + 1] : await mkdtemp(join(cache, 'fixture-'))
const tracer = process.env.OURGEO_CONTEXT_STRACE_PATH
if (tracer && !process.argv.includes('--observed') && workerIndex < 0) {
  await access(tracer)
  const trace = join(directory, 'whole-process.network.trace')
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'LANG', 'LC_ALL', 'TMPDIR'].includes(key)))
  const child = spawn(tracer, ['-f', '-qq', '--kill-on-exit', '-e', 'trace=%network', '-o', trace, process.execPath, import.meta.filename, '--observed'], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = '', errors = ''; child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { errors += data })
  const [code] = await once(child, 'close'); await writeFile(join(directory, 'run.log'), output + errors)
  assert.equal(code, 0, errors.slice(-4000))
  const report = JSON.parse(output.trim())
  const controlTrace = join(directory, 'positive-control.network.trace')
  const control = spawn(tracer, ['-f', '-qq', '-e', 'trace=%network', '-o', controlTrace, process.execPath, '-e', "require('node:net').createServer().listen(0,'127.0.0.1',function(){this.close()})"], { env: environment, stdio: 'ignore' })
  assert.equal((await once(control, 'close'))[0], 0)
  assert(/socket\(/.test(await readFile(controlTrace, 'utf8')))
  const connections = (await readFile(trace, 'utf8')).split('\n').filter(line => /\bconnect\(/.test(line) && /AF_INET6?/.test(line))
  assert.equal(connections.length, 0, 'The managed lifecycle fixture attempted a network connection.')
  report.networkObservation = { positiveControl: true, internetConnectAttempts: 0, trace, boundary: 'Whole Node installer/driver, SIGKILL worker and pinned Python descendants; no model calls or downloads' }
  await writeFile(join(directory, 'evidence.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); process.exit(0)
}
const bundle = join(directory, 'lifecycle.mjs')
if (workerIndex < 0) await build({ stdin: { contents: 'export * from "./electron/main/context/runtime-installer"; export * from "./electron/main/context/runtime-catalogue"; export * from "./electron/main/context/runtime-integrity"; export * from "./electron/main/context/runtimes"; export { MemoryStorage } from "./electron/main/context/storage"; export { ManagedMnemosyneRuntime } from "./electron/main/context/managed-runtime";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: bundle })
const { RuntimeInstaller, MNEMOSYNE_LOCAL_CANDIDATE: candidate, runtimeIntegrity, MemoryRuntime, mnemosyneEnvironment, MemoryStorage, ManagedMnemosyneRuntime } = await import(pathToFileURL(bundle).href)
const artifacts = [{ role: 'python', archive: candidate.python.profiles['linux-x64'] }, { role: 'engine', archive: candidate.provider.archive }, { role: 'yaml', archive: candidate.yaml.archive }]
const archives = new Map(artifacts.map((item, index) => [item.archive.url, ['/tmp/ourgeo-mnemosyne-python.tar.gz', '/tmp/ourgeo-mnemosyne-source.tar.gz', '/tmp/ourgeo-mnemosyne-pyyaml.tar.gz'][index]]))
const profile = { id: candidate.id, version: candidate.provider.engineVersion, certification: 'pending', artifacts }
const installations = diskIndex >= 0 ? resolve(process.argv[diskIndex + 1]) : join(directory, 'installations'), canonical = join(directory, 'canonical.sqlite'), bridge = join(root, 'electron/main/context/mnemosyne-sidecar.py')
if (diskIndex >= 0) {
  const volume = await statfs(installations)
  assert(installations.startsWith(join(root, '.cache/stage34/runtime-full-')) && (await readdir(installations)).length === 0)
  assert.equal(volume.type, 0x01021994, 'Disk-full acceptance needs a fresh private tmpfs mount.')
  assert(volume.bsize * volume.blocks <= 350 * 1024 * 1024)
}
const key = workerIndex >= 0 ? Buffer.from((await readFile(join(directory, 'synthetic-key'), 'utf8')).trim(), 'hex') : randomBytes(32)
if (workerIndex < 0) await writeFile(join(directory, 'synthetic-key'), key.toString('hex'), { mode: 0o600 })
let store = new MemoryStorage(canonical, Buffer.from(key)), healthChecks = 0, peakChildRssBytes = 0
const backups = [], runtimes = new Set(), children = new Set()
const host = () => ({ signal: new AbortController().signal, authorised: () => true, timeoutMs: 30000 })
const fetcher = async url => {
  assert(archives.has(String(url)), 'Runtime attempted an unprovisioned download.')
  const bytes = await readFile(archives.get(String(url)))
  return new Response(bytes, { headers: { 'Content-Length': String(bytes.length), ETag: '"immutable-private-fixture"' } })
}
function runtime(directory, installation, data) {
  const path = role => { const artifact = installation.artifacts.find(item => item.role === role); assert(artifact); return join(directory, artifact.directory, artifact.root) }
  const value = new MemoryRuntime({ executable: join(path('python'), 'bin/python3.12'), arguments: ['-I', '-B', '-S', bridge, path('engine'), join(path('yaml'), 'lib'), data], directory, environment: mnemosyneEnvironment(data), profile: candidate.id,
    verify: async () => assert.deepEqual(await runtimeIntegrity(directory, installation.artifacts), installation.integrity) }, configuration => {
    const child = spawn(configuration.executable, configuration.arguments, { cwd: configuration.directory, env: configuration.environment, stdio: ['pipe', 'pipe', 'pipe'] })
    children.add(child); child.once('close', () => children.delete(child)); return child
  })
  runtimes.add(value); return value
}
const sample = setInterval(() => {
  for (const child of children) if (child.pid) void readFile(`/proc/${child.pid}/status`, 'utf8').then(text => { peakChildRssBytes = Math.max(peakChildRssBytes, Number(text.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024) }).catch(() => {})
}, 20)
sample.unref()
const health = async (directory, installation, signal) => {
  if (workerIndex >= 0 && directory.endsWith(installation.folder)) process.kill(process.pid, 'SIGKILL')
  const data = join(directory, `.health-${randomUUID()}`), child = runtime(directory, installation, data)
  try {
    await mkdir(data, { mode: 0o700 })
    const response = await child.request({ operation: 'probe', namespace: randomUUID() }, { ...host(), signal })
    assert.equal(response.complete, true); healthChecks++
  } finally { await child.stop(); await rm(data, { recursive: true, force: true }) }
}
const beforeActivate = async () => { for (const child of runtimes) await child.stop(); const receipt = store.createBackup(); assert.equal(store.inspectBackup(receipt.id).verified, true); backups.push(receipt.id) }
const installer = new RuntimeInstaller(installations, profile, { health, fetcher, beforeActivate })
if (workerIndex >= 0) { await installer.install(); throw new Error('The synthetic crash worker unexpectedly completed.') }
const checks = [], started = performance.now()
const record = { id: randomUUID(), revision: 1, scope: 'global', projectId: null, category: 'preference', statement: `SYNTHETIC_BACKUP_PREFERENCE_${randomUUID()}`, assertion: 'user-declared', evidence: [], status: 'active', supersedes: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
store.save(record)
const namespace = randomUUID()
let managed, legacy, supervisor
try {
  const first = await installer.install()
  assert(first.integrity); assert.equal(backups.length, 1)
  const writer = runtime(join(installations, first.folder), first, join(installations, first.folder, 'derived'))
  await writer.request({ operation: 'replace', namespace, generation: 1, records: [{ id: record.id, revision: 1, text: record.statement, updatedAt: record.updatedAt }] }, host())
  await writer.stop(); checks.push('Install verifies actual pinned files and backs up encrypted canonical memory')
  if (diskIndex >= 0) {
    await assert.rejects(installer.install(), /ENOSPC|no space left/i)
    assert.equal((await installer.current()).folder, first.folder)
    assert.equal(store.list()[0]?.statement, record.statement)
    await installer.verify(first)
    assert.equal((await writer.request({ operation: 'read', namespace, sourceId: record.id }, host())).evidence[0]?.text, record.statement)
    await writer.stop()
    assert(!(await readdir(installations)).some(name => name.startsWith('.install-')))
    checks.push('Actual ENOSPC during update preserves the verified active pair, readable provider snapshot and encrypted canonical memory')
  } else {
  const updated = await installer.install()
  assert.notEqual(updated.folder, first.folder); assert.equal(backups.length, 2)
  assert.equal((await writer.request({ operation: 'read', namespace, sourceId: record.id }, host())).evidence[0]?.text, record.statement)
  await writer.stop(); checks.push('Update preserves the stopped old runtime/data pair')
  await installer.rollback()
  assert.equal((await installer.current()).folder, first.folder)
  assert.equal((await writer.request({ operation: 'read', namespace, sourceId: record.id }, host())).evidence[0]?.text, record.statement)
  await writer.stop(); checks.push('Rollback restores a compatible pair with its original readable snapshot')
  const legacyBridge = join(installations, first.folder, 'ourgeo-bridge.py')
  await writeFile(legacyBridge, "import time\nprint('SYNTHETIC_LEGACY_READY',flush=True)\nwhile True: time.sleep(1)\n", { mode: 0o600 })
  const artifactPath = role => { const artifact = first.artifacts.find(item => item.role === role); return join(installations, first.folder, artifact.directory, artifact.root) }
  legacy = spawn(join(artifactPath('python'), 'bin/python3.12'), ['-I', '-B', '-S', legacyBridge, artifactPath('engine'), join(artifactPath('yaml'), 'lib'), join(installations, first.folder, 'derived')], { cwd: join(installations, first.folder), env: mnemosyneEnvironment(join(installations, first.folder, 'derived')), stdio: ['pipe', 'pipe', 'pipe'] })
  const legacyClosed = once(legacy, 'close')
  await once(legacy.stdout, 'data')
  managed = new ManagedMnemosyneRuntime(installations, bridge)
  const restored = await Promise.all([1, 2].map(() => managed.request({ operation: 'read', namespace, sourceId: record.id }, host())))
  for (const response of restored) assert.equal(response.evidence[0]?.text, record.statement)
  assert.equal((await legacyClosed)[1], 'SIGTERM'); legacy = undefined
  checks.push('Recovery stops only the exact owned legacy bridge before starting a replacement')
  await managed.shutdown(); managed = undefined
  checks.push('Concurrent cold starts reopen an existing derived directory without duplicate startup')
  const deathData = join(directory, 'parent-death'), childFile = join(directory, 'owned-child.json'), control = join(directory, 'parent-control.cjs'), controlConfig = join(directory, 'parent-control.json')
  await mkdir(deathData, { mode: 0o700 })
  const deathNamespace = randomUUID()
  await writeFile(controlConfig, JSON.stringify({ executable: join(artifactPath('python'), 'bin/python3.12'), arguments: ['-I', '-B', '-S', bridge, artifactPath('engine'), join(artifactPath('yaml'), 'lib'), deathData], directory, environment: mnemosyneEnvironment(deathData), childFile,
    payload: { id: 1, payload: { operation: 'replace', namespace: deathNamespace, generation: 1, records: Array.from({ length: 3000 }, (_, index) => ({ id: randomUUID(), revision: 1, text: `SYNTHETIC_PARENT_DEATH_${index}`, updatedAt: record.updatedAt })) } } }), { mode: 0o600 })
  await writeFile(control, `const fs=require('node:fs'),{spawn}=require('node:child_process');const config=JSON.parse(fs.readFileSync(process.argv[2]));const child=spawn(config.executable,[...config.arguments,'--parent-pid',String(process.pid)],{cwd:config.directory,env:config.environment,stdio:['pipe','pipe','pipe']});let buffer='',sent=false;child.stderr.resume();child.stdout.on('data',chunk=>{if(sent)return;buffer+=chunk;const line=buffer.indexOf('\\n');if(line<0)return;const ready=JSON.parse(buffer.slice(0,line));if(!ready.ready)throw new Error('Synthetic child readiness failed');sent=true;fs.writeFileSync(config.childFile+'.tmp',JSON.stringify({pid:child.pid}));fs.renameSync(config.childFile+'.tmp',config.childFile);child.stdin.write(JSON.stringify(config.payload)+'\\n')});child.on('error',()=>process.exit(1));child.on('close',()=>process.exit(1));`)
  const controlledEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => ['PATH', 'LANG', 'LC_ALL', 'TMPDIR'].includes(name)))
  supervisor = spawn(process.execPath, [control, controlConfig], { cwd: root, env: controlledEnvironment, stdio: 'ignore' })
  const supervisorClosed = once(supervisor, 'close'), readyDeadline = Date.now() + 15000
  let ownedChild
  while (!ownedChild || !(await readdir(deathData)).some(name => name.startsWith('.rebuild-'))) {
    if (Date.now() > readyDeadline || supervisor.exitCode !== null) throw new Error('Synthetic parent-death rebuild did not start.')
    try { ownedChild = JSON.parse(await readFile(childFile, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    await new Promise(done => setTimeout(done, 5))
  }
  supervisor.kill('SIGKILL'); assert.equal((await supervisorClosed)[1], 'SIGKILL'); supervisor = undefined
  const stoppedDeadline = Date.now() + 3000
  while (true) {
    try { const state = await readFile(`/proc/${ownedChild.pid}/stat`, 'utf8'); if (state.slice(state.lastIndexOf(')') + 2).startsWith('Z ')) break }
    catch (error) { if (error.code === 'ENOENT') break; throw error }
    if (Date.now() > stoppedDeadline) throw new Error('The private child survived its killed host.')
    await new Promise(done => setTimeout(done, 10))
  }
  const afterDeath = runtime(join(installations, first.folder), first, deathData)
  const recoveredState = await afterDeath.request({ operation: 'probe', namespace: deathNamespace }, host())
  assert([0, 1].includes(recoveredState.generation))
  assert(!(await readdir(deathData)).some(name => name.startsWith('.rebuild-')))
  await afterDeath.stop()
  checks.push('SIGKILL of a live host also kills its in-flight child; restart opens only an intact atomic snapshot')
  store.close(); store = undefined
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => ['PATH', 'LANG', 'LC_ALL', 'TMPDIR'].includes(name)))
  const crash = spawn(process.execPath, [import.meta.filename, '--crash-worker', directory], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  let errors = ''; crash.stderr.on('data', data => { errors += data }); crash.stdout.resume()
  const [exitCode, signal] = await once(crash, 'close')
  assert.equal(exitCode, null, errors.slice(-3000)); assert.equal(signal, 'SIGKILL')
  store = new MemoryStorage(canonical, Buffer.from(key))
  const recovered = new RuntimeInstaller(installations, profile, { health, fetcher, beforeActivate })
  assert.equal((await recovered.current()).folder, first.folder)
  assert(!((await readdir(installations)).includes('activation.json')))
  assert.equal(store.list()[0]?.statement, record.statement)
  checks.push('SIGKILL after pointer activation recovers the last committed pair and canonical memory')
  const backup = store.backups().at(-1); assert(backup); assert.equal(store.inspectBackup(backup.id).verified, true)
  store.forget(record.id, [], 'global')
  store.restoreBackup(backup.id, ['global'])
  assert.equal(store.list().length, 0)
  checks.push('Encrypted backup restore honours a newer forgetting tombstone')
  managed = new ManagedMnemosyneRuntime(installations, bridge)
  await managed.forgetDerived([namespace])
  for (const name of await readdir(installations)) if (name.startsWith('installed_')) {
    const data = join(installations, name, 'derived')
    try { assert(!(await readdir(data)).some(name => name.startsWith(namespace))) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  checks.push('Forgetting removes derived copies from active, rollback and interrupted pairs')
  const artifact = first.artifacts.find(item => item.role === 'engine')
  const damaged = join(installations, first.folder, artifact.directory, artifact.root, 'ourgeo-integrity-fixture')
  await writeFile(damaged, 'Synthetic added runtime module')
  await assert.rejects(recovered.verify(first), /integrity failed/)
  await rm(damaged); await recovered.verify(first)
  checks.push('Installed-file mutation is refused before launching native code')
  }
  async function treeBytes(path) { let total = 0; for (const entry of await readdir(path, { withFileTypes: true })) { const file = join(path, entry.name); total += entry.isDirectory() ? await treeBytes(file) : (await stat(file)).size } return total }
  const report = { version: 1, measuredAt: new Date().toISOString(), directory, diskFull: diskIndex >= 0, profile: candidate.id, upstreamCommit: candidate.provider.commit, bridgeSha256: createHash('sha256').update(await readFile(bridge)).digest('hex'), checks, passed: true, healthChecks, backupCount: store.backups().length, installedBytes: await treeBytes(join(installations, first.folder)), artifactBytes: first.integrity.bytes, artifactFiles: first.integrity.files, peakChildRssBytes, elapsedMs: performance.now() - started,
    qualification: 'Actual pinned Linux x64 lifecycle and small synthetic workload; no other platform, full desktop capacity, model quality or arbitrary external deployment claim' }
  await writeFile(join(directory, 'evidence.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report))
} catch (error) { await writeFile(join(directory, 'failure.json'), JSON.stringify({ checks, error: String(error), stack: error.stack }, null, 2)); throw error }
finally { clearInterval(sample); if (legacy && legacy.exitCode === null) legacy.kill('SIGKILL'); if (supervisor && supervisor.exitCode === null) supervisor.kill('SIGKILL'); await managed?.shutdown(); for (const child of runtimes) await child.stop(); store?.close() }
