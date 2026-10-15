import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
if (process.platform !== 'linux') throw new Error('This syscall audit runs on Linux.')
const root = resolve('.'), args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const fixture = option('--fixture', null)
const fixtures = { hindsight: ['scripts/check-context-hindsight.mjs', '--retention-maintenance'], 'hindsight-local': ['scripts/check-context-hindsight.mjs', '--gateway'], 'mnemosyne-server': ['scripts/check-context-mnemosyne-server.mjs'], 'mnemosyne-scale': ['scripts/check-context-mnemosyne-server.mjs', '--scale'], 'runtime-lifecycle': ['scripts/check-context-runtime-lifecycle.mjs'] }
if (fixture && !Object.hasOwn(fixtures, fixture)) throw new Error('Choose a supported isolated provider fixture.')
const strace = resolve(option('--strace', '/usr/bin/strace')), executable = resolve(option('--packaged', 'dist/linux-unpacked/ourgeo'))
const directory = await mkdtemp(join(tmpdir(), 'ourgeo-context-network-'))
const module = join(directory, 'network-audit.mjs')
await build({ entryPoints: ['src/lib/context/network-audit.ts'], outfile: module, platform: 'node', format: 'esm' })
const { auditLinuxNetworkTrace } = await import(pathToFileURL(module).href)
let ringObserver = null
try {
  const metadata = JSON.parse(await readFile(resolve(dirname(strace), '../../build.json'), 'utf8'))
  assert.equal(metadata.executable, strace)
  assert.equal(metadata.sha256, createHash('sha256').update(await readFile(strace)).digest('hex'))
  assert.equal(metadata.observerSha256, createHash('sha256').update(await readFile('scripts/native/strace-ring-observer.h')).digest('hex'))
  assert.equal(metadata.sourceSha256, 'edd95315046f6f19e5718d2881144c4086af2aec26b6df460f59b920898aa5b6')
  ringObserver = metadata
} catch (error) { if (error.code !== 'ENOENT') throw error }
const classify = raw => auditLinuxNetworkTrace(raw, { ringObserver: Boolean(ringObserver) })
const run = (command, argv) => new Promise((resolve, reject) => {
  const env = fixture ? Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'LANG', 'LC_ALL', 'TMPDIR'].includes(key))) : process.env
  const child = spawn(command, argv, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk) })
  child.stderr.on('data', chunk => { output += chunk; process.stderr.write(chunk) })
  child.on('error', reject)
  child.on('close', code => resolve({ code, output }))
})
const trace = (file, command, argv) => run('unshare', ['--user', '--map-current-user', '--keep-caps', '--net', 'sh', '-c',
  'ip link set lo up && ip -j address show && ip -j route show && exec "$@"', 'ourgeo-memory-offline', strace,
  '-f', '-qq', '-tt', '-yy', ...(args.includes('--stack-trace') ? ['-k'] : []), '-s', '0', '-e', 'trace=%network,%process,write,writev,io_uring_setup,io_uring_register,io_uring_enter', '-o', file, command, ...argv])
const canaryFile = join(directory, 'canary.cjs'), canaryTrace = join(directory, 'canary.trace')
await writeFile(canaryFile, `const net=require('node:net');const socket=net.connect({host:'198.51.100.42',port:443});socket.on('error',()=>{});setTimeout(()=>socket.destroy(),1000);`)
const canary = await trace(canaryTrace, process.execPath, [canaryFile])
assert.equal(canary.code, 0)
const detection = classify(await readFile(canaryTrace, 'utf8'))
assert(detection.externalAttempts.some(item => item.address === '198.51.100.42'), 'The tracer failed to detect the intentional offline canary.')
let ringCanaries = null
if (ringObserver) {
  const program = join(directory, 'ring-canary')
  assert.equal((await run('cc', ['scripts/native/context-ring-canary.c', '-o', program])).code, 0)
  const controlPath = join(directory, 'ring-control.trace'), networkPath = join(directory, 'ring-network.trace')
  assert.equal((await trace(controlPath, program, [])).code, 0)
  assert.equal((await trace(networkPath, program, ['network'])).code, 0)
  const control = classify(await readFile(controlPath, 'utf8')), network = classify(await readFile(networkPath, 'utf8'))
  assert(control.passed && control.decodedIoUringCalls === 2 && control.ioUringOpcodes.includes(29), 'Readiness-only ring was not completely observed.')
  assert(!network.passed && network.opaqueIoUringCalls > 0 && network.ioUringOpcodes.includes(16), 'The tracer failed to reject a hidden ring CONNECT operation.')
  ringCanaries = { control, network, executableSha256: createHash('sha256').update(await readFile(program)).digest('hex') }
}
const capture = join(directory, fixture ? `${fixture}.trace` : 'packaged.trace')
console.log(JSON.stringify({ event: 'audit-start', directory, executable, capture }))
const result = await trace(capture, process.execPath, fixture ? fixtures[fixture] : ['scripts/check-context.mjs', '--stages-0-2', '--packaged', executable])
await writeFile(join(directory, 'acceptance.log'), result.output)
const raw = await readFile(capture, 'utf8'), audit = classify(raw)
const acceptance = result.output.split('\n').flatMap(line => { try { const value = JSON.parse(line); return value.packaged === true ? [value] : [] } catch { return [] } }).at(-1)
const fixtureResult = fixture ? result.output.split('\n').flatMap(line => { try { const value = JSON.parse(line); return value.version && !value.event ? [value] : [] } catch { return [] } }).at(-1) : undefined
const report = { version: fixture ? 3 : 2, appVersion: fixture ? JSON.parse(await readFile('package.json', 'utf8')).version : acceptance?.appVersion ?? null,
  ...(fixture ? { fixture, fixtureResult } : { artifactHashes: { executable: createHash('sha256').update(await readFile(executable)).digest('hex'), archive: createHash('sha256').update(await readFile(join(dirname(executable), 'resources/app.asar'))).digest('hex') }, acceptance, executable }), measuredAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, directory,
  tracer: { path: strace, sha256: createHash('sha256').update(await readFile(strace)).digest('hex'), ringObserver }, ringCanaries,
  scope: fixture ? 'Launch through shutdown of the isolated Node/Python/PostgreSQL provider fixture in a loopback-only namespace. Connected writes and io_uring observed; payload strings suppressed; no user profile, model inference, dependency provisioning or ambient credentials.' : 'Launch through shutdown of packaged acceptance harness, Electron/R descendants and cold-start network syscalls in a loopback-only namespace. Shared desktop/keyring services reached by Unix IPC are outside the traced tree. Payload strings suppressed; no user profile or model inference.',
  captureOptions: { socketDescriptorDecoding: true, connectedWrites: true, payloadStrings: false, stackTrace: args.includes('--stack-trace'), ringObservation: Boolean(ringObserver) },
  canary: detection, acceptanceExitCode: result.code, traceBytes: Buffer.byteLength(raw), traceSha256: createHash('sha256').update(raw).digest('hex'),
  sourceHashes: Object.fromEntries(await Promise.all(['scripts/check-context-network.mjs', 'src/lib/context/network-audit.ts', ...(fixture ? [fixtures[fixture][0]] : ['scripts/check-context.mjs'])].map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')]))),
  audit, passed: result.code === 0 && audit.passed && (!fixture || Boolean(fixtureResult)) }
await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
await writeFile(fixture ? `/tmp/ourgeo-context-${fixture}-network-evidence.json` : '/tmp/ourgeo-context-network-evidence.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
if (!report.passed) process.exitCode = 1
