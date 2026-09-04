import { describe, it, expect } from 'vitest'
import {
  defaultLayout, normalize, movePanel, reorderPanel, dropPanel, setPanelOpen, setZoneSize,
  setPanelShare, splitPanels, evenPanels, forgetWeights, shareOf,
  setZoneMode, setZoneAxis, setActivePanel, setToolbar,
  zoneOf, openPanels, zoneVisible, describeLayout, ZONE_IDS,
  type LayoutState, type PanelMeta,
} from './model'

// The layout is the one piece of state an assistant is expected to rearrange on
// a sentence from the user, and a layout that renders wrong is a layout the
// user cannot use to fix itself. So the invariants are pinned here rather than
// trusted to the render.

const panel = (id: string, over: Partial<PanelMeta> = {}): PanelMeta => ({
  id, min: 100, defaultZone: 'right', defaultOrder: 0, defaultOpen: true, ...over,
})

const PANELS: PanelMeta[] = [
  panel('editor', { defaultZone: 'center', essential: true, maxInstances: 4 }),
  panel('console', { defaultZone: 'bottom' }),
  panel('environment', { defaultZone: 'left', defaultOpen: false }),
  panel('spatial', { defaultZone: 'right', defaultOrder: 1, defaultOpen: false, min: 300, maxInstances: 4 }),
  panel('plots', { defaultZone: 'right', defaultOrder: 0, defaultOpen: false }),
]

const LABELS = Object.fromEntries(PANELS.map((p) => [p.id, p.id]))

describe('the default layout', () => {
  const layout = defaultLayout(PANELS)

  it('puts every panel exactly where its definition asked', () => {
    expect(zoneOf(layout, 'editor')).toBe('center')
    expect(zoneOf(layout, 'console')).toBe('bottom')
    expect(zoneOf(layout, 'environment')).toBe('left')
    expect(zoneOf(layout, 'spatial')).toBe('right')
  })

  it('orders a zone by defaultOrder, not by declaration order', () => {
    expect(layout.zones.right.order).toEqual(['plots', 'spatial'])
  })

  it('opens only what shipped open', () => {
    expect(layout.open.editor).toBe(true)
    expect(layout.open.console).toBe(true)
    expect(layout.open.spatial).toBe(false)
  })

  it('hides a zone with nothing open in it', () => {
    expect(zoneVisible(layout, 'right')).toBe(false)
    expect(zoneVisible(layout, 'center')).toBe(true)
  })
})

describe('moving a panel', () => {
  const layout = defaultLayout(PANELS)

  it('takes it out of the zone it was in', () => {
    const next = movePanel(layout, 'spatial', 'left')
    expect(zoneOf(next, 'spatial')).toBe('left')
    expect(next.zones.right.order).not.toContain('spatial')
  })

  it('opens it, because being asked to move something invisible is not the request', () => {
    // "Put the map on the left" from a user with the map closed means show it.
    // Requiring movePanel + setPanelOpen makes the assistant issue two calls
    // for one instruction, and it routinely forgets the second.
    expect(layout.open.spatial).toBe(false)
    expect(movePanel(layout, 'spatial', 'left').open.spatial).toBe(true)
  })

  it('honours an index, and clamps one that is out of range', () => {
    const next = movePanel(layout, 'spatial', 'left', 0)
    expect(next.zones.left.order).toEqual(['spatial', 'environment'])
    expect(movePanel(layout, 'spatial', 'left', 99).zones.left.order).toEqual(['environment', 'spatial'])
  })

  it('never mutates the layout it was given', () => {
    const before = JSON.stringify(layout)
    movePanel(layout, 'spatial', 'left', 0)
    expect(JSON.stringify(layout)).toBe(before)
  })

  it('reorders within the current zone without naming it', () => {
    const next = reorderPanel(layout, 'spatial', 0)
    expect(next.zones.right.order).toEqual(['spatial', 'plots'])
  })
})

