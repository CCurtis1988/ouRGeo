import { describe, it, expect } from 'vitest'
import {
  BUILTIN_PANEL_INFO, multiInstancePanels, panelInfo, panelMaxInstances, resolvePanelName,
} from './panel-meta'
import { defaultLayout, movePanel, normalize, zoneOf, type PanelMeta } from './model'

// Which panels ouRGeo will draw twice is a product decision, not an accident of
// a `maxInstances` field, and it is the one thing in this registry a user can
// feel. So it is pinned here against the SHIPPED list rather than against a
// test fixture — model.test.ts already proves the machinery is general, and a
// fixture would happily go on passing after the shipped answer changed.

const PANELS = [...BUILTIN_PANEL_INFO] as PanelMeta[]

describe('the panels that may exist more than once', () => {
  it('is the code editor, and nothing else', () => {
    // The editor owns a SET of things — tabs — so a second one is a second set
    // of documents. Every other panel is a window onto one global thing: one
    // console, one environment listing, one map. A second copy of any of them
    // would be two views fighting over one store.
    expect(multiInstancePanels().map((p) => p.id)).toEqual(['editor'])
  })

  it('caps the Spatial Editor at one, so a stored second map is dropped', () => {
    // Two maps shipped briefly and were withdrawn: a second map is a second
    // tile stream, a second extent, and a second answer to "which map did that
    // go to". A layout.json written in that window must still open, and it must
    // not open with a map ouRGeo can no longer draw. Its sessions are not lost
    // — `reconcilePanelContent` brings them back to the map that remains.
    expect(panelMaxInstances('spatial')).toBe(1)
    expect(panelInfo('spatial#2')).toBeUndefined()
    const stored = movePanel(defaultLayout(PANELS), 'spatial#2', 'right')
    expect(zoneOf(normalize(stored, PANELS), 'spatial#2')).toBeNull()
    expect(zoneOf(normalize(stored, PANELS), 'spatial')).toBe('right')
  })

  it('still resolves an added editor by id and by the name a user says', () => {
    expect(panelInfo('editor#2')?.label).toBe('Code editor 2')
    expect(resolvePanelName('editor#2')?.id).toBe('editor#2')
    expect(resolvePanelName('Code editor 2')?.id).toBe('editor#2')
    // Past the cap is not a panel, however it is spelled.
    expect(resolvePanelName('editor#5')).toBeUndefined()
    expect(resolvePanelName('Spatial Editor 2')).toBeUndefined()
  })
})
