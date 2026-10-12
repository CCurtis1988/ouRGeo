import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
if (process.platform !== 'linux') throw new Error('This syscall audit runs on Linux.')
const root = resolve('.'), args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const strace = resolve(option('--strace', '/usr/bin/strace')), executable = resolve(option('--packaged', 'dist/linux-unpacked/ourgeo'))
const directory = await mkdtemp(join(tmpdir(), 'ourgeo-context-network-'))
const module = join(directory, 'network-audit.mjs')
await build({ entryPoints: ['src/lib/context/network-audit.ts'], outfile: module, platform: 'node', format: 'esm' })
const { auditLinuxNetworkTrace } = await import(pathToFileURL(module).href)
const run = (command, argv) => new Promise((resolve, reject) => {
  const child = spawn(command, argv, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk) })
  child.stderr.on('data', chunk => { output += chunk; process.stderr.write(chunk) })
  child.on('error', reject)
  child.on('close', code => resolve({ code, output }))
})
const trace = (file, command, argv) => run('unshare', ['--user', '--map-current-user', '--keep-caps', '--net', 'sh', '-c',
  'ip link set lo up && ip -j address show && ip -j route show && exec "$@"', 'ourgeo-memory-offline', strace,
  '-f', '-qq', '-tt', '-s', '0', '-e', 'trace=%network,%process,io_uring_setup,io_uring_register,io_uring_enter', '-o', file, command, ...argv])
const canaryFile = join(directory, 'canary.cjs'), canaryTrace = join(directory, 'canary.trace')
await writeFile(canaryFile, `const net=require('node:net');const socket=net.connect({host:'198.51.100.42',port:443});socket.on('error',()=>{});setTimeout(()=>socket.destroy(),1000);`)
const canary = await trace(canaryTrace, process.execPath, [canaryFile])
assert.equal(canary.code, 0)
const detection = auditLinuxNetworkTrace(await readFile(canaryTrace, 'utf8'))
assert(detection.externalAttempts.some(item => item.address === '198.51.100.42'), 'The tracer failed to detect the intentional offline canary.')
const capture = join(directory, 'packaged.trace')
console.log(JSON.stringify({ event: 'audit-start', directory, executable, capture }))
const result = await trace(capture, process.execPath, ['scripts/check-context.mjs', '--stages-0-2', '--packaged', executable])
await writeFile(join(directory, 'acceptance.log'), result.output)
const raw = await readFile(capture, 'utf8'), audit = auditLinuxNetworkTrace(raw)
const report = { version: 1, measuredAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, executable, directory,
  tracer: { path: strace, sha256: createHash('sha256').update(await readFile(strace)).digest('hex') },
  scope: 'Launch through shutdown of packaged acceptance harness, Electron/R descendants and cold-start network syscalls in a loopback-only namespace. Shared desktop/keyring services reached by Unix IPC are outside the traced tree. Payload strings suppressed; no user profile or model inference.',
  canary: detection, acceptanceExitCode: result.code, traceBytes: Buffer.byteLength(raw), traceSha256: createHash('sha256').update(raw).digest('hex'),
  sourceHashes: Object.fromEntries(await Promise.all(['scripts/check-context-network.mjs', 'src/lib/context/network-audit.ts', 'scripts/check-context.mjs'].map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')]))),
  audit, passed: result.code === 0 && audit.passed }
await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
await writeFile('/tmp/ourgeo-context-network-evidence.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
if (!report.passed) process.exitCode = 1
