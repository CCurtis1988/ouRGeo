import { describe, it, expect } from 'vitest'
import { minimizeEscapes } from './escapes'
import { normalize } from './roundtrip'
import { structuralSignature } from './remark'

describe('minimizeEscapes', () => {
  it('takes back the underscores in an identifier', () => {
    // The bug this exists for: a paragraph mentioning geom_line() came back
    // from Visual mode as geom\_line().
    expect(minimizeEscapes('Use geom\\_line() here.')).toBe('Use geom_line() here.')
    expect(minimizeEscapes('earthquake\\_url is the variable')).toBe('earthquake_url is the variable')
  })

  it('takes back a tilde that was never strikethrough', () => {
    expect(minimizeEscapes('roughly \\~ 40 rows')).toBe('roughly ~ 40 rows')
  })

  it('keeps an escape that is holding emphasis back', () => {
    // Unescaped, `x*y*z` is x<em>y</em>z — a different document.
    expect(minimizeEscapes('x\\*y\\*z')).toBe('x\\*y\\*z')
  })

  it('keeps the escape on a leading marker', () => {
    expect(minimizeEscapes('\\- not a list item')).toBe('\\- not a list item')
    expect(minimizeEscapes('\\# not a heading')).toBe('\\# not a heading')
  })

  it('never touches an escaped backslash', () => {
    expect(minimizeEscapes('a \\\\ b')).toBe('a \\\\ b')
  })

  it('removes what it can and keeps what it must, in one document', () => {
    const out = minimizeEscapes('The \\_id\\_ column\n\n\\* not a bullet\n')
    expect(out).toContain('\\* not a bullet')
    // `_id_` unescaped IS emphasis, so those two have to stay.
    expect(out).toContain('\\_id\\_')
  })

  it('is idempotent', () => {
    const once = minimizeEscapes('a\\_b and x\\*y\\*z and \\- lead')
    expect(minimizeEscapes(once)).toBe(once)
  })

  it('leaves a document with nothing to do byte-identical', () => {
    const md = '# Title\n\nPlain prose.\n'
    expect(minimizeEscapes(md)).toBe(md)
  })

  it('never changes what the document means', () => {
    const cases = [
      'a\\_b\\_c and \\~x\\~ and \\*y\\*',
      'a | b \\| c',
      '\\[not a link\\](nope)',
      '| a\\_b | c |\n| --- | --- |\n| 1 | 2 |',
    ]
    for (const md of cases) {
      expect(structuralSignature(minimizeEscapes(md))).toBe(structuralSignature(md))
    }
  })
})

describe('normalize', () => {
  it('round-trips a chunk-bearing document without adding backslashes', () => {
    const md = 'Fit with geom_line() and check earthquake_url.\n\n```{r plot, echo=FALSE}\nggplot(d) + geom_line()\n```\n'
    expect(normalize(md)).not.toContain('\\_')
  })

  it('is idempotent, which is what the mode switch relies on', () => {
    const md = 'Text with a_b, x*y*z, and ~tilde~.\n\n- item one\n- item two\n'
    const once = normalize(md)
    expect(normalize(once)).toBe(once)
  })
})
