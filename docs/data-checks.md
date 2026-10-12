# Data checks and operation preflight (Desktop 1.16.4)

## What users can do

Open a vector or attribute table in the Data Viewer and choose **Data checks →
Check data**. This profiles the full source without editing coordinates, CRS,
geometry, attributes, order or the source file. The profile distinguishes total
and selected rows, project identities and business fields, geometry validity,
empty/missing and uncheckable geometry, types/dimensions, extent, field types,
null/blank/non-finite values, repeated values, CRS and coordinate units. Repeated
optional values and empty descriptive fields do not forbid unrelated work.
Missing CRS still permits attribute inspection. Inspection is not a global
claim that a dataset is safe for every operation.

Relevant toolbox dialogs contain the same panel. **Run** performs preflight if
necessary. A clean compatible operation runs without a warning dialog; specific
material choices require a native Desktop review. A blocked check has no
“continue anyway”. Change the data, parameters, method or supported explicit
exclusions and check again. Cancelling/declining creates no result. Changes to
source data, selection, parameters or the destination result invalidate
permission; the backend rechecks before assigning a derived object.

**Assign CRS** means “these existing coordinates are already expressed in this
CRS”; it changes metadata on a derived copy. **Transform CRS** changes coordinates
from a known source into the explicitly chosen target. Neither infers a CRS,
UTM zone or axis swap. Valid custom WKT needs no EPSG number. A requested import
transformation preserves the native imported layer and creates a reviewed
`*_reprojected` copy. Unknown-CRS layers cannot be displayed as if they were
longitude/latitude.

A buffer shows metric parameter units, source/working CRS, method and result
units. Native geographic input in degrees uses S2 spherical metres; projected input uses
planar linear-unit conversion. International feet and US survey feet are
separate choices. SF buffers distinguish exact sfarc curves, where installed,
from an explicitly approved GEOS polygon approximation. No repair, curve
linearisation of source inputs, Z/M flattening or feature exclusion is automatic.
Analytical curved/Z/M input that this path cannot safely process is blocked.
Exact curves cannot cross a projection through this strict V1 plan: use an
explicitly approved polygon buffer approximation or transform a copy first
and compute an exact buffer in its native projected CRS.
Other angular coordinate units (for example EPSG:4807 grads) are not silently
interpreted as degrees. Their geographic validity result is uncheckable;
explicitly transform a copy from its known CRS before using this path.
Existing repair tools remain separate and are not integrated or advertised as
validated here. The existing positive-buffer forms retain their positive
workflow; no negative-buffer GUI workflow existed in the discovered forms.

Attribute joins show key names/types, relationship, duplicate key groups,
null/blank keys, unmatched **source rows on each side** and predicted output
rows. Keys match exactly: no trimming, case folding, numeric coercion, leading
zero removal, blank-to-null conversion, first match or deduplication. Missing
and blank keys never match. A relationship violation blocks; deliberate
one-to-many expansion and many-to-many plans require review. Explicit suffixes
prevent overwritten fields. Actual output count is compared with prediction,
and complete derived-row source identities remain in the local result.
For CSV/TSV/text business identifiers, choose **character** in the existing import
column controls before loading to preserve leading zeros; changing an already
inferred number back to character cannot restore lost zeros. Existing explicit
NA-string/type import settings still apply.

Selected summary fields require a deliberate **block**, **propagate** or **omit**
policy when values are missing/non-finite. Results carry per-group total, used
and missing counts and retain units. All-missing numerical results are NA,
never an implicit zero. Spatial input summaries are explicitly attribute tables,
without an implicit geometry union. Exclusions name source rows and require a
reason; complete included/excluded identities are recorded locally, even when
only examples are displayed. Excluding all eligible rows blocks execution.

