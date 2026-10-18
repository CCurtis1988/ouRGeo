// Every dockable panel, as data — with no React in it.
//
// This split is not tidiness. `ai-actions/ui.ts` and `ai-actions/layout.ts`
// need to know a panel's id, label and minimum size; if they reach that
// through the module that also holds the components, they pull in CodeEditor,
// which pulls in Monaco, which touches `window` at import time. Seven action
// test files died on `ReferenceError: window is not defined` the moment that
// import existed.
//
// So: metadata here, components in panels.tsx. Anything that only needs to
// reason about the layout imports this one.

import type { PanelMeta, PanelId } from './model'
import {
  basePanelId, instanceLabel, instanceNumber, isPanelInstance, makePanelInstanceId,
} from './instances'

export interface PanelInfo extends PanelMeta {
  /** What the user calls it — in the drag handle, in `layout:describe`, and in
   *  whatever the assistant says about it. */
  label: string
  /**
   * Panels whose open/closed state stays in their own store, because things
   * outside the layout write it — `usePlottingStore.addPlot` when a plot
   * arrives, `useSpatialStore.ensureOpen()` when a layer is added. The layout
   * mirrors those; see store/layout.ts for why that direction and not the other.
   */
  storeKey?: string
}

const BUILTIN: PanelInfo[] = [
  { id: 'environment', label: 'Environment', storeKey: 'environment', min: 120, defaultZone: 'left', defaultOrder: 0, defaultOpen: false },
  { id: 'packages', label: 'Packages', storeKey: 'packages', min: 120, defaultZone: 'left', defaultOrder: 1, defaultOpen: false },
  { id: 'databases', label: 'Databases', storeKey: 'databases', min: 120, defaultZone: 'left', defaultOrder: 2, defaultOpen: false },
  // The one panel the workspace cannot be without, and the one panel worth
  // having twice: it owns a SET of things — tabs — rather than one global
  // thing, so a second one is a second set of documents rather than a second
  // view of the same one.
  //
  // The Spatial Editor owns a set too (named map sessions) and the model below
  // is written for either, but its cap stays at 1: a second map is a second
  // tile stream, a second extent and a second answer to "which map did that
  // go to", and none of those are worth carrying until someone wants two maps
  // open at once. `maxInstances: 4` on the entry below is all it would take.
  { id: 'editor', label: 'Code editor', essential: true, maxInstances: 4, min: 120, defaultZone: 'center', defaultOrder: 0, defaultOpen: true },
  // `hostsTabs`: both of these already have a header row, so they draw the
  // pane's tabs in it rather than letting the zone add a second row above.
  { id: 'console', label: 'R console', hostsTabs: true, min: 80, defaultZone: 'bottom', defaultOrder: 0, defaultOpen: true },
  // Beside the console, and by default tabbed WITH it — see lib/terminal/
  // placement.ts. One instance: the panel owns a set of shell sessions with its
  // own tab strip, so "another terminal" is another tab rather than another
  // panel, exactly as another document is another editor tab.
  //
  // `essential` for the same reason the console needs no flag: there is no
  // toolbar button any more, so the TAB is how you reach the terminal, and a
  // closed terminal would be a panel with nothing left to open it. It costs
  // nothing to leave open — in a tabbed zone only the active panel renders, so
  // no shell is spawned until the tab is actually clicked. What `essential`
  // also buys is the migration: a layout.json written while the button existed
  // says `open.terminal: false`, and step 3 of `normalize` opens it on load
  // rather than stranding it.
  { id: 'terminal', label: 'Terminal', storeKey: 'terminal', essential: true, hostsTabs: true, min: 80, defaultZone: 'bottom', defaultOrder: 1, defaultOpen: true },
  { id: 'projectFiles', label: 'Project Files', hostsTabs: true, min: 120, defaultZone: 'bottom', defaultBeside: 'console', defaultOrder: 2, defaultOpen: true },
  { id: 'plots', label: 'Plots', storeKey: 'plots', min: 240, defaultZone: 'right', defaultOrder: 0, defaultOpen: false },
  { id: 'spatial', label: 'Spatial Editor', storeKey: 'spatial', min: 300, defaultZone: 'right', defaultOrder: 1, defaultOpen: false },
  { id: 'ai', label: 'AI Assistant', storeKey: 'ai', min: 280, defaultZone: 'right', defaultOrder: 2, defaultOpen: false },
  { id: 'help', label: 'Help', storeKey: 'help', min: 300, defaultZone: 'right', defaultOrder: 3, defaultOpen: false },
]

