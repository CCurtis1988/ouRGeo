import { describe, it, expect } from 'vitest'
import { generateGgplotCode } from './ggplot-codegen'
import { DEFAULT_MAP_ANNOTATIONS } from './map-annotations'
import { makeGgplotParams, makeLayer, makeRasterLayer } from './codegen-fixtures'

describe('generateGgplotCode', () => {
  it('emits a static ggplot with libraries, a geom_sf layer, and a base theme', () => {
    const code = generateGgplotCode(makeGgplotParams())
    expect(code.startsWith('library(ggplot2)')).toBe(true)
    expect(code).toContain('library(sf)')
    expect(code).toContain('p <- ggplot() +')
    expect(code).toContain('geom_sf(')
    expect(code).toContain('roads')
    expect(code).toContain('theme_void()')
    expect(code).not.toContain('library(plotly)')
    expect(code.endsWith('p')).toBe(true)
  })

  it('switches to a plotly interactive view when activeView is set', () => {
    const code = generateGgplotCode(makeGgplotParams({ activeView: true }))
    expect(code).toContain('library(plotly)')
    expect(code).toContain('plotly::ggplotly(p)')
  })

  it('appends a ggsave block when export options are given', () => {
    const code = generateGgplotCode(makeGgplotParams({
      exportOpts: { path: '/tmp/map.png', width: 800, height: 600, units: 'px', dpi: 96, format: 'png' },
    }))
    expect(code).toContain('ggplot2::ggsave(')
    expect(code).toContain('filename = "/tmp/map.png"')
    expect(code).toContain('width    = 800')
  })

  it('still produces a valid skeleton with no visible layers', () => {
    const code = generateGgplotCode(makeGgplotParams({ layers: [] }))
    expect(code).toContain('p <- ggplot() +')
    expect(code).toContain('theme_void()')
    expect(code).not.toContain('geom_sf(')
  })

  it('honours the ggplot base theme from annotations', () => {
    const code = generateGgplotCode(makeGgplotParams({
      annotations: { ...DEFAULT_MAP_ANNOTATIONS, ggplotTheme: 'bw' },
    }))
    expect(code).toContain('theme_bw()')
  })

  it('emits geom_spatraster with the on-map stretch and ramp for a singleband raster', () => {
    const code = generateGgplotCode(makeGgplotParams({ layers: [makeRasterLayer()] }))
    expect(code).toContain('library(terra)')
    expect(code).toContain('library(tidyterra)')
    expect(code).toContain('geom_spatraster(')
    expect(code).toContain('data  = dem[[1]]')
    // Resolved 2–98% stretch bounds become explicit limits
    expect(code).toContain('limits = c(200, 503)')
    expect(code).toContain('oob = scales::squish')
    // viridis hex stops from the shared ramp registry
    expect(code).toContain('"#440154"')
    expect(code).toContain('name = "elevation"')
    // Lone raster with no vector fill users needs no ggnewscale
    expect(code).not.toContain('ggnewscale')
  })

  it('separates raster and vector fill scales with ggnewscale when both exist', () => {
    const code = generateGgplotCode(makeGgplotParams({
      layers: [makeRasterLayer(), makeLayer()],
    }))
    expect(code).toContain('library(ggnewscale)')
    expect(code).toContain('ggnewscale::new_scale_fill()')
    expect(code).toContain('geom_spatraster(')
    expect(code).toContain('geom_sf(')
  })

  it('emits geom_spatraster_rgb with a matching terra::stretch for RGB mode', () => {
    const code = generateGgplotCode(makeGgplotParams({
      layers: [makeRasterLayer({ mode: 'rgb', bands: [3, 2, 1] })],
    }))
    expect(code).toContain('geom_spatraster_rgb(')
    expect(code).toContain('terra::stretch(dem[[c(3, 2, 1)]], minq = 0.02, maxq = 0.98)')
    expect(code).not.toContain('scale_fill_gradientn')
  })

  it('emits a manual fill scale from the category colors in categorical mode', () => {
    const code = generateGgplotCode(makeGgplotParams({
      layers: [makeRasterLayer({
        mode: 'categorical',
        categories: [
          { value: 1, label: 'water', color: '#1f77b4' },
          { value: 2, label: 'forest', color: '#2ca02c' },
        ],
      })],
    }))
    expect(code).toContain('as.factor(dem[[1]])')
    expect(code).toContain('scale_fill_manual(values = c("water" = "#1f77b4", "forest" = "#2ca02c")')
  })
})
