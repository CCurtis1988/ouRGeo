import { CompactDescriptorIndex } from '../descriptor-index'
import type { ContextSource } from '../types'

interface SnapshotPort {
  keys: () => readonly unknown[]
  sources: () => Iterable<ContextSource>
  epoch: () => number
}
const equal = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
/** Store snapshots are immutable, but a scope/runtime/privacy revision may
 * change without replacing them. Cache on both; selected reads stay live. */
export class SnapshotDescriptorIndex {
  private previous: readonly unknown[] = []
  private packed: CompactDescriptorIndex | undefined
  constructor(private port: SnapshotPort) {}
  scan(beforeRead?: () => void): Iterable<ContextSource> {
    const keys = this.port.keys(), epoch = this.port.epoch()
    if (!this.packed || !equal(keys, this.previous)) {
      this.packed = CompactDescriptorIndex.from(this.port.sources(), { read: () => '' })
      this.previous = keys
    }
    const check = (): void => {
      if (this.port.epoch() !== epoch) throw new Error('SCOPE_CHANGED: search in the active workspace.')
      if (!equal(keys, this.port.keys())) throw new Error('STALE_REFERENCE: the runtime or disclosure snapshot changed. Search again before reading.')
    }
    const packed = this.packed.withReader({ read: async (id, revision, signal) => {
      signal?.throwIfAborted(); check(); beforeRead?.()
      const source = Array.from(this.port.sources()).find(source => source.id === id)
      if (!source || source.revision !== revision) throw new Error('STALE_REFERENCE: the source changed. Search again before reading.')
      const text = await source.read(signal)
      signal?.throwIfAborted(); check()
      return text
    } })
    return (function* () { for (const source of packed.scan()) { check(); yield source } })()
  }
}
