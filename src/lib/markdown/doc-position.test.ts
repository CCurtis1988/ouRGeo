import { describe, it, expect } from 'vitest'
import {
  anchorFromSource, sourceOffsetFromAnchor, countSignificant, advanceSignificant,
} from './doc-position'

const DOC = [
  '# Title',                       // block 0
  '',
  'First paragraph of prose.',     // block 1
  '',
  '```{r setup, echo=FALSE}',      // block 2
  'x <- c(1, 2, 3)',
  '```',
  '',
  'Closing paragraph.',            // block 3
  '',
].join('\n')

/** Offset of the first occurrence of `needle`, for readable expectations. */
function at(needle: string, doc = DOC): number {
  const i = doc.indexOf(needle)
  if (i === -1) throw new Error(`not in fixture: ${needle}`)
  return i
}

describe('countSignificant / advanceSignificant', () => {
  it('counts only the characters markdown syntax never adds', () => {
    expect(countSignificant('**bold**')).toBe(4)
    expect(countSignificant('[text](http://x)')).toBe(9) // text + http + x
  })

  it('advances past exactly that many', () => {
    expect(advanceSignificant('**bold** rest', 4)).toBe(6) // just past the `d`
    expect(advanceSignificant('abc', 0)).toBe(0)
    expect(advanceSignificant('abc', 99)).toBe(3)
  })
})

describe('anchorFromSource', () => {
  it('measures a heading from past its hashes', () => {
    expect(anchorFromSource(DOC, at('Title'))).toEqual({ block: 0, chars: 0 })
  })

  it('identifies the block the caret is in', () => {
    expect(anchorFromSource(DOC, at('Title')).block).toBe(0)
    expect(anchorFromSource(DOC, at('First')).block).toBe(1)
    expect(anchorFromSource(DOC, at('x <- c')).block).toBe(2)
    expect(anchorFromSource(DOC, at('Closing')).block).toBe(3)
  })

  it('measures from the chunk BODY, not the fence', () => {
    // The header line is not shown in Visual mode, so counting from the node's
    // start would push every anchor inside a chunk down by its length.
    const a = anchorFromSource(DOC, at('c(1, 2, 3)'))
    expect(a).toEqual({ block: 2, chars: 1 }) // just the `x`
  })

  it('puts a caret in the blank line between blocks on the one above', () => {
    const blank = at('First') - 1
    expect(anchorFromSource(DOC, blank).block).toBe(0)
  })

  it('handles an empty document', () => {
    expect(anchorFromSource('', 0)).toEqual({ block: 0, chars: 0 })
  })
})

describe('round trip through an anchor', () => {
  it('returns to the same word in unchanged text', () => {
    // The anchor counts alphanumerics, so it resolves to just past the last one
    // before the caret: never further on than the caret, and never back past a
    // letter or digit. That is the whole guarantee — same word, not same byte.
    for (const needle of ['Title', 'paragraph of prose', 'c(1, 2, 3)', 'Closing']) {
      const offset = at(needle)
      const back = sourceOffsetFromAnchor(DOC, anchorFromSource(DOC, offset))
      expect(back).toBeLessThanOrEqual(offset)
      expect(DOC.slice(back, offset)).not.toMatch(/[A-Za-z0-9]/)
    }
  })

  it('survives the formatting the serializer normalises', () => {
    // Same document, different markers — which is exactly what a Visual round
    // trip produces. The anchor must still land in the right paragraph.
    const before = 'para one\n\n* a\n* b\n\nfinal words here\n'
    const after = 'para one\n\n- a\n- b\n\nfinal words here\n'
    const anchor = anchorFromSource(before, before.indexOf('final'))
    const offset = sourceOffsetFromAnchor(after, anchor)
    expect(after.slice(offset).trimStart().startsWith('final')).toBe(true)
  })

  it('clamps a block index past the end of a shortened document', () => {
    const offset = sourceOffsetFromAnchor('only one block\n', { block: 9, chars: 4 })
    expect(offset).toBeGreaterThanOrEqual(0)
    expect(offset).toBeLessThanOrEqual('only one block\n'.length)
  })
})
