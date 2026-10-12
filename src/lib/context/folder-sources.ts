import { CompactDescriptorIndex, materialiseDescriptor } from './descriptor-index'
import type { FolderCatalogue, FolderContextApi } from './folders'
import type { ContextSource } from './types'
import { hasColumnExclusions } from '@/store/column-disclosure'

let catalogue: FolderCatalogue = { folders: [], documents: [] }
let packed: CompactDescriptorIndex | undefined
let activeLease = ''
let generation = 0
const listeners = new Set<() => void>()
export function subscribeFolderCatalogue(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function folderCatalogueSnapshot(): FolderCatalogue { return catalogue }
export function clearFolderSources(): void { generation++; packed = undefined; activeLease = ''; catalogue = { folders: [], documents: [] }; listeners.forEach(listener => listener()) }
export async function refreshFolderSources(api: FolderContextApi, lease: string): Promise<void> {
  const attempt = ++generation
  packed = undefined
  catalogue = { folders: activeLease === lease ? catalogue.folders : [], documents: [] }
  activeLease = lease
  listeners.forEach(listener => listener())
  const result = await api.folderCatalogue(lease)
  if (attempt !== generation) return
  packed = undefined
  activeLease = lease; catalogue = result
  listeners.forEach(listener => listener())
}
/** Catalogue refreshes replace one packed metadata snapshot. Search streams
 * cards; only selected hits get reader closures. No file body enters the index. */
export function folderSourceScan(api: FolderContextApi): Iterable<ContextSource> {
  if (hasColumnExclusions()) return []
  const lease = activeLease, attempt = generation
  if (!packed) {
    const descriptors = function* (): Generator<ContextSource> {
      for (const document of catalogue.documents) yield {
        id: document.id, kind: 'document', scope: 'workspace', title: document.title,
        summary: document.summary, revision: document.revision, trust: 'untrusted', read: () => '', readRange: () => '',
      }
    }
    packed = CompactDescriptorIndex.from(descriptors(), { read: () => '' })
  }
  const check = (signal?: AbortSignal): void => {
    if (signal?.aborted || attempt !== generation || lease !== activeLease || hasColumnExclusions()) throw new Error('SCOPE_CHANGED: refresh folders in the active workspace.')
  }
  const index = packed.withReader({
    read: async (id, revision, signal) => {
      check(signal)
      const text = await api.readContextFile(id, revision, lease)
      check(signal)
      return text
    },
    readRange: async (id, revision, range, signal) => {
      check(signal)
      const text = await api.readContextFile(id, revision, lease, range)
      check(signal)
      return text
    },
  })
  return (function* () {
    check()
    for (const source of index.scan()) { check(); yield source }
  })()
}

export function folderSources(api: FolderContextApi): ContextSource[] {
  return Array.from(folderSourceScan(api), materialiseDescriptor)
}
