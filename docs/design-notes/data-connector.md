# Data Connector

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

## Data Connector — Browse Sources (`src/components/connector/sources.ts`)

The curated half of the dialog: a source is a fixed list of datasets, each a few
typed parameters and a `buildCode` that emits R. Three rules came out of finding
it broken.

- **Every request the renderer makes goes through `proxyFetch`.** The four live
  catalogues — Kaggle, Socrata, CKAN, FRED — used the renderer's own `fetch`,
  and they are the only network calls in the app that did. ouRGeo renders from
  `file://`, so each was made with a null origin and lived or died by whether
  the server happened to allow one: open.canada.ca does, non-standardly, and
  nothing obliges it to keep doing so. The Web APIs tab has always used the main
  process; this half had simply never been moved. They also had no timeout,
  which is a spinner nobody can clear.
- **Check `res.ok`, always.** `https://<domain>/api/catalog.json` answers HTTP
  406 — Socrata retired the per-domain catalogue in favour of the discovery API
  at `api.us.socrata.com`, which `socrata.ts` already used and this did not. The
  406 body is valid JSON with no `results` key, so the failure was SILENT: every
  Socrata portal showed "No results" and said nothing about why. A response that
  parses is not a response that succeeded.
- **Do not blame the user's connection.** The single catch answered every
  failure with "Failed to fetch catalogue. Check your internet connection.",
  including a server that 500s, a portal that is merely slow, and a request
  aborted when the laptop suspended. `catalogueErrorMessage` names the service
  and says what happened.

### What a connector lets the user control (the NWIS case)

The question a new dataset has to answer is which arguments are the USER's and
which are the dataset's identity. USGS NWIS is the worked example:

- **`service` is the dataset, not a field.** Daily values, water quality and
  groundwater ARE the three services; offering a service picker as well would
  let someone choose "Daily Values" and then set the service to something else,
  a contradiction the panel would have to resolve.
- **`parameterCd` is a field**, and pinning it to 00060 made a service that
  carries discharge, gage height, temperature, conductance and pH able to fetch
  only the first. `ParamOption` gained an object form for this: the menu shows
  `00060 — Discharge (ft³/s)` and sends `00060`, because a bare code tells a
  user nothing and the value has to stay the code.
- **The site number is a field, and it is the one that matters** — a state of
  daily values is tens of thousands of rows a year; a gage is a few hundred.
  But NWIS takes exactly ONE major filter and `stateCd` + `sites` is an HTTP
  400, so the two share a rule rather than a form: `nwisMajorFilter` sends sites
  when they are filled and the state otherwise, and both hints say so.

Two of the three datasets emitted R that could not run, which is worth recording
because nothing in the app could have noticed: `readNWISdata(service = "qw")`
fails outright in dataRetrieval 2.7.25 (USGS retired the NWIS water-quality
service — the data moved to the Water Quality Portal, so the dataset now calls
`readWQPdata`), and `service = "gwlevels"` is answered with the list of services
dataRetrieval does accept (depth to water is published as daily parameter 72019,
which keeps groundwater and streamflow on one working mechanism). **A connector
is a claim about somebody else's API, and the only way to check the claim is to
run the R it generates.**

`rStr` moved into `dataConnectorCode.ts` for the rewritten datasets. The rest of
`sources.ts` still interpolates user text into R raw — the same hazard AGENTS.md
rule 24 names — and is worth a sweep.

### Help buttons

`DataSource.docsUrl` and `ApiProvider.docsUrl` are REQUIRED, and a test asserts
every shipped one is an `https:` URL: a Help button is only as good as the link
behind it, and the type cannot catch an empty string, which a plugin-contributed
connector is deliberately allowed (one written before this existed cannot have
declared a link, and dropping its connector over that would be a worse answer
than not drawing the button). `ApiServer.docsUrl` is the optional second link
and exists for open-data portals specifically: the protocol docs explain SoQL,
and the portal explains what is in it and whether it is having a bad day. Both
open through `shell.openExternal` — an `<a>` on a `file://` page navigates the
app away from itself.

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
