# Data inspection, controlled preflight and vector export

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

## Data inspection and controlled preflight

`r/lib/data-preflight.R` owns version-1 reports and the asynchronous
`/preflight/{start,status,cancel,rows,selection,execute}` routes. Inspecting
copies is separate from operation permission: incomplete/failed geometry tests
remain uncheckable, missing CRS permits attributes, and raw unknown-CRS geometry
cannot be mapped or used as metres. SHA-256 covers the materialised content,
selection, parameters, working CRS/method, exclusions, policy and previous output
revision. Existing database PK order is retained only by the new opt-in
`keep_identity` materialisation; no second catalogue exists.

The GUI `ToolForm` and AI `runToolboxTool` use the same checked-operation list
in `src/lib/data-preflight.ts`. Before checking, Data Check Code displays a
readable R list passed to `dq_validate`. A complete permitted report supplies
`executionCode` from `dq_execution_code`, the same backend-owned R recorded by
`dq_commit`. Its literal request retains names, types, fingerprint, choices and
output environment; approval-required previews cannot manufacture consent.
`dq_commit` revalidates and assigns a derived result only after
success. Full local identity/exclusion records accompany the result in
`ourgeo_validation`; joins additionally carry `ourgeo_trace`. Recording echoes
the backend's actual `dq_run` request, fingerprint and choices, not the form's
legacy raw builder. Arbitrary user-authored R remains outside this boundary.

The development renderer negotiates gzip with httpuv. A CORS `204` response
must use `body = NULL`, not `""`: httpuv compresses the latter and sends forbidden
chunks that Chromium treats as the next keep-alive response. Buffer's multiple
checked routes exposed this as `ERR_INVALID_HTTP_RESPONSE` / Axios Network Error.
Keep this wire-level regression in `scripts/check-toolbox.mjs`; fetch-only R
fixtures never exercise browser OPTIONS requests. The same script executes all
94 shipped builders and independent numeric expectations. The isolated-profile
`scripts/check-toolbox-ui.mjs` verifies Buffer and result viewing with either the
built renderer or `--dev`, using the normal R library. See
`docs/toolbox-buffer-fix.md` for provenance and actual local coverage.

Checked execution returns the real output class. SF tables and unit-bearing
measurements open in their appropriate viewers; sfc/geos geometry vectors stay
in Environment rather than being sent to the data.frame-only endpoint. Failed
geographic validity reports include the S2 loader error and Health check repair
route. Health check lists s2, units and openssl explicitly: sf can load while
its suggested S2 dependency has a broken system-library link.

Renderer-supplied acknowledgment strings are not authority. The main process
fetches the immutable report from its R bridge and obtains consent through an
OS dialog. A private session secret held in a closure (not the inspectable job-state
environment) and sent only on that channel binds issue IDs
to the exact fingerprint. It is never exposed in preload, code recording or
reports. An unchanged approved plan reuses consent; changed data or destination
objects require new validation. The interrupt IPC only targets the currently
marked preflight job. Temporary S2/axis/network settings restore on exit.

Assignment is metadata only and explicitly reviewed; transformation is a
separate derived copy with installed-resource checks, no ballpark/partial/grid
network fallback, count/dimension/new-empty/non-finite checks. Spatial imports
keep the native layer and use this path for a requested target CRS. Geography
uses explicit S2 metres; projected operations convert units. Native geos tools
retain element-wise geos semantics and CRS-bearing geos results. SF buffer
reports sfarc exact arcs versus an approved GEOS polygon approximation.
Unsupported curved/Z/M analysis blocks instead of coercing it. Checked
operations cannot consume an unevaluated pipe or implicit viewport subset.

`r/lib/vector-export.R` implements controlled GeoPackage and RFC 7946 GeoJSON
file export through the same approval authority. `dq_commit` starts an async
write → readback → publish job. Each native stage yields before the next,
including a cancellation boundary before publication. The renderer polls its
actual phase; only a successful final result records `dq_export_run` in R.
Same-directory staging, per-destination app locks, input/destination/staged-file
hashes, and closed SQLite companion checks protect previous files. New files use
exclusive hard links; replacement uses rename without unlinking the old file.
An unsupported/locked filesystem fails safely. There is no cross-application
locking promise: external writers must close the destination. Existing raster
or unknown-content GeoPackages block updates under this vector-only profile.

The Data Viewer Export layer dialog and `data:exportVector` share
`lib/vector-export.ts`; the AI action takes an explicit path and opens no file
picker. Field omission/text conversion, GeoJSON projection/precision/Z semantics
and named-layer replacement require exact review. GPKG readback compares exact
ordinates and primitive attributes, plus unrelated layers and their FIDs.
GeoJSON compares its explicit decimal profile, ring orientation/start allowance,
and documented 4326/4979 readback representation; Z needs declared WGS 84 3D.
Curves/M block GeoJSON, while tested GPKG canonical curves/Z/M are retained.
Imported vectors record `ourgeo_source_files` so controlled export cannot replace
tracked originals. Rich fields never disappear through writer defaults.
Complete local row records are session-scoped in `dq_state$exportRecords` (32
records); no sidecar, second catalogue or telemetry is added. App crashes can
leave a private staging directory/lock; do not automatically remove a lock that
another app instance may own. Manual stale-lock removal is deliberate.

The map's display GeoJSON, raster exporter, image export, RData and Rgeo persistence
remain separate paths. No Server publication bridge exists. Full scope,
acceptance coverage and limits are in `docs/vector-export.md`,
`docs/vector-export-spec.md` and `tests/fixtures/preflight/export.R`. The shipped
first-run health check retains its existing lifecycle.
