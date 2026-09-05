import { describe, it, expect } from 'vitest'
import {
  placeTerminal, alignTerminalMode, terminalIsPlaced, terminalHomeZone,
  TERMINAL_PANEL, CONSOLE_PANEL,
} from './placement'
import { BUILTIN_PANEL_INFO } from '../layout/panel-meta'
import {
  defaultLayout, movePanel, normalize, setZoneMode, zoneOf, isOpen,
  type LayoutState, type PanelMeta,
} from '../layout/model'

const PANELS = [...BUILTIN_PANEL_INFO] as PanelMeta[]
const fresh = (): LayoutState => defaultLayout(PANELS)

describe('where the terminal starts', () => {
  it('ships in the same zone as the R console', () => {
    const layout = fresh()
    expect(zoneOf(layout, TERMINAL_PANEL)).toBe(zoneOf(layout, CONSOLE_PANEL))
  })

  it('ships closed — opening the panel is what starts a shell', () => {
    expect(isOpen(fresh(), TERMINAL_PANEL)).toBe(false)
  })

  it('follows the console rather than the bottom strip', () => {
    // Hard-coding `bottom` would be right until someone moves the console to
    // the left column, at which point "a tab beside the R console" would put
    // the terminal at the other end of the window.
    const moved = normalize(movePanel(fresh(), CONSOLE_PANEL, 'left'), PANELS)
    expect(terminalHomeZone(moved)).toBe('left')
    expect(zoneOf(placeTerminal(moved, 'tab'), TERMINAL_PANEL)).toBe('left')
  })
})

describe('the placement the setting applies', () => {
  it('tabs the terminal with the console and brings it to the front', () => {
    const next = placeTerminal(fresh(), 'tab')
    const zone = zoneOf(next, TERMINAL_PANEL)!
    expect(next.zones[zone].mode).toBe('tabs')
    // In tabs mode an inactive panel is not rendered at all, so a terminal
    // opened behind the console tab looks exactly like a button that did
    // nothing.
    expect(next.zones[zone].active).toBe(TERMINAL_PANEL)
    expect(isOpen(next, TERMINAL_PANEL)).toBe(true)
  })

  it('puts it beside the console instead when asked to split', () => {
    const next = placeTerminal(fresh(), 'split')
    const zone = zoneOf(next, TERMINAL_PANEL)!
    expect(next.zones[zone].mode).toBe('split')
    expect(isOpen(next, TERMINAL_PANEL)).toBe(true)
  })

  it('orders it directly after the console', () => {
    const next = placeTerminal(fresh(), 'split')
    const order = next.zones[terminalHomeZone(next)].order
    expect(order.indexOf(TERMINAL_PANEL)).toBe(order.indexOf(CONSOLE_PANEL) + 1)
  })

  it('brings it back from wherever the user dragged it', () => {
    // The setting is an explicit "arrange it like this", so unlike the open-time
    // alignment below it is allowed to move the panel.
    const away = movePanel(fresh(), TERMINAL_PANEL, 'right')
    const next = placeTerminal(away, 'tab')
    expect(zoneOf(next, TERMINAL_PANEL)).toBe(zoneOf(next, CONSOLE_PANEL))
  })
})

describe('the alignment applied when the panel opens', () => {
  it('turns a pre-terminal workspace into a tab without moving anything', () => {
    // What an existing layout.json looks like: the terminal re-placed into the
    // bottom strip by `normalize`, in the split mode that file was written with.
    const stored = setZoneMode(fresh(), 'bottom', 'split')
    const next = alignTerminalMode(stored, 'tab')
    expect(next.zones.bottom.mode).toBe('tabs')
    expect(zoneOf(next, TERMINAL_PANEL)).toBe('bottom')
  })

  it('leaves a terminal the user moved exactly where they put it', () => {
    // The guard that lets the setting's description promise the panel stays
    // where it is put. Without it, every open would yank it back beside the
    // console — a preference that fights the user rather than remembering one.
    const away = normalize(movePanel(fresh(), TERMINAL_PANEL, 'right'), PANELS)
    expect(alignTerminalMode(away, 'tab')).toBe(away)
    expect(alignTerminalMode(away, 'split')).toBe(away)
  })

  it('does nothing when the arrangement already matches', () => {
    const tabbed = placeTerminal(fresh(), 'split')
    expect(alignTerminalMode(tabbed, 'split')).toBe(tabbed)
  })

  it('still fronts the tab when the zone is already tabbed', () => {
    // Same zone, right mode, wrong tab in front — which is the state left by
    // closing the terminal and then reopening it.
    const tabbed = placeTerminal(fresh(), 'tab')
    const behind = { ...tabbed, zones: { ...tabbed.zones, bottom: { ...tabbed.zones.bottom, active: CONSOLE_PANEL } } }
    expect(alignTerminalMode(behind, 'tab').zones.bottom.active).toBe(TERMINAL_PANEL)
  })
})

describe('what the settings switch reads', () => {
  it('reports the arrangement rather than only the last choice', () => {
    const split = placeTerminal(fresh(), 'split')
    expect(terminalIsPlaced(split, 'split')).toBe(true)
    expect(terminalIsPlaced(split, 'tab')).toBe(false)
  })

  it('reports neither once the terminal has been moved away', () => {
    const away = normalize(movePanel(fresh(), TERMINAL_PANEL, 'right'), PANELS)
    expect(terminalIsPlaced(away, 'tab')).toBe(false)
    expect(terminalIsPlaced(away, 'split')).toBe(false)
  })
})
