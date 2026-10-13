import { classifyDescriptor, descriptorIdentity, descriptorLowerCase, descriptorRedactionSafe, descriptorLexicalSignature, descriptorSignatureMatches, safeDescriptorId, type DescriptorQuery } from './descriptor-identity'
import { redactContext } from './policy'
import type { ContextKind, ContextScope, ContextSource, DocumentRange } from './types'

const KINDS: ContextKind[] = ['skill', 'action', 'environment', 'console', 'document', 'conversation', 'memory', 'result']
const SCOPES: ContextScope[] = ['conversation', 'project', 'global', 'application', 'workspace']
const TRUST: ContextSource['trust'][] = ['host', 'user', 'observed', 'untrusted']
const FIELDS = 7
const SAFE_ID = 1 << 10
const SAFE_METADATA = 1 << 14
const ASCII_SUMMARY = 1 << 15
const EMPTY_EXTRA = Object.freeze({ resource: undefined, group: undefined, legacyIds: undefined })
const field = (segment: Segment, base: number, index: number): string => segment.text.slice(segment.offsets[base + index], segment.offsets[base + index + 1])
interface Segment { text: string; offsets: Uint32Array; codes: Uint16Array; lexical: Uint32Array }
export interface DescriptorReader {
  read: (id: string, revision: string, signal?: AbortSignal) => Promise<string> | string
  readRange?: (id: string, revision: string, range: DocumentRange, signal?: AbortSignal) => Promise<string> | string
}

const EPHEMERAL_DESCRIPTOR = Symbol('ephemeral-descriptor')
// Reader accessors live on the prototype so scan cards keep fast data fields;
// putting accessors on each object makes every metadata write a dictionary write.
class ScanCard implements ContextSource {
  readonly [EPHEMERAL_DESCRIPTOR] = true
  id = ''; kind: ContextKind = 'skill'; scope: ContextScope = 'application'; trust: ContextSource['trust'] = 'host'
  title = ''; summary = ''; revision = ''
  timestamp: string | undefined; prerequisites: string | undefined
  resource: ContextSource['resource']; group: string | undefined; legacyIds: string[] | undefined
  ranged = false
  constructor(private reader: DescriptorReader) {}
  get read(): ContextSource['read'] {
    const id = this.id, revision = this.revision, reader = this.reader
    return signal => reader.read(id, revision, signal)
  }
  get readRange(): ContextSource['readRange'] {
    if (!this.ranged || !this.reader.readRange) return undefined
    const id = this.id, revision = this.revision, reader = this.reader
    return (range, signal) => reader.readRange!(id, revision, range, signal)
  }
}
export function materialiseDescriptor(source: ContextSource): ContextSource {
  if (!(source as ContextSource & { [EPHEMERAL_DESCRIPTOR]?: true })[EPHEMERAL_DESCRIPTOR]) return source
  const { id, kind, scope, trust, title, summary, revision, timestamp, prerequisites, resource, group, legacyIds, read, readRange } = source
  const result = { id, kind, scope, trust, title, summary, revision, ...(timestamp ? { timestamp } : {}), ...(prerequisites ? { prerequisites } : {}), ...(resource ? { resource } : {}), ...(group ? { group } : {}), ...(legacyIds ? { legacyIds } : {}), read, ...(readRange ? { readRange } : {}) }
  const safe = descriptorIdentity(source)
  if (safe !== undefined) classifyDescriptor(result, safe, descriptorLowerCase(source), descriptorRedactionSafe(source), descriptorLexicalSignature(`${result.title}\n${result.summary}\n${result.resource?.name ?? ''}`))
  return result
}
/** Immutable metadata snapshots use packed text/offsets rather than one retained
 * object, closure and string array per descriptor. Readers stay host-owned and
 * revalidate scope/revision; this index never stores or invokes source bodies.
 * Build incrementally from a source iterator, then replace the snapshot atomically.
 * Strings remain UTF-16 so decoding a candidate needs no embedding/native runtime. */
