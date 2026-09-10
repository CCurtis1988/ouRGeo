# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ouRGeo** is a desktop spatial IDE — an open-source alternative to ArcGIS Pro — built with Electron. It wraps R's spatial ecosystem (sf, terra, ggplot2, tmap) in a dark-mode GUI while keeping R at the core. Every GUI-driven operation echoes its R code to the console.

## Development

```bash
npm install
npm run dev        # Start Electron + Vite dev server
npm run build      # Production build
npm run package    # Build + package with electron-builder
```

House conventions for anyone (or any agent) changing this repository are in
[`docs/AGENTS.md`](docs/AGENTS.md); `.claude/skills/ourgeo-feature/` loads them
automatically alongside the existing `run-ourgeo` driver skill.

TypeScript is the primary correctness check — run `npm run typecheck` from the repo root (it builds both the `tsconfig.node.json` and `tsconfig.web.json` projects). Run `npm run lint` for ESLint (flat config in `eslint.config.mjs`). A Vitest suite (`npm run test`, jsdom for component tests) covers codegen and a few components.

## R Dependencies

Must be installed in R before running:
```r
install.packages(c("httpuv", "jsonlite", "later", "httr2"))
# Spatial features also need: sf, terra, ggplot2, tmap, ggspatial, maptiles, tidyterra
# Raster map rendering also needs: png (tile encoding); ggplot raster export with
#   mixed fill scales additionally uses ggnewscale (emitted only when needed)
# Curved geometry (CIRCULARSTRING/COMPOUNDCURVE/CURVEPOLYGON) also needs: sfarc
# Knitting .Rmd also needs: knitr, rmarkdown (+ pandoc, which is NOT an R package
#   and R does not bundle — RStudio ships its own copy; PDF additionally needs a
#   LaTeX install, e.g. tinytex). Running chunks inline needs NOTHING extra —
#   it uses base eval + grDevices.
# Database (.Rgeo) features also need: DBI, duckdb, dplyr
```

The Data Connector's **Web APIs** tab generates import code with `httr2`/`jsonlite`
(tabular) and `sf::st_read` (geospatial — Esri/OGC/WFS/STAC), all covered above. No
extra packages are required; the idiomatic clients `RSocrata`, `esri2sf`, `rstac`,
`rerddap`, `rsdmx` are optional alternatives, not used by the generated code.

## Architecture

**Two runtime dependencies exist for one feature each.** `esbuild-wasm`
(~13 MB) compiles a plugin's TypeScript/JSX in the renderer at load time; it is
loaded by dynamic `import()` and its wasm is read over IPC, so a session with no
code plugins never touches it, and nothing else in the app compiles anything.
`@lydell/node-pty` (~160 KB installed) is the terminal's pseudo-terminal — the
only NATIVE dependency, and it needs no rebuild because node-pty is built on
Node-API, whose ABI is stable across Node and Electron. The speech engine is a
*development* dependency bundled lazily by Vite, and its model is downloaded
rather than shipped.

### Three-process model

```
Electron Main Process  (electron/main/)
  ├── r-bridge.ts     — Spawns Rscript, captures port from stdout, auto-restarts on crash
  ├── ipc.ts          — All IPC handlers: file dialogs, R management, plot popout
  ├── ai-proxy.ts     — Proxies AI-provider HTTP calls (ai:fetch/ai:chunk/ai:abort) so the
  │                     renderer keeps webSecurity enabled. Uses `net.fetch`, NOT
  │                     Node's global fetch — see "The transport" below
  ├── plot-window.ts  — Creates/updates a secondary BrowserWindow for plot popout
  └── index.ts        — BrowserWindow (1000×700); on resume/GPU-loss forces a
                         state-preserving repaint (invalidate + resize nudge) so
                         sleep doesn't leave a black screen; reloads only if the
                         renderer process itself dies. Emits `system:resume`.

Electron Renderer Process  (src/)
  ├── Connects to R over HTTP (rClient) and WebSocket (wsClient)
  ├── App.tsx detects window.location.hash === '#plot-popout' to render PlotPopoutView
  └── Full React UI (see Layout section below)

R Process  (r/server.R + r/lib/*.R)
  ├── server.R is a slim bootstrap: loads packages, sets up .ourgeo_env global
  │   state + the headless PNG device/viewer hooks, source()s every r/lib module,
  │   then binds the httpuv server on a random port (printed to stdout for r-bridge)
  ├── r/lib/router.R    — route() HTTP dispatch + ws_handler() WebSocket handler
  ├── r/lib/util-core.R, util-env.R — response/JSON helpers, env introspection
  ├── r/lib/util-raster.R, handlers-raster.R — raster tile engine: registers a
  │   SpatRaster as a map layer (gdalwarp to an EPSG:3857 COG under
  │   tempdir()/ourgeo-raster — the COG driver builds internal overviews, since
  │   sf::gdal_utils has no gdaladdo; plain-GTiff fallback for GDAL < 3.1),
  │   then serves styled 256px XYZ PNG tiles (per-tile gdalwarp window read →
  │   vectorized stretch/colormap → png::writePNG, bounded LRU of encoded
  │   tiles). Staleness sweep hooks broadcast_env_if_changed.
  ├── r/lib/handlers-*.R — endpoint handlers grouped by domain (exec, help, env,
  │   packages, object, spatial, data-widget)
  └── r/lib/db-*.R      — .Rgeo/DuckDB schema, connection, translators, /db handlers;
      db-raster.R = format-v3 raster tile pyramid (see Database section)
```

All `r/lib/*.R` modules are `source()`d into the global environment at startup, so
they share `.ourgeo_env` and reference each other by name at call time.

### R Server Endpoints

```
POST /session/init        — Load packages, check deps
POST /session/reset       — Clear user objects (keep system_names), DB conns, proxies
GET  /session/wd          — getwd() + path.expand("~"), for the console header
POST /session/setwd       — Move R's working directory (validates, broadcasts)
POST /r/execute           — Run arbitrary R code; captures PNG plots automatically.
                            `envir` (default .GlobalEnv) is the Environment panel's
                            "Work in this environment"; refuses a name that is gone
POST /r/plot/export       — Re-render last plot at a specific size/format
POST /r/plot-preview      — Render code to PNG for inline chart preview
GET  /health
GET  /env/list            — List objects in R environments
POST /env/{remove,rename,copy,move,create,save,load}
GET  /packages/list       — Installed packages
POST /packages/{load,unload,install,addlibpath}
GET  /packages/cran-list
POST /packages/check-version
POST /object/{function,dataframe,matrix,vector}  — Inspect R objects
POST /object/formals      — Formal argument names of a function (autocomplete)
GET  /spatial/list        — List sf/sfc/sfg + SpatRaster objects
POST /spatial/geojson     — Get GeoJSON for a spatial layer
POST /raster/info         — Band stats (sampled min/max/mean/sd/q02/q98), dims, CRS,
                            4326 extent — feeds the raster symbology editor
POST /raster/register     — Register a SpatRaster as a tiled map layer (warp+overviews);
                            re-register w/ same layerId = symbology-only restyle
                            (keeps warp, bumps version). Returns tileUrl/bounds/maxzoom.
POST /raster/unregister   — Drop a layer (evict tiles, delete warped temp file)
POST /raster/histogram    — Sampled histogram of one band (symbology editor)
GET  /raster/tile/{id}/{z}/{x}/{y}.png?v=N — Styled RGBA PNG tile (404 on stale version)
POST /data/preview        — Preview tabular data
POST /kaggle/files
POST /help/{search,doc,package,vignettes,vignette}
POST /selection/query
GET  /db/proxies          — Snapshot connected dataset proxies for a project save
POST /db/reconnect        — Reopen .Rgeo files + rebind proxies on project load
WS   /console             — Bidirectional; server broadcasts structured messages
```

### WebSocket Message Protocol

The R server broadcasts JSON via `/console`. The renderer's `wsClient` calls message handlers with `(type, text, data)`:

| `type`    | Meaning |
|-----------|---------|
| `stdout`  | Console text output |
| `stderr`  | Warnings / errors |
| `plot`    | PNG plot ready — `data` is a `data:image/png;base64,...` string |
| `widget`  | htmlwidget/help/vignette ready — `data.id` identifies the served file |
| `env`     | `.GlobalEnv` changed — `data` is the rebuilt `.GlobalEnv` entry (change-detected; keeps the Environment panel + autocomplete live) |
| `packages`| Installed/attached packages changed — `data.libraries` is the rebuilt library list (change-detected; keeps the Packages panel + `library()`/`require()` autocomplete live) |
| `wd`      | Working directory moved — `data.path`. Fires for a picker change AND for a `setwd()` buried in user code, so the console header can never go stale |
| `raster_layer_invalidated` | A registered raster map layer's backing R object changed or vanished — `data.layerId`; the renderer re-registers (fresh warp) or drops the layer |

In `App.tsx`, `type === 'plot'` triggers `usePlottingStore.getState().addPlot(data)` and forwards to the plot popout window via IPC.

## Layout & Panels

The UI is a single-page app with a toolbar + resizable panel system managed by `EditorLayout.tsx`. Panels are toggled by toolbar icon buttons and sized with drag dividers:

| Panel | Store | Component |
|-------|-------|-----------|
| Left: Code Editor + Console | `session`, `editor` | `CodeEditor`, `Console` |
| Left tab: Packages | `packages` | `PackagePanel` |
| Left tab: Environment | `environment` | `EnvironmentPanel` |
| Right: Spatial Editor (MapLibre) | `spatial` | `SpatialEditor` |
| Right: Plot Preview | `plotting` | `PlottingPanel` |
| Right: AI Chat | `ai` | `AiChatPanel` |
| Right: Help | `help` | `HelpPanel` |

### Console I/O Design

- Code execution: `POST /r/execute` (HTTP) — one response per request
- `POST /r/execute` also broadcasts captured plot PNGs via WebSocket after execution
- Frontend adds `input` entries locally (immediate feedback); R server does NOT echo `> code`
- `Ctrl+Enter` runs a single line from Monaco and advances cursor
- `Shift+Enter` runs selected lines

### Working directory (`src/lib/working-dir.ts`, `console/WorkingDirBar.tsx`)

The directory is shown in the console header, beside "R Console" and the
connection dot — next to where relative paths are typed, because that is what it
governs. The path IS the control: clicking it opens the one menu that changes it
(native folder picker), copies it, opens it, re-reads it, or jumps to a recent
one (`working-dirs.json`, persisted, max 8).

- **R owns the value.** The store is set from the server's own `getwd()`, never
  from what the picker was told to do, and `broadcast_wd_if_changed()` runs
  beside the env/package sweeps after every execution — so a `setwd()` typed
  into the console moves the label exactly as the dialog does.
- `POST /session/setwd` rather than `execute('setwd(…)')`, so a bad path is a
  result the menu can show instead of stderr the user has to go and read. The
  console still gets the `setwd()` line — every GUI operation echoes its R.
- **R starts in the user's home directory** (`r-bridge.ts`), not in `r/`. The
  cwd is what every relative path in the session means, and pointing it at
  ouRGeo's own program directory aimed `ggsave()` at the install — inside
  `resources/` in a packaged build. `server.R` is therefore spawned by ABSOLUTE
  path: it resolves its module directory from `--file=`, which R reports
  verbatim, so a bare `server.R` would normalize against the new cwd.
- `elidePath` drops whole segments from the middle (`/home/…/Projects/ourgeo`),
  never mid-word — a path cut at `/home/roos…` reads as a different directory.
  Measured on a canvas in the element's own font, because `text-overflow`
  removes the END, which is the part that names the directory. The measured box
  needs `flex-1`: content-sized, it measures the elided string rather than the
  space available, and the label shrinks once and never grows back.

## The Environment panel (`src/lib/environments.ts`)

The panel shows R's environments, and R's own shape is not the one a user
thinks in. Seven rules reconcile them, and the pure ones live in one module so
they can be tested without a session.

- **An environment the user made is an object AND a place, and the user says
  which one the panel draws.** `myenv <- new.env()` puts an environment
  *inside* `.GlobalEnv`, which is where R keeps it and what `save()`, `rm()`
  and `ls(.GlobalEnv)` see; but it is usually made to *be* somewhere, and a
  place is a sibling of `.GlobalEnv`, not a row three levels into it.
  `EnvPlacement` is per environment: `promoted` (a group beside `.GlobalEnv`
  and no row — the default) or `child` (the row).
- **`placement` is NOT R's `parent`, and must never be labelled as if it
  were.** `new.env(parent = …)` sets the ENCLOSURE — where R keeps looking
  when a name is not found inside — and every environment ouRGeo creates has
  `.GlobalEnv` there, so they all behave identically. The New Environment form
  briefly offered "Child" and "Parent" for the *display* setting; a user made
  one of each, watched ouRGeo emit the same `new.env(parent = .GlobalEnv)`
  twice, and asked what the difference was. There isn't one, and there is no
  second kind worth offering: the only other sensible parent is `emptyenv()`,
  in which even `*` cannot be found. The form no longer asks; the menu says
  "Beside .GlobalEnv" / "Inside .GlobalEnv", which is what it does.
- **One listing or the other, never both.** An environment drawn twice is a
  panel inviting the user to wonder whether there are two of them, so
  `panelEnvironments` keeps the row XOR emits the group, and
  `treeEnvironments` — what the panel maps over — drops the child entries.
  They stay in the list `moveTargets`, `loadTargets` and the Export dropdown
  read, because a child environment is still somewhere objects go. The
  consequence to hold on to: **the row has to carry everything the group
  carries** (Export…, Show, Make Copy, Rename, Remove, Move To), or choosing
  "inside" would quietly cost the user the ability to export it or move it
  back. `placement-menu.ts` is that shared submenu, and `env-export.ts` the
  shared export, precisely so the two menus cannot drift.
- **What is lifted out is still in the file.** `save(list = …, envir =
  .GlobalEnv)` writes environments too, so `PanelEnv.hoisted` carries the names
  promotion dropped from the listing and `exportedNames` adds them back —
  otherwise the echoed `save()` named fewer objects than the file it wrote.
  `userOnlyView` filters `hoisted` by the same hidden set as `objects`, or
  exporting `.GlobalEnv` would name ouRGeo's own `server` environment that the
  file (written with `excludeSystem`) leaves out.
- **Working IN an environment is the answer to the wall R puts up**
  (`src/lib/working-env.ts`). R resolves a name outwards — the evaluation
  environment, its enclosure, the search path — and never into an environment
  sitting in `.GlobalEnv`. So the moment `x` is moved into `env2`, `x * a` at
  the prompt is an error, and `env2$x` / `with(env2, …)` are the only ways in.
  That is correct R and a wall for anyone who has just found environments.
  `setWorkingEnv` points `/r/execute` at the environment (`body$envir` →
  `resolve_env` → `eval(..., envir = eval_env)`), and since its enclosure is
  `.GlobalEnv` the user gets both: `x * a` is 6, exactly as `evalq(x * a,
  env2)`. The setting lives on `rClient` as well as the store because the
  console, the toolbox and the assistant all run R through `rClient.execute` —
  a tool writing its result into `.GlobalEnv` while the user works in `env2`
  would put the object where they are not looking. Switching echoes a runnable
  `evalq({ … }, env2)` rather than a sentence about one: no R command moves the
  prompt, so the honest echo is the thing ouRGeo now does to every command —
  and `evalq` is also the idiom the user needs outside ouRGeo, in a script or a
  chunk. It is shown ON the prompt, not in a menu, and `pruneWorkingEnv` (called from `setEnvironments`, the one
  choke point every refresh passes through) drops it when the environment goes
  away, rather than letting the next command fail with a name the panel no
  longer shows.
- **The panel says how to reach an object, at the moment it becomes hard to
  reach.** Creating an environment echoes two comment lines naming `name$x`,
  `with(name, …)` and "Work in this environment"; the object menu carries
  **Copy To** beside **Move To** (same name, other environment, original kept),
  because setting an environment up to work in is usually copying, not moving.
- **The placement choice persists.** Stored sparse (only what was moved off the
  default) in `environment-preferences.json`, because an environment name
  outlives the session it was made in: open the same project tomorrow and
  `scratch` is `scratch` again. Icons say which listing you are looking at: a
  globe for `.GlobalEnv`, `Boxes` for a promoted group, a single `Box` on an
  environment's row.
- **Promotion is renderer-side, deliberately.** `!isSearchPath` is read in a
  dozen places to mean "an environment whose objects can be named directly in
  generated R" — dataset pickers, the toolbox, the AI's context block, the
  completion index. A user environment's objects cannot: they are
  `myenv$roads`. Promoting in `/env/list` would have quietly offered every one
  of them to every picker under a name that does not resolve.
- **The eye decides what you can act on, not just what you can see.**
  `userOnlyView` produces one list, and the tree, the Export dropdown, the Load
  targets and every **Move To** menu read it: with the filter on, `.GlobalEnv`
  and the user's own environments; with it off, the whole session, package
  environments included. The second filter in that function is the subtle one —
  a lifted-out group is still an OBJECT in its parent, so ouRGeo's own `server`
  environment (an environment in `.GlobalEnv`, correctly hidden while it was a
  row) comes straight back as a top-level group without it.

What the same pass fixed, all of it the same class of bug — the panel saying
one thing and R doing another:

- **`isSearchPath` was `grepl("^package:")`**, so `Autoloads` (and any
  `tools:*` entry) counted as a user environment: shown in the filtered panel,
  offered as a target for Load, and its objects listed in every dataset picker
  in the app. It is now "on the search path and not `.GlobalEnv`".
- **"Make Copy" on an environment made an ALIAS.** Environments are references,
  so `assign(new, get(old))` gives a second name for the same environment and
  the next edit through either shows up in both. `/env/duplicate` copies the
  contents (`list2env`), and the console echoes exactly that.
- **R's refusals never reached the user.** `error_response()` is HTTP 500 with
  `{success:false,error}` in the body, and axios REJECTS a 500 — so every
  caller that checked `res.success` never saw one. Creating an environment over
  a data frame, moving an object into a locked package environment, copying
  onto a name already taken: all silently did nothing. `RClient.ask()` returns
  the body for a refusal and still throws when there is no response at all,
  because that is a severed connection and `transport-retry.ts` is what knows
  the difference.
- **Export wrote ouRGeo's own functions into the user's `.RData`.** The panel's
  Export now passes `excludeSystem`, and `exportedNames` is the same set, so
  the `save(list = c(…), file = …, envir = …)` echoed to the console names
  exactly what the file holds. Several environments merge into one file, which
  no single R call does, so that case is a comment rather than a line that
  would not run.
