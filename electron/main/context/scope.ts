import { randomUUID } from 'node:crypto'

export interface WorkspaceLease { id: string; projectId: string | null }
let current: WorkspaceLease = { id: randomUUID(), projectId: null }
const listeners = new Set<() => void>()
export function subscribeContextScope(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener) }
export function contextLease(): WorkspaceLease { return { ...current } }
export function activateContextProject(projectId: string | null): void { current = { id: randomUUID(), projectId }; for (const listener of listeners) listener() }
export function requireProjectLease(projectId: string, lease: unknown): void {
  if (lease !== current.id || projectId !== current.projectId) throw new Error('SCOPE_CHANGED: reopen the active project before accessing its memory.')
}
export function closeContextProject(lease: unknown): void {
  if (lease !== current.id) throw new Error('SCOPE_CHANGED: the workspace already changed.')
  activateContextProject(null)
}
