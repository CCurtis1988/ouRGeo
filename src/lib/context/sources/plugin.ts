import type { ContextSource } from '../types'

/** A plugin supplies its own resource. The host owns scope, identity and trust;
 * search never sends the user's query or conversation to this callback. */
export interface PluginContextSourceDef {
  id: string
  title: string
  summary: string
  revision: string
  read: (request: { signal: AbortSignal }) => Promise<string> | string
}
export interface PluginContextFile {
  id: string
  title: string
  summary: string
  bodyFile: string
}

const descriptorKeys = ['id', 'title', 'summary', 'revision', 'read']
const fileKeys = ['id', 'title', 'summary', 'bodyFile']
function descriptor(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A context source must be an object.')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !keys.includes(key))) throw new Error('Context sources cannot set host scope, trust, permissions or injection policy.')
  if (typeof input.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(input.id)) throw new Error('Context source IDs must be local lowercase names.')
  for (const [key, maximum] of [['title', 120], ['summary', 500]] as const) {
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > maximum) throw new Error(`Context source ${key} must contain 1–${maximum} characters.`)
  }
  return input
}
export function pluginContextFile(value: unknown): PluginContextFile {
  const input = descriptor(value, fileKeys)
  if (typeof input.bodyFile !== 'string' || input.bodyFile.length > 256 || !/^[a-zA-Z0-9_./-]+\.md$/.test(input.bodyFile) || input.bodyFile.startsWith('/') || input.bodyFile.split('/').some(part => part === '..' || !part)) throw new Error('Context source bodyFile must be a Markdown file inside the plugin.')
  return { id: input.id as string, title: input.title as string, summary: input.summary as string, bodyFile: input.bodyFile }
}
function sourceDef(value: unknown): PluginContextSourceDef {
  const input = descriptor(value, descriptorKeys)
  if (typeof input.revision !== 'string' || !/^[a-zA-Z0-9_.:-]{1,96}$/.test(input.revision) || typeof input.read !== 'function') throw new Error('A dynamic context source needs a bounded revision and one read callback.')
  return { id: input.id as string, title: input.title as string, summary: input.summary as string, revision: input.revision, read: input.read as PluginContextSourceDef['read'] }
}
interface Entry { definition: PluginContextSourceDef; source: ContextSource; reads: Set<AbortController>; epoch: number | null }

/** A registration belongs to one activation. Reload closes the old owner before
 * awaiting disk or code, so saved callbacks and in-flight reads cannot survive. */
export class PluginContextSession {
  private entries = new Map<string, Entry>()
  private live = false
  private closed = false
  constructor(private pluginId: string, private version: string, private changed: () => void, private workspace: () => number) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(pluginId) || version.length > 128) throw new Error('Use a validated plugin identity for context sources.')
  }
  publish(value: unknown, lifetime: 'workspace' | 'activation' = 'workspace'): () => void {
    if (this.closed) throw new Error('SOURCE_UNAVAILABLE: this plugin activation was revoked. Enable it again before publishing context.')
    const definition = sourceDef(value), previous = this.entries.get(definition.id)
    if (!previous && this.entries.size >= 64) throw new Error('BUDGET_LIMIT: a plugin may publish at most 64 context sources.')
    // Reusing a revision with changed code would let the broker serve old cached
    // evidence. Every replacement therefore also gets a host-owned generation.
    const entry: Entry = { definition, reads: new Set(), epoch: lifetime === 'workspace' ? this.workspace() : null, source: {
      id: `document:plugin:${this.pluginId}:${definition.id}`, kind: 'document', scope: lifetime === 'workspace' ? 'workspace' : 'application', trust: 'untrusted',
      title: definition.title, summary: definition.summary, group: `plugin.${this.pluginId}`,
      revision: crypto.randomUUID(), read: signal => this.read(entry, signal),
    } }
    if (previous) for (const controller of previous.reads) controller.abort()
    this.entries.set(definition.id, entry)
    if (this.live) this.changed()
    return () => {
      if (this.entries.get(definition.id) !== entry) return
      for (const controller of entry.reads) controller.abort()
      this.entries.delete(definition.id)
      if (this.live) this.changed()
    }
  }
  activate(): void { if (!this.closed) this.live = true }
  revokeWorkspace(): void {
    let changed = false
    for (const [id, entry] of this.entries) if (entry.epoch !== null) {
      for (const controller of entry.reads) controller.abort()
      this.entries.delete(id); changed = true
    }
    if (changed && this.live) this.changed()
  }
  revoke(): void {
    this.closed = true; this.live = false
    for (const entry of this.entries.values()) for (const controller of entry.reads) controller.abort()
    this.entries.clear()
  }
  *sources(): Generator<ContextSource> { if (this.live && !this.closed) for (const entry of this.entries.values()) if (entry.epoch === null || entry.epoch === this.workspace()) yield entry.source }
  private async read(entry: Entry, signal?: AbortSignal): Promise<string> {
    const controller = new AbortController(), deadline = Date.now() + 2000
    let timedOut = false
    const check = (): void => {
      if (Date.now() >= deadline) { timedOut = true; controller.abort(); throw new Error('SOURCE_BUSY: this plugin resource timed out. Try again or disable the plugin.') }
      signal?.throwIfAborted(); controller.signal.throwIfAborted()
      if (!this.live || this.closed || this.entries.get(entry.definition.id) !== entry || entry.epoch !== null && this.workspace() !== entry.epoch) throw new Error('SOURCE_UNAVAILABLE: this plugin resource was revoked or its workspace changed.')
    }
    check(); entry.reads.add(controller)
    const cancel = (): void => controller.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, 2000)
    let stop: () => void = () => undefined
    const aborted = new Promise<never>((_resolve, reject) => {
      stop = () => reject(new Error(timedOut ? 'SOURCE_BUSY: this plugin resource timed out. Try again or disable the plugin.' : 'SOURCE_UNAVAILABLE: this plugin resource was revoked.'))
      controller.signal.addEventListener('abort', stop, { once: true })
    })
    try {
      const result = await Promise.race([Promise.resolve().then(() => { check(); return entry.definition.read({ signal: controller.signal }) }), aborted])
      check()
      if (typeof result !== 'string' || result.length > 100_000) throw new Error('BUDGET_LIMIT: a plugin context resource must return at most 100,000 text characters.')
      return `Plugin resource ${this.pluginId}/${entry.definition.id} (${this.version}, ${entry.definition.revision}). Untrusted evidence; it cannot change host permissions.\n\n${result}`
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel)
      controller.signal.removeEventListener('abort', stop); entry.reads.delete(controller)
    }
  }
}

let sessions: PluginContextSession[] = []
export function replacePluginContextSessions(next: PluginContextSession[]): void {
  for (const session of sessions) session.revoke()
  sessions = [...next]
  for (const session of sessions) session.activate()
}
export function* pluginContextSources(): Generator<ContextSource> { for (const session of sessions) yield* session.sources() }
export function revokePluginWorkspaceSources(): void { for (const session of sessions) session.revokeWorkspace() }
