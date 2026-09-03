// @vitest-environment jsdom
// Raster / Image Layers connectors: registry shape, capabilities parsing
// (WCS/WMS via DOMParser, ERDDAP grid info), and generated-R checks. Network
// calls are mocked at the proxyFetch boundary with fixture responses.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fixtures = new Map<string, string>()
vi.mock('@/lib/ai-proxy-fetch', () => ({
  proxyFetch: vi.fn(async (url: string) => {
    for (const [needle, body] of fixtures) {
      if (url.includes(needle)) return { ok: true, status: 200, text: async () => body }
    }
    throw new Error(`No fixture for ${url}`)
  }),
}))

import { API_CATEGORY_ORDER, providerList, providersByCategory } from './registry'
import { esriProvider } from './esri'
import { esriImageProvider } from './esri-image'
import { wcsProvider } from './wcs'
import { wmsProvider } from './wms'
import { erddapGridProvider } from './erddap-grid'
import { stacProvider } from './stac'

const ctx = (baseUrl: string) => ({ baseUrl, apiKeys: {} })
const BBOX: [number, number, number, number] = [-10, 45, -5, 50]

beforeEach(() => fixtures.clear())

describe('registry', () => {
  it('has the Raster / Image Layers category in display order', () => {
    expect(API_CATEGORY_ORDER).toEqual([
      'Open Data', 'Geospatial', 'Raster / Image Layers', 'Scientific', 'Statistics',
    ])
  })
  it('groups the five raster connectors under the new category', () => {
    const group = providersByCategory().find((g) => g.category === 'Raster / Image Layers')
    expect(group?.providers.map((p) => p.id)).toEqual(['esri-image', 'wcs', 'wms', 'stac', 'erddap-grid'])
  })
  it('keeps every provider id unique', () => {
    const ids = providerList().map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('moved STAC out of Geospatial', () => {
    expect(stacProvider.category).toBe('Raster / Image Layers')
  })
})

describe('Esri service split', () => {
  const services = JSON.stringify({
    services: [
      { name: 'Roads', type: 'FeatureServer' },
      { name: 'Cities', type: 'MapServer' },
      { name: '3DEPElevation', type: 'ImageServer' },
    ],
    folders: [],
  })

  it('generic Esri lists only Feature/Map services', async () => {
    fixtures.set('example-esri', services)
    const opts = await esriProvider.listLevel('service', {}, ctx('https://example-esri/rest/services'))
    expect(opts.map((o) => o.value)).toEqual(['Roads/FeatureServer', 'Cities/MapServer'])
  })

  it('Esri Image Services lists only ImageServers', async () => {
    fixtures.set('example-esri', services)
    const opts = await esriImageProvider.listLevel('service', {}, ctx('https://example-esri/rest/services'))
    expect(opts).toEqual([{ value: '3DEPElevation/ImageServer', label: '3DEPElevation' }])
  })
})

describe('OGC WCS connector', () => {
  const caps = `<?xml version="1.0"?>
<wcs:Capabilities xmlns:wcs="http://www.opengis.net/wcs/2.0" xmlns:ows="http://www.opengis.net/ows/2.0">
  <wcs:Contents>
    <wcs:CoverageSummary>
      <ows:Title>Mean depth</ows:Title>
      <ows:WGS84BoundingBox>
        <ows:LowerCorner>-36 15</ows:LowerCorner>
        <ows:UpperCorner>43 90</ows:UpperCorner>
      </ows:WGS84BoundingBox>
      <wcs:CoverageId>emodnet__mean</wcs:CoverageId>
    </wcs:CoverageSummary>
  </wcs:Contents>
</wcs:Capabilities>`

  it('parses coverages and extents from GetCapabilities', async () => {
    fixtures.set('wcs-a.test', caps)
    const opts = await wcsProvider.listLevel('coverage', {}, ctx('https://wcs-a.test/wcs'))
    expect(opts).toEqual([{ value: 'emodnet__mean', label: 'Mean depth' }])
    const meta = await wcsProvider.getMetadata({ coverage: 'emodnet__mean' }, ctx('https://wcs-a.test/wcs'))
    expect(meta.queryable).toBe(false)
    expect(meta.rasterResult).toBe(true)
    expect(meta.imageExport?.extent4326).toEqual([-36, 15, 43, 90])
    expect(meta.imageExport?.bandCount).toBe(1)
  })

  it('generates ourgeo_read_wcs() with bbox and size', async () => {
    fixtures.set('wcs-b.test', caps)
    const meta = await wcsProvider.getMetadata({ coverage: 'emodnet__mean' }, ctx('https://wcs-b.test/wcs'))
    const code = meta.downloadCode!('depth', { bbox: BBOX, size: 1024 })
    expect(code).toContain('ourgeo_read_wcs(')
    expect(code).toContain('coverage_id = "emodnet__mean"')
    expect(code).toContain('bbox        = c(-10, 45, -5, 50)')
    expect(code).toContain('size        = 1024L')
  })
})

describe('OGC WMS connector', () => {
  const caps = `<?xml version="1.0"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Capability>
    <Request>
      <GetMap>
        <Format>image/png</Format>
        <Format>image/jpeg</Format>
      </GetMap>
    </Request>
    <Layer>
      <Title>Root</Title>
      <EX_GeographicBoundingBox>
        <westBoundLongitude>-180</westBoundLongitude>
        <eastBoundLongitude>180</eastBoundLongitude>
        <southBoundLatitude>-90</southBoundLatitude>
        <northBoundLatitude>90</northBoundLatitude>
      </EX_GeographicBoundingBox>
      <Layer>
        <Name>TrueColor</Name>
        <Title>True Color</Title>
        <Dimension name="time" units="ISO8601" default="2026-07-15">2020-01-01/2026-07-15/P1D</Dimension>
      </Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`

  it('parses named layers, inherited extent, time dimension and formats', async () => {
    fixtures.set('wms-a.test', caps)
    const opts = await wmsProvider.listLevel('layer', {}, ctx('https://wms-a.test/wms'))
    expect(opts).toEqual([{ value: 'TrueColor', label: 'True Color' }])
    const meta = await wmsProvider.getMetadata({ layer: 'TrueColor' }, ctx('https://wms-a.test/wms'))
    expect(meta.imageExport?.extent4326).toEqual([-180, -90, 180, 90])
    expect(meta.imageExport?.time).toEqual({ default: '2026-07-15', extent: '2020-01-01 – 2026-07-15' })
  })

  it('generates ourgeo_read_wms() with time and PNG fallback format', async () => {
    fixtures.set('wms-b.test', caps)
    const meta = await wmsProvider.getMetadata({ layer: 'TrueColor' }, ctx('https://wms-b.test/wms'))
    const code = meta.downloadCode!('img', { bbox: BBOX, size: 2048, time: '2026-07-10' })
    expect(code).toContain('ourgeo_read_wms(')
    expect(code).toContain('layer     = "TrueColor"')
    expect(code).toContain('format    = "image/png"') // no TIFF advertised
    expect(code).toContain('time      = "2026-07-10"')
  })
})

describe('ERDDAP Grids connector', () => {
  const allDatasets = JSON.stringify({
    table: {
      columnNames: ['datasetID', 'title', 'dataStructure'],
      rows: [['sstDaily', 'Daily SST', 'grid']],
    },
  })
  const infoIndex = JSON.stringify({
    table: {
      columnNames: ['Row Type', 'Variable Name', 'Attribute Name', 'Data Type', 'Value'],
      rows: [
        ['attribute', 'NC_GLOBAL', 'time_coverage_start', 'String', '2020-01-01T00:00:00Z'],
        ['attribute', 'NC_GLOBAL', 'time_coverage_end', 'String', '2026-07-15T00:00:00Z'],
        ['dimension', 'time', '', 'double', 'nValues=100, evenlySpaced=false'],
        ['dimension', 'latitude', '', 'float', 'nValues=4000, evenlySpaced=true, averageSpacing=0.041'],
        ['attribute', 'latitude', 'actual_range', 'float', '-89.9, 89.9'],
        ['dimension', 'longitude', '', 'float', 'nValues=8000, evenlySpaced=true, averageSpacing=0.041'],
        ['attribute', 'longitude', 'actual_range', 'float', '-179.9, 179.9'],
        ['variable', 'sst', '', 'float', ''],
        ['attribute', 'sst', 'long_name', 'String', 'Sea Surface Temperature'],
      ],
    },
  })

  it('lists grid datasets and variables with long names', async () => {
    fixtures.set('allDatasets.json', allDatasets)
    fixtures.set('/info/sstDaily/', infoIndex)
    const ds = await erddapGridProvider.listLevel('dataset', {}, ctx('https://erddap-a.test/erddap'))
    expect(ds).toEqual([{ value: 'sstDaily', label: 'Daily SST' }])
    const vars = await erddapGridProvider.listLevel('variable', { dataset: 'sstDaily' }, ctx('https://erddap-a.test/erddap'))
    expect(vars).toEqual([{ value: 'sst', label: 'sst — Sea Surface Temperature' }])
  })

  it('derives extent, dtype and time default; generates ourgeo_read_erddap_grid()', async () => {
    fixtures.set('/info/sstDaily/', infoIndex)
    const meta = await erddapGridProvider.getMetadata(
      { dataset: 'sstDaily', variable: 'sst' }, ctx('https://erddap-b.test/erddap'),
    )
    expect(meta.imageExport?.extent4326).toEqual([-179.9, -89.9, 179.9, 89.9])
    expect(meta.imageExport?.pixelType).toBe('F32')
    expect(meta.imageExport?.time?.default).toBe('2026-07-15T00:00:00Z')

    const code = meta.downloadCode!('sst', { bbox: BBOX, size: 512, time: '' })
    expect(code).toContain('ourgeo_read_erddap_grid(')
    expect(code).toContain('dataset_id = "sstDaily"')
    expect(code).toContain('variable   = "sst"')
    expect(code).toContain('time       = "last"') // empty input falls back to latest
    expect(code).toContain('size       = 512L')
  })
})
