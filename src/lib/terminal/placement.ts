// Where the Terminal panel goes, and what the setting actually does.
//
// The default is "a tab in the R console's pane", and the setting swaps it for
// "its own pane beside the console". Both are ordinary operations on the pure
// layout model — no new layout machinery — which is why this file is a dozen
// lines rather than a subsystem.
//
// Two decisions are worth stating, because both are the difference between a
// setting that helps and one that fights the user.
//
// **It follows the CONSOLE, not the bottom zone.** Hard-coding `bottom` would
// be right until someone moves the console to the left column, at which point
// "a tab beside the R console" would put the terminal at the other end of the
// window. The console's own zone is the answer to the question the setting is
// actually asking.
//
// **It acts when it changes, and never again.** The stored placement is not a
// binding that re-asserts itself: the user is explicitly free to drag the
// terminal anywhere afterwards, and a preference that quietly undid that on
// the next launch would be worse than no preference at all. So this function
// is called from the setting and from the panel's first open — not from every
// render, and not from `normalize`.

import {
  movePanel, setZoneMode, setActivePanel, zoneOf,
  type LayoutState, type PanelId, type ZoneId,
} from '../layout/model'
import type { TerminalPlacement } from '../terminal-preferences-persistence'

export const TERMINAL_PANEL: PanelId = 'terminal'
export const CONSOLE_PANEL: PanelId = 'console'

/** The zone the terminal belongs in: wherever the console is, or the bottom
 *  strip if the console has somehow been lost from the layout entirely. */
export function terminalHomeZone(layout: LayoutState): ZoneId {
  return zoneOf(layout, CONSOLE_PANEL) ?? 'bottom'
}

const modeFor = (placement: TerminalPlacement): 'tabs' | 'split' =>
  (placement === 'tab' ? 'tabs' : 'split')

/**
 * Put the terminal beside the console, tabbed or split.
 *
 * What the Settings switch does, and only the Settings switch: it is an
 * explicit "arrange it like this", so it MOVES the panel even if the user had
 * dragged it somewhere else. `movePanel` opens it too — see its comment; asking
 * for the terminal and not seeing it is the wrong answer to the request.
 */
export function placeTerminal(layout: LayoutState, placement: TerminalPlacement): LayoutState {
  const zone = terminalHomeZone(layout)
  const order = layout.zones[zone].order
  const after = order.indexOf(CONSOLE_PANEL)
  // Directly after the console, so the tab strip reads "R console | Terminal"
  // rather than putting it behind whatever else shares that zone.
  const index = after >= 0 ? after + 1 : undefined

  let next = movePanel(layout, TERMINAL_PANEL, zone, index)
  next = setZoneMode(next, zone, modeFor(placement))
  // In `tabs` mode the panel that is not active is not rendered at all, so a
  // terminal that was opened and then left behind the console tab would look
  // exactly like a button that did nothing.
  if (placement === 'tab') next = setActivePanel(next, TERMINAL_PANEL)
  return next
}

/**
 * Honour the placement without ever moving the panel.
 *
 * Run when the Terminal panel opens, which is the moment the preference first
 * has anything to apply to: a workspace built before the terminal existed has
 * it in the bottom strip in `split` mode, and the default is a tab.
 *
 * The guard is the whole point. It only touches a zone the terminal and the
 * console are BOTH in — so a user who has dragged the terminal to the right
 * column keeps it there, and opening it never yanks it back. That is the
 * difference between a remembered preference and one that fights you, and it
 * is what lets the setting's description promise the panel stays where it is
 * put.
 */
export function alignTerminalMode(
  layout: LayoutState, placement: TerminalPlacement,
): LayoutState {
  const zone = zoneOf(layout, TERMINAL_PANEL)
  if (!zone || zone !== zoneOf(layout, CONSOLE_PANEL)) return layout
  const want = modeFor(placement)
  if (layout.zones[zone].mode === want) {
    // Already arranged; still make sure a tab that is behind the console is
    // brought to the front, or opening the panel shows no terminal at all.
    return placement === 'tab' ? setActivePanel(layout, TERMINAL_PANEL) : layout
  }
  const next = setZoneMode(layout, zone, want)
  return placement === 'tab' ? setActivePanel(next, TERMINAL_PANEL) : next
}

/** Whether the terminal is currently arranged the way `placement` describes —
 *  what the Settings switch reads, so it reflects the workspace rather than
 *  only what was last chosen. */
export function terminalIsPlaced(layout: LayoutState, placement: TerminalPlacement): boolean {
  const zone = zoneOf(layout, TERMINAL_PANEL)
  if (!zone || zone !== zoneOf(layout, CONSOLE_PANEL)) return false
  return layout.zones[zone].mode === (placement === 'tab' ? 'tabs' : 'split')
}
