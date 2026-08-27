import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  collectLocalImages, rewriteImages, stripRawHtml,
  normalizeFences, indentedToFenced,
  preparePost, defaultTitle, FORUM_LIMITS,
} from './publish-markdown'

describe('collectLocalImages', () => {
  it('finds local figures in document order', () => {
    const md = '# T\n\n![map](f/a.png)\n\ntext\n\n![](f/b.png)\n'
    expect(collectLocalImages(md)).toEqual([
      { path: 'f/a.png', alt: 'map' },
      { path: 'f/b.png', alt: '' },
    ])
  })

  it('ignores images that are already URLs', () => {
    const md = '![x](https://example.com/a.png)\n\n![y](f/b.png)'
    expect(collectLocalImages(md).map((i) => i.path)).toEqual(['f/b.png'])
  })

  it('ignores data URIs, which the forum rejects outright', () => {
    expect(collectLocalImages('![x](data:image/png;base64,AAA)')).toEqual([])
  })

  it('counts a repeated figure once', () => {
    // Two references, one upload — and one charge against the ten-image cap.
    const md = '![a](f/a.png)\n\n![a again](f/a.png)'
    expect(collectLocalImages(md)).toHaveLength(1)
  })
})

describe('rewriteImages', () => {
  it('swaps local paths for uploaded URLs and keeps the alt text', () => {
    const out = rewriteImages('![map](f/a.png)', new Map([['f/a.png', 'https://cdn/x.webp']]))
    expect(out).toBe('![map](https://cdn/x.webp)')
  })

  it('rewrites every reference to the same figure', () => {
    const md = '![a](f/a.png) and ![b](f/a.png)'
    const out = rewriteImages(md, new Map([['f/a.png', 'https://cdn/x.webp']]))
    expect(out).toBe('![a](https://cdn/x.webp) and ![b](https://cdn/x.webp)')
  })

  it('leaves an unmapped path alone rather than producing a broken link', () => {
    expect(rewriteImages('![a](f/a.png)', new Map())).toBe('![a](f/a.png)')
  })
})

