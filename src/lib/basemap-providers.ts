export interface BasemapProviderInfo {
  /** Provider string for `maptiles::get_tiles()` in static tmap/ggplot. null = no basemap. */
  maptiles: string | null
  /** Provider string for `tmap_options(basemaps = ...)` in interactive tmap view mode. */
  leaflet: string | null
  /** Human-readable label used in generated code comments. */
  label: string
}

export const BASEMAP_PROVIDERS: Record<string, BasemapProviderInfo> = {
  // CARTO
  'carto-dark-matter':          { maptiles: 'CartoDB.DarkMatter',         leaflet: 'CartoDB.DarkMatter',         label: 'CARTO Dark Matter' },
  'carto-dark-matter-nolabels': { maptiles: 'CartoDB.DarkMatterNoLabels', leaflet: 'CartoDB.DarkMatterNoLabels', label: 'CARTO Dark Matter (No Labels)' },
  'carto-voyager':              { maptiles: 'CartoDB.Voyager',            leaflet: 'CartoDB.Voyager',            label: 'CARTO Voyager' },
  'carto-voyager-nolabels':     { maptiles: 'CartoDB.VoyagerNoLabels',    leaflet: 'CartoDB.VoyagerNoLabels',    label: 'CARTO Voyager (No Labels)' },
  'carto-positron':             { maptiles: 'CartoDB.Positron',           leaflet: 'CartoDB.Positron',           label: 'CARTO Positron' },
  'carto-positron-nolabels':    { maptiles: 'CartoDB.PositronNoLabels',   leaflet: 'CartoDB.PositronNoLabels',   label: 'CARTO Positron (No Labels)' },
  // OpenFreeMap — no exact maptiles equivalent; use closest approximation
  'ofm-liberty':                { maptiles: 'OpenStreetMap.Mapnik',       leaflet: 'OpenStreetMap',              label: 'OpenFreeMap Liberty (OSM fallback)' },
  'ofm-bright':                 { maptiles: 'OpenStreetMap.Mapnik',       leaflet: 'OpenStreetMap',              label: 'OpenFreeMap Bright (OSM fallback)' },
  'ofm-positron':               { maptiles: 'CartoDB.Positron',           leaflet: 'CartoDB.Positron',           label: 'OpenFreeMap Positron (CARTO fallback)' },
  // OSM / Topo
  'osm-standard':               { maptiles: 'OpenStreetMap.Mapnik',       leaflet: 'OpenStreetMap',              label: 'OpenStreetMap' },
  'osm-topo':                   { maptiles: 'OpenTopoMap',                leaflet: 'OpenTopoMap',                label: 'OpenTopoMap' },
  // ESRI
  'esri-satellite':             { maptiles: 'Esri.WorldImagery',          leaflet: 'Esri.WorldImagery',          label: 'ESRI World Imagery' },
  'esri-streets':               { maptiles: 'Esri.WorldStreetMap',        leaflet: 'Esri.WorldStreetMap',        label: 'ESRI World Street Map' },
  'esri-topo':                  { maptiles: 'Esri.WorldTopoMap',          leaflet: 'Esri.WorldTopoMap',          label: 'ESRI World Topo Map' },
  'esri-gray':                  { maptiles: 'Esri.WorldGrayCanvas',       leaflet: 'Esri.WorldGrayCanvas',       label: 'ESRI Light Gray Canvas' },
  // No basemap
  'none':                       { maptiles: null,                         leaflet: 'none',                       label: 'No Basemap' },
  // Mapbox — approximate fallbacks (API key required for exact match)
  'mapbox-streets':             { maptiles: 'OpenStreetMap.Mapnik',       leaflet: 'OpenStreetMap',              label: 'Mapbox Streets (OpenStreetMap fallback)' },
  'mapbox-outdoors':            { maptiles: 'OpenTopoMap',                leaflet: 'OpenTopoMap',                label: 'Mapbox Outdoors (OpenTopoMap fallback)' },
  'mapbox-light':               { maptiles: 'CartoDB.Positron',           leaflet: 'CartoDB.Positron',           label: 'Mapbox Light (CARTO Positron fallback)' },
  'mapbox-dark':                { maptiles: 'CartoDB.DarkMatter',         leaflet: 'CartoDB.DarkMatter',         label: 'Mapbox Dark (CARTO Dark Matter fallback)' },
  'mapbox-satellite':           { maptiles: 'Esri.WorldImagery',          leaflet: 'Esri.WorldImagery',          label: 'Mapbox Satellite (ESRI fallback)' },
  'mapbox-satellite-streets':   { maptiles: 'Esri.WorldImagery',          leaflet: 'Esri.WorldImagery',          label: 'Mapbox Satellite Streets (ESRI fallback)' },
  'mapbox-nav-day':             { maptiles: 'OpenStreetMap.Mapnik',       leaflet: 'OpenStreetMap',              label: 'Mapbox Navigation Day (OSM fallback)' },
  'mapbox-nav-night':           { maptiles: 'CartoDB.DarkMatter',         leaflet: 'CartoDB.DarkMatter',         label: 'Mapbox Navigation Night (CARTO fallback)' },
  // MapTiler — approximate fallbacks
  'maptiler-streets':           { maptiles: 'OpenStreetMap.Mapnik',       leaflet: 'OpenStreetMap',              label: 'MapTiler Streets (OSM fallback)' },
  'maptiler-satellite':         { maptiles: 'Esri.WorldImagery',          leaflet: 'Esri.WorldImagery',          label: 'MapTiler Satellite (ESRI fallback)' },
  'maptiler-outdoor':           { maptiles: 'OpenTopoMap',                leaflet: 'OpenTopoMap',                label: 'MapTiler Outdoor (OpenTopoMap fallback)' },
  'maptiler-basic':             { maptiles: 'CartoDB.Positron',           leaflet: 'CartoDB.Positron',           label: 'MapTiler Basic (CARTO fallback)' },
  'maptiler-dataviz':           { maptiles: 'CartoDB.DarkMatter',         leaflet: 'CartoDB.DarkMatter',         label: 'MapTiler Dataviz (CARTO fallback)' },
  'maptiler-topo':              { maptiles: 'OpenTopoMap',                leaflet: 'OpenTopoMap',                label: 'MapTiler Topo (OpenTopoMap fallback)' },
  'maptiler-bright':            { maptiles: 'CartoDB.Voyager',            leaflet: 'CartoDB.Voyager',            label: 'MapTiler Bright (CARTO Voyager fallback)' },
  'maptiler-dark':              { maptiles: 'CartoDB.DarkMatter',         leaflet: 'CartoDB.DarkMatter',         label: 'MapTiler Dark Matter (CARTO fallback)' },
  // Stadia
  'stadia-smooth':              { maptiles: 'CartoDB.Positron',           leaflet: 'Stadia.AlidadeSmooth',       label: 'Stadia Alidade Smooth' },
  'stadia-smooth-dark':         { maptiles: 'CartoDB.DarkMatter',         leaflet: 'Stadia.AlidadeSmoothDark',   label: 'Stadia Alidade Smooth Dark' },
  'stadia-satellite':           { maptiles: 'Esri.WorldImagery',          leaflet: 'Stadia.AlidadeSatellite',    label: 'Stadia Alidade Satellite' },
  'stadia-osm-bright':          { maptiles: 'OpenStreetMap.Mapnik',       leaflet: 'Stadia.OSMBright',           label: 'Stadia OSM Bright' },
  'stadia-outdoors':            { maptiles: 'OpenTopoMap',                leaflet: 'Stadia.Outdoors',            label: 'Stadia Outdoors' },
  'stadia-stamen-terrain':      { maptiles: 'OpenTopoMap',                leaflet: 'Stadia.StamenTerrain',       label: 'Stamen Terrain' },
  'stadia-stamen-toner':        { maptiles: 'CartoDB.Positron',           leaflet: 'Stadia.StamenToner',         label: 'Stamen Toner' },
  'stadia-stamen-watercolor':   { maptiles: 'CartoDB.Positron',           leaflet: 'Stadia.StamenWatercolor',    label: 'Stamen Watercolor (approximate fallback)' },
}

export function getProviderInfo(basemapId: string): BasemapProviderInfo {
  return BASEMAP_PROVIDERS[basemapId] ?? BASEMAP_PROVIDERS['carto-dark-matter']
}
