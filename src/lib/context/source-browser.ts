import type { ContextSource } from './types'
import { rankSourcePage } from './rank'
import { redactContext } from './policy'
import { descriptorIdentity, descriptorRedactionSafe, safeDescriptorId, type DescriptorQuery } from './descriptor-identity'
import { materialiseDescriptor } from './descriptor-index'

export interface SourceBrowserCard { id: string; title: string; summary: string; kind: ContextSource['kind']; scope: ContextSource['scope']; revision: string; state: 'available' | 'excluded'; reason: string }

/** Discovery cards never call source readers or retain bodies. Excluded sources
 * remain identifiable locally so the user can correct their privacy choices. */
export function sourceBrowserPage(query: string, sources: (filter?: DescriptorQuery) => Iterable<ContextSource>, excluded: string[], start = 0, state: 'all' | 'available' | 'excluded' = 'all'): { cards: SourceBrowserCard[]; total: number } {
  const denied = new Set(excluded)
  const isExcluded = (source: ContextSource): boolean => denied.has(source.id) || !!source.legacyIds?.some(id => denied.has(id))
  const safeIdentity = (source: ContextSource): boolean => descriptorIdentity(source) ?? safeDescriptorId(source.id)
  const eligible = (source: ContextSource): boolean => safeIdentity(source) && source.revision.length <= 128 && source.title.length <= 8192 && source.summary.length <= 8192
    && (state === 'all' || isExcluded(source) === (state === 'excluded'))
  const bounded = function* (filter?: DescriptorQuery): Iterable<ContextSource> {
    for (const source of sources(filter)) {
      if (!eligible(source)) continue
      // Broad browsing used to materialise and redact every descriptor on every
      // keystroke. Packed snapshots retain ten ranked cards and revalidate edits.
      if (descriptorRedactionSafe(source) && source.title.length <= 160 && source.summary.length <= 600) yield source
      else yield { ...materialiseDescriptor(source), title: redactContext(source.title).slice(0, 160), summary: redactContext(source.summary).slice(0, 600) }
    }
  }
  const page = rankSourcePage(query.slice(0, 300), bounded, start, 10)
  return { total: page.total, cards: page.hits.map(({ source, reason }) => ({ id: source.id, title: source.title, summary: source.summary, kind: source.kind, scope: source.scope, revision: source.revision, state: isExcluded(source) ? 'excluded' : 'available', reason: isExcluded(source) ? 'Excluded by current local privacy settings; not available for retrieval.' : reason })) }
}