export class CompactDescriptorIndex {
  readonly count: number
  readonly estimatedBytes: number
  private constructor(private segments: Segment[], private reader: DescriptorReader, count: number, bytes: number) { this.count = count; this.estimatedBytes = bytes }
  static from(sources: Iterable<ContextSource>, reader: DescriptorReader, maxBytes = 250 * 1024 * 1024): CompactDescriptorIndex {
    const segments: Segment[] = []
    let texts: string[] = [], offsets: number[] = [0], codes: number[] = [], lexical: number[] = [], chars = 0, count = 0, bytes = 0
    const flush = (): void => {
      if (!codes.length) return
      const segment = { text: texts.join(''), offsets: Uint32Array.from(offsets), codes: Uint16Array.from(codes), lexical: Uint32Array.from(lexical) }
      bytes += segment.text.length * 2 + segment.offsets.byteLength + segment.codes.byteLength + segment.lexical.byteLength
      if (bytes > maxBytes) throw new Error('BUDGET_LIMIT: descriptor index exceeds the derived-cache limit. Select fewer sources or increase the local cache setting.')
      segments.push(segment); texts = []; offsets = [0]; codes = []; lexical = []; chars = 0
    }
    for (const source of sources) {
      const kind = KINDS.indexOf(source.kind), scope = SCOPES.indexOf(source.scope), trust = TRUST.indexOf(source.trust)
      if (kind < 0 || scope < 0 || trust < 0 || source.id.length > 8192 || source.title.length > 8192 || source.summary.length > 16384 || source.revision.length > 128 || (source.timestamp?.length ?? 0) > 128 || (source.prerequisites?.length ?? 0) > 8192 || (source.legacyIds?.length ?? 0) > 64) throw new Error('BUDGET_LIMIT: a descriptor exceeds the local index bounds. Shorten its metadata before indexing.')
      const extra = source.resource || source.group || source.legacyIds?.length ? JSON.stringify({ ...(source.resource ? { resource: source.resource } : {}), ...(source.group ? { group: source.group } : {}), ...(source.legacyIds?.length ? { legacyIds: source.legacyIds } : {}) }) : ''
      if (extra.length > 16384) throw new Error('BUDGET_LIMIT: source identity metadata exceeds the local index bound.')
      for (const text of [source.id, source.title, source.summary, source.revision, source.timestamp ?? '', source.prerequisites ?? '', extra]) { texts.push(text); chars += text.length; offsets.push(chars) }
      codes.push(kind | scope << 4 | trust << 8 | (safeDescriptorId(source.id) ? SAFE_ID : 0) | (source.title.toLowerCase() === source.title ? 1 << 11 : 0) | (source.summary.toLowerCase() === source.summary ? 1 << 12 : 0) | (source.readRange ? 1 << 13 : 0) | (redactContext(source.title) === source.title && redactContext(source.summary) === source.summary ? SAFE_METADATA : 0) | (!/[\u0080-\uffff]/.test(source.summary) ? ASCII_SUMMARY : 0)); count++
      lexical.push(...descriptorLexicalSignature(`${source.title}\n${source.summary}\n${source.resource?.name ?? ''}`))
      if (count > 1_000_000) throw new Error('BUDGET_LIMIT: the descriptor index contains too many sources.')
      if (codes.length >= 1024 || chars >= 262144) flush()
    }
    flush()
    return new CompactDescriptorIndex(segments, reader, count, bytes)
  }
  withReader(reader: DescriptorReader): CompactDescriptorIndex { return new CompactDescriptorIndex(this.segments, reader, this.count, this.estimatedBytes) }
  *sources(kinds?: ContextKind[]): Generator<ContextSource> { for (const source of this.scan(kinds)) yield materialiseDescriptor(source) }
  /** Internal scans reuse one card. Rank/broker snapshots every retained match. */
  *scan(kinds?: ContextKind[], query?: DescriptorQuery): Generator<ContextSource> {
    const card = new ScanCard(this.reader)
    const allowed = kinds ? new Set(kinds) : null
    for (const segment of this.segments) {
      for (let row = 0; row < segment.codes.length; row++) {
        const code = segment.codes[row], kind = KINDS[code & 15]
        if (allowed && !allowed.has(kind)) continue
        const base = row * FIELDS
        // Skip impossible metadata before decoding the whole scan card. Partial
        // titles and provider-ranked IDs still take the ordinary ranking path.
        if (query?.words && (code & SAFE_METADATA) && !descriptorSignatureMatches(segment.lexical, row * 4, query.words) && !query.semantic.has(field(segment, base, 0))) {
          const title = field(segment, base, 1).toLowerCase()
          if (!title || !query.text.includes(title)) continue
        }
        const id = field(segment, base, 0), revision = field(segment, base, 3), timestamp = field(segment, base, 4), prerequisites = field(segment, base, 5), extraText = field(segment, base, 6)
        const extra = extraText ? JSON.parse(extraText) as Pick<ContextSource, 'resource' | 'group' | 'legacyIds'> : EMPTY_EXTRA
        card.id = id; card.kind = kind; card.scope = SCOPES[code >> 4 & 15]; card.trust = TRUST[code >> 8 & 3]
        card.title = field(segment, base, 1); card.summary = field(segment, base, 2); card.revision = revision
        card.timestamp = timestamp || undefined; card.prerequisites = prerequisites || undefined
        card.resource = extra.resource; card.group = extra.group; card.legacyIds = extra.legacyIds; card.ranged = !!(code & 1 << 13)
        classifyDescriptor(card, !!(code & SAFE_ID), (code >> 11 & 3) | (code & ASCII_SUMMARY ? 4 : 0), !!(code & SAFE_METADATA), segment.lexical, row * 4)
        yield card
      }
    }
  }
}
