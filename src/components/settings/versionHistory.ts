// ── ouRGeo version history ────────────────────────────────────────────────
// Big-picture release notes, newest first. The first entry's `version` is the
// current app version shown in Settings, so this file is the single source of
// truth for both the version badge and the history popup.

export interface ReleaseNote {
  version: string
  date: string
  /** Short theme name for the release. */
  title: string
  /** One-sentence summary of what the release was about. */
  summary: string
  /** The handful of big-picture changes that defined the release. */
  highlights: string[]
}

export const VERSION_HISTORY: ReleaseNote[] = [
  {
    version: '1.8',
    date: 'July 2026',
    title: 'Raster & Imagery Connectors',
    summary:
      'The Data Connector gains a dedicated Raster / Image Layers category — industry-standard imagery services import straight to the map.',
    highlights: [
      'New Raster / Image Layers category in the Web APIs tab, gathering every raster-serving connector in one place with verified built-in servers for each.',
      'Esri Image Services connector (USGS 3DEP elevation, USDA NAIP aerial imagery) — the ImageServer workflow, now a first-class connector.',
      'OGC WCS connector: real raster data values (EMODnet bathymetry, DLR SRTM elevation) via scaled GetCoverage requests that auto-split around server read limits.',
      'OGC WMS connector: rendered map imagery (NASA GIBS satellite layers with time selection, terrestris OSM/SRTM) chunked and mosaicked into georeferenced rasters.',
      'ERDDAP Grids connector: gridded scientific data (NOAA sea-surface temperature and friends) — one variable, one time slice, real values.',
      'Raster imports can now land directly on the map: an "Add to map when done" option registers, styles, and zooms to the layer automatically.',
    ],
  },
  {
    version: '1.7',
    date: 'July 2026',
    title: 'The Raster Release',
    summary:
      'Rasters become a first-class data type — rendered, styled, analyzed, imported, and stored like everything else.',
    highlights: [
      'Rasters on the map: SpatRasters render as crisp, server-tiled layers in the Spatial Editor, with a band viewer and full symbology (RGB/pseudocolor/categorical, stretch controls, color ramps, histograms).',
      'A complete raster toolbox — 30+ tools covering processing (reproject, clip, resample, focal, terrain, hillshade, raster calculator), band math (NDVI and friends), and raster↔vector work like zonal statistics and extract-to-points.',
      'GeoTIFF and Cloud-Optimized GeoTIFF import: local files, COGs streamed by URL, and STAC raster assets from satellite catalogs.',
      'Tiled raster storage in .Rgeo databases (format v3): rasters save as compressed block pyramids and connect back instantly as lazy, file-backed objects.',
      'Map export parity — ggplot2 and tmap exports reproduce on-map raster symbology exactly (band, stretch, ramp).',
    ],
  },
  {
    version: '1.6',
    date: 'July 2026',
    title: 'Projects & Polish',
    summary:
      'A real project workflow plus a top-to-bottom refresh of the Settings and theming experience.',
    highlights: [
      'Project workflow: save and load portable .ourgeoproj bundles that snapshot the R environment and full UI state, with a scratch workspace that always launches clean.',
      'Redesigned Settings: collapsible, icon-led sections and an in-app version history.',
      'Scenic theme picker — each theme is shown as its own themed illustration, with subtle grey-scaled artwork painted behind the code editor.',
      'Retired the standalone Map Preview panel; all map-making now lives in the Spatial Editor.',
      'Package name autocompletion inside library()/require(), with the Packages pane auto-refreshing on install.',
      'Stability: fixed a black-screen restore after sleep and tightened memory cleanup on exit.',
    ],
  },
  {
    version: '1.5',
    date: 'July 2026',
    title: 'Scale & Depth',
    summary:
      'The largest release — a ground-up architecture overhaul plus databases and much richer map export.',
    highlights: [
      'Database support: connect to .Rgeo (DuckDB) databases, manage datasets, and edit database-backed spatial objects directly.',
      'First-class curved geometry via sfarc, plus auto-detected calculation CRS and configurable default CRS for new geometry.',
      'Expanded Data Connector with a Web APIs framework (Esri, OGC, WFS, STAC, SDMX, OData, CKAN, Socrata, ERDDAP, and more).',
      'Map export to both tmap and ggplot2 with legends, north arrows, scale bars, and graticules.',
      'Local model harness support (llama.cpp and others) for the AI assistant.',
      'Under the hood: modular R server, AI calls proxied through the main process, and a Vitest test suite — plus many data-editor and console improvements.',
    ],
  },
  {
    version: '1.4',
    date: 'April 2026',
    title: 'Data & Intelligence',
    summary:
      'Connected ouRGeo to the outside world and added guided, code-free workflows.',
    highlights: [
      'Data Connector for importing from popular open-data portals.',
      'Kaggle integration for pulling datasets straight into R.',
      'AI Assistant panel for in-app coding help.',
      'Toolbox: a GUI over a large set of classic R spatial and tabular operations, with the ability to pipe tools together.',
      'Plotting preview pane, a ggplot GUI editor, and an in-app Help panel.',
    ],
  },
  {
    version: '1.3',
    date: 'March 2026',
    title: 'Maps & Polish',
    summary:
      'Turned the workspace into a polished spatial app with real map editing.',
    highlights: [
      'Settings with switchable themes applied across the editor, data viewer, and map.',
      'Create-dataset dialog for vectors, matrices, data.frames, tibbles, and data.tables.',
      'Geometry drawing with snapping, a symbology editor, and multiple concurrent spatial editor sessions with user-defined extents.',
      'Map zoom and fit-to-extent controls, plus selection syncing between the data viewer and the map.',
      'Switchable R installation path, console recording, and zoomable UI text and icons.',
    ],
  },
  {
    version: '1.2',
    date: 'March 2026',
    title: 'The Workspace',
    summary:
      'Grew from an editor into a full R workspace with packages, environment, and data.',
    highlights: [
      'Package Manager to install and load packages, with actions echoed to the console.',
      'Environment pane to browse R objects, expandable by data type.',
      'First Spatial Editor pane for adding sf objects to a map.',
      'Inline data editing with smooth spreadsheet-style editing and column creation.',
    ],
  },
  {
    version: '1.1',
    date: 'March 2026',
    title: 'Foundation',
    summary:
      'A clean restart — the distilled core that everything else is built on.',
    highlights: [
      'A Monaco code editor wired to a live, embedded R console.',
      'File management: open, edit, create, and save .R files.',
      'Editor tabs that persist across sessions.',
    ],
  },
]

/** Current app version — the newest entry in the history. */
export const APP_VERSION = VERSION_HISTORY[0].version
