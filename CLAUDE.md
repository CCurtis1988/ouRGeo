# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ouRGeo** is a desktop spatial IDE — an open-source alternative to ArcGIS Pro — built with Electron. It wraps R's spatial ecosystem (sf, terra, ggplot2, tmap) in a dark-mode GUI while keeping R at the core. Every GUI-driven operation echoes its R code to the console.

## Development

```bash
npm install
npm run dev        # Start Electron + Vite dev server
npm run build      # Production build
npm run package    # Build + package with electron-builder
```

TypeScript is the primary correctness check — run `npm run typecheck` from the repo root (it builds both the `tsconfig.node.json` and `tsconfig.web.json` projects). Run `npm run lint` for ESLint (flat config in `eslint.config.mjs`). A Vitest suite (`npm run test`, jsdom for component tests) covers codegen and a few components.

## R Dependencies

Must be installed in R before running:
```r
install.packages(c("httpuv", "jsonlite", "later", "httr2"))
# Spatial features also need: sf, terra, ggplot2, tmap, ggspatial, maptiles, tidyterra
# Raster map rendering also needs: png (tile encoding); ggplot raster export with
#   mixed fill scales additionally uses ggnewscale (emitted only when needed)
# Curved geometry (CIRCULARSTRING/COMPOUNDCURVE/CURVEPOLYGON) also needs: sfarc
# Knitting .Rmd also needs: knitr, rmarkdown (+ pandoc, which is NOT an R package
#   and R does not bundle — RStudio ships its own copy; PDF additionally needs a
#   LaTeX install, e.g. tinytex). Running chunks inline needs NOTHING extra —
#   it uses base eval + grDevices.
# Database (.Rgeo) features also need: DBI, duckdb, dplyr
```

The Data Connector's **Web APIs** tab generates import code with `httr2`/`jsonlite`
(tabular) and `sf::st_read` (geospatial — Esri/OGC/WFS/STAC), all covered above. No
extra packages are required; the idiomatic clients `RSocrata`, `esri2sf`, `rstac`,
`rerddap`, `rsdmx` are optional alternatives, not used by the generated code.

## Architecture

### Three-process model

```
Electron Main Process  (electron/main/)
  ├── r-bridge.ts     — Spawns Rscript, captures port from stdout, auto-restarts on crash
  ├── ipc.ts          — All IPC handlers: file dialogs, R management, plot popout
  ├── ai-proxy.ts     — Proxies AI-provider HTTP calls (ai:fetch/ai:chunk/ai:abort) so the
  │                     renderer keeps webSecurity enabled
  ├── plot-window.ts  — Creates/updates a secondary BrowserWindow for plot popout
  └── index.ts        — BrowserWindow (1000×700); on resume/GPU-loss forces a
                         state-preserving repaint (invalidate + resize nudge) so
                         sleep doesn't leave a black screen; reloads only if the
                         renderer process itself dies. Emits `system:resume`.

Electron Renderer Process  (src/)
  ├── Connects to R over HTTP (rClient) and WebSocket (wsClient)
  ├── App.tsx detects window.location.hash === '#plot-popout' to render PlotPopoutView
  └── Full React UI (see Layout section below)

R Process  (r/server.R + r/lib/*.R)
  ├── server.R is a slim bootstrap: loads packages, sets up .ourgeo_env global
  │   state + the headless PNG device/viewer hooks, source()s every r/lib module,
  │   then binds the httpuv server on a random port (printed to stdout for r-bridge)
  ├── r/lib/router.R    — route() HTTP dispatch + ws_handler() WebSocket handler
  ├── r/lib/util-core.R, util-env.R — response/JSON helpers, env introspection
  ├── r/lib/util-raster.R, handlers-raster.R — raster tile engine: registers a
  │   SpatRaster as a map layer (gdalwarp to an EPSG:3857 COG under
  │   tempdir()/ourgeo-raster — the COG driver builds internal overviews, since
  │   sf::gdal_utils has no gdaladdo; plain-GTiff fallback for GDAL < 3.1),
  │   then serves styled 256px XYZ PNG tiles (per-tile gdalwarp window read →
  │   vectorized stretch/colormap → png::writePNG, bounded LRU of encoded
  │   tiles). Staleness sweep hooks broadcast_env_if_changed.
  ├── r/lib/handlers-*.R — endpoint handlers grouped by domain (exec, help, env,
  │   packages, object, spatial, data-widget)
  └── r/lib/db-*.R      — .Rgeo/DuckDB schema, connection, translators, /db handlers;
      db-raster.R = format-v3 raster tile pyramid (see Database section)
```

All `r/lib/*.R` modules are `source()`d into the global environment at startup, so
they share `.ourgeo_env` and reference each other by name at call time.

### R Server Endpoints

```
POST /session/init        — Load packages, check deps
POST /session/reset       — Clear user objects (keep system_names), DB conns, proxies
GET  /session/wd          — getwd() + path.expand("~"), for the console header
POST /session/setwd       — Move R's working directory (validates, broadcasts)
POST /r/execute           — Run arbitrary R code; captures PNG plots automatically
POST /r/plot/export       — Re-render last plot at a specific size/format
POST /r/plot-preview      — Render code to PNG for inline chart preview
GET  /health
GET  /env/list            — List objects in R environments
POST /env/{remove,rename,copy,move,create,save,load}
GET  /packages/list       — Installed packages
POST /packages/{load,unload,install,addlibpath}
GET  /packages/cran-list
POST /packages/check-version
POST /object/{function,dataframe,matrix,vector}  — Inspect R objects
POST /object/formals      — Formal argument names of a function (autocomplete)
GET  /spatial/list        — List sf/sfc/sfg + SpatRaster objects
POST /spatial/geojson     — Get GeoJSON for a spatial layer
POST /raster/info         — Band stats (sampled min/max/mean/sd/q02/q98), dims, CRS,
                            4326 extent — feeds the raster symbology editor
POST /raster/register     — Register a SpatRaster as a tiled map layer (warp+overviews);
                            re-register w/ same layerId = symbology-only restyle
                            (keeps warp, bumps version). Returns tileUrl/bounds/maxzoom.
POST /raster/unregister   — Drop a layer (evict tiles, delete warped temp file)
POST /raster/histogram    — Sampled histogram of one band (symbology editor)
GET  /raster/tile/{id}/{z}/{x}/{y}.png?v=N — Styled RGBA PNG tile (404 on stale version)
POST /data/preview        — Preview tabular data
POST /kaggle/files
POST /help/{search,doc,package,vignettes,vignette}
POST /selection/query
GET  /db/proxies          — Snapshot connected dataset proxies for a project save
POST /db/reconnect        — Reopen .Rgeo files + rebind proxies on project load
WS   /console             — Bidirectional; server broadcasts structured messages
```

### WebSocket Message Protocol

The R server broadcasts JSON via `/console`. The renderer's `wsClient` calls message handlers with `(type, text, data)`:

