import type { ContextIdentity, ContextSource } from './types'

interface Entry { identity: ContextIdentity; ref: string; source: ContextSource; bytes: number; expires: number }
const entries = new Map<string, Entry>()
let bytes = 0
let expiryTimer: ReturnType<typeof setTimeout> | undefined
const ceiling = 8 * 1024 * 1024

function sameScope(a: ContextIdentity, b: ContextIdentity): boolean {
  return a.chatId === b.chatId && a.projectId === b.projectId && a.workspaceEpoch === b.workspaceEpoch && a.policyRevision === b.policyRevision
}
function remove(ref: string): void {
  const entry = entries.get(ref)
  if (entry) bytes -= entry.bytes
  entries.delete(ref)
}
function expire(): void { for (const [ref, entry] of entries) if (entry.expires <= Date.now()) remove(ref) }
function scheduleExpiry(): void {
  clearTimeout(expiryTimer)
  expiryTimer = undefined
  if (!entries.size) return
  const next = Math.min(...[...entries.values()].map(entry => entry.expires))
  // Expiry must release the read closure even when the user never asks another
  // question. Read-side filtering alone kept idle raw results in memory.
  expiryTimer = setTimeout(() => { expire(); scheduleExpiry() }, Math.max(1, next - Date.now()))
}

/** Recoverable raw results are transient conversation resources, never memory
 * or bundle payloads. Opaque references survive subsequent turns in this chat
 * but are invalid after a policy change or workspace switch. */
export function cacheResult(identity: ContextIdentity, ref: string, source: ContextSource, text: string): void {
  expire()
  const size = text.length * 2
  if (size > ceiling) throw new Error('BUDGET_LIMIT: result exceeds the scoped cache limit.')
  remove(ref)
  while (entries.size >= 256 || bytes + size > ceiling) remove(entries.keys().next().value!)
  entries.set(ref, { identity: { ...identity }, ref, source, bytes: size, expires: Date.now() + 60 * 60_000 })
  bytes += size
  scheduleExpiry()
}
export function resultSources(identity: ContextIdentity): ContextSource[] {
  expire()
  return [...entries.values()].filter(entry => sameScope(identity, entry.identity)).map(entry => entry.source)
}
export function resolveResult(identity: ContextIdentity, ref: string): ContextSource | undefined {
  expire()
  const entry = entries.get(ref)
  return entry && sameScope(identity, entry.identity) ? entry.source : undefined
}
export function clearResultCache(chatId?: string): void {
  for (const [ref, entry] of entries) if (!chatId || entry.identity.chatId === chatId) remove(ref)
  scheduleExpiry()
}
