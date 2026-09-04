// The workspace layout, as data.
//
// Panel sizes used to be five `useState`s inside EditorLayout and panel
// position was decided by which JSX block a panel had been written into. That
// is fine right up until something outside the component needs to read or
// change it — which is exactly the argument that moved dialog state into
// store/ui.ts, and it applies twice over here, because the assistant is now
// expected to rearrange the workspace on request.
//
// So: the layout is a value, every operation on it is a pure function, and the
// component is a renderer. All of this is testable with no DOM, the way
// `computeMdEdit` and `chunk-identity` are.
//
// ── The shape, and what it gives up ────────────────────────────────────────
//
// Four zones, each an ordered list of panels sharing one axis. NOT a nested
// split tree: a tree is the fully general model, but every operation on it
// becomes recursive, `normalize` becomes hard to reason about, and — the
// deciding argument — an assistant driving it has to describe a path through
// the tree rather than name a zone. "Put the map on the left" has to keep
// working when a local model says it.
//
// The cost is one arrangement the old hand-written layout had: Help sitting
// *above* the plot/map/chat row inside the right column. That was a special
// case written out three times; here Help is simply another panel in the right
// zone. Set the zone to `tabs` and it gets the full height back.
//
// ── Inside a zone: shares, not pixels ──────────────────────────────────────
//
// A zone's own size is pixels — it is measured against the window. What each
// panel gets INSIDE a zone is a weight, and the first version got this wrong:
// every panel carried a px height, the last one was `flex-1`, and so opening
// Environment and Packages together gave the first a fixed 260px and the
// second everything else. Two panels sharing a column should share it; three
// should take a third each. Nobody asked for 260px, it was a default nobody
// chose, and there was no arithmetic that could have made it even without
// knowing how tall the column is — which is precisely what a pure model cannot
// know.
//
// Weights sidestep the measurement entirely. Equal weights ARE an even split,
// at any height, for any number of panels, and the browser does the division.
// Dragging a divider re-weights the two panels either side of it, keeping
// their combined share fixed, so the gesture moves one boundary and nothing
// else. Minimum sizes stay in pixels and are enforced where pixels exist: the
// render, via `min-height`.
//
// Weights are deliberately NOT persisted (`forgetWeights`, applied on save):
// ouRGeo opens with the panels sharing evenly every time, and a session's
// dragging stays in that session. Where a panel IS, and how wide its column
// is, are remembered as they always were.

import {
  basePanelId, instanceLabel, instanceNumber, isPanelInstance,
} from './instances'

/** Where a panel can live. `center` has no size — it absorbs the slack. */
export type ZoneId = 'left' | 'center' | 'right' | 'bottom'

export const ZONE_IDS: readonly ZoneId[] = ['left', 'center', 'right', 'bottom']

export const ZONE_LABELS: Record<ZoneId, string> = {
  left: 'Left column',
  center: 'Centre',
  right: 'Right column',
  bottom: 'Bottom strip',
}

/** Built-in panels use a bare id; a plugin's is `plugin-id:panel-name`. */
export type PanelId = string

/** Which way the panels inside a zone are laid out. */
export type ZoneAxis = 'row' | 'col'

/** Whether the panels inside a zone share the space or take turns. */
export type ZoneMode = 'split' | 'tabs'

export interface ZoneState {
  /** Px along the zone's OUTER axis — width for left/right, height for bottom.
   *  Ignored for `center`, which is always flex-1. */
  size: number
  mode: ZoneMode
  axis: ZoneAxis
  /** Every panel assigned to this zone, open or not, in display order. */
  order: PanelId[]
  /** Each panel's share of the zone's INNER axis, relative to its open
   *  siblings — a weight, not pixels. All equal is an even split. */
  weights: Record<PanelId, number>
  /** Which panel is showing in `tabs` mode. */
  active: PanelId | null
}

export interface ToolbarState {
  /** The user's order. Buttons not named here are appended in registry order,
   *  so a button added by an update is never invisible. */
  order: string[]
  hidden: string[]
}

