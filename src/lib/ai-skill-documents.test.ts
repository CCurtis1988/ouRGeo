import { describe, it, expect } from 'vitest'
import { buildDocumentSkill } from './ai-skill-documents'

// These assertions are the skill's contract with the failure that produced it:
// a report whose chunks were bare session variables and whose numbers were typed
// into the prose. If an edit drops one of these sentences, the model loses the
// only thing telling it that a .Rmd renders in a session of its own.

describe('buildDocumentSkill', () => {
  const skill = buildDocumentSkill({ hasDocumentTools: true })

  it('states that knit is a clean session and the document must be self-contained', () => {
    expect(skill).toMatch(/clean `Rscript`/)
    expect(skill).toMatch(/self-contained/i)
    expect(skill).toMatch(/created by an earlier chunk \*\*in the same document\*\*/)
  })

  it('calls out the bare-object chunk by name', () => {
    expect(skill).toMatch(/bare name/)
    expect(skill).toContain('`p1`')
  })

  it('requires inline R for figures in prose', () => {
    expect(skill).toContain('`r nrow(eq)`')
    expect(skill).toMatch(/Never type the figure itself/)
  })

  it('explains the inline-run vs knit difference', () => {
    expect(skill).toMatch(/run one chunk \*\*in the live session\*\*|runs one chunk \*\*in the live session\*\*/)
    expect(skill).toMatch(/Do not test a knit by calling `rmarkdown::render\(\)`/)
  })

  it('keeps the chunk-option traps that silently produce wrong output', () => {
    expect(skill).toContain("results='asis'")
    expect(skill).toMatch(/print\(p\)/)
    expect(skill).toMatch(/duplicate/i)
  })

  it('names the render failures with their causes', () => {
    expect(skill).toMatch(/object '…' not found/)
    expect(skill).toMatch(/pandoc/)
    expect(skill).toMatch(/'to' must be of length 1/)
  })
})

describe('buildDocumentSkill authoring branch', () => {
  it('points at the tools when they are attached', () => {
    const skill = buildDocumentSkill({ hasDocumentTools: true })
    expect(skill).toContain('`write_document`')
    expect(skill).toContain('`edit_document`')
    expect(skill).toMatch(/Never assemble a document with `writeLines\(\)`/)
    expect(skill).toMatch(/mode:"append"/)
  })

  it('falls back to a four-backtick fence when they are not', () => {
    const skill = buildDocumentSkill({ hasDocumentTools: false })
    expect(skill).not.toContain('`write_document`')
    expect(skill).toMatch(/four-backtick/)
    expect(skill).toMatch(/writeLines\(\)/) // still forbidden as an authoring route
  })
})
