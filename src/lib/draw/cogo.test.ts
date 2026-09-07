import { describe, it, expect } from 'vitest'
import {
  destination, inverse, norm360, parseAngle, formatDms,
  parseBearing, formatBearing, parseDistance, formatDistance,
  parseCoordinate, parseCadInput, incomingAzimuth, closure, formatRatio,
  reduceGridLeg, toMetres, UNITS,
} from './cogo'
import type { Position } from './types'

/** 1° of longitude along the equator, which is a geodesic: a·π/180. */
const DEG_ON_EQUATOR = 111319.49079327358

describe('the geodesic', () => {
  it('walks the equator exactly, because the equator is a geodesic', () => {
    const p = destination([0, 0], DEG_ON_EQUATOR, 90)
    expect(p[0]).toBeCloseTo(1, 9)
    expect(p[1]).toBeCloseTo(0, 9)
  })

  it('measures a degree of latitude on the ellipsoid, not on a sphere', () => {
    // 110574.389 m is the WGS84 meridian arc from the equator to 1°N. A sphere
    // of radius 6371008.8 — what this module replaced — says 111194.9, which is
    // 620 m out over one degree and half a metre over a hundred.
    expect(inverse([0, 0], [0, 1]).distanceM).toBeCloseTo(110574.389, 2)
  })

  it("reproduces Vincenty's own worked example", () => {
    // Flinders Peak → Buninyong, the pair Vincenty (1975) publishes:
    // s = 54972.271 m, α1 = 306°52'05.37", α2 = 127°10'25.07".
    const dms = (d: number, m: number, sec: number): number => d + m / 60 + sec / 3600
    const flinders: Position = [dms(144, 25, 29.5244), -dms(37, 57, 3.7203)]
    const buninyong: Position = [dms(143, 55, 35.3839), -dms(37, 39, 10.1561)]
    const r = inverse(flinders, buninyong)
    expect(r.distanceM).toBeCloseTo(54972.271, 3)
    expect(r.initialAzimuth).toBeCloseTo(306 + 52 / 60 + 5.37 / 3600, 5)
    // Vincenty tabulates α2 as the REVERSE azimuth — the direction back to
    // point 1. `finalAzimuth` is the forward continuation at point 2, which is
    // that plus 180°, and is the one an angle at the vertex turns from.
    expect(r.finalAzimuth - 180).toBeCloseTo(127 + 10 / 60 + 25.07 / 3600, 5)
  })

  it('round-trips: walk a leg, measure it, get the leg back', () => {
    const from: Position = [-122.4194, 37.7749]
    const end = destination(from, 1234.567, 63.25)
    const back = inverse(from, end)
    expect(back.distanceM).toBeCloseTo(1234.567, 6)
    expect(back.initialAzimuth).toBeCloseTo(63.25, 9)
  })

  it('keeps longitude in range across the antimeridian', () => {
    const p = destination([179.95, 0], 20000, 90)
    expect(p[0]).toBeLessThan(0)
    expect(p[0]).toBeGreaterThan(-180)
  })

  it('reports a leg that arrives on a different azimuth than it left on', () => {
    // The whole reason relative bearings turn from the FINAL azimuth: over a
    // long east-west leg at latitude the meridians converge under it.
    const r = inverse([0, 60], [10, 60])
    expect(r.finalAzimuth - r.initialAzimuth).toBeGreaterThan(4)
  })

  it('answers zero for a leg of no length rather than dividing by it', () => {
    expect(destination([5, 5], 0, 45)).toEqual([5, 5])
    expect(inverse([5, 5], [5, 5]).distanceM).toBe(0)
  })
})

describe('angles', () => {
  it('reads every form a field book writes', () => {
    expect(parseAngle('45')).toEqual({ ok: true, value: 45 })
    expect(parseAngle('45.5')).toEqual({ ok: true, value: 45.5 })
    for (const text of ['45°30\'15"', '45 30 15', '45-30-15', '45:30:15']) {
      const r = parseAngle(text)
      expect(r.ok && r.value).toBeCloseTo(45 + 30 / 60 + 15 / 3600, 12)
    }
    const half = parseAngle("45°30'")
    expect(half.ok && half.value).toBeCloseTo(45.5, 12)
  })

  it('refuses minutes and seconds that are not minutes and seconds', () => {
    const r = parseAngle('45 75 00')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/Minutes run 0–59/)
    expect(parseAngle('45 30 61').ok).toBe(false)
    expect(parseAngle('1 2 3 4').ok).toBe(false)
  })

  it('prints the shortest exact form, so a round number stays round', () => {
    expect(formatDms(45)).toBe('45°')
    expect(formatDms(45.5)).toBe("45°30'")
    expect(formatDms(45 + 30 / 60 + 15 / 3600)).toBe('45°30\'15"')
  })
})

