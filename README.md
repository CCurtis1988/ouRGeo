# ouRGeo

**An open-source desktop spatial IDE — ArcGIS Pro meets RStudio.**

ouRGeo wraps R's spatial ecosystem (`sf`, `terra`, `ggplot2`, `tmap`) in a
full-featured GUI while keeping R at the core. It has a map canvas, a layers
panel, an 87-tool geoprocessing toolbox and a CAD-grade digitizing environment —
and **every GUI action emits the R code that performs it**, straight into the
console.

Your point-and-click session is, transparently, an R script being written for
you. Turn on recording and you walk away with a runnable script that reproduces
the whole analysis.

- Website: [ourgeo.dev](https://ourgeo.dev)
- Documentation: [ourgeo.dev/docs.html](https://ourgeo.dev/docs.html)
- Community forum: [ourgeo.dev/forum.html](https://ourgeo.dev/forum.html)

---

## What it does

- **Exact curved geometry.** Ships with `sfarc`, which computes length, area,
  centroid, buffer and overlays on true `CIRCULARSTRING` / `COMPOUNDCURVE` /
  `CURVEPOLYGON` geometry analytically — no densification, no linearization
  error. Curves imported from Esri services are rebuilt as true OGC curves so
  they stay exact end to end.
- **87-tool geoprocessing toolbox** across seven categories (table, joins,
  aggregate, type/string, sf, geos, raster), each one generating clean R.
- **First-class rasters.** R-served XYZ tiles with a full symbology editor —
  singleband/RGB/categorical, stretches, colour ramps, histograms.
- **Data Connector.** 14 web-API providers (Esri, OGC API–Features, WFS, WMS,
  WCS, STAC, CKAN, Socrata, ERDDAP, SDMX, OData, Macrostrat and more) with a
  visual query builder that emits reproducible import code.
- **In-app AI assistant** with optional Autopilot, usable with cloud providers
  or a fully local model.
- **Publication export.** Generate complete `ggplot2` or `tmap` code from your
  on-screen map, including legend, north arrow, scale bar and graticules.
- **Portable projects.** Save code, environment, layers and databases as a
  single `.ourgeoproj` bundle.
- **No telemetry, no account, no cloud dependency.**

## Documentation

Full end-user documentation lives at
[ourgeo.dev/docs.html](https://ourgeo.dev/docs.html) — a panel-by-panel
interface reference, the complete toolbox catalogue with every parameter, data
import and connector guides, and the map/drawing/export reference.

For the codebase architecture, see [CLAUDE.md](CLAUDE.md).

## Requirements

- **Node.js** v18 LTS or newer, and **npm**
- **R** v4.0 or newer
- R packages:

  ```r
  # Core — required for the app to start at all
  install.packages(c("httpuv", "jsonlite", "later", "httr2"))

  # Spatial features — maps, geoprocessing, basemaps
  install.packages(c("sf", "terra", "ggplot2", "tmap",
                     "ggspatial", "maptiles", "tidyterra"))

  # Raster map tiles (PNG encoding)
  install.packages("png")

  # Exact curved geometry
  install.packages("sfarc")

  # Database features (.Rgeo / DuckDB-backed datasets)
  install.packages(c("DBI", "duckdb", "dplyr"))
  ```

## Installation

### 1. Install Node.js and npm

**Arch Linux:**
```bash
sudo pacman -S nodejs npm
```

**Other distros / macOS / Windows:** download from [nodejs.org](https://nodejs.org)

### 2. Install R

**Arch Linux:**
```bash
sudo pacman -S r
```

**Other platforms:** download from [cran.r-project.org](https://cran.r-project.org)

### 3. Install the R packages

Open an R session and run the blocks under [Requirements](#requirements) above.

### 4. Install npm dependencies

```bash
npm install
```

### 5. Run it

```bash
npm run dev
```

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Start Electron + Vite dev server |
| `npm run build` | Production build |
| `npm run package` | Build and package with electron-builder |
| `npm run package:linux` | Package for Linux only |
| `npm run package:win` | Package for Windows only |
| `npm run typecheck` | TypeScript check (both tsconfig projects) — the primary correctness gate |
| `npm run lint` | ESLint |
| `npm run test` | Vitest suite |

`npm run typecheck` is the main correctness check; run it before opening any
change.

## Updating R

> **Important:** whenever you update R itself (for example after
> `sudo pacman -Syu` on Arch bumps R from 4.5 → 4.6, or after a Windows/macOS R
> upgrade), you **must rebuild every R package** you have installed. CRAN
> packages are compiled binaries linked against a specific R version — when R's
> ABI changes, loading a package built for the old version fails with errors
> like:
>
> ```
> unable to load shared object '.../rlang.so':
> undefined symbol: SETLENGTH
> ```
>
> ouRGeo will fail to connect to R when this happens, because `httpuv` cannot
> load.

### How to rebuild after an R upgrade

In a regular shell (not `sudo`):

```bash
R -e 'update.packages(ask = FALSE, checkBuilt = TRUE, repos = "https://cloud.r-project.org", Ncpus = 4)'
```

The `checkBuilt = TRUE` flag is critical — it forces reinstall of any package
built against an older R, not just packages with newer CRAN versions.

### Essential packages — rebuild these first

If `update.packages` is slow or partially fails, prioritise the packages ouRGeo
depends on directly:

```r
# Core — without these, ouRGeo cannot start
install.packages(c("httpuv", "jsonlite", "later", "httr2"))

# Spatial — without these, map rendering and spatial operations break
install.packages(c("sf", "terra", "ggplot2", "tmap", "ggspatial", "maptiles", "tidyterra"))

# Database — without these, .Rgeo / DuckDB features break
install.packages(c("DBI", "duckdb", "dplyr"))

# Tidyverse foundation — many of the above depend on these transitively
install.packages(c("rlang", "cli", "vctrs", "glue", "lifecycle"))
```

### Setting a CRAN mirror permanently

If `install.packages` complains about "trying to use CRAN without setting a
mirror," add this to `~/.Rprofile` (create it if it does not exist):

```r
options(repos = c(CRAN = "https://cloud.r-project.org"))
```

### Verifying the rebuild

```bash
Rscript -e 'library(httpuv); library(sf); cat("ok\n")'
```

If that prints `ok` with no errors, ouRGeo will start cleanly.

## Support

Questions, bug reports and feature requests all go to the
**[community forum](https://ourgeo.dev/forum.html)**. Reading is open to
everyone; posting takes a free account.

ouRGeo collects no telemetry, so a bug report is genuinely the only way the
project learns something is broken. The most useful reports include what you
did, what you expected, your OS / ouRGeo version / R version, and **the console
output** — because every action emits R, your console holds the exact command
that failed.

## Contributing

The most valuable contributions are bug reports, feature requests, and helping
other users — see [ourgeo.dev/contribute.html](https://ourgeo.dev/contribute.html)
for the full picture, including how to support development financially.

**For code changes: please open a discussion on the
[forum](https://ourgeo.dev/forum.html) before writing anything.** ouRGeo is
maintained by one person, and an unsolicited pull request may not be merged
regardless of quality — it might conflict with in-flight work, or with a design
direction that has not been written down yet. A short conversation first saves
your time as much as mine.

## License

ouRGeo is released under the **GNU Affero General Public License v3.0** — see
[LICENSE](LICENSE) for the full text.

In short: you may use, study, modify and redistribute ouRGeo freely, including
commercially. If you distribute a modified version — or run one as a network
service — you must make your changes available under the same licence. The same
licence the RStudio IDE uses, and chosen for the same reason: so that the
software stays open for everyone downstream.

ouRGeo drives R as a separate process. R itself, and the R packages ouRGeo uses
(`sf`, `terra`, and others), are distributed under their own licences by their
own authors.

## Project status

Actively developed. Windows and Linux builds are available from
[ourgeo.dev](https://ourgeo.dev/ourgeo-download.html); a macOS build is on the
roadmap.