describe('normalize — the invariants the render depends on', () => {
  const broken = (over: Partial<LayoutState>): LayoutState =>
    ({ ...defaultLayout(PANELS), ...over })

  it('puts the editor back when a layout has lost it', () => {
    // Without this the user has nowhere to type and no obvious way back.
    const l = defaultLayout(PANELS)
    l.zones.center.order = []
    const fixed = normalize(l, PANELS)
    expect(zoneOf(fixed, 'editor')).toBe('center')
    expect(fixed.open.editor).toBe(true)
  })

  it('refuses to close the editor', () => {
    const closed = setPanelOpen(defaultLayout(PANELS), 'editor', false)
    expect(normalize(closed, PANELS).open.editor).toBe(true)
  })

  it('drops a panel that no longer exists', () => {
    // A plugin the user removed. Rendering it would mean calling `render` on
    // a definition that is gone.
    const l = defaultLayout(PANELS)
    l.zones.left.order.push('ghost:panel')
    l.open['ghost:panel'] = true
    const fixed = normalize(l, PANELS)
    expect(fixed.zones.left.order).not.toContain('ghost:panel')
    expect(fixed.open['ghost:panel']).toBeUndefined()
  })

  it('never leaves a panel in two zones at once', () => {
    // Two placements means the component is mounted twice — for the map, two
    // MapLibre instances writing to one store.
    const l = defaultLayout(PANELS)
    l.zones.left.order.push('spatial')
    const fixed = normalize(l, PANELS)
    const placements = ZONE_IDS.filter((z) => fixed.zones[z].order.includes('spatial'))
    expect(placements).toHaveLength(1)
  })

  it('places a panel the stored layout has never heard of', () => {
    // An ouRGeo update added a panel, or a plugin was enabled since the file
    // was written. It goes where its author meant it to, not nowhere.
    const l = defaultLayout(PANELS)
    const withNew = normalize(l, [...PANELS, panel('newcomer', { defaultZone: 'bottom', defaultOpen: false })])
    expect(zoneOf(withNew, 'newcomer')).toBe('bottom')
    expect(withNew.open.newcomer).toBe(false)
  })

  it('clamps a zone size', () => {
    const fixed = normalize(setZoneSize(defaultLayout(PANELS), 'right', 5), PANELS)
    expect(fixed.zones.right.size).toBeGreaterThanOrEqual(120)
  })

  it('gives a panel with no share of its own an equal one', () => {
    // A layout written before shares existed, or one a plugin's panel has just
    // been added to. Anything else and the panel renders with no height.
    const l = defaultLayout(PANELS)
    delete l.zones.right.weights.spatial
    expect(normalize(l, PANELS).zones.right.weights.spatial).toBe(1)
  })

  it('survives a size that is not a number at all', () => {
    const l = broken({})
    l.zones.right.size = Number.NaN
    expect(Number.isFinite(normalize(l, PANELS).zones.right.size)).toBe(true)
  })

  it('always leaves the active tab naming something open and present', () => {
    let l = setZoneMode(defaultLayout(PANELS), 'right', 'tabs')
    l = setPanelOpen(l, 'plots', true)
    l.zones.right.active = 'environment'   // not even in this zone
    const fixed = normalize(l, PANELS)
    expect(fixed.zones.right.order).toContain(fixed.zones.right.active!)
    expect(fixed.open[fixed.zones.right.active!]).toBe(true)
  })

  it('leaves active null when the zone has nothing open', () => {
    expect(normalize(defaultLayout(PANELS), PANELS).zones.right.active).toBeNull()
  })

  it('de-duplicates the toolbar lists', () => {
    const l = setToolbar(defaultLayout(PANELS), { order: ['save', 'save', 'help'], hidden: ['record', 'record'] })
    const fixed = normalize(l, PANELS)
    expect(fixed.toolbar.order).toEqual(['save', 'help'])
    expect(fixed.toolbar.hidden).toEqual(['record'])
  })

  it('is idempotent', () => {
    const once = normalize(defaultLayout(PANELS), PANELS)
    expect(normalize(once, PANELS)).toEqual(once)
  })
})

describe('zones', () => {
  it('reports only the open panels, in order', () => {
    let l = setPanelOpen(defaultLayout(PANELS), 'spatial', true)
    l = setPanelOpen(l, 'plots', true)
    expect(openPanels(l, 'right')).toEqual(['plots', 'spatial'])
    l = setPanelOpen(l, 'plots', false)
    expect(openPanels(l, 'right')).toEqual(['spatial'])
  })

  it('carries mode and axis independently', () => {
    let l = setZoneMode(defaultLayout(PANELS), 'right', 'tabs')
    l = setZoneAxis(l, 'right', 'col')
    expect(l.zones.right.mode).toBe('tabs')
    expect(l.zones.right.axis).toBe('col')
    expect(l.zones.left.mode).toBe('split')
  })

  it('opens a panel when it is made the active tab', () => {
    const l = setActivePanel(defaultLayout(PANELS), 'spatial')
    expect(l.zones.right.active).toBe('spatial')
    expect(l.open.spatial).toBe(true)
  })
})