export interface LayoutState {
  version: number
  zones: Record<ZoneId, ZoneState>
  /** Open/closed, for every known panel. A closed panel keeps its zone and
   *  size, so re-opening puts it back where the user left it. */
  open: Record<PanelId, boolean>
  toolbar: ToolbarState
}

/** What `normalize` needs to know about a panel. The full registry (icon,
 *  component, label) lives in panels.tsx; this is the part with no React in it,
 *  so the model stays testable on its own. */
export interface PanelMeta {
  id: PanelId
  /** Smallest useful size along a zone's inner axis, in px. */
  min: number
  defaultZone: ZoneId
  /** Order within the default zone when the layout is first built. */
  defaultOrder: number
  defaultOpen: boolean
  /** Share of its zone relative to its siblings, when nobody has dragged
   *  anything. Omit it: 1 is what makes panels open evenly. */
  defaultWeight?: number
  /**
   * How many of this panel may exist at once, counting the original. Absent
   * means one — the answer for every panel whose content is global (there is
   * one console, one environment listing). The editor and the map are the two
   * that own a SET of things (tabs, map sessions) and can therefore be
   * usefully split in two.
   *
   * Capped rather than unbounded because each extra map is another MapLibre
   * instance holding a WebGL context, and a browser hands out only so many
   * before it starts silently dropping the oldest.
   */
  maxInstances?: number
  /**
   * The workspace is unusable without it, so it can never end up in no zone.
   * Only the editor sets this: a layout that lost it would leave the user with
   * nowhere to type and no obvious way back.
   */
  essential?: boolean
}

/** Bumped when a stored layout can no longer be read. `loadLayout` starts
 *  fresh rather than guessing, because a half-understood layout is worse than
 *  the default one. */
export const LAYOUT_VERSION = 1

const MIN_ZONE_SIZE = 120
const MAX_ZONE_SIZE = 2000

/** An equal share. A zone of panels that all carry this divides evenly. */
export const DEFAULT_WEIGHT = 1
// Clamped rather than free so a bad file, or an assistant's 0, cannot collapse
// a panel to nothing — a panel with no height has no header to drag back.
const MIN_WEIGHT = 0.05
const MAX_WEIGHT = 20

// ── Construction ───────────────────────────────────────────────────────────

function emptyZone(axis: ZoneAxis, size: number): ZoneState {
  return { size, mode: 'split', axis, order: [], weights: {}, active: null }
}

/** The layout ouRGeo opens with. Reproduces the arrangement that shipped
 *  before the layout was a value: panels left, editor centre, console beneath,
 *  map/plots/chat in a row on the right. */
export function defaultLayout(panels: PanelMeta[]): LayoutState {
  const layout: LayoutState = {
    version: LAYOUT_VERSION,
    zones: {
      left: emptyZone('col', 260),
      center: emptyZone('col', 0),
      right: emptyZone('row', 460),
      bottom: emptyZone('row', 240),
    },
    open: {},
    toolbar: { order: [], hidden: [] },
  }
  for (const p of [...panels].sort((a, b) => a.defaultOrder - b.defaultOrder)) {
    layout.zones[p.defaultZone].order.push(p.id)
    layout.zones[p.defaultZone].weights[p.id] = p.defaultWeight ?? DEFAULT_WEIGHT
    layout.open[p.id] = p.defaultOpen
  }
  return normalize(layout, panels)
}

// ── Queries ────────────────────────────────────────────────────────────────

export function zoneOf(layout: LayoutState, panel: PanelId): ZoneId | null {
  for (const z of ZONE_IDS) if (layout.zones[z].order.includes(panel)) return z
  return null
}

export function isOpen(layout: LayoutState, panel: PanelId): boolean {
  return layout.open[panel] === true
}

/** The panels actually rendered in a zone, in order. */
export function openPanels(layout: LayoutState, zone: ZoneId): PanelId[] {
  return layout.zones[zone].order.filter((p) => isOpen(layout, p))
}

