const CARTO = 'https://basemaps.cartocdn.com/gl'
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'

export type BasemapCategory = 'free' | 'mapbox' | 'maptiler' | 'stadia'

export interface BasemapDef {
  id: string
  name: string
  provider: string
  category: BasemapCategory
  apiKeyId?: string
  tags: string[]
  previewUrl: string | null
  previewBg: string
  styleObject?: object
  styleUrl?: string | ((key: string) => string)
}

// ---------- Raster tile style builder ----------

function rasterStyle(tiles: string[], attribution: string): object {
  return {
    version: 8,
    sources: {
      'raster-source': { type: 'raster', tiles, tileSize: 256, attribution },
    },
    layers: [{ id: 'raster-layer', type: 'raster', source: 'raster-source' }],
  }
}

// ---------- Free basemaps ----------

export const FREE_BASEMAPS: BasemapDef[] = [
  // CARTO
  {
    id: 'carto-dark-matter',
    name: 'Dark Matter',
    provider: 'CARTO',
    category: 'free',
    tags: ['dark', 'minimal'],
    previewUrl: `${CARTO}/dark-matter-gl-style/preview.png`,
    previewBg: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    styleUrl: `${CARTO}/dark-matter-gl-style/style.json`,
  },
  {
    id: 'carto-dark-matter-nolabels',
    name: 'Dark Matter — No Labels',
    provider: 'CARTO',
    category: 'free',
    tags: ['dark', 'minimal'],
    previewUrl: `${CARTO}/dark-matter-nolabels-gl-style/preview.png`,
    previewBg: 'linear-gradient(135deg, #1a1a2e 0%, #0d0d1a 100%)',
    styleUrl: `${CARTO}/dark-matter-nolabels-gl-style/style.json`,
  },
  {
    id: 'carto-voyager',
    name: 'Voyager',
    provider: 'CARTO',
    category: 'free',
    tags: ['light', 'streets', 'colorful'],
    previewUrl: `${CARTO}/voyager-gl-style/preview.png`,
    previewBg: 'linear-gradient(135deg, #e8f0f8 0%, #c8dce8 50%, #a8c0d0 100%)',
    styleUrl: `${CARTO}/voyager-gl-style/style.json`,
  },
  {
    id: 'carto-voyager-nolabels',
    name: 'Voyager — No Labels',
    provider: 'CARTO',
    category: 'free',
    tags: ['light', 'streets'],
    previewUrl: `${CARTO}/voyager-nolabels-gl-style/preview.png`,
    previewBg: 'linear-gradient(135deg, #dce8f0 0%, #b8ccdc 100%)',
    styleUrl: `${CARTO}/voyager-nolabels-gl-style/style.json`,
  },
  {
    id: 'carto-positron',
    name: 'Positron',
    provider: 'CARTO',
    category: 'free',
    tags: ['light', 'minimal'],
    previewUrl: `${CARTO}/positron-gl-style/preview.png`,
    previewBg: 'linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 50%, #d8d8d8 100%)',
    styleUrl: `${CARTO}/positron-gl-style/style.json`,
  },
  {
    id: 'carto-positron-nolabels',
    name: 'Positron — No Labels',
    provider: 'CARTO',
    category: 'free',
    tags: ['light', 'minimal'],
    previewUrl: `${CARTO}/positron-nolabels-gl-style/preview.png`,
    previewBg: 'linear-gradient(135deg, #f8f8f8 0%, #ececec 100%)',
    styleUrl: `${CARTO}/positron-nolabels-gl-style/style.json`,
  },

  // OpenFreeMap
  {
    id: 'ofm-liberty',
    name: 'Liberty',
    provider: 'OpenFreeMap',
    category: 'free',
    tags: ['light', 'streets', 'colorful'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #e8f4ea 0%, #b8d4b8 35%, #c8d8e8 70%, #d8c8a0 100%)',
    styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
  },
  {
    id: 'ofm-bright',
    name: 'Bright',
    provider: 'OpenFreeMap',
    category: 'free',
    tags: ['light', 'streets'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #f0f4f8 0%, #c8d8e8 50%, #a8d0c0 100%)',
    styleUrl: 'https://tiles.openfreemap.org/styles/bright',
  },
  {
    id: 'ofm-positron',
    name: 'Positron',
    provider: 'OpenFreeMap',
    category: 'free',
    tags: ['light', 'minimal'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #f5f5f5 0%, #e0e0e0 100%)',
    styleUrl: 'https://tiles.openfreemap.org/styles/positron',
  },

  // OSM raster
  {
    id: 'osm-standard',
    name: 'OpenStreetMap',
    provider: 'OpenStreetMap',
    category: 'free',
    tags: ['light', 'streets'],
    previewUrl: 'https://tile.openstreetmap.org/2/2/1.png',
    previewBg: 'linear-gradient(135deg, #f2efe9 0%, #c8dea0 50%, #a0c0d8 100%)',
    styleObject: rasterStyle(
      ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    ),
  },
  {
    id: 'osm-topo',
    name: 'OpenTopoMap',
    provider: 'OpenTopoMap',
    category: 'free',
    tags: ['topo', 'outdoor'],
    previewUrl: 'https://a.tile.opentopomap.org/2/2/1.png',
    previewBg: 'linear-gradient(135deg, #e8f0e0 0%, #c0d4a0 50%, #a0b880 100%)',
    styleObject: rasterStyle(
      [
        'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
      ],
      'Map data: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: © <a href="https://opentopomap.org">OpenTopoMap</a>'
    ),
  },

  // ESRI
  {
    id: 'esri-satellite',
    name: 'World Imagery',
    provider: 'ESRI',
    category: 'free',
    tags: ['satellite', 'dark'],
    previewUrl: `${ESRI}/World_Imagery/MapServer/tile/2/1/2`,
    previewBg: 'linear-gradient(135deg, #1a2a1a 0%, #0a1a0a 50%, #1a1a2a 100%)',
    styleObject: rasterStyle(
      [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
      'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    ),
  },
  {
    id: 'esri-streets',
    name: 'World Street Map',
    provider: 'ESRI',
    category: 'free',
    tags: ['streets', 'light'],
    previewUrl: `${ESRI}/World_Street_Map/MapServer/tile/2/1/2`,
    previewBg: 'linear-gradient(135deg, #f0ece0 0%, #d8d0c0 50%, #c8c0a8 100%)',
    styleObject: rasterStyle(
      [`${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`],
      'Tiles © Esri — Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom, 2012'
    ),
  },
  {
    id: 'esri-topo',
    name: 'World Topo Map',
    provider: 'ESRI',
    category: 'free',
    tags: ['topo', 'outdoor'],
    previewUrl: `${ESRI}/World_Topo_Map/MapServer/tile/2/1/2`,
    previewBg: 'linear-gradient(135deg, #e8f0e0 0%, #d0dcc0 50%, #c0cca8 100%)',
    styleObject: rasterStyle(
      [`${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`],
      'Tiles © Esri — Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community'
    ),
  },
  {
    id: 'esri-gray',
    name: 'World Light Gray',
    provider: 'ESRI',
    category: 'free',
    tags: ['minimal', 'light'],
    previewUrl: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/2/1/2`,
    previewBg: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 100%)',
    styleObject: rasterStyle(
      [`${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`],
      'Tiles © Esri — Esri, HERE, DeLorme, MapmyIndia, © OpenStreetMap contributors, and the GIS User Community'
    ),
  },

  // None
  {
    id: 'none',
    name: 'No Basemap',
    provider: 'None',
    category: 'free',
    tags: ['minimal'],
    previewUrl: null,
    previewBg:
      'repeating-conic-gradient(#1a1a1a 0% 25%, #111 0% 50%) 0 0 / 16px 16px',
    styleObject: { version: 8, sources: {}, layers: [] },
  },
]

// ---------- API basemaps ----------

export const API_BASEMAPS: BasemapDef[] = [
  // Mapbox
  {
    id: 'mapbox-streets',
    name: 'Streets',
    provider: 'Mapbox',
    category: 'mapbox',
    apiKeyId: 'mapbox',
    tags: ['streets', 'light'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #f0ece0 0%, #d8cdb8 50%, #c0b898 100%)',
    styleUrl: (k) => `https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=${k}`,
  },
  {
    id: 'mapbox-outdoors',
    name: 'Outdoors',
    provider: 'Mapbox',
    category: 'mapbox',
    apiKeyId: 'mapbox',
    tags: ['outdoor', 'topo'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #e8f0e0 0%, #c0d4b0 50%, #a0b880 100%)',
    styleUrl: (k) => `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12?access_token=${k}`,
  },
  {
    id: 'mapbox-light',
    name: 'Light',
    provider: 'Mapbox',
    category: 'mapbox',
    apiKeyId: 'mapbox',
    tags: ['minimal', 'light'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 100%)',
    styleUrl: (k) => `https://api.mapbox.com/styles/v1/mapbox/light-v11?access_token=${k}`,
  },
  {
    id: 'mapbox-dark',
    name: 'Dark',
    provider: 'Mapbox',
    category: 'mapbox',
    apiKeyId: 'mapbox',
    tags: ['dark', 'minimal'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #1a1a2e 0%, #0d0d1a 100%)',
    styleUrl: (k) => `https://api.mapbox.com/styles/v1/mapbox/dark-v11?access_token=${k}`,
  },
  {
    id: 'mapbox-satellite',
    name: 'Satellite',
    provider: 'Mapbox',
    category: 'mapbox',
    apiKeyId: 'mapbox',
    tags: ['satellite', 'dark'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #0a1a10 0%, #0a1420 100%)',
    styleUrl: (k) => `https://api.mapbox.com/styles/v1/mapbox/satellite-v9?access_token=${k}`,
  },
  {
    id: 'mapbox-satellite-streets',
    name: 'Satellite Streets',
    provider: 'Mapbox',
    category: 'mapbox',
    apiKeyId: 'mapbox',
    tags: ['satellite', 'streets'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #0a1a10 0%, #1a2a20 100%)',
    styleUrl: (k) => `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12?access_token=${k}`,
  },
  {
    id: 'mapbox-nav-day',
    name: 'Navigation Day',
    provider: 'Mapbox',
    category: 'mapbox',
    apiKeyId: 'mapbox',
    tags: ['streets', 'light'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #e8f0f8 0%, #c8d8e8 100%)',
    styleUrl: (k) => `https://api.mapbox.com/styles/v1/mapbox/navigation-day-v1?access_token=${k}`,
  },
  {
    id: 'mapbox-nav-night',
    name: 'Navigation Night',
    provider: 'Mapbox',
    category: 'mapbox',
    apiKeyId: 'mapbox',
    tags: ['streets', 'dark'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #0d1b2a 0%, #1b2838 100%)',
    styleUrl: (k) => `https://api.mapbox.com/styles/v1/mapbox/navigation-night-v1?access_token=${k}`,
  },

  // MapTiler
  {
    id: 'maptiler-streets',
    name: 'Streets',
    provider: 'MapTiler',
    category: 'maptiler',
    apiKeyId: 'maptiler',
    tags: ['streets', 'light'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #f0ece0 0%, #d8cdb8 100%)',
    styleUrl: (k) => `https://api.maptiler.com/maps/streets-v2/style.json?key=${k}`,
  },
  {
    id: 'maptiler-satellite',
    name: 'Satellite',
    provider: 'MapTiler',
    category: 'maptiler',
    apiKeyId: 'maptiler',
    tags: ['satellite'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #0a1a10 0%, #0a1420 100%)',
    styleUrl: (k) => `https://api.maptiler.com/maps/satellite/style.json?key=${k}`,
  },
  {
    id: 'maptiler-outdoor',
    name: 'Outdoor',
    provider: 'MapTiler',
    category: 'maptiler',
    apiKeyId: 'maptiler',
    tags: ['outdoor', 'topo'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #e0ecd8 0%, #b8d0a8 100%)',
    styleUrl: (k) => `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${k}`,
  },
  {
    id: 'maptiler-basic',
    name: 'Basic',
    provider: 'MapTiler',
    category: 'maptiler',
    apiKeyId: 'maptiler',
    tags: ['minimal', 'light'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #f5f5f0 0%, #e8e4d8 100%)',
    styleUrl: (k) => `https://api.maptiler.com/maps/basic-v2/style.json?key=${k}`,
  },
  {
    id: 'maptiler-dataviz',
    name: 'Dataviz',
    provider: 'MapTiler',
    category: 'maptiler',
    apiKeyId: 'maptiler',
    tags: ['minimal', 'dark'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #1a1a2e 0%, #2a2a3e 100%)',
    styleUrl: (k) => `https://api.maptiler.com/maps/dataviz/style.json?key=${k}`,
  },
  {
    id: 'maptiler-topo',
    name: 'Topo',
    provider: 'MapTiler',
    category: 'maptiler',
    apiKeyId: 'maptiler',
    tags: ['topo', 'outdoor'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #e8f0e0 0%, #d0dcc8 100%)',
    styleUrl: (k) => `https://api.maptiler.com/maps/topo-v2/style.json?key=${k}`,
  },
  {
    id: 'maptiler-bright',
    name: 'Bright',
    provider: 'MapTiler',
    category: 'maptiler',
    apiKeyId: 'maptiler',
    tags: ['streets', 'colorful'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #e0f0f8 0%, #b8d4e8 100%)',
    styleUrl: (k) => `https://api.maptiler.com/maps/bright-v2/style.json?key=${k}`,
  },
  {
    id: 'maptiler-dark',
    name: 'Dark Matter',
    provider: 'MapTiler',
    category: 'maptiler',
    apiKeyId: 'maptiler',
    tags: ['dark', 'minimal'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #1a1a2e 0%, #0d0d1a 100%)',
    styleUrl: (k) => `https://api.maptiler.com/maps/darkmatter/style.json?key=${k}`,
  },

  // Stadia
  {
    id: 'stadia-smooth',
    name: 'Alidade Smooth',
    provider: 'Stadia',
    category: 'stadia',
    apiKeyId: 'stadia',
    tags: ['minimal', 'light'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #f0f0ee 0%, #e0e0d8 100%)',
    styleUrl: (k) => `https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key=${k}`,
  },
  {
    id: 'stadia-smooth-dark',
    name: 'Alidade Smooth Dark',
    provider: 'Stadia',
    category: 'stadia',
    apiKeyId: 'stadia',
    tags: ['dark', 'minimal'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #1c1c1e 0%, #121214 100%)',
    styleUrl: (k) => `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${k}`,
  },
  {
    id: 'stadia-satellite',
    name: 'Alidade Satellite',
    provider: 'Stadia',
    category: 'stadia',
    apiKeyId: 'stadia',
    tags: ['satellite'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #0a180e 0%, #0a1020 100%)',
    styleUrl: (k) => `https://tiles.stadiamaps.com/styles/alidade_satellite.json?api_key=${k}`,
  },
  {
    id: 'stadia-osm-bright',
    name: 'OSM Bright',
    provider: 'Stadia',
    category: 'stadia',
    apiKeyId: 'stadia',
    tags: ['streets', 'light'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #f0ece0 0%, #d8d0b8 100%)',
    styleUrl: (k) => `https://tiles.stadiamaps.com/styles/osm_bright.json?api_key=${k}`,
  },
  {
    id: 'stadia-outdoors',
    name: 'Outdoors',
    provider: 'Stadia',
    category: 'stadia',
    apiKeyId: 'stadia',
    tags: ['outdoor', 'light'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #e4ecd8 0%, #c0d0a8 100%)',
    styleUrl: (k) => `https://tiles.stadiamaps.com/styles/outdoors.json?api_key=${k}`,
  },
  {
    id: 'stadia-stamen-terrain',
    name: 'Stamen Terrain',
    provider: 'Stadia',
    category: 'stadia',
    apiKeyId: 'stadia',
    tags: ['topo', 'outdoor'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #dce8d0 0%, #b8cca0 100%)',
    styleUrl: (k) => `https://tiles.stadiamaps.com/styles/stamen_terrain.json?api_key=${k}`,
  },
  {
    id: 'stadia-stamen-toner',
    name: 'Stamen Toner',
    provider: 'Stadia',
    category: 'stadia',
    apiKeyId: 'stadia',
    tags: ['minimal', 'high-contrast'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #ffffff 0%, #e8e8e8 50%, #ffffff 100%)',
    styleUrl: (k) => `https://tiles.stadiamaps.com/styles/stamen_toner.json?api_key=${k}`,
  },
  {
    id: 'stadia-stamen-watercolor',
    name: 'Stamen Watercolor',
    provider: 'Stadia',
    category: 'stadia',
    apiKeyId: 'stadia',
    tags: ['artistic', 'light'],
    previewUrl: null,
    previewBg: 'linear-gradient(135deg, #e8d8c8 0%, #c8b8a0 50%, #a8c8b8 100%)',
    styleUrl: (k) => `https://tiles.stadiamaps.com/styles/stamen_watercolor.json?api_key=${k}`,
  },
]

// ---------- Lookup + utilities ----------

export const BASEMAPS_BY_ID: Record<string, BasemapDef> = Object.fromEntries(
  [...FREE_BASEMAPS, ...API_BASEMAPS].map((b) => [b.id, b])
)

export const THEME_DEFAULT_BASEMAPS: Record<string, string> = {
  dark:           'carto-dark-matter',
  bespin:         'carto-voyager',
  neonLights:     'carto-dark-matter-nolabels',
  forest:         'carto-voyager',
  midnightDream:  'carto-dark-matter',
  candyAddiction: 'carto-dark-matter',
  heaven:         'carto-positron',
  volcanic:       'carto-dark-matter-nolabels',
  arctic:         'carto-dark-matter',
  retroTerminal:  'carto-dark-matter-nolabels',
}

/** Returns a MapLibre style URL string or an inline style object. */
export function resolveBasemapStyle(
  id: string,
  apiKeys: Record<string, string>
): string | object {
  const def = BASEMAPS_BY_ID[id]
  if (!def) return `${CARTO}/dark-matter-gl-style/style.json`

  if (def.styleObject !== undefined) return def.styleObject

  if (typeof def.styleUrl === 'function') {
    const key = apiKeys[def.apiKeyId ?? ''] ?? ''
    if (!key) return `${CARTO}/dark-matter-gl-style/style.json` // fallback when key missing
    return def.styleUrl(key)
  }

  return def.styleUrl as string
}
