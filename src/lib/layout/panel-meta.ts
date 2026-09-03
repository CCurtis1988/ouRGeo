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
  { id: 'editor', label: 'Code editor', essential: true, min: 120, defaultZone: 'center', defaultOrder: 0, defaultOpen: true },
  { id: 'console', label: 'R console', min: 80, defaultZone: 'bottom', defaultOrder: 0, defaultOpen: true },
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

export function panelInfo(id: PanelId): PanelInfo | undefined {
  return live.find((p) => p.id === id)
}

/** Labels by id, for `describeLayout` and anything writing prose about a panel. */
export function panelLabels(): Record<PanelId, string> {
  const out: Record<PanelId, string> = {}
  for (const p of live) out[p.id] = p.label
  return out
}

/** Resolve a panel by id, or by the name a user would say it by. */
export function resolvePanelName(want: string): PanelInfo | undefined {
  const q = want.trim().toLowerCase()
  const squash = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, '')
  return live.find((p) => p.id.toLowerCase() === q)
    ?? live.find((p) => p.label.toLowerCase() === q)
    ?? live.find((p) => squash(p.label) === squash(q))
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
