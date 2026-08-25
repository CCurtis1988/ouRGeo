import { describe, it, expect } from 'vitest'
import { computeMdEdit, applyEdit } from './apply-source'
import { MD_ACTION_BY_ID, applyPromptValues, resolveActionBody } from './actions'
import type { MdActionDef } from './actions'

/** Apply a resolved action to `text`, using |…| to mark the selection. */
function run(action: MdActionDef, marked: string): { text: string; caret: string } {
  const first = marked.indexOf('|')
  const second = marked.indexOf('|', first + 1)
  const text = marked.replace(/\|/g, '')
  const selStart = first
  const selEnd = second < 0 ? first : second - 1
  const edit = computeMdEdit(text, selStart, selEnd, action)
  const out = applyEdit(text, edit)
  const caret = edit.selStart === edit.selEnd
    ? out.slice(0, edit.selStart) + '|' + out.slice(edit.selStart)
    : out.slice(0, edit.selStart) + '|' + out.slice(edit.selStart, edit.selEnd) + '|' +
      out.slice(edit.selEnd)
  return { text: out, caret }
}

const link = (values: Record<string, string>, hasSelection: boolean): MdActionDef =>
  applyPromptValues(MD_ACTION_BY_ID.link, values, hasSelection)

const footnote = (values: Record<string, string>): MdActionDef =>
  applyPromptValues(MD_ACTION_BY_ID.footnote, values, false)

describe('link prompt', () => {
  it('wraps a selection, keeping the user text', () => {
    const a = link({ text: 'docs', url: 'https://r-project.org' }, true)
    expect(run(a, 'see the |docs| here').text).toBe('see the [docs](https://r-project.org) here')
  })

  it('inserts typed text when there is no selection', () => {
    const a = link({ text: 'R project', url: 'https://r-project.org' }, false)
    expect(run(a, 'see |here').text).toBe('see [R project](https://r-project.org)here')
  })

  it('falls back to the URL as the link text', () => {
    const a = link({ text: '', url: 'https://r-project.org' }, false)
    expect(run(a, '|').text).toBe('[https://r-project.org](https://r-project.org)')
  })

  it('leaves the action untouched when no URL was given', () => {
    expect(link({ text: 'x', url: '  ' }, true)).toBe(MD_ACTION_BY_ID.link)
  })

  it('never leaves an unfilled caret marker in the document', () => {
    const a = link({ text: 'docs', url: 'https://example.com' }, true)
    expect(run(a, '|docs|').text).not.toMatch(/\$\d/)
  })
})

describe('footnote prompt', () => {
  it('puts the marker at the caret and the definition at the end', () => {
    const a = footnote({ label: '1', note: 'Source: Natural Earth.' })
    expect(run(a, 'The coastline|\n\nMore prose.').text).toBe(
      'The coastline[^1]\n\nMore prose.\n\n[^1]: Source: Natural Earth.\n'
    )
  })

  it('keeps the selection and annotates it', () => {
    const a = footnote({ label: 'ne', note: 'Natural Earth' })
    expect(run(a, 'the |coastline| data').text).toBe(
      'the coastline[^ne] data\n\n[^ne]: Natural Earth\n'
    )
  })

  it('leaves the caret after the marker, not in the definition', () => {
    const a = footnote({ label: '1', note: 'note' })
    expect(run(a, 'text|').caret).toBe('text[^1]|\n\n[^1]: note\n')
  })

  it('produces a real marker, not the old empty [^]', () => {
    const a = footnote({ label: '2', note: 'x' })
    expect(run(a, 'a|').text).toContain('[^2]')
    expect(run(a, 'a|').text).not.toContain('[^]')
  })
})

describe('resolveActionBody with a generator', () => {
  const mapAction = MD_ACTION_BY_ID['chunk-map']

  it('uses the generated body when the generator returns one', () => {
    const resolved = resolveActionBody(mapAction, '', () => '```{r chunk-1}\ntm_shape(x)\n```')
    expect(resolved.source).toEqual({
      kind: 'block', body: '```{r chunk-1}\ntm_shape(x)\n```', literal: true,
    })
  })

  it('falls back to the scaffolding when there is nothing to generate from', () => {
    const resolved = resolveActionBody(mapAction, '', () => null)
    expect(resolved.source.kind).toBe('block')
    expect((resolved.source as { body: string }).body).toContain('```{r chunk-1')
  })

  it('does not eat a $-digit sequence inside generated R code', () => {
    // `literal` exists for exactly this: the snippet expander strips `$N`, which
    // would silently corrupt generated code that happens to contain one.
    const resolved = resolveActionBody(mapAction, '', () => '```{r a}\nx <- df$1\n```')
    expect(run(resolved, '|').text).toContain('df$1')
  })

  it('is a no-op for non-chunk actions', () => {
    expect(resolveActionBody(MD_ACTION_BY_ID.bold, '', () => 'nope')).toBe(MD_ACTION_BY_ID.bold)
  })

  it('still auto-labels a plain R chunk', () => {
    const resolved = resolveActionBody(MD_ACTION_BY_ID.rchunk, '```{r chunk-1}\n```\n', undefined)
    expect((resolved.source as { body: string }).body).toContain('{r chunk-2}')
  })
})
