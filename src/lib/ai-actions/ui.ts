// Panels, dialogs, pointing, and the assistant's sense of where it is.
//
// The `always` tier lives almost entirely here: opening a panel changes nothing
// but what is on screen, and `ui:describe` is how the assistant orients itself
// before doing anything else — a model that has not looked will otherwise
// happily narrate a Contents panel that is closed.
//
// The AI panel is deliberately absent from both PANELS and DialogId. An
// assistant that can close its own panel can end the conversation it is having.

import { useUiStore, DIALOG_IDS, DIALOG_LABELS, type DialogId } from '@/store/ui'
import { useSpatialStore } from '@/store/spatial'
import { useLayoutStore } from '@/store/layout'
import { panelInfoList, panelLabels, resolvePanelName, type PanelInfo } from '@/lib/layout/panel-meta'
import { describeLayout, isOpen } from '@/lib/layout/model'
import { useEditorStore } from '@/store/editor'
import { useSessionStore } from '@/store/session'
import { useGeometryEditStore } from '@/store/geometryEdit'
import { useThemeStore } from '@/store/theme'
import { THEMES } from '@/lib/themes'
import { CODE_THEMES, MARKDOWN_THEMES } from '@/lib/editor-themes'
import { resolveThemeArg } from './theme'
import { languageOf, labelFor } from '@/lib/markdown/doc-kind'
import { hasTarget, targetListing, findTarget } from './targets'
import { ok, fail, argStr, argBool, type UiAction } from './types'

// The panels `ui:panel` will open and close.
//
// Derived from the panel registry rather than listed again — a plugin's panel
// is togglable the moment it is registered — but the AI panel is filtered out
// deliberately, and the editor with it. An assistant that can close its own
// panel can end the conversation it is having, and one that can close the
// editor can leave the user with nowhere to type.
const UNTOGGLABLE = new Set(['ai', 'editor'])

function togglablePanels(): PanelInfo[] {
  return panelInfoList().filter((p) => !UNTOGGLABLE.has(p.id))
}

function panelIds(): string[] {
  return togglablePanels().map((p) => p.id)
}

/** Resolve a panel the user named, refusing the two that are not togglable. */
function resolvePanel(want: string): PanelInfo | undefined {
  const hit = resolvePanelName(want)
  return hit && !UNTOGGLABLE.has(hit.id) ? hit : undefined
}

