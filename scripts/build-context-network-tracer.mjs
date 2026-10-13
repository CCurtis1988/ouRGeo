// Build only from the already supplied, pinned strace 7.2 source. No installer
// or system tracer is changed. The observer prints opcode/flag metadata only.
import { readFile, writeFile, cp, mkdir, access } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
const index = process.argv.indexOf('--source')
assert(index >= 0 && process.argv[index + 1], 'Use --source <unmodified strace 7.2 source directory>.')
const source = resolve(process.argv[index + 1]), root = resolve('.')
const original = await readFile(join(source, 'src/io_uring.c'), 'utf8')
const sourceSha256 = createHash('sha256').update(original).digest('hex')
assert.equal(sourceSha256, 'edd95315046f6f19e5718d2881144c4086af2aec26b6df460f59b920898aa5b6', 'The strace 7.2 io_uring decoder differs from the reviewed source.');
const observerPath = 'scripts/native/strace-ring-observer.h', observer = await readFile(observerPath, 'utf8')
const observerSha256 = createHash('sha256').update(observer).digest('hex')
// The pin is recorded with the built tracer and checked before applying exact
// insertion points. An unsupported release must never silently use this decoder.
assert((await readFile(join(source, 'configure'), 'utf8')).includes("PACKAGE_VERSION='7.2'"), 'Use strace 7.2.')
const directory = join(root, '.cache/context-network-tracer', observerSha256.slice(0, 16))
await mkdir(directory, { recursive: true })
const build = join(directory, 'source')
try { await access(build) } catch { await cp(source, build, { recursive: true }) }
const run = (program, args) => new Promise((resolveRun, reject) => {
 const child = spawn(program, args, { cwd: build, stdio: 'inherit', env: { ...process.env, TMPDIR: join(root, '.cache/stage02/tmp') } })
 child.on('error', reject); child.on('exit', code => code === 0 ? resolveRun() : reject(new Error(`${program} exited ${code}`)))
})
const setup = original.indexOf('SYS_FUNC(io_uring_setup)'), enter = original.indexOf('SYS_FUNC(io_uring_enter)')
assert(setup > 0 && enter > setup)
let patched = original.replace('static void\nprint_io_sqring_offsets', '#include "ourgeo_ring_observer.h"\n\nstatic void\nprint_io_sqring_offsets')
patched = patched.replace('if (tfetch_mem(tcp, params_addr, sizeof(params), &params)) {', 'if (tfetch_mem(tcp, params_addr, sizeof(params), &params)) {\n\t\tourgeo_ring_setup(tcp, &params);')
patched = patched.replace('SYS_FUNC(io_uring_enter)\n{', 'SYS_FUNC(io_uring_enter)\n{\n\tourgeo_ring_enter(tcp);')
assert(patched.includes('ourgeo_ring_setup(tcp, &params);') && patched.includes('ourgeo_ring_enter(tcp);'))
await writeFile(join(build, 'src/io_uring.c'), patched)
await writeFile(join(build, 'src/ourgeo_ring_observer.h'), observer)
await run('./configure', ['--enable-mpers=no', '--without-libunwind'])
await run('make', ['-j4'])
const executable = join(build, 'src/strace')
const report = { version: 1, upstream: 'strace 7.2', sourceSha256, observerPath, observerSha256, executable,
 sha256: createHash('sha256').update(await readFile(executable)).digest('hex'), scope: 'Payload-free SQE opcode/flag observation for ordinary mmap-backed non-SQPOLL rings; unsupported layouts and operations remain opaque.' }
await writeFile(join(directory, 'build.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