/** A zone with nothing open in it is not rendered at all — no divider, no
 *  empty box holding space the user cannot reclaim. */
export function zoneVisible(layout: LayoutState, zone: ZoneId): boolean {
  return openPanels(layout, zone).length > 0
}

// ── Operations ─────────────────────────────────────────────────────────────
//
// Every one returns a new layout and never mutates the argument, so a caller
// can preview a move (which is what the drag indicator does) without
// committing to it.

// Field by field rather than a spread, so a key an older build wrote — the px
// `sizes` map this replaced — is dropped by construction instead of riding
// along in every file the app writes from now on.
function cloneZone(z: ZoneState): ZoneState {
  return {
    size: z.size,
    mode: z.mode,
    axis: z.axis,
    order: [...z.order],
    weights: { ...z.weights },
    active: z.active,
  }
}

function clone(layout: LayoutState): LayoutState {
  return {
    version: layout.version,
    open: { ...layout.open },
    toolbar: { order: [...layout.toolbar.order], hidden: [...layout.toolbar.hidden] },
    zones: {
      left: cloneZone(layout.zones.left),
      center: cloneZone(layout.zones.center),
      right: cloneZone(layout.zones.right),
      bottom: cloneZone(layout.zones.bottom),
    },
  }
}

/**
 * Move a panel to `zone`, at `index` (default: the end).
 *
 * Moving a panel also OPENS it. Asking for something to be put on the left and
 * then not seeing it is the wrong answer to the request, and it is the mistake
 * an assistant makes most often — `movePanel` then `setPanelOpen` is two calls
 * where the user asked for one thing.
 */
export function movePanel(
  layout: LayoutState, panel: PanelId, zone: ZoneId, index?: number,
): LayoutState {
  const next = clone(layout)
  for (const z of ZONE_IDS) {
    next.zones[z].order = next.zones[z].order.filter((p) => p !== panel)
  }
  const order = next.zones[zone].order
  const at = index === undefined ? order.length : Math.max(0, Math.min(index, order.length))
  order.splice(at, 0, panel)
  // A panel arriving in a zone joins its new siblings on equal terms; the
  // share it had of the zone it left says nothing about this one.
  if (next.zones[zone].weights[panel] === undefined) {
    next.zones[zone].weights[panel] = DEFAULT_WEIGHT
  }
  next.open[panel] = true
  return next
}

/** Move a panel within the zone it is already in. */
export function reorderPanel(layout: LayoutState, panel: PanelId, index: number): LayoutState {
  const zone = zoneOf(layout, panel)
  if (!zone) return layout
  return movePanel(layout, panel, zone, index)
}

export function setPanelOpen(layout: LayoutState, panel: PanelId, open: boolean): LayoutState {
  if (layout.open[panel] === open) return layout
  const next = clone(layout)
  next.open[panel] = open
  return next
}

export function setZoneSize(layout: LayoutState, zone: ZoneId, size: number): LayoutState {
  const next = clone(layout)
  next.zones[zone].size = size
  return next
}

/** What fraction of its zone a panel currently takes, 0–1. A panel that is
 *  the only open one in its zone has all of it. */
export function shareOf(layout: LayoutState, panel: PanelId): number {
  const zone = zoneOf(layout, panel)
  if (!zone || !isOpen(layout, panel)) return 0
  const open = openPanels(layout, zone)
  const total = open.reduce((n, p) => n + weightOf(layout, zone, p), 0)
  return total > 0 ? weightOf(layout, zone, panel) / total : 0
}

function weightOf(layout: LayoutState, zone: ZoneId, panel: PanelId): number {
  return layout.zones[zone].weights[panel] ?? DEFAULT_WEIGHT
}

/**
 * Give one panel `share` (0–1) of its zone, the others keeping their
 * proportions relative to each other.
 *
 * The share actually applied can be smaller than the one asked for, because
 * `normalize` caps a weight — read it back with `shareOf` rather than assuming.
 */