describe('sharing a zone', () => {
  // The bug this replaced: every panel carried a px size and the last one was
  // flex-1, so opening a second panel in a column gave the first a fixed 260px
  // and the second everything else. Nobody chose 260px.
  const withOpen = (...ids: string[]): LayoutState => {
    let l = defaultLayout(PANELS)
    for (const id of ids) l = setPanelOpen(l, id, true)
    return normalize(l, PANELS)
  }

  it('splits evenly between two panels, and three ways between three', () => {
    const two = withOpen('plots', 'spatial')
    expect(shareOf(two, 'plots')).toBeCloseTo(0.5)
    expect(shareOf(two, 'spatial')).toBeCloseTo(0.5)

    let three = withOpen('plots', 'spatial')
    three = normalize(movePanel(three, 'environment', 'right'), PANELS)
    for (const id of ['plots', 'spatial', 'environment']) {
      expect(shareOf(three, id), id).toBeCloseTo(1 / 3)
    }
  })

  it('gives a lone panel the whole zone, whatever its weight says', () => {
    expect(shareOf(withOpen('spatial'), 'spatial')).toBe(1)
  })

  it('counts only what is open — a closed panel holds no space', () => {
    const l = withOpen('plots', 'spatial')
    expect(shareOf(normalize(setPanelOpen(l, 'plots', false), PANELS), 'spatial')).toBe(1)
  })

  it('sets one panel’s share and leaves the others in proportion', () => {
    let l = normalize(movePanel(withOpen('plots', 'spatial'), 'environment', 'right'), PANELS)
    l = normalize(setPanelShare(l, 'spatial', 0.5), PANELS)
    expect(shareOf(l, 'spatial')).toBeCloseTo(0.5)
    // The other two split what is left, still evenly with each other.
    expect(shareOf(l, 'plots')).toBeCloseTo(0.25)
    expect(shareOf(l, 'environment')).toBeCloseTo(0.25)
  })

  it('moves one boundary and no other, when a divider is dragged', () => {
    // The whole point of keeping the pair's combined weight: dragging the
    // divider between two panels must not shuffle a third one across the zone.
    let l = normalize(movePanel(withOpen('plots', 'spatial'), 'environment', 'right'), PANELS)
    const untouched = shareOf(l, 'environment')
    l = normalize(splitPanels(l, 'plots', 'spatial', 0.75), PANELS)
    expect(shareOf(l, 'environment')).toBeCloseTo(untouched)
    expect(shareOf(l, 'plots')).toBeCloseTo(0.5)      // 3/4 of the pair's 2/3
    expect(shareOf(l, 'spatial')).toBeCloseTo(1 / 6)
  })

  it('never collapses a panel to nothing, however extreme the request', () => {
    const l = normalize(setPanelShare(withOpen('plots', 'spatial'), 'spatial', 1), PANELS)
    expect(shareOf(l, 'plots')).toBeGreaterThan(0)
  })

  it('evens a zone back out', () => {
    let l = normalize(splitPanels(withOpen('plots', 'spatial'), 'plots', 'spatial', 0.9), PANELS)
    l = normalize(evenPanels(l, 'right'), PANELS)
    expect(shareOf(l, 'plots')).toBeCloseTo(0.5)
  })

  it('forgets every share on the way to disk, so a session opens even', () => {
    // Panel spacing is deliberately session state: ouRGeo opens with each zone
    // shared equally however it was left. Where a panel IS still persists.
    const dragged = normalize(splitPanels(withOpen('plots', 'spatial'), 'plots', 'spatial', 0.9), PANELS)
    const stored = forgetWeights(dragged)
    expect(stored.zones.right.weights).toEqual({})
    expect(stored.zones.right.order).toEqual(dragged.zones.right.order)
    expect(shareOf(normalize(stored, PANELS), 'plots')).toBeCloseTo(0.5)
  })
})

