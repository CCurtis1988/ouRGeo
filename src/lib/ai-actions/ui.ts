// Panels, dialogs, pointing, and the assistant's sense of where it is.
//
// The `always` tier lives almost entirely here: opening a panel changes nothing
// but what is on screen, and `ui.describe` is how the assistant orients itself
// before doing anything else — a model that has not looked will otherwise
// happily narrate a Contents panel that is closed.
//
// The AI panel is deliberately absent from both PANELS and DialogId. An
// assistant that can close its own panel can end the conversation it is having.

import { useUiStore, DIALOG_IDS, DIALOG_LABELS, type DialogId } from '@/store/ui'
import { useEnvironmentStore } from '@/store/environment'
import { usePackagesStore } from '@/store/packages'
import { useDatabaseStore } from '@/store/database'
import { useSpatialStore } from '@/store/spatial'
import { usePlottingStore } from '@/store/plotting'
import { useHelpStore } from '@/store/help'
import { useEditorStore } from '@/store/editor'
import { useSessionStore } from '@/store/session'
import { useGeometryEditStore } from '@/store/geometryEdit'
import { useThemeStore } from '@/store/theme'
import { THEMES } from '@/lib/themes'
import { languageOf, labelFor } from '@/lib/markdown/doc-kind'
import { TARGET_IDS, targetListing, findTarget } from './targets'
import { ok, fail, argStr, argBool, type UiAction } from './types'

type PanelId = 'environment' | 'packages' | 'databases' | 'spatial' | 'plots' | 'help'

const PANELS: Record<PanelId, { label: string; isOpen: () => boolean; toggle: () => void }> = {
  environment: {
    label: 'Environment',
    isOpen: () => useEnvironmentStore.getState().isOpen,
    toggle: () => useEnvironmentStore.getState().toggleOpen(),
  },
  packages: {
    label: 'Packages',
    isOpen: () => usePackagesStore.getState().isOpen,
    toggle: () => usePackagesStore.getState().toggleOpen(),
  },
  databases: {
    label: 'Databases',
    isOpen: () => useDatabaseStore.getState().isOpen,
    toggle: () => useDatabaseStore.getState().toggleOpen(),
  },
  spatial: {
    label: 'Spatial Editor',
    isOpen: () => useSpatialStore.getState().isOpen,
    toggle: () => useSpatialStore.getState().toggleOpen(),
  },
  plots: {
    label: 'Plots',
    isOpen: () => usePlottingStore.getState().isOpen,
    toggle: () => usePlottingStore.getState().toggleOpen(),
  },
  help: {
    label: 'Help',
    isOpen: () => useHelpStore.getState().isOpen,
    toggle: () => useHelpStore.getState().toggleOpen(),
  },
}

const PANEL_IDS = Object.keys(PANELS) as PanelId[]

