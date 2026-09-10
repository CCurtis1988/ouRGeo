import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  BUILTIN_ACTIONS, actionList, actionById, searchActions, listActions, actionIndex,
  registerPluginActions,
} from './registry'
import { uiTargets, hasTarget } from './targets'
import { GROUP_LABELS, TIERS, registerPluginGroups, type UiAction } from './types'
import { DIALOG_IDS, DIALOG_LABELS } from '@/store/ui'
import { BUILTIN_TOOLBAR } from '@/lib/layout/toolbar'
import { paramValues } from './types'

// The registry is the contract: an action that is not here does not exist, and
// the model only ever learns about it through these fields. So the shape is
// pinned, rather than trusted to review.

describe('registry integrity', () => {
  it('has a unique id for every action', () => {
    const ids = BUILTIN_ACTIONS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every action a group, a summary and a valid tier', () => {
    for (const a of BUILTIN_ACTIONS) {
      expect(GROUP_LABELS[a.group], `${a.id} group`).toBeTruthy()
      expect(a.summary.length, `${a.id} summary`).toBeGreaterThan(10)
      expect(TIERS, `${a.id} tier`).toContain(a.tier)
    }
  })

  it('documents every parameter', () => {
    for (const a of BUILTIN_ACTIONS) {
      for (const p of a.params) {
        expect(p.description.length, `${a.id}.${p.name}`).toBeGreaterThan(3)
        if (p.type === 'enum' && !p.lenient) {
          // `paramValues` resolves a dynamic set (themes) as well as a fixed one.
          expect(paramValues(p)?.length, `${a.id}.${p.name} enum values`).toBeGreaterThan(0)
        }
        if (p.type === 'enum' && p.lenient) {
          // A lenient enum's set is user content — saved layouts, the user's
          // own themes — and legitimately starts empty. It is advisory, so an
          // empty list costs the model nothing at the boundary; the action
          // resolves the argument itself and its refusal has to name the way
          // to create the first one.
          expect(paramValues(p), `${a.id}.${p.name} still needs a resolver`).toBeDefined()
        }
      }
    }
  })

  it('separates the group with a colon, so an id is never valid R', () => {
    // `map.addLayer(object = "x")` is a perfectly good R call, and a model in an
    // R IDE will write one. `map:addLayer` cannot be mistaken for a function.
    for (const a of BUILTIN_ACTIONS) {
      expect(a.id, a.id).toMatch(/^[a-z]+:[a-zA-Z]+$/)
      expect(a.id, a.id).not.toContain('.')
    }
  })

  it('names actions by group prefix, so the index reads as a map of the app', () => {
    const prefixes: Record<string, string[]> = {
      ui: ['ui'], editor: ['editor'], project: ['project'], data: ['data', 'db'],
      environment: ['env'], packages: ['packages'], help: ['help'], map: ['map'],
      draw: ['draw'], plots: ['plots'], session: ['session'], settings: ['settings'],
      theme: ['theme'], layout: ['layout'], plugin: ['plugin'], store: ['store'],
      connector: ['connector'], terminal: ['terminal'], chat: ['chat'],
    }
    for (const a of BUILTIN_ACTIONS) {
      const allowed = prefixes[a.group]
      expect(allowed.some((p) => a.id.startsWith(`${p}:`)), `${a.id} in group ${a.group}`).toBe(true)
    }
  })

  it('never exposes the AI panel itself', () => {
    // An assistant that can close its own panel can end the conversation.
    for (const a of BUILTIN_ACTIONS) {
      expect(a.id).not.toMatch(/\bai\b/i)
    }
    const panelAction = actionById('ui:panel')
    const panels = panelAction?.params.find((p) => p.name === 'panel')?.values ?? []
    expect(panels).not.toContain('ai')
    expect(DIALOG_IDS).not.toContain('ai')
  })

  it('never takes an API key or a credential as a parameter', () => {
    // Mentioning that a basemap needs one is fine; accepting one is not.
    for (const a of BUILTIN_ACTIONS) {
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
    for (const a of BUILTIN_ACTIONS) expect(index).toContain(a.id)
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

// A plugin contributes actions while the app is running. Everything the model
// reads — the lookup, the search, the listing, the prompt index — has to see
// them, and none of it may see a plugin that has been removed.
//
// This is the `valuesAt` failure one level up. There, an enum captured at module
// load could not contain a theme the assistant had just built, and the model was
// told that switching to its own theme was impossible. A registry captured at
// module load fails the same way, for every plugin action at once.
describe('plugin-contributed actions', () => {
  const fake = (id: string): UiAction => ({
    id,
    group: 'plugin.demo',
    summary: 'A contributed action, long enough to pass the summary check.',
    params: [],
    tier: 'always',
    run: () => ({ ok: true, message: 'done' }),
  })

  afterEach(() => {
    registerPluginActions([])
    registerPluginGroups({})
  })

  it('resolves through every surface the model reads', () => {
    registerPluginGroups({ 'plugin.demo': 'Demo plugin' })
    registerPluginActions([fake('demo:hello')])

    expect(actionById('demo:hello')?.id).toBe('demo:hello')
    expect(actionList().map((a) => a.id)).toContain('demo:hello')
    expect(searchActions('hello').map((a) => a.id)).toContain('demo:hello')
    expect(listActions('demo:hello')).toContain('Demo plugin')
    expect(actionIndex()).toContain('demo:hello')
  })

  it('leaves when its plugin does', () => {
    registerPluginGroups({ 'plugin.demo': 'Demo plugin' })
    registerPluginActions([fake('demo:hello')])
    registerPluginActions([])
    registerPluginGroups({})

    expect(actionById('demo:hello')).toBeUndefined()
    expect(actionIndex()).not.toContain('demo:hello')
    expect(Object.keys(GROUP_LABELS)).not.toContain('plugin.demo')
  })

  it('can never shadow a shipped action or a shipped group', () => {
    // A plugin that replaced `map:addLayer` would leave the button and the
    // assistant doing different things, with nothing on screen to say so.
    const impostor = { ...fake('map:addLayer'), summary: 'Not the real one, but long enough.' }
    registerPluginActions([impostor])
    expect(actionById('map:addLayer')).toBe(BUILTIN_ACTIONS.find((a) => a.id === 'map:addLayer'))

    registerPluginGroups({ map: 'Hijacked' })
    expect(GROUP_LABELS.map).toBe('Spatial editor')
  })

  it('keeps the shipped groups first in the prompt index', () => {
    registerPluginGroups({ 'plugin.demo': 'Demo plugin' })
    registerPluginActions([fake('demo:hello')])
    const index = actionIndex()
    expect(index.indexOf('Panels & dialogs')).toBeLessThan(index.indexOf('Demo plugin'))
  })
})

// Pointing at a control that isn't there is worse than not pointing at all, so
// the catalogue is checked against the actual attributes in the source.
//
// Two kinds of attribute now. Most are literals in a component. The toolbar's
// are RENDERED FROM the registry (`data-ourgeo-id={def.targetId}`), so there is
// no literal to grep for — instead the test checks that the one render site
// really does emit the attribute, and that the catalogue's toolbar half comes
// from the same registry the render maps over.
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

  const layoutSource = readFileSync(join(SRC, 'components', 'layout', 'EditorLayout.tsx'), 'utf8')
  const generated = new Set(BUILTIN_TOOLBAR.map((b) => b.targetId))

  it('renders the attribute for every toolbar button from the registry', () => {
    // The one line that makes `generated` true of the running app. Without it
    // the derivation below would be checking the catalogue against itself.
    expect(layoutSource).toContain('data-ourgeo-id={def.targetId}')
  })

  it('has a real element for every catalogued target', () => {
    for (const t of uiTargets()) {
      const found = attributes.has(t.id) || generated.has(t.id)
      expect(found, `nothing renders data-ourgeo-id="${t.id}"`).toBe(true)
    }
  })

  it('catalogues every element that carries the attribute', () => {
    for (const id of attributes) {
      expect(hasTarget(id), `data-ourgeo-id="${id}" is not in targets.ts`).toBe(true)
    }
  })

  it('gives every toolbar button a target id, so all of them can be pointed at', () => {
    for (const b of BUILTIN_TOOLBAR) {
      expect(b.targetId, b.id).toMatch(/^toolbar\./)
      expect(hasTarget(b.targetId), b.id).toBe(true)
    }
  })

  it('describes where each control is, so the assistant can say it in prose', () => {
    for (const t of uiTargets()) {
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