describe('bearings', () => {
  it('reads an azimuth clockwise from north', () => {
    const r = parseBearing("45°30'", 'azimuth', null)
    expect(r.ok && r.value).toBeCloseTo(45.5, 12)
  })

  it('sends a negative azimuth to the mode that means it', () => {
    const r = parseBearing('-12', 'azimuth', null)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/Deflection notation/)
  })

  it('reads all four quadrants', () => {
    const q = (t: string): number => {
      const r = parseBearing(t, 'quadrant', null)
      if (!r.ok) throw new Error(r.error)
      return r.value
    }
    expect(q('N45E')).toBeCloseTo(45, 12)
    expect(q('S45E')).toBeCloseTo(135, 12)
    expect(q('S45W')).toBeCloseTo(225, 12)
    expect(q('N45W')).toBeCloseTo(315, 12)
    expect(q('n 45 30 15 e')).toBeCloseTo(45 + 30 / 60 + 15 / 3600, 12)
  })

  it('takes a quadrant bearing while the notation says azimuth, and the reverse', () => {
    // Found by driving the real strip: typing N45°30'E with the selector on
    // Azimuth was answered with "angles are unsigned numbers", which is a
    // complaint about a bearing that was never ambiguous.
    const q = parseBearing("N45°30'E", 'azimuth', null)
    expect(q.ok && q.value).toBeCloseTo(45.5, 12)
    const a = parseBearing('225', 'quadrant', null)
    expect(a.ok && a.value).toBeCloseTo(225, 12)
  })

  it('names the quadrant form when half of one was typed', () => {
    const r = parseBearing('N45', 'azimuth', null)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/N…E, N…W, S…E or S…W/)
  })

  it('refuses a quadrant angle that leaves its quadrant', () => {
    const r = parseBearing('N120E', 'quadrant', null)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/0–90/)
  })

  it('turns a deflection from the leg before it', () => {
    const right = parseBearing('R90', 'deflection', 45)
    expect(right.ok && right.value).toBeCloseTo(135, 12)
    const left = parseBearing("L12°30'", 'deflection', 45)
    expect(left.ok && left.value).toBeCloseTo(32.5, 12)
    // A bare minus means the same as L, because that is how a deflection
    // column is written when the book has no L/R column.
    const minus = parseBearing('-12.5', 'deflection', 45)
    expect(minus.ok && minus.value).toBeCloseTo(32.5, 12)
    expect(parseBearing('R10', 'deflection', 355).ok && parseBearing('R10', 'deflection', 355)).toEqual({ ok: true, value: 5 })
  })

  it('turns an angle right from the back line, not from the leg', () => {
    // Arriving on 45°, the back line is 225°; an angle right of 90° leaves on
    // 315°. Measuring from the leg instead would give 135° — the mistake this
    // convention exists to prevent.
    const r = parseBearing('90', 'interior', 45)
    expect(r.ok && r.value).toBeCloseTo(315, 12)
  })

  it('says why a relative bearing cannot be the first leg, and what to type instead', () => {
    for (const mode of ['deflection', 'interior'] as const) {
      const r = parseBearing('90', mode, null)
      expect(r.ok).toBe(false)
      expect(!r.ok && r.error).toMatch(/azimuth or a quadrant bearing/)
    }
  })

  it('writes a bearing back in the notation it was entered in', () => {
    expect(formatBearing(45.5, 'azimuth')).toBe("45°30'")
    expect(formatBearing(135, 'quadrant')).toBe('S45°E')
    expect(formatBearing(315, 'quadrant')).toBe('N45°W')
    expect(formatBearing(135, 'deflection', 45)).toBe('R90°')
    expect(formatBearing(32.5, 'deflection', 45)).toBe('L12°30\'')
    expect(formatBearing(315, 'interior', 45)).toBe('90°')
  })

  it('round-trips every quadrant through parse and format', () => {
    for (const az of [0, 12.5, 89.9, 90, 175, 180, 269.5, 315, 359.99]) {
      const text = formatBearing(az, 'quadrant')
      const back = parseBearing(text, 'quadrant', null)
      expect(back.ok && norm360(back.value)).toBeCloseTo(norm360(Math.round(az * 3600) / 3600), 6)
    }
  })
})

describe('distances', () => {
  it('converts the units a deed is written in', () => {
    expect(toMetres(1, 'ft')).toBeCloseTo(0.3048, 12)
    expect(toMetres(1, 'chain')).toBeCloseTo(20.11684023368, 8)
    expect(toMetres(1, 'mi')).toBe(1609.344)
  })

  it('keeps the US survey foot distinct from the international one', () => {
    // 2 ppm — 6 mm in 3 km. It is the unit of most State Plane zones, and
    // silently picking the other one is the error nobody sees.
    expect(UNITS.usft.toMetre).toBeCloseTo(1200 / 3937, 15)
    // 10,000 ft of boundary: 6.1 mm apart, one way or the other.
    expect(toMetres(10000, 'usft') - toMetres(10000, 'ft')).toBeCloseTo(0.0061, 4)
  })

  it('takes the unit from the field when one is typed there', () => {
    expect(parseDistance('150', 'm')).toEqual({ ok: true, value: 150 })
    const ft = parseDistance('150ft', 'm')
    expect(ft.ok && ft.value).toBeCloseTo(45.72, 9)
    const ch = parseDistance('20 ch', 'm')
    expect(ch.ok && ch.value).toBeCloseTo(402.3368046736, 6)
    // The selected unit still applies when none is typed.
    const sel = parseDistance('150', 'ft')
    expect(sel.ok && sel.value).toBeCloseTo(45.72, 9)
  })

  it('refuses a zero-length leg and an unknown unit, and names the way out', () => {
    expect(parseDistance('0', 'm').ok).toBe(false)
    const u = parseDistance('150 furlongs', 'm')
    expect(u.ok).toBe(false)
    expect(!u.ok && u.error).toMatch(/Try m, km, ft/)
  })

  it('prints a distance with the precision the unit deserves', () => {
    expect(formatDistance(150, 'm')).toBe('150.00 m')
    expect(formatDistance(1609.344, 'mi')).toBe('1.0000 mi')
  })
})

