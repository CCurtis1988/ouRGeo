# Buffer transport and toolbox regression investigation

Version 1.16.12, verified on this Linux machine on 10 October 2026 (America/Los_Angeles).

## Reproduced failure and provenance

The reported case was three sf points in the default geographic CRS, launched
with `npm run dev`. An isolated development renderer reproduced
`Check failed: Network Error` on `/preflight/start`. Chromium's network log
recorded `net::ERR_INVALID_HTTP_RESPONSE`, not an unavailable internet service.

The preceding CORS OPTIONS response was `204 No Content` with
`Content-Encoding: gzip` and `Transfer-Encoding: chunked`. The R helper returned
`body = ""`; httpuv treated that as a real body and compressed it. Those bytes
are forbidden after a 204's headers and corrupt the next response on a reused
connection. `body = NULL` makes httpuv send no body or body-framing headers.
This matches [HTTP 204 semantics](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.5)
and [httpuv's response-body contract](https://github.com/rstudio/httpuv/blob/main/src/webapplication.cpp).

| Change | Provenance | Relationship to the report |
|---|---|---|
| Empty-string CORS body | `f158e3b`, 24 August 2026, initial 1.8.0 release | The malformed-response bug already existed. |
| Controlled toolbox checks | `1710975`, 3 October 2026, release 1.16.4 | Buffer now sends selection, start, status and execution requests; the additional CORS routes expose the connection-framing bug. |
| Escaped JSON validation preview | `1710975`, release 1.16.4 | The displayed `dq_validate(fromJSON(...))` was a read-only validation request, not a buffer operation. |
| Fully matched right/full join failure | `1710975`, release 1.16.4 | Appending `cbind(NA_integer_, integer())` produced a one-column matrix; the join planner could not combine it with two-column match pairs. |

Filter and mutate use the ordinary execution endpoint and do not follow the
multi-route controlled-check sequence. Their success did not establish that the
CORS responses were valid. A projected-point test in the built renderer also
succeeded before the fix; reproducing the development renderer's gzip
negotiation was necessary.

A second local fault became visible once HTTP framing was fixed: the active S2
1.1.11 package could not load because
`libabsl_flags_internal.so.2605.0.0` was missing. Geographic validation needs
S2, while the previous buffer path could automatically project before buffering.
The 1.16.4 acceptance report had already documented this machine's broken S2
library; the checks did not break the installed package. The exact date of the
system-library incompatibility is not established.

## Changes

- Return a genuinely bodyless CORS response, retaining the existing allowed
  origins, methods and headers.
- Display a readable R list under **Data Check Code** before validation. After
  checking, show the backend's resolved **Code Preview**, including the buffer
  function, method, working CRS and distance. Recorded `dq_run` code uses that
  same request and retains its fingerprint, approved choices and output
  environment. Changing a request still invalidates permission.
- Include the actual S2 loader failure and repair route in failed geographic
  checks. Health check lists s2, units and openssl explicitly.
- Remove the duplicate native-CRS option introduced by replacing the old
  automatic-CRS choice.
- Append unmatched right join rows only when such rows exist. Right/full joins
  with completely matched right inputs now work.
- Return the actual checked output class. SF tables and measurements open in
  their appropriate viewers. Native sfc/geos geometry vectors remain in
  Environment rather than opening a data.frame endpoint that cannot read them.

The active S2 package in `/home/roosteyr/Documents/myRlibs` was backed up to
`.cache/s2-before-buffer-fix.tar.gz`, then replaced through `R CMD INSTALL` with
the already available S2 1.1.13 binary built on this machine with bundled Abseil.
The binary was first installed and tested in an isolated temporary library.
The normal R startup now loads S2 successfully; final native checks use that
normal library, with no test-library override. No R profile was changed.

## Verification

`npm run typecheck` passed; lint reported zero errors and the existing 37
warnings; the full suite passed 2,412 tests in 233 files. `npm run build` passed.

The real-server regression check is:

```sh
node scripts/check-toolbox.mjs
```

It uses the actual toolbox registry, builders and controlled request builder,
and executes all 94 shipped operations on small local fixtures: 11 table tools,
8 join/combine tools, 5 aggregate/reshape tools, 8 type/string tools, 17 sf tools,
11 geos tools and 34 raster tools. It separately reads gzip-negotiated OPTIONS
responses for all six checked-operation routes and asserts that each 204 ends
at its headers with no compression or body-framing headers. Fetch-only tests
would miss this failure because they do not generate browser CORS preflights.

Independent checks include three 100-metre geographic point buffers, 100-metre
projected buffer extents, a 3–4–5 metre distance/length fixture, 100 m² squares
with a 50 m² overlap and 150 m² union, completely matched right/full joins,
filter/mutate values, raster arithmetic and aggregation dimensions. Source
attributes, point coordinates and raster values remain unchanged. The existing
R acceptance fixtures also cover selection/revision invalidation, missing CRS,
invalid geometry, unit conversion, approximation review, cancellation, native
approval authority and recorded-code replay, including a custom output
environment. The S2 covering-cell area test uses a bounded approximation
interval, not an exact-circle or ellipsoidal accuracy claim.

For real app checks, build first, then run:

```sh
node scripts/check-toolbox-ui.mjs
node scripts/check-toolbox-ui.mjs --dev
```

Both modes use isolated app profiles and synthetic objects. Each verified the
reported three-row geographic Buffer case, a projected buffer, an area vector
in its correct viewer, and a dissolved geometry result retained in Environment.
Both recorded zero failed preflight requests. The generated preview/result
screenshots were opened and visually inspected.

Installed verification stack: R 4.6.1, sf 1.1.3, sfarc 0.5.1, s2 1.1.13,
geos 0.2.5, terra 1.9.34, units 1.0.1, dplyr 1.2.1, httpuv 1.6.17,
GEOS 3.15.0, GDAL 3.13.3 and PROJ 9.8.1.

This is Linux execution evidence. Windows/macOS, every possible tool parameter,
every CRS/driver, large-data performance and arbitrary imported datasets were
not re-tested by this fix. Data-check scope and existing unsupported curved/Z/M
analysis rules remain documented in [data checks](data-checks.md).
