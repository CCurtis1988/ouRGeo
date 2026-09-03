// The workspace layout: which panels are where, how big, and in what order.
//
// ── Who owns "open" ────────────────────────────────────────────────────────
//
// Not this store, for the seven panels that have a feature store of their own.
// `usePlottingStore.addPlot` sets `isOpen: true` when a plot arrives;
// `useSpatialStore.ensureOpen()` runs when a layer is added; `useHelpStore`
// opens itself when the user types `?lm` in the console. Those are the right
// place for that decision, and moving it here would mean every one of them
// reaching across into the layout.
//
// So the feature store stays the owner and this store MIRRORS it: one
// subscription per panel, one direction only. `setPanelOpen` writes to the
// feature store, never to the mirror, so there is exactly one writer per panel
// and the mirror can never disagree with the panel that is actually rendered.
// Panels with no store of their own (the editor, the console) are owned here.
//
// `init` is the ONE moment the direction reverses: a restored layout.json says
// which panels were open, and it has to push that into the feature stores,
// which all start closed. Getting this backwards is not subtle — the file
// loads, the mirror is immediately overwritten with seven `false`s, and the
// workspace comes back empty every launch while layout.json sits on disk
// saying otherwise.

import { create } from 'zustand'
import {
  defaultLayout, normalize, movePanel, reorderPanel, setPanelOpen as setOpenIn,
  setZoneSize as setZoneSizeIn, setPanelShare as setPanelShareIn,
  splitPanels as splitPanelsIn, evenPanels as evenPanelsIn,
  setZoneMode as setZoneModeIn, setZoneAxis as setZoneAxisIn,
  setActivePanel as setActiveIn, setToolbar as setToolbarIn,
  type LayoutState, type PanelId, type ZoneAxis, type ZoneId, type ZoneMode, type ToolbarState,
} from '@/lib/layout/model'
import { panelInfoList } from '@/lib/layout/panel-meta'
import { loadLayout, saveLayoutFile, loadPresets, type LayoutPreset } from '@/lib/layout-persistence'
import { useEnvironmentStore } from './environment'
import { usePackagesStore } from './packages'
import { useDatabaseStore } from './database'
import { useSpatialStore } from './spatial'
import { usePlottingStore } from './plotting'
import { useAiStore } from './ai'
import { useHelpStore } from './help'

/** How the layout reaches a panel's own open/closed state. */
interface PanelStoreAdapter {
  isOpen: () => boolean
  setOpen: (open: boolean) => void
  subscribe: (fn: () => void) => () => void
}

function adapt(
  store: { getState: () => { isOpen: boolean; toggleOpen: () => void }; subscribe: (fn: () => void) => () => void },
): PanelStoreAdapter {
  return {
    isOpen: () => store.getState().isOpen,
    // Expressed as a toggle because that is the one setter every panel store
    // has. The three that also have a direct setter gain nothing from it here.
    setOpen: (open) => { if (store.getState().isOpen !== open) store.getState().toggleOpen() },
    subscribe: (fn) => store.subscribe(fn),
  }
}

const PANEL_STORES: Record<string, PanelStoreAdapter> = {
  environment: adapt(useEnvironmentStore),
  packages: adapt(usePackagesStore),
  databases: adapt(useDatabaseStore),
  spatial: adapt(useSpatialStore),
  plots: adapt(usePlottingStore),
  ai: adapt(useAiStore),
  help: adapt(useHelpStore),
}

const DEBOUNCE_MS = 400

let saveTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Persist the layout shortly.
 *
 * Module scope, not inside the store, because there are TWO writers: the
 * operations below, and `syncFromPanelStores` mirroring a panel that opened
 * itself. The first version scheduled a save only from the operations, so
 * opening a panel from the toolbar changed the layout and never wrote it —
 * layout.json stayed absent until something was dragged.
 */
function save(): Promise<void> {
  const { layout, presets } = useLayoutStore.getState()
  return saveLayoutFile(layout, presets)
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { void save() }, DEBOUNCE_MS)
}

/**
 * Write the layout now, cancelling any pending debounce.
 *
 * Called on `beforeunload`. The workspace savers deliberately have NO such
 * flush, because theirs would race the `will-quit` handler deleting the very
 * files they write; layout.json is on the preference side of that split and is
 * never deleted, so flushing it is safe — and without it the last 400ms of
 * arranging is lost every time, which for a drag that ends on a click of the
 * close button is the whole change.
 */
export function flushLayout(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  return save()
}

interface LayoutStoreState {
  layout: LayoutState
  presets: LayoutPreset[]
  /** False until `init()` has read layout.json — the render uses the defaults
   *  meanwhile rather than flashing an empty workspace. */
  loaded: boolean

  init: () => Promise<void>
  setPanelOpen: (panel: PanelId, open: boolean) => void
  togglePanel: (panel: PanelId) => void
  movePanel: (panel: PanelId, zone: ZoneId, index?: number) => void
  reorderPanel: (panel: PanelId, index: number) => void
  setZoneSize: (zone: ZoneId, size: number) => void
  /** Give one panel `share` (0–1) of its zone, the rest keeping their
   *  proportions. */
  setPanelShare: (panel: PanelId, share: number) => void
  /** Move the boundary between two adjacent panels — `before` takes `share`
   *  of what the pair holds between them. */
  splitPanels: (before: PanelId, after: PanelId, share: number) => void
  /** Share a zone out evenly again. */
  evenPanels: (zone: ZoneId) => void
  setZoneMode: (zone: ZoneId, mode: ZoneMode) => void
  setZoneAxis: (zone: ZoneId, axis: ZoneAxis) => void
  setActivePanel: (panel: PanelId) => void
  setToolbar: (patch: Partial<ToolbarState>) => void
  reset: () => void

