# Checked vector file export — implementation specification

## Baseline and goal

Starting at 1.16.4, Desktop reads vectors but has no controlled GeoPackage or
GeoJSON file writer. `export-gpkg` / `export-geojson` are blocked placeholders.
Implement a Save vector layer workflow using the existing R preflight engine,
object/selection identities, native approval authority, Data checks panel and
console recording. Keep the first-run health check and existing exports intact.
This is core work because preservation and filesystem commit need backend
enforcement; it is not a new connector or a Server publication feature.

## Scope and profiles

- One existing sf-compatible vector per operation; whole layer by default or
  explicit current selection. Preserve source data and project row identities.
- GeoPackage: native CRS, exact coordinates, supported XY/Z/M and canonical
  curved geometries only after driver/readback verification. Multiple types
  use an explicitly declared general geometry column. No automatic coercion.
- GeoJSON: RFC7946=YES, traditional longitude/latitude in WGS84, explicitly
  selected decimal precision (default 15, range 0–15), 17 significant figures
  for numeric properties. Strict installed-resource transformation occurs on
  a copy before writing. No hidden driver reprojection, network grids or
  dateline splitting. Block unsupported curves/M and ambiguous dateline paths.
- Plain text, integer, double and logical fields have explicit driver schema
  checks. Unsupported fields block unless individually selected for omission
  or a supported, explicit text conversion. Never silently discard list
  columns, factor metadata, units or identifiers. No business key becomes a
  driver feature ID implicitly.
- New local files; deliberate existing GeoJSON replacement; existing closed
  GeoPackage add-layer or replace-named-layer. Never replace the whole container
  as a shortcut for replacing a layer. Block active journal/WAL/SHM companions,
  source-file destinations, symlinks, remote/VSI paths and concurrent app writes.
  External applications must close a destination before it is updated; this
  does not promise filesystem-wide locking against arbitrary other programs.

## UX and authority

Add Export layer to the Data Viewer, beside existing Data checks. Dialog shows
source/scope, format, local destination, layer name, destination mode, field
omissions/conversions and GeoJSON precision. Reuse native save picker for GUI;
AI action takes an explicit path and never opens a native file picker.

Show the complete export plan: source/destination CRS and axis convention,
geometry types/dimensions, fields retained/changed/omitted, precision, actual
writer/readback options, selected/excluded counts and existing-layer disposition.
GeoJSON readback uses DATE_AS_STRING=YES to preserve JSON text types. Explicit
numeric-to-text conversion uses 17 significant digits; timestamp text is UTC
ISO-8601 with 6 fractional places, with finer-fraction truncation disclosed.
Group blocked findings and material changes; only exact issue/fingerprint
approval permits a warning-bearing plan. Clean lossless export has no warning
dialog. Input, selection, options and destination changes invalidate permission.
Expose progress/cancel during inspection and writing/readback stages. A native
call can defer cooperative cancellation, especially on Windows, but there is
an event-loop cancellation boundary before publishing the staged file.

Controlled backend execution must revalidate rather than trust renderer claims.
The GUI and `data:exportVector` share the same controller. No arbitrary R fallback
on failure. Arbitrary user-authored R retains its existing privileges.

## Staging, verification and publication

1. Resolve a canonical local destination and record its content revision or
   absence. Bind revision, driver versions, schema/profile/options to preflight.
2. Acquire a per-destination app lock. Stage in the destination directory so
   final rename stays on the same filesystem. Existing closed GeoPackages are
   copied only after stable-revision and companion-file checks; writes affect
   the selected layer of the staged copy only.
3. Prepare the exact approved derived export data. All changes are explicit;
   strip only application-private attributes that are not GIS fields.
4. Write using fixed approved GDAL options. Treat unexpected writer warnings
   as failure rather than silently accepting conversion.
