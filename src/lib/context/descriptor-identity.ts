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
const classified = new WeakMap<ContextSource, { id: string; safe: boolean; title: string; summary: string; lower: number; redactionSafe: boolean }>()
export function classifyDescriptor(source: ContextSource, safe: boolean, lower = 0, redactionSafe = false): void {
  const current = classified.get(source)
  if (current) { current.id = source.id; current.safe = safe; current.title = source.title; current.summary = source.summary; current.lower = lower; current.redactionSafe = redactionSafe }
  else classified.set(source, { id: source.id, safe, title: source.title, summary: source.summary, lower, redactionSafe })
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
