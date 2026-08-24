// Shared classification helpers for R object classes, plus GeoJSON geometry
// inference. Extracted from EnvironmentItem so other panels (DataViewer, export
// dialogs) can reuse the same definitions instead of re-deriving them.

export const VIEWABLE_DATA_CLASSES = ['data.frame', 'data.table', 'tbl_df', 'tbl_dbi']
export const VIEWABLE_VECTOR_CLASSES = ['numeric', 'character', 'integer', 'logical', 'factor', 'complex']
export const VIEWABLE_MATRIX_CLASS = 'matrix'
export const SF_CLASSES = ['sf', 'sfc']

/** Whether an R object of class `cls` can be opened in the data viewer. */
export function isViewable(cls: string): boolean {
  return (
    cls === 'function' ||
    cls === VIEWABLE_MATRIX_CLASS ||
    VIEWABLE_DATA_CLASSES.includes(cls) ||
    VIEWABLE_VECTOR_CLASSES.includes(cls) ||
    SF_CLASSES.includes(cls)
  )
}

/** Whether `cls` can be exported as a table (CSV/XLSX). */
export function isTabularExportable(cls: string): boolean {
  return VIEWABLE_DATA_CLASSES.includes(cls) || cls === VIEWABLE_MATRIX_CLASS
}

/** Whether `cls` is an atomic vector that can be exported. */
export function isVectorExportable(cls: string): boolean {
  return VIEWABLE_VECTOR_CLASSES.includes(cls)
}

/** Best-effort geometry type label (e.g. "POLYGON") from a GeoJSON value. */
export function inferGeometryType(
  geojson: GeoJSON.FeatureCollection | GeoJSON.Feature | GeoJSON.Geometry
): string {
  const firstGeom: GeoJSON.Geometry | null =
    geojson.type === 'FeatureCollection'
      ? (geojson.features.find((f) => f.geometry)?.geometry ?? null)
      : geojson.type === 'Feature'
        ? geojson.geometry
        : geojson
  if (!firstGeom) return 'GEOMETRY'
  if (firstGeom.type === 'GeometryCollection') {
    return firstGeom.geometries[0]?.type.toUpperCase() ?? 'GEOMETRY'
  }
  return firstGeom.type.toUpperCase()
}