5. Reopen with the selected driver and compare all feature counts, field names,
   field types/values/nulls, CRS, types/dimensions and geometries. Use exact
   GeoPackage coordinate/value comparisons; GeoJSON tolerance is half its
   chosen decimal quantum plus floating-point representation error. Polygon
   ring start/orientation differences allowed by RFC7946 are compared through
   a documented canonical ring representation, never a geometry repair.
   Unknown comparison coverage blocks publication. Verify unrelated container
   layers and retain the original complete container until publication.
6. Before publication, recheck source/selection and destination revisions,
   cancellation, complete verification and approval. Publish by same-filesystem
   exclusive hard-link creation for a new destination, or same-filesystem
   rename for replacement; if replacement is unsupported/locked, fail without
   deleting the old file. Clean all staging/locks on failure/cancel. No successful-output claim
   until publication finishes. A cancellation received after that commit point
   cannot retroactively undo a completed save.
7. Echo replayable actual R, exact profile/options and local validation choices.
   Keep complete local row trace/verification records in session state; public
   diagnostics are bounded and do not upload paths/data/identifiers.

## Test-first acceptance

Write each vertical slice's failing fixture before implementing it. Independent
expectations are literal input coordinates/values, hand-written geometry, and
the existing Mercator reference arithmetic, not implementation-produced goldens.

1. New-file GeoPackage preserves two literal projected points (500000,4100000)
   and (500003,4100004), EPSG:32610, 01/1 text keys, NA, logical/numeric values;
   source serialisation unchanged and no warning for compatible content.
2. Custom WKT without EPSG, mixed geometry, Z and M, empty and curved fixtures
   either preserve tested content exactly or explicitly block unknown support.
3. Rich/list fields block; selected omission/text conversion needs exact review;
   source identities and private fields are never confused with a business key.
4. RFC7946 point (longitude7,latitude52) in EPSG:3857 uses independently computed
   Mercator coordinates; decoded output is 7/52 within decimal-profile tolerance.
   Raw JSON checks axis/profile/precision. Curves/M/nonfinite/dateline ambiguity
   never disappear through driver defaults; mixed supported geometry is tested.
5. Inject row/schema/value/geometry loss into staged readback; publication fails
   and previous file bytes remain identical. Writer errors have the same result.
6. Existing two-layer GeoPackage: add a third or replace one named layer; the
   unrelated layer's content remains exact. Existing-target mode mistakes block.
7. Missing native approval, forged acknowledgments, changed source/selection,
   precision/profile/destination revision and stale asynchronous UI results
   cannot publish. Denial/cancellation produces no output and releases locks.
8. Existing-file replacement approval specifies exactly the named file/layer;
   simultaneous app writes cannot race. Source-path, journals, symlinks and
   unsupported/locked destinations block without corruption.
9. R recording reproduces the reviewed method/options; engine/network settings
   restore on errors. GUI/AI use one controlled handler, no account/network needs.
10. Run typecheck, lint, full tests, build, and real Electron GUI new GPKG,
    GeoJSON and a blocked export. Inspect screenshots. Report actual Linux/R/
    driver versions; Windows/macOS/installer checks only if actually available.

## Delivery and exclusions

Advance patch to 1.16.5 once for this coherent feature. Update README, CLAUDE,
ourgeo_docs, data-checks guide and fixture documentation. Report commands,
results, scope/tolerances and platform limitations. No new projection/repair
engine, universal GDAL formats, full raster export validation, Server bridge,
telemetry, paid service or mandatory AI. Do not claim scientific certification.

## Primary technical references

- https://r-spatial.github.io/sf/reference/st_write.html
- https://r-spatial.github.io/sf/reference/st_transform.html
- https://gdal.org/en/stable/drivers/vector/gpkg.html
- https://gdal.org/en/stable/drivers/vector/geojson.html
- https://www.sqlite.org/backup.html (why an active WAL database is not a plain-file copy)

This document is the compact implementation/handoff basis. Execution and actual
verified limits are recorded separately; writing the spec alone is not delivery.
