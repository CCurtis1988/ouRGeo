import { describe, it, expect } from 'vitest'
import { analyzeMarkdownContext, chunkRegionAt } from './context-markdown'

const noFrames = (): boolean => false
const at = (marked: string, supportsChunks = true) => {
  const offset = marked.indexOf('|')
  return analyzeMarkdownContext(marked.replace('|', ''), offset, noFrames, supportsChunks)
}

describe('chunkRegionAt', () => {
  const doc = ['prose', '```{r setup}', 'x <- 1', '```', 'more'].join('\n')

  it('finds the body of a runnable chunk', () => {
    const inside = doc.indexOf('x <- 1') + 3
    expect(chunkRegionAt(doc, inside)).not.toBeNull()
  })

  it('returns null in prose', () => {
    expect(chunkRegionAt(doc, 2)).toBeNull()
    expect(chunkRegionAt(doc, doc.indexOf('more') + 1)).toBeNull()
  })

  it('ignores a plain ```r fence — knitr does not run those', () => {
    const plain = ['```r', 'x <- 1', '```'].join('\n')
    expect(chunkRegionAt(plain, plain.indexOf('x <- 1') + 3)).toBeNull()
  })

  it('handles an unterminated chunk at EOF', () => {
    const open = ['```{r}', 'x <- '].join('\n')
    expect(chunkRegionAt(open, open.length)).not.toBeNull()
  })

  it('handles four-backtick fences wrapping a three-backtick block', () => {
    const doc4 = ['````{r}', '```', 'nested', '```', '````', 'prose'].join('\n')
    expect(chunkRegionAt(doc4, doc4.indexOf('nested'))).not.toBeNull()
    expect(chunkRegionAt(doc4, doc4.indexOf('prose'))).toBeNull()
  })
})

describe('slash context', () => {
  it('opens at the start of a line', () => {
    expect(at('/|')).toMatchObject({ type: 'md-slash', prefix: '' })
  })

  it('captures the typed prefix', () => {
    expect(at('/tab|')).toMatchObject({ type: 'md-slash', prefix: 'tab' })
  })

  it('replaces the slash itself', () => {
    const ctx = at('text /he|') as { from: number; to: number }
    expect(ctx.from).toBe('text '.length)
    expect(ctx.to).toBe('text /he'.length)
  })

  it('opens after whitespace mid-line', () => {
    expect(at('some prose /|')).toMatchObject({ type: 'md-slash' })
  })

  it('does NOT open inside a word — a/b is a fraction, not a command', () => {
    expect(at('a/b|')).toEqual({ type: 'none' })
    expect(at('https://x.dev/pa|')).toEqual({ type: 'none' })
  })

  it('does NOT open inside a fenced block', () => {
    expect(at('```\n/|\n```')).toEqual({ type: 'none' })
  })
})

describe('R completion inside chunks', () => {
  it('delegates to the R analyzer and shifts offsets back', () => {
    const doc = 'prose\n\n```{r}\nmyvar|\n```'
    const ctx = at(doc) as { type: string; from: number; to: number }
    expect(ctx.type).toBe('identifier')
    // Offsets must be in DOCUMENT coordinates, not chunk-body coordinates.
    const plain = doc.replace('|', '')
    expect(plain.slice(ctx.from, ctx.to)).toBe('myvar')
  })

  it('offers R completion for a member expression inside a chunk', () => {
    const ctx = at('```{r}\ndf$co|\n```') as { type: string }
    expect(ctx.type).toBe('member')
  })

  it('does not treat a chunk as R in plain markdown', () => {
    // A .md file has no runnable chunks, so a fence body is not R.
    expect(at('```{r}\nmyvar|\n```', false)).toEqual({ type: 'none' })
  })

  it('does not offer the slash menu inside a chunk', () => {
    expect(at('```{r}\n/|\n```').type).not.toBe('md-slash')
  })
})
