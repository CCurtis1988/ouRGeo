import { describe, it, expect } from 'vitest'
import { describeDocument, buildDocumentContext } from './ai-doc-context'
import type { TabState } from '@/store/editor'

const tab = (over: Partial<TabState>): TabState => ({
  id: over.id ?? 'id-1',
  filePath: null,
  fileName: 'Untitled-1',
  content: '',
  savedContent: '',
  isDirty: false,
  type: 'code',
  ...over,
})

const REPORT = `---
title: "Quakes"
output: html_document
---

\`\`\`{r setup, include=FALSE}
library(dplyr)
# not a heading
\`\`\`

# Introduction

Prose.

## Magnitude

\`\`\`{r mag-plot}
ggplot(eq, aes(mag)) + geom_histogram()
\`\`\`
`

describe('describeDocument', () => {
  it('reads the outline without picking up comments inside chunks', () => {
    const s = describeDocument(REPORT, 'rmarkdown')
    expect(s.headings).toEqual(['Introduction', 'Magnitude'])
    expect(s.chunkLabels).toEqual(['setup', 'mag-plot'])
    expect(s.runnableChunks).toBe(2)
    expect(s.warnings).toEqual([])
  })

  it('flags a chunk that is only a session object — the knit-time failure', () => {
    const doc = '---\ntitle: "x"\n---\n\n```{r global-map}\np1\n```\n'
    const s = describeDocument(doc, 'rmarkdown')
    expect(s.warnings.join(' ')).toMatch(/"global-map" is just the object `p1`/)
    expect(s.warnings.join(' ')).toMatch(/Knit will fail/)
  })

  it('flags duplicate labels, unterminated fences and missing front matter', () => {
    const dup = describeDocument('```{r a}\n1\n```\n\n```{r a}\n2\n```\n', 'rmarkdown')
    expect(dup.warnings.join(' ')).toMatch(/duplicate chunk label "a"/)
    expect(dup.warnings.join(' ')).toMatch(/no YAML front matter/)

    const open = describeDocument('---\ntitle: "x"\n---\n\n```{r a}\n1\n', 'rmarkdown')
    expect(open.warnings.join(' ')).toMatch(/never closed/)
  })

  it('flags {r} chunks in a plain .md document', () => {
    const s = describeDocument('# Notes\n\n```{r}\n1\n```\n', 'markdown')
    expect(s.warnings.join(' ')).toMatch(/plain \.md document/)
  })

  it('says nothing structural about an R script', () => {
    const s = describeDocument('x <- 1\n# a comment\n', 'r')
    expect(s).toMatchObject({ lines: 3, headings: [], chunkLabels: [], warnings: [] })
  })
})

describe('buildDocumentContext', () => {
  it('is empty when nothing is open', () => {
    expect(buildDocumentContext([], null)).toBe('')
    expect(buildDocumentContext([tab({ type: 'data-viewer' })], 'id-1')).toBe('')
  })

  it('lists each document with its language, state and outline', () => {
    const out = buildDocumentContext([
      tab({ id: 'a', fileName: 'report.Rmd', language: 'rmarkdown', content: REPORT, isDirty: true, filePath: '/home/u/report.Rmd' }),
      tab({ id: 'b', fileName: 'clean.R', language: 'r', content: 'x <- 1' }),
    ], 'a')

    expect(out).toContain('## Open Documents')
    expect(out).toContain('`report.Rmd` — R Markdown, ACTIVE')
    expect(out).toContain('/home/u/report.Rmd')
    expect(out).toContain('unsaved changes')
    expect(out).toContain('headings: Introduction, Magnitude')
    expect(out).toContain('chunks: setup, mag-plot (2 runnable)')
    expect(out).toContain('`clean.R` — R, 1 line,')
    expect(out).toContain('not saved to disk')
  })

  it('carries the warnings, so the model sees the bug in an open document', () => {
    const out = buildDocumentContext(
      [tab({ id: 'a', fileName: 'bad.Rmd', language: 'rmarkdown', content: '```{r m}\np1\n```\n' })], 'a')
    expect(out).toMatch(/! chunk "m" is just the object `p1`/)
  })

  it('marks a Visual-mode tab, whose stored text can lag the screen', () => {
    const out = buildDocumentContext(
      [tab({ id: 'a', fileName: 'n.md', language: 'markdown', viewMode: 'visual', content: '# Hi' })], 'a')
    expect(out).toMatch(/Visual mode/)
  })

  it('caps the listing rather than pasting the whole editor into the prompt', () => {
    const many = Array.from({ length: 11 }, (_, i) =>
      tab({ id: `t${i}`, fileName: `f${i}.R`, content: 'x <- 1' }))
    const out = buildDocumentContext(many, 't0')
    expect(out).toContain('f7.R')
    expect(out).not.toContain('f8.R')
    expect(out).toContain('… and 3 more')
  })
})
