# Architecture

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

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

Desktop artwork comes from the official website logo, preserved in
`build/logo-source.png`. `scripts/build-app-icons.mjs` produces PNG/ICO/ICNS
and Linux launcher sizes, rendering the original RGB through `logo-mask.png`
to make the exterior transparent without erasing white snow or text. Only the
cutout's alpha is used; its edited RGB is discarded to preserve the artwork.
Committed outputs avoid a build-time image-tool or
network dependency. Explicit Builder platform paths cover executable/installer,
Finder/Dock and desktop launcher icons. Vite emits `icon.png` beside the main
bundle because build resources are not automatically runtime files.
`electron/main/app-icon.ts` supplies this path to all three BrowserWindow
constructors; macOS also sets the Dock icon for development. Linux's default
`--class=ourgeo`, `desktopName` and desktop `StartupWMClass` agree with the
installed launcher. This does not rename the app or move its existing user-data
directory. There is no separate Tray feature. See `build/README.md` for artwork
provenance and regeneration.

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