describe('tables', () => {
  // The forum renders pipe tables now, so the job here is to NOT touch them.
  it('passes a pipe table through untouched', () => {
    const md = '| name | n |\n| --- | --- |\n| alpha | 1 |\n| b | 22 |\n'
    expect(preparePost(md).body).toBe(md)
  })

  it('does not warn about a table any more', () => {
    const p = preparePost('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    expect(p.errors).toEqual([])
    expect(p.warnings).toEqual([])
  })

  it('still strips a table pandoc could only express as raw HTML', () => {
    const md = '<table>\n<tr><td>1</td></tr>\n</table>\n'
    const p = preparePost(md)
    expect(p.warnings.join(' ')).toContain('raw HTML')
  })
})

describe('stripRawHtml', () => {
  it('removes block HTML the forum would show as text', () => {
    const { text, count } = stripRawHtml('<div class="x">\ntext\n</div>\n')
    expect(count).toBe(2)
    expect(text.trim()).toBe('text')
  })

  it('leaves HTML inside a code fence, where it is the point', () => {
    const md = '```html\n<div>x</div>\n```\n'
    expect(stripRawHtml(md).count).toBe(0)
  })
})

describe('preparePost', () => {
  it('reports nothing wrong with an ordinary document', () => {
    const p = preparePost('# Title\n\nSome prose.\n\n![map](f/a.png)\n')
    expect(p.errors).toEqual([])
    expect(p.images).toHaveLength(1)
  })

  it('refuses more figures than a post can carry', () => {
    const md = Array.from({ length: 11 }, (_, i) => `![f${i}](f/${i}.png)`).join('\n\n')
    const p = preparePost(md)
    expect(p.errors.join(' ')).toContain('11 figures')
  })

  it('accepts exactly the cap', () => {
    const md = Array.from({ length: 10 }, (_, i) => `![f${i}](f/${i}.png)`).join('\n\n')
    expect(preparePost(md).errors).toEqual([])
  })

  it('refuses a body over the character limit', () => {
    const p = preparePost('x'.repeat(FORUM_LIMITS.bodyMax + 1))
    expect(p.errors.join(' ')).toContain('limit is')
  })

  it('counts the length the uploaded URLs will add, not the local paths', () => {
    // Ten Supabase URLs are far longer than ten knitr paths, so a document that
    // fits before uploading can fail the CHECK constraint after.
    const images = Array.from({ length: 10 }, (_, i) => `![f${i}](f/${i}.png)`).join('\n\n')
    const prose = 'x'.repeat(FORUM_LIMITS.bodyMax - images.length - 200)
    const p = preparePost(`${prose}\n\n${images}`)
    expect(p.errors.join(' ')).toContain('limit is')
  })

  it('refuses an empty document', () => {
    expect(preparePost('   \n').errors.join(' ')).toContain('nothing to post')
  })

  it('warns about headings the forum will flatten', () => {
    expect(preparePost('#### Deep\n\ntext').warnings.join(' ')).toContain('level 3')
  })

  it('collapses the blank-line runs pandoc leaves behind', () => {
    expect(preparePost('a\n\n\n\n\nb\n').body).toBe('a\n\nb\n')
  })
})

describe('defaultTitle', () => {
  it('prefers the document\'s own YAML title', () => {
    expect(defaultTitle('Well Analysis', 'notes.Rmd')).toBe('Well Analysis')
  })

  it('falls back to a tidied filename', () => {
    expect(defaultTitle(undefined, 'my_well-analysis.Rmd')).toBe('my well analysis')
  })

  it('truncates to the forum limit', () => {
    expect(defaultTitle('x'.repeat(200), 'a.Rmd')).toHaveLength(FORUM_LIMITS.titleMax)
  })
})

describe('normalizeFences', () => {
  it('closes up the space pandoc puts before the language', () => {
    // The forum's fence rule needs ```r; with ``` r it reads the language as
    // empty and puts a stray `r` on the first line of the code.
    expect(normalizeFences('``` r\nx <- 1\n```')).toBe('```r\nx <- 1\n```')
  })

  it('leaves a plain fence and an already-tight one alone', () => {
    expect(normalizeFences('```\nx\n```')).toBe('```\nx\n```')
    expect(normalizeFences('```r\nx\n```')).toBe('```r\nx\n```')
  })
})

describe('indentedToFenced', () => {
  it('fences a chunk output block', () => {
    const md = 'text\n\n    ## [1] 1 2 3\n    ## more\n\nafter\n'
    const { text, count } = indentedToFenced(md)
    expect(count).toBe(1)
    expect(text).toBe('text\n\n```\n## [1] 1 2 3\n## more\n```\n\nafter\n')
  })

  it('leaves indented lines that continue a list item', () => {
    // No blank line before them, so they are not a code block.
    const md = '- item\n    continued\n'
    expect(indentedToFenced(md).count).toBe(0)
  })

  it('does not touch content already inside a fence', () => {
    const md = '```\n    indented inside code\n```\n'
    expect(indentedToFenced(md).count).toBe(0)
  })

  it('keeps a blank line that sits inside one block', () => {
    const md = 'a\n\n    one\n\n    two\n\nb\n'
    const { text, count } = indentedToFenced(md)
    expect(count).toBe(1)
    expect(text).toContain('```\none\n\ntwo\n```')
  })
})

describe('a real knitted document', () => {
  // Captured from an actual `rmarkdown::render(..., md_document)` run, so the
  // shapes here are pandoc's rather than ones invented for the test.
  const raw = readFileSync(join(__dirname, '__fixtures__', 'knitted.md'), 'utf-8')
  const prepared = preparePost(raw)

  it('publishes without errors', () => {
    expect(prepared.errors).toEqual([])
  })

  it('leaves no stray language line at the top of a code block', () => {
    expect(prepared.body).not.toMatch(/```\nr\n/)
    expect(prepared.body).toContain('```r')
  })

  it('fences the printed data frame instead of leaving it as prose', () => {
    expect(prepared.body).toContain('```\n## Simple feature collection')
  })

  it('leaves the kable table as a pipe table for the forum to render', () => {
    expect(prepared.body).toMatch(/^\|/m)
    expect(prepared.warnings.join(' ')).not.toContain('table')
  })

  it('finds the figure, absolute path and all', () => {
    expect(prepared.images).toHaveLength(1)
    expect(prepared.images[0].path).toContain('plot-1.png')
  })

  it('fits comfortably inside the post limit', () => {
    expect(prepared.body.length).toBeLessThan(FORUM_LIMITS.bodyMax)
  })
})
