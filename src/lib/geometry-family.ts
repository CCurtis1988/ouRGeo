/**
 * Geometry-family normalization. sf's OGC curve classes (handled by the
 * sfarc package) must style, draw and hit-test like their straight
 * counterparts: a COMPOUNDCURVE is a line, a CURVEPOLYGON is a polygon.
 * Layer `geometryType` strings may also be comma-joined lists
 * (e.g. "COMPOUNDCURVE, LINESTRING" from st_geometry_type on mixed columns).
 */

export type GeometryFamily =
  | 'POINT'
  | 'MULTIPOINT'
  | 'LINESTRING'
  | 'MULTILINESTRING'
  | 'POLYGON'
  | 'MULTIPOLYGON'

/**
 * Normalize a single geometry-type / sfc-class string to its straight
 * family. Returns null for ambiguous containers (GEOMETRY,
 * GEOMETRYCOLLECTION) and unknown strings.
 */
export function geometryFamily(t: string): GeometryFamily | null {
  const gt = t.toUpperCase().replace(/^SFC_/, '').trim()
  switch (gt) {
    case 'POINT':
    case 'MULTIPOINT':
    case 'LINESTRING':
    case 'MULTILINESTRING':
    case 'POLYGON':
    case 'MULTIPOLYGON':
      return gt
    case 'CIRCULARSTRING':
    case 'COMPOUNDCURVE':
      return 'LINESTRING'
    case 'MULTICURVE':
      return 'MULTILINESTRING'
    case 'CURVEPOLYGON':
      return 'POLYGON'
    case 'MULTISURFACE':
      return 'MULTIPOLYGON'
    default:
      return null
  }
}

/** Families present in a (possibly comma-joined) layer geometry-type string. */
export function layerFamilies(gtList: string): (GeometryFamily | null)[] {
  return gtList.split(',').map((t) => geometryFamily(t))
}

/** First concrete family in a layer geometry-type string (null if none). */
export function layerFamily(gtList: string): GeometryFamily | null {
  return layerFamilies(gtList).find((f) => f !== null) ?? null
}

/** True when any type in the list belongs to the polygon family. */
export function familyIsPolygon(gtList: string): boolean {
  return layerFamilies(gtList).some((f) => f === 'POLYGON' || f === 'MULTIPOLYGON')
}

/**
 * True when any type belongs to the line family and none to the polygon
 * family (mirrors the legacy `includes('LINE') && !includes('POLYGON')`
 * precedence: polygon styling wins on mixed layers).
 */
export function familyIsLine(gtList: string): boolean {
  if (familyIsPolygon(gtList)) return false
  return layerFamilies(gtList).some((f) => f === 'LINESTRING' || f === 'MULTILINESTRING')
}