| `type`    | Meaning |
|-----------|---------|
| `stdout`  | Console text output |
| `stderr`  | Warnings / errors |
| `plot`    | PNG plot ready — `data` is a `data:image/png;base64,...` string |
| `widget`  | htmlwidget/help/vignette ready — `data.id` identifies the served file |
| `env`     | `.GlobalEnv` changed — `data` is the rebuilt `.GlobalEnv` entry (change-detected; keeps the Environment panel + autocomplete live) |
| `packages`| Installed/attached packages changed — `data.libraries` is the rebuilt library list (change-detected; keeps the Packages panel + `library()`/`require()` autocomplete live) |
| `wd`      | Working directory moved — `data.path`. Fires for a picker change AND for a `setwd()` buried in user code, so the console header can never go stale |
| `raster_layer_invalidated` | A registered raster map layer's backing R object changed or vanished — `data.layerId`; the renderer re-registers (fresh warp) or drops the layer |

In `App.tsx`, `type === 'plot'` triggers `usePlottingStore.getState().addPlot(data)` and forwards to the plot popout window via IPC.

## Layout & Panels

The UI is a single-page app with a toolbar + resizable panel system managed by `EditorLayout.tsx`. Panels are toggled by toolbar icon buttons and sized with drag dividers:

| Panel | Store | Component |
|-------|-------|-----------|
| Left: Code Editor + Console | `session`, `editor` | `CodeEditor`, `Console` |
| Left tab: Packages | `packages` | `PackagePanel` |
| Left tab: Environment | `environment` | `EnvironmentPanel` |
| Right: Spatial Editor (MapLibre) | `spatial` | `SpatialEditor` |
| Right: Plot Preview | `plotting` | `PlottingPanel` |
| Right: AI Chat | `ai` | `AiChatPanel` |
| Right: Help | `help` | `HelpPanel` |

### Console I/O Design

- Code execution: `POST /r/execute` (HTTP) — one response per request
- `POST /r/execute` also broadcasts captured plot PNGs via WebSocket after execution
- Frontend adds `input` entries locally (immediate feedback); R server does NOT echo `> code`
- `Ctrl+Enter` runs a single line from Monaco and advances cursor
- `Shift+Enter` runs selected lines

### Working directory (`src/lib/working-dir.ts`, `console/WorkingDirBar.tsx`)

The directory is shown in the console header, beside "R Console" and the
connection dot — next to where relative paths are typed, because that is what it
governs. The path IS the control: clicking it opens the one menu that changes it
(native folder picker), copies it, opens it, re-reads it, or jumps to a recent
one (`working-dirs.json`, persisted, max 8).

- **R owns the value.** The store is set from the server's own `getwd()`, never
  from what the picker was told to do, and `broadcast_wd_if_changed()` runs
  beside the env/package sweeps after every execution — so a `setwd()` typed
  into the console moves the label exactly as the dialog does.
- `POST /session/setwd` rather than `execute('setwd(…)')`, so a bad path is a
  result the menu can show instead of stderr the user has to go and read. The
  console still gets the `setwd()` line — every GUI operation echoes its R.
- **R starts in the user's home directory** (`r-bridge.ts`), not in `r/`. The
  cwd is what every relative path in the session means, and pointing it at
  ouRGeo's own program directory aimed `ggsave()` at the install — inside
  `resources/` in a packaged build. `server.R` is therefore spawned by ABSOLUTE
  path: it resolves its module directory from `--file=`, which R reports
  verbatim, so a bare `server.R` would normalize against the new cwd.
- `elidePath` drops whole segments from the middle (`/home/…/Projects/ourgeo`),
  never mid-word — a path cut at `/home/roos…` reads as a different directory.
  Measured on a canvas in the element's own font, because `text-overflow`
  removes the END, which is the part that names the directory. The measured box
  needs `flex-1`: content-sized, it measures the elided string rather than the
  space available, and the label shrinks once and never grows back.

## Key Stores (`src/store/`)

| File | Purpose |
|------|---------|
| `session.ts` | R status, console history, input history, recording state |
| `spatial.ts` | MapLibre layers, viewState, legend, north arrow, bbox |
| `plotting.ts` | Plot PNG history (`plots[]`), `currentIndex`, open/close |
| `editor.ts` | Monaco editor tabs and content |
| `environment.ts` | R environment browser state |
| `packages.ts` | Package manager state |
| `basemap.ts` | Active basemap override |
| `theme.ts` | Dark/light theme + UI scale |
| `ai.ts` | AI chat panel state |
| `help.ts` | Help panel state |

### State persistence (`src/lib/*-persistence.ts`)

Debounced autosave survives sleep and a renderer reload/crash. Two lifetimes:

- **Kept between sessions** — `session-persistence` → `session.json` = **code tabs
  only** (open `.R` files + untitled scratch; file-backed tabs re-read from disk
  on load). This is the one thing deliberately left across restarts.
- **Session-scoped (wiped on clean exit)** — `workspace-persistence` writes
  spatial layers (`spatial-layers.json`), map view/legend settings
  (`spatial-ui.json`), console history (`console.json`), and object-backed
  data-viewer/function-editor tabs (`object-tabs.json`); `plots-persistence`
  writes `plots.json`. The `will-quit`
  handler (`electron/main/index.ts`) deletes all of these on exit, so the next
  launch is clean. A **crash** (no `will-quit`) leaves them for recovery.

Files are split so a pan or console line never rewrites the large layer geojson.
On load, object tabs are appended after code tabs, then `pruneStaleObjectTabs`
drops any whose R object is gone. Workspace savers intentionally have **no
`beforeunload` flush** — that would race the on-exit deletion; the debounced
saves during the session suffice for reload recovery. All wired in `App.tsx`.

### Project workflow (`src/lib/project-persistence.ts`, `src/store/project.ts`)

The toolbar's project dropdown (`src/components/project/ProjectDropdown.tsx`,
right of the header — it also carries the small R-status dot that replaced the
old "R Connected" label) saves/loads a portable **`.ourgeoproj`** bundle: a zip
(packed/unpacked in the main process via `project:pack`/`project:unpack` +
`adm-zip`) holding `project.json` (manifest: version, name, `ui` = the same
session/workspace/plots slices the autosavers serialize, reused via
`buildSessionData`/`applySessionData` and `buildWorkspaceData`/`applyWorkspaceData`;
plus `databases`) and `environment.RData` (from `/env/save` with
`excludeSystem:true` so only user objects are snapshotted, not the server's
source()d functions).

- **scratch project** (`path === null`, `SCRATCH_PROJECT_NAME`, `useProjectStore`):
  the workspace ouRGeo always launches into — a clean R env every time, never
  savable in place (Save disabled; closing/switching never prompts — `confirmUnsaved`
  short-circuits to `discard` when `path === null`). `saveSession` is **gated to
  scratch only**, so `session.json` always holds scratch's code/.R tabs even while
  a named project is active — that's what makes scratch's tabs survive a project
  switch and reappear on relaunch. Save As spins off a real project; named-project
  code tabs live in the bundle.
- **Load** → `/session/reset` (clears user objects — keeping `system_names` —
  plus DB conns + proxies), hydrate UI stores, `/env/load`, then `/db/reconnect`
  (reopens each `.Rgeo` and rebinds its `dplyr::tbl` proxies, since the restored
  tbl objects hold stale connections). **New** → reset + restore scratch tabs.
