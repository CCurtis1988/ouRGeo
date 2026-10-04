# Data checks fixtures and discovery

The product integrates vector reads through `src/lib/load-data-code.ts` and
`LoadDataDialog.tsx` (GeoJSON, Shapefile, KML/KMZ, GPKG/GML/DXF/GPX/FGB), CSV and
other existing attribute reads, toolbox definitions in `tools.ts`, the GUI
`ToolForm` and AI `runToolboxTool`, and R routes in `r/lib/router.R`. Recording
uses console input entries and the existing recorder. Selection identities use
`accessPath::envName` and zero-based source rows; database datasets use their
existing proxy/primary keys. Project persistence keeps source R objects.

Already shipped: calculation CRS settings, unit selectors, optional curve
linearisation, sf/sfarc execution, map reprojection, row selection, editing,
import previews, and the first-run installation health check. Missing: a shared
backend data preflight, enforced consent, join-cardinality previews and explicit
summary missing-value policy. These are the integration targets.

There is no controlled vector-file exporter/publication handler: the only
`st_write` in the product is the temporary GeoJSON used by map display.
GeoPackage/GeoJSON export requirements are exposed as a blocked missing
integration; driver readback/staged publication tests are not advertised as
executed. Image/R-code export, .RData, .Rgeo and forum documents are different
workflows. No Desktop-to-Server bridge is added.

Fixtures in `acceptance.R` are synthetic and local. Independent expectations:
- Projected EPSG:32610 points differ by 3 m and 4 m: Pythagoras gives 5 m.
- Two 10 m squares overlap by 5 m × 10 m: areas 100 and 50 m².
  Absolute tolerance 1e-8 applies only to these simple planar fixtures.
- 10 international feet = 3.048 m; 10 US survey feet = 12000/3937 m
  = 3.048006096012192 m. Absolute tolerance 1e-12.
- A/B/C left keys against A/A/D right keys give four left-join rows,
  two unmatched left source rows and one unmatched right source row.
- Geographic buffers use the advertised S2 spherical metric method; distances
  are compared with independent haversine arithmetic at the engine's documented
  mean Earth radius, not a projected-ground accuracy claim.

No source coordinates are inferred from magnitudes. Missing CRS is inspectable
but spatial use is blocked. A custom valid WKT needs no EPSG identifier.


`keys.csv` independently specifies character keys `01`, `1`, empty and NA in
four separate rows. The import test selects character before numeric inference;
the blank-key row has a second column so it is not a blank source line.
Additional acceptance fixtures cover NA curve validity, preserved assignment,
XYZ blocking, exact sfarc versus reviewed polygon output, native geos semantics,
engine restoration with S2 initially disabled, recorded-R replay, and existing
DuckDB primary-key order using an installed spatial extension only.

See [the complete support and verification report](../../../docs/data-checks.md)
for actual versions, commands, machine/progress measurements, acceptance gaps
(especially absent vector-file export), and manual QA. R tests require the
spatial packages and DuckDB extension named there; no package/extension download
occurs inside validation or tests. The optional local test S2 library is used
only when already present. These fixtures do not claim other platforms or every
existing driver was exercised.

`survey.geojson` is a hand-written two-point RFC 7946 fixture: longitudes
-123/-123.0001, latitudes 37/37.0001, keys A/B. The real shipped import builder
and sf driver are exercised with unchanged inspection; absolute coordinate
tolerance 1e-12 degrees applies to these literal read coordinates only.
