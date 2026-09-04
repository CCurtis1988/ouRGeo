// Adding and removing a panel that may exist more than once.
//
// Two gestures, three surfaces — Settings → Workspace, the panel grip's
// context menu, and the assistant — and they must do exactly the same thing,
// so they all call these two functions rather than reaching into the layout
// store directly.
//
// **Removing a panel never removes its content.** That is the whole reason
// this module exists rather than a `dropPanel` call at each site: an added
// editor holds documents, and a user closing a panel is arranging their
// workspace, not throwing work away. The content is handed to the panel that
// remains, and only then is the panel taken out of the layout.
//
// **Only a panel that was ADDED can be removed**, and the check lives here
// rather than in the three menus, because a rule enforced at each call site is
// a rule that holds until someone adds a fourth. Remove is not the same
// gesture as Close: closing hides a panel the toolbar can bring straight back,
// while removing takes a panel out of the workspace for good — so it may only
// ever apply to a panel the user asked for, which by construction has a
// sibling for its contents to move to.
//
// Today the editor is the only panel with a cap above 1. What is written over
// `basePanelId` rather than against the editor stays that way, so a second
// kind would need `maxInstances` in `panel-meta.ts` and an adopt/summary
// branch here, and nothing else.

import { basePanelId, isPanelInstance, nextPanelInstanceId } from './layout/instances'
import { zoneOf, type PanelId, type ZoneId } from './layout/model'
import { panelInfo, panelMaxInstances } from './layout/panel-meta'
import { useLayoutStore } from '@/store/layout'
import { useEditorStore, PRIMARY_EDITOR } from '@/store/editor'
import { editorPanels, placedPanelIds } from './panel-content'

/** The panels of this kind the workspace currently has, in layout order. */
export function instancesOf(base: PanelId): PanelId[] {
  const layout = useLayoutStore.getState().layout
  return base === PRIMARY_EDITOR ? editorPanels(layout)
    : placedPanelIds(layout).filter((p) => p === base)
}

export type AddPanelResult =
  | { ok: true; id: PanelId; label: string }
  | { ok: false; message: string }

/**
 * Add another instance of a panel, beside the one it was copied from.
 *
 * Beside, rather than in the panel's default zone: a user asking for a second
 * editor wants two documents they can look at together, and a second editor
 * that opened in the right column while the first sat in the centre would read
 * as the button having done nothing.
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
  // The original is not removable at all, however many siblings it has. It is
  // where content comes home to when a layout preset or a project bundle names
  // a panel this workspace no longer has, and for the editor it is `essential`
  // — `normalize` would put it straight back, empty, having already handed its
  // documents to the copy.
  if (!isPanelInstance(id)) {
    return {
      ok: false,
      message: `${meta.label} is the one ouRGeo ships, so it stays. `
        + `Only a panel that was added can be removed — hide this one from the toolbar instead.`,
    }
  }
  const siblings = instancesOf(base)
  if (!siblings.includes(id)) {
    return { ok: false, message: `${meta.label} is not in the workspace.` }
  }
  const target = siblings.find((p) => p !== id)
  if (!target) {
    return {
      ok: false,
      message: `${meta.label} is the only one — removing it would leave nowhere for its `
        + `documents to go. Close the panel instead.`,
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
  }
  useLayoutStore.getState().removePanel(id)
  return { ok: true, movedTo: target, moved }
}

/** What "remove" will say it did, before the user commits to it. */
export function removalSummary(id: PanelId): string {
  if (basePanelId(id) !== PRIMARY_EDITOR) return ''
  const n = useEditorStore.getState().tabs.filter((t) => (t.panelId ?? PRIMARY_EDITOR) === id).length
  return n === 0 ? 'It holds no documents.'
    : `Its ${n} ${n === 1 ? 'document moves' : 'documents move'} to the other editor.`
}