- **Dirty tracking**: env/spatial/plots/object-tab changes mark a *named*
  project dirty (`enableDirtyTracking` after startup; suppressed during load/new).
  On window close the main process fires `app:before-quit`; the renderer shows
  `UnsavedChangesDialog` (Save / Don't Save / Cancel) for named projects and calls
  `app:confirm-quit` — code/.R tabs are always flushed regardless of choice.
- Recent projects (max 5) persist in `recent-projects.json` (never deleted).

## Raster Layers (v1.7)

Rasters are first-class end-to-end. `SpatialLayer` is discriminated by
`kind: 'vector' | 'raster'` (default vector); raster layers carry an **empty
FeatureCollection** as `geojson` (so `layer.geojson.features` consumers — lasso,
legend column readers — no-op naturally) plus `raster: RasterLayerInfo`
(`layerId`, `version`, 4326 `bounds`, `meta` band stats, `symbology`).

- **Rendering**: R-served XYZ tiles. `src/lib/raster-layers.ts` registers the
  object (`/raster/register`) and builds the MapLibre tile URL from
  `rClient.baseUrl`; `MapView.tsx` renders `<Source type="raster">` keyed on
  `id+version` so a symbology change (re-register → version bump) re-requests
  every tile. Layer `layerId`s are **session-scoped** — `rehydrateRasterLayers()`
  re-registers persisted/restored layers after reload, R restart
  (`reconnect-r.ts`), and project load; orphans are dropped.
- **Resilience**: registration is a long blocking request, and OS sleep /
  network changes make Chromium abort in-flight requests (even to localhost,
  `ERR_NETWORK_CHANGED`) while R finishes the warp anyway. The client
  therefore generates the `layerId` up front and retries connection-severed
  register/info calls — a retry against a completed warp hits the server's
  restyle fast path (no re-warp). Long requests (`execute`, register) also
  hold an Electron `powerSaveBlocker` via `power:block`/`power:unblock` IPC
  (`src/lib/power-block.ts`, refcounted) so idle-suspend can't fire mid-request.
- **Symbology** (`RasterSymbologyDialog.tsx`, opened from the ribbon symbology
  button when the layer is raster): singleband/RGB/categorical, stretch
  (min-max / percent clip / stddev / custom), ramps from `SEQUENTIAL_SCALES`
  (+ raster-only `gray`/`terrain` in `RASTER_RAMPS`), per-band stats +
  histogram (`/raster/histogram`), live apply (debounced re-register).
- **Toolbox**: "Spatial — Raster" category (`src/components/toolbox/tools-raster.ts`),
  30+ terra tools. Raster dataset fields use `filter: 'raster'` and ids ≠ `ds`
  (so the dplyr pipeline never engages); `band` field type fetches band lists
  from `/raster/info`; tools with `output: 'raster'` skip the data-viewer tab.
- **Import**: LoadDataDialog raster formats (`terra::rast`), Data Connector
  Manual tab "GeoTIFF / COG (URL)" (`terra::rast("/vsicurl/…")`), STAC
  raster assets (`ourgeo_read_stac_rasters()` in `r/lib/util-stac.R`; provider
  surfaces `rasterAssets` in `ResourceMetadata`, browser offers footprints-vs-
  assets import), and **ArcGIS ImageServer** services (e.g. USGS 3DEP
  elevation, a built-in Esri server): the Esri provider lists ImageServers,
  and `ourgeo_read_esri_image()` (`r/lib/util-arcgis.R`) exports the map-view
  bbox via `/exportImage` — chunked to a 2048px-per-request soft cap (servers
  504 on their own advertised maxima) with one retry per chunk, mosaicked with
  terra. `ResourceMetadata.rasterResult` marks raster-producing imports so the
  browser skips the tabular viewer tab.
- **.Rgeo storage (format v3, `r/lib/db-raster.R`)**: rasters save as a
  GeoPackage-style tile pyramid — `_rgeo_raster_meta` (WKT2 CRS, dims, dtype,
  nodata, band stats/names/categories JSON) + `_rgeo_raster_tiles`
  (name/level/brow/bcol, gzip'd dtype-faithful blocks, BSQ, 256px, ×2 overview
  levels). Save streams in ≤256-row strips (never whole-raster in RAM);
  **connect** (now allowed for rasters) streams level-0 blocks into a temp
  GeoTIFF via `writeStart/writeValues/writeStop` → a real GDAL-lazy SpatRaster,
  registered in `rgeo_proxies` so `/db/reconnect` restores it. Legacy v2 BLOBs
  in `_rgeo_rasters` stay readable and upgrade to a pyramid lazily on first
  access (`.rgeo_ensure_raster_pyramid`). The raster translator supports
  `preview`/`bbox`/`collect`/`meta`; editing ops error.
- **Export**: both codegens emit raster layers with on-map symbology — ggplot
  `geom_spatraster` + `scale_fill_gradientn(limits=…)` (with
  `ggnewscale::new_scale_fill()` when fill scales must coexist),
  `geom_spatraster_rgb(terra::stretch(…))` for RGB; tmap `tm_raster` +
  `tm_scale_continuous/categorical`, `tm_rgb`. Shared helpers in
  `codegen-shared.ts` (`rasterLimits`, `rasterRampVector`, `rasterRgbExpr`).

## Key Code Generation (`src/lib/`)

| File | What it generates |
|------|------------------|
| `ggplot-codegen.ts` | Full ggplot2 R code from `SpatialLayer[]` + `MapAnnotations` (vector geoms + tidyterra raster geoms) |
| `tmap-codegen.ts` | Full tmap R code from the same inputs |
| `map-annotations.ts` | `MapAnnotations` type + `DEFAULT_MAP_ANNOTATIONS`; types shared by both codegen files |
| `basemap-providers.ts` | Basemap provider registry (maptiles IDs, labels) |
| `layer-symbology.ts` | Resolves effective symbology for a layer |
| `raster-layers.ts` | Raster layer registration/rehydration, ramp registry, symbology→wire payload, tile URLs |

`MapAnnotations` carries all export-specific overrides (title/subtitle/caption, legend, north arrow, scale bar, graticules, panel border). Both `ggplot-codegen.ts` and `tmap-codegen.ts` accept it as an optional parameter; when present it overrides the spatial store values.

## Data Connector — Web APIs (`src/lib/api-connectors/`)

The Data Connector dialog (`src/components/connector/DataConnectorDialog.tsx`) has three
modes: **Browse Sources** (static/dynamic source list in `sources.ts`), **Web APIs**, and
**Manual**. The **Web APIs** tab (`WebApisTab.tsx`) is a provider framework: each API family
implements the `ApiProvider` interface (`api-connectors/types.ts`) — a variable-depth cascade
(`listLevel`), `getMetadata` (fields + `spatial`/`queryable` + `caps`), `opsFor`,
`distinctValues`, `preview`, and `buildCode`. One generic component
(`ApiConnectorBrowser.tsx`) drives any provider: server picker → cascade → `QueryBuilder.tsx`
(shared `query-model.ts` Field/Filter/Query) → preview → generated R → Load
(`rClient.execute` + `addObjectTab`, `sf` vs `data.frame` from `metadata.spatial`).

Providers (registered in `registry.ts`, grouped by category): **CKAN, Socrata** (Open Data);
**Esri ArcGIS REST, OGC API–Features, WFS, Macrostrat** (Geospatial → `sf`); **Esri Image Services, OGC
WCS, OGC WMS, STAC, ERDDAP Grids** (Raster / Image Layers → SpatRaster; see below); **ERDDAP**
(Scientific); **SDMX, OData** (Statistics). Each serializes the shared query to its own dialect
(SoQL, ArcGIS/CQL `where`, OData `$filter`, OGC/STAC params, ERDDAP constraints, SDMX keys).
Servers are user-extensible and persisted per provider (`apiServers.ts`). All metadata/preview
fetches go through `proxyFetch` (`ai-proxy-fetch.ts`); only metadata/preview run in JS, the
final import is generated R echoed to the console.

### Raster / Image Layers connectors

The raster connectors all follow the ImageServer template: the leaf's `getMetadata` returns
`queryable:false + rasterResult + imageExport + downloadCode`, which renders the shared
extent/resolution export panel (current-map-view vs full extent, long-side pixel size,
download-size estimate; a **Time** input appears when `imageExport.time` is set) instead of the
query builder. Raster imports skip the tabular viewer and offer an **"Add to map when done"**
checkbox (default on) that registers the SpatRaster with the tile engine and zooms to it
(`createRasterLayerInfo` + `rasterLayerDraft` + `requestFitBounds`, same path as the Add Layer
dialog; a failure — e.g. a multi-item STAC list — degrades to a console note). WCS/WMS
capabilities are parsed renderer-side with DOMParser (`api-connectors/xml.ts`); the R helpers
regex-extract only what they need, keeping xml2 out of the R deps.

- **Esri Image Services** (`esri-image.ts`, split out of the generic Esri provider, which now
  lists only Feature/Map servers): ImageServer → `ourgeo_read_esri_image()` (chunked
  `/exportImage` + mosaic, `r/lib/util-arcgis.R`). Built-ins: USGS 3DEP, USDA NAIP.
- **OGC WCS** (`wcs.ts` + `r/lib/util-wcs.R`): real data values via GetCoverage 2.0.1 —
  DescribeCoverage gives native CRS/axis labels, bbox is reprojected with sf, `SCALESIZE`
  tries grid axes (`i,j` — GeoServer/MapServer) then CRS labels (rasdaman) then unscaled;
  server read-limit exceptions ("too much data") trigger adaptive bbox bisection + mosaic.
  Built-ins: EMODnet Bathymetry, DLR SRTM.
- **OGC WMS** (`wms.ts` + `r/lib/util-wms.R`): *rendered* RGB imagery via WMS 1.1.1 GetMap
  (1.1.1 keeps lon/lat order — avoids the 1.3.0 EPSG:4326 axis flip), chunked at 2048px and
  mosaicked; PNG chunks are georeferenced locally from the requested bbox and the result always
  lands in a GeoTIFF (tile engine reads the backing file). `TIME=` supported (NASA GIBS).
  Built-ins: NASA GIBS, terrestris OSM/SRTM.
- **ERDDAP Grids** (`erddap-grid.ts` + `r/lib/util-erddap.R`): griddap datasets
  (`dataStructure="grid"`), cascade dataset → variable. Import uses **`.esriAscii`** (real
  float values) — NOT `.geotif`, which is an 8-bit grayscale picture, and not `.nc`, which
  needs GDAL's netCDF driver (broken on some systems) — converted locally to GeoTIFF. Stride
  subsampling keeps the long side near the chosen size; descending latitude axes are handled
  via the averageSpacing sign. Built-ins: NOAA CoastWatch, NOAA NCEI.
- **STAC** moved here from Geospatial (imagery is its primary role); footprints-as-sf mode
  remains, with a UI note explaining the coverage/QA use case.

The Esri import calls the server-side helper `ourgeo_read_arcgis()` (`r/lib/util-arcgis.R`)
rather than `sf::st_read`-ing the query URL directly (which returns **empty geometry**). It
paginates EsriJSON (`f=json`) with `returnTrueCurves=true`, reads attributes via GDAL's
ESRIJSON driver, and — because GDAL drops Esri curves — rebuilds curved geometry as OGC WKT
(`CIRCULARSTRING`/`COMPOUNDCURVE`/`CURVEPOLYGON`) so arcs import exactly for `sfarc` instead of
being linearized; straight layers pass through GDAL unchanged and keep their native CRS. When a
page query errors (some layers advertise a `maxRecordCount` they can't satisfy for detailed
geometry), the helper halves the request size and retries the same offset (down to a floor),
so such layers still import.

For large imports the browser first calls the optional `probeCapacity` provider hook
(`ApiProvider`); when it returns `prompt`, `ApiConnectorBrowser` shows a `CapacityDialog` that
lets the user pick how much to import, then runs `buildCode` with the chosen amount via
`query.limit` (+ `pageSize` in `BuildCodeOptions`). The probe sets `prompt` per provider:
**Esri** only when the server is `reduced` (can't deliver the requested page); **STAC** and
**OData** also when the result far exceeds one page (STAC `numberMatched`, OData `$count`); **SDMX**
when the dataflow spans many series. The dialog is
provider-adaptable: `reduced` picks the wording ("server can't return large pages" vs "large
result set"), and a probe may supply its own `description`, `unit`, and `choices` — SDMX uses
these to offer *observations-per-series* (1 / 4 / 12 / all) instead of a row count. Small
single-resource imports skip the probe (gated on `min(query.limit, meta.total) > IMPORT_PAGE_SIZE`).

The Macrostrat provider (`macrostrat.ts`) wraps macrostrat.org's custom REST API (geology:
stratigraphic columns, PBDB fossil collections, geologic map units, paleogeography — CC-BY 4.0).
Routes and their filter params are curated in code (the API's docs are prose); filters serialize
to plain `key=value` params (comma lists for isAnyOf; `age` between → `age_top`/`age_bottom`),
value dropdowns come from the `/defs/*` dictionaries, and responses unwrap the API's
`success.data` envelope. Import is `sf::st_read` on a `format=geojson_bare` URL (bare
FeatureCollection — no R helper needed). Macrostrat's servers reject bad param combinations
with a bare HTTP 500, so the provider implements the optional `ApiProvider.validateQuery`
hook (sel+query → message|null): the browser shows the message as a warning banner and
disables Load — used for unfiltered whole-database routes (fossils, map units, paleogeography)
and map units' point-or-id rule (lat+lng together, or strat_name_id/unit_id/map_id; `scale`
alone is rejected; `between` on lat/lng is called out since ranges aren't supported). The
fossils route's `lith_class` param is omitted (server 500s on it, verified 2026-07).
`QueryBuilder` additionally offers a one-click lat/lng fill when a resource has both fields:
map-view center or any spatial layer's center (`src/lib/layer-center.ts`).

The SDMX import calls `ourgeo_read_sdmx()` (`r/lib/util-sdmx.R`): `read.csv()` on the data URL
opens R's base `url()` connection, which fails with "SSL connect error" on some systems and is
bound by `options(timeout)` (60s) — so the helper fetches SDMX-CSV over httr2 (libcurl TLS + a
generous timeout) and applies `last_n_obs`/`first_n_obs` to cap observations per series. The
capacity probe uses the cheap `detail=serieskeysonly` endpoint to count series.

The OData import calls `ourgeo_read_odata()` (`r/lib/util-odata.R`): the old inline code ran
`req_perform()` with no timeout/retry, so transient slowness from a shared service tripped
httr2's short default timeout ("Connection timed out after 10002 ms"). The helper sets a generous
timeout + `req_retry`, paginates `$top`/`$skip` to `max_records`, and its probe reads the total
via `$count=true`.

The STAC import calls `ourgeo_read_stac()` (`r/lib/util-stac.R`): STAC's `limit` is a **per-page**
cap the server enforces (Earth Search 502s on `limit`>1000), not a total, so the helper caps the
page size, follows `rel:"next"` pagination tokens (POST search) up to `max_items`, halves the
page size and retries on a server error, and reads the assembled item footprints as `sf`.
`buildCode` emits the search body **without** `limit` (the helper owns it).

## Plot Popout Window

`window.location.hash === '#plot-popout'` causes `App.tsx` to render `PlotPopoutView` instead of `MainApp`. The Electron main process creates this secondary window via `plot-window.ts` and pushes new plot data URLs via `ipcRenderer.on('plot:update', ...)` → `window.electronAPI.plot.onUpdate(...)`.

## AI Assistant (`src/lib/ai-*.ts`, `src/components/ai/`)

`ai-client.ts` speaks four transports (Anthropic, OpenAI-compatible, Gemini, Ollama)
behind one `sendMessage(opts)`. Tools are **provider-neutral**: `SendOptions.tools`
is an `AiTool[]` that each transport re-encodes (`anthropicTools` /`openAiTools` /
`geminiTools`), and `onToolCall({ id, name, input })` dispatches by name. Every
transport reads its stream through `readLineStream`, which buffers across chunk
boundaries — a tool's arguments arrive as many small deltas and a JSON event
routinely straddles two reads. Anthropic streams *with* tools (reassembling
`input_json_delta` fragments), so enabling a tool never costs the streaming UX;
Ollama still falls back to non-streaming when tools are attached.

Two independent switches in the AI panel footer decide which tools are attached:

| Switch | Tool(s) | Default | Store |
|--------|---------|---------|-------|
| **Autopilot** | `execute_r_code` — runs R in the live session | off | `ai.autoPilotEnabled` |
| **Web** | `web_search`, `web_fetch` (`ai-web-tools.ts`) | **on** | `ai.webAccessEnabled` (persisted in `ai-preferences.json`) |
| *(none)* | `read_document`, `write_document`, `edit_document` (`ai-doc-tools.ts`) | always | — |
| *(per action)* | `list_ui_actions`, `run_ui_action`, `toolbox_tools`, `run_toolbox_tool`, `ourgeo_docs` (`ai-ui-tools.ts`) | attached always; each ACTION is tiered | `ai.actionTiers` (persisted) |

A disabled switch is *absent* from the request rather than declined afterwards, and
`runTool` in `AiChatPanel` re-reads the store at call time so flipping a switch off
mid-answer stops the next call. **Web** is the trust control: with it off the
assistant has no network tool at all, and its only remaining route to the internet
is R code the user watches execute in the console. Every web call is also logged to
the console as an `info` entry (`describeWebCall`), so the console stays a complete
record of what the assistant did.

- `web_search` scrapes DuckDuckGo's no-JS HTML endpoint (no API key); `web_fetch`
  reduces HTML to text with `DOMParser`, passes JSON/CSV/text through, refuses
  binaries, and blocks loopback/RFC1918/link-local hosts (those belong in the
  console, where the user can see the request).
- `ai-system-prompt.ts` holds the prompt in three pieces: `AI_BASE_PROMPT`,
  `buildProvenanceRules()` and `buildToolGuidance({ autoPilot, webAccess })`. The
  provenance rules are the reason the module exists — the assistant must derive
  every figure from a named R object through code the user can re-run: no recalled
  statistics, no hand-typed `data.frame()` behind a chart, every transformation
  shown, and an explicit "I can't" when the data isn't in the session.
  `buildToolGuidance` states the *current* switch positions so the model never
  claims a capability it wasn't given.

### The document skill (`ai-skill-documents.ts`, `ai-doc-context.ts`, `ai-doc-tools.ts`)

A local model once produced an excellent earthquake report in which every figure
chunk was a bare session variable (`p1`, `combined_plot`), no chunk loaded the
data, and every headline number was typed into the prose. All three are invisible
from inside the model: running a chunk inline evaluates in the LIVE session and
succeeds, and only the Knit button — a clean child `Rscript` — tells the truth.
Nothing in the prompt mentioned documents at all.

- `buildDocumentSkill({ hasDocumentTools })` is injected on **every** request,
  between the provenance rules and the tool guidance. Its centre is the
  self-containment rule (knit is a separate session, so every object must be built
  by a chunk in the same document), inline `` `r …` `` for figures in prose, the
  chunk options that silently produce wrong output (`results='asis'`, `print(p)`
  in a loop), and the ouRGeo-specific traps — inline runs honour only a few
  options, and `rmarkdown::render()` through `execute_r_code` renders in the live
  global env, so it *passes on exactly the documents Knit cannot render*.
- `buildDocumentContext(tabs, activeTabId)` adds an `## Open Documents` block
  beside the env and console blocks: name, language, dirty state, outline, chunk
  labels. `describeDocument()` is shared with the write tools and runs the cheap
  static checks — duplicate label, unterminated fence, missing front matter, and a
  runnable chunk whose whole body is one bare identifier.
- **The document tools carry no switch and are not gated on Autopilot**, because
  they write only into a visible editor tab — through `applyExternalContent`, the
  store's external-update channel, after dropping a Visual-mode tab to Source
  (Visual is seeded once and writes back on exit, so a write underneath it would
  be lost). No disk, no R session: saving stays the user's action, and the whole
  module is testable with no Electron. Every call is logged to the console via
  `describeDocCall`, the same audit-trail rule the web tools follow.
- They exist because the alternative was assembling a document out of
  `writeLines(c("…"))` through `execute_r_code` — a whole report's backticks and
  quotes escaped inside an R string literal, which is where a small local model
  comes apart, silently.

### Driving the GUI (`src/lib/ai-actions/`, `ai-ui-tools.ts`, `ai-skill-ourgeo.ts`)

The assistant can operate the application, so it can walk a user through a
workflow in their own session instead of only describing one. ~90 actions in 12
groups cover the panels, dialogs, editor, projects, data import, .Rgeo
databases, environment, packages, help, the whole Spatial Editor, drawing, plots
and settings — plus the 87 toolbox tools.

- **Action ids use a colon: `map:addLayer`, not `map.addLayer`.** Dots are legal
  in R names, so the dotted form is a syntactically perfect R call — and a local
  model, asked for a tutorial, duly wrote `map.addLayer(object = "pts_buf")` and
  told the user to run it. The colon cannot be mistaken for a function. The core
  prompt says outright that these are not R functions, the Autopilot refusal no
  longer reads as "hand them the code", and `action-code-guard.ts` catches the
  mistake from either side: the model gets a redirect to `run_ui_action` instead
  of running it, and a user who pastes one into the console gets an explanation
  instead of `could not find function`. Highlight targets keep their dots —
  they are string arguments, never confusable with a call.
- **A registry, not ninety tools.** `ai-actions/registry.ts` collects `UiAction`
  data objects (id, group, summary, typed params, default tier, `run`). Five AI
  tools cover the lot: search, run, toolbox search, toolbox run, docs. Ninety
  tool definitions would not fit a local model's context, so discovery is a tool
  call and the system prompt carries only the generated **id index**
  (~400 tokens, `actionIndex()`), which a test proves resolves.
- **Three tiers, user-editable.** `always` (screen only) / `autopilot` (touches R
  or disk — the same switch as `execute_r_code`) / `confirm` (destructive: also a
  modal). Defaults live on the action; the gear beside the Autopilot toggle opens
  `AiPermissionsDialog`, and overrides persist **sparse** in `ai-preferences.json`
  so shipped defaults stay live. The confirm modal blocks the tool call — closing
  it is a "no", because the safe answer must be the one you get by doing nothing.
- **Pointing, not only pressing.** `ui:highlight` rings a real control by
  `data-ourgeo-id` and waits, so a tutorial teaches where the button is.
  `HighlightOverlay` is `pointer-events-none` throughout — the ring must never
  intercept the click it is asking for — and `ai-actions/targets.ts` is a closed
  catalogue that a test checks against the attributes in the source.
- **Dialog state moved to `src/store/ui.ts`.** Every dialog used to be a
  `useState(false)` next to its button, which is right until something outside
  the component needs to open one. `hideDialog(id)` is a no-op unless `id` is the
  open dialog, so a closing dialog can never close its replacement.
- **Geometry the assistant makes is staged, not written.** `draw:addFeature` goes
  through the same pending-edit path as hand-drawn geometry: on the map, in the
  Save Edits badge, written by the same batched R statement. That is the only
  basis on which programmatic drawing is safe to offer.
- **Five extractions** put shared logic where both the GUI and the assistant can
  reach it, with the components still calling them: `add-spatial-layer.ts` (from
  AddFeaturesDialog), `load-data-code.ts` (from LoadDataDialog), `map-export.ts`
  (from markdown/chunk-codegen), `save-edits.ts` (from useSaveEdits), and dialog
  state (above). `map:exportCode` and the Export dialogs therefore generate
  identical R.
- **Knowledge is progressive.** `buildOurgeoCore()` is ~1200 tokens in every
  prompt — what ouRGeo is, the every-action-echoes-its-R rule, the layout, the
  action index, and how to run a tutorial. The full reference (11 topics, written
  from ourgeo.dev/docs pages plus what only this file knows) sits behind
  `ourgeo_docs({topic})`.
- **A severed connection is not a data problem** (`src/lib/transport-retry.ts`).
  Axios reports *every* failure with no HTTP response — a stale keep-alive
  socket, an OS suspend, a network change — as the bare string `Network Error`.
  Told exactly that by `map:addLayer`, a local model concluded the *geometry*
  was at fault and spent twenty turns simplifying, reprojecting and rebuilding
  a perfectly good buffer. The module holds the predicate (raw axios shape or
  an already-translated `TransportError`), the retry (a fresh socket usually
  succeeds; an error carrying a `response` is R's considered answer and is
  never retried), and the two sentences that replace `Network Error`: one for
  the user, one for the model that says *retry once, then stop, and do not
  touch the data*. Project load and raster registration already retried this
  way; the vector layer path did not, which is how it surfaced.
- **Never exposed:** the AI panel itself (an assistant that can close its own
  panel can end the conversation), API keys, and posting to the forum.

## Markdown & R Markdown (v1.9)

`.md` / `.Rmd` / `.qmd` are first-class documents in the code editor.

**Language is a FIELD on the tab, not a `TabType`** (`TabState.language`,
`src/lib/markdown/doc-kind.ts`). `TabType` selects which component renders and
gates the four `t.type === 'code'` predicates that decide what persists
(`session-persistence.ts:24,37`, `editor.ts`); a `'markdown'` TabType would have
been silently dropped from `session.json`. Tabs written before this feature carry
no `language` and default to `'r'`.

- **Grammar** (`rmarkdown-monarch.ts`): Monaco's stock markdown Monarch ships
  already, but its GFM fence rule needs a word character after the backticks, so
  it matches neither fence rule on ```` ```{r label} ````. The result is worse
  than a miss: the *closing* fence is read as an *opening* code block and the
  rest of the document inverts. The derived `rmarkdown` language adds one
  brace-aware rule with `nextEmbedded`, so chunk bodies highlight as R. Pinned by
  `rmarkdown-tokenize.test.ts`, which runs Monaco's real tokenizer. Because this
  imports Monaco's internals (`monaco-editor/esm/vs/basic-languages/markdown/`),
  `monaco-editor` is a **direct, exactly-pinned** dependency rather than whatever
  `@monaco-editor/react` happens to hoist.
- **Actions** (`markdown/actions.ts`): one declarative catalog → three consumers.
  `apply-source.ts` is a pure `computeMdEdit(text, selStart, selEnd, action)`, so
  every wrap/unwrap toggle and list-renumbering rule is testable with no DOM;
  `MarkdownRibbon` is a thin Monaco adapter over it (`executeEdits`, never
  `applyExternalContent` — that does a whole-model `setValue` and destroys the
  cursor and undo stack). Ribbon primitives live in `src/components/ui/ribbon.tsx`.
- **Two escapes from "data-only"**, both injected rather than imported, so the
  catalog and `apply-source.ts` still test with no app running:
  - `prompt` — values the editor can't infer. Link and footnote are the only
    users, and both were previously inserted with the caret marker still in the
    text (a bare `[^]`). `MdPromptDialog` collects them; `applyPromptValues`
    folds them into a concrete source op. The host recognises these by candidate
    id so `/link` opens the same dialog the ribbon button does.
  - `dynamic` — a body generated from live app state, via the
    `ChunkBodyGenerator` passed to `resolveActionBody`. Generated bodies are
    marked `literal`, which skips `$N` snippet expansion: R code containing a
    `$`-digit sequence would otherwise be silently corrupted.
- **Slash menu**: `getCompletions(text, offset, deps, mode = 'r')`. The mode is
  **defaulted**, which is what structurally stops the shared R console
  (`Console.tsx:274`) from ever seeing markdown candidates — locked by a
  regression test asserting the no-argument call is byte-identical. `/` opens the
  popup via `CompletionResult.autoOpen`, **not** by widening the `structural`
  regex in `useCompletion.ts` (adding `/` there would pop the menu on `a/b`).
  Inside a chunk, `context-markdown.ts` slices the body and delegates to the R
  analyzer with shifted offsets, giving full R autocomplete in chunks.

  Three surfaces, one catalog, ranked by one function (`markdownSlashMenu`):

  | where | how it opens | what accepting does |
  |---|---|---|
  | Source, empty caret | the analyzer sees `/` in the text | replaces the typed `/query` with the action's text |
  | Source, over a selection | Monaco `onKeyDown` swallows the `/` | hands the action to the ribbon backend, which wraps/prefixes the selection |
  | Visual (both) | `visual/slash.ts`, a ProseMirror plugin | `applyVisualAction`, same as the ribbon button |

  Rows carry the catalog's own lucide icon (`CompletionCandidate.icon`), tinted
  per group by `GROUP_TINT`, so a `/` row and its ribbon button show the same
  picture. R candidates keep the typographic glyphs from `icons.ts`.

  **Over a selection the `/` never reaches the document** — typing it would
  replace the selected lines, which is the opposite of the request. Because
  nothing can be typed, the keystrokes that would filter the list are
  intercepted and accumulated instead (`slashOverSelection` in `CodeEditor`, the
  selection branch of `handleKeyDown` in `slash.ts`). In Visual mode the plugin
  detects the typed `/` in its `view().update` rather than in `handleKeyDown`,
  so the character the user sees and the range deleted on accept always agree.

### Map chunks (`markdown/chunk-codegen.ts`)

"Chunk: current map" and "Chunk: export current plot" generate real R from the
layers, symbology, view and annotations currently on the map, by calling the same
`generateTmapCode` / `generateGgplotCode` the Spatial Editor's Export dialogs
call — a map written into a document and a map exported from the dialog are the
same code. With nothing on the map the generator returns null and the action
falls back to its static scaffolding.

- `buildMapChunkParts` returns the header and code **separately** because Visual
  mode builds a ProseMirror `code_block`, not a string of fences.
- The engine is `useMarkdownSettingsStore.mapChunkEngine` (Settings → Documents,
  persisted in `markdown-settings.json`): `tmap` (default), `ggplot`, or `auto`,
  which follows `spatialSettings.lastExportMode` — whichever Export dialog the
  user opened last.
- The figure variant reuses each generator's `exportOpts` to emit its own save
  call, and its chunk is `include=FALSE`: it exists to WRITE the file that the
  following `![](figures/…)` references, so letting it also render inline would
  put the same figure in the knitted document twice.

### Chunks and inline output

- **Identity** (`chunk-identity.ts`) is the crux. Not a content hash (throws
  output away on every keystroke) and not an index (insertion shifts everything):
  an explicit label is the key — knitr already requires uniqueness — then exact
  code match, then a positional pass, then a uuid. The ribbon auto-labels chunks
  it creates, so almost everything takes the label path. **Invariant: editing a
  chunk preserves its id and marks the output `stale`, never drops it.**
- **Execution** (`r/lib/handlers-rmarkdown.R`): a separate endpoint because
  `/r/execute` points the default device at a single fixed-name PNG
  (`server.R:33-37`) and does one `recordPlot()` — a chunk drawing three plots
  loses two, and broadcast plots carry no caller attribution. Verified: a
  fixed-name device yields 1 file, `png("…%03d.png")` yields 3.
- **Rendering** (`chunks/monacoChunkLayer.ts`): decorations for chunk chrome, a
  **content** widget for `[▶]` (scrolls with the text; overlay widgets are
  viewport-fixed and CodeLens would need a language service this repo has none
  of), and view zones for output with `heightInPx` (`heightInLines` is wrong
  under `wordWrap: 'on'`). React mounts via `createPortal` from the CodeEditor
  tree, not a per-zone `createRoot`, so context survives. The `ResizeObserver`
  watches an **inner** wrapper — observing the zone's own node makes the height
  you set feed back into the measurement.
- **Zones belong to the EDITOR, not the model.** There is one editor and tabs
  swap via `setModel()`, so `chunkLayer.detach()` runs *before* the swap or the
  previous tab's outputs float inside this tab's text.
- Outputs live in `src/store/chunks.ts`, deliberately **not** on `TabState` —
  they hold base64 PNGs and would otherwise be serialized into `session.json`
  and every `.ourgeoproj`.

### Knit

`electron/main/knit.ts` spawns a child `Rscript` rather than using the R server:
knitr's contract is a clean session (catching "works in my console, fails on
knit"), a render can take minutes and the server is serial, and a child can be
killed. `GET /rmarkdown/deps` drives `knit-deps.ts` so each format is
**pre-disabled with a specific reason** before the user clicks — the common
failure is missing pandoc, which is not an R package. `knit-errors.ts` turns
knitr's output into a hint and a line number to jump to.

### Publish to the forum (`src/lib/forum/`, `electron/main/forum.ts`)

The Publish button beside Knit knits an `.Rmd` to markdown and posts it to
ourgeo.dev/forum.html as a new discussion.

**The forum is a static site on Supabase**, not an API: a post is an insert into
`threads`, figures go to the `post-images` storage bucket with a row in
`post_attachments`, bound to the thread afterwards by `link_attachments()`. The
schema lives in the separate `ourgeo-website` repo, and every gate — trust
level, quota, per-post image cap, category role — is a Postgres trigger or RLS
policy whose refusal message IS the user-facing sentence.

- **Markdown, never HTML.** The forum's renderer HTML-escapes everything before
  emitting a tag, so a knitted HTML document would render as literal markup;
  bodies are capped at 12,000 characters where self-contained HTML is hundreds
  of KB; and `data:` image URIs are rejected outright. Markdown is not a
  preference here, it is the only thing that works.
- **All of it runs in the main process.** The access token never reaches the
  renderer, so a bug in the UI cannot post as the user. The renderer only
  transcodes pixels (it has a canvas; main does not) and asks for named
  operations.
- **Auth is PKCE with a loopback redirect** on 127.0.0.1:8788–8790, which is
  what lets one flow cover all three sign-in methods: google/github through
  `/auth/v1/authorize` in the real browser, email through `/auth/v1/otp` as a
  magic link that lands on the same loopback. The verifier stays in the main
  process. **The ports must be listed in Supabase → Authentication → URL
  Configuration → Redirect URLs**, or the browser round trip dead-ends.
- The refresh token is stored with Electron `safeStorage` (`forum-session.bin`),
  not the plaintext `api-keys.json` convention — unlike an API key it grants the
  ability to post as the user. With no OS keyring available nothing is stored
  and the user signs in again next launch.
- **Figures upload before the thread is created.** A document whose images are
  refused then fails with nothing published; the other order would leave a
  public post missing half its figures and no way to fix it from the app.

`publish-markdown.ts` is a pure transform bridging pandoc's output to the
forum's small vocabulary, and each rule exists because of something real in the
renderer: indented chunk output becomes fenced (there is no indented-code rule,
so a printed data frame would arrive as prose), ``` ``` r ``` becomes ``` ```r ```
(the fence regex needs no space, or a stray `r` lands on the first code line),
pipe tables become aligned text in a fence (there is no table rule at all), and
raw HTML is dropped. Pinned by tests against a fixture captured from a real
`rmarkdown::render()` run.

### Visual mode

Milkdown (ProseMirror + remark). remark was already in the tree via `remark-gfm`,
so the parser driving Visual mode is the same one driving the round-trip checker —
with Tiptap or Lexical, a second markdown implementation would put a permanent
bug class on the Source↔Visual seam. Every Milkdown import is confined to
`src/components/editor/visual/` behind `VisualEditorHandle`.

- **The text always owns the truth**; Visual is a projection. It *replaces* the
  editor rather than splitting, so only one is mounted and there is no sync loop.
- **Front matter never enters ProseMirror** (`front-matter.ts`) — remark would
  read `---` as a thematic break and destroy it.
- **The switch is gated** on `roundtrip.ts`, which checks idempotence at the
  second pass plus structural equality and flags raw HTML with line numbers. The
  invariant is idempotence, never byte preservation — the first pass may
  normalise formatting.
- **A no-edit toggle is byte-identical**: entering records a baseline; if the
  serialization is unchanged on exit, the *original* text is written back, so
  looking at Visual mode never reformats the file or marks it dirty. Write-back
  uses `pushEditOperations`, not `setValue`, so Monaco's undo survives.
- **Exit serializes the live doc** (`getMarkdown()` action), never the value from
  the `markdownUpdated` listener — that listener is **debounced by 200 ms**
  inside Milkdown, so a snapshot from it silently drops whatever was typed in the
  last fifth of a second, which in practice is every edit made just before
  clicking "Source".
- `joinFrontMatter` restores the blank line after the front matter: no markdown
  serializer emits a leading blank line, so without it every trip through Visual
  mode would shift the document up by one.
- **Escapes are minimised at the serialization boundary** (`escapes.ts`).
  remark-stringify escapes defensively: every `_`, `*` and `~` in a text node
  comes back with a backslash, so a document that merely *visited* Visual mode
  returned with `geom\_line()` where the author wrote `geom_line()` — which in
  an R Markdown document is the difference between prose and nonsense.
  `minimizeEscapes` removes an escape only when the document still parses to the
  same tree without it, so `geom_line()` loses its backslashes (intraword `_` is
  not emphasis) while `x\*y\*z` keeps them (unescaped it becomes emphasis).
  Candidates are grouped by line and character and accepted whole, because
  dropping one half of `\_id\_` leaves `\_id_` — same meaning today, a trap
  tomorrow. It runs inside `normalize()`, not just at the Visual boundary: the
  mode switch compares against that baseline, so a baseline that still carried
  the escapes would make a look-and-leave toggle rewrite the file.
- **Position survives the switch** (`doc-position.ts` + `visual/anchor.ts`).
  There is no exact correspondence between a markdown offset and a ProseMirror
  position — `**bold**` is eight characters in one and four in the other — so
  the anchor is *top-level block index + alphanumerics into it*. Markdown syntax
  is punctuation, so counting alphanumerics skips exactly the characters that
  exist in one representation and not the other. Exact between blocks,
  approximate within one, which is the right trade for landing the reader on the
  paragraph they were reading. `contentStartOf` descends to the first positioned
  leaf so `# `, `- ` and a chunk's ```` ```{r label} ```` header don't count.

  **Two anchors travel, and they are independent.** The VIEW anchor drives
  scrolling and is read from the viewport — Monaco's
  `getVisibleRanges()[0].startLineNumber`, and in Visual the first top-level
  block whose rect bottom is below the pane top (with the fraction scrolled past
  mapped onto its character count, so a long chunk resumes mid-way). It is
  restored to the TOP of the destination viewport, because that is where it was
  measured from. Following the caret instead would land the reader wherever the
  cursor happened to be left, which after any scrolling is not what they are
  looking at.

  The CARET anchor is carried separately and **written back only when the reader
  moved it**: `entryCaret` is recorded on the way in and compared on the way
  out. A mode toggle is not an edit, so an unchanged caret is left exactly where
  it is rather than re-derived from an anchor — the anchor is exact to the
  alphanumeric, not to the byte, so round-tripping an untouched cursor would
  nudge it for no reason. Hence `setCaretAtAnchor` and `scrollAnchorToTop` are
  separate calls; ProseMirror's `scrollIntoView()` flag could not be used for
  the second even in principle, because it needs a transaction and therefore a
  selection change.

  Both restores scroll by hand. Visual: two frames after `create()`, because the
  pane's scroll height is still settling and ProseMirror's `scrollIntoView()`
  flag no-ops on a box that has not finished growing. Source: two frames plus an
  explicit `editor.layout()`, because Monaco spends Visual mode inside a
  `display:none` wrapper and has no width until React unhides it — and with
  `wordWrap: 'on'` line heights depend on width, so scrolling before that
  relayout computes tops for a zero-width editor.
- Known gaps: `$…$` math renders as literal text; **footnotes have no node in
  Milkdown's commonmark+gfm schema**, so the ribbon dims them in Visual mode
  (`VISUAL_UNSUPPORTED`) and `roundtrip.ts` flags them as unsupported. That flag
  matters because remark round-trips footnotes *perfectly* — a remark-only check
  sees no loss, while ProseMirror would drop them.

#### Chunks in Visual mode (`visual/chunk-view.ts`)

- **Options survive the round trip.** mdast splits ```` ```{r a, echo=FALSE} ````
  into `lang: "{r"` + `meta: "a, echo=FALSE}"`, and Milkdown's stock code_block
  keeps only `lang` — so everything after the first space was DROPPED on the way
  back to markdown, a silent edit to the user's document just for looking at it.
  `chunkAwareCodeBlock` (`codeBlockSchema.extendSchema`) carries `meta` both ways.
- **Upgrade on focus, per the plan.** Each chunk holds two stacked layers: a
  read-only hljs-highlighted `<pre>` and the real editable `contentDOM`. CSS
  shows one at a time, driven by the `is-active` class that `activeChunkPlugin`
  puts on whichever code block holds the selection. No per-chunk editor is
  constructed, so a 50-chunk document stays cheap.
- Clicking the read-only layer maps the point back to a character offset with a
  **Range from the layer's start to the hit point** — a click in the `<pre>`'s
  padding resolves to the ELEMENT, not a text node, so walking text nodes would
  land every such click at the end of the chunk.
- Output is keyed the same way `chunk-identity.ts` keys it (`label:<label>`), so
  a chunk run in Source mode still shows its output in Visual and back, and Run
  goes through the same `runChunkCode` path.

## Design Tokens

```
Background:  #0f1117  (geo-bg)
Panel:       #161b22  (geo-panel)
Border:      #21262d  (geo-border)
Accent:      #4493f8  (geo-accent)
Success:     #3fb950  (geo-success)
Error:       #f85149  (geo-error)
Muted:       #8b949e  (geo-muted)
```

Dark-mode only — no light mode toggle. New UI must use these tokens via Tailwind classes (`bg-geo-bg`, `text-geo-muted`, etc.) and follow the existing shadcn/ui + Radix component patterns in `src/components/ui/`.
