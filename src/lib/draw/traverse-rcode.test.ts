import { describe, it, expect } from 'vitest'
import { buildTraverseRCode } from './traverse-rcode'
import type { TraverseLeg } from './cogo'
import type { CrsInfo } from '@/store/traverse'

const leg = (over: Partial<TraverseLeg> = {}): TraverseLeg => ({
  type: 'line',
  distanceText: '150', bearingText: '45', unit: 'm', mode: 'azimuth',
  distanceM: 150, azimuth: 45, ...over,
})

const utm: CrsInfo = {
  input: 'EPSG:32610', epsg: 32610, name: 'WGS 84 / UTM zone 10N',
  isGeographic: false, unitName: 'metre', unitToMetre: 1,
}

describe('the R a traverse echoes', () => {
  it('is a runnable call, not a description of one', () => {
    const code = buildTraverseRCode([-122.4194, 37.7749], [leg(), leg({ distanceM: 82, azimuth: 168 })], 'geodesic', null)!
    expect(code).toContain('ourgeo_traverse(')
    expect(code).toContain('c(-122.4194, 37.7749)')
    expect(code).toContain('distance = c(150, 82)')
    expect(code).toContain('azimuth  = c(45, 168)')
    expect(code).not.toContain('crs =')
  })

  it('names the grid it was measured on, by EPSG code', () => {
    const code = buildTraverseRCode([-122.4194, 37.7749], [leg()], 'grid', utm)!
    expect(code).toContain('crs = 32610L')
    expect(code).toContain('on the layer grid')
  })

  it('quotes a CRS that has no EPSG code rather than pasting it bare', () => {
    // A CRS built from WKT or proj4 has no code; the string still has to be
    // safe to sit inside generated R.
    const wkt: CrsInfo = { ...utm, epsg: null, input: 'PROJCS["odd" name]' }
    const code = buildTraverseRCode([0, 0], [leg()], 'grid', wkt)!
    expect(code).toContain('crs = "PROJCS[\\"odd\\" name]"')
  })

  it('keeps the unit the legs were typed in, where only a comment can', () => {
    // `ourgeo_traverse` takes metres, so the numbers are metres — but a
    // traverse booked in US survey feet should not read back as if it never
    // had a unit.
    const code = buildTraverseRCode([0, 0], [leg({ unit: 'usft', distanceText: '328.08', distanceM: 100 })], 'geodesic', null)!
    expect(code).toContain('entered in us ft')
    expect(code).toContain('328.08 us ft')
  })

  it('shows each leg as it was typed, in its own notation', () => {
    const code = buildTraverseRCode([0, 0], [
      leg({ bearingText: "N45°30'E", mode: 'quadrant', azimuth: 45.5 }),
      leg({ bearingText: 'R90', mode: 'deflection', azimuth: 135.5 }),
    ], 'geodesic', null)!
    expect(code).toContain("N45°30'E")
  })

  it('has nothing to say about a traverse with no legs', () => {
    expect(buildTraverseRCode([0, 0], [], 'geodesic', null)).toBeNull()
  })

  it('writes coordinates with enough decimals to mean something', () => {
    // Six decimals is ~10 cm. Four — jsonlite's default, and the bug this
    // feature found in the R server — is eleven metres.
    const code = buildTraverseRCode([-122.41943217, 37.77492811], [leg()], 'geodesic', null)!
    expect(code).toContain('c(-122.419432, 37.774928)')
  })
})
