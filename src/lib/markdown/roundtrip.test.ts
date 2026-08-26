import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { normalize, roundTripReport, shouldWarn, parseMarkdown, serializeMarkdown } from './roundtrip'
import { splitFrontMatter, joinFrontMatter, readFrontMatterKeys } from './front-matter'

const FIXTURES = join(__dirname, '__fixtures__')
const fixtures = readdirSync(FIXTURES).filter((f) => f.endsWith('.md'))

describe('round-trip fidelity', () => {
  // The invariant is idempotence at the SECOND pass, not byte preservation. The
  // first pass may normalise formatting; nothing may change after that, and the
  // structure must be identical either way. Never snapshot the serializer's
  // output — that pins a library detail instead of the property we care about.
  it.each(fixtures)('%s is idempotent after one normalisation', (name) => {
    const text = readFileSync(join(FIXTURES, name), 'utf8')
    const once = normalize(text)
    expect(normalize(once), `${name} drifted on the second pass`).toBe(once)
  })

  it.each(fixtures)('%s keeps its structure through a round trip', (name) => {
    const text = readFileSync(join(FIXTURES, name), 'utf8')
    expect(roundTripReport(text).equal, `${name} changed structurally`).toBe(true)
  })

  it('preserves GFM tables including alignment', () => {
    const text = readFileSync(join(FIXTURES, 'gfm.md'), 'utf8')
    const out = normalize(text)
    expect(out).toContain('| wells |')
    expect(out).toMatch(/:-+/)          // left alignment survives
    expect(out).toMatch(/-+:/)          // right alignment survives
    expect(out).toContain('[x]')        // checked task item survives
  })

  it('preserves a chunk fence and its options verbatim', () => {
    const out = normalize(readFileSync(join(FIXTURES, 'code.md'), 'utf8'))
    // The chunk header is the one thing that must never be rewritten — knitr
    // options we do not understand still have to survive.
    expect(out).toContain('{r chunk-1, echo=FALSE}')
  })
})

describe('unsupported-construct detection', () => {
  it('flags raw HTML with its line number', () => {
    const text = readFileSync(join(FIXTURES, 'raw-html.md'), 'utf8')
    const report = roundTripReport(text)
    expect(report.unsupported.length).toBeGreaterThan(0)
    expect(report.unsupported[0].kind).toBe('html')
    expect(report.unsupported[0].line).toBeGreaterThan(0)
    // This is exactly the case the switch must warn about.
    expect(shouldWarn(report)).toBe(true)
  })

  it('does not warn on documents it handles fully', () => {
    for (const name of ['basic.md', 'gfm.md', 'links.md']) {
      const report = roundTripReport(readFileSync(join(FIXTURES, name), 'utf8'))
      expect(shouldWarn(report), `${name} warned unexpectedly`).toBe(false)
    }
  })

  it('reports reformatting separately from structural loss', () => {
    // `*` bullets normalise to `-`: the file changes, the meaning does not.
    const report = roundTripReport('* a\n* b\n')
    expect(report.equal).toBe(true)
    expect(report.reformats).toBe(true)
    expect(shouldWarn(report)).toBe(false)
  })
})

describe('front matter', () => {
  const doc = '---\ntitle: "Well Analysis"\noutput: html_document\n---\n\n# Body\n'

  it('splits and rejoins losslessly', () => {
    const { frontMatter, body } = splitFrontMatter(doc)
    expect(frontMatter).toBe('---\ntitle: "Well Analysis"\noutput: html_document\n---')
    expect(joinFrontMatter(frontMatter, body)).toBe(doc)
  })

  it('never enters the markdown round trip', () => {
    // remark would treat `---` as a thematic break and destroy the block.
    const { body } = splitFrontMatter(doc)
    expect(normalize(body)).not.toContain('title:')
  })

  it('ignores a --- that is a horizontal rule, not front matter', () => {
    const rule = '# Title\n\n---\n\nMore text\n'
    expect(splitFrontMatter(rule).frontMatter).toBe('')
    expect(splitFrontMatter(rule).body).toBe(rule)
  })

  it('leaves an unterminated block as body rather than eating the document', () => {
    const broken = '---\ntitle: x\n\n# Heading\n'
    expect(splitFrontMatter(broken).frontMatter).toBe('')
    expect(splitFrontMatter(broken).body).toBe(broken)
  })

  it('reads top-level keys for display', () => {
    const { frontMatter } = splitFrontMatter(doc)
    expect(readFrontMatterKeys(frontMatter)).toMatchObject({
      title: 'Well Analysis', output: 'html_document',
    })
  })
})

describe('parse/serialize', () => {
  it('round-trips an empty document', () => {
    expect(serializeMarkdown(parseMarkdown(''))).toBe('')
  })

  it('handles CRLF input', () => {
    expect(normalize('# A\r\n\r\nB\r\n')).toBe('# A\n\nB\n')
  })
})

describe('footnotes are flagged as unsupported', () => {
  // remark round-trips footnotes perfectly, so `equal` stays true and the older
  // guard let them through — but Milkdown's commonmark+gfm schema has no
  // footnote node, so Visual mode would have dropped them silently.
  const doc = 'Coastlines[^ne] are simplified.\n\n[^ne]: Natural Earth, 1:10m.\n'

  it('reports the reference and the definition', () => {
    const kinds = roundTripReport(doc).unsupported.map((u) => u.kind).sort()
    expect(kinds).toEqual(['footnoteDefinition', 'footnoteReference'])
  })

  it('warns before entering Visual mode', () => {
    expect(shouldWarn(roundTripReport(doc))).toBe(true)
  })

  it('names the footnote in the report rather than showing an empty snippet', () => {
    const ref = roundTripReport(doc).unsupported.find((u) => u.kind === 'footnoteReference')
    expect(ref?.snippet).toBe('ne')
  })

  it('leaves footnote-free documents alone', () => {
    expect(shouldWarn(roundTripReport('# Title\n\nJust prose.\n'))).toBe(false)
  })
})

describe('joining front matter back on', () => {
  const doc = '---\ntitle: x\n---\n\n# Heading\n'

  it('is lossless for a body that came straight from splitFrontMatter', () => {
    const { frontMatter, body } = splitFrontMatter(doc)
    expect(joinFrontMatter(frontMatter, body)).toBe(doc)
  })

  it('restores the blank separator for a rewritten body', () => {
    // No markdown serializer emits a leading blank line, so a body that has been
    // through Visual mode arrives without one. Without this, every Visual round
    // trip would shift the document up by a line.
    const { frontMatter } = splitFrontMatter(doc)
    expect(joinFrontMatter(frontMatter, '# Heading\n')).toBe(doc)
  })

  it('leaves a body with no front matter alone', () => {
    expect(joinFrontMatter('', '# Heading\n')).toBe('# Heading\n')
  })
})

describe('escapes and the entry guard', () => {
  it('does not report a reformat for prose full of R identifiers', () => {
    // Before the escape minimiser this warned on almost every real .Rmd: the
    // serializer added a backslash to every underscore, so the guard correctly
    // reported that entering Visual mode would rewrite the file.
    const md = 'Plot with geom_line() over earthquake_url, roughly ~ 40 rows.\n'
    const report = roundTripReport(md)
    expect(report.equal).toBe(true)
    expect(report.reformats).toBe(false)
    expect(shouldWarn(report)).toBe(false)
  })

  it('stays idempotent when an escape really is load-bearing', () => {
    const md = 'A _really_ emphatic point about geom_line().\n'
    const once = normalize(md)
    expect(normalize(once)).toBe(once)
    expect(roundTripReport(md).equal).toBe(true)
  })
})
