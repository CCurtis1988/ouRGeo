import { describe, it, expect } from 'vitest'
import {
  extensionOf,
  languageForPath,
  languageOf,
  monacoLanguageFor,
  isMarkdownDoc,
  supportsChunks,
  defaultExtensionFor,
  starterContentFor,
} from './doc-kind'

describe('extensionOf', () => {
  it('reads the extension from posix and windows paths', () => {
    expect(extensionOf('/home/x/notes.md')).toBe('md')
    expect(extensionOf('C:\\Users\\x\\notes.Rmd')).toBe('rmd')
  })

  it('is empty for a path with no extension', () => {
    expect(extensionOf('/home/x/README')).toBe('')
    expect(extensionOf(null)).toBe('')
    expect(extensionOf(undefined)).toBe('')
  })

  it('does not treat a dotfile as an extension', () => {
    expect(extensionOf('/home/x/.gitignore')).toBe('')
  })

  it('takes only the last extension', () => {
    expect(extensionOf('/home/x/report.final.Rmd')).toBe('rmd')
  })
})

describe('languageForPath', () => {
  it.each([
    ['/x/a.md', 'markdown'],
    ['/x/a.markdown', 'markdown'],
    ['/x/a.MD', 'markdown'],
    ['/x/a.Rmd', 'rmarkdown'],
    ['/x/a.rmd', 'rmarkdown'],
    ['/x/a.qmd', 'rmarkdown'],
    ['/x/a.R', 'r'],
    ['/x/a.r', 'r'],
  ])('%s -> %s', (path, expected) => {
    expect(languageForPath(path)).toBe(expected)
  })

  it('falls back to R for unknown extensions and for no path', () => {
    expect(languageForPath('/x/a.txt')).toBe('r')
    expect(languageForPath('/x/README')).toBe('r')
    expect(languageForPath(null)).toBe('r')
  })
})

describe('languageOf', () => {
  it('defaults a tab with no language field to R', () => {
    // Tabs written to session.json or a .ourgeoproj before markdown support
    // carry no `language` and must keep opening as R scripts.
    expect(languageOf({})).toBe('r')
    expect(languageOf(null)).toBe('r')
    expect(languageOf(undefined)).toBe('r')
  })

  it('honours an explicit language', () => {
    expect(languageOf({ language: 'rmarkdown' })).toBe('rmarkdown')
  })
})

describe('monacoLanguageFor', () => {
  it('maps R Markdown to its own grammar, not plain markdown', () => {
    // The derived grammar is what makes ```{r} chunk bodies highlight as R.
    expect(monacoLanguageFor('rmarkdown')).toBe('rmarkdown')
    expect(monacoLanguageFor('markdown')).toBe('markdown')
    expect(monacoLanguageFor('r')).toBe('r')
  })
})

describe('isMarkdownDoc / supportsChunks', () => {
  it('treats both markdown flavours as markdown documents', () => {
    expect(isMarkdownDoc('markdown')).toBe(true)
    expect(isMarkdownDoc('rmarkdown')).toBe(true)
    expect(isMarkdownDoc('r')).toBe(false)
    expect(isMarkdownDoc(undefined)).toBe(false)
  })

  it('only allows chunks in R Markdown', () => {
    expect(supportsChunks('rmarkdown')).toBe(true)
    expect(supportsChunks('markdown')).toBe(false)
    expect(supportsChunks('r')).toBe(false)
  })
})

describe('defaultExtensionFor', () => {
  it('gives each language its conventional extension', () => {
    expect(defaultExtensionFor('r')).toBe('R')
    expect(defaultExtensionFor('markdown')).toBe('md')
    expect(defaultExtensionFor('rmarkdown')).toBe('Rmd')
  })
})

describe('starterContentFor', () => {
  it('seeds an .Rmd with front matter and a runnable chunk', () => {
    const md = starterContentFor('rmarkdown', 'Site Analysis')
    expect(md).toContain('title: "Site Analysis"')
    expect(md).toContain('```{r setup}')
    // The starter must itself round-trip through the language detector's idea
    // of a chunk fence.
    expect(md.split('\n').filter((l) => l.startsWith('```')).length).toBe(2)
  })

  it('seeds plain markdown with just a heading, and R with nothing', () => {
    expect(starterContentFor('markdown', 'Notes')).toBe('# Notes\n\n')
    expect(starterContentFor('r')).toBe('')
  })
})
