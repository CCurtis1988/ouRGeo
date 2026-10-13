import { expect, it } from 'vitest'
import { editorTabWindow, EDITOR_TAB_WIDTH } from './editor-tab-window'

it('keeps a bounded set of headers at the beginning, middle and end of a huge document set', () => {
  const count = 100000
  for (const index of [0, 12000, count - 1]) {
    const range = editorTabWindow(count, index * EDITOR_TAB_WIDTH, 720)
    expect(range.start).toBeLessThanOrEqual(index)
    expect(range.end).toBeGreaterThan(index)
    expect(range.end - range.start).toBeLessThanOrEqual(10)
    expect(range.start + (range.end - range.start) + (count - range.end)).toBe(count)
  }
})

it('handles an empty editor, fractional scrolling, resizing and a viewport past the final header', () => {
  expect(editorTabWindow(0, 0, 0)).toEqual({ start: 0, end: 0 })
  const narrow = editorTabWindow(1000, 721.5, 360)
  const wide = editorTabWindow(1000, 721.5, 900)
  expect(wide.start).toBe(narrow.start)
  expect(wide.end).toBeGreaterThan(narrow.end)
  expect(editorTabWindow(2, 100000, 900)).toEqual({ start: 2, end: 2 })
})
