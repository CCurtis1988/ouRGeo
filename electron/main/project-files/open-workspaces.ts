import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Only main-created directories can be released. The renderer receives an
 * opaque receipt, never authority to recursively remove an arbitrary path. */
export class ProjectOpenWorkspaces {
  private entries = new Map<string, { owner: number; path: string; controller: AbortController; task?: Promise<void> }>()
  private creating = new Set<Promise<void>>()
  private closing = false
  private cleanup?: Promise<void>
  private cleaned = false
  constructor(private root: string) {}
  get pending(): boolean { return !this.cleaned && (this.entries.size > 0 || this.creating.size > 0 || !!this.cleanup) }
  async create(owner: number): Promise<{ token: string; path: string; signal: AbortSignal }> {
    if (this.closing) throw new Error('The application is closing. Reopen the project after restarting ouRGeo.')
    let finish!: () => void
    const creating = new Promise<void>(resolve => { finish = resolve })
    this.creating.add(creating)
    try {
      const path = await mkdtemp(join(this.root, 'project-open-'))
      if (this.closing) { await rm(path, { recursive: true, force: true }); throw new Error('The application is closing.') }
      const token = randomUUID(), controller = new AbortController()
      this.entries.set(token, { owner, path, controller })
      return { token, path, signal: controller.signal }
    } finally { this.creating.delete(creating); finish() }
  }
  run<T>(token: string, task: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(token)
    if (!entry || this.closing) return Promise.reject(new Error('The project open was released. Reopen the project.'))
    const result = task()
    entry.task = result.then(() => undefined, () => undefined)
    return result
  }
  async release(token: string, owner: number): Promise<void> {
    const entry = this.entries.get(token)
    if (!entry) return
    if (entry.owner !== owner) throw new Error('This project-open receipt belongs to another window.')
    entry.controller.abort()
    await entry.task
    await rm(entry.path, { recursive: true, force: true })
    this.entries.delete(token)
  }
  dispose(): Promise<void> {
    if (this.cleanup) return this.cleanup
    this.closing = true
    this.cleanup = (async () => {
      await Promise.all([...this.creating])
      const entries = [...this.entries]
      for (const [, entry] of entries) entry.controller.abort()
      const results = await Promise.allSettled(entries.map(([token, entry]) => this.release(token, entry.owner)))
      const failed = results.find(result => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    })().finally(() => { this.cleaned = true })
    return this.cleanup
  }
}
