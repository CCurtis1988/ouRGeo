import type { RgeoProxyRef, RObjectInfo } from '@/lib/r-client'
import type { GeometryType } from '@/store/geometryEdit'
import { geometryFamily } from '@/lib/geometry-family'

export const GEOM_TYPES = [
  'POINT', 'MULTIPOINT', 'LINESTRING', 'POLYGON', 'MULTILINESTRING', 'MULTIPOLYGON'
] as const

/**
 * Geometry-type choices offered by the creation dialogs. Deliberately
 * curve-ambiguous: no curved/straight distinction — the drawing tools decide
 * per segment, and the save path's st_sfc rebuild reclasses the column
 * (mixed content → sfc_GEOMETRY) so any choice here can later hold curves.
 * GEOMETRYCOLLECTION acts as an "any geometry" column.
 */
export const SF_GEOM_TYPES = [
  'POINT', 'MULTIPOINT',
  'LINESTRING', 'MULTILINESTRING',
  'POLYGON', 'MULTIPOLYGON',
  'GEOMETRYCOLLECTION'
] as const
export type SfGeomType = typeof SF_GEOM_TYPES[number]

/** Display label for a creation-dialog geometry type option. */
export function sfGeomTypeLabel(gt: SfGeomType): string {
  const pretty = gt.charAt(0) + gt.slice(1).toLowerCase()
  return gt === 'GEOMETRYCOLLECTION' ? `${pretty} (any geometry)` : pretty
}

/**
 * Drawing family for a column type. Curve classes normalize to their
 * straight family (sfc_COMPOUNDCURVE → LINESTRING); ambiguous containers
 * (sfc_GEOMETRY, sfc_GEOMETRYCOLLECTION) return null, which routes the UI
 * to the per-row geometry-type picker.
 */
export function getGeomType(colType: string): GeometryType | null {
  if (!colType.startsWith('sfc_')) return null
  return geometryFamily(colType)
}

export function isGeomColumn(colType: string): boolean {
  return colType.startsWith('sfc_') || colType === 'geos_geometry'
}

export const EMPTY: number[] = []

export const ROW_HEIGHT = 28
export const CHUNK_SIZE = 500
export const ROW_NUM_WIDTH = 48   // w-12 row-number column
export const ADD_BTN_WIDTH = 32   // w-8 add-column button
export const MIN_COL_WIDTH = 50
const CHAR_PX = 7.5        // approximate px per char at text-xs
const COL_PAD = 24         // horizontal padding per column

export function estimateColWidth(header: string, samples: string[]): number {
  const maxLen = [header, ...samples].reduce((m, s) => Math.max(m, s.length), 0)
  return Math.min(Math.max(maxLen * CHAR_PX + COL_PAD, MIN_COL_WIDTH), 300)
}

// Walk the env store and find the rgeoProxy attached to a given object.
// Returns null for in-memory (non-proxy) datasets — callers should then take
// the existing `rClient.execute(R code)` path. Only matches top-level vars
// in .GlobalEnv since proxies don't currently exist on nested paths.
export function findRgeoProxy(
  environments: { name: string; objects: RObjectInfo[] }[],
  envName: string,
  varName: string
): RgeoProxyRef | null {
  if (envName !== '.GlobalEnv') return null
  const env = environments.find((e) => e.name === envName)
  const obj = env?.objects.find((o) => o.name === varName)
  if (!obj?.rgeoProxy) return null
  return { handle: obj.rgeoProxy.handle, name: obj.rgeoProxy.name }
}

/**
 * Tokens the grid renders for "no value". When editing starts on such a cell
 * the input should open empty (not literally "NA"/"NULL"), and committing an
 * empty input writes NA back — see editInitialValue / normalizeCommittedValue.
 */
export function isNullLikeCell(v: string | undefined | null): boolean {
  return v == null || v === 'NA' || v === 'NULL' || v === 'NaN' || v === ''
}

/** Text the edit input should start with for a cell's current display value. */
export function editInitialValue(v: string | undefined | null): string {
  return isNullLikeCell(v) ? '' : (v as string)
}

export interface EditingCell {
  row: number
  col: number
  value: string
  originalValue: string
}

export function nextCell(
  row: number,
  col: number,
  totalRows: number,
  totalCols: number,
  direction: 'up' | 'down' | 'left' | 'right'
): { row: number; col: number } | null {
  switch (direction) {
    case 'down':
      return row + 1 < totalRows ? { row: row + 1, col } : null
    case 'up':
      return row - 1 >= 0 ? { row: row - 1, col } : null
    case 'right':
      if (col + 1 < totalCols) return { row, col: col + 1 }
      return row + 1 < totalRows ? { row: row + 1, col: 0 } : null
    case 'left':
      if (col - 1 >= 0) return { row, col: col - 1 }
      return row - 1 >= 0 ? { row: row - 1, col: totalCols - 1 } : null
  }
}
