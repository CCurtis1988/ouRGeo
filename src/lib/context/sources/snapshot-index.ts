import { CompactDescriptorIndex } from '../descriptor-index'
import type { ContextSource } from '../types'
import type { DescriptorQuery } from '../descriptor-identity'

interface SnapshotPort {
  keys: () => readonly unknown[]
  sources: () => Iterable<ContextSource>
  /** Inventory refresh alone may keep the selected revision unchanged. */
  freshnessKeys?: () => readonly unknown[]
  epoch: () => number
}
const equal = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
/** Store snapshots are immutable, but a scope/runtime/privacy revision may
 * change without replacing them. Cache on both; selected reads stay live. */
export class SnapshotDescriptorIndex {
  private previous: readonly unknown[] = []
  private packed: CompactDescriptorIndex | undefined
  constructor(private port: SnapshotPort) {}
  scan(beforeRead?: () => void, query?: DescriptorQuery): Iterable<ContextSource> {
    const keys = this.port.keys(), freshness = this.port.freshnessKeys?.() ?? keys, epoch = this.port.epoch()
    if (!this.packed || !equal(keys, this.previous)) {
      this.packed = CompactDescriptorIndex.from(this.port.sources(), { read: () => '' })
      this.previous = keys
    }
    const check = (reading = false): void => {
      if (this.port.epoch() !== epoch) throw new Error('SCOPE_CHANGED: search in the active workspace.')
      if (!equal(reading ? freshness : keys, reading ? this.port.freshnessKeys?.() ?? this.port.keys() : this.port.keys())) throw new Error('STALE_REFERENCE: the runtime or disclosure snapshot changed. Search again before reading.')
    }
    const packed = this.packed.withReader({ read: async (id, revision, signal) => {
      signal?.throwIfAborted(); check(true); beforeRead?.()
      const source = Array.from(this.port.sources()).find(source => source.id === id)
      if (!source || source.revision !== revision) throw new Error('STALE_REFERENCE: the source changed. Search again before reading.')
      const text = await source.read(signal)
      signal?.throwIfAborted(); check(true)
      const current = Array.from(this.port.sources()).find(candidate => candidate.id === id)
      if (!current || current.revision !== revision) throw new Error('STALE_REFERENCE: the source changed during inspection. Search again before reading.')
      return text
    } })
    return (function* () { check(); for (const source of packed.scan(undefined, query)) { check(); yield source } check() })()
  }
}
