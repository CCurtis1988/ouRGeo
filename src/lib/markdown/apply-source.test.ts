import { describe, it, expect } from 'vitest'
import { computeMdEdit, applyEdit } from './apply-source'
import { MD_ACTION_BY_ID, nextChunkLabel, actionsFor, MD_ACTIONS } from './actions'

/** Apply an action to `text`, using |…| to mark the selection (or | for a caret). */
function run(id: string, marked: string): { text: string; caret: string } {
  const first = marked.indexOf('|')
  const second = marked.indexOf('|', first + 1)
  const text = marked.replace(/\|/g, '')
  const selStart = first
  const selEnd = second < 0 ? first : second - 1
  const edit = computeMdEdit(text, selStart, selEnd, MD_ACTION_BY_ID[id])
  const out = applyEdit(text, edit)
  // Re-mark the resulting selection so assertions read naturally.
  const caret = edit.selStart === edit.selEnd
    ? out.slice(0, edit.selStart) + '|' + out.slice(edit.selStart)
    : out.slice(0, edit.selStart) + '|' + out.slice(edit.selStart, edit.selEnd) + '|' + out.slice(edit.selEnd)
  return { text: out, caret }
}

describe('wrap actions', () => {
  it('wraps a selection and keeps it selected', () => {
    expect(run('bold', 'the |buffer| was').caret).toBe('the **|buffer|** was')
  })

  it('puts the caret between the markers with no selection', () => {
    expect(run('bold', 'the | was').caret).toBe('the **|** was')
  })

  it('unwraps when the markers are inside the selection', () => {
    expect(run('bold', 'the |**buffer**| was').text).toBe('the buffer was')
  })

  it('unwraps when the markers sit just outside the selection', () => {
    // Selecting the word without its asterisks and hitting Bold again must
    // toggle off, not double-wrap.
    expect(run('bold', 'the **|buffer|** was').text).toBe('the buffer was')
  })

  it('does not confuse italic with bold', () => {
    expect(run('italic', 'the |buffer| was').text).toBe('the *buffer* was')
    expect(run('italic', 'the |*buffer*| was').text).toBe('the buffer was')
  })

  it('handles strikethrough and inline code', () => {
    expect(run('strike', 'a |b| c').text).toBe('a ~~b~~ c')
    expect(run('code', 'a |b| c').text).toBe('a `b` c')
  })

  it('puts the caret in the parens for a link', () => {
    // `]($1)` — the caret belongs in the URL slot, not after the whole thing.
    expect(run('link', 'see |docs| here').text).toBe('see [docs]() here')
  })

  it('leaves the URL slot ready when a link is inserted empty', () => {
    expect(run('link', 'see | here').caret).toBe('see [](|) here')
  })
})

describe('line-prefix actions', () => {
  it('prefixes a single line', () => {
    expect(run('h1', 'Title|').text).toBe('# Title')
  })

  it('prefixes every selected line', () => {
    expect(run('ul', '|one\ntwo\nthree|').text).toBe('- one\n- two\n- three')
  })

  it('toggles off when every line already has the marker', () => {
    expect(run('ul', '|- one\n- two|').text).toBe('one\ntwo')
  })

  it('completes a partially-formatted selection instead of clearing it', () => {
    // Half-marked must become fully marked — un-marking would discard the
    // user's existing formatting.
    expect(run('ul', '|- one\ntwo|').text).toBe('- one\n- two')
  })

  it('renumbers an ordered list', () => {
    expect(run('ol', '|a\nb\nc|').text).toBe('1. a\n2. b\n3. c')
  })

  it('replaces one heading level with another', () => {
    expect(run('h3', '|# Title|').text).toBe('### Title')
  })

  it('swaps a bullet list for a task list', () => {
    expect(run('task', '|- one\n- two|').text).toBe('- [ ] one\n- [ ] two')
  })

  it('toggles a task list off regardless of checked state', () => {
    expect(run('task', '|- [x] done\n- [ ] todo|').text).toBe('done\ntodo')
  })

  it('leaves blank lines alone inside a selection', () => {
    expect(run('quote', '|a\n\nb|').text).toBe('> a\n\n> b')
  })

  it('expands the range to whole lines from a partial selection', () => {
    expect(run('h2', 'He|ad|ing').text).toBe('## Heading')
  })
})

describe('block actions', () => {
  it('inserts a table skeleton with the caret in the first header cell', () => {
    const { text, caret } = run('table', '|')
    expect(text).toBe('|  | Column |\n| --- | --- |\n|  | |')
    expect(caret.indexOf('|')).toBeGreaterThanOrEqual(0)
  })

  it('separates a block from surrounding prose with a blank line', () => {
    const { text } = run('hr', 'prose|')
    expect(text).toBe('prose\n\n---')
  })

  it('does not pile up blank lines when one is already there', () => {
    const { text } = run('hr', 'prose\n\n|')
    expect(text).not.toMatch(/\n{3,}/)
  })

  it('inserts an R chunk fence', () => {
    const { text } = run('rchunk', '|')
    expect(text).toContain('```{r ')
    expect(text.match(/```/g)).toHaveLength(2)
  })
})

describe('nextChunkLabel', () => {
  it('starts at chunk-1 in an empty document', () => {
    expect(nextChunkLabel('')).toBe('chunk-1')
  })

  it('skips labels already in use', () => {
    const doc = '```{r chunk-1}\n```\n\n```{r chunk-2}\n```'
    expect(nextChunkLabel(doc)).toBe('chunk-3')
  })

  it('fills a gap left by a deleted chunk', () => {
    expect(nextChunkLabel('```{r chunk-1}\n```\n```{r chunk-3}\n```')).toBe('chunk-2')
  })

  it('ignores non-generated labels', () => {
    expect(nextChunkLabel('```{r setup}\n```')).toBe('chunk-1')
  })
})

describe('actionsFor', () => {
  it('hides chunk actions in plain markdown', () => {
    const plain = actionsFor(false).map((a) => a.id)
    expect(plain).not.toContain('rchunk')
    expect(plain).toContain('bold')
  })

  it('offers chunk actions in R Markdown', () => {
    expect(actionsFor(true).map((a) => a.id)).toContain('rchunk')
  })
})

describe('catalog integrity', () => {
  it('has unique ids', () => {
    const ids = MD_ACTIONS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never produces an empty edit for a bare caret', () => {
    // A ribbon button that silently does nothing is worse than one that errors.
    for (const action of MD_ACTIONS) {
      const edit = computeMdEdit('', 0, 0, action)
      expect(edit.insertText.length, `${action.id} inserted nothing`).toBeGreaterThan(0)
    }
  })
})