/** The panels ouRGeo ships. */
export const BUILTIN_PANEL_INFO: readonly PanelInfo[] = BUILTIN

const BUILTIN_IDS = new Set(BUILTIN.map((p) => p.id))

let live: PanelInfo[] = BUILTIN

/** The live list — shipped first, then plugin-contributed. Don't cache it. */
export function panelInfoList(): PanelInfo[] {
  return live
}

/**
 * The registry entry for a panel — including one that only this workspace has.
 *
 * `editor#2` is not IN the registry and never will be: the registry lists the
 * panels ouRGeo has, and a second editor exists because a user asked for one.
 * So its entry is derived from the original's, which is also what keeps the
 * two from drifting — a second editor has the editor's minimum size, the
 * editor's default zone and the editor's own open/closed state, by
 * construction.
 *
 * `essential` is deliberately dropped: the workspace needs AN editor, not this
 * one, and an instance that could not be removed would be a trap.
 */
export function panelInfo(id: PanelId): PanelInfo | undefined {
  const exact = live.find((p) => p.id === id)
  if (exact) return exact
  if (!isPanelInstance(id)) return undefined
  const n = instanceNumber(id)
  const base = live.find((p) => p.id === basePanelId(id))
  if (!base || n < 2 || n > (base.maxInstances ?? 1)) return undefined
  return { ...base, id, label: instanceLabel(base.label, n), essential: false }
}

/** How many of this panel may exist at once. 1 for everything but the code editor. */
export function panelMaxInstances(id: PanelId): number {
  return live.find((p) => p.id === basePanelId(id))?.maxInstances ?? 1
}

/** The panels a user can ask for a second of. */
export function multiInstancePanels(): PanelInfo[] {
  return live.filter((p) => (p.maxInstances ?? 1) > 1)
}

/** Labels by id, for `describeLayout` and anything writing prose about a panel. */
export function panelLabels(): Record<PanelId, string> {
  const out: Record<PanelId, string> = {}
  for (const p of live) out[p.id] = p.label
  return out
}

/**
 * Resolve a panel by id, or by the name a user would say it by.
 *
 * Instances resolve too, and by their spoken name as well as their id — a user
 * who has two editors says "the second editor", and the assistant relaying
 * that reaches for "Code editor 2" long before it reaches for `editor#2`.
 */
export function resolvePanelName(want: string): PanelInfo | undefined {
  const q = want.trim().toLowerCase()
  // Digits SURVIVE the squash, and that is the whole of it: dropping them made
  // "Code editor 2" squash to `codeeditor`, which is the FIRST editor — so the
  // spoken name for an added panel resolved, silently and confidently, to the
  // original. The trailing-number branch below never ran, because this line
  // had already answered.
  const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const exact = live.find((p) => p.id.toLowerCase() === q)
    ?? live.find((p) => p.label.toLowerCase() === q)
    ?? live.find((p) => squash(p.label) === squash(q))
  if (exact) return exact

  if (isPanelInstance(want.trim())) return panelInfo(want.trim())
  // "code editor 2" / "code editor 3" — a trailing number names an instance.
  const m = /^(.*?)\s*([2-9])$/.exec(want.trim())
  if (!m) return undefined
  const base = resolvePanelName(m[1])
  return base ? panelInfo(makePanelInstanceId(base.id, Number(m[2]))) : undefined
}

/** Replace every plugin-contributed panel, in one pass. Shipped ids win — a
 *  plugin cannot substitute its own component for the map. */
export function registerPluginPanelInfo(panels: PanelInfo[]): void {
  const kept: PanelInfo[] = []
  const seen = new Set<string>()
  for (const p of panels) {
    if (BUILTIN_IDS.has(p.id) || seen.has(p.id)) continue
    seen.add(p.id)
    kept.push(p)
  }
  live = kept.length === 0 ? BUILTIN : [...BUILTIN, ...kept]
}
