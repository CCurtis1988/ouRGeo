import { describe, it, expect } from 'vitest'
import { getCompletions, markdownSlashMenu } from './engine'
import type { EngineDeps, EnvIndex, IndexedObject, IndexedPackage } from './types'
import type { ColumnInfo, RFormalArg } from '@/lib/r-client'

// Uses the LAST `|` so the caret marker doesn't collide with the `|>` pipe.
function cur(s: string): [string, number] {
  const i = s.lastIndexOf('|')
  return [s.slice(0, i) + s.slice(i + 1), i]
}

const objects: IndexedObject[] = [
  { name: 'meuse', rClass: 'sf', envName: '.GlobalEnv', isDataFrame: true, isList: false },
  {
    name: 'df',
    rClass: 'data.frame',
    envName: '.GlobalEnv',
    isDataFrame: true,
    isList: false,
    columns: [
      { name: 'elev', type: 'numeric' },
      { name: 'name', type: 'character' },
    ],
  },
  { name: 'x', rClass: 'numeric', envName: '.GlobalEnv', isDataFrame: false, isList: false },
]

const index: EnvIndex = {
  source: [],
  objects,
  functions: [
    { name: 'st_read', pkg: 'sf' },
    { name: 'filter', pkg: 'dplyr' },
    { name: 'mean', pkg: 'base' },
  ],
  packages: ['sf', 'dplyr', 'base'],
  byName: new Map(objects.map((o) => [o.name, o])),
}

const dfCols: Record<string, ColumnInfo[]> = {
  '.GlobalEnv::df': index.objects[1].columns!,
}
const formals: Record<string, RFormalArg[]> = {
  st_read: [
    { name: 'dsn', hasDefault: false, default: '' },
    { name: 'layer', hasDefault: false, default: '' },
  ],
}

const packages: IndexedPackage[] = [
  { name: 'dplyr', version: '1.1.4', loaded: true },
  { name: 'data.table', version: '1.15.0', loaded: false },
  { name: 'sf', version: '1.0.16', loaded: true },
]

const deps: EngineDeps = {
  index,
  getColumns: (name, env) => dfCols[`${env}::${name}`],
  getFormals: (fn) => formals[fn],
  getPackages: () => packages,
}

const run = (s: string) => {
  const [text, off] = cur(s)
  return getCompletions(text, off, deps)
}

describe('getCompletions — identifiers', () => {
  it('offers matching objects and functions', () => {
    const r = run('me|')
    const labels = r.candidates.map((c) => c.label)
    expect(labels).toContain('meuse')
    expect(labels).toContain('mean')
  })
  it('inserts () for functions and lands the caret inside', () => {
    const r = run('mea|')
    const fn = r.candidates.find((c) => c.label === 'mean')
    expect(fn?.insertText).toBe('mean()')
    expect(fn?.cursorOffset).toBe(-1)
  })
  it('does not add () when a paren already follows', () => {
    const r = run('mean|()')
    const fn = r.candidates.find((c) => c.label === 'mean')
    expect(fn?.insertText).toBe('mean')
  })
  it('offers snippets in identifier position', () => {
    const r = run('li|')
    expect(r.candidates.some((c) => c.kind === 'snippet' && c.label === 'lib')).toBe(true)
  })
})

describe('getCompletions — columns', () => {
  it('completes data.frame columns after $', () => {
    const r = run('df$el|')
    expect(r.candidates.map((c) => c.label)).toEqual(['elev'])
    expect(r.candidates[0]).toMatchObject({ kind: 'column', rType: 'numeric' })
  })
  it('requests columns lazily for an sf frame it has not cached', () => {
    const r = run('meuse$|')
    expect(r.candidates).toHaveLength(0)
    expect(r.wants.columns).toContainEqual({ name: 'meuse', envName: '.GlobalEnv' })
  })
  it('ranks columns ahead of functions inside a dplyr verb', () => {
    const r = run('df |> filter(el|')
    expect(r.candidates[0]).toMatchObject({ kind: 'column', label: 'elev' })
  })
})

describe('getCompletions — arguments', () => {
  it('offers formal argument names inside a call', () => {
    const r = run('st_read(ds|')
    const arg = r.candidates.find((c) => c.kind === 'argument' && c.label === 'dsn')
    expect(arg).toBeTruthy()
    expect(arg?.insertText).toBe('dsn = ')
  })
  it('requests formals lazily when not cached', () => {
    const r = run('filter(ab|')
    // filter resolves as argument context here (no known frame receiver)
    expect(r.wants.formals).toContain('filter')
  })
})

describe('getCompletions — namespace', () => {
  it('lists only the package exports after ::', () => {
    const r = run('sf::st_|')
    expect(r.candidates.map((c) => c.label)).toEqual(['st_read'])
  })
})

