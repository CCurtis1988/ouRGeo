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

- **Exact curved geometry.** Built on [`sfarc`](https://github.com/CCurtis1988/sfarc),
  a companion R package that computes length, area,
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
- **Themes you own.** Ten app themes, 26 code palettes and 16 markdown
  palettes ship — and the **Theme Studio** lets you build your own on all three
  axes: every interface and editor colour, your own backdrop image behind the
  code, a card image for the picker, a default basemap, and import/export as
  portable `.ourgeotheme.json` files.
- **In-app AI assistant** with optional Autopilot, usable with cloud providers
  or a fully local model — it can drive the interface, run the toolbox, write
  R Markdown, rearrange your workspace, build a theme to your description, and
  **write plugins that add capabilities ouRGeo does not ship with**.
- **A workspace you arrange.** Four zones — left, centre, right and bottom —
  and any panel can go in any of them, split or tabbed, at whatever size you
  like. Settings → Workspace is where you move panels, save arrangements by
  name, export and import them as `.ourgeolayout.json` files, and restore the
  shipped default in one click. Turn on **Drag panels to rearrange them** and
  each panel grows a small grip in its top-right corner: drag it to drop the
  panel into another zone, or right-click it for that panel's menu. Panels
  sharing a zone share it equally — two take half each, three a third each —
  until you drag a divider; double-click one to even them out again.
- **Two code editors.** Open a second one for two documents side by side, each
  with its own tabs. Add it in Settings → Workspace, drag tabs between the two,
  and remove the extra when you are done — **removing never closes a document**, they move to the editor that
  remains. Only a panel you added can be removed; the ones ouRGeo ships are
  hidden and shown from the toolbar instead.
- **A real terminal.** Your own shell — bash, zsh, fish, PowerShell — as a tab
  beside the R console, with as many tabs as you like, full colour, search
  (Ctrl+Shift+F) and a font size that follows Ctrl+= / Ctrl+-. It opens in R's
  working directory, and the tab menu moves either side to the other: send R to
  the shell's directory (echoing `setwd()` to the console, like everything
  else), or type `cd` to R's. Colours follow your code theme; give it its own
  pane instead of a tab from Settings → Workspace. The AI assistant can use it
  too, behind its own switch in the panel footer that is **off until you turn
  it on** — every command it runs is typed into a tab you can watch and logged
  to your console.
- **Plugins.** Data connectors, geoprocessing tools, actions, toolbar buttons,
  panels and documentation, added while the app is running — no rebuild, and
  usually no code at all.
- **Talk to the assistant.** A microphone in the AI panel dictates into the
  message box, with a ring that shows it is hearing you and a live level meter
  in Settings to check you picked the right device. Transcription runs **on your
  machine by default** — Whisper, downloaded once on first use, no account and
  no network — or through a server you run, or Deepgram, ElevenLabs and
  AssemblyAI if you would rather. Anything that leaves your machine is recorded
  in the R console.
- **Environments you can actually work in.** A new environment sits beside
  `.GlobalEnv` in the panel, and its right-click menu has **Work in this
  environment** — R looks names up outwards and never into an environment, so
  without it `x` in `env2` is only ever `env2$x`. Working inside it, `x * a`
  just works, and the prompt shows where you are. The same menu exports,
  copies, renames and deletes; objects carry **Copy To** as well as **Move
  To**, and **Show** lists the environment inside `.GlobalEnv` instead if you
  prefer to see it where R keeps it.
- **One dataset, three views.** The Environment panel, the data viewer and the
  map are the same objects seen from three angles, and any of them gets you to
  the others: **Add to Map** in the data viewer's header sends a table to the
  spatial editor, and right-clicking a layer in **Contents** opens its attribute
  table. Sending something that is already on the map asks first, and offers to
  show you the layer you already have.
- **Publication export.** Generate complete `ggplot2` or `tmap` code from your
  on-screen map, including legend, north arrow, scale bar and graticules.
- **Portable projects.** Save code, environment, layers and databases as a
  single `.ourgeoproj` bundle.
- **No telemetry, no account, no cloud dependency.**

## Theming

Three independent axes, all in **Settings → Appearance**:

| axis | what it colours |
|---|---|
| **App theme** | the whole interface, the editor's background, the artwork behind the code, the map's default basemap |
| **Code theme** | syntax colours — R in `.R` files, and every embedded language in an `.Rmd` chunk |
| **Markdown theme** | prose colours — headings, links, quotes, inline code, in Source and Visual mode |

The separation is a guarantee, not a convenience: a code or markdown palette
carries token colours and *nothing else*, so switching one can never move the
editor background or the scene art behind it.

**Settings → Appearance → Theme Studio…** opens the editor. Every theme starts
as a copy of one that already works — pick the closest and change what you like:

