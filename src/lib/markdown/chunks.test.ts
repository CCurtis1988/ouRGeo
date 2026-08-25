import { describe, it, expect } from 'vitest'
import { scanChunks, parseChunkHeader, splitOptions, chunkAtLine, runnableChunks } from './chunks'
import { reconcileChunks, toPrev, type PrevChunk } from './chunk-identity'

describe('splitOptions', () => {
  it('splits on top-level commas', () => {
    expect(splitOptions('label, echo=FALSE, fig.width=7'))
      .toEqual(['label', 'echo=FALSE', 'fig.width=7'])
  })

  it('does not split inside a quoted string', () => {
    // fig.cap = paste("a, b") must survive — a naive comma split corrupts it.
    expect(splitOptions('fig.cap = "a, b", echo=FALSE'))
      .toEqual(['fig.cap = "a, b"', 'echo=FALSE'])
  })

  it('does not split inside parentheses', () => {
    expect(splitOptions('fig.cap = paste("a", "b"), echo=TRUE'))
      .toEqual(['fig.cap = paste("a", "b")', 'echo=TRUE'])
  })
})

describe('parseChunkHeader', () => {
  it('reads engine, label and options', () => {
    const h = parseChunkHeader('{r buffer, echo=FALSE, fig.width=7}')!
    expect(h.engine).toBe('r')
    expect(h.label).toBe('buffer')
    expect(h.options).toEqual({ echo: 'FALSE', 'fig.width': '7' })
  })

  it('handles a chunk with no label', () => {
    const h = parseChunkHeader('{r, echo=FALSE}')!
    expect(h.label).toBeNull()
    expect(h.options.echo).toBe('FALSE')
  })

  it('handles a bare engine', () => {
    const h = parseChunkHeader('{r}')!
    expect(h).toMatchObject({ engine: 'r', label: null })
  })

  it('recognises other engines', () => {
    expect(parseChunkHeader('{python}')!.engine).toBe('python')
    expect(parseChunkHeader('{sql connection=db}')!.engine).toBe('sql')
  })

  it('rejects a plain fence', () => {
    expect(parseChunkHeader('r')).toBeNull()
    expect(parseChunkHeader('')).toBeNull()
  })
})

describe('scanChunks', () => {
  const doc = [
    '# Title', '',            // 1,2
    '```{r setup}',           // 3
    'library(sf)',            // 4
    '```',                    // 5
    '', 'prose', '',          // 6,7,8
    '```{r plot, fig.width=7}',  // 9
    'plot(1)',                // 10
    '```',                    // 11
  ].join('\n')

  it('finds every chunk with correct line ranges', () => {
    const c = scanChunks(doc)
    expect(c).toHaveLength(2)
    expect(c[0]).toMatchObject({ startLine: 3, endLine: 5, codeStartLine: 4, codeEndLine: 4 })
    expect(c[0].code).toBe('library(sf)')
    expect(c[1]).toMatchObject({ startLine: 9, endLine: 11 })
    expect(c[1].header.label).toBe('plot')
  })

  it('marks a plain ```r fence as not runnable', () => {
    const c = scanChunks('```r\nx <- 1\n```')
    expect(c).toHaveLength(1)
    expect(c[0].runnable).toBe(false)
  })

  it('marks non-R engines as not runnable', () => {
    expect(scanChunks('```{python}\nx=1\n```')[0].runnable).toBe(false)
  })

  it('handles an unterminated fence at EOF', () => {
    const c = scanChunks('```{r}\nx <- ')
    expect(c[0].unterminated).toBe(true)
    expect(runnableChunks(c)).toHaveLength(0) // never run a half-typed chunk
  })

  it('handles four-backtick fences wrapping a three-backtick block', () => {
    const c = scanChunks('````{r}\n```\ninner\n```\n````')
    expect(c).toHaveLength(1)
    expect(c[0].code).toBe('```\ninner\n```')
  })

  it('handles tilde fences', () => {
    const c = scanChunks('~~~{r}\nx <- 1\n~~~')
    expect(c).toHaveLength(1)
    expect(c[0].code).toBe('x <- 1')
  })

  it('does not close a backtick fence with a tilde fence', () => {
    const c = scanChunks('```{r}\n~~~\nstill inside\n```')
    expect(c).toHaveLength(1)
    expect(c[0].code).toContain('still inside')
  })

  it('handles a fence indented inside a list item', () => {
    const c = scanChunks('- item\n\n  ```{r}\n  x <- 1\n  ```\n')
    expect(c).toHaveLength(1)
    expect(c[0].runnable).toBe(true)
  })

  it('handles an empty chunk body', () => {
    const c = scanChunks('```{r}\n```')
    expect(c[0].code).toBe('')
  })

  it('locates the chunk at a line', () => {
    const c = scanChunks(doc)
    expect(chunkAtLine(c, 4)?.header.label).toBe('setup')
    expect(chunkAtLine(c, 7)).toBeUndefined() // prose
  })
})

