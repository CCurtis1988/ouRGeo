/**
 * One batched R statement writing every staged geometry edit for an object —
 * emitted (and echoed to the console) when the user hits Save Edits.
 *
 * Geometry arrives as WKT (WGS84). Curved WKT (CIRCULARSTRING /
 * COMPOUNDCURVE / CURVEPOLYGON / MULTICURVE / MULTISURFACE) parses through
 * `sf::st_as_sfc` and is preserved losslessly; the sfarc package handles all
 * calculations on it. The final `st_sfc(gl, crs=)` rebuild recomputes the
 * column class from its content — mixing curved and straight rows correctly
 * yields `sfc_GEOMETRY` (which sfarc dispatches on), so creation-time column
 * types stay curve-ambiguous.
 */
export function buildBatchedGeometryRCode(
  target: { accessPath: string; columnName: string; colLib: 'sf' | 'geos' },
  edits: { row: number; wkt: string }[]
): string | null {
  if (edits.length === 0) return null
  const { accessPath, columnName, colLib } = target
  if (edits.some((e) => !e.wkt)) return null

  if (colLib === 'sf') {
    const col = `${accessPath}[["${columnName}"]]`
    const lines = edits.map((e) => `  gl[[${e.row + 1}L]] <- .w("${e.wkt}")`)
    return [
      `local({`,
      `  crs_obj <- sf::st_crs(${col})`,
      `  .w <- function(wkt) {`,
      `    g <- sf::st_as_sfc(wkt, crs = 4326L)`,
      `    if (!is.na(crs_obj) && !isTRUE(crs_obj == sf::st_crs(4326L)))`,
      `      g <- sf::st_transform(g, crs_obj)`,
      `    g[[1L]]`,
      `  }`,
      `  gl <- unclass(${col})`,
      `  attributes(gl) <- NULL  # stale bbox/n_empty must not survive the rebuild`,
      ...lines,
      `  ${col} <<- sf::st_sfc(gl, crs = crs_obj)`,
      `})`
    ].join('\n')
  }

  // geos columns cannot hold curves — callers stage densified WKT.
  const lines = edits.map(
    (e) => `  ${accessPath}[${e.row + 1}L, "${columnName}"] <<- geos::as_geos_geometry("${e.wkt}")`
  )
  return [`local({`, ...lines, `})`].join('\n')
}

/** R statement deleting appended rows (used by Discard / undo of a feature add). */
export function buildDeleteRowsRCode(accessPath: string, rows: number[]): string {
  const sorted = [...rows].sort((a, b) => a - b)
  const idx = sorted.map((r) => `${r + 1}L`).join(', ')
  return `${accessPath} <- ${accessPath}[-c(${idx}), , drop = FALSE]`
}
