// A second editor, a second map: panels that can exist more than once.
//
// A `PanelId` was always an opaque string to the layout model — `movePanel`,
// `normalize` and the zone orders never look inside one — so a second instance
// of a panel costs nothing structural. What it costs is a NAME, and the choice
// of separator is the whole design decision here:
//
//   `editor`      the first one, forever
//   `editor#2`    the second
//
// The first instance keeps the bare id, which is why every layout.json written
// before this feature, every saved preset, every `data-ourgeo-id` in
// targets.ts and every `ui:panel` call the assistant has ever made keeps
// working untouched. A scheme where the first editor became `editor#1` would
// have invalidated all of them for nothing.
//
// `#` rather than `:` because a plugin's panel id is already `plugin:panel`,
// and rather than `.` because a dot in an id reads as a property access — the
// same argument that made action ids use a colon.

import type { PanelId } from './model'

export const INSTANCE_SEP = '#'

/** The panel an id is an instance of. `editor#2` → `editor`; `editor` → itself. */
export function basePanelId(id: PanelId): PanelId {
  const at = id.indexOf(INSTANCE_SEP)
  return at === -1 ? id : id.slice(0, at)
}

/** Whether this id names an extra instance rather than the original panel. */
export function isPanelInstance(id: PanelId): boolean {
  return id.includes(INSTANCE_SEP)
}

/**
 * Which instance this is, counting the bare id as 1.
 *
 * Returns 0 for a malformed id (`editor#`, `editor#x`, `editor#0`) so callers
 * can reject it with one comparison — a layout file is one of the places these
 * arrive from, and a NaN index would otherwise ride along into a render.
 */
export function instanceNumber(id: PanelId): number {
  const at = id.indexOf(INSTANCE_SEP)
  if (at === -1) return 1
  const rest = id.slice(at + 1)
  if (!/^[2-9][0-9]*$/.test(rest)) return 0
  return Number(rest)
}

export function makePanelInstanceId(base: PanelId, n: number): PanelId {
  return n <= 1 ? base : `${base}${INSTANCE_SEP}${n}`
}

/** "Code editor" + 2 → "Code editor 2". The first keeps its plain name. */
export function instanceLabel(baseLabel: string, n: number): string {
  return n <= 1 ? baseLabel : `${baseLabel} ${n}`
}

/** Every id in `ids` that is this panel — the original and its instances. */
export function panelInstanceIds(ids: readonly PanelId[], base: PanelId): PanelId[] {
  return ids.filter((id) => basePanelId(id) === base && instanceNumber(id) > 0)
}

/**
 * The id a new instance of `base` should take, or null when `max` is reached.
 *
 * The lowest free number, not "one past the highest": remove the second of
 * three editors and the next one added is `editor#2` again, so the numbers a
 * user sees stay small and stable rather than climbing for ever.
 */
export function nextPanelInstanceId(
  existing: readonly PanelId[], base: PanelId, max: number,
): PanelId | null {
  const taken = new Set(panelInstanceIds(existing, base).map(instanceNumber))
  if (taken.size >= max) return null
  for (let n = 1; n <= max; n++) {
    if (!taken.has(n)) return makePanelInstanceId(base, n)
  }
  return null
}
