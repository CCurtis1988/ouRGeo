# Checked vector export — 1.16.5

Open a spatial Data Viewer → **Export layer…**. Choose format, absolute local
destination, layer name and mode. The default is a new GeoPackage; whole layer
or explicit current selection. **Check data** shows the plan; **Check and save**
checks it if needed. Original data stays intact. Controlled imports track source
paths and those originals cannot be replaced. Arbitrary R imports may not carry
that path metadata; existing-file replacement still requires specific review.
The first-run installation health check remains separate and unchanged.

## Profiles and choices

| Profile | Supported preservation contract |
| --- | --- |
| GeoPackage | Known native CRS; exact coordinates; uniform XY/XYZ/XYM/XYZM; supported canonical curves and mixed geometry; primitive text/integer/double/logical attributes. |
| GeoJSON | RFC7946=YES; WGS84 longitude/latitude; explicit decimal precision (default15, 0–15) and 17 significant property digits. XYZ needs declared WGS84 ellipsoidal altitude in metres (4979/equivalent); arbitrary Z/M cannot be reinterpreted. |
| Existing GeoPackage | Add a layer or replace exactly a named layer in a staged copy. Verify unrelated exposed vector/attribute layers and FIDs. Raster/unknown-content containers block updates: choose a new file. |

Primitive field types, values/nulls and leading-zero identifiers are retained.
Business keys remain attributes; no key silently becomes a driver FID. Rich
fields block unless individually omitted or converted through a supported scalar
text policy. Factor/date/time/units conversion loses class metadata deliberately;
numeric text uses 17 significant digits, units retain explicit labels, and POSIX
time becomes UTC ISO text with 6 fractional decimal places. Finer timestamp
fractions are truncated only through this explicitly reviewed conversion. Lists can be
omitted, not silently flattened. Choice lists currently use comma-separated
names: explicitly rename a comma-containing field before choosing omission/text.

GeoJSON blocks curves, M/mixed dimensions, invalid/empty/uncheckable geometry,
unknown CRS, non-finite coordinates and precision-induced collapse. A feature
extent over180° (except a single point) requires an explicit supported copy;
no dateline split or axis guess occurs. Non-finite attribute values, including
NaN, need explicit text conversion/omission. GeoPackage can preserve tested
empty/invalid/uncheckable geometry without repair; unknown analytical validity
requires review and grants no subsequent analysis permission.

