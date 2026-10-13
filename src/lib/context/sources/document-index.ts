import type { TabState } from '@/store/editor'
import { describeDocument } from '@/lib/ai-doc-context'
import { languageOf } from '@/lib/markdown/doc-kind'
import { CompactDescriptorIndex } from '../descriptor-index'
import type { DescriptorQuery } from '../descriptor-identity'
import { contentRevision } from '../policy'
import { readDocumentRange } from '../document-range'
import type { ContextSource } from '../types'

interface DocumentPort {
  tabs: () => readonly TabState[]
  epoch: () => number
  snapshot: (id: string) => string | null
  available?: () => boolean
}
/** Editor buffers already own the text. Retain packed descriptions rather than
 * another source object/reader closure for every tab on every broker search. */
export class DocumentDescriptorIndex {
  private previous: readonly TabState[] | undefined
  private epoch = -1
  private packed: CompactDescriptorIndex | undefined
  constructor(private port: DocumentPort) {}
  scan(query?: DescriptorQuery): Iterable<ContextSource> {
    const tabs = this.port.tabs(), epoch = this.port.epoch()
    // Visual changes can precede the editor-store flush. Such snapshots cannot
    // inherit a cached catalogue merely because the tab array stayed the same.
    if (!this.packed || tabs !== this.previous || epoch !== this.epoch || tabs.some(tab => tab.viewMode === 'visual')) {
      const snapshot = this.port.snapshot
      const descriptions = function* (): Generator<ContextSource> {
        for (const tab of tabs) {
          if (tab.type && tab.type !== 'code') continue
          const text = tab.viewMode === 'visual' ? snapshot(tab.id) : tab.content
          const summary = describeDocument(text ?? tab.content, languageOf(tab))
          yield { id: `document:${tab.id}`, kind: 'document', scope: 'workspace', title: tab.fileName,
            summary: `${tab.fileName} ${summary.headings.slice(0, 12).join(' ')} ${summary.lines} lines`,
            revision: contentRevision(text ?? tab.content), trust: 'user', read: () => '', readRange: () => '' }
        }
      }
      this.packed = CompactDescriptorIndex.from(descriptions(), { read: () => '' })
      this.previous = tabs; this.epoch = epoch
    }
    const check = (): void => {
      if (this.port.epoch() !== epoch) throw new Error('SCOPE_CHANGED: reopen the document in the active workspace.')
      if (this.port.available?.() === false) throw new Error('SOURCE_UNAVAILABLE: column privacy pauses document reads. Review disclosure settings before reading.')
    }
    const read = (id: string, revision: string, signal?: AbortSignal): string => {
      signal?.throwIfAborted(); check()
      const tab = this.port.tabs().find(tab => `document:${tab.id}` === id && (!tab.type || tab.type === 'code'))
      if (!tab) throw new Error('SOURCE_UNAVAILABLE: this document was closed.')
      const text = tab.viewMode === 'visual' ? this.port.snapshot(tab.id) : tab.content
      if (text === null) throw new Error('SOURCE_BUSY: activate this document so its editor can snapshot current Visual changes.')
      if (contentRevision(text) !== revision) throw new Error('STALE_REFERENCE: the document changed. Search again before reading.')
      return text
    }
    const packed = this.packed.withReader({ read, readRange: (id, revision, range, signal) => readDocumentRange(read(id, revision, signal), range) })
    return (function* () { check(); for (const source of packed.scan(undefined, query)) { check(); yield source } check() })()
  }
}
