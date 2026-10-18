// Run with the installed esbuild runner (see docs/project-files-validation.md).
// This exercises production library/extraction/bundle APIs, never an AI service.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { cpus, freemem, hostname, platform, release, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { setTimeout as pause } from 'node:timers/promises'
import { ProjectFileLibrary } from '../electron/main/project-files/library'
import { runExtraction } from '../electron/main/project-files/worker-client'
import { emptyLibrary } from '../electron/main/project-files/catalogue'
import { readBundle, writeBundle } from '../electron/main/project-files/bundle'
import type { ProjectFileEntry } from '../src/lib/project-files'

const elapsed = async <T>(run: () => T | Promise<T>): Promise<{ ms: number; result: T }> => { const start = performance.now(); return { result: await run(), ms: performance.now() - start } }
const percentile = (values: number[], p: number): number => values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)]
async function repeated(run: () => unknown | Promise<unknown>, count = 21): Promise<{ medianMs: number; p95Ms: number }> {
  const samples: number[] = []; for (let n = 0; n < count; n++) samples.push((await elapsed(run)).ms)
  return { medianMs: percentile(samples, .5), p95Ms: percentile(samples, .95) }
}
async function main(): Promise<void> {
  const count = Number(process.env.OURGEO_BENCH_FILES || 250), bytes = Number(process.env.OURGEO_BENCH_FILE_BYTES || 1024 ** 2)
  if (!Number.isSafeInteger(count) || count < 1 || count > 250 || !Number.isSafeInteger(bytes) || bytes < 1024 || bytes > 1024 ** 2) throw new Error('Benchmark supports 1–250 files, 1 KiB–1 MiB per original.')
  await mkdir('.cache/tmp', { recursive: true })
  const root = await mkdtemp(resolve('.cache/tmp/project-files-benchmark-')), fixture = join(root, 'fixtures'), incoming = join(root, 'incoming')
  await mkdir(fixture); await mkdir(incoming)
  let peakRss = process.memoryUsage().rss
  const rssTimer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss) }, 100)
  try {
    const paths: string[] = [], line = 'Reference material for site planning. Colours, legends, map scale, datum and units are recorded here.\n'
    for (let index = 0; index < count; index++) {
      const source = Buffer.alloc(bytes, ' '), content = `# Reference ${index}\n${line.repeat(Math.ceil(bytes / line.length))}`
      source.write(content.slice(0, bytes), 'utf8')
      if (index === Math.min(79, count - 1)) source.write('\nqualifiedneedle: maintain 17 metres clearance.\n', Math.floor(bytes * .8), 'utf8')
      const path = join(fixture, `reference-${String(index).padStart(3, '0')}.txt`); await writeFile(path, source); paths.push(path)
    }
    const scope = { id: 'benchmark-lease', projectId: randomUUID() }, key = async (): Promise<Buffer> => Buffer.alloc(32, 7)
    const library = new ProjectFileLibrary(join(root, 'library'), () => scope, () => {}, (path, media, signal, name) => runExtraction(path, media, signal, name, {}, resolve('out/main/project-file-extract.js')), key)
    await library.activate(scope.projectId, join(root, 'project.ourgeoproj'), emptyLibrary(), incoming, '', false)
    const imported = await elapsed(() => library.add(paths, scope.id))
    if (imported.result.errors.length) throw new Error(imported.result.errors.join('\n'))
    const indexing = await elapsed(async () => {
      while (library.catalogue(scope.id).operation) await pause(25)
      const errors = library.catalogue(scope.id).files.filter(file => file.status !== 'searchable')
      if (errors.length) throw new Error(`Indexing failed: ${errors.map(file => `${file.name}: ${file.issue || file.coverage}`).join('; ')}`)
    })
    const catalogue250 = await repeated(() => library.catalogue(scope.id))
    const firstSearch = await elapsed(() => library.search('qualifiedneedle', scope.id))
    if (firstSearch.result.length !== 1 || !firstSearch.result[0].excerpt.includes('17 metres')) throw new Error('The independently placed evidence was not found uniquely.')
    const warmSearch = await repeated(() => library.search('qualifiedneedle', scope.id))
    const snapshot = library.snapshot(), destination = join(root, 'project.ourgeoproj')
    const saved = await elapsed(() => writeBundle({ destination, manifest: JSON.stringify({ version: 1, projectId: scope.projectId, ui: {} }), envPath: null, library: snapshot.library, blobDir: snapshot.blobDir, upgrade: true }, join(root, 'write')))
    const reopened = await elapsed(() => readBundle(destination, join(root, 'reopened')))
    if (reopened.result.library.files.length !== count) throw new Error('Bundle reopen lost reference files.')
    const originalHash = createHash('sha256').update(await readFile(paths[0])).digest('hex')
    const reopenedHash = createHash('sha256').update(await readFile(join(reopened.result.blobDir, originalHash))).digest('hex')
    if (originalHash !== reopenedHash) throw new Error('Reopened bytes differ from original.')
    // A separate valid 2,000-entry catalogue tests the real catalogue API. Its
    // references share one tiny blob to isolate catalogue cost from parser IO.
    const tiny = Buffer.from('Synthetic catalogue cost fixture.\n'), hash = createHash('sha256').update(tiny).digest('hex'), metadataBlobs = join(root, 'metadata-blobs')
    await mkdir(metadataBlobs); await writeFile(join(metadataBlobs, hash), tiny)
    const base = snapshot.library.files[0], files: ProjectFileEntry[] = Array.from({ length: 2000 }, (_, index) => ({ ...base, id: randomUUID(), name: `Metadata example ${index}.txt`, sha256: hash, revision: `${hash}:1`, bytes: tiny.length }))
    const metadataScope = { id: 'metadata-lease', projectId: randomUUID() }
    const metadataLibrary = new ProjectFileLibrary(join(root, 'metadata-library'), () => metadataScope, () => {}, async () => { throw new Error('Catalogue-only fixture has no indexing workload') }, async () => { throw new Error('Catalogue-only fixture does not initialise an index') })
    await metadataLibrary.activate(metadataScope.projectId, 'metadata.ourgeoproj', { version: 1, revision: 1, files }, metadataBlobs, '', true)
    const catalogue2000 = await repeated(() => metadataLibrary.catalogue(metadataScope.id))
    const report = { measuredAt: new Date().toISOString(), host: { hostname: hostname(), platform: platform(), release: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryMiB: Math.round(totalmem() / 1024 ** 2), availableMemoryMiB: Math.round(freemem() / 1024 ** 2), node: process.version }, corpus: { files: count, bytesPerOriginal: bytes, totalOriginalMiB: count * bytes / 1024 ** 2, format: 'UTF-8 text, independently specified rare evidence at80% of one original', fixtureCache: 'fresh generated files; OS page cache warm after generation; extraction cache initially absent', parser: 'production supervised process,45s/384MiB heap/640MiB RSS; production library indexes sequentially' }, importMs: imported.ms, indexingAfterImportMs: indexing.ms, catalogue250, firstIndexedSearchMs: firstSearch.ms, warmIndexedSearch: warmSearch, save250MiBMs: saved.ms, open250MiBMs: reopened.ms, catalogue2000, parentPeakRssMiB: Math.round(peakRss / 1024 ** 2), qualifications: ['Backend API timings; these do not measure pane/DOM opening latency.', 'Only Linux host run; native Windows/macOS deferred.', 'One synthetic text corpus; this does not qualify arbitrary PDFs/Office documents or packaged application end-to-end.', 'Peak RSS samples the benchmark parent, not a sum of parent and parser processes.'] }
    await writeFile('.cache/project-files-benchmark.json', JSON.stringify(report, null, 2)); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } finally { clearInterval(rssTimer); await rm(root, { recursive: true, force: true }) }
}
void main().catch(error => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1 })
