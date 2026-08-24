import { describe, it, expect } from 'vitest'
import { generateTmapCode } from './tmap-codegen'
import { makeTmapParams, makeRasterLayer } from './codegen-fixtures'

describe('generateTmapCode', () => {
  it('emits a static plot-mode tmap with a tm_shape layer', () => {
    const code = generateTmapCode(makeTmapParams())
    expect(code.startsWith('library(tmap)')).toBe(true)
    expect(code).toContain('tmap_mode("plot")')
    expect(code).toContain('tm <-')
    expect(code).toContain('tm_shape(')
    expect(code).toContain('roads')
    expect(code).not.toContain('library(maptiles)')
  })

  it('switches to view mode when activeView is set', () => {
    const code = generateTmapCode(makeTmapParams({ activeView: true }))
    expect(code).toContain('tmap_mode("view")')
  })

  it('produces an empty-map placeholder with no visible layers', () => {
    const code = generateTmapCode(makeTmapParams({ layers: [] }))
    expect(code).toContain('# No visible layers')
    expect(code).toContain('tm <- tm_basemap(NULL)')
  })

  it('appends a tmap_save block when export options are given', () => {
    const code = generateTmapCode(makeTmapParams({
      exportOpts: { path: '/tmp/map.png', width: 800, height: 600, units: 'px', dpi: 96, format: 'png' },
    }))
    expect(code).toContain('tmap_save(tm,')
  })

  it('emits tm_raster with the on-map ramp and stretch for a singleband raster', () => {
    const code = generateTmapCode(makeTmapParams({ layers: [makeRasterLayer()] }))
    expect(code).toContain('library(terra)')
    expect(code).toContain('tm_shape(dem[[1]]')
    expect(code).toContain('tm_raster(')
    expect(code).toContain('tm_scale_continuous(')
    expect(code).toContain('limits = c(200, 503)')
    expect(code).toContain('"#440154"')
  })

  it('emits tm_rgb over a matching terra::stretch for RGB mode', () => {
    const code = generateTmapCode(makeTmapParams({
      layers: [makeRasterLayer({ mode: 'rgb', bands: [3, 2, 1] })],
    }))
    expect(code).toContain('terra::stretch(dem[[c(3, 2, 1)]], minq = 0.02, maxq = 0.98)')
    expect(code).toContain('tm_rgb()')
  })

  it('emits tm_scale_categorical with category colors in categorical mode', () => {
    const code = generateTmapCode(makeTmapParams({
      layers: [makeRasterLayer({
        mode: 'categorical',
        categories: [
          { value: 1, label: 'water', color: '#1f77b4' },
          { value: 2, label: 'forest', color: '#2ca02c' },
        ],
      })],
    }))
    expect(code).toContain('as.factor(dem[[1]])')
    expect(code).toContain('tm_scale_categorical(values = c("#1f77b4", "#2ca02c"))')
  })
})
