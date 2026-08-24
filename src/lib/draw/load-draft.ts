import { rClient } from '@/lib/r-client'
import { geometryFamily } from '@/lib/geometry-family'
import type { GeometryFamily } from '@/lib/geometry-family'
import type { DraftGeometry } from './types'
import { geometryToDraft } from './draft'
import { parseWktToDraft } from './wkt'

/**
 * Whether a column/layer type string could hold curved geometry — curve
 * classes themselves, or the ambiguous containers that may contain anything.
 */
export function curvesPossible(typeString: string): boolean {
  const t = typeString.toUpperCase()
  if (/CIRCULARSTRING|COMPOUNDCURVE|CURVEPOLYGON|MULTICURVE|MULTISURFACE/.test(t)) return true
  return t
    .split(',')
    .some((part) => /^(SFC_)?(GEOMETRY|GEOMETRYCOLLECTION)$/.test(part.trim()))
}

export interface LoadedDraft {
  draft: DraftGeometry
  family: GeometryFamily | null
}

/**
 * Build the editing draft for an existing row. When the object may hold
 * curves, fetch the true WKT — from R for in-memory objects, or from the
 * _rgeo_wkt_true companion column for db-backed layers — and parse it back
 * into symbolic arc segments (lossless re-editing); otherwise, or on any
 * failure, fall back to the linearized GeoJSON the map already has.
 */
export async function loadDraftForRow(params: {
  name: string
  envName: string
  column: string | undefined
  row: number
  typeString: string
  fallbackGeometry: GeoJSON.Geometry | null
  /** DB-backed layers fetch through /dataset/row-wkt with this proxy ref. */
  dbSource?: { handle: string; name: string }
}): Promise<LoadedDraft | null> {
  const { fallbackGeometry } = params

  try {
    if (params.dbSource) {
      // The companion column can hold curves regardless of the layer's
      // reported (linearized) geometry type — always ask.
      const res = await rClient.datasetRowWkt(params.dbSource, params.row)
      if (res.success && res.wkt && res.hasCurve) {
        const parsed = parseWktToDraft(res.wkt)
        if (parsed) return { draft: parsed.draft, family: parsed.family }
      }
    } else if (curvesPossible(params.typeString)) {
      const res = await rClient.spatialWkt(params.name, params.envName, params.row, params.column)
      if (res.success && res.wkt) {
        const parsed = parseWktToDraft(res.wkt)
        if (parsed) return { draft: parsed.draft, family: parsed.family }
      }
    }
  } catch {
    // fall through to the linearized fallback
  }

  if (!fallbackGeometry) return null
  return {
    draft: geometryToDraft(fallbackGeometry),
    family: geometryFamily(fallbackGeometry.type)
  }
}