export const uiActions: UiAction[] = [
  {
    id: 'ui:panel',
    group: 'ui',
    tier: 'always',
    summary: 'Open, close or toggle one of the side panels.',
    params: [
      {
        name: 'panel', type: 'enum', valuesAt: panelIds, lenient: true, required: true,
        description: 'Which panel — its id or the name on its button.',
      },
      {
        name: 'state', type: 'enum', values: ['open', 'close', 'toggle'], default: 'open',
        description: 'What to do with it.',
      },
    ],
    run: (args) => {
      const want = argStr(args, 'panel')
      const panel = resolvePanel(want)
      if (!panel) return fail(`Unknown panel "${want}". Valid panels: ${panelIds().join(', ')}.`)
      const layoutStore = useLayoutStore.getState()
      const open = isOpen(layoutStore.layout, panel.id)
      const state = argStr(args, 'state', 'open')
      const shouldOpen = state === 'toggle' ? !open : state !== 'close'
      if (shouldOpen !== open) layoutStore.setPanelOpen(panel.id, shouldOpen)
      return ok(`${panel.label} panel is now ${shouldOpen ? 'open' : 'closed'}.`)
    },
  },

  {
    id: 'ui:openDialog',
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
    id: 'ui:closeDialog',
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
    id: 'ui:highlight',
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
      if (!hasTarget(target)) {
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
    id: 'ui:clearHighlight',
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
    id: 'ui:listTargets',
    group: 'ui',
    tier: 'always',
    summary: 'List every control ui:highlight can point at.',
    params: [],
    run: () => ok('Controls you can point at:', targetListing()),
  },

  // ── Switching themes ───────────────────────────────────────────────────
  //
  // `valuesAt`, not `values`. A theme the user built in the Theme Studio is
  // registered while the app is running, so a list captured at module load can
  // never contain it — and `validateArgs` runs BEFORE the action, so the call
  // was refused at the boundary and the handler below, which resolves against
  // the live registry, was never reached. Resolving the set on every call and
  // every listing is what makes "build a theme, then switch to it" work.
  //
  // `resolveThemeArg` then accepts the LABEL as well as the id, because a model
  // that has just named a theme "Half-Life 2" reaches for that name first.

  {
    id: 'ui:theme',
    group: 'ui',
    tier: 'always',
    summary: 'Switch the interface theme — including one the user (or you) built in the Theme Studio. Also resets the code and markdown editor themes to that theme\'s defaults.',
    params: [
      {
        name: 'theme', type: 'enum', valuesAt: () => Object.keys(THEMES),
        lenient: true, required: true,
        description: 'Theme id, or its name. Themes built in the Theme Studio are listed here as soon as they exist; theme:list shows them with their ids.',
      },
    ],
    run: (args) => {
      const hit = resolveThemeArg(argStr(args, 'theme'), THEMES)
      if (!hit) {
        return fail(
          `Unknown theme "${argStr(args, 'theme')}". Available: ${Object.keys(THEMES).join(', ')}.`,
        )
      }
      useThemeStore.getState().setTheme(hit.id)
      return ok(
        `Interface theme set to ${hit.label} (${hit.id}). Its code and markdown ` +
        `palettes were applied with it: ${hit.defaultCodeTheme} and ${hit.defaultMarkdownTheme}.`,
      )
    },
  },

  {
    id: 'ui:codeTheme',
    group: 'ui',
    tier: 'always',
    summary: "Switch the code editor's syntax colours — including a palette built in the Theme Studio. Leaves the interface theme, the editor background and its artwork alone.",
    params: [
      {
        name: 'theme', type: 'enum',
        valuesAt: () => ['default', ...Object.keys(CODE_THEMES)],
        lenient: true, required: true,
        description: 'Code theme id or name, or "default" to follow the interface theme. Palettes built in the Theme Studio are listed here as soon as they exist.',
      },
    ],
    run: (args) => {
      const raw = argStr(args, 'theme')
      const theme = useThemeStore.getState()
      if (raw === 'default') {
        const id = (THEMES[theme.current] ?? THEMES.dark).defaultCodeTheme
        theme.setCodeTheme(id)
        return ok(`Code editor theme set to the interface theme's default (${id}).`)
      }
      const hit = resolveThemeArg(raw, CODE_THEMES)
      if (!hit) {
        return fail(`Unknown code theme "${raw}". Available: default, ${Object.keys(CODE_THEMES).join(', ')}.`)
      }
      theme.setCodeTheme(hit.id)
      return ok(`Code editor theme set to ${hit.label} (${hit.id}).`)
    },
  },

  {
    id: 'ui:markdownTheme',
    group: 'ui',
    tier: 'always',
    summary: 'Switch the markdown editor\'s prose colours (headings, links, quotes, inline code) — including a palette built in the Theme Studio.',
    params: [
      {
        name: 'theme', type: 'enum',
        valuesAt: () => ['default', ...Object.keys(MARKDOWN_THEMES)],
        lenient: true, required: true,
        description: 'Markdown theme id or name, or "default" to follow the interface theme. Palettes built in the Theme Studio are listed here as soon as they exist.',
      },
    ],
    run: (args) => {
      const raw = argStr(args, 'theme')
      const theme = useThemeStore.getState()
      if (raw === 'default') {
        const id = (THEMES[theme.current] ?? THEMES.dark).defaultMarkdownTheme
        theme.setMarkdownTheme(id)
        return ok(`Markdown editor theme set to the interface theme's default (${id}).`)
      }
      const hit = resolveThemeArg(raw, MARKDOWN_THEMES)
      if (!hit) {
        return fail(`Unknown markdown theme "${raw}". Available: default, ${Object.keys(MARKDOWN_THEMES).join(', ')}.`)
      }
      theme.setMarkdownTheme(hit.id)
      return ok(`Markdown editor theme set to ${hit.label} (${hit.id}).`)
    },
  },

  {
    id: 'ui:zoom',
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
    id: 'ui:describe',
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
      const layout = useLayoutStore.getState().layout
      const labels = panelLabels()
      const shown = panelInfoList()
        .filter((p) => !UNTOGGLABLE.has(p.id) && isOpen(layout, p.id))
        .map((p) => p.label)
      const editor = useEditorStore.getState()
      const active = editor.getActiveTab()
      const spatial = useSpatialStore.getState()
      const session = useSessionStore.getState()
      const edit = useGeometryEditStore.getState()
      const dialog = useUiStore.getState().openDialog

      const lines = [
        `Panels open: ${shown.length ? shown.join(', ') : 'none (editor and console only)'}.`,
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
      // Recording is invisible from anywhere else the assistant can look, and
      // starting a second one or stopping the user's is worse than asking.
      if (session.isRecording) {
        const target = editor.tabs.find((t) => t.id === session.recordingTargetTabId)
        lines.push(`Console recording is ON, into "${target?.fileName ?? 'a closed document'}"` +
          `${session.recordingReturnOutput ? ', capturing output too' : ''}.`)
      } else {
        lines.push('Console recording is off.')
      }
      if (verbose) {
        lines.push(`Tabs: ${editor.tabs.map((t) => t.fileName).join(', ')}.`)
        lines.push('Layout:')
        lines.push(describeLayout(layout, panelInfoList(), labels))
      }
      return ok(lines.join('\n'))
    },
  },
]
