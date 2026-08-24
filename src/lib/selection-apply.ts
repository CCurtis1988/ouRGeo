// ── Pure selection logic ─────────────────────────────────────────────────────
// Shared by the selection store, MapView capture handlers, and SelectionPopup.

export interface LayerPick {
  accessPath: string
  envName: string
  indices: number[]
}

export function selKey(accessPath: string, envName: string): string {
  return `${accessPath}::${envName}`
}

/**
 * Apply confirmed picks to the selections map.
 *
 * Replace (merge=false): every visible layer gets its picks or an empty
 * selection — clearing layers the capture missed, matching classic GIS
 * select behavior. Hidden layers keep their selections.
 * Merge (merge=true, shift held): per-layer union with the existing
 * selection; layers not in `picks` are untouched.
 */
export function applyPicksToSelections(
  existing: Record<string, number[]>,
  picks: LayerPick[],
  merge: boolean,
  visibleLayers: { accessPath: string; envName: string }[],
): Record<string, number[]> {
  const next = { ...existing }
  if (!merge) {
    for (const l of visibleLayers) next[selKey(l.accessPath, l.envName)] = []
  }
  for (const p of picks) {
    const k = selKey(p.accessPath, p.envName)
    next[k] = Array.from(new Set([...(next[k] ?? []), ...p.indices])).sort((a, b) => a - b)
  }
  return next
}

/**
 * Human-readable label for a candidate feature: the first primitive-valued
 * property (skipping geometry-ish and underscore-prefixed keys) as
 * "key: value", else "Feature <n>" (1-based).
 */
export function candidateLabel(
  props: Record<string, unknown> | null | undefined,
  index: number,
): string {
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (/^(geom|geometry|_)/i.test(k)) continue
      if (v === null || v === undefined) continue
      const t = typeof v
      if (t !== 'string' && t !== 'number' && t !== 'boolean') continue
      const s = String(v)
      return `${k}: ${s.length > 40 ? s.slice(0, 40) + '…' : s}`
    }
  }
  return `Feature ${index + 1}`
}