- Sixteen colours for an app theme (ten interface, six editor surface), each
  labelled with what it actually paints, with live WCAG contrast warnings.
- The code and markdown palettes the theme defaults to, and the basemap the
  Spatial Editor opens with under it.
- **Your own backdrop image** behind the code editor, with its own opacity and
  grey-scale, plus a card image for the theme picker. PNG, JPEG, WebP, SVG, GIF
  or AVIF; both optional, and the artwork is embedded in the theme so an
  exported theme carries its own pictures.
- A live preview that updates as you type and does not touch the running app
  until you switch to the theme.

Themes export to `.ourgeotheme.json` and import back. The file declares which
axis it belongs to, so dropping an app theme into the code-theme list is
refused with a sentence naming what the file actually is and which tab takes it.

The AI assistant can do all of this too — ask it for "a warm low-contrast dark
theme" and it will build one across all three axes, check its own contrast
ratios, and switch you to it. A theme it makes is an ordinary theme: editable
in the Studio, exportable, and usable as a template like any other.

## Extending ouRGeo

ouRGeo can gain capabilities it did not ship with, without being rebuilt.

**A plugin** is a folder with a manifest. Most are pure JSON: a data connector
for an API nobody has written one for, a geoprocessing tool, an action, a
documentation topic the assistant then knows about. A plugin can also ship an
R file that is sourced into your session, or TypeScript that ouRGeo compiles
when it loads — but the JSON path covers the common cases, and needs no trust
decision from you at all.

**Ask for one in prose.** "Add a connector for the NOAA tides API" is a
request the assistant can carry out: it probes the API to learn its shape,
writes the spec, tests it against the real server, and asks you to turn it on.
What it produces is an ordinary plugin — editable, exportable as a
`.ourgeoplugin` file, and removable from **Settings → Plugins**.

> **A plugin that ships code runs inside ouRGeo, with everything ouRGeo can
> do.** ouRGeo confines a plugin's file access and hides the application's
> internals from it, but that is a guard against accidents, not against intent.
> Enable one the way you would run `install.packages()`: because you know where
> it came from. Plugins arrive switched **off**, and a declarative plugin —
> the common case — runs no code at all.

**Changing ouRGeo itself is a different thing**, and it is not possible on an
installed copy: the interface ships as one compiled bundle inside a read-only
archive, and nothing on your machine can rebuild it. For that, clone the
repository and run it from source — see [Development](#development) below, and
[docs/AGENTS.md](docs/AGENTS.md) for the house style if you are pointing an AI
coding agent at it.

## Documentation

Full end-user documentation lives at
[ourgeo.dev/docs.html](https://ourgeo.dev/docs.html) — a panel-by-panel
interface reference, the complete toolbox catalogue with every parameter, data
import and connector guides, and the map/drawing/export reference.

For the codebase architecture, see [CLAUDE.md](CLAUDE.md). For the conventions
a change to this repository should follow — by a person or an agent — see
[docs/AGENTS.md](docs/AGENTS.md).

## Requirements

- **Node.js** v18 LTS or newer, and **npm**
- **R** v4.1 or newer
- R packages:

  ```r
  # Core — required for the app to start at all
  install.packages(c("httpuv", "jsonlite", "later", "httr2"))

  # Spatial features — maps, geoprocessing, basemaps
  install.packages(c("sf", "terra", "ggplot2", "tmap",
                     "ggspatial", "maptiles", "tidyterra"))

  # Raster map tiles (PNG encoding)
  install.packages("png")

  # Exact curved geometry — not on CRAN yet, install from Git
  install.packages("remotes")
  remotes::install_github("CCurtis1988/sfarc")

  # Database features (.Rgeo / DuckDB-backed datasets)
  install.packages(c("DBI", "duckdb", "dplyr"))

  # Knitting R Markdown to HTML / PDF / Word.
  # Running chunks inline needs nothing extra — only knitting does.
  install.packages(c("knitr", "rmarkdown"))
  ```

  Knitting also needs **pandoc**, which is *not* an R package and does not ship
  with R (RStudio bundles its own copy). Either install it from
  [pandoc.org](https://pandoc.org), or:

  ```r
  install.packages("pandoc"); pandoc::pandoc_install()
  ```

  PDF output additionally needs a LaTeX installation:

  ```r
  install.packages("tinytex"); tinytex::install_tinytex()   # ~200 MB
  ```

  ouRGeo checks all of these before you knit and disables any format whose
  dependencies are missing, naming what to install — so you never hit a raw
  render error.

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

`sfarc` is the only one not yet on CRAN — it is in CRAN review, so for now it
installs from its Git repository. It is pure R — nothing to compile, so Windows
does not need Rtools. ouRGeo starts without it,
but has no curved-geometry support at all: a layer holding `CIRCULARSTRING` or
`CURVEPOLYGON` features will not draw.

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