// ── Identity: the highest-value tests in this file ──────────────────────────
describe('reconcileChunks', () => {
  const scanWithIds = (text: string, prev: PrevChunk[] = []) =>
    reconcileChunks(prev, scanChunks(text))

  const threeLabelled = [
    '```{r chunk-1}', 'a', '```', '',
    '```{r chunk-2}', 'b', '```', '',
    '```{r chunk-3}', 'c', '```',
  ].join('\n')

  it('keeps every id when a chunk body is edited, and marks it stale', () => {
    const first = scanWithIds(threeLabelled)
    const edited = threeLabelled.replace('\nb\n', '\nb2\n')
    const second = scanWithIds(edited, toPrev(first))
    expect(second.map((c) => c.id)).toEqual(first.map((c) => c.id))
    // The edited chunk is stale; the others are untouched.
    expect(second.map((c) => c.codeChanged)).toEqual([false, true, false])
  })

  it('keeps ids when a chunk is inserted above', () => {
    const first = scanWithIds(threeLabelled)
    const withNew = '```{r chunk-0}\nz\n```\n\n' + threeLabelled
    const second = scanWithIds(withNew, toPrev(first))
    for (const id of first.map((c) => c.id)) {
      expect(second.map((c) => c.id)).toContain(id)
    }
    expect(second).toHaveLength(4)
  })

  it('keeps ids when a chunk is deleted', () => {
    const first = scanWithIds(threeLabelled)
    const without = threeLabelled.replace('```{r chunk-2}\nb\n```\n\n', '')
    const second = scanWithIds(without, toPrev(first))
    expect(second.map((c) => c.id)).toEqual([first[0].id, first[2].id])
  })

  it('follows labels when chunks are reordered', () => {
    const first = scanWithIds(threeLabelled)
    const swapped = [
      '```{r chunk-3}', 'c', '```', '',
      '```{r chunk-2}', 'b', '```', '',
      '```{r chunk-1}', 'a', '```',
    ].join('\n')
    const second = scanWithIds(swapped, toPrev(first))
    expect(second.map((c) => c.id)).toEqual([first[2].id, first[1].id, first[0].id])
  })

  it('treats a renamed label as a new chunk — the label IS the identity', () => {
    const first = scanWithIds(threeLabelled)
    const renamed = threeLabelled.replace('chunk-2', 'buffer')
    const second = scanWithIds(renamed, toPrev(first))
    expect(second[1].id).not.toBe(first[1].id)
  })

  it('keeps every id when text outside the chunks changes', () => {
    const first = scanWithIds(threeLabelled)
    const second = scanWithIds('# New heading\n\n' + threeLabelled, toPrev(first))
    expect(second.map((c) => c.id)).toEqual(first.map((c) => c.id))
    expect(second.every((c) => !c.codeChanged)).toBe(true)
  })

  it('preserves an unlabelled chunk id while its body is edited', () => {
    const doc = '```{r}\nx <- 1\n```'
    const first = scanWithIds(doc)
    const second = scanWithIds('```{r}\nx <- 12\n```', toPrev(first))
    expect(second[0].id).toBe(first[0].id)
    expect(second[0].codeChanged).toBe(true)
  })

  it('preserves the id SET when identical unlabelled chunks swap', () => {
    // Known limitation, named deliberately: two unlabelled chunks with identical
    // code are indistinguishable, so only the set is guaranteed.
    const doc = '```{r}\nsame\n```\n\n```{r}\nsame\n```'
    const first = scanWithIds(doc)
    const second = scanWithIds(doc, toPrev(first))
    expect(new Set(second.map((c) => c.id))).toEqual(new Set(first.map((c) => c.id)))
  })

  it('never assigns the same id twice', () => {
    let prev: PrevChunk[] = []
    let doc = ''
    // A crude fuzz: build up, edit, delete, reorder.
    for (let i = 0; i < 40; i++) {
      doc = i % 3 === 0
        ? `\`\`\`{r}\nline${i}\n\`\`\`\n\n` + doc
        : doc.replace(/line(\d+)/, `line$1x`)
      const chunks = reconcileChunks(prev, scanChunks(doc))
      const ids = chunks.map((c) => c.id)
      expect(new Set(ids).size, `duplicate id at step ${i}`).toBe(ids.length)
      prev = toPrev(chunks)
    }
  })
})
