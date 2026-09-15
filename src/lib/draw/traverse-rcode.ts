import { rStr } from '../r-identifier'
import { formatBearing, formatDms, UNITS, fromMetres, type TraverseCourse } from './cogo'
import { CURVE_ELEMENTS } from './curve-cogo'
import type { Position } from './types'
import type { CrsInfo } from '@/store/traverse'

/**
 * The R for a traverse somebody typed.
 *
 * Rule 0 — every GUI operation echoes its R — is awkward here and worth being
 * precise about. The GEOMETRY reaches R the way all drawn geometry does: staged
 * as a pending edit, written by the batched `buildBatchedGeometryRCode`
 * statement when the user saves, echoed then. What that statement does NOT
 * carry is the traverse: it writes the coordinates, not the distances, bearings
 * and curve elements they came from, so nothing in the console says the figure
 * was measured rather than clicked.
 *
 * This is that line. `ourgeo_traverse()` (r/lib/handlers-cogo.R) is a real
 * function in the session, so the echo is runnable: paste it into a script and
 * the same vertices come back, in the same basis, from the same numbers. It is
 * emitted as an `info` entry rather than run, because running it would build a
 * second geometry nobody asked for.
 *
 * **A curve is emitted as extra COLUMNS, not as a second call.** The figure is
 * one traverse — the closure is computed across all of it, and splitting the
 * echo would reproduce two shapes neither of which is what is on screen. It
 * also means a straight-only traverse still echoes the exact two-column form it
 * always did, which is what anybody who saved one of these in a script has.
 */

/** A course in the words it was entered in, for the header comment. */
function describeCourse(c: TraverseCourse): string {
  const abbr = UNITS[c.unit].abbr
  if (c.type === 'line') {
    return `${c.distanceText} ${abbr} · ${formatBearing(c.azimuth, c.mode)}`
  }
  if (c.type === 'spiral') {
    const name = c.form === 'scs' ? 'spiral-curve-spiral' : c.form === 'out' ? 'exit spiral' : 'spiral'
    const typed = c.entered.length > 0
      ? c.entered.map((e) => `${e.label} ${e.text}`).join(' ')
      : `Ls ${fromMetres(c.elements.lengthInM, c.unit).toFixed(2)} ${abbr}`
        + ` R ${fromMetres(c.elements.radiusM, c.unit).toFixed(2)} ${abbr}`
    return `${name} ${c.turn} · ${typed}`
  }
  const typed = c.entered.length > 0
    ? c.entered.map((e) => {
      const def = CURVE_ELEMENTS[e.id]
      return `${def.symbol} ${e.text}${def.quantity === 'length' ? ` ${abbr}` : ''}`
    }).join(' ')
    : `R ${fromMetres(c.elements.radiusM, c.unit).toFixed(2)} ${abbr} Δ ${formatDms(c.elements.deltaDeg)}`
  return `curve ${c.turn} · ${typed}${c.tangential ? ' · tangent' : ''}`
}

/** Curve and spiral courses carry different columns; these read one safely. */
const radiusOf = (c: TraverseCourse): number | null =>
  c.type === 'line' ? null : c.elements.radiusM
const deltaOf = (c: TraverseCourse): number | null => {
  if (c.type === 'line') return null
  // A lone spiral has no deflection to quote — it turns by its own spiral
  // angle, which `ourgeo_traverse` derives from the length and the radius.
  return c.type === 'spiral'
    ? (c.form === 'scs' ? c.elements.totalDeltaDeg : null)
    : c.elements.deltaDeg
}
const inAzimuthOf = (c: TraverseCourse): number | null => {
  if (c.type === 'line') return c.azimuth
  // NA means "inherit the previous course's arrival", which is the whole
  // meaning of tangent and the one thing a list of numbers cannot otherwise
  // say. A transition course is always tangential.
  if (c.type === 'spiral') return null
  return c.tangential ? null : c.inAzimuth
}