- `/env/create` refuses a name that is not syntactic (`my env$x` is a parse
  error, so the environment would be reachable only through `get()`) and a name
  already in use, rather than overwriting a data frame with an environment.
- Searching by environment NAME still finds it. That was free when a user
  environment was a row; a promoted group would otherwise be the one thing in
  the panel search could not reach.

Right-clicking an environment gives **Export…** for any of them, plus **Make
Copy**, **Rename** and **Delete Environment** for the user's own — the last
three write to `.GlobalEnv`, and renaming `package:stats` is not a thing.
Delete is there because promotion took away the row that used to carry Remove.

## Key Stores (`src/store/`)

| File | Purpose |
|------|---------|
| `session.ts` | R status, console history, input history, recording state |
| `spatial.ts` | MapLibre layers, viewState, legend, north arrow, bbox |
| `plotting.ts` | Plot PNG history (`plots[]`), `currentIndex`, open/close |
| `editor.ts` | Monaco editor tabs and content |
| `environment.ts` | R environment browser state |
| `packages.ts` | Package manager state |
| `basemap.ts` | Active basemap override |
| `theme.ts` | App theme, code + markdown editor themes, UI scale |
| `ai.ts` | AI chat panel state |
| `help.ts` | Help panel state |
| `layout.ts` | Zones, panel placement and sizes, toolbar order, presets |
| `plugins.ts` | Installed plugins, and the revision every live registry re-renders on |

### State persistence (`src/lib/*-persistence.ts`)

Debounced autosave survives sleep and a renderer reload/crash. Two lifetimes:

- **Kept between sessions** — `layout-persistence` → `layout.json` (zones, panel
  placement and sizes, toolbar order, saved presets) and `plugins-persistence` →
  `plugins.json` (which plugins are enabled, plus the crash marker); both are
  preferences and must never join the `will-quit` delete list, as is
  `environment-preferences` → `environment-preferences.json` (how the
  Environment panel lists each of the user's environments).
  `session-persistence` → `session.json` = **code tabs
  only** (open `.R` files + untitled scratch; file-backed tabs re-read from disk
  on load). This is the one thing deliberately left across restarts.
- **Session-scoped (wiped on clean exit)** — `workspace-persistence` writes
  spatial layers (`spatial-layers.json`), map view/legend settings
  (`spatial-ui.json`), console history (`console.json`), and object-backed
  data-viewer/function-editor tabs (`object-tabs.json`); `plots-persistence`
  writes `plots.json`. The `will-quit`
  handler (`electron/main/index.ts`) deletes all of these on exit, so the next
  launch is clean. A **crash** (no `will-quit`) leaves them for recovery.

Files are split so a pan or console line never rewrites the large layer geojson.
On load, object tabs are appended after code tabs, then `pruneStaleObjectTabs`
drops any whose R object is gone. Workspace savers intentionally have **no
`beforeunload` flush** — that would race the on-exit deletion; the debounced
saves during the session suffice for reload recovery. All wired in `App.tsx`.

### Project workflow (`src/lib/project-persistence.ts`, `src/store/project.ts`)

The toolbar's project dropdown (`src/components/project/ProjectDropdown.tsx`,
right of the header — it also carries the small R-status dot that replaced the
old "R Connected" label) saves/loads a portable **`.ourgeoproj`** bundle: a zip
(packed/unpacked in the main process via `project:pack`/`project:unpack` +
`adm-zip`) holding `project.json` (manifest: version, name, `ui` = the same
session/workspace/plots slices the autosavers serialize, reused via
`buildSessionData`/`applySessionData` and `buildWorkspaceData`/`applyWorkspaceData`;
plus `databases`) and `environment.RData` (from `/env/save` with
`excludeSystem:true` so only user objects are snapshotted, not the server's
source()d functions).

- **scratch project** (`path === null`, `SCRATCH_PROJECT_NAME`, `useProjectStore`):
  the workspace ouRGeo always launches into — a clean R env every time, never
  savable in place (Save disabled; closing/switching never prompts — `confirmUnsaved`
  short-circuits to `discard` when `path === null`). `saveSession` is **gated to
  scratch only**, so `session.json` always holds scratch's code/.R tabs even while
  a named project is active — that's what makes scratch's tabs survive a project
  switch and reappear on relaunch. Save As spins off a real project; named-project
  code tabs live in the bundle.
- **Load** → `/session/reset` (clears user objects — keeping `system_names` —
  plus DB conns + proxies), hydrate UI stores, `/env/load`, then `/db/reconnect`
  (reopens each `.Rgeo` and rebinds its `dplyr::tbl` proxies, since the restored
  tbl objects hold stale connections). **New** → reset + restore scratch tabs.
- **`system_names` is the line between ouRGeo's objects and the user's**, and
  three things read it: `/env/save excludeSystem` (what goes in a bundle),
  `/session/reset` (what gets wiped), and the Environment panel's "Hide
  non-user objects" filter (fed by `systemNames` from `/session/init` and by
  `rdataLoadedNames` from `/env/load`). It is snapshotted at the END of
  `server.R` — so anything assigned into `.GlobalEnv` *later* is invisible to
  it, which is what happened to the four helpers `/session/init` defines for
  generated code (`ourgeo_calc_crs`, `ourgeo_linearize`, `ourgeo_db_collect`,
  `rgeo_materialize`): listed in the panel as the user's, copied into every
  bundle, and deleted by the reset that opens a project — after which a planar
  toolbox tool emitted `ourgeo_calc_crs()` into a session that no longer had
  it. `handle_session_init` now unions them in.
- **`/env/load` flags what is NOT the user's**, and its old "no metadata in the
  file → treat all of it as non-user" default is why opening a project left the
  Environment panel blank while `ls()` listed everything: a bundle is written
  with `excludeSystem`, so it holds nothing but user objects and therefore
  carries no metadata to say so, and every object it restored came back flagged
  and hidden. The flag is now the file's own metadata ∪ this session's
  `system_names`, and nothing else.