  savePreset: (name: string) => Promise<void>
  applyPreset: (name: string) => boolean
  deletePreset: (name: string) => Promise<void>
}

export const useLayoutStore = create<LayoutStoreState>((set, get) => {
  /** Apply a pure operation, re-normalize, and schedule a save.
   *  Everything that changes the layout goes through here, so `normalize`'s
   *  invariants hold after an assistant's call as much as after a drag. */
  const apply = (fn: (l: LayoutState) => LayoutState): void => {
    const next = normalize(fn(get().layout), panelInfoList())
    set({ layout: next })
    scheduleSave()
  }

  return {
    layout: defaultLayout(panelInfoList()),
    presets: [],
    loaded: false,

    init: async () => {
      if (get().loaded) return
      const [stored, presets] = await Promise.all([loadLayout(), loadPresets()])
      const base = normalize(stored ?? defaultLayout(panelInfoList()), panelInfoList())
      set({ layout: base, presets, loaded: true })
      // Restore, then hand ownership back: every subsequent change flows
      // feature store → mirror. Panels that opened themselves while the file
      // was being read (the console printing a plot on startup) are picked up
      // by the sync these calls trigger.
      for (const [id, store] of Object.entries(PANEL_STORES)) {
        store.setOpen(base.open[id] ?? false)
      }
    },

    setPanelOpen: (panel, open) => {
      const store = PANEL_STORES[panel]
      if (store) { store.setOpen(open); return }   // the mirror follows
      apply((l) => setOpenIn(l, panel, open))
    },

    togglePanel: (panel) => {
      const store = PANEL_STORES[panel]
      if (store) { store.setOpen(!store.isOpen()); return }
      apply((l) => setOpenIn(l, panel, !l.open[panel]))
    },

    movePanel: (panel, zone, index) => {
      apply((l) => movePanel(l, panel, zone, index))
      // `movePanel` opens the panel; push that through the owner too, or the
      // mirror and the feature store would disagree on the next sync.
      PANEL_STORES[panel]?.setOpen(true)
    },

    reorderPanel: (panel, index) => apply((l) => reorderPanel(l, panel, index)),
    setZoneSize: (zone, size) => apply((l) => setZoneSizeIn(l, zone, size)),
    setPanelShare: (panel, share) => apply((l) => setPanelShareIn(l, panel, share)),
    splitPanels: (before, after, share) => apply((l) => splitPanelsIn(l, before, after, share)),
    evenPanels: (zone) => apply((l) => evenPanelsIn(l, zone)),
    setZoneMode: (zone, mode) => apply((l) => setZoneModeIn(l, zone, mode)),
    setZoneAxis: (zone, axis) => apply((l) => setZoneAxisIn(l, zone, axis)),

    setActivePanel: (panel) => {
      apply((l) => setActiveIn(l, panel))
      PANEL_STORES[panel]?.setOpen(true)
    },

    setToolbar: (patch) => apply((l) => setToolbarIn(l, patch)),

    reset: () => {
      const fresh = defaultLayout(panelInfoList())
      for (const [id, store] of Object.entries(PANEL_STORES)) {
        store.setOpen(fresh.open[id] ?? false)
      }
      apply(() => fresh)
    },

    savePreset: async (name) => {
      const presets = [
        ...get().presets.filter((p) => p.name.toLowerCase() !== name.trim().toLowerCase()),
        { name: name.trim(), layout: get().layout },
      ]
      set({ presets })
      await save()
    },

    applyPreset: (name) => {
      const hit = get().presets.find((p) => p.name.toLowerCase() === name.trim().toLowerCase())
      if (!hit) return false
      for (const [id, store] of Object.entries(PANEL_STORES)) {
        store.setOpen(hit.layout.open[id] ?? false)
      }
      apply(() => hit.layout)
      return true
    },

    deletePreset: async (name) => {
      const presets = get().presets.filter((p) => p.name.toLowerCase() !== name.trim().toLowerCase())
      set({ presets })
      await save()
    },
  }
})

/** Copy every feature store's `isOpen` into the mirror, in one `set`. */
function syncFromPanelStores(): void {
  const layout = useLayoutStore.getState().layout
  const open = { ...layout.open }
  let changed = false
  for (const [id, store] of Object.entries(PANEL_STORES)) {
    const v = store.isOpen()
    if (open[id] !== v) { open[id] = v; changed = true }
  }
  if (!changed) return
  useLayoutStore.setState({ layout: normalize({ ...layout, open }, panelInfoList()) })
  // Only once the initial read has happened: a sync during startup would write
  // the defaults over the file we are in the middle of loading.
  if (useLayoutStore.getState().loaded) scheduleSave()
}

// One subscription per panel store, established once at import. They are never
// torn down — these stores live as long as the renderer does — and each one
// only ever writes the mirror, so there is no path back into the feature store
// and therefore no loop.
for (const store of Object.values(PANEL_STORES)) {
  store.subscribe(syncFromPanelStores)
}

// A reload (Ctrl+R, or the main process recovering a dead renderer) is not a
// quit and never reaches App's before-quit handler, so flush here as well.
// Guarded because this module is imported by node-environment tests.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => { void flushLayout() })
}
