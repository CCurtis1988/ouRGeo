// Adding and removing an editor or a map.
//
// Two gestures, three surfaces — Settings → Workspace, the panel grip's
// context menu, and the assistant — and they must do exactly the same thing,
// so they all call these two functions rather than reaching into the layout
// store directly.
//
// **Removing a panel never removes its content.** That is the whole reason
// this module exists rather than a `dropPanel` call at each site: a second
// editor holds documents and a second map holds sessions that own layers and
// an extent, and a user closing a panel is arranging their workspace, not
// throwing work away. The content is handed to the panel that remains, and
// only then is the panel taken out of the layout.

import { basePanelId, nextPanelInstanceId } from './layout/instances'
import { zoneOf, type PanelId, type ZoneId } from './layout/model'
import { panelInfo, panelMaxInstances } from './layout/panel-meta'
import { useLayoutStore } from '@/store/layout'
import { useEditorStore, PRIMARY_EDITOR } from '@/store/editor'
import { useGeometryEditStore, PRIMARY_MAP } from '@/store/geometryEdit'
import { editorPanels, mapPanels, placedPanelIds } from './panel-content'

/** The panels of this kind the workspace currently has, in layout order. */
export function instancesOf(base: PanelId): PanelId[] {
  const layout = useLayoutStore.getState().layout
  return base === PRIMARY_MAP ? mapPanels(layout)
    : base === PRIMARY_EDITOR ? editorPanels(layout)
    : placedPanelIds(layout).filter((p) => p === base)
}

export type AddPanelResult =
  | { ok: true; id: PanelId; label: string }
  | { ok: false; message: string }

/**
 * Add another instance of a panel, beside the one it was copied from.
 *
 * Beside, rather than in the panel's default zone: a user asking for a second
 * map wants two maps they can look at together, and a second map that opened
 * in the right column while the first sat on the left would read as the button
 * having done nothing.
 */
export function addPanelInstance(base: PanelId, zone?: ZoneId): AddPanelResult {
  const meta = panelInfo(base)
  if (!meta) return { ok: false, message: `There is no panel called "${base}".` }
  const max = panelMaxInstances(base)
  if (max <= 1) {
    return { ok: false, message: `There can only be one ${meta.label}.` }
  }
  const existing = instancesOf(base)
  const id = nextPanelInstanceId(existing, base, max)
  if (!id) {
    return {
      ok: false,
      message: `The workspace already has ${max} of them, which is the most ouRGeo will draw at once. `
        + `Remove one first.`,
    }
  }

  const layout = useLayoutStore.getState().layout
  const home = zone ?? zoneOf(layout, existing[existing.length - 1] ?? base) ?? meta.defaultZone
  const at = layout.zones[home].order.indexOf(existing[existing.length - 1] ?? base)
  useLayoutStore.getState().movePanel(id, home, at === -1 ? undefined : at + 1)
  return { ok: true, id, label: panelInfo(id)?.label ?? id }
}

export type RemovePanelResult =
  | { ok: true; movedTo: PanelId; moved: number }
  | { ok: false; message: string }

/**
 * Take an extra editor or map out of the workspace, handing its content on.
 *
 * The destination is the FIRST remaining panel of the same kind, which for
 * anyone who added exactly one extra is always the original — the answer a
 * user expects without having to be told which of several it went to.
 */
export function removePanelInstance(id: PanelId): RemovePanelResult {
  const base = basePanelId(id)
  const meta = panelInfo(id)
  if (!meta) return { ok: false, message: `There is no panel called "${id}".` }
  const siblings = instancesOf(base)
  if (!siblings.includes(id)) {
    return { ok: false, message: `${meta.label} is not in the workspace.` }
  }
  const target = siblings.find((p) => p !== id)
  if (!target) {
    return {
      ok: false,
      message: `${meta.label} is the only one — removing it would leave nowhere for its `
        + `${base === PRIMARY_MAP ? 'sessions' : 'documents'} to go. Close the panel instead.`,
    }
  }

  // Content first, layout second. The other order would leave the store
  // holding tabs that belong to a panel the layout no longer has, and
  // `reconcilePanelContent` would then decide where they went instead of this
  // function — which is the same answer today and one refactor away from not
  // being.
  let moved = 0
  if (base === PRIMARY_EDITOR) {
    const editor = useEditorStore.getState()
    moved = editor.tabs.filter((t) => (t.panelId ?? PRIMARY_EDITOR) === id).length
    editor.adoptTabs(id, target)
  } else if (base === PRIMARY_MAP) {
    const geo = useGeometryEditStore.getState()
    moved = geo.namedSessions.filter((ns) => (ns.panelId ?? PRIMARY_MAP) === id).length
    geo.adoptSessions(id, target)
  }
  useLayoutStore.getState().removePanel(id)
  return { ok: true, movedTo: target, moved }
}

/** What "remove" will say it did, before the user commits to it. */
export function removalSummary(id: PanelId): string {
  const base = basePanelId(id)
  if (base === PRIMARY_EDITOR) {
    const n = useEditorStore.getState().tabs.filter((t) => (t.panelId ?? PRIMARY_EDITOR) === id).length
    return n === 0 ? 'It holds no documents.'
      : `Its ${n} ${n === 1 ? 'document moves' : 'documents move'} to the other editor.`
  }
  if (base === PRIMARY_MAP) {
    const n = useGeometryEditStore.getState().namedSessions
      .filter((ns) => (ns.panelId ?? PRIMARY_MAP) === id).length
    return n === 0 ? 'It holds no sessions.'
      : `Its ${n} ${n === 1 ? 'session moves' : 'sessions move'} to the other map.`
  }
  return ''
}