describe('describeLayout', () => {
  it('says where things are, how big, and what is closed', () => {
    const l = normalize(setPanelOpen(defaultLayout(PANELS), 'spatial', true), PANELS)
    const text = describeLayout(l, PANELS, LABELS)
    expect(text).toContain('Right column')
    expect(text).toContain('spatial')
    expect(text).toContain('side by side')
    expect(text).toContain('Closed:')
  })

  it('says what share each panel has, which is what a resize request is about', () => {
    let l = setPanelOpen(defaultLayout(PANELS), 'spatial', true)
    l = normalize(setPanelOpen(l, 'plots', true), PANELS)
    expect(describeLayout(l, PANELS, LABELS)).toContain('50%')
  })

  it('names the showing tab rather than the whole row when a zone is tabbed', () => {
    let l = setPanelOpen(defaultLayout(PANELS), 'spatial', true)
    l = normalize(setZoneMode(l, 'right', 'tabs'), PANELS)
    expect(describeLayout(l, PANELS, LABELS)).toContain('tabbed, showing spatial')
  })
})

describe('a second editor, or a second map', () => {
  it('keeps an instance of a panel that is allowed more than one', () => {
    const l = normalize(movePanel(defaultLayout(PANELS), 'editor#2', 'center'), PANELS)
    expect(zoneOf(l, 'editor#2')).toBe('center')
    expect(openPanels(l, 'center')).toContain('editor#2')
  })

  it('drops an instance of a panel that may only exist once', () => {
    // A layout file from a build that allowed it, or a hand edit. Two consoles
    // would be two views of one thing, both writing the same store.
    const l = normalize(movePanel(defaultLayout(PANELS), 'console#2', 'bottom'), PANELS)
    expect(zoneOf(l, 'console#2')).toBeNull()
  })

  it('drops an instance past the cap, and a malformed one', () => {
    let l = movePanel(defaultLayout(PANELS), 'editor#9', 'center')
    l = movePanel(l, 'editor#1', 'center')
    l = normalize(l, PANELS)
    expect(zoneOf(l, 'editor#9')).toBeNull()
    expect(zoneOf(l, 'editor#1')).toBeNull()
    expect(zoneOf(l, 'editor')).toBe('center')
  })

  it('gives an instance its base panel’s minimum size', () => {
    const l = normalize(movePanel(defaultLayout(PANELS), 'spatial#2', 'right'), PANELS)
    expect(l.zones.right.weights['spatial#2']).toBe(1)
  })

  it('ties an instance’s open state to the panel it copies', () => {
    // The toolbar has one button per panel, so an instance that could be
    // closed on its own would be a map holding sessions that is invisible and
    // has no control to bring it back.
    let l = normalize(movePanel(defaultLayout(PANELS), 'spatial#2', 'right'), PANELS)
    expect(l.open['spatial#2']).toBe(l.open['spatial'])
    l = normalize(setPanelOpen(l, 'spatial', true), PANELS)
    expect(l.open['spatial#2']).toBe(true)
    l = normalize(setPanelOpen(l, 'spatial', false), PANELS)
    expect(l.open['spatial#2']).toBe(false)
  })

  it('does not put a removed instance back, the way it re-places an original', () => {
    // Step 2 of `normalize` restores a panel the file has never seen. An extra
    // one exists only because a user asked for it, so its absence is an answer.
    let l = normalize(movePanel(defaultLayout(PANELS), 'editor#2', 'center'), PANELS)
    l = normalize(dropPanel(l, 'editor#2'), PANELS)
    expect(zoneOf(l, 'editor#2')).toBeNull()
    expect(l.open['editor#2']).toBeUndefined()
  })

  it('puts the essential panel back when it is the one dropped', () => {
    const l = normalize(dropPanel(defaultLayout(PANELS), 'editor'), PANELS)
    expect(zoneOf(l, 'editor')).toBe('center')
    expect(l.open['editor']).toBe(true)
  })

  it('names an instance in the description, derived from its base label', () => {
    const l = normalize(movePanel(defaultLayout(PANELS), 'spatial#2', 'right'), PANELS)
    expect(describeLayout(l, PANELS, { ...LABELS, spatial: 'Spatial Editor' }))
      .toContain('Spatial Editor 2')
  })
})