The console and existing recorder receive the R that actually ran, including
`dq_run` with the request, fingerprint and chosen policies. A local
`ourgeo_validation` attribute carries the plan and complete source/exclusion
record; joins also carry `ourgeo_trace`. Replaying recorded R requires the same
source and destination revision; otherwise revalidate. No data values, paths or
identities are sent to a remote validator. There is no account, AI, internet or
telemetry dependency. These local records may contain private identities; no
new diagnostic-upload or export feature was added.

## Discovered integration and supported scope

| Existing surface | Integration |
| --- | --- |
| `load-data-code.ts`, `LoadDataDialog`, AI data import | Existing vector reads preserved; requested CRS transform uses reviewed derived copy. Explicit character delimited columns are read as character. |
| Data Viewer | Reusable read-only checks, complete affected identities/reasons and selection for geometry findings. |
| `ToolForm`, AI `runToolboxTool` | Shared request/controller; R-owned preflight and execution instead of arbitrary generated R for checked tools. |
| SF toolbox | Buffer, area/length columns, intersection/difference/erase/clip, union/dissolve/merge, spatial filter/join, transform, explicit assignment. |
| geos toolbox | Buffer, area, distance, intersection/difference/unary union; preserves native element-wise geos behaviour, units and CRS-bearing results. Unequal multirow inputs block instead of inventing a cross-product. |
| Attribute toolbox | Left/right/inner/full/semi/anti joins and selected-column group summaries. |
| Rgeo/DuckDB | Existing proxy materialisation and primary keys, ordered to match the table viewer. No second database/catalogue. |
| Map display | Known-CRS display transformation uses strict installed-resource checks; native source remains unchanged. |
| GeoPackage/GeoJSON vector-file export | Since 1.16.5: Data Viewer and data:exportVector share checked profiles, staged writes/readback, specific approval and safe publication. See [vector export](vector-export.md). Server publication remains absent. |
| Raster, other tools, user-authored R | Outside this validation guarantee; no new tool, projection engine, connector, Server/Cloud bridge or scientific validator. |

Vector inspection covers sf-compatible objects from the existing supported
Desktop vector surface: GeoJSON, Shapefile, KML/KMZ and the existing spatial
picker for GPKG/GML/DXF/GPX/FGB. It does not promise every installed GDAL format.
CRS-bearing geos objects are inspected through the existing sf conversion;
raw geometry without a known CRS cannot be used in metric/spatial execution.
Existing tables/CSV imports are join inputs. Right-side spatial geometry must
be explicitly prepared as an attribute table. Unevaluated pipelines and implicit
viewport approximations are not validated: run/materialise first, or choose an
explicit row selection. Other existing tools retain their previous behaviour.

The 1.16.4 implementation had no controlled vector file writer. The 1.16.5
export slice now wires GeoPackage/GeoJSON profiles and the previously missing
acceptance 13–14 through `tests/fixtures/preflight/export.R`: full staged
readback, explicit field/CRS/precision plans, loss detection, previous-file
protection and unrelated vector-layer preservation. See [scope, versions and
actual verification](vector-export.md). Display/image/raster/RData/Rgeo exports
remain separate; there is no Desktop-to-Server publication bridge.

## Backend contract and authority

Reports have `schemaVersion: 1`, operation ID/type, content/selection revisions,
parameter digest, SHA-256 fingerprint, status, coverage, checked time, issues,
profiles, execution plan and fingerprint-bound acknowledgments. Operation
statuses are ready, needs_confirmation, blocked, checking, cancelled and failed.
Checks distinguish passed, warning, blocked, not_applicable, not_checked and
check_failed. Unknown affected counts are null; bounded examples are not a
complete identity record. Full rows/reasons are retrieved separately and kept
with local derived results.

Geometry scanning uses `later` chunks of 128 source rows through the existing
R HTTP backend. Revision-keyed complete profiles are cached in bounded session
memory; uncheckable geometry profiles are not reused. Cancellation stops further
chunks. Slow final preflight is marked for a targeted native interrupt; temporary
S2/axis/network settings restore on error/interrupt. Async UI results for changed
requests are discarded.

