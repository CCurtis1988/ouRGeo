// Rearranging the workspace.
//
// The assistant can be asked to do this in prose — "put the map on the left",
// "give me more room for the console", "hide the buttons I never use" — and
// until the layout was a value there was nothing it could do but describe where
// the dividers are. Now every one of those is one call.
//
// Everything here is `always` except the two that write a file. Moving a panel
// changes what is on screen and nothing else; it is undoable by moving it back,
// and `layout:reset` is always the way out. Gating that behind Autopilot would
// mean a user with Autopilot off could not have the interface adjusted for
// them, which is exactly the user most likely to want it.

import { useLayoutStore } from '@/store/layout'
import {
  panelInfoList, panelInfo, panelLabels, panelMaxInstances, multiInstancePanels,
  resolvePanelName,
} from '@/lib/layout/panel-meta'
import { basePanelId, isPanelInstance } from '@/lib/layout/instances'
import { placedPanelIds } from '@/lib/panel-content'
import { addPanelInstance, removalSummary, removePanelInstance } from '@/lib/panel-instances'
import { toolbarButtons, resolveToolbar } from '@/lib/layout/toolbar'
import {
  describeLayout, zoneOf, isOpen, openPanels, shareOf, ZONE_IDS, ZONE_LABELS,
  type PanelId, type ZoneId,
} from '@/lib/layout/model'
import { ok, fail, argStr, argNum, argBool, argList, type UiAction } from './types'

function resolvePanel(want: string): { id: PanelId; label: string } | null {
  const hit = resolvePanelName(want)
  return hit ? { id: hit.id, label: hit.label } : null
}

/**
 * Every panel that exists right now, instances included.
 *
 * Resolved at CALL time, not captured at module load: a second editor is
 * created while the app is running, and a fixed list would have `validateArgs`
 * refusing `editor#2` before the handler that knows about it ever ran — the
 * same trap the theme actions walked into with a captured `Object.keys(THEMES)`.
 */
function panelIds(): string[] {
  const placed = placedPanelIds(useLayoutStore.getState().layout)
  return [...new Set([...panelInfoList().map((p) => p.id), ...placed.filter(isPanelInstance)])]
}

function unknownPanel(want: string): string {
  const names = panelIds().map((id) => `${id} (${panelInfo(id)?.label ?? id})`)
  return `No panel called "${want}". Panels: ${names.join(', ')}.`
}

function presetNames(): string[] {
  return useLayoutStore.getState().presets.map((p) => p.name)
}

/** What the layout looks like after a change, for the result message — the
 *  assistant should be able to tell the user what happened without a second
 *  call to `layout:describe`. */
function summary(): string {
  const { layout } = useLayoutStore.getState()
  return describeLayout(layout, panelInfoList(), panelLabels())
}