- **Dirty tracking**: env/spatial/plots/object-tab changes mark a *named*
  project dirty (`enableDirtyTracking` after startup; suppressed during load/new).
  On window close the main process fires `app:before-quit`; the renderer shows
  `UnsavedChangesDialog` (Save / Don't Save / Cancel) for named projects and calls
  `app:confirm-quit` — code/.R tabs are always flushed regardless of choice.
- Recent projects (max 5) persist in `recent-projects.json` (never deleted).

## Moving an object between panels (`src/lib/spatial-link.ts`)

The Environment panel, the data viewer and the Spatial Editor show the same R
objects from three angles, and each direction between them lives here.

- **The two directions share one question — "is this object already on the
  map?" — so they have to answer it the same way.** `layerShowsObject` is that
  answer, and the case it exists for is the **empty `envName`**: a
  database-backed layer has no R environment (`addDbSpatialLayer`), so a strict
  comparison says a `.Rgeo` dataset the user just sent to the map is not on the
  map and offers to add it again. An empty environment on either side matches on
  the name alone — which errs towards ASKING, and the answer feeds a prompt
  rather than a refusal, so that is the right way for it to be wrong.
- **"In the current view" means what Contents lists**, not every layer in the
  store: `SpatialRibbon` filters to the active named session's layers when there
  is one. `layersInView` states that, so the prompt can never claim a duplicate
  the user cannot see.
- **`AlreadyOnMapDialog` has three answers, not two.** A second layer from one
  object is legitimate (two symbologies of one roads layer) and far more often a
  user who forgot the layer was there — and nothing about the click distinguishes
  them. *Show existing layer* is the answer the forgetful case wants and the only
  one the old flow could not express. It is shared by the data viewer's **Add to
  Map** and the Environment panel's **Send to spatial editor**, so the same
  gesture gets the same question wherever it starts.
- **Map → table needs no dedupe of its own**: `addObjectTab` already keys on
  access path + environment and activates the tab it finds. `viewerTargetForLayer`
  decides *what* to open, refusing only a raster (bands, not rows — it names the
  symbology editor instead) and a class with no table view. When the environment
  listing has not caught up — a layer added seconds ago, an object reached
  through an expression — it opens anyway rather than refuse something that
  works; the data viewer reports a genuinely missing object itself, with a Retry.
- **Opening a panel is not showing it.** Both directions call
  `useLayoutStore.setActivePanel`, because in a tabbed zone the panel can open
  behind whatever tab is in front of it, and a table that opened where the user
  cannot see it is indistinguishable from a button that did nothing.
- `add-spatial-layer.ts` gained `addDbSpatialLayer`, lifted out of
  `EnvironmentItem`, so a `.Rgeo` dataset put on the map from the panel, from
  the data viewer or by the assistant is the same layer with the same tile
  source; and `addSpatialLayer` now infers `geometryType` from the geometry
  rather than leaving it `'Unknown'` for callers that (unlike Add Features)
  never asked `/spatial/list`.

## Distance & Bearing (v1.13)

ourgeo.dev has always said *"don't eyeball it — type it. Enter an absolute
coordinate, or place the next vertex relative to the last one by distance and
bearing. Distances are geodesic (measured on the globe), so precision holds
anywhere on Earth."* What shipped was a 128px text box in the drawing ribbon,
visible only while the draw tool was up on a non-point layer, speaking one
syntax (`d150 a45`) — and computing the destination on a **sphere**, which is
up to half a per cent out against WGS84 and leans every leg the same way. The
repository's own author could not find it.

- **`lib/draw/cogo.ts` is the whole model, and it is pure.** Vincenty direct
  and inverse on WGS84, pinned against Vincenty's published example to the
  millimetre. The inverse solution is not decoration: **a geodesic arrives on a
  different azimuth than it left on**, so a deflection or an angle right has to
  turn from `inverse(prevPrev, prev).finalAzimuth`. Driving the app showed it —
  a 100 m leg's arrival azimuth was 2″ off its departure, and the next leg
  carried that. Also: the notations a traverse is actually booked in (azimuth,
  DMS, quadrant, deflection, angle right), and the units it is booked in
  (metres, feet, **US survey feet** — the unit of most State Plane zones and
  2 ppm from the international foot), and closure with its 1:N.
- **An entry that can only mean one thing means it.** `N45°30'E` typed while
  the notation says Azimuth is a quadrant bearing; `R90` is a deflection.
  Both were refused at first, with a message complaining about the number,
  which is how a first traverse ends in the wrong dropdown instead of on the
  map. A bare `-12` still redirects rather than guessing — it is as likely a
  mistyped azimuth as a left turn, and guessing wrong puts the leg 24° out
  with nothing on screen to say so.
- **A leg is an ordinary vertex append.** The tool (`tools/distance-bearing.ts`)
  places vertices through the same store calls the draw tool uses, so undo,
  snapping, Save Edits and the R write know nothing about it. Clicking still
  works after the first click on a chain: a traverse with one eyeballed corner
  is a real thing, and the tool is about being *able* to type, not forbidden to
  point.
- **`traversePath` is a discriminated read, and that is the POINT session.**
  A line or polygon keeps its trail in the draft, where the ribbon's undo can
  reach it; a POINT session has no draft that outlives a leg (each leg commits
  and the draft is cleared), so its trail is the one `store/traverse.ts` keeps.
  Reading the store for both would go stale under Undo Vertex; reading the
  draft for both would give a point traverse no trail whatsoever.
- **A point traverse measures from a reference point, and the reference is not
  data.** The first version committed it — first click, first row — which is
  the one thing a click there must not do: the monument a set of points is shot
  from is usually not one of them, every row of a point layer is a separate
  feature, and answering *where am I measuring from?* by writing a row answers
  a different question. `usesReferencePoint` is the discriminator (POINT, and
  deliberately not MULTIPOINT, whose parts live in one draft and commit
  together), `startTraverseRun` places it, and `DrawingLayer` draws it as a
  hollow ring with the run dashed behind it — muted, so nothing there reads as
  a feature. A later click re-places it and **flushes the run first**, because
  the R a traverse echoes describes one chain from one origin and the chain has
  just been broken.
- **A leg walks the dataset, exactly as the draw tool does.** It used to call
  `commitPoint`, which is *add-point* semantics: open "Redraw geometry…" on row
  3 of ten and the typed points landed in rows 11, 12, 13. A leg now stages the
  geometry of the row the session is on and advances (`ctx.finish()`), so the
  data viewer's row indicator follows a typed traverse the way it follows a
  clicked one, and running out of rows raises the same "add another?" prompt.
  Typing the next distance and pressing Enter *is* that prompt's answer, so
  `submit` gives it — a traverse that stopped dead at the end of the table
  would be one the user finishes with the mouse.
- **`GeometryEditSession.appendRows` is what "Add Point(s)" means**, and it
  exists because nothing else on the session told the two intents apart. That
  button opens a session at row 0 of a dataset that already has rows and means
  *append per click*; the data viewer means *fill this row, then the next*.
  Without the flag, picking Distance & Bearing inside an Add Point(s) session
  would overwrite the layer's first point.
- **`commitAndAdvance` reads the session, it does not subscribe to it.** It
  used to close over the `session` its render saw, which is fine for every
  caller that commits what the user just drew — and wrong the moment a caller
  moves the session on first. Answering the row-add prompt and placing the leg
  in one keystroke did exactly that, and the point went into the row *before*
  the one just appended, overwriting the previous one with nothing on screen to
  say so. Pinned by `useGeometryCommit.test.tsx`, which holds a stale callback
  on purpose.
- **A matched drawing hotkey is now consumed** (`useDrawHotkeys`). Nothing
  needed it until B, whose strip focuses a text field on activation: React
  flushes a discrete event's update DURING dispatch, so the keystroke's own
  default action typed "b" into the field that had just taken focus. The first
  coordinate driven through the app came back as `b-122.4200, 37.7750`.
- **Undoing a placed point is two facts, not one.** The staged geometry
  (`ctx.undoLast`, the ribbon's own Ctrl+Z, reachable from a tool through the
  new `DrawToolContext.undoLast`) *and* the row the session moved on to
  (`retreatRow`). Undoing only the first leaves the next leg writing into the
  row it has just emptied. A commit that ran out of dataset never advanced
  anything — it raised the prompt — so undoing that one cancels the prompt
  instead, which is what `retreatRow` checks first.
- **The strip is docked, not floating** (`TraverseBar.tsx`): it never covers the
  geometry it is building and never has to be moved. It **wraps rather than
  scrolls** — the drawing ribbon below scrolls because a hidden tool can be
  reached another way, but a hidden "Add leg" is a form with no submit.

### The coordinate system is the feature, not a footnote

A bearing off a survey plat in a projected CRS is measured from GRID north and
its distance is a GRID distance. Measuring those on the ellipsoid rotates the
traverse by the grid convergence — up to 3° at a UTM zone edge — and scales it
by ~1:2500. Both are invisible: the figure closes, it is just in the wrong
place. So there are two bases, the strip always names which is in force, and a
projected layer defaults to its own grid with its own unit already selected.

- **The grid arithmetic is R's** (`/spatial/traverse`, `r/lib/handlers-cogo.R`).
  proj4js in the renderer was the obvious alternative and is wrong twice over:
  a dependency, and a second projection engine whose disagreement with PROJ over
  datum shifts would land as metres of silent error when the geometry it
  produced was transformed BACK to the layer's CRS on save. One engine writes
  the geometry; the same engine decides where it goes.
- **The reply carries the frame at the new vertex** — projected position, grid
  convergence, point scale factor — so the NEXT leg previews on the grid it
  will be committed on without a round trip per keystroke. `frameAt` is stored
  beside it because a frame is true of exactly one point and the origin moves;
  a frame kept alone goes stale silently and previews with the convergence of
  the last vertex.
- **`legs: []` is a legitimate question**, not an error: it is how the strip
  asks for the frame at a start point, so even the first leg previews where it
  lands. Without it the first grid leg drew geodesically and jumped a metre
  when R answered.
- **Convergence and scale are measured, not looked up**: project the vertex and
  a point a metre north, and see what the projection did. There is no general
  formula across every projection PROJ supports, and this one is right for a
  Lambert or an oblique Mercator as much as for a UTM zone.
- **`json_response` rounded every number to four decimals** — jsonlite's
  default, and four decimals of longitude is eleven metres. It now takes a
  `digits` argument that position-carrying handlers pass `NA` to. Nothing else
  changed: layer geometry never went through it (GeoJSON is spliced in as a
  pre-built string), which is why this had never surfaced.

### Rule 0, on the one thing the geometry write cannot say

The vertices reach R the way all drawn geometry does — staged, then written by
the batched `buildBatchedGeometryRCode` statement on Save Edits. What that
statement cannot carry is that the figure was *measured*: it writes coordinates,
not the distances and bearings they came from. So finishing a traverse echoes a
runnable `ourgeo_traverse()` call (`lib/draw/traverse-rcode.ts`) naming the
origin, the legs and the CRS. It is an `info` entry rather than executed R,
because running it would build a second geometry nobody asked for.

`ourgeo_traverse()` is defined in `handlers-cogo.R` at startup, so the
`system_names` snapshot at the end of `server.R` already keeps it out of the
user's Environment panel and project bundles — the same treatment as
`ourgeo_calc_crs`, without needing `handle_session_init`'s explicit union. It
implements the identical Vincenty direct solution as `cogo.ts`; each file names
the other as the thing it must stay in step with. Verified by driving the app:
the echoed call reproduced the saved geometry to 7e-13 degrees.

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

## Plot Popout Window

`window.location.hash === '#plot-popout'` causes `App.tsx` to render `PlotPopoutView` instead of `MainApp`. The Electron main process creates this secondary window via `plot-window.ts` and pushes new plot data URLs via `ipcRenderer.on('plot:update', ...)` → `window.electronAPI.plot.onUpdate(...)`.

## AI Assistant (`src/lib/ai-*.ts`, `src/components/ai/`)

`ai-client.ts` speaks four transports (Anthropic, OpenAI-compatible, Gemini, Ollama)
behind one `sendMessage(opts)`. Tools are **provider-neutral**: `SendOptions.tools`
is an `AiTool[]` that each transport re-encodes (`anthropicTools` /`openAiTools` /
`geminiTools`), and `onToolCall({ id, name, input })` dispatches by name. Every
transport reads its stream through `readLineStream`, which buffers across chunk
boundaries — a tool's arguments arrive as many small deltas and a JSON event
routinely straddles two reads. Anthropic streams *with* tools (reassembling
`input_json_delta` fragments), so enabling a tool never costs the streaming UX;
Ollama still falls back to non-streaming when tools are attached.

Two independent switches in the AI panel footer decide which tools are attached:

| Switch | Tool(s) | Default | Store |
|--------|---------|---------|-------|
| **Autopilot** | `execute_r_code` — runs R in the live session | off | `ai.autoPilotEnabled` |
| **Web** | `web_search`, `web_fetch` (`ai-web-tools.ts`) | **on** | `ai.webAccessEnabled` (persisted in `ai-preferences.json`) |
| *(none)* | `read_document`, `write_document`, `edit_document` (`ai-doc-tools.ts`) | always | — |
| *(per action)* | `list_ui_actions`, `run_ui_action`, `toolbox_tools`, `run_toolbox_tool`, `ourgeo_docs` (`ai-ui-tools.ts`) | attached always; each ACTION is tiered | `ai.actionTiers` (persisted) |

A disabled switch is *absent* from the request rather than declined afterwards, and
`runTool` in `AiChatPanel` re-reads the store at call time so flipping a switch off
mid-answer stops the next call. **Web** is the trust control: with it off the
assistant has no network tool at all, and its only remaining route to the internet
is R code the user watches execute in the console. Every web call is also logged to
the console as an `info` entry (`describeWebCall`), so the console stays a complete
record of what the assistant did.

- `web_search` scrapes DuckDuckGo's no-JS HTML endpoint (no API key); `web_fetch`
  reduces HTML to text with `DOMParser`, passes JSON/CSV/text through, refuses
  binaries, and blocks loopback/RFC1918/link-local hosts (those belong in the
  console, where the user can see the request).
- `ai-system-prompt.ts` holds the prompt in three pieces: `AI_BASE_PROMPT`,
  `buildProvenanceRules()` and `buildToolGuidance({ autoPilot, webAccess })`. The
  provenance rules are the reason the module exists — the assistant must derive
  every figure from a named R object through code the user can re-run: no recalled
  statistics, no hand-typed `data.frame()` behind a chart, every transformation
  shown, and an explicit "I can't" when the data isn't in the session.
  `buildToolGuidance` states the *current* switch positions so the model never
  claims a capability it wasn't given.

### Chats belong to the project (v1.15)

The panel held ONE conversation, in memory only. A renderer reload lost it, and
the only way to ask an unrelated question was the "New" button — which called
`clearMessages()`. So the analysis that produced a map was unfindable an hour
later, and a second question cost you the first exchange.

`AiChat` is now the unit, and `useAiStore` owns a set of them (`chats`,
`activeChatId`) the way the editor owns tabs and the terminal owns shells.
Shaped after `NamedSession` (`store/geometryEdit.ts`) for its selectors and
after `TerminalSession` (`store/terminal.ts`) for two rules worth copying: a
title that follows the content until the user renames it (`renamed`), and a
delete that activates the **neighbour** rather than the first.

- **`selectMessages` returns a module-level `NO_MESSAGES`**, never `?? []`. The
  panel subscribes to it directly, and a selector that BUILDS a value returns a
  new one every call, which zustand reads as a change and re-renders for ever.
  Pinned by a test that asserts reference identity, because the symptom is a
  hung panel rather than a wrong value.
- **Everything per-conversation moved onto the chat** — `messages`,
  `claudeSessionId`, `lastSessionContext`, `tokenUsage` — through
  `patchActiveChat`, lifted from `patchActiveSession`. `isStreaming`,
  `streamingContent` and `abortController` stay top-level: one turn runs at a
  time, and `streamingContent` changes per token, so putting it inside the
  array every switcher row subscribes to would re-render the list for the whole
  of an answer.
- **A chat remembers the provider and model it was held with**, and switching
  restores them — a conversation written by Opus and one written by a local 8B
  are not the same artefact, and the model selector is a global. But
  `switchChat` deliberately does NOT go through `setProvider`/`setModel`: those
  write `ai-preferences.json`, so opening an old chat would silently change
  what the next NEW one starts on and would survive a restart having never been
  asked for. That file keeps its old meaning — the default a new chat begins
  with.
- **Switching while a turn is running stops it first**, which since 1.14.3
  files the partial answer in the chat it belonged to rather than letting the
  next chunk land in the conversation being opened.
- **`deleteChat` never leaves zero.** A panel with no chat has nowhere to put
  the next message, and an empty switcher is a dead end rather than a clean
  slate.

**Where they live** (`lib/ai-chats-persistence.ts`) is one slice with two
homes, the shape `session-persistence.ts` already solves: one
`buildChatsData`/`applyChatsData` pair serves both the `ai-chats.json` autosave
and `manifest.ui.chats`. `ui.chats` is optional so every bundle written before
this opens unchanged, and a conversation is project content now, so
`setupProjectTracking` gained a fifth subscription and the unsaved-changes
prompt covers it.

**Scratch does not keep chats, and that is the point of scratch.** It is the
workspace ouRGeo always launches into, with a clean R session every time and no
Save; a conversation worth keeping is a reason to make a real project out of it,
after which the chats travel with the file. Scratch that quietly accumulated
every conversation the user ever had in it would be a filing cabinet nobody
chose to open. So `ai-chats.json` is **session-scoped** — in
`SESSION_SCOPED_FILES` beside `plots.json` and `console.json` — and `newProject`
restores nothing, leaving the one empty chat `clearWorkspaceStores` made.

Session-scoped is not the same as never written. The file exists so a renderer
reload — Ctrl+R, or the automatic one when the renderer dies — does not cost
the user the conversation they are in the middle of, and so a crash leaves it
for recovery. Every other panel behaves that way; a chat that alone did not
would be the one thing a reload destroyed. Two consequences:

- **There is no flush on quit.** A write started as the window closes races the
  `will-quit` unlink, and the loser is whichever the OS schedules second — so
  an exit could leave scratch's chats on disk for the next launch to read back
  as its own. `workspace-persistence.ts` omits its `beforeunload` flush for
  exactly this reason.
- **`SESSION_SCOPED_FILES` moved into `src/lib/session-scoped-files.ts`**, with
  a test. The list was inline in `index.ts`, and an omission there is silent in
  the way that matters: a file left off it survives a clean exit, and the
  symptom is yesterday's state in a session the user expected to be fresh, with
  nothing on screen to explain it. Same argument as `app-permissions.ts`. The
  test also asserts the preference files are NOT in it, because the opposite
  mistake — a setting that silently reverts — is just as unexplainable.

**A stored Claude Code session can be a cold cache, and that is routine.**
`claudeSessionId` names a transcript on THIS machine; a portable `.ourgeoproj`
opened elsewhere names one that does not exist. Measured against 2.1.263:

```
$ claude --resume <unknown-uuid> …
exit=1   stderr: No conversation found with session ID: …
stdout: {"type":"result","subtype":"error_during_execution",…}
```

Left alone the dead id is what we stored, so every retry fails identically and
the conversation is finished for good. So **ouRGeo's `messages` are the record
and the session id is an optimisation**: `sendClaudeCli` runs the resume, and
on `isMissingSession` replays the whole turn once as a new session carrying the
catch-up block `withEarlierTurns` already builds. The user is told nothing,
because nothing went wrong from where they sit.

One ordering trap, found by the test: the `result` event's `isError` branch
settles the promise *during* the stream, and only `onDone` has the stderr that
distinguishes a cold cache from a real failure. So a resume whose subtype is
`error_during_execution` is deliberately left for `onDone` to classify.

**The assistant reads chats and cannot move between them** (`ai-actions/chat.ts`:
`chat:list`, `chat:read`, both `always`). The rule below still stands — the AI
panel is never exposed, because an assistant that can close its own panel can
end the conversation — and switching or deleting a chat is that hazard one step
worse: it takes the user out of the conversation they are in. Looking carries
none of it, and "what did we decide last week?" is answerable from this project
and nowhere else. `chat:list` says outright that it cannot switch or delete, so
a model spends no turn discovering it and points at the switcher instead.

### The transport (`electron/main/ai-proxy.ts`, `src/lib/ai-fetch-error.ts`)

Two bugs lived here, and both presented as the same four words in the chat
panel: **"Error: fetch failed"**.

- **`net.fetch`, not Node's `fetch`.** Node's is undici, whose `headersTimeout`
  and `bodyTimeout` are both **five minutes** — a deadline ouRGeo never chose
  and never mentioned. A local model given a large prompt on a busy GPU
  routinely exceeds it, and a request queued behind another waits for the whole
  of that one first. Measured against a server holding its headers for 320 s:
  Node's fetch threw at **300.8 s** with `UND_ERR_HEADERS_TIMEOUT`; Electron's
  `net.fetch` returned the answer. Chromium's stack imposes no such deadline,
  and streaming, custom headers and `AbortSignal` were each verified against a
  local server before the swap rather than assumed. The user can already see a
  slow request and stop it; ouRGeo does not need a timer of its own.
- **A dropped stream is an ERROR, not an end.** `proxyFetch`'s `onError` called
  `finish()` once the response had been handed over, which resolves the pending
  read as a clean end-of-stream — so a connection that died mid-sentence was
  indistinguishable from a model that had finished speaking, and the truncated
  text was returned as the complete answer with nothing anywhere saying
  otherwise. A half-answer presented as whole is worse than an error, because
  only the error can be acted on. It now rejects, and the partial text is kept
  (see `finalizeStream`).
- **`describeFetchFailure` names the recovery move.** `fetch` reports a server
  that is not running, a server that never answered, and a connection that
  dropped identically; the cause is one level down in `err.cause` (undici) or
  in a bare `net::ERR_…` string (Chromium), and the host is in the URL. It
  reads both vocabularies, walks the cause chain, and answers with a sentence
  naming the host and what to do — the same argument `transport-retry.ts` makes
  about axios reporting a severed socket as `Network Error`. `isLoopbackHost`
  decides who is being blamed: a local server is a process the user can go and
  look at.
- **An abort settles on the renderer side.** Telling main to abort also removes
  the listeners that would carry its reply back, so a read left waiting on them
  would never settle — an invisible failure: the panel looks idle while the
  turn's promise hangs for ever, and with it the guard that stops a message
  being sent twice.

### Sending a message (`AiChatPanel.handleSend` / `runTurn`)

**The send is claimed synchronously, before the first `await`.** Preparing a
turn asks R for the environment listing and a preview of every object the
message names — and R is serial, so with a long command running that wait is as
long as the command. Nothing used to say a send was under way until all of it
had finished: the box still held the text, Send was still enabled,
`isStreaming` was still false. A user who clicked again because nothing had
happened sent the message **twice**, and two turns then ran at once against the
same model. `sendingRef` covers the same tick (Enter and a click); `beginStream`
covers every tick after it, and now runs before the preparation rather than
after it. `runTurn` is split out so the ordering rule — claim, commit, then
await — fits on one screen.

**A failed turn keeps what was streamed.** The catch used to call
`finalizeStream(streamingContent)`, closing over the value from the render that
built the callback — which is empty, always, because the turn had not started.
So a transport that died mid-answer finalized an EMPTY message and everything
the user had been reading vanished at the moment the error appeared. It reads
`useAiStore.getState().streamingContent` instead: the same class of bug as
`useGeometryCommit`, and the same fix.

**Stop keeps the half-written answer too.** `cancelStream` used to clear
`streamingContent`, so pressing Stop deleted every word just read — including
the part the user stopped it because they had already got. Stopping means "that
is enough", not "undo that". And `finalizeStream` adds no message when there is
nothing to add, because a blank assistant bubble reads as the assistant having
answered with nothing.

**Every message carries a copy button, on the side its bubble is on** — below
the bubble rather than in a corner of it, because the assistant's own code
blocks already carry one at their top-right and a second in the corner would
sit on top of the first whenever a message opens with code. The row is always
in the layout and only its opacity changes: revealing it on hover would grow
the column at the moment the pointer arrives and nudge every message below it,
and a list that moves under the cursor is one you cannot click accurately. It
copies `message.content` — for the assistant that is the raw MARKDOWN, which is
what pastes usefully into a document and what round-trips; and it is not shown
while streaming, because an unfinished answer is the wrong thing to offer.

`CopyButton` has a `failed` state, and it is not defensive padding: it is what
found the permission bug above. The old version set `copied` before the write
had resolved, so a rejected write showed a tick over an unchanged clipboard and
the user only learned otherwise when they pasted. A copy button that lies is
worse than one that is missing.

**`detectMentionedObjects` reads the user's environments only.** It used to
scan the search path too, so an ordinary English sentence matched
`package:base` and "Reply with one word" asked R for the first five rows of the
`with` FUNCTION. R refuses with a 500, the preview is dropped silently, and
nothing looks wrong — but `base`, `stats` and `utils` are full of words people
write in sentences (`with`, `data`, `table`, `max`, `range`, `format`, `file`,
`date`, `sort`), so a plain question fired several doomed round trips at a
SERIAL R server before it could be sent. That wait is the window in which a
user sees nothing happen and clicks Send again. `!isSearchPath` is the same
predicate the Environment panel uses, and it is right twice over: a package
function has no rows to preview, and a preview is only useful for something the
user put there.

**`tokenUsage.total` starts at 0, meaning "no provider has said yet"**, and the
panel draws against the resolved per-model size until one has. It is reset by a
provider or model switch: the reading describes ONE model's window, so carrying
it across would show the new model's bar filled by the old one's conversation.

### A Claude subscription as a provider (`ai-claude-args.ts`, `electron/main/claude-*.ts`)

Every other provider is an HTTP API reached with a key the user pastes into
Settings. A Claude Pro/Max subscription is not a key and cannot be turned into
one — but it authenticates the **Claude Code CLI the user already installed**,
and `claude -p --output-format stream-json` wraps the *verbatim Anthropic
Messages streaming events* `sendAnthropic` already parses. So ouRGeo does not
need access to anybody's credits; it needs to ask the program on the machine.

- **The line this must never cross.** ouRGeo does not read, copy or reuse the
  CLI's stored credentials — not `~/.claude/.credentials.json`, not the OS
  keychain, not a token lifted from either — to call the API itself. It spawns
  the user's program and lets it authenticate. Nothing in this code should ever
  need to know what a Claude token looks like. `--bare` is therefore unusable
  here: it says outright that OAuth and keychain are never read, i.e. it is the
  API-key path.
- **`--tools ""`, not `--disallowedTools`.** Every built-in tool off — Bash,
  Read, Write, Edit, WebFetch. An allowlist that starts empty cannot be widened
  by a settings file ouRGeo did not write, and the whole audit story is that
  what the assistant does appears in the R console. A CLI that can quietly
  `Write` has stepped outside it, and the Autopilot, Web and Terminal switches
  become decorative. `--setting-sources ""` and `--strict-mcp-config` are the
  same argument for the user's own CLAUDE.md, hooks, skills and MCP servers: a
  repository instruction telling an agent to run the test suite has no business
  in a spatial IDE's chat panel.
- **The CLI owns the agent loop, so tools reach it over MCP.** It does not hand
  a tool call back to its caller; it calls tools *it* can see.
  `electron/main/claude-mcp.ts` is a loopback HTTP MCP server — three JSON-RPC
  methods, hand-written, because this repository has two runtime dependencies
  and each is a paragraph here. `tools/list` is `SendOptions.tools` re-encoded
  and `tools/call` round-trips to the renderer, so **`AiChatPanel.runTool` is
  untouched**: the same switches, the same confirm modal, the same console
  echo, decided in the same place. If a change to this provider needs to edit
  `AiChatPanel`, the bridge is wrong. Bound to 127.0.0.1 on a random port with
  a per-run bearer token, closed when the child exits.
- **A tool call can block on a human.** The confirm-tier modal holds the MCP
  request open; the timeout is ten minutes and returns a refusal the model can
  *read*, because "the user has not decided yet" is not a severed socket.
- **The CLI owns the transcript**, so continuity is `--session-id` then
  `--resume`, not the message array every other transport posts. Clearing the
  chat mints a new session — leaving it would resume a conversation the user
  just said to forget. `withEarlierTurns` covers the other direction: a session
  starting mid-conversation (the user switched provider) is handed a capped
  catch-up block, or a follow-up would be answered by a model that had silently
  forgotten the question it follows.
- **The system prompt goes in a file and the user turn on stdin.** Both carry
  the session's context — the environment listing, the console tail, the open
  documents — and Windows caps a command line at 32,767 characters. The MCP
  config is a file for a second reason: a `.cmd` shim has to be spawned through
  the shell on Windows, and a shell would have to quote a blob full of braces
  and quotes correctly on the one platform this repository cannot test.
- **The session context rides the USER turn, never the system prompt** — the
  one decision in this provider with a price tag on it. Claude Code caches the
  prompt prefix, and the system prompt is the front of it: change a byte and
  the whole conversation is re-sent as a cache WRITE. Measured on a trivial
  two-turn chat against CLI 2.1.263: resuming with an identical system prompt
  read 5,762 tokens from cache and cost $0.0014; resuming with one whose TAIL
  had changed read 0, wrote 5,874, and cost $0.0235 — **16× for the same
  question**. ouRGeo's session context changes with every console line, so the
  original shape paid the full price of the whole conversation on every turn.
  `SendOptions.sessionContext` is the split: `systemPrompt` is the same bytes
  every turn, and what moves is appended to the turn, where it extends the
  cached prefix instead of breaking it — and where the freshest state sits
  closest to the question. **Anything added to the system prompt for this
  provider must be constant, or it costs the conversation.**
- **And it is sent only when it has CHANGED** (`ai.lastSessionContext`). The
  block stays in the CLI's transcript, so an identical listing costs its tokens
  again on every following turn — ten turns, ten copies of the same
  environment. It carries the sentence "This replaces any earlier session-state
  block", so the newest one the model has seen is the one in force. Cleared by
  New conversation and by a provider switch, because the next provider has been
  sent nothing.
- **The context bar reads the per-call `usage`, not the run's total.** A run's
  `result.usage` is the SUM over every API call the agent loop made, and each
  of those re-sends the conversation: a two-call run measured in=4,
  cache_read=6,680, cache_creation=6,862 — 13,546 "input tokens" — while the
  largest prompt actually sent was 6,864. The sum grows with the number of tool
  calls, so a long autopilot turn reported several times the window it was
  using and the bar pegged at 100%. `parseClaudeLine` therefore emits a
  `usage` event for `message_start` and `message_delta`, which arrive DURING
  the run — that is also what makes the bar move rather than jump once at the
  end — and `sendClaudeCli` keeps the last one rather than adding them up.
  Cached tokens count: caching changes what a token costs, not the space it
  occupies. The `result` event still supplies the window, since an alias
  resolves to a model only that run can name.
- **`requiresApiKey` is not `!isLocalProvider`.** This provider runs on the
  machine but is not a self-hosted server, and the chat panel's send gate asked
  the wrong question — it refused to send a single message while every other
  part of the provider worked, which is the failure that makes a whole feature
  look broken.
- **Detection probes concurrently.** Each miss is one CLI start-up, about a
  second; sequentially the settings row sat on "Looking for the Claude Code
  CLI…" for six seconds on a machine where it was installed. Candidates are
  confirmed by running `--version`, never by `existsSync` — a stale shim from
  an uninstalled npm global exists right up until you run it. macOS has the
  PATH problem the terminal section already documents.
- **Usage is a subscription window, not a token count.** `rate_limit_event`
  carries `five_hour.utilization` and `resetsAt`, which is what a subscriber
  plans around; `contextWindow` comes from the run's own `result` event rather
  than a table of ours that goes stale when an alias moves.
- **The settings copy says what this is.** No API key field, the resolved
  binary, `claude auth status --json` rendered as who is signed in and on what
  plan, and the plain sentence that usage counts against that plan and that
  whether it covers this use is between the user and Anthropic's terms. It must
  not claim endorsement, and the feature must not be sold as free Claude.

### The document skill (`ai-skill-documents.ts`, `ai-doc-context.ts`, `ai-doc-tools.ts`)

A local model once produced an excellent earthquake report in which every figure
chunk was a bare session variable (`p1`, `combined_plot`), no chunk loaded the
data, and every headline number was typed into the prose. All three are invisible
from inside the model: running a chunk inline evaluates in the LIVE session and
succeeds, and only the Knit button — a clean child `Rscript` — tells the truth.
Nothing in the prompt mentioned documents at all.

- `buildDocumentSkill({ hasDocumentTools })` is injected on **every** request,
  between the provenance rules and the tool guidance. Its centre is the
  self-containment rule (knit is a separate session, so every object must be built
  by a chunk in the same document), inline `` `r …` `` for figures in prose, the
  chunk options that silently produce wrong output (`results='asis'`, `print(p)`
  in a loop), and the ouRGeo-specific traps — inline runs honour only a few
  options, and `rmarkdown::render()` through `execute_r_code` renders in the live
  global env, so it *passes on exactly the documents Knit cannot render*.
- `buildDocumentContext(tabs, activeTabId)` adds an `## Open Documents` block
  beside the env and console blocks: name, language, dirty state, outline, chunk
  labels. `describeDocument()` is shared with the write tools and runs the cheap
  static checks — duplicate label, unterminated fence, missing front matter, and a
  runnable chunk whose whole body is one bare identifier.
- **The document tools carry no switch and are not gated on Autopilot**, because
  they write only into a visible editor tab — through `applyExternalContent`, the
  store's external-update channel, after dropping a Visual-mode tab to Source
  (Visual is seeded once and writes back on exit, so a write underneath it would
  be lost). No disk, no R session: saving stays the user's action, and the whole
  module is testable with no Electron. Every call is logged to the console via
  `describeDocCall`, the same audit-trail rule the web tools follow.
- They exist because the alternative was assembling a document out of
  `writeLines(c("…"))` through `execute_r_code` — a whole report's backticks and
  quotes escaped inside an R string literal, which is where a small local model
  comes apart, silently.

### Driving the GUI (`src/lib/ai-actions/`, `ai-ui-tools.ts`, `ai-skill-ourgeo.ts`)

The assistant can operate the application, so it can walk a user through a
workflow in their own session instead of only describing one. ~90 actions in 12
groups cover the panels, dialogs, editor, projects, data import, .Rgeo
databases, environment, packages, help, the whole Spatial Editor, drawing, plots
and settings — plus the 87 toolbox tools.

- **Action ids use a colon: `map:addLayer`, not `map.addLayer`.** Dots are legal
  in R names, so the dotted form is a syntactically perfect R call — and a local
  model, asked for a tutorial, duly wrote `map.addLayer(object = "pts_buf")` and
  told the user to run it. The colon cannot be mistaken for a function. The core
  prompt says outright that these are not R functions, the Autopilot refusal no
  longer reads as "hand them the code", and `action-code-guard.ts` catches the
  mistake from either side: the model gets a redirect to `run_ui_action` instead
  of running it, and a user who pastes one into the console gets an explanation
  instead of `could not find function`. Highlight targets keep their dots —
  they are string arguments, never confusable with a call.
- **A registry, not ninety tools.** `ai-actions/registry.ts` collects `UiAction`
  data objects (id, group, summary, typed params, default tier, `run`). Five AI
  tools cover the lot: search, run, toolbox search, toolbox run, docs. Ninety
  tool definitions would not fit a local model's context, so discovery is a tool
  call and the system prompt carries only the generated **id index**
  (~400 tokens, `actionIndex()`), which a test proves resolves.
- **Three tiers, user-editable.** `always` (screen only) / `autopilot` (touches R
  or disk — the same switch as `execute_r_code`) / `confirm` (destructive: also a
  modal). Defaults live on the action; the gear beside the Autopilot toggle opens
  `AiPermissionsDialog`, and overrides persist **sparse** in `ai-preferences.json`
  so shipped defaults stay live. The confirm modal blocks the tool call — closing
  it is a "no", because the safe answer must be the one you get by doing nothing.
- **Pointing, not only pressing.** `ui:highlight` rings a real control by
  `data-ourgeo-id` and waits, so a tutorial teaches where the button is.
  `HighlightOverlay` is `pointer-events-none` throughout — the ring must never
  intercept the click it is asking for — and `ai-actions/targets.ts` is a closed
  catalogue that a test checks against the attributes in the source.
- **Dialog state moved to `src/store/ui.ts`.** Every dialog used to be a
  `useState(false)` next to its button, which is right until something outside
  the component needs to open one. `hideDialog(id)` is a no-op unless `id` is the
  open dialog, so a closing dialog can never close its replacement.
- **Geometry the assistant makes is staged, not written.** `draw:addFeature` goes
  through the same pending-edit path as hand-drawn geometry: on the map, in the
  Save Edits badge, written by the same batched R statement. That is the only
  basis on which programmatic drawing is safe to offer.
- **Five extractions** put shared logic where both the GUI and the assistant can
  reach it, with the components still calling them: `add-spatial-layer.ts` (from
  AddFeaturesDialog), `load-data-code.ts` (from LoadDataDialog), `map-export.ts`
  (from markdown/chunk-codegen), `save-edits.ts` (from useSaveEdits), and dialog
  state (above). `map:exportCode` and the Export dialogs therefore generate
  identical R.
- **Knowledge is progressive.** `buildOurgeoCore()` is ~1200 tokens in every
  prompt — what ouRGeo is, the every-action-echoes-its-R rule, the layout, the
  action index, and how to run a tutorial. The full reference (11 topics, written
  from ourgeo.dev/docs pages plus what only this file knows) sits behind
  `ourgeo_docs({topic})`.
- **A severed connection is not a data problem** (`src/lib/transport-retry.ts`).
  Axios reports *every* failure with no HTTP response — a stale keep-alive
  socket, an OS suspend, a network change — as the bare string `Network Error`.
  Told exactly that by `map:addLayer`, a local model concluded the *geometry*
  was at fault and spent twenty turns simplifying, reprojecting and rebuilding
  a perfectly good buffer. The module holds the predicate (raw axios shape or
  an already-translated `TransportError`), the retry (a fresh socket usually
  succeeds; an error carrying a `response` is R's considered answer and is
  never retried), and the two sentences that replace `Network Error`: one for
  the user, one for the model that says *retry once, then stop, and do not
  touch the data*. Project load and raster registration already retried this
  way; the vector layer path did not, which is how it surfaced.
- **The map's view is not where it looks like it is** (`src/lib/map-view.ts`).
  The Spatial Editor has *named sessions* — map workspaces, each owning a set
  of layers AND its own extent — so `MapView` renders
  `sessionViewState ?? globalViewState`, and `add-spatial-layer.ts` creates a
  "Default" session the first time any layer is added. From that moment
  `useSpatialStore.viewState` is a mirror the map writes and never reads.
  `map:setView` wrote the mirror: asked for a tour of Spain, the assistant put
  the landmarks on the map and then moved the mirror seven times — every call
  reported success, the console logged every one, and the map never moved.
  `mapView()` / `setMapView()` state the precedence once and both writers use
  it (MapView's `onMove`, and anything asking the map to move).
  Related: react-map-gl deliberately does NOT echo a prop-driven camera change
  back as a `move` event, so `onMove` never runs for one — MapView refreshes
  `viewBbox` from an effect on `viewState` as well, or the map would show
  Barcelona while an export wrote the extent before it.
- **Never exposed:** the AI panel itself (an assistant that can close its own
  panel can end the conversation), API keys, and posting to the forum.

## Markdown & R Markdown (v1.9)

`.md` / `.Rmd` / `.qmd` are first-class documents in the code editor.

**Language is a FIELD on the tab, not a `TabType`** (`TabState.language`,
`src/lib/markdown/doc-kind.ts`). `TabType` selects which component renders and
gates the four `t.type === 'code'` predicates that decide what persists
(`session-persistence.ts:24,37`, `editor.ts`); a `'markdown'` TabType would have
been silently dropped from `session.json`. Tabs written before this feature carry
no `language` and default to `'r'`.

- **Grammar** (`rmarkdown-monarch.ts`): Monaco's stock markdown Monarch ships
  already, but its GFM fence rule needs a word character after the backticks, so
  it matches neither fence rule on ```` ```{r label} ````. The result is worse
  than a miss: the *closing* fence is read as an *opening* code block and the
  rest of the document inverts. The derived `rmarkdown` language adds one
  brace-aware rule with `nextEmbedded`, so chunk bodies highlight as R. Pinned by
  `rmarkdown-tokenize.test.ts`, which runs Monaco's real tokenizer. Because this
  imports Monaco's internals (`monaco-editor/esm/vs/basic-languages/markdown/`),
  `monaco-editor` is a **direct, exactly-pinned** dependency rather than whatever
  `@monaco-editor/react` happens to hoist.
- **Actions** (`markdown/actions.ts`): one declarative catalog → three consumers.
  `apply-source.ts` is a pure `computeMdEdit(text, selStart, selEnd, action)`, so
  every wrap/unwrap toggle and list-renumbering rule is testable with no DOM;
  `MarkdownRibbon` is a thin Monaco adapter over it (`executeEdits`, never
  `applyExternalContent` — that does a whole-model `setValue` and destroys the
  cursor and undo stack). Ribbon primitives live in `src/components/ui/ribbon.tsx`.
- **Two escapes from "data-only"**, both injected rather than imported, so the
  catalog and `apply-source.ts` still test with no app running:
  - `prompt` — values the editor can't infer. Link and footnote are the only
    users, and both were previously inserted with the caret marker still in the
    text (a bare `[^]`). `MdPromptDialog` collects them; `applyPromptValues`
    folds them into a concrete source op. The host recognises these by candidate
    id so `/link` opens the same dialog the ribbon button does.
  - `dynamic` — a body generated from live app state, via the
    `ChunkBodyGenerator` passed to `resolveActionBody`. Generated bodies are
    marked `literal`, which skips `$N` snippet expansion: R code containing a
    `$`-digit sequence would otherwise be silently corrupted.
- **Slash menu**: `getCompletions(text, offset, deps, mode = 'r')`. The mode is
  **defaulted**, which is what structurally stops the shared R console
  (`Console.tsx:274`) from ever seeing markdown candidates — locked by a
  regression test asserting the no-argument call is byte-identical. `/` opens the
  popup via `CompletionResult.autoOpen`, **not** by widening the `structural`
  regex in `useCompletion.ts` (adding `/` there would pop the menu on `a/b`).
  Inside a chunk, `context-markdown.ts` slices the body and delegates to the R
  analyzer with shifted offsets, giving full R autocomplete in chunks.

  Three surfaces, one catalog, ranked by one function (`markdownSlashMenu`):

  | where | how it opens | what accepting does |
  |---|---|---|
  | Source, empty caret | the analyzer sees `/` in the text | replaces the typed `/query` with the action's text |
  | Source, over a selection | Monaco `onKeyDown` swallows the `/` | hands the action to the ribbon backend, which wraps/prefixes the selection |
  | Visual (both) | `visual/slash.ts`, a ProseMirror plugin | `applyVisualAction`, same as the ribbon button |

  Rows carry the catalog's own lucide icon (`CompletionCandidate.icon`), tinted
  per group by `GROUP_TINT`, so a `/` row and its ribbon button show the same
  picture. R candidates keep the typographic glyphs from `icons.ts`.

  **Over a selection the `/` never reaches the document** — typing it would
  replace the selected lines, which is the opposite of the request. Because
  nothing can be typed, the keystrokes that would filter the list are
  intercepted and accumulated instead (`slashOverSelection` in `CodeEditor`, the
  selection branch of `handleKeyDown` in `slash.ts`). In Visual mode the plugin
  detects the typed `/` in its `view().update` rather than in `handleKeyDown`,
  so the character the user sees and the range deleted on accept always agree.

### Map chunks (`markdown/chunk-codegen.ts`)

"Chunk: current map" and "Chunk: export current plot" generate real R from the
layers, symbology, view and annotations currently on the map, by calling the same
`generateTmapCode` / `generateGgplotCode` the Spatial Editor's Export dialogs
call — a map written into a document and a map exported from the dialog are the
same code. With nothing on the map the generator returns null and the action
falls back to its static scaffolding.

- `buildMapChunkParts` returns the header and code **separately** because Visual
  mode builds a ProseMirror `code_block`, not a string of fences.
- The engine is `useMarkdownSettingsStore.mapChunkEngine` (Settings → Documents,
  persisted in `markdown-settings.json`): `tmap` (default), `ggplot`, or `auto`,
  which follows `spatialSettings.lastExportMode` — whichever Export dialog the
  user opened last.
- The figure variant reuses each generator's `exportOpts` to emit its own save
  call, and its chunk is `include=FALSE`: it exists to WRITE the file that the
  following `![](figures/…)` references, so letting it also render inline would
  put the same figure in the knitted document twice.

### Chunks and inline output

- **Identity** (`chunk-identity.ts`) is the crux. Not a content hash (throws
  output away on every keystroke) and not an index (insertion shifts everything):
  an explicit label is the key — knitr already requires uniqueness — then exact
  code match, then a positional pass, then a uuid. The ribbon auto-labels chunks
  it creates, so almost everything takes the label path. **Invariant: editing a
  chunk preserves its id and marks the output `stale`, never drops it.**
- **Execution** (`r/lib/handlers-rmarkdown.R`): a separate endpoint because
  `/r/execute` points the default device at a single fixed-name PNG
  (`server.R:33-37`) and does one `recordPlot()` — a chunk drawing three plots
  loses two, and broadcast plots carry no caller attribution. Verified: a
  fixed-name device yields 1 file, `png("…%03d.png")` yields 3.
- **Rendering** (`chunks/monacoChunkLayer.ts`): decorations for chunk chrome, a
  **content** widget for `[▶]` (scrolls with the text; overlay widgets are
  viewport-fixed and CodeLens would need a language service this repo has none
  of), and view zones for output with `heightInPx` (`heightInLines` is wrong
  under `wordWrap: 'on'`). React mounts via `createPortal` from the CodeEditor
  tree, not a per-zone `createRoot`, so context survives. The `ResizeObserver`
  watches an **inner** wrapper — observing the zone's own node makes the height
  you set feed back into the measurement.
- **Zones belong to the EDITOR, not the model.** There is one editor and tabs
  swap via `setModel()`, so `chunkLayer.detach()` runs *before* the swap or the
  previous tab's outputs float inside this tab's text.
- Outputs live in `src/store/chunks.ts`, deliberately **not** on `TabState` —
  they hold base64 PNGs and would otherwise be serialized into `session.json`
  and every `.ourgeoproj`.

### Knit

`electron/main/knit.ts` spawns a child `Rscript` rather than using the R server:
knitr's contract is a clean session (catching "works in my console, fails on
knit"), a render can take minutes and the server is serial, and a child can be
killed. `GET /rmarkdown/deps` drives `knit-deps.ts` so each format is
**pre-disabled with a specific reason** before the user clicks — the common
failure is missing pandoc, which is not an R package. `knit-errors.ts` turns
knitr's output into a hint and a line number to jump to.

### Publish to the forum (`src/lib/forum/`, `electron/main/forum.ts`)

The Publish button beside Knit knits an `.Rmd` to markdown and posts it to
ourgeo.dev/forum.html as a new discussion.

**The forum is a static site on Supabase**, not an API: a post is an insert into
`threads`, figures go to the `post-images` storage bucket with a row in
`post_attachments`, bound to the thread afterwards by `link_attachments()`. The
schema lives in the separate `ourgeo-website` repo, and every gate — trust
level, quota, per-post image cap, category role — is a Postgres trigger or RLS
policy whose refusal message IS the user-facing sentence.

- **Markdown, never HTML.** The forum's renderer HTML-escapes everything before
  emitting a tag, so a knitted HTML document would render as literal markup;
  bodies are capped at 12,000 characters where self-contained HTML is hundreds
  of KB; and `data:` image URIs are rejected outright. Markdown is not a
  preference here, it is the only thing that works.
- **All of it runs in the main process.** The access token never reaches the
  renderer, so a bug in the UI cannot post as the user. The renderer only
  transcodes pixels (it has a canvas; main does not) and asks for named
  operations.
- **Auth is PKCE with a loopback redirect** on 127.0.0.1:8788–8790, which is
  what lets one flow cover all three sign-in methods: google/github through
  `/auth/v1/authorize` in the real browser, email through `/auth/v1/otp` as a
  magic link that lands on the same loopback. The verifier stays in the main
  process. **The ports must be listed in Supabase → Authentication → URL
  Configuration → Redirect URLs**, or the browser round trip dead-ends.
- The refresh token is stored with Electron `safeStorage` (`forum-session.bin`),
  not the plaintext `api-keys.json` convention — unlike an API key it grants the
  ability to post as the user. With no OS keyring available nothing is stored
  and the user signs in again next launch.
- **Figures upload before the thread is created.** A document whose images are
  refused then fails with nothing published; the other order would leave a
  public post missing half its figures and no way to fix it from the app.

`publish-markdown.ts` is a pure transform bridging pandoc's output to the
forum's small vocabulary, and each rule exists because of something real in the
renderer: indented chunk output becomes fenced (there is no indented-code rule,
so a printed data frame would arrive as prose), ``` ``` r ``` becomes ``` ```r ```
(the fence regex needs no space, or a stray `r` lands on the first code line),
pipe tables become aligned text in a fence (there is no table rule at all), and
raw HTML is dropped. Pinned by tests against a fixture captured from a real
`rmarkdown::render()` run.

### Visual mode

Milkdown (ProseMirror + remark). remark was already in the tree via `remark-gfm`,
so the parser driving Visual mode is the same one driving the round-trip checker —
with Tiptap or Lexical, a second markdown implementation would put a permanent
bug class on the Source↔Visual seam. Every Milkdown import is confined to
`src/components/editor/visual/` behind `VisualEditorHandle`.

- **The text always owns the truth**; Visual is a projection. It *replaces* the
  editor rather than splitting, so only one is mounted and there is no sync loop.
- **Front matter never enters ProseMirror** (`front-matter.ts`) — remark would
  read `---` as a thematic break and destroy it.
- **The switch is gated** on `roundtrip.ts`, which checks idempotence at the
  second pass plus structural equality and flags raw HTML with line numbers. The
  invariant is idempotence, never byte preservation — the first pass may
  normalise formatting.
- **A no-edit toggle is byte-identical**: entering records a baseline; if the
  serialization is unchanged on exit, the *original* text is written back, so
  looking at Visual mode never reformats the file or marks it dirty. Write-back
  uses `pushEditOperations`, not `setValue`, so Monaco's undo survives.
- **Exit serializes the live doc** (`getMarkdown()` action), never the value from
  the `markdownUpdated` listener — that listener is **debounced by 200 ms**
  inside Milkdown, so a snapshot from it silently drops whatever was typed in the
  last fifth of a second, which in practice is every edit made just before
  clicking "Source".
- `joinFrontMatter` restores the blank line after the front matter: no markdown
  serializer emits a leading blank line, so without it every trip through Visual
  mode would shift the document up by one.
- **Escapes are minimised at the serialization boundary** (`escapes.ts`).
  remark-stringify escapes defensively: every `_`, `*` and `~` in a text node
  comes back with a backslash, so a document that merely *visited* Visual mode
  returned with `geom\_line()` where the author wrote `geom_line()` — which in
  an R Markdown document is the difference between prose and nonsense.
  `minimizeEscapes` removes an escape only when the document still parses to the
  same tree without it, so `geom_line()` loses its backslashes (intraword `_` is
  not emphasis) while `x\*y\*z` keeps them (unescaped it becomes emphasis).
  Candidates are grouped by line and character and accepted whole, because
  dropping one half of `\_id\_` leaves `\_id_` — same meaning today, a trap
  tomorrow. It runs inside `normalize()`, not just at the Visual boundary: the
  mode switch compares against that baseline, so a baseline that still carried
  the escapes would make a look-and-leave toggle rewrite the file.
- **Position survives the switch** (`doc-position.ts` + `visual/anchor.ts`).
  There is no exact correspondence between a markdown offset and a ProseMirror
  position — `**bold**` is eight characters in one and four in the other — so
  the anchor is *top-level block index + alphanumerics into it*. Markdown syntax
  is punctuation, so counting alphanumerics skips exactly the characters that
  exist in one representation and not the other. Exact between blocks,
  approximate within one, which is the right trade for landing the reader on the
  paragraph they were reading. `contentStartOf` descends to the first positioned
  leaf so `# `, `- ` and a chunk's ```` ```{r label} ```` header don't count.

  **Two anchors travel, and they are independent.** The VIEW anchor drives
  scrolling and is read from the viewport — Monaco's
  `getVisibleRanges()[0].startLineNumber`, and in Visual the first top-level
  block whose rect bottom is below the pane top (with the fraction scrolled past
  mapped onto its character count, so a long chunk resumes mid-way). It is
  restored to the TOP of the destination viewport, because that is where it was
  measured from. Following the caret instead would land the reader wherever the
  cursor happened to be left, which after any scrolling is not what they are
  looking at.

  The CARET anchor is carried separately and **written back only when the reader
  moved it**: `entryCaret` is recorded on the way in and compared on the way
  out. A mode toggle is not an edit, so an unchanged caret is left exactly where
  it is rather than re-derived from an anchor — the anchor is exact to the
  alphanumeric, not to the byte, so round-tripping an untouched cursor would
  nudge it for no reason. Hence `setCaretAtAnchor` and `scrollAnchorToTop` are
  separate calls; ProseMirror's `scrollIntoView()` flag could not be used for
  the second even in principle, because it needs a transaction and therefore a
  selection change.

  Both restores scroll by hand. Visual: two frames after `create()`, because the
  pane's scroll height is still settling and ProseMirror's `scrollIntoView()`
  flag no-ops on a box that has not finished growing. Source: two frames plus an
  explicit `editor.layout()`, because Monaco spends Visual mode inside a
  `display:none` wrapper and has no width until React unhides it — and with
  `wordWrap: 'on'` line heights depend on width, so scrolling before that
  relayout computes tops for a zero-width editor.
- Known gaps: `$…$` math renders as literal text; **footnotes have no node in
  Milkdown's commonmark+gfm schema**, so the ribbon dims them in Visual mode
  (`VISUAL_UNSUPPORTED`) and `roundtrip.ts` flags them as unsupported. That flag
  matters because remark round-trips footnotes *perfectly* — a remark-only check
  sees no loss, while ProseMirror would drop them.

#### Chunks in Visual mode (`visual/chunk-view.ts`)

- **Options survive the round trip.** mdast splits ```` ```{r a, echo=FALSE} ````
  into `lang: "{r"` + `meta: "a, echo=FALSE}"`, and Milkdown's stock code_block
  keeps only `lang` — so everything after the first space was DROPPED on the way
  back to markdown, a silent edit to the user's document just for looking at it.
  `chunkAwareCodeBlock` (`codeBlockSchema.extendSchema`) carries `meta` both ways.
- **Upgrade on focus, per the plan.** Each chunk holds two stacked layers: a
  read-only hljs-highlighted `<pre>` and the real editable `contentDOM`. CSS
  shows one at a time, driven by the `is-active` class that `activeChunkPlugin`
  puts on whichever code block holds the selection. No per-chunk editor is
  constructed, so a 50-chunk document stays cheap.
- Clicking the read-only layer maps the point back to a character offset with a
  **Range from the layer's start to the hit point** — a click in the `<pre>`'s
  padding resolves to the ELEMENT, not a text node, so walking text nodes would
  land every such click at the end of the chunk.
- Output is keyed the same way `chunk-identity.ts` keys it (`label:<label>`), so
  a chunk run in Source mode still shows its output in Visual and back, and Run
  goes through the same `runChunkCode` path.

## Themes

Three independent axes, all in `theme.json` and all on `useThemeStore`.

- **App theme** (`src/lib/themes.ts`, 10 of them, one light) owns the interface:
  the `--geo-*` custom properties, the basemap, the scene art, and — crucially —
  the editor's `colors` block.
- **Code theme** and **markdown theme** (`src/lib/editor-themes.ts`, 26 and 16)
  own token colours and nothing else. **Switching either can never move the
  editor background or the artwork behind it** — the palettes carry no
  background at all, `buildMonacoTheme` reads its `colors` block only from the
  app theme, and `editor-themes.test.ts` asserts the two are independent.
  Switching the *app* theme resets both to that theme's defaults; each app theme
  ports its own former syntax colours forward as a code and markdown theme of
  the same id, so the out-of-the-box look is unchanged.

**One Monaco theme carries both palettes.** Monarch appends `tokenPostfix` to
every token — `.r` for R, `.md` for markdown and for the derived `rmarkdown`
grammar — and `TokenTheme.match` ignores the language id, so that postfix is the
only thing separating an R `keyword` from a heading. It is enough: `bare` rules
are the code palette (which is also how *chunks follow the code theme* — every
embedded language falls through to them) and `.md` rules are the markdown
palette. One name, `EDITOR_MONACO_THEME`, redefined on change; `defineTheme`
re-applies a live theme, so nothing swaps on tab change.

**The postfix is a suffix, not a namespace.** Monaco's trie walks dot segments
from the head and falls back to the nearest ancestor, so
`keyword.table.header.md` resolves keyword→table→header and *never reaches*
`keyword.md`. Every multi-segment markdown token needs its own full-path rule; a
forgotten one silently paints one prose construct with a code colour.
`editor-themes-tokens.test.ts` runs Monaco's real tokenizer over an `.Rmd`
fixture and resolves all 32 emitted tokens through a faithful re-implementation
of that trie — it is the only thing that catches this class of bug.

Two consequences worth knowing:

- **Markdown body prose is not targetable in Monaco.** Both grammars set
  `defaultToken: ''`, and Monaco turns `editor.foreground` into the `''` rule
  ahead of ours. `MarkdownPalette.text` therefore drives Visual mode and the
  picker preview only.
- **`inherit: true` leaks the base theme's rules** into `.Rmd` html/sql/yaml
  chunks, so `buildMonacoTheme` restates every one of them from the code
  palette. It also takes the base's `rules` array *by reference* and pushes onto
  it on each resolve — which is why the redefine effect's deps are exactly
  `[themeId, codeThemeId, markdownThemeId, revision]` and must stay that way.
  `revision` (on `useThemeStore`) is the fourth only because the Theme Studio
  commits on a debounce: it moves once per pause, not once per drag.

**Non-Monaco surfaces** follow through CSS custom properties (`--ourgeo-code-*`,
`--ourgeo-md-*`, written by `applyEditorTheme` beside `applyTheme`, with `:root`
defaults in `globals.css` because an undefined custom property invalidates the
whole declaration rather than falling back). They drive the `.hljs-*` rules that
replaced the hard-coded `highlight.js/styles/github-dark.css` import — so
Visual-mode chunk highlighting and the AI chat's code blocks now follow the code
theme instead of being GitHub-dark under every app theme — and the
`.ourgeo-visual .ProseMirror` heading/link/quote/inline-code colours. Chunk
chrome (`.ourgeo-chunk-*`, `.ourgeo-vchunk-{head,run,out}`) deliberately stays on
`--geo-*`: it is chrome, not syntax.

### The Theme Studio (v1.10)

Settings → Appearance → **Theme Studio…** (`ThemeStudioDialog.tsx`, a *sibling*
of Settings in `EditorLayout` — nesting it would stack two focus traps). One
dialog, three tabs, all three axes: the user builds their own app themes, code
palettes and markdown palettes, always by copying an existing one.

- **The registries became live.** `THEMES`, `CODE_THEMES` and `MARKDOWN_THEMES`
  are now mutable objects seeded from `BUILTIN_*`, and `registerCustomThemes` /
  `registerCustomEditorThemes` replace the user's entries in one pass. Forty
  call sites already read `THEMES[id]` and reach fields off the result — a user
  theme has to BE a `ThemeDef` or every one of them grows a branch. Object
  identity never changes, so React cannot subscribe to a registry: components
  read `useCustomThemeStore` and call `themeList()` / `codeThemeList()` /
  `markdownThemeList()`. A user id can never shadow a shipped one; the shipped
  themes stay read-only, because an ouRGeo update would otherwise silently
  revert an edit and there would be no honest "reset to default".
- **Hex in, HSL out** (`custom-themes.ts`). The authoring model is hex, because
  `<input type="color">` speaks nothing else; `ThemeDef.vars` is derived, since
  `globals.css` composes those triples with alpha (`hsl(var(--geo-accent) /
  0.4)`) and a hex there invalidates the whole declaration. `palette`,
  `swatches` and the editor chrome come along the same way. Nothing derived is
  ever stored — a hand-edited file cannot then disagree with itself.
- **Colours are validated on the way IN.** Monaco's `ColorMap.getId` throws on
  anything that is not six or eight hex digits, inside `defineTheme`, taking the
  editor with it and leaving no stack that points at the theme file. So every
  colour in an imported or persisted theme is normalised to six digits or the
  import fails with the offending field named. Three-digit shorthand is expanded
  rather than refused; eight-digit is refused rather than silently truncated.
- **`kind` is a field, not an inference.** A code palette and a markdown palette
  are both a flat map of colour names, so nothing in the *payload* tells them
  apart. With the kind declared, importing an App theme file into the Code
  Themes list answers *“That is an App theme file (“Sunset Slate”), and this is
  the code theme list. Import it from the App Themes tab.”* — rather than
  complaining about a missing property. `classifyThemeFile` also recognises the
  two ouRGeo files most likely to be picked by mistake (`theme.json`, which
  records which themes are *selected*, and a project manifest) and says so.
- **Artwork is inlined as `data:` URIs**, not referenced by path — an exported
  theme has to carry its own pictures or it arrives on another machine pointing
  at nothing. That is what the size caps in `BACKGROUND_SPEC` / `ICON_SPEC` are
  for; they are enforced at the file picker, where the user can still choose a
  different image. The backdrop replaces the generated scene behind the editor
  and carries its own opacity and grey-scale (a photograph and a flat SVG do not
  want the same treatment); the card image represents the theme in the picker.
  Both are optional and `themeIconUri` falls through icon → backdrop →
  generated scene, so a card is never blank. A user theme with no backdrop
  still gets a scene: `sceneSvg` looks up `basedOn` in the shipped drawing
  table and recolours it from the user's palette.
- **Edits commit on a debounce; the preview is instant.** `ThemePreview` is a
  self-contained mock drawn from the draft with inline styles, sharing no custom
  properties with the app — which is also what lets you look at a theme you have
  not switched to. The real application is updated once the user pauses (250 ms),
  and `useThemeStore.refresh()` re-applies and bumps `revision`.
- Themes live in **`custom-themes.json`**, separate from `theme.json` on
  purpose: that file records which themes are *selected* and is merged on every
  click of a picker, while this one holds definitions with megabytes of inlined
  artwork.
- **`createJsonFileStore` now serializes its writes** (`persistence.ts`).
  `merge` is a read-modify-write across two IPC round trips and `setTheme`
  fires three at once; run concurrently the second erases the first's key, and
  two overlapping `writeFile`s to one path were observed leaving a *splice* of
  both payloads on disk — unparseable JSON, which the loader reads as `{}`, so
  the app quietly reverted to Dark on the next launch. One promise chain per
  file. Pinned by `persistence.test.ts`.
### Themes the assistant makes (`ai-actions/theme.ts`)

A user can now ask for a theme in prose, so the assistant can build one rather
than describe where the Studio is. Switching stays in `ui.ts` (`ui:theme`,
`ui:codeTheme`, `ui:markdownTheme` — a one-line action like toggling a panel);
the `theme` group is authoring: `theme:list`, `theme:inspect`, `theme:create`,
`theme:setColors`, `theme:configure`, `theme:setImage`, `theme:duplicate`,
`theme:delete` (confirm tier), `theme:export`, `theme:import`.

- **A param's enum can be resolved at call time** (`ParamDef.valuesAt`), and
  the theme switches use it. This is not a nicety: `validateArgs` runs BEFORE
  the action, so a fixed `Object.keys(THEMES)` captured at module load refused
  a theme the assistant had just built — *"must be one of: dark, bespin, …"* —
  and the handler that resolves against the live registry was never reached. A
  local model duly reported to its user that switching to a theme it had made
  was impossible and they would have to click the button themselves. The same
  resolver feeds `describeAction`, so `list_ui_actions` shows the model what
  exists rather than what shipped.
- **`ParamDef.lenient` marks an enum as advisory**, and the theme switches set
  it so a theme can be named by its LABEL. A model that has just created
  "Half-Life 2" reaches for that string, not for `my-half-life-2`; gating
  centrally on the id list would move the same wall one step along, so the
  check lives in the action, where `resolveThemeArg` matches an id, then a
  label, ignoring case and punctuation.
- **`theme:create` takes `apply`**, because "make me a theme" almost always
  means "and use it", and the two-call form was where the failure surfaced.
- **The refusals are the design.** A shipped theme refused by name, pointing at
  `theme:duplicate`; an unknown colour key answered with the valid list; a
  colour name or malformed hex answered with `#rrggbb` — because `defineTheme`
  would otherwise throw deep in the editor with no stack pointing at the model's
  mistake. `theme:setColors` also reports the resulting contrast ratios back,
  flagged when under 4.5:1: it is the one failure a model cannot see.
- **`colors` and `chrome` are separate parameters** for the same reason the
  Studio has two columns — `panel`, `bg`, `border`, `accent`, `muted` and `fg`
  exist in both sets, so a flat map could not say which was meant.
- The `themes` topic in `ai-skill-ourgeo.ts` is the skill itself: the three
  axes and the no-background invariant, the create-from-a-template workflow,
  what each colour paints, and the palette-building rules (move a family
  together, one accent hue, keep the semantic colours semantic).

## Workspace layout (v1.11)

Four zones — `left`, `center`, `right`, `bottom` — each an ordered list of
panels sharing one axis, either **split** or **tabs**. Any panel goes in any
zone, including the editor and the console.

Panel sizes used to be five `useState`s in `EditorLayout` (never persisted) and
panel position was decided by which JSX block a panel had been written into.
That is fine right up until something outside the component needs to read or
change it — the same argument that moved dialog state into `store/ui.ts`, and it
applies twice over now the assistant is expected to rearrange the workspace on
request.

- **`src/lib/layout/model.ts` is pure and React-free.** `movePanel`,
  `setZoneSize`, `setZoneMode`, `normalize` — every operation returns a new
  layout, so a caller can *preview* a move (which is what the drag indicator
  does) without committing. Tested with no DOM, like `computeMdEdit`.
- **NOT a nested split tree.** A tree is the general model, but every operation
  becomes recursive, `normalize` becomes hard to reason about, and — deciding
  argument — an assistant driving it would have to describe a path through the
  tree rather than name a zone. "Put the map on the left" has to keep working
  when a local model says it. The cost is one arrangement the old layout had:
  Help sitting *above* the plot/map/chat row. That was a special case written
  out three times; Help is now a panel in the right zone like any other, and
  `tabs` mode gives it the full height back.
- **`normalize` carries the invariants**, and they are the safety story: the
  editor is never homeless (a layout that lost it puts it back in `center`) and
  never closed; a panel is never in two zones (two placements means two MapLibre
  instances writing to one store); unknown panel ids — a plugin the user removed
  — are dropped; sizes clamp to each panel's `min`; `active` always names an
  open panel in that zone. Run on load, on import, and after every operation the
  store did not originate.
- **Registries, not JSX.** `layout/panel-meta.ts` (id, label, min, default zone)
  and `layout/toolbar.ts` (the 14 buttons, previously 14 copy-pasted `<Button>`
  blocks) are data. `ai-actions/targets.ts` DERIVES its `toolbar.*` entries from
  the latter rather than listing them again.
- **`panel-meta.ts` and `panel-render.ts` are separate from `panels.tsx`** for
  one reason: the component half imports `CodeEditor` → Monaco, which touches
  `window` at import time. The first version had `ai-actions/ui.ts` reaching
  panels through the .tsx, and eight node-environment test files died on
  `ReferenceError: window is not defined`. Anything that only reasons about the
  layout imports the meta module.
- **The feature stores still own `isOpen`.** `usePlottingStore.addPlot` opens
  the plots panel when a plot arrives; `useHelpStore` opens itself on `?lm`.
  `store/layout.ts` MIRRORS them — one subscription per panel, one direction —
  so there is exactly one writer per panel. `init` is the one moment the
  direction reverses, pushing a restored `layout.json` into the stores; getting
  that backwards loads the file and then immediately overwrites it with seven
  `false`s, so the workspace comes back empty every launch while the file on
  disk says otherwise.
- **Inside a zone, a panel's size is a SHARE, not pixels.** The first version
  gave every panel a px size with the last one `flex-1`, so opening Environment
  and Packages together left the first on a fixed 260px and the second with
  everything else — and no arithmetic in a pure model could have evened that
  out, because the model cannot know how tall the column is. Weights sidestep
  the measurement: equal weights ARE an even split, at any height, for any
  number of panels (`flex-grow: w; flex-basis: 0`), and the browser divides.
  Minimums stay in px and are enforced where px exist, as `min-height` on the
  panel. `InnerDivider` measures its own two DOM siblings on mousedown — the
  only place the pixels exist — and `splitPanels` re-weights just that pair,
  keeping their combined share, so a drag moves one boundary and no other.
  Double-clicking a divider calls `evenPanels`.
- **Shares are deliberately NOT persisted** (`forgetWeights`, applied by
  `saveLayoutFile`): every zone opens shared equally, whatever was dragged
  yesterday. Where a panel lives and how wide its column is are the
  arrangement, and those persist as before. A *preset* keeps its shares —
  applying one is a deliberate in-session act, and "restore that arrangement"
  means all of it.
- **The panel grip drags on mouse events, not HTML5 drag-and-drop**
  (`Zone.tsx`). It was dnd, and pressing the grip did nothing at all — the
  worst way for a control to fail, since the tooltip and the cursor both say it
  should work. Two things were wrong and only one was the dnd: **the drop was
  committed by the zone that was dropped on**, and every zone's overlay heard
  the mouseup. React flushes a state update from a discrete native event
  SYNCHRONOUSLY, so the first zone to hear it — the left one, always, because
  effects register in tree order — cleared the drag mid-dispatch, unmounted
  every overlay and took the remaining listeners with it. The zone under the
  cursor never ran. It worked perfectly from a script, because a synthesized
  event's update is merely batched: only a real hand could fail it. The drop
  now happens in `startPanelDrag`, once, hit-testing `data-drop-zone`
  attributes; the overlays only light up. Same pattern as the Contents list's
  layer reorder, which has always worked.
- **An empty zone is a drop target only while dragging** (`EmptyZoneTarget`).
  A zone with no panels renders as nothing, which is right until you drag the
  last panel out of one — the column then has no pixels, and a panel could be
  moved out of a zone but never back into it.
- **Zone sizes are clamped at render, not in the model.** The stored px size is
  the user's and is never rewritten, but a measured ceiling keeps the centre
  above a floor — what the old layout did by hand with
  `max = min(innerWidth * 2/3, innerWidth - 380)`. Without it a stored 240px
  console on a short window leaves fifty pixels to type in, and three open
  panels leave the editor none.
- **Settings → Workspace** (`LayoutSettings.tsx`) is the third way to reach the
  arrangement, and — with the grips off by default — the first one most users
  will find, as well as the only one that shows you what you have. The grip is a gesture
  and the assistant is a conversation; neither lists the arrangements you saved,
  and neither is where a user looks after moving something by accident — which
  is why **Restore default arrangement** sits with the list rather than
  anywhere else.
  - **`dragEnabled` disables the GESTURE, not rearranging.** `layout:movePanel`,
    the presets and Restore all still work with the grips off, and the stored
    layout is untouched — otherwise switching it off would strand a user in
    whatever arrangement they had. It lives in `layout.json` beside the layout
    and the presets.
  - **It ships OFF**, and only an explicit `true` turns it on — an absent or
    unreadable value is OFF, which is the state a new install is in rather than
    one the user would have to recognise as wrong. The grip is hover-revealed
    over every panel's own header, so a gesture nobody went looking for is one
    that mostly fires by accident. The cost is that the grip's **right-click
    menu goes with it** — Move to, Add another, Remove — so the setting's
    description says so, and Settings → Workspace carries add and remove
    itself. The store also starts `false` rather than `true`, or a grip would
    flash onto every panel for the length of one file read.
  - **Arrangements export as `.ourgeolayout.json`** (`layout/layout-file.ts`),
    following the theme format for the same reason: an envelope that says what
    the file IS, so a file picked by mistake is answered by naming it (a theme,
    `theme.json`, a plugin manifest, a project manifest) rather than complaining
    about a missing property. ouRGeo's own `layout.json` is the likeliest
    mis-pick and is also a real arrangement, so it is READ, under the name
    "Imported layout". A format version from the future is refused; an
    arrangement whose `LAYOUT_VERSION` is stale is dropped. Imports are
    `normalize`d on the way in, because a file from another machine can name a
    panel this ouRGeo has never heard of.
- `layout.json` sits with `theme.json` on the **preference** side of the userData
  split, never in the `will-quit` delete list. The flush on quit is a single
  `write`, not a `merge`: a merge is a read-modify-write across two IPC calls and
  the renderer is destroyed as soon as it calls `app:confirm-quit`, so the layout
  was silently never saved on exit while `session.json` always was.
- Actions: `layout:describe / movePanel / setPanelSize / evenPanels /
  setZoneSize / setZoneMode / showTab / setToolbarButtons / setPanelDrag /
  savePreset / applyPreset / listPresets / deletePreset / reset`. `setPanelSize` takes a
  **percent** of the zone, not pixels, and refuses a panel that is alone in its
  zone by naming `setZoneSize` — silently doing nothing there would leave the
  model telling the user it had made the map bigger. All `always` except the two that write
  disk — moving a panel is undoable by moving it back, and gating it behind
  Autopilot would mean the user most likely to want the interface adjusted for
  them is the one who cannot have it.

## Plugins (v1.11)

ouRGeo cannot be edited in place once installed: the renderer ships as one
minified bundle inside a read-only asar (AppImage is squashfs; deb/nsis are
root-owned), and `typescript`, `vite` and `esbuild` are devDependencies that
never ship. Changing ouRGeo itself will always mean cloning and building.

A **plugin** is the other route — capabilities added while the app runs. It was
unusually cheap to build because every blocker was already absent: the CSP in
`src/index.html` already permits `script-src 'unsafe-eval' blob:`; every
extension point is already a data object plus one function; and
`custom-themes.ts` was already a working "seed a mutable registry, validate each
user entry, drop the bad ones, never let a user id shadow a shipped one" loader.

### Three kinds, in order of preference

1. **Declarative JSON** — connectors, toolbox tools, actions, toolbar buttons,
   docs topics. No code, so no trust decision, and a model writing JSON against
   a schema succeeds far more often than one writing JS against a remembered API.
2. **R** — files `source()`d into the live session, echoed to the console.
3. **Code** — `main.ts`, compiled at load. The exception, not the default.

Themes and saved layouts are deliberately NOT contributable: both already have
an import path a plugin gains nothing over, and both would need an answer to
"what happens to the user's own when the plugin is removed" that neither
registry is built to give.

### The pieces

- `lib/plugins/manifest.ts` — validation, following `classifyThemeFile`: a
  refusal names the FIELD and the way out; one bad contribution is dropped
  rather than the whole plugin; a `manifestVersion` from the future is refused
  rather than half-read.
- `lib/plugins/compile.ts` — **`esbuild-wasm`**, in `dependencies` (13 MB), and
  the only new dependency. Loaded by dynamic `import()` so it costs nothing at
  startup, and its wasm arrives via `plugins:esbuildWasm` IPC as base64 — a
  `fetch` of a sibling file from a `file://` page under `default-src 'self'` is
  blocked, silently. Output is an **IIFE with a `globalName`**, not an ES
  module: the sandbox runs it inside `new Function`, which needs a statement
  list. There is no filesystem in the browser build, so imports resolve from
  the file map read over IPC — which is also the containment. Bundles cache to
  `<plugin>/.build/<hash>.js`.
- `lib/plugins/sandbox.ts` — a **soft** sandbox: the bundle runs in a function
  whose parameters shadow `electronAPI`, `require`, `process`, `fetch`,
  `localStorage` and friends. It stops accidents and casual reach-arounds, not
  intent — `({}).constructor.constructor` walks straight out, and only a Worker
  or a cross-origin frame would change that, neither of which can touch the DOM.
  The real control is **consent**, and the docs say so in those words rather
  than implying a safety this does not provide.
- `lib/plugins/host-api.tsx` — one frozen `ctx`. **No filesystem at all** (a
  plugin that needs disk writes R, where the user watches it run) and no
  `electronAPI`. Permissions gate by ABSENCE: without `network` there is no
  `ctx.http`, because a method that exists and always refuses is one a model
  keeps calling. Frozen shallowly per namespace — the first version deep-froze
  and walked into React's module namespace, freezing the mutable `current` refs
  and killing the renderer with an error pointing nowhere near here.
- `lib/plugins/loader.ts` — read, compile, run, then register EVERYTHING in one
  pass and bump the revision once (the registries replace their plugin half
  wholesale, so a partial pass drops the plugins already loaded). Reloading
  everything rather than diffing is deliberate: a plugin contributes to six
  registries, and a correct incremental update would cost more than a reload.
- **The crash guard.** The plugin's id is written to `plugins.json` BEFORE
  `activate` and cleared after. Finding it there at startup means that plugin
  took the app down; ouRGeo disables it, skips every plugin this launch, and
  says so. Without it, one bad plugin means an app that dies on launch and a
  Plugin Manager that can only be reached from inside the app that dies.
- `electron/main/plugins.ts` — `plugins:*` IPC. These exist rather than reusing
  `file:read`/`file:write` for one reason: **every path is confined to the
  plugins directory**. Plugin authoring is something the assistant does on the
  user's behalf, and `file:write` takes an unchecked absolute path.
- `lib/plugins/archive-policy.ts` — what a `.ourgeoplugin` may contain. Pure and
  tested, listed in `tsconfig.node.json` so `plugins.ts` compiles against it,
  the arrangement `terminal/shells.ts` already has with `terminal.ts`.

### What an archive is allowed to contain

A `.ourgeoplugin` used to arrive from the user's own machine — someone sent you
a file and you chose to open it. Three things about the import were only safe
under that assumption, and the one that matters is not a hardening detail, it
is a way for an archive to decide what runs:

- **The compile cache travelled inside the archive.** `plugins:pack` used
  adm-zip's `addLocalFolder`, which walks dotfiles, so `.build/<key>.js` went
  in; `plugins:unpack` restored it. `runMain` then keys the cache on
  `hashOf(JSON.stringify(files))` over the files `plugins:listFiles` reports —
  and that call SKIPS dotfiles — so an archive could carry innocuous sources
  plus a cache entry under the key those sources hash to, and the loader would
  run the cache entry **without compiling anything**. A reviewer would have read
  code that never executed. Dot-prefixed paths are now dropped at both ends,
  which also means an archive cannot forge the store's `.ourgeo-store.json`.
- **The traversal guard was `entryName.includes('..')`** — a substring test that
  refuses the innocent `a..b.ts` and accepts the absolute `/etc/passwd`. It is
  now a normalisation that can express neither, and `isDotPath` deliberately
  exempts `.` and `..`: counting them would turn `../../evil.js` into a silent
  drop rather than the refusal it has to be.
- **There was no ceiling**, so an archive that unpacked to a full disk was a
  supported input. Entry count and total unpacked size are capped, and each
  refusal says the reading it is actually pointing at — that you picked the
  wrong file.

`unpackArchive` is exported because the plugin store installs through it: one
place decides what an archive may contain, so a hostile one cannot be made
acceptable by arriving through the other door. Every entry is decompressed
before anything is deleted, or a failure halfway would leave the user with
neither the old plugin nor the new one.

### The registries went live

`ALL_ACTIONS` → `actionList()`, `API_PROVIDERS` → `providerList()`,
`CATEGORIES` → `categoryList()`, `OURGEO_TOPICS` → live, plus the panel and
toolbar registries. Same contract as `THEMES`: one writer, object identity never
changes, React subscribes to `usePluginStore.revision` instead. `GroupId` gained
`plugin.${string}`, and `GROUP_LABELS` became a live map whose insertion order
is what the model reads — shipped groups always first.

### Declarative connectors (`api-connectors/declarative.ts`)

`compileProvider(spec)` builds a real `ApiProvider` from JSON. Comparing the
fourteen shipped providers was the argument: outside the OGC XML trio they are
the same program — fetch JSON, read a path out of it, serialise the shared
`Query` into one of five dialects, emit an R one-liner. `DIALECTS` holds those
five (`odata`, `cql`, `esri`, `soql`, `params`) as tables of per-operator
templates; a test asserts the `odata` table reproduces the hand-written
`buildODataFilter` byte for byte across seven filter shapes, and that a spec for
the shipped OData provider generates identical R. `{x}` is URL-encoded and
`{{x}}` is raw — a cascade id in a path and a filter clause in a query string
need opposite treatment — and a query parameter whose value comes out empty is
dropped, because `&$filter=` is not the same request as no filter.

**What it deliberately cannot express**, and the docs say so, so a model does
not spend three turns trying: XML capabilities documents (WFS/WMS/WCS negotiate
versions by probing), adaptive probing (Esri's halving page size), and
cross-request derivation (extent reprojection, STAC asset discovery). Those
register a provider from code.

### The AI surface

`plugin:*` (list, inspect, readFile, scaffold, writeFile, validate, reload,
enable, disable, delete, export, import) and `connector:*` (list, inspect, open,
addServer, removeServer, probe, test).

- **`plugin:enable` is `confirm` and that is the whole trust model.** Writing a
  plugin changes nothing; enabling one is when code starts running.
  `plugin:disable` is `always` — switching something off is never the risky
  direction, and it is the first thing to try when the app misbehaves.
- **`plugin:writeFile` validates a manifest before writing it.** A saved broken
  manifest cannot be read back, which would cost the assistant the ability to
  fix its own mistake through `plugin:readFile`.
- **`connector:probe` and `connector:test` are the difference** between a model
  that can write a connector and one that writes a working one. A wrong
  `itemsPath` compiles, installs, and produces an empty dropdown with nothing on
  screen to explain it; probe reports the JSON's shape, and test walks the
  cascade against a real server and says which stage failed.
- Docs live in `ourgeo_docs`: `extending`, `plugin-connectors`, `plugin-tools`,
  `plugin-code`, `layout`. Two sentences in `buildOurgeoCore()` tell the model
  plugins exist at all — without which it would never open the topic. The core
  budget moved 6000 → 7000 chars for those plus 23 new action ids; it is a
  budget to defend, not a number to nudge.
- A test walks every topic for `group:action` tokens and asserts they resolve.
  It found `ui:listThemes` in the `interface` topic on its first run — an action
  that has never existed.

## The plugin store (v1.16)

A plugin had two ways to reach anybody: the assistant wrote it into the user's
own folder, or somebody sent them a `.ourgeoplugin` file. Both are private
exchanges. A plugin somebody spent a weekend on had nowhere to go, and a user
with a problem had nowhere to look.

The store is the third route — hosted on ourgeo.dev, browsable from the website
and from inside ouRGeo, **installable only from inside ouRGeo**. An author
submits; a moderator installs it, runs it, and approves or sends it back with a
note; approved versions appear. `electron/main/plugin-store.ts`,
`src/lib/plugin-store/`, `src/components/plugins/`, and — in the sibling
`ourgeo-website` repo — `db/schema-plugins.sql` and four pages.

### What "protecting the author's code" actually means

This has to be said the same way in the docs, the submit dialog and the code,
because the temptation to oversell it is the failure mode:

- What ships is a **built, minified bundle**. The author's TypeScript is never
  published.
- **Minifying is obfuscation, not encryption.** Plugin code runs in the
  renderer, so it must reach the user's disk in a form the loader can read.
- **Declarative contributions cannot be hidden at all.** Connectors, toolbox
  tools and actions are JSON in `ourgeo-plugin.json`, which the loader reads;
  R library files are read by R. Only `main` is compiled.
- Encrypting would need a key inside an AGPL binary, i.e. a published key. Cost
  with no protection; not built.

**The one real measure is the private bucket.** `plugin-bundles` is not public,
so a bundle is never on a URL the catalogue hands out, and downloading one needs
an account — enforced by a storage RLS policy (`can_download_bundle()`), not by
anything in this app. That is also why installing requires a sign-in while
browsing does not.

In the app, ouRGeo declines to hand the code on: no Export, no Files, and
`plugin:export`, `plugin:readFile`, `plugin:writeFile` and `plugin:inspect`'s
file listing all refuse. It is a decision, not a lock — the folder belongs to
the user, and deleting the sidecar restores Export. Every refusal names the
plugin's page, because a model told only "you cannot" works around it, and the
next thing it reaches for is `execute_r_code` and `readLines()`.

### The archive was already able to decide what runs

Found while building this, and fixed on its own (v1.15.1). `plugins:pack` used
adm-zip's `addLocalFolder`, which walks dotfiles, so the compile cache
`.build/<key>.js` went into a `.ourgeoplugin` and `plugins:unpack` restored it.
`runMain` keys that cache on `hashOf(JSON.stringify(files))` over the files
`plugins:listFiles` reports — and **that call skips dotfiles**. So an archive
could carry innocuous sources plus a cache entry under the key those sources
hash to, and the loader would run the cache entry without compiling anything. A
reviewer would have read code that never executed.

`lib/plugins/archive-policy.ts` is what an archive may contain now — pure,
tested, listed in `tsconfig.node.json` the way `terminal/shells.ts` is. Both
ends drop dot-paths; the traversal guard is a normalisation rather than
`includes('..')` (which refused `a..b.ts` and accepted `/etc/passwd`); size and
entry count are capped. `isDotPath` deliberately exempts `.` and `..`, or
`../../evil.js` would be a silent drop instead of the refusal it has to be.

### The artifact, and the one thing that must not be inlined

`bundleForDistribution` (`lib/plugins/compile.ts`) differs from the load-time
pass in three ways: `format: 'esm'`, `minify: true`, and **the host shims left
EXTERNAL**.

That last one is the decision with a long fuse. The shims inline `HOST_GLOBAL`,
`BUNDLE_GLOBAL` and the exact shape of the JSX bridge, all private to that file.
Inline them into a published artifact and every plugin in the store carries a
frozen copy of ouRGeo's internal ABI: rename `HOST_GLOBAL` and they all die at
once with `__ourgeo_host__ is not defined`, thrown inside `new Function` with a
stack pointing nowhere near the cause. Left external, `main.js` still says
`import { jsxs } from "ourgeo-jsx/jsx-runtime"` and the load-time pass hands it
whatever the shim means today. `format: 'esm'` is what makes that second pass
possible at all — it needs an entry module with a real export clause to
re-export `activate` from.

Use the `onResolve` hook, never the top-level `external:` array: a custom
resolver fires first and the array never gets a look-in. `legalComments: 'eof'`
rather than `'none'`, because stripping a licence header out of a file the
author vendored is a violation performed on their behalf.

`store-package.test.ts` runs the real compiler through both passes and executes
the result. It exists because "the minifier will not touch this identifier" is
exactly the kind of claim that turns out to be false one version later. The
build options are exported (`loadBuildOptions`, `distBuildOptions`) so it can:
esbuild-wasm's `wasmModule` path is browser-only, so a test going through
`loadEsbuild` could not run at all, and the options and the resolver plugins are
where the risk lives.

### A submission is two archives

`plugin.ourgeoplugin` is what a user downloads. `source.zip` is the author's
folder, readable by them and by staff and by nobody else.

**The source archive is not a courtesy.** A moderator asked to test and approve
a single minified line is performing theatre, and a review gate with no content
is worse than none, because it tells users a plugin was checked when it was not.

Both are staged in `.dist/<id>/` inside the plugins folder — dot-prefixed, so
nothing lists them and a staged build cannot be mistaken for an installed
plugin, and inside the folder so `contain()` still covers every path. They stay
on disk rather than crossing IPC as base64: the uploader is in the same process.

### Where the app's half lives

- **`electron/main/ourgeo-account.ts`** — extracted from `forum.ts`, because the
  account IS one account and two modules each holding a session would mean
  signing in twice for two features of one website. `rest()` gained an auth mode
  (`'optional'` sends the bearer only when there is one, which is what lets the
  catalogue answer a visitor and still tell a signed-in reader whether they have
  installed something); `friendly()` gained a subject, or a failed install would
  blame the forum.
- **`account:status`** is a pure disk check. The store dialog has to choose
  between "Install" and "Sign in to install" before it draws anything, and a
  full restore is a refresh grant plus a profile fetch.
- **`.ourgeo-store.json`** records where a plugin came from. Dot-prefixed, so
  `listFiles` never reports it, it is not an input to the compile hash, and an
  archive cannot forge one. It is the AUTHORITY; `plugins.json` keeps a copy for
  the update poll only, because that file's header promises deleting it "loses
  nothing else".
- **`installStoreArchive` refuses rather than replaces** when a folder of the
  same id is there and did not come from the store — unpacking deletes the
  target first, which is right for a reinstall and destructive for a plugin the
  user wrote. It also refuses when the archive's manifest id disagrees with the
  slug the store listed: those are the same field by design.
- **The download is checked against the length and sha256 the store recorded,
  before anything is unpacked.** Cheap, and the only thing between "the bucket
  was misconfigured" and "we installed it anyway".

### Updates are offered where you go to look at plugins

One batched call, once per session, on the first open of the Plugin Manager or
the store — not at startup. Startup spends a round trip on every launch for an
answer most launches do not need, and puts a message in front of someone who
opened ouRGeo to do something else. Memoised through the promise rather than a
boolean, because two dialogs can open in the same tick.

A **revoked** version is not an update and is not offered: approved, shipped,
then withdrawn, so it is switched off the moment we learn of it with a line in
the console saying why — the crash guard's shape in `loader.ts`. A dismissal is
keyed by version, so a later update is offered again: "not this one" is what a
person means.

### The server half (`ourgeo-website`)

`db/schema-plugins.sql`, applied third and **purely additive** — it re-declares
nothing from the earlier two files, so applying it once is enough and editing
them never obliges a re-run. That is why it does not write to `moderation_log`:
its `target_type` CHECK would have to be altered, and a re-run of `schema.sql`
would silently revert it, turning every approval into a constraint violation.

- **The primary key is the slug, and the slug is the manifest id.** One
  namespace, not two: the id already namespaces every contribution and is the
  folder name on disk, so two plugins sharing one would collide on the user's
  machine however the store numbered them. Claimed at submit, since the review
  page needs a row; a squatted name is answered by staff (`withdrawn` frees it).
- Counters move by delta from triggers inside `begin_internal()`, and
  `rating_avg` is a GENERATED column, so no client, trigger or SQL-editor
  session can write an average the reviews do not add up to.
- **Deleting an install row does not decrement.** An install happened;
  uninstalling does not un-happen it, and a count that went down would read as
  "how many people still have this", which this schema cannot know.
- Reviewing requires TL1, **and having installed it**, and not being the author.
  The middle gate is the point: a rating from somebody who never ran it is an
  opinion about the description.
- Four pages, built from the forum's own pieces. The website cannot build a
  submission — its CSP carries no `wasm-unsafe-eval`, so esbuild cannot run
  there — so `plugins-submit.html` reads a file ouRGeo made, with fflate.
  Decompressing is not eval.
- `image-upload.js` takes a target rather than growing a twin: the transcode
  half is the entire reason that file exists, and forking it to change a bucket
  name would duplicate the tricky part to vary the trivial one.

### The assistant

`store:search / inspect / updates / open` are `always`; `store:install` and
`store:update` are **`confirm`**, the same tier as `plugin:enable`. What
installs arrives switched off, and there is no action that enables it — the
assistant cannot install and turn on in one breath.

**Never exposed:** submitting a plugin and writing a review, both of which
publish under the user's name to a public site; and approving anything, because
an assistant that could approve a plugin could approve one it had written. A
test asserts all three, so adding one would be noticed.

## Voice input (v1.12)

Dictation in the AI panel: a microphone beside Send, a choice of input device,
a ring that shows ouRGeo is hearing you, and a choice of who transcribes it.
`src/lib/voice/`, `src/store/voice.ts`, `electron/main/voice.ts` and
`voice-models.ts`.

Rule 0 does not bind — none of this runs R, so there is no R to echo. Its
corollary does: a recording sent anywhere off this machine is logged to the
console (`describeVoiceCall`), the way `describeWebCall` logs every web tool
call. And rule 22 is why **recorded audio never persists**: clips live in
memory and are dropped after transcription, never in `session.json` or a
`.ourgeoproj`.

**Never exposed:** there are no `voice:*` AI actions. The microphone is the
user's, and an assistant that can arm it belongs on the same list as one that
can close its own panel. The mic button is *pointable* (`ai.voice` in
`targets.ts`) so a tutorial can show where it is; there is nothing that
presses it.

### One capture path

`getUserMedia` → `AudioContext` → an `AudioWorkletNode` whose module is a blob
URL, producing Float32 frames. That one stream feeds the level meter, a WAV
encoder for the services that upload a file, and PCM16 frames for the ones that
stream. MediaRecorder would have given webm/opus, which then needs decoding for
the on-device engine and raises "can this server read opus?" for every local
one; WAV is bigger on the wire and universally understood.

- **The worklet resamples to 16 kHz unconditionally.** Chromium does honour
  `new AudioContext({ sampleRate: 16000 })`, but some Linux ALSA/PulseAudio
  backends have historically been the exception, and a fallback branch that
  only runs on the machines hardest to test on is worse than no branch.
- **CSP**: an `addModule()` request has destination `worker`, so `worker-src
  blob:` covers it — already present. `script-src` is not what governs it.
- **The level never passes through React.** It arrives ~50 times a second; a
  `requestAnimationFrame` loop reads `useVoiceStore.getState().level` and writes
  the transform to the DOM node. A `useVoiceStore((s) => s.level)` anywhere
  re-renders that component fifty times a second for the whole of a dictation.
- `capture.ts` releases the microphone on **every** exit path. A recording
  indicator left burning after the user thinks they have stopped is the worst
  failure available here — it is a privacy failure, and they cannot tell.
- `silence.ts` is a reducer taking `now` as an argument, so its tests need no
  fake clock. Two rules: silence *before* any speech never stops a recording,
  and a mid-sentence breath restarts the window rather than ending the
  dictation.

### The services

`TranscriptionService` (`voice/types.ts`) is data plus one function, like
`ApiProvider`: it is handed a finished clip and returns text, which is what
makes every one of them testable with no audio device. `openStream` is
**optional** — only Deepgram has it, and a batch service never has to pretend.
The registry is shaped like `api-connectors/registry.ts` but is deliberately
not plugin-extensible: nothing asks for a contributed service, and a
registration path with no caller is a guess.

Shipped: the on-device engine (default), an OpenAI-compatible client covering
OpenAI, Groq and every local server that copied the endpoint, then Deepgram,
ElevenLabs Scribe and AssemblyAI. Each spells the same three things
differently — the key header, the model field, the language field — and each
misspelling produces a 400 with nothing useful in it, which is why every
request builder is pure and pinned by a test.

**Multipart does not go through `ai-proxy.ts`.** Its `body` is a string, shaped
for JSON chat bodies streamed back as SSE, and widening a hot path for the one
caller that needs something else is the mistake rule 45 warns about.
`electron/main/voice.ts` builds the form with Node's own `FormData`, and never
sets `Content-Type` by hand — `fetch` computes the boundary, and setting it
manually yields a boundary-less type the server rejects with a puzzling 400.

**Streaming stays in the renderer.** `ws-client.ts` already opens WebSockets
there and the API keys are already renderer-side; a main-process relay would
need a `ws` dependency to protect a secret the renderer is holding anyway. A
browser socket cannot set headers, so Deepgram's key travels as a subprotocol.
The stream is opened *after* capture starts and falls back to the batch path on
any failure, so a service having a bad day costs a few seconds rather than the
dictation.

### The on-device engine

`@huggingface/transformers` is a **devDependency**, and that is not a filing
error. It declares `onnxruntime-node` (296 MB unpacked) and `sharp`, and this
repo ships production `node_modules` inside the asar — `plugins.ts` resolves
`esbuild-wasm/esbuild.wasm` at runtime, which proves it. As a runtime
dependency it would have added ~440 MB to every installer, for every user,
including those who never dictate. Bundled lazily by Vite it costs **23.6 MB**
(`out/` 32.3 → 55.9 MB), almost all of it one 22.5 MB ONNX Runtime wasm.

ORT ships four wasm builds and Vite picked `asyncify` (22.5 MB); the `jspi`
build is 13.9 MB with the same WebGPU support, and Electron 41's Chromium has
JSPI. **Reclaiming those 8.6 MB is an open follow-up** — it needs Vite-level
aliasing of a transitive dependency's static import.

The weights are downloaded on first use, never bundled:

- **Served over a privileged `ourgeo-model://` scheme.** The packaged renderer
  runs from `file://`, where the Cache API does not exist, so transformers.js'
  own caching cannot work and every launch would re-download. Base64 over IPC
  would mean a ~330 MB string for the largest model. `protocol.handle` streams
  from disk instead, and `env.localModelPath` + `allowRemoteModels = false` is
  what makes the offline promise true.
- **Manifests are real, not invented.** Sizes and sha256 come from Hugging
  Face's `x-linked-size` / `x-linked-etag` headers, pinned to a commit rather
  than a branch. Downloads write `.part` and rename only after size and hash
  check, so an interrupted download can never be mistaken for a finished one.
- **Installed-ness is read from disk**, never remembered in a preferences file
  — a flag goes stale the moment someone clears the directory.
- **No cross-origin isolation.** ORT's wasm backend is multi-threaded only
  under COOP/COEP, and enabling COEP globally would gate the `https:` basemap
  tiles and every other cross-origin subresource. So the wasm fallback is
  single-threaded, WebGPU matters more here than on the web, and the model
  picker says so rather than letting someone find out after a 240 MB download.

### Permissions

There was no permission handler at all, so the renderer could have been granted
geolocation, notifications or HID with nothing on screen. Granting `media` came
with an allowlist that refuses everything else. The **check** handler matters as
much as the request handler: it is what `enumerateDevices` consults before
revealing device labels, and without it the microphone picker is a list of
blanks. macOS additionally needs `NSMicrophoneUsageDescription` in
electron-builder's `mac.extendInfo`, and is asked up front so a blocked
microphone is visible before the first click.

**The allowlist is only as good as the list of things the app already did**
(`src/lib/app-permissions.ts`, tested). Written as `permission === 'media'`, it
silently broke **every Copy button in ouRGeo** — the AI chat's code blocks,
both Export Code dialogs, the toolbox, the console's and the terminal's "copy
path", and the terminal's own Ctrl+Shift+C and Ctrl+Shift+V. `navigator.clipboard`
asks the permission **CHECK** handler, never the request handler, so the same
predicate that reveals device labels also decides whether a copy works — and
none of those call sites checked the promise, so each showed a success tick
over an unchanged clipboard. Nothing was on screen to say otherwise, and the
app had shipped that way since 1.12.

- `clipboard-sanitized-write` is granted: writing is an action the user asked
  for and can see the result of, and it cannot read anything.
- `clipboard-read` is **not**, and the difference is the point of having a
  list. It is a standing licence for any renderer code to read whatever the
  user last copied — a password, a token — silently and at any time. The one
  place ouRGeo needs the clipboard's CONTENTS is the terminal's Ctrl+Shift+V,
  which goes through `clipboard:readText`: a main-process read that happens
  once, on the keystroke.
- The predicate lives in its own pure module so it is a list you can read and a
  test can hold you to. `REFUSED_WITH_REASON` records why each refusal is a
  refusal, so nobody grants one back to make a symptom go away.

## The terminal (v1.13)

A real pseudo-terminal running the user's own shell, tabbed with the R console
by default. `electron/main/terminal.ts`, `src/lib/terminal/`,
`src/store/terminal.ts`, `src/components/terminal/`.

**Rule 0 does not bind — no R runs, so there is no R to echo — and that is the
constraint, not a licence.** Every other operation in ouRGeo leaves the user
with a console they can re-read and re-run; a shell command leaves nothing. So
the docs topic and the tool guidance both say the same thing in the same words:
if it can be done in R, do it in R. Rule 22 binds hard: **terminal output is
never written to disk** — not `session.json`, not a `.ourgeoproj`, nowhere.

### A pty, not piped stdio

`child_process.spawn` with pipes is not a terminal: no TTY means no colour from
most tools, no line editing, no `top`, no `vim`, no job control. For anyone who
likes their terminal that is a command runner wearing its clothes.

**`@lydell/node-pty`, pinned exactly, in `dependencies`.** node-pty is built on
node-addon-api, so its binary is **Node-API — ABI-stable across Node and
Electron** — and a prebuilt binary loads with no `electron-rebuild`, no
node-gyp, and (verified) no install script at all. The lydell repackaging ships
one platform's binary via `optionalDependencies`: **160 KB installed**, against
27 MB for the all-platforms package. Stable `node-pty@1.1.0` has *no Linux
prebuild* and falls back to node-gyp, which is a worse day-one story for this
project's primary platform than a pinned beta.

Three consequences, all handled rather than discovered:

- **A cross-built installer would ship no terminal, silently.** Only the host's
  binary installs, and electron-builder cannot tell a file we did not want from
  one that is not there. `scripts/check-pty.mjs` runs before every `package:*`
  and refuses, naming the fix. It resolves the package ENTRY, not its
  `package.json` — these packages declare `"exports": "./lib/index.js"`, and a
  bare string export map makes every other path unresolvable.
- **`asarUnpack` covers the whole package**, not `*.node`: the Windows build
  loads `conpty.dll`, spawns `OpenConsole.exe` and starts
  `lib/worker/conoutSocketWorker.js` as a worker thread, all by path.
- **The module is loaded lazily behind a try/catch.** On an architecture with no
  prebuild the import throws, and a throw at module load would take main down
  over a panel the user may never open. The panel says which platform is
  unsupported instead, and points at `system()`.

### What main does that the renderer cannot

- **Coalescing.** A pty emits data in whatever sizes the program writes it, and
  `cat` on a large file is thousands of tiny reads. Batched on an 8 ms timer or
  at 64 KB — comfortably under a frame, so typing still echoes instantly, while
  a burst becomes at most ~125 messages a second however hard the program writes.
- **Flow control.** `yes` outruns any renderer, forever. Above 512 KB
  unacknowledged the pty is paused; the renderer acks from xterm's `write()`
  callback and it resumes below 128 KB.
- **A bounded replay ring** (128 KB), so a renderer reload — Ctrl+R, or the
  automatic reload `index.ts` performs when the renderer dies — **reattaches to
  the running shell** rather than killing it. Trimmed by whole chunks where
  possible: an escape sequence cut in half replays as garbage. In memory only.
- **Reading the shell's directory.** OSC 7 is the portable answer and a stock
  bash emits nothing at all, so "Set R's working directory to here" was disabled
  for most Linux users. We own the pty and know its pid, so `terminal:cwd` reads
  `/proc/<pid>/cwd`; macOS and Windows keep OSC 7 and report nothing rather than
  something invented. Read when the menu is about to open, not on a timer — an
  item that enables itself a moment after you looked at it is worse than one
  that was right when it appeared.

### The renderer

**Bytes never enter React.** The sink writes straight into xterm's buffer and
acks what was drawn; only four facts reach a store (title, cwd, alive, bell).
Same rule the voice level meter needed, same failure avoided.

**Sinks are a SET, not one per session.** That was the first shape and it was
wrong: `terminal:run` must watch the stream *while* the view keeps drawing it,
or a command the assistant ran would produce nothing on screen — precisely the
failure the visible-tab rule exists to prevent.

**The sink is registered BEFORE the attach.** `attach` returns the replay
buffer, but data emitted during that round trip is sent immediately; a sink
installed after the await drops it, and the symptom is a missing first line that
only appears on a fast machine.

**Every view stays mounted** when its tab is hidden, so a running program's
screen and scrollback survive a tab switch — which costs a `fit()` on
activation, because a hidden element measures zero.

**Session creation is idempotent by construction.** StrictMode double-invokes
effects in dev, and the second shell would be invisible: no tab, holding a pty
until quit. `ensureSession` de-dupes through an in-flight promise, which is what
actually holds when two callers race.

**Title and cwd come from xterm's own parser** (`onTitleChange`, a registered
OSC 7 handler), not from scanning chunks in main: a sequence split across two
reads is routine and the parser reassembles it. A user's rename sets `renamed`,
which stops the shell's title sequence — fired on every command in most default
prompts — from erasing it.

### Colours

`src/lib/terminal/theme.ts` is `buildMonacoTheme`'s sibling and inherits its
invariant: **the surface is the app theme's, the ANSI ramp is the code
theme's**. So switching code theme recolours `ls`, and switching app theme never
moves the background. `terminal/theme.test.ts` pins both directions.

The sixteen colours are **derived, not authored**. Ten shipped themes would be
160 hand-picked decisions and a Theme Studio theme would have none, so each slot
names a target hue and takes the nearest colourful palette entry, falling back to
a base ramp when nothing is close enough — Solarized yields a Solarized
terminal, a monochrome palette yields sensible defaults rather than six shades
of grey.

**The assignment is exclusive, and that is not a refinement.** Without it
ouRGeo's own Dark theme produced a terminal whose `blue` and `cyan` were the
same `#79c9d9` — one colour at hue 190 is within tolerance of both targets — and
three of the ten shipped themes collapsed a slot that way. Two identical
chromatic colours is a terminal where `ls` cannot tell a directory from a
symlink. Legibility is solved for as CONTRAST against the background rather than
a fixed lightness band, because a band that suits near-black washes out on white.
`background` is `chrome.bg`, not `chrome.panel`: the console it shares a strip
with paints nothing, and taking `panel` drew the terminal as a slightly
different rectangle inside its own pane.

### One header row, not two

The zone used to draw a tab strip ABOVE the panel, and the panel drew its own
header underneath — so reaching the terminal cost two rows of chrome, and the
words "R console" appeared on screen twice, three pixels apart, once as a tab
and once as a heading.

`PanelMeta.hostsTabs` opts a panel into drawing the zone's tabs inside its own
header instead. The console and the terminal both set it; `ZoneTabs` is the
shared component and `Zone` skips its own strip when the zone is hosted.

- **All or nothing per zone** (`zoneHostsTabs`), never per panel. Asking only
  the ACTIVE panel would move the tab strip between the zone's row and the
  panel header as the user switched tabs, so the control they were reaching for
  jumps a row. Drag Plots into the bottom strip and the whole zone reverts to
  its own row — consistent, if less tidy.
- **Only when there is something to switch between.** `usePanelDrawsTabs` is
  false for a zone in `split` mode (both panels are visible and each has its own
  header) and false for a panel alone in its zone, which is what keeps the
  console looking exactly as it did before the terminal existed.
- The shell tabs inside the terminal are **pills, not underlines**: the pane's
  tabs beside them are underlined, and two underlined groups an inch apart read
  as peers when one lives inside the other.

**`store/panelDrag.ts` is what made this possible.** The dragged-panel id was a
`useState` in `EditorLayout` threaded down as a prop pair — fine while only
`EditorLayout`'s own children needed it, impossible once a tab button is
rendered deep inside `Zone` → `PanelSlot` → the panel itself. Same move
`store/contentDrag.ts` documents one level down, for the same reason. The
gesture itself (`startPanelDrag`, its 4px threshold, its single commit point)
moved to `layout/panel-drag.ts` so the zone and its tabs do not import each
other.

**`TerminalDirBar` is `WorkingDirBar`'s sibling, not a reuse of it.** Same shape
— the path IS the control, one click opens everything you can do with a
directory — but R's working directory is a value ouRGeo owns and can set, while
a shell's is a fact about a process we can only read, and the way to change it
is to type `cd` and hope. One component with a prop deciding which of those each
menu item meant would have been worse than two. It polls (2s, a `readlink` in
main) while its tab is on screen.

**They are DRAWN identically**, though, down to the shared `ElidedPath`
(`components/ui/elided-path.tsx`, lifted out of `WorkingDirBar`), the mono face
and the size: the two sit inches apart in the same strip — one when the console
tab is in front, one when the terminal is, and both at once in split — so a
user reading the bottom of the window should see one kind of thing that says
where you are, not two that differ in font for no reason they can name.

**It shows the SHELL's directory and only ever that.** It used to tint amber
when the shell and R had drifted apart, which made the one place that answers
"where is this shell?" also, quietly, a report on R. The two directions between
them are still in its menu, where they are actions with both paths spelled
out — which is where a comparison belongs.

### Placement, and the setting

`terminal` is an ordinary panel (bottom zone, order 1) and — since 1.13 — has
**no toolbar button**. The tab beside "R console" is how you reach it, which
is why the panel is `essential`: a closed terminal would be a panel with nothing
left to open it. It costs nothing to leave open, because in a tabbed zone only
the ACTIVE panel renders, so no shell is spawned until the tab is clicked.
`essential` is also the migration — every `layout.json` written while the button
existed says `open.terminal: false`, and step 3 of `normalize` opens it on load.

Two consequences that were bugs first:

- **The bottom strip now ships `tabs`**, not `split`. The zone default was
  invisible while the terminal was closed; with it open, a fresh install would
  have come up with a shell running beside the console that nobody asked for.
- **The placement preference is applied in `useLayoutStore.init`**, before the
  first render — not from the panel's mount effect, and not from an effect
  afterwards. A stored layout whose bottom strip is `split` mounts the Terminal
  panel for one frame, and mounting it spawns a shell: `terminal.list()` came
  back with a pty on a launch that never showed a terminal. It is the one
  terminal-shaped special case in the layout store, and it is there because
  that is where the file becomes what is on screen. `alignTerminalMode` takes
  `front` for the same reason: an explicit open must SHOW the terminal, a
  startup must not, or every launch would come up with the shell in front of
  the console the user was reading.

`lib/terminal/placement.ts` is pure and holds two operations:

- `placeTerminal` — what the **Settings switch** does. An explicit "arrange it
  like this", so it moves the panel even from another zone, and it follows the
  CONSOLE rather than the bottom strip: hard-coding `bottom` would be right until
  someone moves the console to the left column. It also OPENS the panel, since
  "give the terminal its own pane" and "and don't show it to me" is not a thing
  anyone means.
- `alignTerminalMode` — what **opening the panel** does. Never moves anything;
  it only changes the mode of a zone the terminal and console are BOTH in. That
  guard is the difference between a remembered preference and one that fights
  you, and it is what lets the setting promise the panel stays where it is put.
  A workspace built before the terminal existed has it in `split`; the default
  is a tab, and this is the one moment there is anything to apply it to.

`useLayoutStore.transform` is the one escape hatch that made this possible
without a terminal-shaped special case in the layout store — a pure transform,
applied through the same `apply` as everything else.

**The switch lives in Settings → Terminal, not Settings → Workspace.** It
shipped in Workspace, on the argument that where a panel sits is a fact about
the workspace and belongs with the other panel settings — which is true, and
irrelevant: a user who wants the terminal beside the console opens the Terminal
section, finds a shell picker and a cursor style, and concludes the arrangement
cannot be changed. It reads the LAYOUT rather than the stored preference, so a
terminal dragged to the right column reads off, which is honest — it is beside
nothing.

### The assistant

Six actions (`terminal:list / open / run / read / interrupt / close`) plus a
**third switch in the AI panel footer**, AND-ed with Autopilot, off by default
and only ever `true` by explicit value.

**It is not a sandbox and must not be described as one**: R's `system()` reaches
the same machine from behind Autopilot alone. What the switch means is that the
user decided, deliberately and once, that running commands on their computer is
part of what the assistant does. The accountability is the real control — every
command is typed into a tab they are watching and logged to the console.

- `UiAction.requires` carries the gate, not six copies of a check inside the
  group. Checked BEFORE the tier, because two refusals for one call is how a
  model ends up telling a user something is impossible.
- With the switch off the actions are **filtered out of `list_ui_actions`
  entirely** — absent rather than discovered by refusal, the rule the web tools
  already follow — and `buildToolGuidance` states the position up front.
- No `confirm` tier by default: the switch is the deliberate act, and a modal
  per command becomes a habit-forming click. The user can still raise any of
  them in the permissions dialog.

**`terminal:run` and the completion marker** (`run-markers.ts`). A pty has no
framing, no exit code, and a prompt is whatever the user configured — so the
command is followed by one that prints a private OSC sequence carrying the exit
status. An OSC rather than a printable sentinel, so `echo "OURGEO-DONE"` cannot
end a run and nothing extra is drawn.

**Never a raw ESC byte on the command line.** To a line editor an ESC is not a
character, it is the start of a meta sequence: writing one into bash's readline
enters a key binding instead of inserting text, and the command silently becomes
something else. Every form uses notation the shell expands (`\033`, `[char]27`).
cmd.exe has none, so it gets no marker and reports no exit code — said, not
guessed. Each shell spells the status differently and fails *silently* (`$?` in
fish is a different variable that prints nothing), so the family comes from the
profile and an unrecognised shell loses the code rather than typing `$?` into
the user's prompt.

The core prompt budget went **7000 → 7200**: six generated ids the index carries
regardless, plus one sentence that must be up front because it names the switch.
The prose was 44 of the 200.

### Keyboard, shells, and the R links

- **Everything goes to the shell** except Ctrl+Shift+C/V/F (Cmd on macOS).
  Ctrl+C is SIGINT, Ctrl+R is reverse-search, Ctrl+D is EOF. Copy with an empty
  selection is swallowed, or Ctrl+Shift+C arrives as the SIGINT it was avoiding.
- **Ctrl+= / Ctrl+- become font size** when a terminal has focus, decided in
  `EditorLayout` rather than the terminal: main `preventDefault`s them in
  `before-input-event`, so the keystroke never reaches the focused element and
  only the `ui:zoom` message does.
- **Login shells on macOS only.** launchd gives a GUI app a minimal PATH and a
  non-login zsh never reads `~/.zprofile`, so a terminal without `-l` cannot find
  `brew` — or, on many machines, R. Linux and Windows have no such gap and would
  only get `~/.profile` re-run on every tab.
- **Two links to R**, both in the tab menu: "Go to R's working directory" types
  the `cd` so it lands in the shell's own scrollback, and "Set R's working
  directory to here" goes through the same `changeWorkingDir` the console header
  uses — so it echoes `setwd("…")`, which is rule 0 on the one operation here
  that touches R.

**Not persisted:** which tabs were open. A terminal is a live process, and
restoring a dead tab that looks alive is worse than starting clean; across a
renderer reload it survives because main kept the pty. `terminal-preferences.json`
holds the settings and is a preference — never in the `will-quit` delete list.

## Two editors (v1.12.5)

The code editor can exist more than once. Nothing else can: every other panel
is a window onto one global thing — one console, one environment listing, one
map — and a second copy would be two views fighting over one store. The editor
owns a SET (its tabs), which is precisely what makes a second one useful and
what makes the split well-defined.

**The Spatial Editor owns a set too — named map sessions — and briefly had the
same cap. It was built, and then taken out again.** Worth recording, because
the reasoning is the reason not to reach for it lightly: a second map is a
second MapLibre context and a second tile stream against a `viewBbox` that is
one value (`DbSpatialTileLoader` reads it), a second extent that the export
codegen and the project bundle must not read from the wrong one, per-focus
mounting for the ribbon, the hotkeys, the draft sync and the three popups so
that none of them fire twice, and a third answer — a dialog — to every "send
this object to the map". What remains here is the *panel* machinery, which is
written over `basePanelId` rather than against the editor and cost nothing to
keep general; the map-side half is gone from the tree, so bringing two maps
back means writing it again, not flipping `maxInstances`.

One consequence outlives it: `layout.json`, a saved preset or a `.ourgeoproj`
written while two maps were possible can still name `spatial#2`. `normalize`
refuses it, `reconcilePanelContent` brings any orphaned tabs home, and named
map sessions were never persisted, so nothing is lost. Pinned by
`panel-meta.test.ts`.

### Instances are a naming scheme, not a new model

`src/lib/layout/instances.ts`. `PanelId` was already an opaque string to the
layout model, so a second panel costs nothing structural — what it costs is a
name, and **the first instance keeps the bare id**: `editor`, then `editor#2`.
That is why every `layout.json`, saved preset, `data-ourgeo-id` and `ui:panel`
call written before this feature still resolves. `#` rather than `:` (a
plugin's panel id is already `plugin:panel`) and rather than `.` (a dot in an
id reads as a property access — the same argument that made action ids use a
colon). `maxInstances` on `PanelMeta` is 4 for the editor and absent (so 1)
everywhere else.

`normalize` gained the rules that keep a bad file renderable: an instance of a
panel that may only exist once is dropped, so is one past the cap and one whose
suffix does not parse (`editor#1`, `editor#x`); and **an instance's open state
is its base panel's**. That last one is a decision, not an omission — the
toolbar has one button per panel, so a second editor that could be closed on
its own could only be reopened from Settings, and a panel holding documents
that is invisible and unreachable is the worst state this feature can produce.
Closing the editor closes every editor; *removing* one is the other gesture,
and it hands its documents on. `dropPanel` is that removal, and step 2 of
`normalize` never puts an instance back: an original that is missing from a
file was never seen, an extra one that is missing was removed.

**Dropping the cap is therefore also the migration.** A `layout.json`, a saved
preset or a `.ourgeoproj` written while two maps were possible still names
`spatial#2`; `metaFor` refuses it, step 1 drops it, and `reconcilePanelContent`
brings its sessions back to the map that remains. Pinned by
`panel-meta.test.ts`, which asserts against the SHIPPED registry rather than a
fixture — `model.test.ts` already proves the machinery is general, and a
fixture would go on passing after the shipped answer changed.

`resolvePanelName`'s squash keeps digits for a related reason. Stripping them
made "Code editor 2" squash to `codeeditor`, which is the FIRST editor — so the
spoken name of an added panel resolved, silently and confidently, to the
original, and the trailing-number branch written to handle it never ran.

### Only what was added can be removed

Remove and Close are different gestures and must not be offered as if they were
one. Closing hides a panel the toolbar brings straight back; removing takes a
panel out of the workspace for good. So **Remove applies only to a panel the
user asked for**, which by construction has a sibling for its contents to move
to — and the check is in `removePanelInstance`, not in each of the three menus,
because a rule enforced at every call site holds until someone adds a fourth.

The grip's right-click menu briefly carried both, and that was wrong twice
over: a right-click could take the console or the map out of the workspace — a
destructive answer to a gesture made to *move* something — and the way back was
a toolbar button nothing in the menu mentioned. The menu now moves a panel,
adds one, and removes one that was added; hiding a panel is what the toolbar is
for. Settings shows the ✕ only on the copies, and `layout:removePanel` refuses
the original by name.

Removing the ORIGINAL is not merely disallowed, it could not have worked: the
editor is `essential`, so `normalize` would put it straight back — empty,
having already handed its documents to the copy.

### Removing a panel never removes what is in it

`src/lib/panel-instances.ts` is the only thing that should call
`useLayoutStore.removePanel`, and it moves the content first — to the FIRST
remaining panel of the same kind, which for anyone who added exactly one extra
is always the original. Three surfaces call it and must agree: Settings →
Workspace (which is also the only surface that SHOWS you what you have), the
panel grip's right-click menu (the fast way, when the pointer is already on the
panel), and `layout:removePanel`. All three print the same sentence about where
the documents went, read *before* the removal — `removalSummary` afterwards
would describe a panel that is already empty.

`src/lib/panel-content.ts` is the safety net for the other direction.
Content pointing at a panel that is gone arrives from three real places — a
`session.json` or `.ourgeoproj` written when the workspace had two editors, a
layout preset applied from Settings, `layout:reset` — and its symptom is the
worst kind: the tab still exists, still holds the user's work, and is drawn
nowhere. So `reconcilePanelContent` runs after EVERY layout change, from the
one place every change passes through (`useLayoutStore.apply`), and puts
orphans back in the original panel.

### What each store had to grow

- `TabState.panelId`, **absent meaning the original** — the same
  backwards-compatibility tolerance `language` needed, so a `session.json` or a
  bundle written before this reads back unchanged, and a tab moved to the
  second editor and back is byte-identical to one that never left.
- `activeTabId` **stays a single value**, because almost everything that asks —
  Save, Knit, the document tools — means "the one in front of me". What a
  second panel needs is `activeByPanel`, which is what each panel RENDERS:
  switching focus to the other editor must not disturb the tab this one is
  showing.
- `focusedEditor`: where a new tab opens. Set from `Zone`'s **mousedown
  capture** (`lib/panel-focus.ts`), so focus has moved before the click does
  whatever it was for. `PanelSlot` draws a focus ring, but only when there is
  more than one editor: with one, the question has no answer worth showing.

### Moving content between panels

`src/lib/content-drag.ts` + `src/store/contentDrag.ts`, written the same way as
`startPanelDrag` and for the same hard-won reasons: plain mouse events (not
HTML5 dnd), a 4px threshold so a plain click on a tab still selects it, and
**the drop committed in the one mouseup handler** rather than by the panel
dropped on — React flushes a discrete native event's update synchronously, so
the first overlay to clear the drag would unmount the rest mid-dispatch.

A tab strip is a strip, so tabs drag, and the strip also carries an explicit
**Move to** in the tab's own context menu — a drag inside a scrolling tab strip
is easy to start by accident, and easy to miss if nobody tells you it is there.
`ContentKind` stays a union with one member rather than collapsing to a
boolean, because the drop targets key off it (`data-dock-kind`): a panel that
accepted anything dragged near it is the failure the type exists to prevent.

### Two smaller consequences

- **An empty editor is a normal state**, and it says so, with the two ways to
  fill it. `closeTab` only invents an Untitled when the last tab *anywhere*
  goes; a panel that silently grew an `Untitled-7` whenever it emptied would be
  one the user cannot leave empty.
- **`CodeEditor` disposes a model when its tab leaves the panel**, not when the
  tab is closed. `getOrCreateModel` returns a cached model without refreshing
  its text, so dragging a tab out and back would resurrect the document as it
  was when it left. Chunk outputs are a different lifetime — keyed by tab id in
  a shared store — and are dropped only when the tab is gone from the app.
- **`HighlightOverlay` picks the control inside the focused panel** when an id
  appears twice. A tutorial says "the New file button", not "the New file
  button in the second editor".

## Design Tokens

```
Background:  #0f1117  (geo-bg)
Panel:       #161b22  (geo-panel)
Border:      #21262d  (geo-border)
Accent:      #4493f8  (geo-accent)
Success:     #3fb950  (geo-success)
Error:       #f85149  (geo-error)
Muted:       #8b949e  (geo-muted)
```

These are the Dark app theme's values; every theme overrides them at runtime via `applyTheme`. New UI must use these tokens via Tailwind classes (`bg-geo-bg`, `text-geo-muted`, etc.) and follow the existing shadcn/ui + Radix component patterns in `src/components/ui/`.

**A setting is a `Switch`, not a checkbox** (`ui/switch.tsx`). A checkbox states a value something else will act on later — the ticks in Add Features, "don't show this again" on a dialog you are about to dismiss — and those stay checkboxes. A switch takes effect the moment it moves, which is every row in the Settings dialog: there is no OK button. The whole row is the `<button role="switch">`, because a button nested in a label is two click targets that both fire, and the knob is `bg-foreground` in both states — the one token guaranteed readable on both the `geo-bg` track and the `geo-accent` one, in light themes as well as dark.
