import { createJsonFileStore } from '@/lib/persistence'
import { forgetWeights, LAYOUT_VERSION, type LayoutState } from '@/lib/layout/model'

// The workspace layout, kept between sessions.
//
// `layout.json` sits with theme.json on the "preference" side of the userData
// split, NOT with the session-scoped files the `will-quit` handler deletes
// (plots.json, spatial-layers.json, console.json, object-tabs.json). A
// workspace someone arranged is not session state; wiping it on a clean exit
// would mean arranging it again every launch, which is the opposite of the
// point.

const store = createJsonFileStore('layout.json', 'Layout')

interface PersistShape {
  layout?: unknown
  presets?: unknown
  dragEnabled?: unknown
}

/**
 * The stored layout, or null.
 *
 * Null on anything unrecognised, including a `version` from a future build —
 * the caller then starts from `defaultLayout`. A half-understood layout is
 * worse than the default one: it renders, so nothing looks broken, and the
 * user is left with a workspace they did not arrange and cannot explain.
 * `normalize` still runs on whatever comes back, because a file the same
 * version can still name a panel that has since been removed.
 */
export async function loadLayout(): Promise<LayoutState | null> {
  const data = await store.read<PersistShape>()
  const raw = data.layout as LayoutState | undefined
  if (!raw || typeof raw !== 'object') return null
  if (raw.version !== 1 && raw.version !== LAYOUT_VERSION) return null
  if (!raw.zones || !raw.open) return null
  return raw
}

/** A named arrangement the user (or the assistant) saved. */
export interface LayoutPreset {
  name: string
  layout: LayoutState
}

/**
 * Write the whole file — both keys, one round trip.
 *
 * The layout goes out WITHOUT its panel shares: how a zone was divided is
 * session state, so ouRGeo opens with the panels in a zone sharing it evenly
 * however they were dragged yesterday. Where each panel lives and how wide its
 * column is are the arrangement, and those are saved as they always were. A
 * preset keeps its shares, because applying one is something the user does
 * deliberately, in the session, and "restore that arrangement" means all of it.
 *
 * Deliberately `write`, not `merge`. `merge` is a read-modify-write across two
 * IPC calls, and the flush on quit has only as long as it takes the renderer to
 * call `app:confirm-quit`; the merge's read had not come back by then, so the
 * layout was silently never saved on exit while `session.json` (a single
 * `file.write`) always was. The file has exactly these two keys and one owner,
 * so there is nothing for a merge to preserve.
 */
export async function saveLayoutFile(
  layout: LayoutState, presets: LayoutPreset[], dragEnabled: boolean,
): Promise<void> {
  await store.write({ layout: forgetWeights(layout), presets, dragEnabled })
}

export async function loadPresets(): Promise<LayoutPreset[]> {
  const data = await store.read<PersistShape>()
  if (!Array.isArray(data.presets)) return []
  return (data.presets as LayoutPreset[]).filter(
    (p) => p && typeof p.name === 'string' && p.layout && typeof p.layout === 'object',
  )
}



/**
 * Whether panels can be dragged by their corner grip.
 *
 * Defaults to OFF, and an unreadable or absent value means OFF — the shipped
 * default, so a preference file that failed to load produces the workspace a
 * new install has rather than one the user has to recognise as wrong.
 *
 * Only an explicit `true` turns it on. The grip is a hover-revealed control
 * over every panel's own header, and a gesture nobody went looking for is one
 * that mostly fires by accident; the arrangement is reachable from Settings →
 * Workspace and from the assistant either way, so defaulting it off costs
 * nothing but the shortcut.
 */
export async function loadDragEnabled(): Promise<boolean> {
  const data = await store.read<PersistShape>()
  return data.dragEnabled === true
}