The backend denies caller-supplied acknowledgments. Electron fetches the current
immutable report and obtains a native user review; a private main/R bridge
secret approves the exact fingerprint. It never enters preload, reports or R
recording. GUI and AI use this same path; no new AI privilege or agent framework
exists. Arbitrary user-authored R is explicitly outside the guarantee.

Strict transformations test the full affected input with installed resources,
`allow_ballpark=FALSE`, `partial=FALSE`, PROJ networking off and traditional GIS
x/y axis policy. They compare counts/dimensions and block newly empty/non-finite
geometry. The active PROJ context is also explicitly disabled; changing its environment
variable alone cannot enforce this on an existing context. Session settings
restore. No resource download or accuracy claim is
made. Coordinate-range/UTM/broad-extent findings are plausibility/suitability
warnings, never proof of a replacement CRS.

## Independent fixtures and actual verification

`tests/fixtures/preflight/acceptance.R` defines tiny synthetic datasets and tests
both inspection and controlled execution; `keys.csv` tests explicit character
import. Expectations were established by arithmetic and row enumeration, not
implementation-generated golden outputs:

| Fixture | Expectation and tolerance |
| --- | --- |
| EPSG:32610 points (500000,4100000), (500003,4100004) | Installed CRS reports metres; 3–4–5 difference is **5 m**, absolute 1e-8. A planar coordinate test, not ground accuracy. |
| 10×10 m rectangles offset 5 m | **100 m²** area, **50 m²** intersection; absolute 1e-8 for these simple planar fixtures only. |
| Native unit conversion | 10 international ft = **3.048 m**; 10 US survey ft = **12000/3937 = 3.048006096012192 m**; absolute 1e-12. |
| Geographic 100 m S2 buffer | Independent spherical radius 6371010 m and angular arithmetic; includes a point at 99 m and excludes one at 105 m with 10000-cell budget. This tests a stated approximation envelope, not exact-circle/ellipsoidal accuracy. Degrees-as-metres and planar geographic paths block. |
| Labelled longitude 7°, latitude 52° → EPSG:3857 | Independent spherical Mercator formula with radius 6378137 m; absolute 1e-6 m detects axis reversal. |
| L1:A, L2:B, L3:C versus R1:A, R2:A, R3:D | Many-to-one/one-to-one blocked; approved one-to-many left join **4 rows**, left unmatched **2/3**, right unmatched **1/3**, complete trace. |
| Separate key/field/missing fixtures | Many-to-many 8 rows; blank/null non-match; “01” differs from “1”; types and suffix collisions block; summary all-missing NA and explicit denominators. |
| Invalid/empty/Inf/curved validity | Separate counts, row identities/reasons; failed/NA curve validity is uncheckable; no repair. XYZ analysis blocks. Assignment preserves canonical curve and source. |
| Authority/revision/cancellation | Direct commit/forged acknowledgment/private-secret denial, AI block/denial, native review, changed data/selection/parameters, stale UI responses, cached unchanged consent, zero eligible input, setting restoration and recorded-R replay. |
| Hand-written `survey.geojson` through the shipped import builder | Known RFC 7946 longitude/latitude and A/B keys preserved; absolute literal-coordinate tolerance 1e-12 degrees. |
| Native DuckDB materialisation | Installed spatial extension, no download; unordered PKs 20/10 read in 10/20 order with complete PK identities; normal materialisation still omits internal PK. |

Commands run in this Linux environment:

```sh
Rscript tests/fixtures/preflight/acceptance.R
npm run typecheck
npm run lint
npm test
npm run build
node scripts/check-data-preflight.mjs
```

Tests requiring R/native Electron run outside the restricted agent subprocess
sandbox. The built-app script uses a fresh isolated profile, leaves the normal
user profile untouched, and stubs the native dialog response according to the
repository run skill. Screenshots are saved under `/tmp/ourgeo-data-preflight`.
The first-run health prompt is acknowledged only in that temporary profile;
existing health-check tests remain in the full regression suite.