export const uiActions: UiAction[] = [
  {
    id: 'ui.panel',
    group: 'ui',
    tier: 'always',
    summary: 'Open, close or toggle one of the side panels.',
    params: [
      { name: 'panel', type: 'enum', values: PANEL_IDS, required: true, description: 'Which panel.' },
      {
        name: 'state', type: 'enum', values: ['open', 'close', 'toggle'], default: 'open',
        description: 'What to do with it.',
      },
    ],
    run: (args) => {
      const id = argStr(args, 'panel') as PanelId
      const panel = PANELS[id]
      if (!panel) return fail(`Unknown panel "${id}". Valid panels: ${PANEL_IDS.join(', ')}.`)
      const want = argStr(args, 'state', 'open')
      const isOpen = panel.isOpen()
      const shouldOpen = want === 'toggle' ? !isOpen : want !== 'close'
      if (shouldOpen !== isOpen) panel.toggle()
      return ok(`${panel.label} panel is now ${shouldOpen ? 'open' : 'closed'}.`)
    },
  },

  {
    id: 'ui.openDialog',
    group: 'ui',
    tier: 'always',
    summary: 'Open a dialog, popover or menu — the same one its button opens.',
    params: [
      { name: 'dialog', type: 'enum', values: DIALOG_IDS, required: true, description: 'Which dialog.' },
      {
        name: 'layer', type: 'string',
        description: 'For symbology and labeling: the layer id or name to open it on.',
      },
    ],
    run: (args) => {
      const id = argStr(args, 'dialog') as DialogId
      if (!DIALOG_IDS.includes(id)) {
        return fail(`Unknown dialog "${id}". Valid dialogs: ${DIALOG_IDS.join(', ')}.`)
      }
      // Symbology and labeling open ON a layer; without one they would render
      // empty, which reads as a broken dialog rather than a missing argument.
      let arg: string | null = null
      if (id === 'symbology' || id === 'raster-symbology' || id === 'labeling') {
        const wanted = argStr(args, 'layer')
        const layers = useSpatialStore.getState().layers
        const layer = layers.find((l) => l.id === wanted) ?? layers.find((l) => l.name === wanted)
        if (!layer) {
          return fail(
            `"${DIALOG_LABELS[id]}" opens on a layer. Pass layer=<id or name>. ` +
            `On the map now: ${layers.map((l) => l.name).join(', ') || '(no layers)'}.`
          )
        }
        arg = layer.id
      }
      // The spatial dialogs are useless behind a closed map.
      const spatialDialog = id.startsWith('map-') || id.startsWith('export-') ||
        ['symbology', 'raster-symbology', 'labeling', 'basemap', 'legend-settings',
         'north-arrow-settings', 'save-edits', 'select-menu'].includes(id)
      if (spatialDialog && !useSpatialStore.getState().isOpen) {
        useSpatialStore.getState().ensureOpen()
      }
      useUiStore.getState().showDialog(id, arg)
      return ok(`Opened "${DIALOG_LABELS[id]}".`)
    },
  },

  {
    id: 'ui.closeDialog',
    group: 'ui',
    tier: 'always',
    summary: 'Close whichever dialog is open.',
    params: [],
    run: () => {
      const open = useUiStore.getState().openDialog
      useUiStore.getState().hideDialog()
      return ok(open ? `Closed "${DIALOG_LABELS[open]}".` : 'No dialog was open.')
    },
  },

  {
    id: 'ui.highlight',
    group: 'ui',
    tier: 'always',
    summary:
      'Point at a control: draw a ring around it with a short note, and let the user click it. ' +
      'Prefer this to doing it yourself when the user is learning where things are.',
    params: [
      { name: 'target', type: 'string', required: true, description: 'A control id from the catalogue.' },
      { name: 'message', type: 'string', description: 'Short callout text shown beside the ring.' },
    ],
    run: (args) => {
      const target = argStr(args, 'target')
      if (!TARGET_IDS.has(target)) {
        return fail(`Unknown control "${target}". Controls you can point at:\n${targetListing()}`)
      }
      const info = findTarget(target)
      useUiStore.getState().setHighlight({ target, message: argStr(args, 'message') || undefined })
      return ok(
        `Pointing at "${info?.label}" (${info?.where}). It clears when the user clicks, ` +
        'presses Escape, or after 30 seconds.'
      )
    },
  },

  {
    id: 'ui.clearHighlight',
    group: 'ui',
    tier: 'always',
    summary: 'Stop pointing at a control.',
    params: [],
    run: () => {
      useUiStore.getState().setHighlight(null)
      return ok('Highlight cleared.')
    },
  },

  {
    id: 'ui.listTargets',
    group: 'ui',
    tier: 'always',
    summary: 'List every control ui.highlight can point at.',
    params: [],
    run: () => ok('Controls you can point at:', targetListing()),
  },

  {
    id: 'ui.theme',
    group: 'ui',
    tier: 'always',
    summary: 'Switch the interface theme.',
    params: [
      {
        name: 'theme', type: 'enum', values: Object.keys(THEMES), required: true,
        description: 'Theme id.',
      },
    ],
    run: (args) => {
      const id = argStr(args, 'theme')
      if (!(id in THEMES)) {
        return fail(`Unknown theme "${id}". Available: ${Object.keys(THEMES).join(', ')}.`)
      }
      useThemeStore.getState().setTheme(id)
      return ok(`Theme set to ${id}.`)
    },
  },

  {
    id: 'ui.zoom',
    group: 'ui',
    tier: 'always',
    summary: 'Zoom the interface in or out (the Ctrl+Shift+= / Ctrl+Shift+- shortcuts).',
    params: [
      { name: 'direction', type: 'enum', values: ['in', 'out'], required: true, description: 'Which way.' },
    ],
    run: (args) => {
      const dir = argStr(args, 'direction')
      const theme = useThemeStore.getState()
      if (dir === 'in') theme.zoomIn()
      else if (dir === 'out') theme.zoomOut()
      else return fail('direction must be "in" or "out".')
      return ok(`Interface zoomed ${dir}. Scale is now ${useThemeStore.getState().uiScale}.`)
    },
  },

  {
    id: 'ui.describe',
    group: 'ui',
    tier: 'always',
    summary:
      'What the interface looks like right now: open panels, the active document, map layers, ' +
      'staged edits. Read this before narrating what the user can see.',
    params: [
      { name: 'verbose', type: 'boolean', default: false, description: 'Include every open tab and layer.' },
    ],
    run: (args) => {
      const verbose = argBool(args, 'verbose')
      const openPanels = PANEL_IDS.filter((p) => PANELS[p].isOpen()).map((p) => PANELS[p].label)
      const editor = useEditorStore.getState()
      const active = editor.getActiveTab()
      const spatial = useSpatialStore.getState()
      const session = useSessionStore.getState()
      const edit = useGeometryEditStore.getState()
      const dialog = useUiStore.getState().openDialog

      const lines = [
        `Panels open: ${openPanels.length ? openPanels.join(', ') : 'none (editor and console only)'}.`,
        dialog ? `Dialog open: ${DIALOG_LABELS[dialog]}.` : 'No dialog open.',
        active
          ? `Active document: "${active.fileName}" (${labelFor(languageOf(active))}${active.isDirty ? ', unsaved changes' : ''}).`
          : 'No document open.',
        `Open tabs: ${editor.tabs.length}.`,
        `R: ${session.rStatus}; working directory ${session.workingDir ?? 'unknown'}.`,
        spatial.layers.length > 0
          ? `Map layers (${spatial.layers.length}): ${spatial.layers.map((l) => `${l.name}${l.visible ? '' : ' (hidden)'}`).join(', ')}.`
          : 'No layers on the map.',
        edit.isEditMode ? `Edit mode is ON, tool "${edit.activeToolId ?? 'none'}".` : 'Edit mode is off.',
      ]
      const pending = Object.values(spatial.pendingGeometryEdits).reduce((n, e) => n + e.length, 0)
      if (pending > 0) lines.push(`${pending} unsaved geometry edit(s) staged.`)
      if (verbose) {
        lines.push(`Tabs: ${editor.tabs.map((t) => t.fileName).join(', ')}.`)
      }
      return ok(lines.join('\n'))
    },
  },
]
