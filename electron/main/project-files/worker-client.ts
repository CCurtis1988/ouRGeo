import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import type { ProjectFileExtraction } from '../../../src/lib/project-files'
import type { ExtractionOptions } from './extraction'

export const PARSER_BUDGET = { timeoutMs: 45_000, heapMiB: 384, rssMiB: 640, outputBytes: 24 * 1024 ** 2, concurrent: 2 } as const
let active = 0
const pending: (() => void)[] = []

async function acquire(signal?: AbortSignal): Promise<() => void> {
  signal?.throwIfAborted()
  if (active >= PARSER_BUDGET.concurrent) await new Promise<void>((resolveSlot, reject) => {
    const ready = (): void => { signal?.removeEventListener('abort', abort); resolveSlot() }
    const abort = (): void => { const i = pending.indexOf(ready); if (i >= 0) pending.splice(i, 1); reject(signal?.reason || new Error('Indexing cancelled.')) }
    pending.push(ready); signal?.addEventListener('abort', abort, { once: true })
  })
  else active++
  return () => { const next = pending.shift(); if (next) next(); else active-- }
}

/** The child receives only a managed original and runtime code, with a clean
 * environment. It cannot read project memory, user credentials or other files. */
export async function runExtraction(path: string, mediaType: string, signal?: AbortSignal, originalName = '', options: ExtractionOptions = {}, workerPath = join(__dirname, 'project-file-extract.js'), executable = process.execPath): Promise<ProjectFileExtraction> {
  const release = await acquire(signal)
  try {
    signal?.throwIfAborted()
    const require = createRequire(join(__dirname, 'index.js'))
    const modules = dirname(dirname(require.resolve('pdfjs-dist/package.json')))
    // ASAR virtual directories look like files to Node's native permission
    // initialiser. Explicit descendant grants keep their runtime modules
    // readable without granting the parent resources directory or user data.
    const args = ['--permission', `--allow-fs-read=${resolve(path)}`, `--allow-fs-read=${dirname(workerPath)}`, `--allow-fs-read=${join(dirname(workerPath), '*')}`, `--allow-fs-read=${modules}`, `--allow-fs-read=${join(modules, '*')}`, `--max-old-space-size=${PARSER_BUDGET.heapMiB}`, workerPath]
    return await new Promise((resolveResult, reject) => {
      const child = spawn(executable, args, { env: { ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', LANG: 'C.UTF-8', TZ: 'UTC' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      let output = '', outputBytes = 0, stderr = '', failure: Error | undefined, settled = false
      const stop = (error: Error): void => { failure ||= error; child.kill('SIGKILL') }
      const abort = (): void => stop(new Error('Indexing cancelled. Retry indexing when ready.'))
      const timer = setTimeout(() => stop(new Error('Indexing exceeded its 45-second time limit. Export a smaller file or retry indexing.')), PARSER_BUDGET.timeoutMs)
      // Heap limits exclude Buffers/native allocations. Linux exposes RSS, so
      // supervise that separately; other platforms retain heap/time/output caps.
      const rssTimer = setInterval(() => {
        if (process.platform !== 'linux' || !child.pid) return
        void readFile(`/proc/${child.pid}/status`, 'utf8').then(status => {
          const kib = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0)
          if (kib > PARSER_BUDGET.rssMiB * 1024) stop(new Error('Indexing exceeded its memory limit. Export a smaller file or retry indexing.'))
        }).catch(() => {})
      }, 200)
      signal?.addEventListener('abort', abort, { once: true })
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => { outputBytes += Buffer.byteLength(chunk); output += chunk; if (outputBytes > PARSER_BUDGET.outputBytes) stop(new Error('Indexing exceeded its output limit. Export a smaller file.')) })
      child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 2000) stderr += chunk.toString().slice(0, 2000 - stderr.length) })
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true; clearTimeout(timer); clearInterval(rssTimer); signal?.removeEventListener('abort', abort)
        if (failure || error) { reject(failure || error); return }
        try { resolveResult(JSON.parse(output) as ProjectFileExtraction) } catch { reject(new Error(`Document parser did not return a valid index. Retry indexing.${stderr ? ` ${stderr.slice(0, 300)}` : ''}`)) }
      }
      child.on('error', finish)
      child.on('close', code => finish(code ? new Error(`Document parser exited (${code}). Retry indexing or export a repaired copy.${stderr ? ` ${stderr.slice(-1200)}` : ''}`) : undefined))
      child.stdin.on('error', () => {})
      child.stdin.end(JSON.stringify({ path: resolve(path), mediaType, originalName, options: { includeHidden: options.includeHidden === true } }))
      if (signal?.aborted) abort()
    })
  } finally { release() }
}
