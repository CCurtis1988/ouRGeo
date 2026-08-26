import { describe, it, expect } from 'vitest'
import { elidePath } from './working-dir'

/** Stand-in for text measurement: a budget in characters. */
const budget = (n: number) => (s: string): boolean => s.length <= n

describe('elidePath', () => {
  const P = '/home/roosteyr/Documents/Projects/ourgeo'

  it('spells the path out in full when it fits', () => {
    expect(elidePath(P, budget(100))).toBe(P)
  })

  it('drops whole segments from the middle, never mid-word', () => {
    const out = elidePath(P, budget(32))
    expect(out).toBe('/home/…/Projects/ourgeo')
    // The two things that identify a directory both survive.
    expect(out.startsWith('/home')).toBe(true)
    expect(out.endsWith('ourgeo')).toBe(true)
  })

  it('gives up more of the middle as the space shrinks', () => {
    expect(elidePath(P, budget(24))).toBe('/home/…/Projects/ourgeo')
    expect(elidePath(P, budget(14))).toBe('/home/…/ourgeo')
  })

  it('falls back to the tail when even first/…/last is too wide', () => {
    // The tail is what names a working directory, so it is the last to go.
    expect(elidePath(P, budget(10))).toBe('…/ourgeo')
  })

  it('always returns something, however small the budget', () => {
    const out = elidePath(P, budget(1))
    expect(out).toBe('…/ourgeo')
  })

  it('leaves a single-segment path alone — there is no middle to drop', () => {
    expect(elidePath('/ourgeo', budget(2))).toBe('/ourgeo')
    expect(elidePath('/', budget(0))).toBe('/')
  })

  it('keeps a Windows drive letter as the root', () => {
    const w = 'C:\\Users\\roosteyr\\Documents\\Projects\\ourgeo'
    const out = elidePath(w, budget(30))
    expect(out.startsWith('C:\\Users')).toBe(true)
    expect(out).toContain('…')
    expect(out.endsWith('ourgeo')).toBe(true)
    // Windows separators throughout — no mixed slashes.
    expect(out).not.toContain('/')
  })

  it('handles an empty path', () => {
    expect(elidePath('', budget(0))).toBe('')
  })
})
