import type { SpatialLayer } from '@/store/spatial'
import type { GeometryEditSession } from '@/store/geometryEdit'

export function findMatchingLayer(
  layers: SpatialLayer[],
  session: GeometryEditSession
): SpatialLayer | null {
  const baseName = session.accessPath.split(/[$[]/)[0]
  return layers.find((l) => l.name === baseName && l.envName === session.envName) ?? null
}

// Format a coord pair for WKT — strips trailing zeros, fixed decimal width.
function fmt(n: number): string {
  return Number.isFinite(n) ? n.toString() : '0'
}

// Convert a GeoJSON geometry to WKT for round-tripping through DuckDB
// `ST_GeomFromText`. Only the 2D geometry types ouRGeo edits today are
// supported; others fall through to null which the caller treats as
// "skip the staged edit".
export function geometryToWKT(geom: GeoJSON.Geometry | null): string | null {
  if (!geom) return null
  const ring = (r: number[][]) => `(${r.map((c) => `${fmt(c[0])} ${fmt(c[1])}`).join(', ')})`
  switch (geom.type) {
    case 'Point': {
      const [x, y] = geom.coordinates
      return `POINT(${fmt(x)} ${fmt(y)})`
    }
    case 'MultiPoint': {
      const inner = geom.coordinates.map((c) => `(${fmt(c[0])} ${fmt(c[1])})`).join(', ')
      return `MULTIPOINT(${inner})`
    }
    case 'LineString':
      return `LINESTRING${ring(geom.coordinates)}`
    case 'MultiLineString':
      return `MULTILINESTRING(${geom.coordinates.map(ring).join(', ')})`
    case 'Polygon':
      return `POLYGON(${geom.coordinates.map(ring).join(', ')})`
    case 'MultiPolygon':
      return `MULTIPOLYGON(${geom.coordinates.map((poly) => `(${poly.map(ring).join(', ')})`).join(', ')})`
    default:
      return null
  }
}
