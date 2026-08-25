import { describe, it, expect } from 'vitest'
import { parseErrorLine, hintFor } from './knit-errors'

// knitr's failures are famously opaque. These turn them into something the user
// can act on, and the line number lets the editor jump to the failing chunk.

describe('parseErrorLine', () => {
  it('reads the line from knitr’s Quitting message', () => {
    expect(parseErrorLine('Quitting from lines 42-47 (doc.Rmd)')).toBe(42)
    expect(parseErrorLine('Quitting from line 8 [setup] (a.Rmd)')).toBe(8)
  })

  it('returns null when there is no line', () => {
    expect(parseErrorLine('some other failure')).toBeNull()
  })
})

describe('hintFor', () => {
  it('explains the clean-session surprise', () => {
    // The single most likely confusion: it worked in the console.
    const h = hintFor("Error in eval: object 'wells' not found")
    expect(h).toMatch(/clean R session/)
  })

  it('explains that pandoc is not an R package', () => {
    expect(hintFor('pandoc: not found')).toMatch(/not an R package/)
  })

  it('offers Word as the way past a LaTeX failure', () => {
    expect(hintFor('! LaTeX failed to compile')).toMatch(/Word/)
  })

  it('names a missing package', () => {
    expect(hintFor("there is no package called 'tmap'")).toMatch(/tmap/)
  })

  it('returns null for an unrecognised failure rather than guessing', () => {
    expect(hintFor('something entirely unexpected')).toBeNull()
  })
})
