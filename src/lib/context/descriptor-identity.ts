import { redactContext } from './policy'
import type { ContextSource } from './types'

export function safeDescriptorId(id: string): boolean {
  try {
    const decoded = id.includes('%') ? decodeURIComponent(id) : id
    // Cache the complete identity verdict, including encoded control characters,
    // so broad native browsing need not decode/check each packed ID again.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(decoded)) return false
    return id.length <= 8192 && redactContext(id) === id && (decoded === id || redactContext(decoded) === decoded)
  } catch { return false }
}

// A packed scan reuses a single card. Its host-classified identity is recorded
// out of band, so provider metadata cannot forge a trusted flag. The ID check
// prevents a mutated materialised card from inheriting another ID's verdict.
const classified = new WeakMap<ContextSource, { id: string; safe: boolean; title: string; summary: string; lower: number; redactionSafe: boolean; resourceName: string | undefined; lexical: Uint32Array | undefined; offset: number }>()
export interface DescriptorQuery { text: string; words: Uint32Array[] | undefined; semantic: Set<string> }
export function classifyDescriptor(source: ContextSource, safe: boolean, lower = 0, redactionSafe = false, lexical?: Uint32Array, offset = 0): void {
  const current = classified.get(source)
  if (current) { current.id = source.id; current.safe = safe; current.title = source.title; current.summary = source.summary; current.lower = lower; current.redactionSafe = redactionSafe; current.resourceName = source.resource?.name; current.lexical = lexical; current.offset = offset }
  else classified.set(source, { id: source.id, safe, title: source.title, summary: source.summary, lower, redactionSafe, resourceName: source.resource?.name, lexical, offset })
}
export function descriptorIdentity(source: ContextSource): boolean | undefined {
  const result = classified.get(source)
  return result?.id === source.id ? result.safe : undefined
}

export function descriptorLowerCase(source: ContextSource): number {
  const result = classified.get(source)
  return result?.title === source.title && result.summary === source.summary ? result.lower : 0
}

/** Only unchanged, host-classified metadata may skip repeated redaction. A
 * provider field or a later edit cannot grant itself this cached verdict. */
export function descriptorRedactionSafe(source: ContextSource): boolean {
  const result = classified.get(source)
  return !!result && result.id === source.id && result.title === source.title && result.summary === source.summary && result.redactionSafe
}

/** A 128-bit trigram filter can reject impossible substring matches. Collisions
 * only retain extra candidates; they never confer rank, identity or permission.
 * Unicode and short words use ordinary ranking rather than risk normalisation
 * or partial-name false negatives. Bodies are never indexed by this filter. */
export function descriptorLexicalSignature(text: string): Uint32Array {
  const result = new Uint32Array(4)
  if (/[\u0080-\uffff]/.test(text)) { result.fill(0xffffffff); return result }
  const lower = text.toLowerCase()
  for (let index = 2; index < lower.length; index++) {
    const hash = Math.imul(lower.charCodeAt(index - 2), 73856093) ^ Math.imul(lower.charCodeAt(index - 1), 19349663) ^ Math.imul(lower.charCodeAt(index), 83492791)
    // Mix high bits too: ASCII triples otherwise cluster into a few low bits.
    const bit = (hash ^ hash >>> 16) & 127
    result[bit >>> 5] |= 1 << (bit & 31)
  }
  return result
}

export function descriptorMayMatch(source: ContextSource, words: Uint32Array[] | undefined): boolean {
  if (!words) return true
  const cached = classified.get(source)
  if (!cached?.lexical || cached.id !== source.id || cached.title !== source.title || cached.summary !== source.summary || cached.resourceName !== source.resource?.name) return true
  return descriptorSignatureMatches(cached.lexical, cached.offset, words)
}

export function descriptorSignatureMatches(lexical: Uint32Array, offset: number, words: Uint32Array[]): boolean {
  for (const word of words) if (((lexical[offset] & word[0]) >>> 0) === word[0] && ((lexical[offset + 1] & word[1]) >>> 0) === word[1]
    && ((lexical[offset + 2] & word[2]) >>> 0) === word[2] && ((lexical[offset + 3] & word[3]) >>> 0) === word[3]) return true
  return false
}
