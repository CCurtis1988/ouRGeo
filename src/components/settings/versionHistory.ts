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
    version: '1.11',
    date: 'September 2026',
    title: 'Make It Do More',
    summary:
      'Plugins, and a workspace that goes where you put it — ouRGeo can now gain capabilities it did not ship with, without being rebuilt.',
    highlights: [
      'Plugins (Settings \u2192 Plugins): data connectors, geoprocessing tools, actions, toolbar buttons, panels and documentation, added while the app is running. Most are pure JSON and run no code at all.',
      'Ask the AI assistant for one in prose \u2014 "add a connector for this API" \u2014 and it probes the API, writes the spec, tests it against the real server, and asks you to turn it on.',
      'A plugin that ships code is compiled on the spot, runs with ouRGeo\u2019s own privileges, and arrives switched OFF. Enabling one is a decision you make, the way you decide to run install.packages().',
      'Plugins export and import as portable .ourgeoplugin files. One that fails to load is reported and skipped, never fatal \u2014 and one that takes the app down disables itself on the next launch rather than leaving you locked out.',
      'A workspace you arrange: four zones \u2014 left, centre, right and bottom \u2014 and any panel can go in any of them, split or tabbed, at whatever size you like. Drag a panel by the grip in its corner.',
      'Panels sharing a zone share it evenly \u2014 two take half each, three a third each \u2014 until you drag a divider between them. Double-click a divider to even them out again, and every zone starts each session evenly shared.',
      'Your arrangement is remembered between sessions, and you can save several as named presets and switch between them.',
      'Toolbar buttons can be reordered and hidden, and the assistant can rearrange all of it on request \u2014 with layout:reset always the way back.',
      'Fixed: opening a project restored its R objects but showed an empty Environment panel \u2014 everything the bundle loaded was being treated as though it were ouRGeo\u2019s own rather than yours.',
      'Fixed: the helper functions ouRGeo defines for generated code no longer end up in your project bundles, in your Environment panel, or deleted the moment you open a project.',
      'Fixed: when the assistant moved the map for you \u2014 zooming from landmark to landmark on a tour \u2014 the view never changed. Every map:setView now moves the map you are looking at, and the export extent follows it.',
      'Console recording gained a destination: the assistant can now record into a new document, or into a saved file that offers to write itself back when you stop.',
      'The Environment panel: right-clicking an environment offers Export, Make Copy, Rename and Delete, and Save is now called Export \u2014 it writes an .RData file to your computer.',
      'Environments you can work IN: right-click one and choose \u201cWork in this environment\u201d, and everything you run \u2014 console, toolbox, assistant \u2014 evaluates inside it. R looks names up outwards and never into an environment, so this is what lets you type x * a instead of env2$x; .GlobalEnv stays visible through it, and the prompt shows where you are. Switching echoes the R for it \u2014 evalq({ ... }, env2) \u2014 so the same move works in a script.',
      'Creating an environment now says how to reach what you put in it, in the console, at the moment you make it.',
      'Objects gained Copy To beside Move To \u2014 same name, another environment, the original left where it is.',
      'An environment is listed beside .GlobalEnv by default; Show in its right-click menu lists it inside .GlobalEnv instead, where R actually keeps it.',
      'Move To now offers the environments you can actually see: .GlobalEnv and your own while the eye is hiding what is not yours, every environment in the session when it is not.',
      'Fixed: \u201cMake Copy\u201d on an environment made a second name for the same environment rather than a copy \u2014 editing either one changed both.',
      'Fixed: R\u2019s refusals reach you. Naming an environment after a data frame, moving an object into a package environment, copying onto a name already taken \u2014 each one used to do nothing and say nothing.',
      'Fixed: exporting an environment no longer writes ouRGeo\u2019s own internal functions into your .RData file, and the console shows the exact save() that was run.',
      'Settings \u2192 Workspace: save the panel arrangement by name and switch between arrangements, export and import them as .ourgeolayout.json files, turn the drag grips off if you would rather they weren\u2019t there, and restore the shipped default in one click.',
      'Fixed: the grip in a panel\u2019s corner did nothing when you dragged it \u2014 dropping a panel into another zone now works, and an empty zone offers itself as a target so a panel can always be moved back.',
      'Move a dataset between panels from wherever you are: Add to Map in the data viewer\u2019s header sends a table to the spatial editor, and right-clicking a layer in Contents opens its attribute table.',
      'Sending an object that is already on the map now asks first \u2014 and offers to show you the layer you already have instead of adding a second copy of it.',
    ],
  },
  {
    version: '1.10',
    date: 'August 2026',
    title: 'Make It Yours',
    summary:
      'The Theme Studio — build your own themes on all three axes, with your own artwork, and share them as files.',
    highlights: [
      'Theme Studio (Settings → Appearance): create app themes, code themes and markdown themes of your own, always by copying one that already works.',
      'Every colour is editable and labelled with what it actually paints — ten interface colours and six editor-surface colours for an app theme — with live contrast warnings and a preview that updates as you type without touching the running app.',
      'Bring your own artwork: a backdrop image behind the code editor with its own opacity and grey-scale, and a card image for the theme picker. Both are embedded in the theme, so it travels with its pictures.',
      'An app theme also chooses the code and markdown palettes it starts with, and the basemap the Spatial Editor opens with under it.',
      'Themes export and import as portable .ourgeotheme.json files — and a file meant for one axis can never land in another\u2019s list.',
      'The AI assistant can build a theme to your description, check its own contrast, and switch you to it.',
      'Fixed a settings-file race that could corrupt theme.json and quietly reset the app to the Dark theme on the next launch.',
    ],
  },
  {
    version: '1.9',
    date: 'August 2026',
    title: 'Markdown & R Markdown',
    summary:
      '.md, .Rmd and .qmd become first-class documents — written, run, knitted and published without leaving ouRGeo.',
    highlights: [
      'Markdown and R Markdown documents in the code editor, with a formatting ribbon, a slash-command menu, and full R autocomplete inside chunks.',
      'Runnable chunks with inline output: run a chunk and its plots and printed results appear beneath it, right in the document.',
      'A Visual mode that edits the rendered document directly and round-trips back to source without reformatting what you wrote.',
      '“Chunk: current map” generates real tmap or ggplot2 code from the layers, symbology and view currently on the map — the same code the Export dialogs produce.',
      'Knit to HTML, PDF or Word in a clean R session, with each format pre-disabled and explained when its dependencies (pandoc, LaTeX) are missing.',
      'Publish an R Markdown document straight to the community forum as a new discussion, figures and all.',
      'Separate code-editor and markdown editor themes: 26 syntax palettes and 16 prose palettes, chosen independently of the app theme.',
    ],
  },
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
