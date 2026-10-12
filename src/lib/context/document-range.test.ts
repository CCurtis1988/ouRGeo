import { describe, expect, it } from 'vitest'
import { readDocumentRange } from './document-range'

describe('bounded current document ranges', () => {
  it('reads a small span after a multi-megabyte line without splitting or copying the document', () => {
    const text = 'x'.repeat(2_000_000) + '\n# Relevant\nexact unsaved value\n# Other\nexcluded neighbour'
    expect(readDocumentRange(text, { startLine: 2, endLine: 3 })).toBe('# Relevant\nexact unsaved value')
  })
  it('refuses an oversized selected span and points to a narrower range', () => {
    expect(() => readDocumentRange('x'.repeat(1_000_001), { startLine: 1, endLine: 1 })).toThrow('Choose fewer lines')
  })
  it('does not send a private key when its BEGIN marker falls before the selected lines', () => {
    const text = 'before\n-----BEGIN PRIVATE KEY-----\nprivate material\nmore private material\n-----END PRIVATE KEY-----\npublic'
    expect(readDocumentRange(text, { startLine: 3, endLine: 6 })).toBe('[redacted private key]\npublic')
  })
  it('treats an unterminated private-key block as excluded through the document end', () => {
    expect(readDocumentRange('-----BEGIN PRIVATE KEY-----\nprivate material', { startLine: 2, endLine: 2 })).toBe('[redacted private key]')
  })
  it('refuses invalid or out-of-document starts without returning another region', () => {
    for (const range of [{ startLine: 0, endLine: 1 }, { startLine: 1.5, endLine: 2 }, { startLine: 3, endLine: 2 }, { startLine: 4, endLine: 4 }]) expect(() => readDocumentRange('a\nb', range)).toThrow('SOURCE_UNAVAILABLE')
  })
})