describe('coordinates', () => {
  it('reads longitude, latitude — the order everything else in the app uses', () => {
    expect(parseCoordinate('-122.42, 37.77')).toEqual({ ok: true, value: [-122.42, 37.77] })
    expect(parseCoordinate('10 20').ok).toBe(true)
  })

  it('reads back what the readouts print', () => {
    // The readouts use U+2212 MINUS SIGN, and someone copying a coordinate out
    // of one and pasting it back in must not be told it is not a number.
    expect(parseCoordinate('−122.42, 37.77')).toEqual({ ok: true, value: [-122.42, 37.77] })
  })

  it('names which one comes first when the ranges say it was the other way', () => {
    const r = parseCoordinate('37.77, -122.42')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/Longitude comes first/)
    expect(parseCoordinate('abc').ok).toBe(false)
    expect(parseCoordinate('').ok).toBe(false)
  })
})

describe('a traverse', () => {
  const ring = (): Position[] => {
    // A 100 m square, walked clockwise from a corner.
    let p: Position = [-122.4194, 37.7749]
    const out: Position[] = [p]
    for (const az of [0, 90, 180]) {
      p = destination(p, 100, az)
      out.push(p)
    }
    return out
  }

  it('turns relative bearings from the azimuth the last leg arrived on', () => {
    const v = ring()
    expect(incomingAzimuth([v[0]])).toBeNull()
    const inc = incomingAzimuth(v.slice(0, 2))!
    expect(inc).toBeCloseTo(0, 6)
  })

  it('reports how far a ring misses closing, and how good that is', () => {
    const v = ring()
    const c = closure(v)!
    // Three sides of a 100 m square: the fourth side is the misclosure.
    expect(c.distanceM).toBeCloseTo(100, 1)
    expect(c.perimeterM).toBeCloseTo(300, 1)
    expect(c.ratio).toBeCloseTo(3, 1)
  })

  it('calls an exact closure exact rather than dividing by zero', () => {
    const v = ring()
    const c = closure([...v, v[0]])!
    expect(c.distanceM).toBeCloseTo(0, 6)
    expect(c.ratio).toBe(Infinity)
    expect(formatRatio(c.ratio)).toBe('exact')
  })

  it('needs three vertices before closure means anything', () => {
    expect(closure([[0, 0], [1, 1]])).toBeNull()
  })

  it('quotes a precision the way a traverse is judged', () => {
    expect(formatRatio(12345.6)).toBe('1:12,346')
  })
})

describe('grid reduction', () => {
  it('turns a grid bearing and distance into the geodesic pair that draws it', () => {
    // Convergence is grid north → true north; scale is grid ÷ ground. Both come
    // from R for the current vertex; this is what previews the leg being typed.
    const r = reduceGridLeg(1000, 45, { x: 0, y: 0, convergence: -1.5, scale: 0.9996 })
    expect(r.azimuth).toBeCloseTo(43.5, 12)
    expect(r.distanceM).toBeCloseTo(1000.4, 1)
  })
})

describe("the ribbon's one-line entry", () => {
  it('parses absolute lng,lat', () => {
    expect(parseCadInput('-122.42, 37.77', null)).toEqual({
      position: [-122.42, 37.77],
      relative: false,
    })
    expect(parseCadInput('10 20', null)?.position).toEqual([10, 20])
  })

  it('rejects out-of-range and malformed input', () => {
    expect(parseCadInput('200, 10', null)).toBeNull()
    expect(parseCadInput('abc', null)).toBeNull()
    expect(parseCadInput('', null)).toBeNull()
  })

  it('places a relative vertex geodesically, not on a sphere', () => {
    const res = parseCadInput('d1000 a90', [0, 0])!
    expect(res.relative).toBe(true)
    // 1 km due east of the origin is 1000/111319.49 of a degree. The spherical
    // formula this replaced said 0.008993 — 1.1 m further out, every time.
    expect(res.position[0]).toBeCloseTo(1000 / DEG_ON_EQUATOR, 9)
    expect(res.position[1]).toBeCloseTo(0, 9)

    const res2 = parseCadInput('a90 d1000', [0, 0])!
    expect(res2.position[0]).toBeCloseTo(res.position[0], 12)
  })

  it('requires a last vertex, and both halves, for the relative form', () => {
    expect(parseCadInput('d100 a45', null)).toBeNull()
    expect(parseCadInput('d100', [0, 0])).toBeNull()
  })
})
