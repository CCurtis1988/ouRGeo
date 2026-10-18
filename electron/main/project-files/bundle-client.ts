import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { OpenedBundle, BundleWrite, BundleWriteResult } from './bundle'
export function bundleTask(kind: 'open', input: string, work: string, signal?: AbortSignal): Promise<OpenedBundle>
export function bundleTask(kind: 'save', input: BundleWrite, work: string, signal?: AbortSignal): Promise<BundleWriteResult>
export function bundleTask(kind: 'open' | 'save', input: string | BundleWrite, work: string, signal?: AbortSignal): Promise<OpenedBundle | BundleWriteResult> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = new Worker(join(__dirname, 'project-bundle-worker.js'), { workerData: kind === 'open' ? { kind, path: input, work } : { kind, input, work }, resourceLimits: { maxOldGenerationSizeMb: 256 } })
    let done = false
    const finish = (error?: Error, result?: OpenedBundle | BundleWriteResult): void => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); void child.terminate(); if (error) reject(error); else resolve(result!) }
    // Cancellation is cooperative through publication. Terminating a writer
    // after rename could falsely report cancellation of a completed save.
    const abort = (): void => { child.postMessage('cancel') }
    const timer = setTimeout(() => finish(new Error('Project worker did not report completion. Reopen the destination to verify its saved state; the working draft is retained.')), 10 * 60_000)
    signal?.addEventListener('abort', abort, { once: true })
    child.once('message', message => finish(message.error ? new Error(message.error) : undefined, message.result))
    child.once('error', error => finish(error)); child.once('exit', code => { if (!done) finish(new Error(`Project worker exited (${code}). Preserve the draft and retry.`)) })
  })
}