describe('getCompletions — packages', () => {
  it('completes installed packages inside library() bare', () => {
    const r = run('library(dpl|)')
    const cand = r.candidates.find((c) => c.label === 'dplyr')
    expect(cand).toMatchObject({ kind: 'package', insertText: 'dplyr' })
  })
  it('completes packages inside a quoted require()', () => {
    const r = run('require("dat|")')
    expect(r.candidates.map((c) => c.label)).toContain('data.table')
    expect(r.candidates.every((c) => c.kind === 'package')).toBe(true)
  })
  it('completes packages inside install.packages("…")', () => {
    const r = run('install.packages("s|")')
    expect(r.candidates.map((c) => c.label)).toContain('sf')
  })
  it('marks attached packages as loaded in the detail', () => {
    const r = run('library(sf|)')
    const cand = r.candidates.find((c) => c.label === 'sf')
    expect(cand?.detail).toContain('loaded')
  })
  it('completes each package arg of pacman::p_load', () => {
    const r = run('p_load(dplyr, dat|)')
    expect(r.candidates.map((c) => c.label)).toContain('data.table')
  })
  it('does not offer packages for a non-package call', () => {
    const r = run('mean(dat|)')
    expect(r.candidates.some((c) => c.kind === 'package')).toBe(false)
  })
})

// ── Markdown mode ──────────────────────────────────────────────────────────
// The mode parameter is DEFAULTED, which is what structurally prevents the R
// console (which shares this controller) from ever seeing markdown candidates.
describe('getCompletions — mode gating', () => {
  it('is byte-identical without a mode argument', () => {
    // The console-safety guarantee, enforced. If this drifts, the console has
    // started behaving differently and something has leaked into the R path.
    const [text, off] = cur('mea|')
    expect(getCompletions(text, off, deps))
      .toEqual(getCompletions(text, off, deps, 'r'))
  })

  it('never offers markdown elements in R mode', () => {
    for (const src of ['/|', 'a/b|', '# heading|', 'x <- 1 /|']) {
      const [text, off] = cur(src)
      const res = getCompletions(text, off, deps)
      expect(res.candidates.some((c) => c.kind === 'markdown'), src).toBe(false)
    }
  })

  it('never sets autoOpen in R mode', () => {
    // autoOpen is what forces the popup open with no typed prefix. If R mode
    // ever set it, `a/b` in the console would start popping a menu.
    for (const src of ['/|', 'a/b|', 'mean(x/|']) {
      const [text, off] = cur(src)
      expect(getCompletions(text, off, deps).autoOpen, src).not.toBe(true)
    }
  })

  it('offers markdown elements for a slash in markdown mode', () => {
    const [text, off] = cur('/|')
    const res = getCompletions(text, off, deps, 'markdown')
    expect(res.candidates.length).toBeGreaterThan(0)
    expect(res.candidates.every((c) => c.kind === 'markdown')).toBe(true)
    // `/` alone must open the popup without widening the shared structural test.
    expect(res.autoOpen).toBe(true)
  })

  it('filters markdown elements by the typed prefix', () => {
    const [text, off] = cur('/head|')
    const labels = getCompletions(text, off, deps, 'markdown').candidates.map((c) => c.label)
    expect(labels.some((l) => l.startsWith('Heading'))).toBe(true)
    expect(labels).not.toContain('Table')
  })

  it('matches on keywords, not just labels', () => {
    const [text, off] = cur('/todo|')
    const labels = getCompletions(text, off, deps, 'markdown').candidates.map((c) => c.label)
    expect(labels).toContain('Task list')
  })

  it('hides chunk actions in plain markdown but offers them in R Markdown', () => {
    const [text, off] = cur('/chunk|')
    const md = getCompletions(text, off, deps, 'markdown').candidates.map((c) => c.label)
    const rmd = getCompletions(text, off, deps, 'rmarkdown').candidates.map((c) => c.label)
    expect(md).not.toContain('R chunk')
    expect(rmd).toContain('R chunk')
  })

  it('gives full R completion inside a chunk', () => {
    const [text, off] = cur('```{r}\nme|')
    const res = getCompletions(text, off, deps, 'rmarkdown')
    expect(res.candidates.map((c) => c.label)).toContain('meuse')
  })

  it('resolves data-frame columns inside a chunk', () => {
    const [text, off] = cur('```{r}\ndf$|')
    const res = getCompletions(text, off, deps, 'rmarkdown')
    expect(res.candidates.map((c) => c.label)).toEqual(expect.arrayContaining(['elev', 'name']))
  })
})

describe('slash menu icons', () => {
  it('gives every markdown entry its own icon, tinted by group', () => {
    // Twenty identical pilcrows told the reader nothing; the point of the row
    // is that its picture is legible without reading the label.
    const items = markdownSlashMenu('', true, '')
    expect(items.length).toBeGreaterThan(15)
    expect(items.every((c) => c.icon && c.iconTint)).toBe(true)
    expect(new Set(items.map((c) => c.icon)).size).toBe(items.length)
    // Grouped, not one colour per row.
    const tints = new Set(items.map((c) => c.iconTint))
    expect(tints.size).toBeGreaterThan(1)
    expect(tints.size).toBeLessThan(items.length)
  })

  it('leaves R candidates on their typographic glyphs', () => {
    const r = getCompletions('me', 2, deps)
    expect(r.candidates.every((c) => c.icon === undefined)).toBe(true)
  })
})
