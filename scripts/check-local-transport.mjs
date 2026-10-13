// Optional real long-header regression. The HTTP API, unlike Node fetch, has
// no implicit five-minute headers deadline. Synthetic loopback only.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const wait = Number(process.argv.find(value => value.startsWith('--seconds='))?.split('=')[1] ?? 320)
assert(Number.isFinite(wait) && wait >= 0 && wait <= 600)
const directory = await mkdtemp(join(tmpdir(), 'ourgeo-local-transport-')), module = join(directory, 'local-http.mjs')
await build({ entryPoints: ['electron/main/local-http.ts'], outfile: module, platform: 'node', format: 'esm' })
const { localHttpFetch } = await import(pathToFileURL(module))
const server = createServer((req, res) => { req.resume(); req.on('end', () => setTimeout(() => { res.write('first'); setTimeout(() => res.end(' last'), 20) }, wait * 1000)) })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const started = performance.now()
try {
  const reply = await localHttpFetch(`http://127.0.0.1:${server.address().port}`, { method: 'POST', body: 'synthetic' })
  const text = await reply.text(); assert.equal(text, 'first last')
  const report = { passed: true, delayedHeadersSeconds: wait, elapsedMs: performance.now() - started, node: process.version, scope: 'Actual local HTTP helper and streamed response; synthetic loopback, no model inference.' }
  await writeFile('/tmp/ourgeo-local-transport-evidence.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report))
} finally { await new Promise(resolve => server.close(resolve)) }