export const layoutActions: UiAction[] = [
  {
    id: 'layout:describe',
    group: 'layout',
    tier: 'always',
    summary:
      'Where every panel is, how big each zone is, and what is closed. Read this before moving ' +
      'anything — the user may already have the arrangement they are asking for.',
    params: [],
    run: () => {
      const zones = ZONE_IDS.map((z) => `${z} (${ZONE_LABELS[z]})`).join(', ')
      return ok('Current layout:', `${summary()}\n\nZones you can move a panel to: ${zones}.`)
    },
  },

  {
    id: 'layout:movePanel',
    group: 'layout',
    tier: 'always',
    summary:
      'Move a panel into a zone. This also opens it — being asked to move something and leaving ' +
      'it invisible is not the request.',
    params: [
      {
        name: 'panel', type: 'enum', valuesAt: panelIds, lenient: true, required: true,
        description: 'Which panel — its id, or the name the user calls it.',
      },
      {
        name: 'zone', type: 'enum', values: ZONE_IDS, required: true,
        description: 'left, center, right or bottom.',
      },
      {
        name: 'index', type: 'number',
        description: 'Position within the zone, 0 first. Omit to put it last.',
      },
    ],
    run: (args) => {
      const want = argStr(args, 'panel')
      const panel = resolvePanel(want)
      if (!panel) return fail(unknownPanel(want))
      const zone = argStr(args, 'zone') as ZoneId
      if (!ZONE_IDS.includes(zone)) {
        return fail(`No zone called "${zone}". Zones: ${ZONE_IDS.join(', ')}.`)
      }
      const index = args.index === undefined || args.index === '' ? undefined : argNum(args, 'index', 0)
      useLayoutStore.getState().movePanel(panel.id, zone, index)
      return ok(`Moved ${panel.label} to the ${ZONE_LABELS[zone].toLowerCase()}.`, summary())
    },
  },

  {
    id: 'layout:setPanelSize',
    group: 'layout',
    tier: 'always',
    summary:
      'Give one panel a percentage of its zone — width in a side-by-side zone, height in a ' +
      'stacked one. The other panels there keep their proportions relative to each other. ' +
      'Panels sharing a zone start off equal (two take half each, three a third each), so this ' +
      'is only needed when the user wants one of them bigger.',
    params: [
      {
        name: 'panel', type: 'enum', valuesAt: panelIds, lenient: true, required: true,
        description: 'Which panel.',
      },
      {
        name: 'percent', type: 'number', required: true,
        description: 'Share of its zone, 2–98. Not pixels — a zone divides in proportion.',
      },
    ],
    run: (args) => {
      const want = argStr(args, 'panel')
      const panel = resolvePanel(want)
      if (!panel) return fail(unknownPanel(want))
      const store = useLayoutStore.getState()
      const zone = zoneOf(store.layout, panel.id)
      if (!zone) return fail(`${panel.label} is not placed in any zone.`)
      if (!isOpen(store.layout, panel.id)) {
        return fail(`${panel.label} is closed, so it has no share of the ${ZONE_LABELS[zone].toLowerCase()}. ` +
          'Open it first — layout:movePanel does both.')
      }
      if (openPanels(store.layout, zone).length < 2) {
        return fail(`${panel.label} is the only panel open in the ${ZONE_LABELS[zone].toLowerCase()}, so it ` +
          `already has all of it. Resize the zone itself with layout:setZoneSize, or open another panel there.`)
      }
      const asked = argNum(args, 'percent', 50)
      store.setPanelShare(panel.id, asked / 100)
      // Read the result back rather than echoing the request: a minimum, or
      // the cap on a single panel's weight, may have had the last word.
      const got = Math.round(shareOf(useLayoutStore.getState().layout, panel.id) * 100)
      const def = panelInfo(panel.id)
      const note = Math.abs(got - Math.round(asked)) > 1
        ? ` (asked for ${Math.round(asked)}%${def ? `; it will not go below ${def.min}px on screen` : ''})` : ''
      return ok(`${panel.label} now has ${got}% of the ${ZONE_LABELS[zone].toLowerCase()}${note}.`, summary())
    },
  },

  {
    id: 'layout:evenPanels',
    group: 'layout',
    tier: 'always',
    summary:
      'Share a zone out equally again, undoing whatever was dragged or set there. This is how a ' +
      'zone starts every session; the user can also double-click a divider to get it back.',
    params: [
      { name: 'zone', type: 'enum', values: ZONE_IDS, required: true, description: 'Which zone.' },
    ],
    run: (args) => {
      const zone = argStr(args, 'zone') as ZoneId
      if (!ZONE_IDS.includes(zone)) return fail(`No zone called "${zone}". Zones: ${ZONE_IDS.join(', ')}.`)
      useLayoutStore.getState().evenPanels(zone)
      return ok(`${ZONE_LABELS[zone]} is shared equally.`, summary())
    },
  },

  {
    id: 'layout:setZoneSize',
    group: 'layout',
    tier: 'always',
    summary:
      'Resize a whole zone — the width of the left or right column, the height of the bottom strip. ' +
      'The centre has no size of its own; it takes whatever is left.',
    params: [
      { name: 'zone', type: 'enum', values: ['left', 'right', 'bottom'], required: true, description: 'Which zone.' },
      { name: 'size', type: 'number', required: true, description: 'Pixels.' },
    ],
    run: (args) => {
      // `center` is absent from the enum, so `validateArgs` has already
      // refused it by name — and the summary above says why. Nothing to
      // re-check here.
      const zone = argStr(args, 'zone') as ZoneId
      useLayoutStore.getState().setZoneSize(zone, argNum(args, 'size', 300))
      const applied = useLayoutStore.getState().layout.zones[zone].size
      return ok(`${ZONE_LABELS[zone]} is now ${Math.round(applied)}px.`)
    },
  },

  {
    id: 'layout:setZoneMode',
    group: 'layout',
    tier: 'always',
    summary:
      'Make a zone show its panels side by side (split) or one at a time behind tabs. Tabs are how ' +
      'a user gets full height for a panel without closing the others.',
    params: [
      { name: 'zone', type: 'enum', values: ZONE_IDS, required: true, description: 'Which zone.' },
      { name: 'mode', type: 'enum', values: ['split', 'tabs'], required: true, description: 'How to share the space.' },
      {
        name: 'axis', type: 'enum', values: ['row', 'col'],
        description: 'For split: run them across (row) or down (col). Ignored for tabs.',
      },
    ],
    run: (args) => {
      const zone = argStr(args, 'zone') as ZoneId
      if (!ZONE_IDS.includes(zone)) return fail(`No zone called "${zone}". Zones: ${ZONE_IDS.join(', ')}.`)
      const mode = argStr(args, 'mode') === 'tabs' ? 'tabs' : 'split'
      const store = useLayoutStore.getState()
      store.setZoneMode(zone, mode)
      const axis = argStr(args, 'axis')
      if (axis === 'row' || axis === 'col') store.setZoneAxis(zone, axis)
      return ok(`${ZONE_LABELS[zone]} is now ${mode === 'tabs' ? 'tabbed' : 'split'}.`, summary())
    },
  },

  {
    id: 'layout:showTab',
    group: 'layout',
    tier: 'always',
    summary: 'Bring a panel to the front in a tabbed zone. Opens it if it was closed.',
    params: [
      {
        name: 'panel', type: 'enum', valuesAt: panelIds, lenient: true, required: true,
        description: 'Which panel to show.',
      },
    ],
    run: (args) => {
      const want = argStr(args, 'panel')
      const panel = resolvePanel(want)
      if (!panel) return fail(unknownPanel(want))
      useLayoutStore.getState().setActivePanel(panel.id)
      return ok(`${panel.label} is showing.`)
    },
  },

  {
    id: 'layout:setToolbarButtons',
    group: 'layout',
    tier: 'always',
    summary:
      'Reorder or hide top-toolbar buttons. Buttons you do not list keep their place, so you can ' +
      'move one without describing the whole toolbar.',
    params: [
      {
        name: 'order', type: 'strings',
        description: 'Button ids in the order you want them, first to last. Unlisted ones follow.',
      },
      { name: 'hidden', type: 'strings', description: 'Button ids to hide. Pass an empty list to show them all again.' },
    ],
    run: (args) => {
      const known = new Set(toolbarButtons().map((b) => b.id))
      const patch: { order?: string[]; hidden?: string[] } = {}
      const bad: string[] = []
      for (const key of ['order', 'hidden'] as const) {
        if (!(key in args)) continue
        const list = argList(args, key)
        for (const id of list) if (!known.has(id)) bad.push(id)
        patch[key] = list
      }
      if (bad.length > 0) {
        return fail(`No toolbar button called ${bad.map((b) => `"${b}"`).join(', ')}. ` +
          `Buttons: ${toolbarButtons().map((b) => `${b.id} (${b.label})`).join(', ')}.`)
      }
      if (patch.order === undefined && patch.hidden === undefined) {
        return fail('Nothing to change — pass "order", "hidden", or both.')
      }
      useLayoutStore.getState().setToolbar(patch)
      const { toolbar } = useLayoutStore.getState().layout
      const shown = resolveToolbar(toolbar.order, toolbar.hidden).map((b) => b.id)
      return ok(`Toolbar is now: ${shown.join(', ')}.`,
        toolbar.hidden.length > 0 ? `Hidden: ${toolbar.hidden.join(', ')}.` : undefined)
    },
  },

  {
    id: 'layout:listPresets',
    group: 'layout',
    tier: 'always',
    summary: 'The saved layouts the user can switch between.',
    params: [],
    run: () => {
      const names = presetNames()
      if (names.length === 0) return ok('No saved layouts yet. layout:savePreset makes one from the current arrangement.')
      return ok(`Saved layouts: ${names.join(', ')}.`)
    },
  },

  {
    id: 'layout:savePreset',
    group: 'layout',
    tier: 'autopilot',
    summary:
      'Save the current arrangement under a name, so the user can get back to it. Writes to disk, ' +
      'and overwrites a preset of the same name.',
    params: [
      { name: 'name', type: 'string', required: true, description: 'What to call it, e.g. "Mapping".' },
    ],
    run: async (args) => {
      const name = argStr(args, 'name').trim()
      if (!name) return fail('A preset needs a name.')
      const existed = presetNames().some((n) => n.toLowerCase() === name.toLowerCase())
      await useLayoutStore.getState().savePreset(name)
      return ok(`${existed ? 'Replaced' : 'Saved'} the layout "${name}".`)
    },
  },

  {
    id: 'layout:applyPreset',
    group: 'layout',
    tier: 'autopilot',
    summary: 'Switch to a saved layout. The current arrangement is replaced, so save it first if it matters.',
    params: [
      {
        name: 'name', type: 'enum', valuesAt: presetNames, lenient: true, required: true,
        description: 'Which saved layout.',
      },
    ],
    run: (args) => {
      const name = argStr(args, 'name')
      if (!useLayoutStore.getState().applyPreset(name)) {
        const names = presetNames()
        return fail(names.length === 0
          ? `No saved layouts yet, so "${name}" cannot be applied. layout:savePreset makes one.`
          : `No saved layout called "${name}". Saved: ${names.join(', ')}.`)
      }
      return ok(`Switched to the layout "${name}".`, summary())
    },
  },

  {
    id: 'layout:deletePreset',
    group: 'layout',
    tier: 'confirm',
    summary: 'Delete a saved layout. There is no undo, and the arrangement is not recoverable from anywhere else.',
    params: [
      {
        name: 'name', type: 'enum', valuesAt: presetNames, lenient: true, required: true,
        description: 'Which saved layout to delete.',
      },
    ],
    run: async (args) => {
      const name = argStr(args, 'name')
      if (!presetNames().some((n) => n.toLowerCase() === name.trim().toLowerCase())) {
        return fail(`No saved layout called "${name}".`)
      }
      await useLayoutStore.getState().deletePreset(name)
      return ok(`Deleted the layout "${name}".`)
    },
  },

  {
    id: 'layout:addPanel',
    group: 'layout',
    tier: 'always',
    summary:
      'Open a SECOND panel of a kind that can have one, beside the existing one — today that is ' +
      'the code editor, and nothing else. Every other panel shows one global thing (one console, ' +
      'one environment listing, one map), so a second copy would be two windows onto the same ' +
      'state. The new panel starts empty; drag a tab into it, or open something with it focused.',
    params: [
      {
        name: 'panel', type: 'enum', valuesAt: () => multiInstancePanels().map((p) => p.id),
        lenient: true, required: true,
        description: 'The kind of panel to add another of — the values listed are the only ones there are.',
      },
    ],
    run: (args) => {
      const want = argStr(args, 'panel')
      const panel = resolvePanel(want)
      if (!panel) return fail(unknownPanel(want))
      const base = basePanelId(panel.id)
      if (panelMaxInstances(base) <= 1) {
        const can = multiInstancePanels().map((p) => `${p.id} (${p.label})`).join(', ')
        return fail(`There can only be one ${panel.label}. Panels that can exist twice: ${can}.`)
      }
      const res = addPanelInstance(base)
      if (!res.ok) return fail(res.message)
      return ok(`Added ${res.label}.`, summary())
    },
  },

  {
    id: 'layout:removePanel',
    group: 'layout',
    tier: 'always',
    summary:
      'Remove a panel that was ADDED — never one ouRGeo ships, which cannot be removed at all. ' +
      'Nothing is lost: its documents move to the panel that remains. To hide a panel instead, ' +
      'which the toolbar can undo in one click, use ui:panel.',
    params: [
      {
        name: 'panel', type: 'enum', valuesAt: () => panelIds().filter(isPanelInstance),
        lenient: true, required: true,
        description: 'The added panel, e.g. editor#2 or "Code editor 2". Empty means there are none to remove.',
      },
    ],
    run: (args) => {
      const want = argStr(args, 'panel')
      const panel = resolvePanel(want)
      if (!panel) return fail(unknownPanel(want))
      if (!isPanelInstance(panel.id)) {
        return fail(
          `${panel.label} is the one ouRGeo ships, not one that was added, and it cannot be `
          + 'removed — it is where content comes home to. Remove the added copy instead (the '
          + 'contents end up in one panel either way), or hide this one with ui:panel.',
        )
      }
      const summaryOfContents = removalSummary(panel.id)
      const res = removePanelInstance(panel.id)
      if (!res.ok) return fail(res.message)
      return ok(`Removed ${panel.label}. ${summaryOfContents}`.trim(), summary())
    },
  },

  {
    id: 'layout:setPanelDrag',
    group: 'layout',
    tier: 'always',
    summary:
      'Turn the drag-to-rearrange grip in each panel’s corner on or off. It ships OFF, so a user who ' +
      'wants to drag panels about has to be told this exists. On, the grip also right-clicks to that ' +
      'panel’s menu. Off removes the GESTURE only — the arrangement is untouched and layout:movePanel ' +
      'still works. Settings → Workspace has the same switch.',
    params: [
      { name: 'enabled', type: 'boolean', required: true, description: 'true to allow dragging panels, false to switch the grips off.' },
    ],
    run: (args) => {
      const enabled = argBool(args, 'enabled', true)
      useLayoutStore.getState().setDragEnabled(enabled)
      return ok(enabled
        ? 'Panels can be dragged by the grip in their top-right corner, and right-clicking it opens that panel’s menu.'
        : 'Panel drag grips are off. Panels can still be moved from Settings → Workspace, or with layout:movePanel.')
    },
  },

  {
    id: 'layout:reset',
    group: 'layout',
    tier: 'always',
    summary:
      'Put every panel back where ouRGeo ships it, at its shipped size, with the shipped toolbar. ' +
      'The way out of any arrangement — offer it before the user starts dragging things back.',
    params: [],
    run: () => {
      useLayoutStore.getState().reset()
      return ok('Layout reset to the ouRGeo default.', summary())
    },
  },
]

/** Whether a panel is currently on screen — for other groups that need to
 *  check before narrating something the user cannot see. */
export function panelIsOpen(panel: PanelId): boolean {
  return isOpen(useLayoutStore.getState().layout, panel)
}