export function setPanelShare(layout: LayoutState, panel: PanelId, share: number): LayoutState {
  const zone = zoneOf(layout, panel)
  if (!zone) return layout
  const others = openPanels(layout, zone).filter((p) => p !== panel)
  // Alone in its zone it already fills it, and the arithmetic below would
  // divide by zero to say so.
  if (others.length === 0) return layout
  const want = clamp(share, 0.02, 0.98)
  const rest = others.reduce((n, p) => n + weightOf(layout, zone, p), 0)
  const next = clone(layout)
  next.zones[zone].weights[panel] = (rest * want) / (1 - want)
  return next
}

/**
 * Move the boundary between two adjacent panels: `before` takes `share` of
 * what the two of them hold between them, `after` takes the rest.
 *
 * Their combined weight is preserved, which is what makes a divider drag feel
 * like a divider — every other panel in the zone stays exactly where it is.
 */
export function splitPanels(
  layout: LayoutState, before: PanelId, after: PanelId, share: number,
): LayoutState {
  const zone = zoneOf(layout, before)
  if (!zone || zoneOf(layout, after) !== zone) return layout
  const pair = weightOf(layout, zone, before) + weightOf(layout, zone, after)
  const want = clamp(share, 0.02, 0.98)
  const next = clone(layout)
  next.zones[zone].weights[before] = pair * want
  next.zones[zone].weights[after] = pair * (1 - want)
  return next
}

/** Share a zone out evenly again — what every zone starts each session as. */
export function evenPanels(layout: LayoutState, zone: ZoneId): LayoutState {
  const next = clone(layout)
  for (const p of next.zones[zone].order) next.zones[zone].weights[p] = DEFAULT_WEIGHT
  return next
}

/**
 * The layout with every panel share forgotten, for writing to disk.
 *
 * Panel spacing is session state by decision, not by accident: ouRGeo opens
 * with the panels sharing their zone evenly, whatever was dragged last night.
 * Where a panel lives and how wide its column is are the arrangement, and
 * those are still saved.
 */
export function forgetWeights(layout: LayoutState): LayoutState {
  const next = clone(layout)
  for (const z of ZONE_IDS) next.zones[z].weights = {}
  return next
}

export function setZoneMode(layout: LayoutState, zone: ZoneId, mode: ZoneMode): LayoutState {
  const next = clone(layout)
  next.zones[zone].mode = mode
  return next
}

export function setZoneAxis(layout: LayoutState, zone: ZoneId, axis: ZoneAxis): LayoutState {
  const next = clone(layout)
  next.zones[zone].axis = axis
  return next
}

/**
 * Set the toolbar's order and hidden set.
 *
 * Both are replaced wholesale rather than patched, because a partial update
 * has no answer for "what happens to the buttons you did not mention" that a
 * caller could predict. `resolveToolbar` appends the unmentioned ones, which
 * is the answer, and it lives at the render boundary where it can see the live
 * registry.
 */
export function setToolbar(
  layout: LayoutState, patch: Partial<ToolbarState>,
): LayoutState {
  const next = clone(layout)
  if (patch.order) next.toolbar.order = [...patch.order]
  if (patch.hidden) next.toolbar.hidden = [...patch.hidden]
  return next
}

export function setActivePanel(layout: LayoutState, panel: PanelId): LayoutState {
  const zone = zoneOf(layout, panel)
  if (!zone) return layout
  const next = clone(layout)
  next.zones[zone].active = panel
  next.open[panel] = true
  return next
}

// ── Normalization ──────────────────────────────────────────────────────────

/**
 * Make a layout renderable, whatever it was.
 *
 * This is the safety story of the whole feature. A layout arrives from three
 * untrusted-ish places — a file written by an older build, a preset exported
 * from another machine, and an assistant that got a parameter wrong — and the
 * render must never have to cope with a panel that is in two zones at once, a
 * panel that no longer exists, or a workspace with no editor in it.
 *
 * Run it on load, on import, and after every operation that a caller did not
 * originate (the store does exactly that).
 */