export function buildTraverseRCode(
  origin: Position, courses: TraverseCourse[], basis: 'geodesic' | 'grid', crs: CrsInfo | null
): string | null {
  if (courses.length === 0) return null

  const num = (n: number | null): string => {
    if (n === null || !Number.isFinite(n)) return 'NA'
    // Six decimals of a degree is ~10 cm and nine is sub-millimetre; a
    // distance in metres needs no more than three. Trailing zeros go, so a
    // round 150 reads as 150.
    const s = n.toFixed(Math.abs(n) < 400 ? 6 : 9)
    return s.replace(/\.?0+$/, '')
  }
  const col = (xs: (number | null)[]): string => `c(${xs.map(num).join(', ')})`
  const chr = (xs: (string | null)[]): string =>
    `c(${xs.map((x) => (x === null ? 'NA' : rStr(x))).join(', ')})`

  // The distances are metres here whatever unit they were typed in, because
  // that is what `ourgeo_traverse` takes. The unit is kept in the comment, or
  // a traverse booked in US survey feet would read back as if it never had a
  // unit at all.
  const units = [...new Set(courses.map((c) => UNITS[c.unit].abbr))]
  const asTyped = courses.map(describeCourse).join(' | ')

  const crsArg = basis === 'grid' && crs
    ? `,\n  crs = ${crs.epsg !== null ? `${crs.epsg}L` : rStr(crs.input ?? '')}`
    : ''

  const header = [
    `# ${courses.length} course${courses.length === 1 ? '' : 's'} typed into Distance & Bearing`
      + `${basis === 'grid' ? ' on the layer grid' : ', geodesic on WGS 84'}`
      + `${units.length === 1 && units[0] !== 'm' ? ` (entered in ${units[0]})` : ''}:`,
    `#   ${asTyped}`,
  ]

  // Straight-only keeps the two-column form it has always had: it is what is
  // sitting in anybody's saved script, and the extra NA columns would be four
  // lines of noise saying nothing.
  const hasSpiral = courses.some((c) => c.type === 'spiral')
  const columns: string[] = courses.every((c) => c.type === 'line')
    ? [
      `    distance = ${col(courses.map((c) => (c.type === 'line' ? c.distanceM : null)))},  # metres`,
      `    azimuth  = ${col(courses.map((c) => (c.type === 'line' ? c.azimuth : null)))}`,
    ]
    : [
      `    type     = ${chr(courses.map((c) => c.type))}`,
      `    distance = ${col(courses.map((c) => (c.type === 'line' ? c.distanceM : null)))}  # metres`,
      `    azimuth  = ${col(courses.map(inAzimuthOf))}`,
      `    radius   = ${col(courses.map(radiusOf))}  # metres`,
      `    delta    = ${col(courses.map(deltaOf))}`,
      `    turn     = ${chr(courses.map((c) => (c.type === 'line' ? null : c.turn === 'left' ? 'L' : 'R')))}`,
      ...(hasSpiral
        ? [
          `    form     = ${chr(courses.map((c) => (c.type === 'spiral' ? c.form : null)))}`,
          `    length   = ${col(courses.map((c) => (c.type === 'spiral' ? c.elements.lengthInM : null)))}  # metres`,
          `    length_out = ${col(courses.map((c) =>
            c.type === 'spiral' && c.form === 'scs' ? c.elements.lengthOutM : null))}`,
        ]
        : []),
    ]
  // Joined here rather than written with trailing commas, so adding a column
  // cannot leave a dangling one — which R would refuse to parse at all.
  const body = columns.length === 2
    ? columns
    : columns.map((line, i) => {
      const comma = i === columns.length - 1 ? '' : ','
      const hash = line.indexOf('  #')
      return hash === -1 ? line + comma : line.slice(0, hash) + comma + line.slice(hash)
    })

  return [
    ...header,
    `ourgeo_traverse(`,
    `  c(${num(origin[0])}, ${num(origin[1])}),`,
    `  data.frame(`,
    ...body,
    `  )${crsArg}`,
    `)`,
  ].join('\n')
}