1.16.4 baseline gate results: type checking passed; lint passed with **0 errors and the
existing 38 warnings**; **140 test files / 1815 tests passed**; production build
passed. Intentional invalid CRS/geometry and transformation fixtures emit R
warnings; these are assertions of failure handling, not unreviewed failures.

Measured Linux machine: kernel 7.2.8-zen1-2-zen, x86_64 Intel i5-11500H, 12 logical
CPUs, approximately 15 GiB RAM. The final complete 8192-point app scan took
48994 ms, reported partial progress and recorded 4898 renderer 10-ms timer ticks.
A separate 8192-feature fixture cancels after a partial chunk. A built-app
cancellation run also stopped an 8192-feature scan after 256 rows without
permission to execute. Repeated scan timings vary with the local workload;
use the script output for a current measurement. These are actual
local tests, not a universal speed guarantee. Windows/macOS execution and
packaged installer testing were unavailable and are not claimed. Windows uses
cooperative cancellation: its child-process SIGINT would terminate R, so native
interruption is disabled there. A long native call may finish before the cancel
request can be processed; the cancelled job still has no execution permission.
Automatic Check and run uses the same visible progress/cancel panel and discards
its updates when the request changes. The Windows guard is unit-tested, not a Windows platform execution claim.

Installed verification stack: R 4.6.1, sf 1.1.1, units 1.0.1, dplyr 1.2.1,
sfarc 0.5.0, geos 0.2.5, DuckDB 1.5.4, GEOS 3.14.1, GDAL 3.13.3, PROJ 9.8.1. The machine's existing S2
1.1.11 could not load because of an Abseil shared-library mismatch; it initially
produced honest uncheckable/blocked geographic checks. Geographic acceptance
used S2 1.1.13 built in the ignored local `.cache/preflight-r` library with
bundled Abseil. The normal user library was unchanged during that original
acceptance run. The [1.16.12 Buffer investigation](toolbox-buffer-fix.md) later
repaired this machine's active S2 installation and verified the normal library
in both development and built app modes. Actual installed
versions/resources determine supported execution; strict transformation needs
GDAL ≥3.3, and a working S2 library is required for the advertised geographic
path. Other vector format reads were regression checked through the existing
code/test suite, not exercised as an exhaustive all-driver import matrix.

## Manual QA

1. Load a supported vector; open its table and Data checks. Check CRS, units,
   geometry counts, fields and source identities; toggle the panel in a short
   pane and confirm the header/table remain accessible.
2. Inspect a missing-CRS layer's attributes. Buffer/map should block. Assign
   the known CRS explicitly to a copy, confirm unchanged coordinates, then
   transform to a chosen target and inspect the changed copy.
3. Buffer geographic input by 100 metres with S2; inspect the labelled method.
   Choose a projected working CRS and review the coordinate change. Edit the
   distance/selection after checking and confirm permission invalidates.
4. Join A/B/C to A/A/D. Many-to-one should block; explicitly choose one-to-many,
   review four predicted rows, approve, and inspect source trace and console R.
   Cancel the review and confirm no new result. Test character leading-zero keys.
5. Summarise missing/non-finite values: default block, then deliberate omit or
   propagate with counts. Inspect invalid/empty geometry, show affected reasons,
   and select affected features. Explicitly exclude only supported rows with a
   reason; excluding every row must block.
6. Start a larger check, observe partial progress, cancel, and rerun. Confirm
   the existing Settings → Health check still opens and the original imported
   data/previous result remain intact on failure or denial.

## Library semantics used