export function normalize(layout: LayoutState, panels: PanelMeta[]): LayoutState {
  const meta = new Map(panels.map((p) => [p.id, p]))
  /** The registry entry an id answers to — an instance answers to its base. */
  const metaFor = (id: PanelId): PanelMeta | undefined => {
    const m = meta.get(basePanelId(id))
    if (!m) return undefined
    const n = instanceNumber(id)
    // `editor#1`, `editor#`, `editor#x` — an id that parses to nothing is a
    // corrupt file, not a panel, and must not reach the render.
    if (n === 0) return undefined
    if (n > (m.maxInstances ?? 1)) return undefined
    return m
  }
  const next = clone(layout)
  next.version = LAYOUT_VERSION

  // 1. Drop panels that no longer exist — a plugin the user removed, or an
  //    extra editor from a build that allowed more of them — and de-duplicate,
  //    keeping the first placement. A panel rendered in two zones would be
  //    mounted twice, which for the map means two MapLibre instances fighting
  //    over one store.
  const placed = new Set<PanelId>()
  for (const z of ZONE_IDS) {
    next.zones[z].order = next.zones[z].order.filter((p) => {
      if (!metaFor(p) || placed.has(p)) return false
      placed.add(p)
      return true
    })
  }

  // 2. Place anything the layout has never seen — a panel added by an ouRGeo
  //    update, or by a plugin enabled since the file was written — where its
  //    author meant it to go, rather than nowhere. Only the ORIGINAL of each
  //    panel: an extra instance exists precisely because the user asked for
  //    it, so one that is not in the file is one that was removed.
  for (const p of panels) {
    if (placed.has(p.id)) continue
    next.zones[p.defaultZone].order.push(p.id)
    next.zones[p.defaultZone].weights[p.id] = p.defaultWeight ?? DEFAULT_WEIGHT
    if (next.open[p.id] === undefined) next.open[p.id] = p.defaultOpen
    placed.add(p.id)
  }

  // 3. An essential panel is never closed and never homeless.
  for (const p of panels) {
    if (!p.essential) continue
    next.open[p.id] = true
    if (!zoneOfIn(next, p.id)) {
      next.zones[p.defaultZone].order.unshift(p.id)
      placed.add(p.id)
    }
  }

  // 4. Clamp sizes, and forget entries for panels that are gone. A panel with
  //    no weight of its own — a stored layout from before shares existed, or
  //    one a plugin has just joined — gets an equal one, which is what makes
  //    "opened evenly" the state a file loads into.
  for (const z of ZONE_IDS) {
    const zone = next.zones[z]
    zone.size = z === 'center' ? 0 : clamp(zone.size, MIN_ZONE_SIZE, MAX_ZONE_SIZE)
    const weights: Record<PanelId, number> = {}
    for (const p of zone.order) {
      const m = metaFor(p)!
      weights[p] = clamp(zone.weights?.[p] ?? m.defaultWeight ?? DEFAULT_WEIGHT, MIN_WEIGHT, MAX_WEIGHT)
    }
    zone.weights = weights
  }

  // 5. Drop open-flags for panels that no longer exist, so the file does not
  //    grow a fossil for every plugin ever installed.
  //
  //    An extra instance is NOT independently closable, and that is a rule
  //    worth stating rather than an omission: the toolbar has one button per
  //    panel, so a second map that could be closed on its own could only be
  //    reopened by finding it in Settings — and a map holding sessions that is
  //    invisible and unreachable is the worst state this feature can produce.
  //    Closing the map closes every map; removing one is the other gesture,
  //    and it hands its sessions to a map that is still there.
  const open: Record<PanelId, boolean> = {}
  for (const p of panels) open[p.id] = next.open[p.id] ?? p.defaultOpen
  for (const p of placed) {
    if (isPanelInstance(p)) open[p] = open[basePanelId(p)] ?? false
  }
  next.open = open

  // 6. `active` must name a panel that is here and open, or the render has a
  //    tab strip with nothing selected. After step 5, so an instance's
  //    open-flag is the settled one.
  for (const z of ZONE_IDS) {
    const zone = next.zones[z]
    const openHere = zone.order.filter((p) => next.open[p])
    if (!zone.active || !openHere.includes(zone.active)) {
      zone.active = openHere[0] ?? null
    }
  }

  // 7. The toolbar lists are just ids; de-duplicate them so a repeated entry
  //    cannot render the same button twice. Ids that name nothing are left
  //    alone deliberately — `resolveToolbar` ignores them, and dropping them
  //    here would forget a plugin's button every time it was disabled.
  next.toolbar.order = [...new Set(next.toolbar.order)]
  next.toolbar.hidden = [...new Set(next.toolbar.hidden)]

  return next
}

