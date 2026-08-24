import { describe, it, expect } from 'vitest'
import { buildBatchedGeometryRCode, buildDeleteRowsRCode } from './geometry-rcode'

const sfTarget = { accessPath: 'parcels', columnName: 'geometry', colLib: 'sf' as const }
const geosTarget = { accessPath: 'pts', columnName: 'geom', colLib: 'geos' as const }

describe('buildBatchedGeometryRCode (sf)', () => {
  it('writes each edit via st_as_sfc with CRS transform and rebuilds the column class', () => {
    const code = buildBatchedGeometryRCode(sfTarget, [
      { row: 2, wkt: 'POLYGON((0 0, 4 0, 4 4, 0 0), (1 1, 2 1, 2 2, 1 1))' },
      { row: 6, wkt: 'POINT(10 20)' }
    ])!
    expect(code).toContain('crs_obj <- sf::st_crs(parcels[["geometry"]])')
    expect(code).toContain('g <- sf::st_as_sfc(wkt, crs = 4326L)')
    expect(code).toContain('sf::st_transform(g, crs_obj)')
    expect(code).toContain('gl <- unclass(parcels[["geometry"]])')
    expect(code).toContain('attributes(gl) <- NULL')
    expect(code).toContain('gl[[3L]] <- .w("POLYGON((0 0, 4 0, 4 4, 0 0), (1 1, 2 1, 2 2, 1 1))")')
    expect(code).toContain('gl[[7L]] <- .w("POINT(10 20)")')
    // The st_sfc rebuild recomputes the sfc_* class (mixed → sfc_GEOMETRY)
    expect(code).toContain('parcels[["geometry"]] <<- sf::st_sfc(gl, crs = crs_obj)')
  })

  it('passes curved WKT through untouched', () => {
    const code = buildBatchedGeometryRCode(sfTarget, [
      { row: 0, wkt: 'COMPOUNDCURVE(CIRCULARSTRING(0 0, 1 1, 2 0), (2 0, 4 0))' }
    ])!
    expect(code).toContain('.w("COMPOUNDCURVE(CIRCULARSTRING(0 0, 1 1, 2 0), (2 0, 4 0))")')
  })

  it('returns null with no edits or missing WKT', () => {
    expect(buildBatchedGeometryRCode(sfTarget, [])).toBeNull()
    expect(buildBatchedGeometryRCode(sfTarget, [{ row: 0, wkt: '' }])).toBeNull()
  })
})

describe('buildBatchedGeometryRCode (geos)', () => {
  it('assigns WKT per row', () => {
    const code = buildBatchedGeometryRCode(geosTarget, [{ row: 0, wkt: 'POINT(10 20)' }])!
    expect(code).toContain('pts[1L, "geom"] <<- geos::as_geos_geometry("POINT(10 20)")')
  })
})

describe('buildDeleteRowsRCode', () => {
  it('deletes 1-based rows in ascending order', () => {
    expect(buildDeleteRowsRCode('df', [4, 2])).toBe('df <- df[-c(3L, 5L), , drop = FALSE]')
  })
})
