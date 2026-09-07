import { rStr } from '../r-identifier'
import { formatBearing, UNITS, type TraverseLeg } from './cogo'
import type { Position } from './types'
import type { CrsInfo } from '@/store/traverse'

/**
 * The R for a traverse somebody typed.
 *
 * Rule 0 — every GUI operation echoes its R — is awkward here and worth being
 * precise about. The GEOMETRY reaches R the way all drawn geometry does: staged
 * as a pending edit, written by the batched `buildBatchedGeometryRCode`
 * statement when the user saves, echoed then. What that statement does NOT
 * carry is the traverse: it writes the coordinates, not the distances and
 * bearings they came from, so nothing in the console says the figure was
 * measured rather than clicked.
 *
 * This is that line. `ourgeo_traverse()` (r/lib/handlers-cogo.R) is a real
 * function in the session, so the echo is runnable: paste it into a script and
 * the same vertices come back, in the same basis, from the same numbers. It is
 * emitted as an `info` entry rather than run, because running it would build a
 * second geometry nobody asked for.
 */
export function buildTraverseRCode(
  origin: Position, legs: TraverseLeg[], basis: 'geodesic' | 'grid', crs: CrsInfo | null
): string | null {
  if (legs.length === 0) return null

  const num = (n: number): string => {
    // Six decimals of a degree is ~10 cm and nine is sub-millimetre; a
    // distance in metres needs no more than three. Trailing zeros go, so a
    // round 150 reads as 150.
    const s = n.toFixed(Math.abs(n) < 400 ? 6 : 9)
    return s.replace(/\.?0+$/, '')
  }
  const col = (xs: number[]): string => `c(${xs.map(num).join(', ')})`

  // The distances are metres here whatever unit they were typed in, because
  // that is what `ourgeo_traverse` takes. The unit is kept in the comment, or
  // a traverse booked in US survey feet would read back as if it never had a
  // unit at all.
  const units = [...new Set(legs.map((l) => UNITS[l.unit].abbr))]
  const asTyped = legs
    .map((l) => `${l.distanceText} ${UNITS[l.unit].abbr} · ${formatBearing(l.azimuth, l.mode)}`)
    .join(' | ')

  const crsArg = basis === 'grid' && crs
    ? `,\n  crs = ${crs.epsg !== null ? `${crs.epsg}L` : rStr(crs.input ?? '')}`
    : ''

  return [
    `# ${legs.length} leg${legs.length === 1 ? '' : 's'} typed into Distance & Bearing`
      + `${basis === 'grid' ? ' on the layer grid' : ', geodesic on WGS 84'}`
      + `${units.length === 1 && units[0] !== 'm' ? ` (entered in ${units[0]})` : ''}:`,
    `#   ${asTyped}`,
    `ourgeo_traverse(`,
    `  c(${num(origin[0])}, ${num(origin[1])}),`,
    `  data.frame(`,
    `    distance = ${col(legs.map((l) => l.distanceM))},  # metres`,
    `    azimuth  = ${col(legs.map((l) => l.azimuth))}`,
    `  )${crsArg}`,
    `)`,
  ].join('\n')
}
