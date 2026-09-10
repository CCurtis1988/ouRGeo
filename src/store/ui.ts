import { create } from 'zustand'

// Which dialog is open, and what the assistant is pointing at.
//
// Every dialog in the app used to be a `useState(false)` inside whichever
// component rendered it — EditorLayout for the Toolbox and Load Data,
// SpatialRibbon for symbology and the map settings. That is the right shape
// when the only thing that can open a dialog is a button three lines above it,
// and the wrong shape the moment anything OUTSIDE the component needs to: the
// AI assistant driving the GUI for a tutorial, a deep link, a keyboard command.
//
// So dialog visibility moves here. The components still own their contents and
// their close behaviour; they just read `openDialog` instead of a local flag.
//
// `dialogArg` carries the one piece of context a dialog needs to open ON
// something — the layer whose symbology to edit, the provider to show in the
// Data Connector. It is deliberately a single string: a dialog that needs more
// than that should read it from its own store.
//
// AddFeaturesDialog is NOT listed here. Its open state already lives in the
// spatial store (`addFeaturesDialogOpen`), and two sources of truth for one
// dialog is how a dialog ends up half-open.

/** Dialogs and popovers the app can be asked to open. */
export type DialogId =
  // Toolbar (EditorLayout)
  | 'load-data'
  | 'data-connector'
  | 'toolbox'
  | 'settings'
  | 'theme-studio'
  | 'plugins'
  | 'plugin-store'
  | 'plugin-submit'
  | 'recording'
  | 'voice-model'
  // Spatial ribbon
  | 'map-contents'
  | 'map-settings'
  | 'select-menu'
  | 'symbology'
  | 'raster-symbology'
  | 'labeling'
  | 'basemap'
  | 'legend-settings'
  | 'north-arrow-settings'
  | 'save-edits'
  // Export dropdown
  | 'export-menu'
  | 'export-image'
  | 'export-code-tmap'
  | 'export-code-ggplot'

export const DIALOG_IDS: DialogId[] = [
  'load-data', 'data-connector', 'toolbox', 'settings', 'theme-studio', 'plugins', 'plugin-store', 'plugin-submit',
  'recording', 'voice-model',
  'map-contents', 'map-settings', 'select-menu', 'symbology', 'raster-symbology',
  'labeling', 'basemap', 'legend-settings', 'north-arrow-settings', 'save-edits',
  'export-menu', 'export-image', 'export-code-tmap', 'export-code-ggplot',
]

/** Human labels, for confirmation prompts and receipts. */
export const DIALOG_LABELS: Record<DialogId, string> = {
  'load-data': 'Load Data',
  'data-connector': 'Data Connector',
  'toolbox': 'Toolbox',
  'settings': 'Settings',
  'theme-studio': 'Theme Studio',
  'plugins': 'Plugins',
  'plugin-store': 'Plugin Store',
  'plugin-submit': 'Publish to the plugin store',
  'recording': 'Record Console',
  'voice-model': 'Speech model',
  'map-contents': 'Contents',
  'map-settings': 'Map Settings',
  'select-menu': 'Selection mode',
  'symbology': 'Symbology',
  'raster-symbology': 'Raster Symbology',
  'labeling': 'Label settings',
  'basemap': 'Change basemap',
  'legend-settings': 'Legend settings',
  'north-arrow-settings': 'North Arrow settings',
  'save-edits': 'Save Edits',
  'export-menu': 'Export',
  'export-image': 'Export to IMG',
  'export-code-tmap': 'Export to tmap',
  'export-code-ggplot': 'Export to ggplot',
}

/** A control the assistant can point at. Resolved against `data-ourgeo-id`. */
export interface UiHighlight {
  target: string
  /** Callout text shown beside the ring. */
  message?: string
}

/**
 * A destructive action the assistant wants to run, waiting on the user.
 *
 * The resolver lives in the store because the tool call is BLOCKED on it: the
 * model is mid-turn, and the answer has to travel back to the awaited promise,
 * not to a later render.
 */
export interface PendingConfirm {
  actionId: string
  summary: string
  /** The arguments, rendered for the dialog. */
  details: string
  resolve: (allowed: boolean) => void
}

interface UiState {
  openDialog: DialogId | null
  dialogArg: string | null
  highlight: UiHighlight | null
  confirm: PendingConfirm | null

  showDialog: (id: DialogId, arg?: string | null) => void
  /** Close `id`, or whatever is open when called with no argument. Passing an
   *  id that is not the open one is a no-op, so a dialog's own onOpenChange(false)
   *  can never close a dialog that replaced it. */
  hideDialog: (id?: DialogId) => void
  setHighlight: (h: UiHighlight | null) => void
  /** Ask the user to allow one action. Resolves false if they decline or close. */
  askConfirm: (req: Omit<PendingConfirm, 'resolve'>) => Promise<boolean>
  answerConfirm: (allowed: boolean) => void
}

export const useUiStore = create<UiState>((set, get) => ({
  openDialog: null,
  dialogArg: null,
  highlight: null,
  confirm: null,

  showDialog: (id, arg = null) => set({ openDialog: id, dialogArg: arg }),

  hideDialog: (id) =>
    set((s) => (id === undefined || s.openDialog === id
      ? { openDialog: null, dialogArg: null }
      : s)),

  setHighlight: (highlight) => set({ highlight }),

  askConfirm: (req) => new Promise<boolean>((resolve) => {
    // A second request while one is open denies the first rather than losing
    // it — the model must never be left awaiting a dialog that is gone.
    const existing = get().confirm
    if (existing) existing.resolve(false)
    set({ confirm: { ...req, resolve } })
  }),

  answerConfirm: (allowed) => {
    const pending = get().confirm
    set({ confirm: null })
    pending?.resolve(allowed)
  },
}))

/** Read helper for components: `open={dialogOpen('toolbox')}` reads better than
 *  a store selector comparison at every call site. */
export function isDialogOpen(id: DialogId): boolean {
  return useUiStore.getState().openDialog === id
}
