import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { jsPDF } from 'jspdf'
import { createPackage } from '@electron/asar'
import { runExtraction } from './worker-client'

let directory: string, worker: string, original: string
beforeAll(async () => {
  await mkdir('.cache', { recursive: true })
  directory = await mkdtemp(resolve('.cache/project-file-parser-test-'))
  worker = join(directory, 'extract-worker.cjs')
  original = join(directory, 'reference.txt')
  await writeFile(original, '# Evidence\nOriginal café requirement')
  await build({ entryPoints: ['electron/main/project-files/extract-worker.ts'], outfile: worker, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' })
})
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

describe('supervised project document process', () => {
  it('extracts through the actual permission-limited child with intact Unicode', async () => {
    const extraction = await runExtraction(original, 'text/plain', undefined, 'reference.txt', {}, worker)
    expect(extraction.status).toBe('searchable')
    expect(extraction.sections[0].text).toContain('café requirement')
  })
  it('extracts PDF text with Electron’s actual Node runtime and external PDF.js worker asset', async () => {
    const pdf = new jsPDF(); pdf.text('Bundled-runtime clearance: 23 metres.', 20, 20)
    const pdfPath = join(directory, 'reference.pdf')
    await writeFile(pdfPath, Buffer.from(pdf.output('arraybuffer')))
    const runtime = resolve('node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron')
    const extraction = await runExtraction(pdfPath, 'application/pdf', undefined, 'reference.pdf', {}, worker, runtime)
    expect(extraction.status).toBe('searchable')
    expect(extraction.sections[0].text).toContain('Bundled-runtime clearance: 23 metres.')
  }, 60_000)
  it('loads the parser and PDF.js module/worker from an ASAR archive under Electron’s runtime', async () => {
    const packageDirectory = join(directory, 'packaged-runtime')
    await mkdir(packageDirectory)
    await cp(worker, join(packageDirectory, 'extract-worker.cjs'))
    const installed = new Set<string>()
    const copyDependency = async (name: string): Promise<void> => {
      if (installed.has(name)) return
      installed.add(name)
      const source = resolve('node_modules', name), target = join(packageDirectory, 'node_modules', name)
      await cp(source, target, { recursive: true })
      const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
      for (const dependency of Object.keys(metadata.dependencies || {})) await copyDependency(dependency)
    }
    await Promise.all(['fast-xml-parser', 'yauzl', 'numfmt'].map(copyDependency))
    const pdfPackage = join(packageDirectory, 'node_modules/pdfjs-dist')
    await mkdir(join(pdfPackage, 'legacy/build'), { recursive: true })
    for (const asset of ['package.json', 'legacy/build/pdf.mjs', 'legacy/build/pdf.worker.mjs']) await cp(resolve('node_modules/pdfjs-dist', asset), join(pdfPackage, asset))
    const pdf = new jsPDF(); pdf.text('ASAR retained PDF evidence', 20, 20)
    const pdfPath = join(directory, 'asar-reference.pdf'); await writeFile(pdfPath, Buffer.from(pdf.output('arraybuffer')))
    const archive = join(directory, 'app.asar')
    await createPackage(packageDirectory, archive)
    const runtime = resolve('node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron')
    const extraction = await runExtraction(pdfPath, 'application/pdf', undefined, 'reference.pdf', {}, join(archive, 'extract-worker.cjs'), runtime)
    expect(extraction.status).toBe('searchable')
    expect(extraction.sections[0].text).toContain('ASAR retained PDF evidence')
  }, 60_000)
  it('does not inherit credentials or permission to read unrelated user files', async () => {
    const probe = join(directory, 'probe.cjs')
    // A sibling of the permitted runtime directory is outside its read grant.
    const secretPath = resolve('.cache', `parser-secret-${Date.now()}.txt`)
    await writeFile(secretPath, 'private')
    process.env.OURGEO_TEST_PARSER_SECRET = 'must not inherit'
    try {
      await writeFile(probe, `const fs=require('node:fs');let denied=false;try{fs.readFileSync(${JSON.stringify(secretPath)})}catch(e){denied=e.code==='ERR_ACCESS_DENIED'};process.stdout.write(JSON.stringify({version:'probe',status:'stored',description:'',sections:[],coverage:'',denied,secret:process.env.OURGEO_TEST_PARSER_SECRET||null}));`)
      const response = await runExtraction(original, 'text/plain', undefined, 'reference.txt', {}, probe) as unknown as { denied: boolean; secret: string | null }
      expect(response.denied).toBe(true); expect(response.secret).toBeNull()
    } finally { delete process.env.OURGEO_TEST_PARSER_SECRET; await rm(secretPath, { force: true }) }
  })
  it('terminates a stalled child on cancellation and can immediately parse again', async () => {
    const stalled = join(directory, 'stalled.cjs')
    await writeFile(stalled, 'setInterval(()=>{},1000)')
    const controller = new AbortController()
    const running = runExtraction(original, 'text/plain', controller.signal, 'reference.txt', {}, stalled)
    setTimeout(() => controller.abort(), 80)
    await expect(running).rejects.toThrow('cancelled')
    expect((await runExtraction(original, 'text/plain', undefined, 'reference.txt', {}, worker)).status).toBe('searchable')
  })
  it('rejects a queued job when cancelled without taking another parser slot', async () => {
    const stalled = join(directory, 'stalled.cjs')
    await writeFile(stalled, 'setInterval(()=>{},1000)')
    const first = new AbortController(), second = new AbortController(), queued = new AbortController()
    const one = runExtraction(original, 'text/plain', first.signal, '', {}, stalled).catch(error => error)
    const two = runExtraction(original, 'text/plain', second.signal, '', {}, stalled).catch(error => error)
    const three = runExtraction(original, 'text/plain', queued.signal, '', {}, stalled)
    queued.abort(new Error('Queued extraction cancelled'))
    await expect(three).rejects.toThrow('cancelled')
    first.abort(); second.abort(); await Promise.all([one, two])
    expect((await runExtraction(original, 'text/plain', undefined, '', {}, worker)).status).toBe('searchable')
  })
})
