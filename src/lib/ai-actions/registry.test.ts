import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_ACTIONS, actionById, searchActions, listActions, actionIndex } from './registry'
import { UI_TARGETS, TARGET_IDS } from './targets'
import { GROUP_LABELS, TIERS, type UiAction } from './types'
import { DIALOG_IDS, DIALOG_LABELS } from '@/store/ui'
import { paramValues } from './types'

// The registry is the contract: an action that is not here does not exist, and
// the model only ever learns about it through these fields. So the shape is
// pinned, rather than trusted to review.

describe('registry integrity', () => {
  it('has a unique id for every action', () => {
    const ids = ALL_ACTIONS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every action a group, a summary and a valid tier', () => {
    for (const a of ALL_ACTIONS) {
      expect(GROUP_LABELS[a.group], `${a.id} group`).toBeTruthy()
      expect(a.summary.length, `${a.id} summary`).toBeGreaterThan(10)
      expect(TIERS, `${a.id} tier`).toContain(a.tier)
    }
  })

  it('documents every parameter', () => {
    for (const a of ALL_ACTIONS) {
      for (const p of a.params) {
        expect(p.description.length, `${a.id}.${p.name}`).toBeGreaterThan(3)
        if (p.type === 'enum') {
          // `paramValues` resolves a dynamic set (themes) as well as a fixed one.
          expect(paramValues(p)?.length, `${a.id}.${p.name} enum values`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('separates the group with a colon, so an id is never valid R', () => {
    // `map.addLayer(object = "x")` is a perfectly good R call, and a model in an
    // R IDE will write one. `map:addLayer` cannot be mistaken for a function.
    for (const a of ALL_ACTIONS) {
      expect(a.id, a.id).toMatch(/^[a-z]+:[a-zA-Z]+$/)
      expect(a.id, a.id).not.toContain('.')
    }
  })

  it('names actions by group prefix, so the index reads as a map of the app', () => {
    const prefixes: Record<string, string[]> = {
      ui: ['ui'], editor: ['editor'], project: ['project'], data: ['data', 'db'],
      environment: ['env'], packages: ['packages'], help: ['help'], map: ['map'],
      draw: ['draw'], plots: ['plots'], session: ['session'], settings: ['settings'],
      theme: ['theme'],
    }
    for (const a of ALL_ACTIONS) {
      const allowed = prefixes[a.group]
      expect(allowed.some((p) => a.id.startsWith(`${p}:`)), `${a.id} in group ${a.group}`).toBe(true)
    }
  })

  it('never exposes the AI panel itself', () => {
    // An assistant that can close its own panel can end the conversation.
    for (const a of ALL_ACTIONS) {
      expect(a.id).not.toMatch(/\bai\b/i)
    }
    const panelAction = actionById('ui:panel')
    const panels = panelAction?.params.find((p) => p.name === 'panel')?.values ?? []
    expect(panels).not.toContain('ai')
    expect(DIALOG_IDS).not.toContain('ai')
  })

  it('never takes an API key or a credential as a parameter', () => {
    // Mentioning that a basemap needs one is fine; accepting one is not.
    for (const a of ALL_ACTIONS) {
      expect(a.id.toLowerCase()).not.toMatch(/apikey|credential|token|secret|password/)
      for (const p of a.params) {
        expect(p.name.toLowerCase(), `${a.id}.${p.name}`).not.toMatch(/apikey|token|secret|password/)
      }
    }
  })
})

describe('lookup and search', () => {
  it('finds an action by exact id and case-insensitively', () => {
    expect(actionById('map:addLayer')?.id).toBe('map:addLayer')
    expect(actionById('MAP:ADDLAYER')?.id).toBe('map:addLayer')
    expect(actionById('nope:nothing')).toBeUndefined()
  })

  it('searches ids, summaries and group labels', () => {
    expect(searchActions('symbology').map((a) => a.id)).toContain('map:setSymbology')
    expect(searchActions('', 'draw').every((a) => a.group === 'draw')).toBe(true)
    expect(searchActions('zzzznope')).toHaveLength(0)
  })

  it('renders parameters and the resolved tier in a listing', () => {
    const listing = listActions('map:addLayer')
    expect(listing).toContain('map:addLayer')
    expect(listing).toContain('[autopilot]')
    expect(listing).toContain('object')
    expect(listing).toContain('*required*')
  })

  it('tells the model the groups when nothing matches', () => {
    expect(listActions('zzzznope')).toContain('Groups:')
  })
})

describe('the prompt index', () => {
  const index = actionIndex()

  it('lists every action id exactly once', () => {
    for (const a of ALL_ACTIONS) expect(index).toContain(a.id)
  })

  it('resolves — an index entry that is not in the registry would be a lie', () => {
    const ids = index.split('\n').flatMap((line) => line.split(': ')[1]?.split(', ') ?? [])
    for (const id of ids) expect(actionById(id), id).toBeDefined()
  })

  it('stays small enough to carry on every request', () => {
    // ~4 chars per token; the whole core prompt budget is ~800.
    expect(index.length).toBeLessThan(4000)
  })
})

// Pointing at a control that isn't there is worse than not pointing at all, so
// the catalogue is checked against the actual attributes in the source.
describe('highlight targets', () => {
  const SRC = join(__dirname, '..', '..')

  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) sourceFiles(full, out)
      else if (/\.tsx?$/.test(entry)) out.push(full)
    }
    return out
  }

  const attributes = new Set<string>()
  for (const file of sourceFiles(join(SRC, 'components'))) {
    const text = readFileSync(file, 'utf8')
    // Skip the overlay's own selector, which interpolates the id it is looking for.
    for (const m of text.matchAll(/data-ourgeo-id="([^"${}]+)"/g)) attributes.add(m[1])
  }

  it('has a real element for every catalogued target', () => {
    for (const t of UI_TARGETS) {
      expect(attributes.has(t.id), `no data-ourgeo-id="${t.id}" in the source`).toBe(true)
    }
  })

  it('catalogues every element that carries the attribute', () => {
    for (const id of attributes) {
      expect(TARGET_IDS.has(id), `data-ourgeo-id="${id}" is not in targets.ts`).toBe(true)
    }
  })

  it('describes where each control is, so the assistant can say it in prose', () => {
    for (const t of UI_TARGETS) {
      expect(t.label.length).toBeGreaterThan(2)
      expect(t.where.length).toBeGreaterThan(4)
    }
  })
})

describe('dialogs', () => {
  it('labels every dialog id', () => {
    for (const id of DIALOG_IDS) expect(DIALOG_LABELS[id]).toBeTruthy()
  })

  it('offers every dialog through ui:openDialog', () => {
    const action = actionById('ui:openDialog') as UiAction
    expect(action.params.find((p) => p.name === 'dialog')?.values).toEqual(DIALOG_IDS)
  })
})
