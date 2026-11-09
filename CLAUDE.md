# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Full design notes live in [`docs/design-notes/`](docs/design-notes/)** — the
rationale, measurements and bug history behind each subsystem, moved out of this
file verbatim. This file keeps the rules you must not break; read the relevant
note before changing a subsystem. A code comment saying "see CLAUDE.md" for a
topic below now means the matching design note.

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
install.packages(c("httpuv", "jsonlite", "later", "httr2", "rlang"))
# Data preflight uses openssl (existing httr2 dependency), units (sf dependency),
# s2 for geographic checks/metrics, dplyr for summaries, geos for geos tools.
# Spatial features also need: sf, terra, ggplot2, tmap, ggspatial, maptiles, tidyterra
# Raster map rendering also needs: png (tile encoding); ggplot raster export with
#   mixed fill scales additionally uses ggnewscale (emitted only when needed)
# Curved geometry (CIRCULARSTRING/COMPOUNDCURVE/CURVEPOLYGON) also needs: sfarc
# Knitting .Rmd also needs: knitr, rmarkdown (+ pandoc, which is NOT an R package
#   and R does not bundle — RStudio ships its own copy; PDF additionally needs a
#   LaTeX install, e.g. tinytex). Running chunks inline needs NOTHING extra —
#   it uses base eval + grDevices.
# Database (.Rgeo) features also need: DBI, duckdb, dplyr
# Project Files from R (ourgeo_project_file/_path) uses curl + jsonlite, both
#   already installed with httr2 — nothing extra
```

Data Connector Web APIs generate import code with `httr2`/`jsonlite` and
`sf::st_read`; no extra packages (RSocrata, esri2sf, rstac… are optional, unused).

## Architecture → [`architecture.md`](docs/design-notes/architecture.md)

**Two runtime dependencies, one feature each:** `esbuild-wasm` (plugin TS/JSX
compile, lazy `import()`, wasm read over IPC) and `@lydell/node-pty` (terminal;
Node-API, no rebuild). The speech engine is a lazily bundled *dev* dependency.
Don't add runtime dependencies casually — each one is justified in a paragraph.

App icons: `build/logo-source.png` → `scripts/build-app-icons.mjs` (see `build/README.md`);
`electron/main/app-icon.ts` feeds all BrowserWindows; Linux `--class=ourgeo`.

```
Electron Main (electron/main/)
  r-bridge.ts    spawn Rscript (absolute path to server.R, cwd = user home), read port, auto-restart
  ipc.ts         IPC handlers: dialogs, R management, plot popout
  ai-proxy.ts    AI HTTP proxy (ai:fetch/chunk/abort). Remote: net.fetch (NOT Node fetch —
                 undici's 5-min headers/body timeout). Loopback: node:http via local-http.ts
  plot-window.ts secondary plot popout window
  index.ts       BrowserWindow; on resume/GPU-loss repaint (invalidate + resize nudge);
                 reload only if renderer dies; emits system:resume
Renderer (src/)  React UI; R over HTTP (rClient) + WebSocket (wsClient);
                 hash '#plot-popout' renders PlotPopoutView
R (r/server.R + r/lib/*.R)
  server.R       slim bootstrap: packages, .ourgeo_env, headless PNG device, source() every
                 r/lib module into .GlobalEnv, bind httpuv on random port (stdout)
  router.R       route() HTTP dispatch + ws_handler()
  handlers-*.R   endpoints by domain; util-*.R helpers; db-*.R .Rgeo/DuckDB
  util-raster.R / handlers-raster.R  raster tile engine (warp to EPSG:3857 COG, XYZ PNG tiles, LRU)
```

All `r/lib/*.R` share `.ourgeo_env` and reference each other by name at call time.

### R Server Endpoints (main ones)

```
POST /session/init | /session/reset | /session/setwd     GET /session/wd   GET /health
POST /r/execute   — run R; captures plots; `envir` = "Work in this environment"
POST /r/plot/export | /r/plot-preview
GET  /env/list    POST /env/{remove,rename,copy,move,create,save,load,duplicate}
GET  /packages/list | /packages/cran-list   POST /packages/{load,unload,install,addlibpath,check-version}
POST /object/{function,dataframe,matrix,vector,formals}
GET  /spatial/list   POST /spatial/geojson | /spatial/traverse
POST /raster/{info,register,unregister,histogram}  GET /raster/tile/{id}/{z}/{x}/{y}.png?v=N
POST /data/preview | /kaggle/files | /help/{search,doc,package,vignettes,vignette} | /selection/query
GET  /db/proxies   POST /db/reconnect
POST /preflight/{start,status,cancel,rows,selection,execute}
WS   /console
```

`/raster/register` with the same layerId = symbology-only restyle (keeps warp, bumps version).

### WebSocket messages (`/console`, handler `(type, text, data)`)

`stdout`, `stderr`, `plot` (data URL → `usePlottingStore.addPlot` + popout IPC),
`widget` (`data.id`), `env` (rebuilt `.GlobalEnv` entry, change-detected),
`packages` (`data.libraries`), `wd` (`data.path`, also fires for `setwd()` in user
code), `raster_layer_invalidated` (`data.layerId` → re-register or drop).

### Wire-level gotchas

- **`error_response()` is HTTP 500 and axios rejects it** — use `RClient.ask()`,
  which returns the refusal body and still throws on a severed connection.
- `json_response` rounds to 4 decimals by default (11 m of longitude); handlers
  carrying positions pass `digits = NA`.
- A CORS `204` must use `body = NULL`, not `""` (httpuv gzips it into a bad
  keep-alive response → `ERR_INVALID_HTTP_RESPONSE`). Regression in `scripts/check-toolbox.mjs`.
- Axios reports every no-response failure as `Network Error`; `transport-retry.ts`
  retries severed sockets once and never retries a response R actually sent.
- OS sleep aborts in-flight localhost requests; long requests hold a
  `powerSaveBlocker` (`power-block.ts`), raster register pre-generates its layerId and retries.

## Layout & Panels → [`console-and-working-dir.md`](docs/design-notes/console-and-working-dir.md)

Toolbar + resizable zones managed by `EditorLayout.tsx`. Panels: Code Editor +
Console (`session`, `editor`), Packages, Environment, Spatial Editor (MapLibre,
`spatial`), Plots (`plotting`), AI Chat (`ai`), Help (`help`), Terminal, Project Files.

- Code runs via `POST /r/execute`; the frontend adds `input` entries itself (R does
  not echo `> code`). Ctrl+Enter runs a line and advances; Shift+Enter runs selection.
- **Working directory**: R owns the value (store set from `getwd()`;
  `broadcast_wd_if_changed()` after every execution). Changes go through
  `/session/setwd` but still echo `setwd()`. R starts in the user's home dir, never
  ouRGeo's install. `elidePath` drops whole middle segments, measured on canvas.

## Environment panel → [`environment-panel.md`](docs/design-notes/environment-panel.md)

Pure rules in `src/lib/environments.ts`.

- A user environment (`new.env()` in `.GlobalEnv`) is shown either **promoted**
  (group beside `.GlobalEnv`, default) or **child** (a row) — never both. The row
  must carry everything the group does (`placement-menu.ts`, `env-export.ts` shared).
- Placement is NOT R's `parent`; every env ouRGeo creates has `.GlobalEnv` as parent.
- Promotion is renderer-side on purpose: `!isSearchPath` means "objects nameable
  directly in generated R" in a dozen places. `isSearchPath` = on the search path and
  not `.GlobalEnv` (so `Autoloads`/`tools:*` are not user envs).
- "Work in this environment" (`working-env.ts`) points `/r/execute` at an env; lives
  on `rClient` too so console/toolbox/assistant all honour it; echoes `evalq({…}, env)`;
  `pruneWorkingEnv` drops it when the env vanishes.
- `userOnlyView` is the one list the tree, Export, Load targets and Move To read.
- Export passes `excludeSystem`; `exportedNames` includes hoisted environments so the
  echoed `save()` names exactly what the file holds. Make Copy uses `/env/duplicate`
  (`list2env`), not an alias. `/env/create` refuses non-syntactic or taken names.
- Placement persists sparse in `environment-preferences.json`.

## Stores, persistence and projects → [`projects-and-persistence.md`](docs/design-notes/projects-and-persistence.md)

Stores in `src/store/`: `session`, `spatial`, `plotting`, `editor`, `environment`,
`packages`, `basemap`, `theme`, `ai`, `help`, `layout`, `plugins`, `ui` (dialog
state), `ask` (queued prompts).

**Two lifetimes.**
- *Preferences* (kept, never in the `will-quit` delete list): `layout.json`,
  `plugins.json`, `theme.json`, `custom-themes.json`, `environment-preferences.json`,
  `terminal-preferences.json`, `ai-preferences.json`, `recent-projects.json`, etc.
- *Session-scoped* (`src/lib/session-scoped-files.ts`, tested): `spatial-layers.json`,
  `spatial-ui.json`, `console.json`, `object-tabs.json`, `plots.json`,
  `ai-chats.json`. Deleted on `will-quit` AND at launch (`beginSession`). They exist
  only for renderer-reload recovery. **No `beforeunload` flush** — it races the unlink.
- Files are split so a pan or console line never rewrites the layer geojson.

**Drafts (1.16.37)** — spec `docs/project-persistence-spec.md`, checks
`scripts/check-project-persistence.mjs`. `electron/main/project-drafts.ts` keeps
`project-drafts/<sha16>/` (ui/layers/plots/view JSON, `docs/<tab>.json`,
`environment.RData` checkpoint, `base.ourgeoproj`, `lock.json`); every write is
temp + fsync + rename. Renderer writer is `lib/project-draft.ts` (1 s debounce,
suspended while stores are being replaced). R checkpoints fork via
`parallel::mcparallel` on Unix (in-process on Windows), uncompressed; bundles gzip
level 1. terra objects are `terra::wrap`ped. Leaving always goes through
`lib/project-leave.tsx`; every prompt is `ask()` (Escape = cancel). A changed bundle
is a three-way merge (`project-merge*.ts`, `MergeDialog`). One window per project via
`lock.json`. Console lines during open are deferred until history is restored.
`restoreScratchDocuments` must never run over a named project. `data-restored` on
the project menu marks launch restore finished (automation should wait for it).
Settings → Prompts must list every persisted "don't ask again" (test enforces).

**Projects** (`project-persistence.ts`, `store/project.ts`): `.ourgeoproj` zip of
`project.json` + `environment.RData` (`excludeSystem`). Scratch (`path === null`)
is never savable in place and keeps only untitled documents (no chats). Load =
reset → snapshot load → hydrate stores → `/db/reconnect`.
- **`system_names`** separates ouRGeo's objects from the user's (bundle contents,
  reset, panel filter). It is snapshotted at the END of `server.R`; helpers defined
  later (`ourgeo_calc_crs`, `ourgeo_linearize`, `ourgeo_db_collect`,
  `rgeo_materialize`) are unioned in by `handle_session_init`. `/env/load` flags
  non-user = file metadata ∪ `system_names`, nothing else.
- Dirty = draft holds changes the bundle does not. Window close → `app:before-quit`
  → `leaveCurrentWorkspace('quit')` → `app:confirm-quit`.

**Project Files** (`electron/main/project-files/`, docs `docs/project-files*.md`,
`docs/linked-project-folders-spec.md`): embedded originals (content-hashed, manifest
v2) + linked folders (manifest v3; roots are protected local grants, never authorised
by a bundle). Older writers must reject newer manifests rather than strip content.
Parsers run in restricted children; full text is encrypted locally. Never put
encoded file/image bodies in persisted chat/project JSON. Forget never deletes the
folder.

**Project Files from R** (`r/lib/project-files.R`): `ourgeo_project_file/path/save/files/commit`.
R talks to main over a loopback door (`project-files/r-access.ts`, bearer token in
env). Writes are staged and committed in the execute/chunk sweep. `put` is
add-or-replace by name and does not claim `state.operation`. Knit sources the same
file. Dialogs ask before replacing (`ReplaceProjectFileDialog`, z-300); R does not.

**File-analysis task models**: `ai-task-models.json`, device-local; never mutate the
active chat; no silent provider fallback. `useAiModelCatalogue` is the one shared catalogue.

## Moving objects between panels → [`spatial-link.md`](docs/design-notes/spatial-link.md)

`layerShowsObject` is the one "already on the map?" answer (empty `envName` = DB
layer, matches on name). `layersInView` = what Contents lists. `AlreadyOnMapDialog`
has three answers incl. *Show existing layer*. `viewerTargetForLayer` refuses only
rasters. Always `useLayoutStore.setActivePanel` after opening — opening is not showing.
`addDbSpatialLayer` / `addSpatialLayer` in `add-spatial-layer.ts`.

## Distance & Bearing, Curves → [`cogo-traverse-and-curves.md`](docs/design-notes/cogo-traverse-and-curves.md)

- `lib/draw/cogo.ts` is pure Vincenty on WGS84 (direct + inverse; deflections turn
  from the *arrival* azimuth). R's `handlers-cogo.R` implements the same and
  `ourgeo_traverse()`; each names the other — keep them in step.
- Grid basis arithmetic is R's (`/spatial/traverse`), never proj4js. Reply carries
  the frame (convergence, scale) at the new vertex plus `frameAt`. `legs: []` asks for a frame.
- A leg is an ordinary vertex append; points traverse from a non-data reference
  point; legs walk the dataset like the draw tool (`ctx.finish()`); `appendRows`
  distinguishes Add Point(s). `commitAndAdvance` reads the session at call time.
  Undo = `ctx.undoLast` + `retreatRow`. Matched draw hotkeys are consumed.
- Curves: one tool with Distance & Bearing (B/U). `closure()` uses arc lengths.
  `traverseIncoming` reads the last segment. `arc.ts` geometry is computed in a local
  metric frame (`local-frame.ts`). One solver for any two circular elements; refuse
  when two ordinary curves fit. Spirals are fitted as circular arcs to a measured
  tolerance (`arc-spline.ts`). `ourgeo_traverse()` grows additive columns only — it
  is a user-facing signature. `stageGeometry` takes `wktOverride` to keep curves curved.
- Finishing a traverse echoes `ourgeo_traverse()` as an `info` entry (not executed).

## Raster layers & codegen → [`raster-layers.md`](docs/design-notes/raster-layers.md)

`SpatialLayer.kind: 'vector' | 'raster'`; raster layers carry an empty
FeatureCollection plus `raster: RasterLayerInfo`. R-served XYZ tiles; MapLibre
`<Source>` keyed on `id+version`. `layerId`s are session-scoped →
`rehydrateRasterLayers()` after reload/R restart/project load. Symbology in
`RasterSymbologyDialog.tsx`; toolbox "Spatial — Raster" (`tools-raster.ts`, raster
fields use `filter: 'raster'` and ids ≠ `ds`). `.Rgeo` format v3 stores a tile
pyramid (`db-raster.R`), streamed in strips. Codegen: `ggplot-codegen.ts`,
`tmap-codegen.ts`, shared `codegen-shared.ts`; `MapAnnotations` (`map-annotations.ts`)
overrides spatial-store values when passed.

## Data Connector → [`data-connector.md`](docs/design-notes/data-connector.md)

- **Every renderer request goes through `proxyFetch`** (null-origin `file://`), with
  a timeout. Always check `res.ok`. Error text names the service, not "check your connection".
- Browse Sources (`sources.ts`): decide which args are the user's vs the dataset's
  identity (NWIS: service = dataset, parameterCd = field, one major filter).
  **A connector is a claim about someone else's API — run the R it generates.**
  `docsUrl` is required and must be https. Help opens via `shell.openExternal`.
  Much of `sources.ts` still interpolates user text raw — use `rStr`.
- Web APIs (`src/lib/api-connectors/`): `ApiProvider` interface, one generic
  `ApiConnectorBrowser` + shared `QueryBuilder`/`query-model.ts`. Only metadata and
  preview run in JS; the import is generated R echoed to the console. Optional hooks
  `probeCapacity` (→ `CapacityDialog`) and `validateQuery`.
- Server-side helpers own pagination/retry quirks: `ourgeo_read_arcgis` (EsriJSON +
  true curves, halving page size), `ourgeo_read_esri_image`, WCS/WMS/ERDDAP grid
  helpers (`.esriAscii`, not `.geotif`/`.nc`), `ourgeo_read_sdmx` (httr2, not `url()`),
  `ourgeo_read_odata`, `ourgeo_read_stac` (`limit` is per-page; `buildCode` omits it).
  Raster connectors use the `imageExport` panel and offer "Add to map when done".

## AI Assistant → [`ai-assistant.md`](docs/design-notes/ai-assistant.md)

`ai-client.ts`: four transports (Anthropic, OpenAI-compatible, Gemini, Ollama),
provider-neutral `AiTool[]`, `readLineStream` buffers across chunk boundaries.
Footer switches: **Autopilot** (`execute_r_code`, off), **Web** (search/fetch,
on), **Terminal** (off, AND-ed with Autopilot). A disabled capability is *absent*
from the request; `runTool` re-reads the store at call time. Every web/doc/UI/voice
call is logged to the console as `info`. Provenance rules: every figure must come
from a named R object via re-runnable code.

- **Chats** (`useAiStore.chats`, `activeChatId`): per-chat messages/session/usage via
  `patchActiveChat`; streaming state stays top-level. `selectMessages` returns the
  module-level `NO_MESSAGES` (never `?? []` — infinite re-render). `switchChat`
  restores provider/model without writing preferences; stops a running turn first.
  `deleteChat` never leaves zero. Chats are project content (`manifest.ui.chats`);
  scratch doesn't keep them.
- **Sending**: claim the send synchronously before the first `await`
  (`sendingRef`, `beginStream`). Read `getState().streamingContent` in catch/stop
  (never a closure) — failed or stopped turns keep partial text. A dropped stream is
  an error, not an end. `describeFetchFailure` names host + recovery. Aborts settle
  renderer-side. `detectMentionedObjects` reads user environments only.
- **Thinking effort** (`ai-thinking.ts`): conservative allowlist; Ollama discovers via
  `/api/show`; per provider/model in `ai-thinking.json`; signed thinking blocks echoed unchanged.
- Never exposed to the assistant: the AI panel itself, API keys, forum posting,
  voice/mic, submitting plugins/reviews, approving anything.

### Providers → [`ai-providers.md`](docs/design-notes/ai-providers.md)

- **ChatGPT plan**: official Sign in with ChatGPT; tokens only in main under
  `safeStorage` (Linux `basic_text` = unavailable); bearer only to
  `POST /v1/responses`; only `response.completed` is success; merge terminal output
  with streamed items; keep message phases; never auto-switch to API billing.
- **Claude subscription** = spawning the user's Claude Code CLI. **Never read, copy
  or reuse the CLI's credentials.** `--tools ""`, `--setting-sources ""`,
  `--strict-mcp-config`; tools reach it over the loopback MCP bridge
  (`claude-mcp.ts`) so `AiChatPanel.runTool` stays untouched. `--session-id`/`--resume`;
  a missing session is replayed once as new with `withEarlierTurns`. **The system
  prompt must be byte-constant** (cache prefix — changing it cost 16×); session
  context and switch positions ride the user turn. Context bar uses per-call usage,
  not the run sum. `requiresApiKey` ≠ `!isLocalProvider`. Detection probes run
  concurrently via `--version`. Never claim endorsement or "free Claude".

### Context broker & memory → [`ai-context-memory.md`](docs/design-notes/ai-context-memory.md)

Also `docs/context-implementation.md` (verified behaviour, pending work),
`docs/context-*-sdk.md`, `docs/context-platform-acceptance.md`.
- The broker (`src/lib/context/`, `electron/main/context/`) owns source selection,
  handles, budgets and permission/freshness checks; bodies are attributed evidence,
  never system instructions. Never reconnect the legacy `fullSessionContext`
  builders to chat — that bypasses exclusions.
- `budget.ts` reserves output + margin for every inference; `tool-compaction.ts`
  shortens only completed older results; original user instructions are never clipped.
- Usage/accounting: provider counters separate from occupancy estimates; missing
  fields stay unknown; encrypted content-free ledgers; estimated limits are not invoice caps.
- Memory, exclusions, journals: AES-GCM in SQLite on a worker, key via safeStorage
  (Linux basic_text refused). Protected-policy failure fails closed. Suggestions need
  acceptance; forgetting resets provider sessions.
- Managed providers (Mnemosyne/Hindsight) are experimental Linux profiles behind
  host-reviewed certificates; don't describe them as production connections.
  Changing the Mnemosyne bridge requires rerunning the offline/deletion spike.
- Native acceptance waits use `waitForAsync` (Playwright's sync `waitForFunction`
  treats a Promise as truthy).

### Documents & driving the GUI → [`ai-documents-and-gui.md`](docs/design-notes/ai-documents-and-gui.md)

- Document skill: knit is a clean session, so every object must be built by a chunk
  in the same document. Doc tools write only into visible editor tabs via
  `applyExternalContent` (Visual tab dropped to Source first), logged via `describeDocCall`.
- UI actions: registry in `ai-actions/registry.ts`; **ids use a colon
  (`map:addLayer`)** — dots look like R calls (`action-code-guard.ts`). Five AI tools
  cover all actions; the prompt lists no actions — discovery is `list_ui_actions`. Tiers `always`/`autopilot`/
  `confirm`, overrides sparse in `ai-preferences.json`; closing the confirm modal = no.
  `ui:highlight` targets `data-ourgeo-id` (closed catalogue in `targets.ts`, tested).
  Programmatic geometry is staged, not written. `ParamDef.valuesAt` resolves enums at
  call time; `lenient` allows labels. `UiAction.requires` gates before tier.
- The map view: `MapView` renders `sessionViewState ?? globalViewState`; use
  `mapView()`/`setMapView()` (`map-view.ts`), never write `viewState` directly.
- `list_ui_actions` with no filter above `MAX_DESCRIBED` returns ids by group only.
- Skills (`lib/skills/`, design note `ai-skills.md`): the only skill text in the system
  prompt is the catalog (`buildSkillCatalog`, 3% of the window); bodies arrive as
  attributed evidence via `use_skill` or host attachment. The catalog depends only
  on the library, so the prompt stays byte-constant per library state — defend that.
  `buildOurgeoCore` ships nowhere (legacy counterfactual for `accounting.test.ts`).

## Markdown & R Markdown → [`markdown-rmarkdown.md`](docs/design-notes/markdown-rmarkdown.md)

- Language is a FIELD (`TabState.language`, default `'r'`), not a `TabType`.
- `rmarkdown-monarch.ts` adds a brace-aware fence rule (pinned by a real-tokenizer
  test); `monaco-editor` is a direct, exactly-pinned dependency.
- Actions catalog → `computeMdEdit` (pure) → `MarkdownRibbon` uses `executeEdits`,
  never `applyExternalContent`. Generated bodies are `literal` (no `$N` expansion).
  `getCompletions(…, mode = 'r')` default keeps the console free of markdown items.
- Map chunks reuse `generateTmapCode`/`generateGgplotCode`; figure chunks are `include=FALSE`.
- Chunk identity (`chunk-identity.ts`): label → exact code → position → uuid; editing
  marks output `stale`, never drops it. Chunks run via `handlers-rmarkdown.R`
  (`png("%03d")`). View zones use `heightInPx`; zones belong to the editor (detach
  before `setModel`). Outputs live in `store/chunks.ts`, never on `TabState`.
- Knit = child `Rscript` (`electron/main/knit.ts`); `/rmarkdown/deps` pre-disables formats.
- Forum publish: markdown only, all auth/posting in main, PKCE loopback on
  127.0.0.1:8788–8790, refresh token in safeStorage, figures upload before the thread.
- Visual mode (Milkdown, confined to `editor/visual/`): text owns the truth; front
  matter never enters ProseMirror; switch gated by `roundtrip.ts`; a no-edit toggle is
  byte-identical; exit serializes the live doc (listener is debounced 200 ms);
  `minimizeEscapes`; chunk `meta` preserved; view and caret anchors are independent.

## Themes → [`themes.md`](docs/design-notes/themes.md)

Three axes on `useThemeStore`: **app theme** (`themes.ts`; owns `--geo-*` vars,
basemap, scene art, editor `colors`), **code theme** and **markdown theme**
(`editor-themes.ts`; token colours only). Switching code/markdown can never move the
editor background (tested). One Monaco theme (`EDITOR_MONACO_THEME`) carries both
palettes via token postfix (`.md`); every multi-segment markdown token needs a full-path
rule (`editor-themes-tokens.test.ts`). Redefine effect deps are exactly
`[themeId, codeThemeId, markdownThemeId, revision]`. Non-Monaco surfaces use
`--ourgeo-code-*`/`--ourgeo-md-*` with `:root` defaults.

- Theme Studio (sibling dialog of Settings): live mutable registries seeded from
  `BUILTIN_*`; user ids never shadow shipped ones; hex in, HSL derived; colours
  validated on import (Monaco throws on bad hex); `kind` field in files; artwork
  inlined as data URIs; `custom-themes.json`. `createJsonFileStore` serializes writes.
- Field collection (`field-themes.ts`), background galleries & linked image folders
  (`theme-backgrounds*.ts`, `electron/main/theme-backgrounds/`, opaque
  `ourgeo-theme-image:` URLs, strict limits), one shared slideshow clock,
  `theme-collections.ts` tabs. Docs: `docs/theme-backgrounds.md`.
- Assistant theme actions (`ai-actions/theme.ts`): refusals name the fix; `setColors`
  reports contrast.

## Workspace layout → [`workspace-layout.md`](docs/design-notes/workspace-layout.md), [`two-editors.md`](docs/design-notes/two-editors.md)

- Zones `left/center/right/bottom`, split or tabs, plus pane-local trees
  (`dock-tree.ts`). `src/lib/layout/model.ts` is pure; `normalize` holds the
  invariants (editor never homeless/closed, no panel twice, unknown ids dropped,
  sizes clamped, `active` valid).
- `panel-meta.ts`/`panel-render.ts` are separate from `panels.tsx` (Monaco touches
  `window` at import). Feature stores own `isOpen`; layout mirrors them one way
  except during `init`.
- In-zone sizes are weights, not px; weights are not persisted (presets keep them).
  Zone px clamped at render. Drag via one owner (`panel-drag.ts`) with
  `PaneDropDialog`. Grips ship OFF (`dragEnabled`); disables only the gesture.
  Layout export `.ourgeolayout.json`. Layout flush on quit is a single `write`.
- Panel instances: first keeps bare id, then `editor#2` (max 4 editors, others 1).
  Instance open state = base panel's. Only added instances can be removed, via
  `panel-instances.ts` (moves content first). `reconcilePanelContent` runs after every
  layout change. `TabState.panelId` absent = original; `activeByPanel`; `focusedEditor`.

## Plugins → [`plugins.md`](docs/design-notes/plugins.md), store → [`plugin-store.md`](docs/design-notes/plugin-store.md)

- Kinds, in preference: declarative JSON, R, code (`main.ts` compiled by esbuild-wasm
  to an IIFE). Themes/layouts are not contributable.
- The sandbox is **soft**; consent is the real control — say so. Permissions gate by
  absence. Frozen ctx is shallow per namespace. Loader re-registers everything in one
  pass. Crash guard: id written before `activate`. `plugin:enable` is `confirm`.
  All plugin paths confined to the plugins dir.
- Archives (`archive-policy.ts`): drop dot-paths both ends (the `.build` cache once
  let an archive decide what runs), normalised traversal guard, size/entry caps.
- Managed services: `service` permission, utility process, ready handshake with
  loopback URL + token. Panel renderers mount as components with error boundaries.
- Declarative connectors: `compileProvider(spec)` with five dialects; XML/adaptive
  probing providers need code.
- Store: built minified ESM bundle with host shims EXTERNAL (`onResolve`, not
  `external:`); minifying is not protection — only the private bucket is. Source
  archive accompanies every submission for review. Download verified against
  length + sha256. `installStoreArchive` refuses to replace a non-store folder.
  Installs arrive disabled; `store:install`/`update` are `confirm`.

## Voice input → [`voice-input.md`](docs/design-notes/voice-input.md)

One capture path (AudioWorklet, resample to 16 kHz). Level never through React.
Mic released on every exit path. Recorded audio never persists. Services are pure
request builders; multipart in `electron/main/voice.ts` (never set Content-Type).
On-device engine: `@huggingface/transformers` is a devDependency; weights downloaded,
served via `ourgeo-model://`. Permission handler is an allowlist
(`app-permissions.ts`): grant `clipboard-sanitized-write`, never `clipboard-read`
(terminal paste uses `clipboard:readText`).

## Terminal → [`terminal.md`](docs/design-notes/terminal.md)

Real pty (`@lydell/node-pty`, pinned; `scripts/check-pty.mjs` before packaging;
`asarUnpack` the whole package; lazy import behind try/catch). Main coalesces
(8 ms/64 KB), flow-controls (512/128 KB), keeps a 128 KB in-memory replay ring,
reads cwd from `/proc`. Output never written to disk. Bytes never enter React;
sinks are a set, registered before attach; views stay mounted; session creation
idempotent. ANSI colours derived from the code theme (exclusive assignment),
surface from the app theme. `hostsTabs` puts zone tabs in the panel header.
Terminal is `essential`, no toolbar button; placement applied in `useLayoutStore.init`.
Assistant `terminal:*` actions need the Terminal switch; `terminal:run` uses an OSC
completion marker, never a raw ESC byte. Login shells on macOS only.

## Releases, updates, health check → [`releases-updates-health.md`](docs/design-notes/releases-updates-health.md)

Versions in `versionHistory.ts`; running version from `package.json`. Updates: main
parses official `download.php` installer cards, never auto-installs, close via
`BrowserWindow.close()`. Health check runs package diagnostics in an independent
base-R Rscript; S2 probe in `r/lib/health-s2.R`; every install/inference needs approval.

## Data preflight & vector export → [`data-preflight-and-vector-export.md`](docs/design-notes/data-preflight-and-vector-export.md)

`r/lib/data-preflight.R` + `src/lib/data-preflight.ts` shared by `ToolForm` and AI
`runToolboxTool`. Renderer acknowledgments are not authority: main fetches the report
and asks via an OS dialog, bound by a private session secret. `dq_commit` revalidates.
Vector export (`r/lib/vector-export.R`, `lib/vector-export.ts`): staged write →
readback → publish with hashes and locks. Docs: `docs/vector-export*.md`,
`docs/toolbox-buffer-fix.md`. Checks: `scripts/check-toolbox.mjs`, `check-toolbox-ui.mjs`.

## Plot Popout Window

`window.location.hash === '#plot-popout'` causes `App.tsx` to render `PlotPopoutView` instead of `MainApp`. The Electron main process creates this secondary window via `plot-window.ts` and pushes new plot data URLs via `ipcRenderer.on('plot:update', ...)` → `window.electronAPI.plot.onUpdate(...)`.

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

**A setting is a `Switch`, not a checkbox** (`ui/switch.tsx`): every Settings row takes effect immediately. Checkboxes are for values acted on later. The whole row is the `<button role="switch">`.

## Recurring bug classes (check for these)

- **Stale closures**: read `useXStore.getState()` at call time in async callbacks
  (`useGeometryCommit`, `streamingContent`, screenshot upload ref).
- **Selectors that build values** re-render forever in zustand — return stable references.
- **Silent success**: check `res.ok`, check clipboard promises, never report a tick
  before the write resolves, never treat a truncated stream as complete.
- **Absent beats refusing**: don't expose a capability that always refuses.
- **Echo the R**: every GUI operation that touches R echoes runnable R to the console.