The plan shows source/destination CRS, units, axis convention, geometry/dimension
scope, field changes, precision and effective writer options. New GPKG files
declare version1.3, a separate generated FID and SPATIAL_INDEX=NO; existing
container creation options are not reapplied. GeoJSON uses RFC7946=YES,
COORDINATE_PRECISION, SIGNIFICANT_FIGURES=17, WRAPDATELINE=NO,
WRITE_NON_FINITE_VALUES=NO and AUTODETECT_JSON_STRINGS=NO. Readback uses
DATE_AS_STRING=YES to preserve date-looking JSON text as text rather than infer
new attribute types ([GDAL option documentation](https://gdal.org/en/stable/drivers/vector/geojson.html#open-options)). Actual material
transformation/rounding/ring changes, field changes and replacement need exact
native review. Clean compatible exports have no warning dialog.

## Safe execution

GUI and `data:exportVector` share the enforced backend/controller. The AI action
takes an explicit path, opens no file picker and cannot fall back to raw R.
Approvals bind source/selection/profile/destination revisions and exact issue
codes; caller-manufactured acknowledgments do not grant permission.

The backend acquires a per-destination app lock and a private staging directory
beside the destination. Existing SQLite containers must be closed, stable and
have no WAL/SHM/journal companions. Unexpected writer warnings fail execution.
Complete readback compares all rows, field names/types/values, CRS, geometry
types/dimensions/structure and coordinates, plus unrelated container layers.
GPKG coordinates compare exactly. GeoJSON allows half the decimal quantum plus
16 IEEE double epsilons times ordinate magnitude; RFC7946 polygon ring
orientation/start changes use a canonical comparison, never repair.

Publication rechecks source/selection/destination and verified-stage hashes.
New files use exclusive hard-link creation; replacement uses same-filesystem
rename without deleting the old file first. Unsupported/locked filesystems fail
safely. The writer yields between write/readback/publication stages so cancel
can revoke permission before publishing. Native calls can defer cancellation;
Windows uses cooperative cancellation rather than terminating R with SIGINT.
Cancellation after completed publication does not undo a completed save.
External applications must close a destination; app locks do not control arbitrary
external writers. A crash may leave staging/locks: verify no app/export owns a
lock before deliberately removing it. No automatic stale-lock deletion occurs.

Only completed publication records replayable `dq_export_run` and reports saved.
A replay against changed source/destination state must rerun preflight; recorded
fingerprints do not authorise overwriting a newly existing destination.
Full local row/verification records are session-scoped in bounded
`dq_state$exportRecords` (32 entries), with no sidecar or second catalogue.
There is no account, LLM, telemetry or grid-download requirement. This is not
scientific certification, every-driver support, a replay bundle or Server publishing.

## Independent acceptance and actual verification

`tests/fixtures/preflight/export.R` uses real installed writers and literal
fixtures, not implementation-generated golden values:

- Projected EPSG:32610 points `(500000,4100000)` / `(500003,4100004)`, 01/1 keys,
  zero/NA/booleans: exact GPKG coordinates, fields and source serialisation.
- Custom WKT without EPSG, mixed point/line, empty, XYZ/XYM/XYZM, literal
  CIRCULARSTRING: tested preservation; unsupported GeoJSON content blocks.
- Factor/units text conversion and list omission require explicit review.
  Numeric/unit strings retain 17 significant digits; timestamp text declares
  microsecond precision and preserves nulls. Literal ISO date/time JSON strings
  remain strings during full readback verification.
- Independent Mercator formula: R=6378137, x=`R*7*pi/180`,
  y=`R*log(tan(pi/4+52*pi/360))`; raw JSON returns longitude7/latitude52 within
  absolute `0.5e-7` degrees at precision7. Declared altitude12.25 is retained;
  unknown altitude blocks. Polygon orientation and mixed JSON shapes are tested.
- Row/schema/value/geometry loss, mutation after verification, injected writer
  failure, source/destination edits, source paths, symlinks, WAL, competing
  locks, selection scope, denial/forgery, staged cancellation and recording.
- Replace one of two layers, add a third, preserve unrelated content/FIDs.
- Frontend/AI argument validation, backend block, asynchronous completion,
  recording only after publication, cancellation, defaults and stale consent.

Commands:

```sh
npx vitest run src/lib/vector-export.test.ts
npx vitest run src/lib/vector-export-authority.test.ts src/components/editor/VectorExportDialog.test.tsx
npm run typecheck
npm run lint
npm test
npm run build
node scripts/check-vector-export.mjs
```

Linux: typecheck/build passed, lint0 errors/38 existing warnings,
**143 files/1823 tests passed**. Built Electron passed clean GPKG save (no
warning), reviewed GeoJSON save (one native review), source/readback preservation
and existing-destination blocking. Native responses are stubbed per the run
skill; isolated profile and 2-feature app fixtures leave normal profiles alone.
Screenshots live under `/tmp/ourgeo-vector-export-*` and are visually reviewed.
No large-export speed guarantee is claimed; previous 8192-feature inspection
measurements are separate. R/Electron run in the permitted native execution
environment outside the restricted agent subprocess sandbox.

Stack: Linux x86_64, R4.6.1, sf1.1.1, sfarc0.5.0, units1.0.1, GEOS3.14.1,
GDAL3.13.3, PROJ9.8.1, S2 1.1.13 in the isolated ignored `.cache/preflight-r`
library. The normal S2 installation has an Abseil mismatch; the first GUI run
correctly blocked on it. No user library was changed. Windows/macOS/packaged
installers were unavailable; Windows interruption guards are unit-tested only.

## Manual QA

1. Table → Export layer → new GPKG. Inspect the ready plan; save without warning.
2. Projected source → GeoJSON precision7. Review CRS/options; reopen output and
   check coordinates, keys and recorded R.
3. Rich fields: confirm default block, then review an explicit omission/text change.
4. Close an existing vector GPKG elsewhere; add/replace one named layer and
   verify unrelated layers. Change selection/options after checking; permission
   must invalidate. Cancel a save before publication; previous files stay intact.
5. Confirm Settings → Health check remains available.

See [implementation spec](vector-export-spec.md), [sf writer](https://r-spatial.github.io/sf/reference/st_write.html),
[GPKG](https://gdal.org/en/stable/drivers/vector/gpkg.html),
[GeoJSON](https://gdal.org/en/stable/drivers/vector/geojson.html),
[SQLite WAL/backup](https://www.sqlite.org/backup.html).

## Changed files

- [CLAUDE.md](../CLAUDE.md)
- [README.md](../README.md)
- [docs/data-checks.md](../docs/data-checks.md)
- [docs/vector-export-spec.md](../docs/vector-export-spec.md)
- [docs/vector-export.md](../docs/vector-export.md)
- [electron/main/data-preflight.ts](../electron/main/data-preflight.ts)
- [electron/main/ipc.ts](../electron/main/ipc.ts)
- [electron/preload/index.ts](../electron/preload/index.ts)
- [electron/preload/types.d.ts](../electron/preload/types.d.ts)
- [package-lock.json](../package-lock.json)
- [package.json](../package.json)
- [r/lib/data-preflight.R](../r/lib/data-preflight.R)
- [r/lib/vector-export.R](../r/lib/vector-export.R)
- [r/server.R](../r/server.R)
- [scripts/check-vector-export.mjs](../scripts/check-vector-export.mjs)
- [src/components/editor/DataFrameView.tsx](../src/components/editor/DataFrameView.tsx)
- [src/components/editor/VectorExportDialog.test.tsx](../src/components/editor/VectorExportDialog.test.tsx)
- [src/components/editor/VectorExportDialog.tsx](../src/components/editor/VectorExportDialog.tsx)
- [src/components/toolbox/DataChecksPanel.tsx](../src/components/toolbox/DataChecksPanel.tsx)
- [src/lib/ai-actions/data.ts](../src/lib/ai-actions/data.ts)
- [src/lib/ai-actions/targets.ts](../src/lib/ai-actions/targets.ts)
- [src/lib/ai-skill-ourgeo.ts](../src/lib/ai-skill-ourgeo.ts)
- [src/lib/data-preflight-types.ts](../src/lib/data-preflight-types.ts)
- [src/lib/data-preflight.test.ts](../src/lib/data-preflight.test.ts)
- [src/lib/data-preflight.ts](../src/lib/data-preflight.ts)
- [src/lib/load-data-code.ts](../src/lib/load-data-code.ts)
- [src/lib/r-client.ts](../src/lib/r-client.ts)
- [src/lib/vector-export-authority.test.ts](../src/lib/vector-export-authority.test.ts)
- [src/lib/vector-export.test.ts](../src/lib/vector-export.test.ts)
- [src/lib/vector-export.ts](../src/lib/vector-export.ts)
- [tests/fixtures/preflight/README.md](../tests/fixtures/preflight/README.md)
- [tests/fixtures/preflight/acceptance.R](../tests/fixtures/preflight/acceptance.R)
- [tests/fixtures/preflight/export.R](../tests/fixtures/preflight/export.R)
