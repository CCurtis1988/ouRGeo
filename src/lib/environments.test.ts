import { describe, it, expect } from 'vitest'
import {
  panelEnvironments, treeEnvironments, moveTargets, loadTargets, userOnlyView,
  exportedNames, exportCode, duplicateCode, placementOf,
} from './environments'
import type { REnvironmentInfo, RObjectInfo } from '@/lib/r-client'

function obj(name: string, patch: Partial<RObjectInfo> = {}): RObjectInfo {
  return {
    name, class: 'data.frame', size: 100, dimensions: '', type: 'list',
    isEnvironment: false, isList: false, ...patch,
  } as RObjectInfo
}

const globalEnv: REnvironmentInfo = {
  name: '.GlobalEnv',
  isSearchPath: false,
  objects: [
    obj('roads'),
    obj('scratch', { class: 'environment', isEnvironment: true, children: [obj('a'), obj('b')] }),
    obj('handler_fn', { class: 'function' }),
  ],
}
const environments: REnvironmentInfo[] = [
  globalEnv,
  { name: 'Autoloads', isSearchPath: true, objects: [] },
  { name: 'package:stats', isSearchPath: true, objects: [obj('lm', { class: 'function' })] },
]

describe('the panel’s view of the environments', () => {
  const promoted = { scratch: 'promoted' } as const

  it('lists a promoted environment beside .GlobalEnv', () => {
    const panel = panelEnvironments(environments, promoted)
    expect(panel.map((e) => e.name)).toEqual(['.GlobalEnv', 'scratch', 'Autoloads', 'package:stats'])
    expect(panel[1]).toMatchObject({
      isUserEnv: true, parentEnv: '.GlobalEnv', isSearchPath: false, placement: 'promoted',
    })
    expect(panel[1].objects.map((o) => o.name)).toEqual(['a', 'b'])
    expect(treeEnvironments(panel).map((e) => e.name)).toContain('scratch')
  })

  it('and takes away its row, so it is never listed twice', () => {
    expect(panelEnvironments(environments, promoted)[0].objects.map((o) => o.name))
      .toEqual(['roads', 'handler_fn'])
  })

  it('draws a child environment as its row and nothing else', () => {
    // The other half of the same rule: one listing, never two.
    const panel = panelEnvironments(environments, { scratch: 'child' })
    expect(panel[0].objects.map((o) => o.name)).toEqual(['roads', 'scratch', 'handler_fn'])
    expect(treeEnvironments(panel).map((e) => e.name))
      .toEqual(['.GlobalEnv', 'Autoloads', 'package:stats'])
  })

  it('is an empty group when the walk could not enter it', () => {
    const selfRef: REnvironmentInfo[] = [{
      ...globalEnv,
      objects: [obj('e', { class: 'environment', isEnvironment: true })],   // no children
    }]
    expect(panelEnvironments(selfRef, { e: 'promoted' })[1].objects).toEqual([])
  })

  it('passes through a listing with no .GlobalEnv at all', () => {
    expect(panelEnvironments([{ name: 'package:stats', isSearchPath: true, objects: [] }]))
      .toHaveLength(1)
  })
})

describe('inside .GlobalEnv, or beside it — never both', () => {
  it('defaults to a place of its own, beside .GlobalEnv', () => {
    expect(placementOf({}, 'scratch')).toBe('promoted')
    expect(panelEnvironments(environments)[1].placement).toBe('promoted')
    expect(panelEnvironments(environments)[0].objects.map((o) => o.name))
      .toEqual(['roads', 'handler_fn'])
  })

  it('appears exactly once either way', () => {
    for (const placement of ['child', 'promoted'] as const) {
      const panel = panelEnvironments(environments, { scratch: placement })
      const asRow = panel[0].objects.filter((o) => o.name === 'scratch').length
      const asGroup = treeEnvironments(panel).filter((e) => e.name === 'scratch').length
      expect(asRow + asGroup).toBe(1)
    }
  })

  it('is a place objects can be moved to, and loaded into, either way', () => {
    // A child environment is drawn by its row, but it is still somewhere the
    // user keeps objects — so Move To and Load must still offer it.
    const panel = panelEnvironments(environments)
    expect(moveTargets(panel, '.GlobalEnv', false)).toEqual(['scratch'])
    expect(loadTargets(panel).map((e) => e.name)).toEqual(['.GlobalEnv', 'scratch'])
  })

  it('hides a child the same way it hides a promoted one', () => {
    // ouRGeo's own `server` environment must not come back as a target just
    // because the user asked to see environments inside .GlobalEnv.
    const panel = panelEnvironments(environments)
    expect(userOnlyView(panel, { '.GlobalEnv': ['handler_fn', 'scratch'] }).map((e) => e.name))
      .toEqual(['.GlobalEnv'])
  })
})

