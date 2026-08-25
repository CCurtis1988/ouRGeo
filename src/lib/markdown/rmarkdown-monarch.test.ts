import { describe, it, expect } from 'vitest'
import { buildRMarkdownMonarch, CHUNK_FENCE, isEmbeddableEngine } from './rmarkdown-monarch'

// The whole reason this grammar exists: Monaco's stock GFM fence rule is
//   /^\s*```\s*((?:\w|[\/\-#])+).*$/
// whose character class cannot match a `{r label}` chunk header. These tests
// pin the brace-aware rule that fills that gap.

describe('CHUNK_FENCE', () => {
  it.each([
    ['```{r}', 'r'],
    ['```{r setup}', 'r'],
    ['```{r buffer, echo=FALSE, fig.width=7}', 'r'],
    ['```{r, echo=FALSE}', 'r'],
    ['```{python}', 'python'],
    ['```{sql connection=db}', 'sql'],
    ['  ```{r indented}', 'r'],
    ['```{r fig.cap="a, b"}', 'r'],
  ])('matches %s and captures the engine', (line, engine) => {
    const m = CHUNK_FENCE.exec(line)
    expect(m).not.toBeNull()
    expect(m![1]).toBe(engine)
  })

  it.each([
    '```r',            // plain fenced R — display only, not a chunk
    '```',             // bare fence
    '``` {r} trailing',
    '```{}',           // no engine
    'text ```{r}',     // not at line start
  ])('does not match %s', (line) => {
    expect(CHUNK_FENCE.test(line)).toBe(false)
  })

  it('does not match the closing fence', () => {
    expect(CHUNK_FENCE.test('```')).toBe(false)
  })
})

describe('isEmbeddableEngine', () => {
  it('embeds languages Monaco has a grammar for', () => {
    expect(isEmbeddableEngine('r')).toBe(true)
    expect(isEmbeddableEngine('R')).toBe(true)
    expect(isEmbeddableEngine('python')).toBe(true)
  })

  it('refuses engines with no registered grammar', () => {
    // Embedding an unregistered language leaves the tokenizer stuck.
    expect(isEmbeddableEngine('stan')).toBe(false)
    expect(isEmbeddableEngine('tikz')).toBe(false)
  })
})

describe('buildRMarkdownMonarch', () => {
  const grammar = buildRMarkdownMonarch()
  const root = grammar.tokenizer!.root as unknown[]

  it('adds an rchunk state that pops the embedded language on the closing fence', () => {
    const rchunk = grammar.tokenizer!.rchunk as unknown[]
    expect(rchunk).toBeDefined()
    const closing = rchunk[0] as [RegExp, { nextEmbedded?: string; next?: string }]
    expect(closing[1].next).toBe('@pop')
    expect(closing[1].nextEmbedded).toBe('@pop')
  })

  it('places the chunk rule before the stock fence rules', () => {
    const chunkIdx = root.findIndex(
      (r) => Array.isArray(r) && (r as unknown[])[0] === CHUNK_FENCE
    )
    const stockFenceIdx = root.findIndex(
      (r) => Array.isArray(r)
        && (r as unknown[])[0] !== CHUNK_FENCE
        && String((r as unknown[])[0]).includes('```')
    )
    expect(chunkIdx).toBeGreaterThanOrEqual(0)
    expect(stockFenceIdx).toBeGreaterThan(chunkIdx)
  })

  it('embeds the captured engine as the fenced language', () => {
    const rule = root.find(
      (r) => Array.isArray(r) && (r as unknown[])[0] === CHUNK_FENCE
    ) as [RegExp, { nextEmbedded: string; next: string }]
    expect(rule[1].nextEmbedded).toBe('$1')
    expect(rule[1].next).toBe('@rchunk')
  })

  it('leaves the stock markdown grammar untouched', async () => {
    // Plain .md files must keep Monaco's own behaviour — we derive, never mutate.
    const md = await import('monaco-editor/esm/vs/basic-languages/markdown/markdown.js')
    const stockRoot = (md.language.tokenizer as Record<string, unknown[]>).root
    expect(stockRoot.some((r) => Array.isArray(r) && r[0] === CHUNK_FENCE)).toBe(false)
  })
})
