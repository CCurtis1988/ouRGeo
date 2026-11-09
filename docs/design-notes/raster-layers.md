# Raster layers and code generation

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

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