/**
 * Take a panel out of the layout entirely — what removing an extra editor or
 * an extra map does.
 *
 * Distinct from closing it: a closed panel keeps its zone, its share and its
 * place in the order so that re-opening puts it back. A removed one is gone,
 * and `normalize` will not re-place it, because step 2 only ever restores the
 * ORIGINAL of a panel. Whoever calls this owns moving the content out first —
 * see `lib/panel-instances.ts`, which is the only caller that should exist.
 */
export function dropPanel(layout: LayoutState, panel: PanelId): LayoutState {
  const next = clone(layout)
  for (const z of ZONE_IDS) {
    next.zones[z].order = next.zones[z].order.filter((p) => p !== panel)
    delete next.zones[z].weights[panel]
    if (next.zones[z].active === panel) next.zones[z].active = null
  }
  delete next.open[panel]
  return next
}

function zoneOfIn(layout: LayoutState, panel: PanelId): ZoneId | null {
  for (const z of ZONE_IDS) if (layout.zones[z].order.includes(panel)) return z
  return null
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

// ── Description ────────────────────────────────────────────────────────────

/**
 * The layout in words — what `layout:describe` returns and what the assistant
 * is told to read before it rearranges anything.
 *
 * Names panels by their label rather than their id, and says which are closed,
 * because "move the map left" from a user who cannot see the map is a
 * different request from one who can.
 */
export function describeLayout(
  layout: LayoutState, panels: PanelMeta[], labels: Record<PanelId, string>,
): string {
  // An instance's label is derived rather than registered — `panelLabels()`
  // lists the panels that exist, and `editor#2` exists only in this layout.
  const label = (p: PanelId): string =>
    labels[p] ?? (isPanelInstance(p)
      ? instanceLabel(labels[basePanelId(p)] ?? basePanelId(p), instanceNumber(p))
      : p)
  const lines: string[] = []
  for (const z of ZONE_IDS) {
    const zone = layout.zones[z]
    if (zone.order.length === 0) continue
    const bits = zone.order.map((p) => {
      if (!layout.open[p]) return `${label(p)} (closed)`
      // The share is what a "make the map bigger" request is really about, and
      // without it the assistant has to guess whether it already is.
      const pct = Math.round(shareOf(layout, p) * 100)
      return zone.mode === 'split' && openPanels(layout, z).length > 1
        ? `${label(p)} ${pct}%`
        : label(p)
    })
    const size = z === 'center' ? 'fills the rest' : `${Math.round(zone.size)}px`
    const how = zone.mode === 'tabs'
      ? `tabbed, showing ${zone.active ? label(zone.active) : 'nothing'}`
      : zone.axis === 'row' ? 'side by side' : 'stacked'
    lines.push(`${ZONE_LABELS[z]} — ${size}, ${how}: ${bits.join(', ')}`)
  }
  const missing = panels.filter((p) => !layout.open[p.id]).map((p) => label(p.id))
  if (missing.length > 0) lines.push(`Closed: ${missing.join(', ')}.`)
  return lines.join('\n')
}