describe('where an object may be sent', () => {
  const panel = panelEnvironments(environments)

  it('offers .GlobalEnv and the user’s own environments while the filter is on', () => {
    expect(moveTargets(panel, '.GlobalEnv', false)).toEqual(['scratch'])
    expect(moveTargets(panel, 'scratch', false)).toEqual(['.GlobalEnv'])
  })

  it('offers everything once the user asks to see everything', () => {
    expect(moveTargets(panel, '.GlobalEnv', true)).toEqual(['scratch', 'Autoloads', 'package:stats'])
  })

  it('never offers the environment the object is already in', () => {
    expect(moveTargets(panel, 'package:stats', true)).not.toContain('package:stats')
  })

  it('loads an .RData only where the user keeps objects', () => {
    // Autoloads is not on the `package:` prefix but is not the user's either;
    // the old test was the prefix, so it was offered as a target.
    expect(loadTargets(panel).map((e) => e.name)).toEqual(['.GlobalEnv', 'scratch'])
  })
})

describe('what an export writes', () => {
  const panel = panelEnvironments(environments)

  it('leaves ouRGeo’s own functions out of the user’s file', () => {
    expect(exportedNames(panel[0], ['handler_fn'])).toEqual(['roads', 'scratch'])
  })

  it('counts back the environments lifted out of the listing', () => {
    // `save(list = …, envir = .GlobalEnv)` writes environments too. Promoting
    // one takes its row out of the panel; it never takes it out of the file,
    // and the echoed R has to name what the file holds.
    expect(exportedNames(panelEnvironments(environments, { scratch: 'promoted' })[0], ['handler_fn']))
      .toEqual(['roads', 'scratch'])
  })

  it('leaves a hidden environment out of both the listing and the echo', () => {
    const hidden = { '.GlobalEnv': ['handler_fn', 'scratch'] }
    const promoted = panelEnvironments(environments, { scratch: 'promoted' })
    expect(exportedNames(userOnlyView(promoted, hidden)[0], ['handler_fn'])).toEqual(['roads'])
  })

  it('excludes them from .GlobalEnv only — a user environment holds nothing else', () => {
    expect(exportedNames(panel[1], ['a'])).toEqual(['a', 'b'])
  })

  it('echoes a save() that names what the file will hold', () => {
    expect(exportCode(panel[0], ['roads'], '/home/u/data.RData'))
      .toBe('save(list = c("roads"), file = "/home/u/data.RData", envir = .GlobalEnv)')
  })

  it('writes Windows paths the way R reads them', () => {
    expect(exportCode(panel[1], ['a'], 'C:\\Users\\u\\d.RData'))
      .toContain('"C:/Users/u/d.RData"')
  })
})

describe('copying an environment', () => {
  it('copies the contents rather than aliasing the reference', () => {
    expect(duplicateCode('scratch', 'scratch_copy'))
      .toBe('scratch_copy <- list2env(as.list(scratch, all.names = TRUE), parent = parent.env(scratch))')
  })

  it('qualifies a nested environment by its home', () => {
    expect(duplicateCode('inner', 'inner_copy', 'scratch'))
      .toBe('scratch$inner_copy <- list2env(as.list(scratch$inner, all.names = TRUE), parent = parent.env(scratch$inner))')
  })
})

describe('the eye: what the panel is showing', () => {
  const panel = panelEnvironments([
    {
      name: '.GlobalEnv', isSearchPath: false, objects: [
        obj('roads'),
        obj('scratch', { class: 'environment', isEnvironment: true, children: [obj('a')] }),
        obj('server', { class: 'environment', isEnvironment: true, children: [obj('h1')] }),
        obj('handle_env_list', { class: 'function' }),
      ],
    },
    { name: 'package:stats', isSearchPath: true, objects: [] },
  ], { scratch: 'promoted', server: 'promoted' })
  // What /session/init reported as ouRGeo's own, plus the environment it keeps
  // its httpuv server in.
  const hidden = { '.GlobalEnv': ['handle_env_list', 'server'] }

  it('hides ouRGeo’s own environment, not just its own functions', () => {
    // `server` is an environment in .GlobalEnv. It was hidden while it was a
    // row; promoting it must not smuggle it back in as a group.
    expect(userOnlyView(panel, hidden).map((e) => e.name)).toEqual(['.GlobalEnv', 'scratch'])
  })

  it('hides ouRGeo’s objects inside the environments it keeps', () => {
    expect(userOnlyView(panel, hidden)[0].objects.map((o) => o.name)).toEqual(['roads'])
  })

  it('hides its row too, when it is listed inside .GlobalEnv', () => {
    const asRows = panelEnvironments([
      {
        name: '.GlobalEnv', isSearchPath: false, objects: [
          obj('roads'),
          obj('server', { class: 'environment', isEnvironment: true, children: [obj('h1')] }),
        ],
      },
    ])
    expect(userOnlyView(asRows, hidden)[0].objects.map((o) => o.name)).toEqual(['roads'])
    expect(userOnlyView(asRows, hidden).map((e) => e.name)).toEqual(['.GlobalEnv'])
  })

  it('shows everything when the eye is off', () => {
    expect(panel.map((e) => e.name)).toEqual(['.GlobalEnv', 'scratch', 'server', 'package:stats'])
  })

  it('is the same list Move To offers', () => {
    // The rule the user asked for: the targets are the environments they can
    // see, and nothing else.
    expect(moveTargets(userOnlyView(panel, hidden), '.GlobalEnv', false)).toEqual(['scratch'])
  })
})