- [sf CRS assignment](https://r-spatial.github.io/sf/reference/st_crs.html)
- [sf transformation and failure/axis semantics](https://r-spatial.github.io/sf/reference/st_transform.html)
- [sf buffer units and S2/GEOS paths](https://r-spatial.github.io/sf/reference/geos_unary.html)
- [sf validity and repair semantics](https://r-spatial.github.io/sf/reference/valid.html)
- [PROJ distinct foot conversion factors](https://raw.githubusercontent.com/OSGeo/PROJ/master/src/units.cpp)
- [GDAL GeoJSON profile/options](https://gdal.org/en/stable/drivers/vector/geojson.html)

These explain engine semantics; they do not certify arbitrary data, an installed
version's preservation capabilities, or the scientific suitability of a method.

## Changed files

- [.gitignore](../.gitignore)
- [CLAUDE.md](../CLAUDE.md)
- [README.md](../README.md)
- [docs/data-checks.md](../docs/data-checks.md)
- [electron/main/data-preflight.test.ts](../electron/main/data-preflight.test.ts)
- [electron/main/data-preflight.ts](../electron/main/data-preflight.ts)
- [electron/main/index.ts](../electron/main/index.ts)
- [electron/main/r-bridge.ts](../electron/main/r-bridge.ts)
- [electron/preload/index.ts](../electron/preload/index.ts)
- [electron/preload/types.d.ts](../electron/preload/types.d.ts)
- [eslint.config.mjs](../eslint.config.mjs)
- [package-lock.json](../package-lock.json)
- [package.json](../package.json)
- [r/lib/data-preflight.R](../r/lib/data-preflight.R)
- [r/lib/db-core.R](../r/lib/db-core.R)
- [r/lib/handlers-spatial.R](../r/lib/handlers-spatial.R)
- [r/lib/router.R](../r/lib/router.R)
- [r/server.R](../r/server.R)
- [scripts/check-data-preflight.mjs](../scripts/check-data-preflight.mjs)
- [src/components/editor/DataFrameView.tsx](../src/components/editor/DataFrameView.tsx)
- [src/components/editor/LoadDataDialog.tsx](../src/components/editor/LoadDataDialog.tsx)
- [src/components/toolbox/DataChecksPanel.test.tsx](../src/components/toolbox/DataChecksPanel.test.tsx)
- [src/components/toolbox/DataChecksPanel.tsx](../src/components/toolbox/DataChecksPanel.tsx)
- [src/components/toolbox/toolboxBuilders.tsx](../src/components/toolbox/toolboxBuilders.tsx)
- [src/components/toolbox/tools-linearize.test.ts](../src/components/toolbox/tools-linearize.test.ts)
- [src/components/toolbox/tools.ts](../src/components/toolbox/tools.ts)
- [src/lib/ai-actions/data.ts](../src/lib/ai-actions/data.ts)
- [src/lib/ai-actions/targets.ts](../src/lib/ai-actions/targets.ts)
- [src/lib/ai-actions/toolbox.ts](../src/lib/ai-actions/toolbox.ts)
- [src/lib/ai-skill-ourgeo.ts](../src/lib/ai-skill-ourgeo.ts)
- [src/lib/data-preflight-authority.test.ts](../src/lib/data-preflight-authority.test.ts)
- [src/lib/data-preflight-types.ts](../src/lib/data-preflight-types.ts)
- [src/lib/data-preflight.test.ts](../src/lib/data-preflight.test.ts)
- [src/lib/data-preflight.ts](../src/lib/data-preflight.ts)
- [src/lib/load-data-code.ts](../src/lib/load-data-code.ts)
- [src/lib/load-data-preflight.test.ts](../src/lib/load-data-preflight.test.ts)
- [src/lib/r-client.ts](../src/lib/r-client.ts)
- [src/store/selection.ts](../src/store/selection.ts)
- [tests/fixtures/preflight/README.md](../tests/fixtures/preflight/README.md)
- [tests/fixtures/preflight/acceptance.R](../tests/fixtures/preflight/acceptance.R)
- [tests/fixtures/preflight/keys.csv](../tests/fixtures/preflight/keys.csv)
- [tests/fixtures/preflight/survey.geojson](../tests/fixtures/preflight/survey.geojson)
- [tsconfig.node.json](../tsconfig.node.json)
