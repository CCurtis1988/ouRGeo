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
  // The one panel the workspace cannot be without.
  // The two panels that own a SET of things rather than one global thing —
  // tabs and map sessions — and are therefore the two worth having twice.
  { id: 'editor', label: 'Code editor', essential: true, maxInstances: 4, min: 120, defaultZone: 'center', defaultOrder: 0, defaultOpen: true },
  { id: 'console', label: 'R console', min: 80, defaultZone: 'bottom', defaultOrder: 0, defaultOpen: true },
  { id: 'plots', label: 'Plots', storeKey: 'plots', min: 240, defaultZone: 'right', defaultOrder: 0, defaultOpen: false },
  { id: 'spatial', label: 'Spatial Editor', storeKey: 'spatial', maxInstances: 4, min: 300, defaultZone: 'right', defaultOrder: 1, defaultOpen: false },
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
 * two from drifting — a second map has the map's minimum size, the map's
 * default zone and the map's own open/closed state, by construction.
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

/** How many of this panel may exist at once. 1 for all but the editor and the map. */
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
 * who has two maps says "the second map", and the assistant relaying that
 * reaches for "Spatial Editor 2" long before it reaches for `spatial#2`.
 */
export function resolvePanelName(want: string): PanelInfo | undefined {
  const q = want.trim().toLowerCase()
  const squash = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, '')
  const exact = live.find((p) => p.id.toLowerCase() === q)
    ?? live.find((p) => p.label.toLowerCase() === q)
    ?? live.find((p) => squash(p.label) === squash(q))
  if (exact) return exact

  if (isPanelInstance(want.trim())) return panelInfo(want.trim())
  // "spatial editor 2" / "code editor 3" — a trailing number names an instance.
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
