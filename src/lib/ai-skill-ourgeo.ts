// What the assistant knows about ouRGeo itself.
//
// Progressive, not all at once. The core goes in every system prompt (~800
// tokens): what the application is, the one rule that governs how it works, the
// layout, and how to run a tutorial. Everything else sits behind the
// `ourgeo_docs` tool, so a local model with a 32k window pays for a topic only
// when it opens one.
//
// Written from ouRGeo's own documentation (ourgeo.dev/docs*.html) plus the
// things only the source knows — the tile engine, the .Rgeo raster pyramid, the
// knit and publish contracts.

import { actionIndex } from '@/lib/ai-actions/registry'

/**
 * Always in the prompt.
 *
 * The action index is generated from the registry rather than written out, so
 * it cannot drift: a new action appears in the model's context the moment it is
 * registered, and a test asserts every id in it resolves.
 */
export function buildOurgeoCore(): string {
  return `## ouRGeo — the application you are inside

ouRGeo is a desktop spatial IDE: an open-source alternative to ArcGIS Pro that keeps R at the centre. It wraps R's spatial stack (sf, terra, ggplot2, tmap) in a GUI, and runs a real R session the user shares with you.

**The rule the whole application is built on: every GUI action echoes its R to the console.** A button that filters a layer prints the \`dplyr::filter()\` it ran. That is what makes the work auditable, reproducible and editable outside ouRGeo, and it governs how you should behave too — prefer the action that emits R the user can read over doing the same thing invisibly.

### The layout

A top toolbar; a left column (Environment, Packages, Databases); a centre column (Monaco editor above, R console below, Terminal tabbed beside it); a right column (Spatial Editor, Plots, AI chat, Help). Panels toggle from the toolbar — except the Terminal, which has no button: it is always a tab beside the R console. The project menu is far right, with the R status dot.

### What you can do

You can drive all of it. \`run_ui_action\` performs one interface action; \`list_ui_actions\` gives you the parameters. These are the ids:

${actionIndex()}

**These are not R functions.** They exist only as \`run_ui_action\` calls — \`run_ui_action({ id: "map:addLayer", params: { object: "pts" } })\`. R has never heard of \`map:addLayer\`, and neither has any package. So:

- Never write an action id into R code, a chunk, or a block for the user to run. It will fail with \`could not find function\`, and the user will think their installation is broken.
- If you cannot perform an action — Autopilot is off, or the user declined — do not hand them the id. Tell them which **button** does it, and point at it with \`ui:highlight\`.
- R code is for R: \`sf\`, \`terra\`, \`dplyr\`, \`ggplot2\`. The interface is for actions. They never mix in one block.

\`toolbox_tools\` searches the 88 geoprocessing tools and \`run_toolbox_tool\` runs one (\`dryRun\` shows the code without running it). \`ourgeo_docs\` reads ouRGeo's documentation — use it rather than guessing how a feature works.

**The terminal runs the user's own shell.** \`terminal:*\` needs the Terminal switch in the AI panel footer as well as Autopilot, and is for what is genuinely outside R — read \`ourgeo_docs({topic: "terminal"})\` first.

**You can add capabilities ouRGeo does not have.** Search the **plugin store** first (\`store:search\`) — somebody may have written it already. Otherwise write a plugin: \`ourgeo_docs({topic: "extending"})\`, or \`{topic: "plugin-store"}\` for installing and publishing.

Actions are tiered: reading is always allowed; anything touching R state or the filesystem needs Autopilot; destructive ones ask the user to confirm. The user can move any action between tiers from the gear beside the Autopilot switch. A refusal is an answer — report it and offer to point at the control instead.

### Running a tutorial

This is what the interface access is for. When a user asks how to do something in ouRGeo:

1. **Look before you speak.** \`ui:describe\` and \`map:status\` tell you what is actually open and loaded. Never describe a panel you have not read back.
2. **One step at a time.** Say what the step does and why, do or point at it, then wait. Do not run six actions and summarise.
3. **Point rather than press, when the point is teaching.** \`ui:highlight\` rings a real control and lets the user click it — they remember where it is. Do it for them when they asked you to do it, or when the step is incidental.
4. **Show the R.** Every operation prints its code; refer to it. \`run_toolbox_tool\` with \`dryRun: true\` shows what a dialog would produce, which is often the best thing to put in front of a learner.
5. **Never invent the interface.** If you are not sure a button exists, read \`ourgeo_docs\` or search \`list_ui_actions\`. A confidently wrong instruction costs more than a lookup.

### When an action fails

The result text is the truth — read it before reacting; it usually says what to do. Retry the same call **once** at most. If it fails again, re-read the state (\`map:status\`, \`ui:describe\`), tell the user plainly what failed, and stop. Never work around a failed action by rebuilding, simplifying or renaming the user's data: a layer that fails to add says nothing about its geometry, and a severed connection says nothing about the object at all.`
}

// ── The reference, served by `ourgeo_docs` ─────────────────────────────────

const BUILTIN_TOPICS: Record<string, string> = {
  terminal: `# The terminal

A real pseudo-terminal running the user's own shell — bash, zsh, fish, PowerShell, whatever they use — tabbed with the R console by default. It has its own tab strip: one panel, many shells, the way the code editor holds many documents. There is no toolbar button for it: the tab IS how it is reached, and it is always open — but nothing spawns a shell until the tab is actually clicked, so \`ui:panel\` has nothing to open. **Settings → Terminal** has a switch that gives it its own pane beside the console instead, so both are visible at once (point at it with \`ui:highlight\`, target \`settings.terminalPlacement\`); after that the user is free to drag it anywhere and it stays put.

## Before you reach for it

**Rule 0 does not bind here, and that is the problem, not a licence.** Every other thing you do in ouRGeo echoes R to the console, so the user ends the session with a script of what happened. The terminal echoes nothing they can re-run. So:

- If it can be done in R, do it in R. \`execute_r_code\` is reproducible and auditable; a shell command is neither.
- Use the terminal for what is genuinely outside R: installing a system library (GDAL, PROJ, pandoc), \`git\`, inspecting a file with \`gdalinfo\` or \`ogrinfo\` before importing it, checking a path or a version.
- \`system()\` from R is the middle road and is often the better answer for a one-off, because the call and its output land in the console.

## The two switches

Every \`terminal:*\` action needs **both** Autopilot and the **Terminal switch** in the AI panel footer. Terminal ships OFF. With it off the actions are not listed to you at all, so if you can see them, it is on.

This is not a sandbox and you should not describe it as one — R's \`system()\` reaches the same machine from behind Autopilot alone. What the switch means is that the user decided, deliberately and once, that running commands on their computer is part of what you do.

## What you must do in exchange

- **One command per call.** A newline in \`command\` is refused: only the first line would be measured, and the rest would run unwatched.
- **Say what a command will do before running it** when it installs, deletes, overwrites, or touches anything outside the project. If you are unsure, ask. The user cannot un-run \`rm\`.
- **Report the exit code and the real output.** A non-zero exit is a finding, not something to retry blindly with a different flag.
- Every command is typed into a tab the user is watching and logged to their console as \`AI: terminal:run (command: …)\`. Write commands you would be content to have read back to you.

## The actions

- \`terminal:list\` — the open tabs, their shells, directories and whether each is still running. Start here; the ids are what the others take.
- \`terminal:open\` — a new tab. \`shell\` names a profile from the machine's own list, \`cwd\` a starting directory. Both optional: the default is the user's shell in R's working directory.
- \`terminal:run\` — run \`command\` and wait. Returns the output and, on most shells, the exit code. It opens a terminal first if none is open.
- \`terminal:read\` — the last N lines of a tab, including what the USER ran. Use it to see what happened before you arrived, or to read a tab whose shell has since exited.
- \`terminal:interrupt\` — Ctrl+C.
- \`terminal:close\` — end a tab's shell.

## Things that will surprise you

- **A command that never finishes is not an error.** \`terminal:run\` returns after two minutes with what it has and says the command is still running. It has NOT been stopped — decide whether to \`terminal:interrupt\` it rather than running something else on top.
- **Interactive programs work**, which means you can start one by accident. \`vim\`, \`less\`, \`top\` and a package manager's confirmation prompt will all sit there waiting for a keypress that never comes. Prefer non-interactive flags (\`--yes\`, \`--no-pager\`, \`| cat\`).
- **The shell is not R's session.** \`cd\` in the terminal does not move R, and \`setwd()\` does not move the shell. The tab's right-click menu has both directions; \`terminal:list\` reports each shell's directory so you can see when they have diverged.
- **Some shells cannot report an exit code** (cmd.exe, and anything unrecognised). You are told when that is so — say "finished" rather than claiming success.
- **Terminal output is never saved.** It is not in the project bundle, not in \`session.json\`, not on disk anywhere. If something matters, put it somewhere that persists.`,

  interface: `# The interface

**Top toolbar**, left to right: Toggle Environment, Toggle Packages, Open File (Ctrl+O), Save (Ctrl+S), Save As, Load Data, Toggle Database Connections, Data Connector, Toolbox, AI Assistant, Record Console, Toggle Spatial Editor, Toggle Plotting Preview, Help. Settings is pinned far right, next to the project menu. A toggled-on panel's button turns blue.

**Environment panel** — objects in the R session, grouped by environment, with class, size and a preview. Search filters. Clicking a data frame, matrix or vector opens it in the Data Viewer; clicking a function opens it in the function editor. Right-click an object for remove / rename / copy / move, or an environment for export / copy / rename / delete.

An environment the user creates lives in \`.GlobalEnv\` (its objects are \`myenv$x\`) and is listed BESIDE it by default; **Show** in its right-click menu lists it as a row inside \`.GlobalEnv\` instead \u2014 one or the other, never both, and a display choice only. Every environment is \`new.env(parent = .GlobalEnv)\`; ouRGeo offers no other kind.

R resolves a name OUTWARDS \u2014 never into an environment sitting in \`.GlobalEnv\` \u2014 so once \`x\` is in \`env2\`, \`x * a\` at the prompt is an error and the ways in are \`env2$x\`, \`with(env2, x * a)\` or \`eval(quote(x * a), env2)\`. **Work in this environment** (its right-click menu, or \`env:workIn\`) points the console AND every tool at it, so \`x * a\` works directly; \`.GlobalEnv\` stays visible through it because it is the environment's parent, and new objects are created there rather than in \`.GlobalEnv\`. The prompt shows the environment while it is not \`.GlobalEnv\`, and the switch echoes the R for it \u2014 \`evalq({ \u2026 }, env2)\` \u2014 which is also how to do the same thing in a script or a chunk. Objects carry **Copy To** (same name, another environment, original kept) beside **Move To**. The eye in the header decides what the panel shows *and* what it can act on: hiding non-user objects leaves \`.GlobalEnv\` and the user's own environments, and that is exactly what **Move To** offers; turning it off offers the whole session. **Export** writes an \`.RData\` file (ouRGeo's own functions are never in it); **Load** reads one back.

**Which model is answering** — Settings → AI Assistant. Cloud providers (Anthropic, OpenAI, Gemini) take an API key; local servers (Ollama, LM Studio, llama.cpp and friends) take a URL. There is also **Claude subscription (Claude Code)**, which takes neither: ouRGeo runs the \`claude\` command-line tool the user installed and signed in to, so the answer comes from their Claude plan rather than an API balance and ouRGeo never sees a credential. It needs Claude Code installed and \`claude auth login\` run once; the settings row shows which binary was found and who it is signed in as. On that provider your tools arrive over MCP and are listed as \`mcp__ourgeo__\u2026\` — same tools, same switches. It is a few seconds slower to first token because a process starts per answer, and its usage counts against the user's Claude plan limits.

**OpenAI subscription (ChatGPT)** is another provider in Settings → AI Assistant. Continue with ChatGPT opens browser authorisation for ouRGeo to use the user's eligible plan and subscription credits. Select an account/workspace and an eligible model; Manage usage and credits opens ChatGPT Settings → Usage. API billing stays a separately selected provider. This OpenAI flow is in preview and account/workspace eligibility applies. The existing tool switches and permission tiers still apply. Tokens remain in the main process, are saved only with a secure OS keyring, and never enter a project. Voice transcription uses its own configured service. If ChatGPT completes without a final answer or the stream ends early, the panel shows an error and keeps any partial text. Retry or select another eligible model in Settings → AI Assistant; request IDs, when supplied, help diagnose provider failures.

**Chats belong to the project** — the AI panel keeps many conversations, not one. The header shows how many (\`ai.chatSwitcher\`); the switcher lists them with their titles, sizes and the model each was held with, and \`+\` starts another without touching the ones already there. In a saved project they are kept with it and travel inside the \`.ourgeoproj\`; in the scratch workspace they last until the user quits \u2014 so if a conversation is worth keeping, the answer is to save the session as a project. Each remembers the provider and model it was held with, and switching back restores it. **You can read them but not move between them**: \`chat:list\` and \`chat:read\` are yours; switching, renaming and deleting are the user's, from that switcher. Use \`chat:read\` when the user refers to something decided in an earlier conversation — it is in this project and nowhere else.

**Voice input** — the microphone beside Send in the AI panel dictates into the message box; the transcript is inserted at the cursor for the user to edit, and auto-send is off by default. Transcription runs on the user's machine by default (Whisper, downloaded once, offline afterwards); they can also point it at a server they run, or at Deepgram, ElevenLabs or AssemblyAI. Device, service, language and the silence timeout live in Settings \u2192 Voice input, or on the microphone's right-click menu. Anything sent off the machine is logged to the R console. **You cannot start or stop it** — the microphone is the user's; point at it (\`ui:highlight\` target \`ai.voice\`) and let them press it.

**Packages panel** — installed packages with attach/detach checkboxes, search, an install dialog, an update checker, and library-path management.

**Databases panel** — .Rgeo (DuckDB-backed) files: pick a workspace folder, create or connect a database, and bring tables out as R variables.

**Code editor** — Monaco, the VS Code engine. R syntax highlighting with autocomplete driven by the live R session, so it completes objects that actually exist. Tabs are either documents (.R, .md, .Rmd, .qmd) or object tabs (Data Viewer, function editor). Ctrl+N new tab, Ctrl+W close, Ctrl+Space autocomplete. The toolbar has "Line" (Ctrl+Enter) and "Run All".

**R console** — a real prompt below the editor. Shift+Enter for a newline, arrow keys for history, live streaming output, colour-coded errors. Plots are captured automatically into the Plots panel. The header shows the working directory; clicking it opens the menu that changes it. "Clear console" clears the display only — the session keeps its objects.

**Data Viewer** — opens as a tab, not a sidebar. Sortable grid; sf geometry columns show alongside attributes. Add Column and a per-column type dropdown edit in place. Anything carrying geometry also gets **Add to Map** in the header, which sends it to the Spatial Editor — and asks first if it is already a layer there.

**Plots panel** — plot history with previous/next, an Active View mode for live previews, a ggplot2 chart builder, and Export at publication resolution.

**Help panel** — R documentation in-app and offline: search, back/forward, package pages and vignettes. Typing \`?something\` in the console opens it here.

**Settings** — one scrollable dialog: Appearance (10 app themes, plus separate code-editor and markdown editor themes, interface scale, and the **Theme Studio** — where the user builds their own themes on all three axes, with an editor backdrop image, a card image, a default basemap, and import/export as \`.ourgeotheme.json\` files), Workspace (panel dragging on/off, saved arrangements with import/export as \`.ourgeolayout.json\`, and Restore default arrangement), R Backend, Spatial Editor (initial extent, attribute popup, default and calculation CRS), Basemaps (API keys), Data API Keys, AI Assistant (provider, model, base URL, context window).

A user theme is a first-class theme: \`ui:theme\` / \`ui:codeTheme\` / \`ui:markdownTheme\` take its id like any other. Call \`theme:list\` to find out which ones exist — the parameter enums resolve live, but a listing is cheaper than a guess.`,

  toolbox: `# The Toolbox

88 tools in seven categories:

- **Table Operations** (11) — filter, select, mutate, slice, distinct, rename and friends.
- **Joins & Combine** (2) — stacking and joining datasets.
- **Aggregate & Reshape** (5) — group summaries and pivoting.
- **Type & String** (8) — type conversion and text handling.
- **Spatial — sf** (17) — geometry operations through the sf package.
- **Spatial — geos** (11) — overlays through the geos engine.
- **Spatial — Raster** (34) — terra, for gridded data.

**Running one.** Pick a dataset from the environment dropdown, fill the fields, name the output. A live preview pane shows the exact R the form produces. Three buttons: **Run**, **Pipe →** (chain into the next tool as a \`|>\` pipeline instead of creating an intermediate object) and **Copy Code**.

**Piping.** Pipe → feeds one tool's output into the next. The output name locks from the first step, later forms predict the columns earlier steps produce, and a banner shows the chain with an × to clear it.

**Linearize curved geometry** appears on spatial tools and is unticked by default, so CIRCULARSTRING and friends keep their exact geometry. For preflight-controlled analytical tools, unsupported curved input blocks; the checkbox does not silently flatten it. Projected SF buffers can explicitly approve a polygon approximation of their result.

**Calculation CRS** appears on nine tools (Buffer, Intersection, Union, Difference, Erase, Clip, Centroid, Simplify and one more). Choose the default from Settings, the layer's native CRS, auto-detect, a named projection, or a custom EPSG. Preflight-controlled tools use the native CRS/S2 or an explicitly reviewed working CRS; their automatic-UTM option is replaced. Other tools retain their existing projection behaviour.

**Data checks.** The Data Viewer header opens read-only inspection of vector geometry, fields, identities and CRS. Controlled buffer, distance/area/length, overlay/intersection, spatial filter/join, attribute join and group-summary tools preflight in R before execution; the assistant uses the same enforced path. A blocked or incomplete check cannot be acknowledged away. Only the user's native Desktop review grants consequential consent. Do not manufacture acknowledgment values. Assignment records a known-coordinate metadata assumption on a copy; transformation changes coordinates from a known source CRS. Native geographic measurements use S2 metric units; no projection is inferred and degrees are never metres. International and US survey feet are separate units. Analytical curved/Z/M inputs may be blocked; no automatic repair or flattening occurs. Materialise a pipeline before checking its result.

**Join and summary choices.** Specify the expected relationship and suffixes; exact typed join keys preserve case/whitespace/leading zeros, with blank/missing keys non-matching. Expansion needs a review. Missing/non-finite summary values default to blocking; deliberate propagate/omit policies record counts and denominators. Exclusions require explicit source rows and a reason. Source edits, changed selections or parameters invalidate permission. Actual checked R and local validation records accompany results. Requested import reprojection preserves a native copy and reviews the derived transformation.

**Scope limits.** Raster validation and scientific certification are outside V1. No controlled vector-file GeoPackage/GeoJSON exporter or publication bridge exists here; their validation contracts report blocked missing integration. Driver availability does not establish preservation. User-authored R is outside the controlled-handler guarantee. The first-run installation health check remains separate. Data checks need no account, LLM or network.

Raster tools skip the Data Viewer, because a SpatRaster is not tabular. Zonal Statistics summarises raster values inside polygons; Export Raster to File writes GeoTIFF or COG.`,

  'data-import': `# Getting data in

**Load Data** (toolbar) imports a file. The format is detected from the extension and the options change to match: delimited text (CSV, TSV, TXT), spreadsheets (Excel, ODS), columnar and binary (Parquet, Feather, JSON), statistical (SAS, SPSS, Stata), vector spatial (Shapefile, GeoJSON, KML, GeoPackage, any OGR format), and raster (GeoTIFF, NetCDF, JPEG2000, any GDAL format). Options cover delimiter, encoding, sheet, CRS override and reprojection. The AI action is \`data:load\`, and it emits the same code.

**Create data object** builds a data frame, matrix or vector by hand — good for lookup tables.

**Data Connector** has three modes. *Browse Sources* is a curated catalogue. *Web APIs* is a provider framework: CKAN and Socrata (open data); Esri ArcGIS REST, OGC API–Features, WFS and Macrostrat (geospatial → sf); Esri Image Services, OGC WCS, OGC WMS, STAC and ERDDAP Grids (raster → SpatRaster); ERDDAP (scientific); SDMX and OData (statistics). One shared query builder serialises to each provider's dialect (SoQL, CQL, OData $filter, OGC params, ERDDAP constraints, SDMX keys). *Manual* takes a URL you type. Only metadata and previews run in the app; the import itself is generated R.

**.Rgeo databases** are DuckDB files for data that does not want to live in memory: vector tables and raster tile pyramids in one file. "Connect" gives a lazy dplyr proxy that filters in the database; "load" pulls it into RAM.

Whatever the source, the import is R echoed to the console. Several helpers are defined by ouRGeo — \`ourgeo_read_arcgis()\`, \`ourgeo_read_wcs()\`, \`ourgeo_read_wms()\`, \`ourgeo_read_stac()\`, \`ourgeo_read_sdmx()\`, \`ourgeo_read_odata()\`, \`ourgeo_read_erddap_grid()\`, \`ourgeo_read_esri_image()\` — which handle pagination, retries and each API's quirks. They exist in the session, so the generated code runs on its own.`,

  maps: `# The Spatial Editor

A GPU-accelerated MapLibre canvas tied to R objects. **A layer is a view onto an R object, not a copy** — change the object and the layer follows.

**Add Features** pulls vector and raster objects out of the R environment. Vectors arrive as GeoJSON; rasters are registered with a tile engine (warped to EPSG:3857, served as styled 256px XYZ PNG tiles), which is why a large raster stays responsive.

**Contents** lists the layers: visibility, order, removal, and the way in to symbology and labels. Right-click a layer for **Open in data editor**, which opens its attribute table as a tab (a raster has bands rather than rows, so it says so instead). The three panels move objects between each other both ways: the Environment panel and the data viewer send to the map, Contents sends back.

**Symbology.** Vector layers style fill and border colour, line width, marker shape, halo and opacity — each either uniform or driven by a column. Raster layers choose singleband, RGB composite or categorical, with a stretch (min-max, percent clip, standard deviations, custom) and a colour ramp.

**Labels** are per layer: the column, typography, placement, halo, and what to do when labels collide.

**Selection** is point-click or lasso, plus attribute queries. A selection scopes toolbox operations.

**Map Settings** holds the legend and north arrow. Both carry into exported code as real ggplot2/tmap components, not as decorations painted on top.

**Export** has three destinations. *Export to IMG* captures the canvas at publication resolution. *Export to tmap* and *Export to ggplot* generate standalone R that reproduces what is on screen — basemap via maptiles, vector geoms with the symbology you set, rasters via \`geom_spatraster\` or \`tm_raster\`. The AI action \`map:exportCode\` calls the same generators.`,

  drawing: `# Drawing and editing geometry

Edit Mode opens a dedicated ribbon with ten tools: select, draw, edit-vertices, move-feature, add-point, rectangle, circle, freehand, trace and distance-bearing. **Distance & Bearing (B) and Curve (U) are two doors into the same tool** — the same entry strip, differing only in which kind of course it starts on.

**True curves.** The curve mode draws circular arcs rather than straight segments. An sf column stores them exactly as CIRCULARSTRING; a geos column cannot hold curves, so they are densified — the console says so when that happens. Reading curves back needs the \`sfarc\` package.

**Snapping** works across visible layers, to vertices, edges, midpoints and intersections, within a pixel tolerance set in Settings.

**Distance & Bearing** (the \`distance-bearing\` tool, hotkey B, on every geometry type). One click — or a typed \`lng, lat\` — says where the measuring starts; every vertex after it is typed into a strip under the map, and each entry places a vertex exactly as a click would.

On a **line or polygon** that first click is the first vertex, and courses build one feature that Finish commits. On a **point layer** it is a *reference point*: a temporary mark to measure from, never a row — and each leg then writes the row the session is on and moves to the next, so the data viewer's row indicator walks the table exactly as it does when the user clicks. When the rows run out the ribbon asks whether to add another, and typing the next leg answers yes. The reference snaps like any placed point, carries forward from the last point placed, and is moved by clicking somewhere else. It reads azimuths (\`45.5\`, \`45°30'15"\`, \`45 30 15\`), quadrant bearings (\`N45°30'E\`, \`S30W\`), deflections from the previous leg (\`R90\`, \`L12°30'\`) and angles right; distances in metres, feet, US survey feet, chains, miles, with a unit typed after the number (\`150ft\`) overriding the selector. It shows the closure and the 1:N of a ring as it goes, and finishing echoes a runnable \`ourgeo_traverse()\` call.

**Curves are courses in the same figure, not a separate tool**, because a deed call is one figure: *"N45°30'E 150.00 feet; thence along a curve to the right, R = 250, Δ = 45°30'; thence S12°E 82.00 feet"*. The Course selector switches between five kinds:

- **Distance & bearing** — a straight course.
- **Tangent curve** — continues the previous course tangentially. Any TWO of radius, delta, arc length, chord, tangent, external, mid-ordinate or degree of curve, because different plans quote different pairs; each slot says which element it is. Degree of curve appears only in feet (it is defined on 100-unit stations) and asks arc or chord definition, which mean different radii.
- **Curve** — the same, for one that does not continue anything, oriented by its chord bearing or the radial bearing to its centre.
- **Spiral** — a clothoid transition, entry or exit, from a length and the radius it reaches.
- **Spiral–curve–spiral** — what a highway plan quotes as one unit: Ls, R and the TOTAL deflection.
- **Free curve (Bézier)** — leaves on the heading it inherited, ends at a distance and bearing, arriving on a heading you give. \`Bend\` scales the handles; 1 is the roundest.

The strip prints **every** element back, not just the two typed — L, C, T, E, M and the chord bearing for a curve; θs, A, p, k, Δc, Lc and Ts for a transition. Those are the figures a plat quotes so they can be checked, and checking them against the page is the point. A pair that fits two different curves (a tangent length and a mid-ordinate, say) is refused by name with both angles listed rather than guessed at; a radius and a chord take the ordinary curve over its reflex partner, which the readout then shows.

Curves commit as real \`CIRCULARSTRING\`/\`COMPOUNDCURVE\` geometry, fitted to within a millimetre — a spiral and a Bézier have no representation in any format ouRGeo can write, so they are approximated by circular arcs, which beat straight segments by more than an order of magnitude at the same vertex count and keep the result a curve. The closure counts a curve's ARC, never its chord.

**Which coordinate system the numbers are in.** Two bases, named in the strip. *Geodesic* measures on the WGS84 ellipsoid from true north — the default, and the same numbers anywhere on Earth. *Grid* measures on the layer's own projected CRS, which is what a bearing off a survey plat means; it is the default when the layer is projected, and its unit starts as the CRS's own (US survey feet for most State Plane zones). The difference is not cosmetic: grid convergence reaches ~3° at a UTM zone edge and the point scale factor is ~1:2500, so the same numbers land in a different place. Say which basis you used.

\`draw:traverse\` builds a feature from a start point and a list of courses the same way, staged like any drawn geometry, and takes the curved kinds too (\`{type:"curve"|"spiral"|"scs"|"bezier", …}\`) — curves stay curves in the WKT it stages. It is **geodesic only** — the grid basis needs R per course, and the person at the strip has both. Older muscle memory still works: the ribbon's one-line box takes \`lng,lat\` or \`d150 a45\`.

**Edits stage; they do not apply.** Everything drawn accumulates as pending edits, counted in the ribbon's Save Edits badge. Save Edits writes them to the R object as one batched statement echoed to the console, or discards them and restores the previous geometry. Database-backed layers flush through the .Rgeo update path instead. This staging is also how the AI's \`draw:addFeature\` works: a geometry the assistant produces is reviewed exactly like one the user drew.`,

  projects: `# Projects and persistence

ouRGeo launches into a **scratch workspace**: a clean R session every time, never saved in place. Save As turns it into a real project.

A **.ourgeoproj** is a portable zip: a manifest (open tabs, spatial layers, map view, legend and north arrow settings, plots, connected databases) plus \`environment.RData\` holding the user's objects. Loading one resets the R session, hydrates the stores, loads the environment, then reopens each .Rgeo and rebinds its lazy proxies — the restored proxy objects hold stale connections otherwise.

Named projects track dirty state: changing the environment, the map, the plots or an object tab marks the project unsaved, and closing the window prompts to save. Scratch never prompts. Recent projects (five) persist.

**Between sessions**, only code tabs survive by design — open .R files and untitled scratch documents. Spatial layers, console history, plots and object tabs are session-scoped and deleted on a clean exit, so the next launch is clean. A crash leaves them behind on purpose, so the work can be recovered.

**Recording** captures everything run in the console into a document, optionally with output, turning a session into a runnable script.`,

  documents: `# Markdown and R Markdown

.md, .Rmd and .qmd are first-class documents in the code editor, with a ribbon, a slash menu, and a Visual (WYSIWYG) mode alongside Source.

**Chunks run inline** — Ctrl+Shift+Enter or the ▶ on the chunk — in the LIVE R session, with output shown beneath the chunk. An inline run honours only \`eval\`, \`fig.width\`, \`fig.height\`, \`dpi\`, \`warning\` and \`message\`.

**Knit spawns a clean child Rscript**, with the document's own folder as the working directory. Nothing from the user's session exists there. That is the difference that catches people out: a document can run perfectly inline and still fail to knit, and it is why every object a chunk uses must be created by an earlier chunk in the same document. HTML, PDF, Word and Markdown are the formats; all need pandoc (not an R package), and PDF needs LaTeX. .qmd needs the Quarto CLI, which ouRGeo does not bundle.

**Map chunks** generate real code from the map on screen, through the same tmap/ggplot generators the Export dialogs use. Which generator is a setting (Settings → Documents): tmap, ggplot, or auto, which follows whichever Export dialog was used last.

**Visual mode** is a projection of the text, not a second document: the text always owns the truth, front matter never enters it, and a look-and-leave toggle is byte-identical. Footnotes have no node in its schema, and \`$…$\` math renders literally.

**Publish** knits to Markdown and posts to the ouRGeo forum as a new discussion. The forum renders a small Markdown vocabulary, caps a post at 12,000 characters, rejects raw HTML and data: URIs, and takes figures as separate uploads.`,

  databases: `# .Rgeo databases

A single DuckDB file holding vector tables and rasters, for data too big or too slow to keep in memory.

**Connect vs load.** Connecting gives a \`dplyr::tbl\` proxy: filters, joins and summaries run inside the database, and only the result comes back. Loading pulls everything into R. Spatial layers backed by a connected table stream features by viewport rather than loading one huge GeoJSON.

**Rasters** are stored as a GeoPackage-style tile pyramid — metadata (CRS as WKT2, dimensions, dtype, nodata, band stats) plus gzip'd dtype-faithful 256px blocks with ×2 overview levels. Saving streams in strips, so a raster larger than RAM can be written; connecting streams level-0 blocks into a temporary GeoTIFF and hands back a GDAL-lazy SpatRaster.

Databases connected in a project are reopened and rebound when the project loads. Requires the DBI, duckdb and dplyr packages.`,

  shortcuts: `# Keyboard shortcuts

- **Ctrl+Enter** — run the current line (and advance)
- **Shift+Enter** — run the selection; in the console, insert a newline instead of submitting
- **Ctrl+Shift+Enter** — run the R Markdown chunk under the caret
- **Ctrl+O** — open a file
- **Ctrl+S** — save the active tab
- **Ctrl+N** — new tab
- **Ctrl+W** — close the tab
- **Ctrl+Space** — autocomplete
- **Ctrl+Shift+=** / **Ctrl+Shift+-** — interface zoom
- **Ctrl+Z / Ctrl+Y** — undo/redo, including vertex-level undo while drawing
- **Escape** — cancel the current drawing, or dismiss a highlight
- Arrow keys in the console walk the command history`,

  troubleshooting: `# Troubleshooting

**Health check.** Open Settings → Health check to diagnose R, packages, system resources and AI configuration. The first-launch invitation is dismissible. Installs, repairs and model downloads require approval; testing a cloud or subscription model asks before using credits or plan allowance. The check saves a summary and offers local Qwen models suited to the available memory and storage.

**"R session not ready" / no connection.** ouRGeo spawns Rscript and reads the port it prints. R or a core package (httpuv, jsonlite, later, httr2) may be missing, outdated or incompatible after an R upgrade. The health check works independently of the backend and can repair these packages and their dependencies. Save the project before approving a repair that stops R, then reconnect. Running \`Rscript r/server.R\` by hand shows the underlying error if further diagnosis is needed.

**\`object '…' not found\` when knitting.** Knit is a clean session; console objects do not exist in it. The document needs a chunk that loads or builds the object.

**pandoc not found.** pandoc is not an R package and R does not bundle it. Install it from pandoc.org, or the \`pandoc\` R package which ships a copy. PDF additionally needs LaTeX — \`tinytex::install_tinytex()\`.

**Curved geometry looks wrong or fails.** CIRCULARSTRING, COMPOUNDCURVE and CURVEPOLYGON need the \`sfarc\` package. GEOS operations cannot take curves — tick Linearize on the tool.

**Unexpected CRS results.** Check the Calculation CRS on the tool and the default in Settings → Spatial Editor. Area and distance in degrees are meaningless; project first.

**A raster layer disappears.** Layer registrations are session-scoped. After an R restart or a project load they are re-registered automatically; if the backing R object is gone the layer is dropped instead.

**"The connection to the R server was severed."** A request died before R answered — the machine slept, the network changed, or a keep-alive socket was reused after R had closed it. The data is untouched and R is still running; the same call usually succeeds on the next try. It is never a reason to simplify geometry or rebuild an object.

**A black window after sleep.** The app forces a repaint on resume. If a request was in flight when the machine suspended, it may have been aborted — long operations hold a power-save blocker to prevent that.

Beyond these, ourgeo.dev/forum.html is the community forum.`,

  themes: `# Themes — switching, and making one for the user

## The three axes

They are independent, and the separation is the whole design.

| axis | what it owns | switch with |
|---|---|---|
| **App theme** | the interface: every panel, button, border and label; the editor's background; the artwork behind the code; the map's default basemap | \`ui:theme\` |
| **Code theme** | syntax colours only — R in .R files, and every embedded language in an .Rmd chunk | \`ui:codeTheme\` |
| **Markdown theme** | prose colours only — headings, links, quotes, inline code, in Source and Visual mode | \`ui:markdownTheme\` |

**A code or markdown theme carries token colours and NOTHING else.** It has no background of its own; the surface the text sits on belongs to the app theme. So switching a syntax palette can never move the editor background or the scene art, and a palette is only legible in combination with some app theme's surface — which is why \`theme:inspect\` reports contrast against the app theme currently in use.

Ten app themes, 26 code palettes and 16 markdown palettes ship. Each app theme names the code and markdown palettes it starts with; **switching the app theme resets both to those defaults**, because a dark syntax palette on a white background is not a coherent look. The user departs from the default afterwards, per app theme.

## Switching

\`ui:theme\`, \`ui:codeTheme\` and \`ui:markdownTheme\` take **any installed theme** — the ones that ship and the ones you or the user built, including one created a moment ago. Their option lists are resolved when you call them, not when ouRGeo was built, so a new theme is switchable immediately. They accept the theme's **id or its name** ("my-half-life-2" and "Half-Life 2" both work).

\`theme:list\` when you do not already know the id — it names everything and marks what is in use. \`ui:codeTheme\` and \`ui:markdownTheme\` also take \`"default"\`, meaning "follow the app theme".

**If a switch is refused, the theme genuinely is not there.** Read the ids in the refusal, or run \`theme:list\`. Do not conclude that switching to a theme you made is unsupported and send the user to click a button — it is supported, and \`theme:create\` with \`apply: true\` does both in one call.

## Making one

Themes the user builds live alongside the shipped ones and are ordinary themes from then on: selectable, exportable, usable as templates.

**Everything starts as a copy.** There is no blank theme, deliberately — a theme has 16 interface colours or 9–11 token colours, and a model setting some of them from nothing produces something that clashes with the ones it forgot. Pick the shipped theme closest to what the user described and change what needs changing.

    theme:list                                     -- what exists
    theme:inspect   kind=system id=arctic          -- see its actual colours
    theme:create    kind=system name="Warm Night" template=arctic apply=true
    theme:setColors kind=system id=my-warm-night colors={"accent":"#e8905a", ...}

\`apply: true\` switches to the new theme as it is made, which is usually what the user meant — and it means every later \`theme:setColors\` shows up on screen as you make it. Without it, switch when you are done with \`ui:theme theme="my-warm-night"\`.

Build all three axes the same way, then point the app theme at the two palettes with \`theme:configure\` so selecting it applies the whole set:

    theme:create    kind=code     name="Warm Syntax" template=gruvboxDark
    theme:create    kind=markdown name="Warm Prose"  template=prose
    theme:configure id=my-warm-night codeTheme=my-warm-syntax markdownTheme=my-warm-prose
    ui:theme        theme=my-warm-night             -- applies all three

**Shipped themes are read-only.** An ouRGeo update would overwrite an edit, and there would be nothing to reset to. \`theme:duplicate\` gives you an editable copy of any of them; the mutating actions refuse a shipped theme and say so.

## What each colour paints

An app theme has two sets, and six names appear in both — which is why they are separate parameters (\`colors\` and \`chrome\`) rather than one map.

\`colors\` — the interface:

- \`bg\` the deepest surface, behind panels and under the console
- \`panel\` toolbars, side panels, dialogs, tab strips — most of what you see
- \`border\` dividers and outlines
- \`accent\` primary buttons, selection, focus rings, the R-ready dot
- \`accentHover\` the accent under the pointer — a step lighter on a dark theme, darker on a light one
- \`muted\` secondary labels, inactive tabs, most icons
- \`success\` / \`warning\` / \`error\` connected, cautions, failures
- \`fg\` primary text

\`chrome\` — the editor surface, separate on purpose (the shipped themes give the editor a slightly different surface from the panels around it):

- \`panel\` the editor background — this is the one that matters
- \`bg\` the current-line highlight
- \`border\` indent guides and the scrollbar thumb
- \`accent\` the caret and the selection wash
- \`muted\` inactive line numbers
- \`fg\` plain editor text

A code palette: \`fg\` (identifiers), \`comment\`, \`keyword\`, \`constant\` (TRUE/NA/NULL), \`string\`, \`number\`, \`operator\` (\`<-\`, \`%>%\`), \`fn\`, \`tag\` (roxygen \`@param\`), \`delimiter\`, \`error\`.

A markdown palette: \`text\`, \`heading\`, \`emphasis\`, \`link\`, \`code\`, \`quote\`, \`meta\`, \`html\`, \`escape\`. \`text\` drives Visual mode only — Source-mode body prose is not targetable in Monaco and always takes the app theme's foreground.

## Making one that is actually good

- **Colours are \`"#rrggbb"\`.** \`"blue"\`, \`"rgb(…)"\` and eight-digit hex are refused. \`"#abc"\` is accepted and expanded.
- **Contrast is the failure you cannot see.** \`theme:setColors\` reports the ratios back; anything under **4.5:1** for text on its background is too low. Watch \`fg\` on \`panel\`, \`muted\` on \`panel\`, and \`comment\` on the editor background — a comment colour a shade too close to the surface is the single most common way a hand-made code theme becomes unusable.
- **Move a family together.** Changing \`bg\` and leaving \`panel\` and \`border\` behind gives a theme with two unrelated greys in it. Keep \`bg\` darkest, \`panel\` a step up, \`border\` a step up from that (reverse on a light theme).
- **One accent.** \`accent\` and \`accentHover\` should be the same hue; \`success\`/\`warning\`/\`error\` stay recognisably green/amber/red whatever the theme, because they mean something.
- **Say what you changed, in the user's terms.** "Warmed the panels and moved the accent to amber" is worth more than a list of hexes.

## The rest of an app theme

\`theme:configure\` sets the non-colour properties: its name; whether it counts as dark or light (this chooses Monaco's base theme, so get it right); the **code and markdown palettes it defaults to**; the **basemap** the Spatial Editor opens with; and how the backdrop image is painted.

\`theme:setImage\` gives it artwork from a file on disk — \`slot="backdrop"\` for the image behind the code editor, \`slot="card"\` for its tile in the theme picker. PNG, JPEG, WebP, SVG, GIF or AVIF; 4 MB for a backdrop, 1 MB for a card. The picture is embedded in the theme, not referenced, so an exported theme carries its own artwork.

A backdrop is painted **under the code**, so it has to stay out of the way: the shipped scenes are drawn to be grey-scaled at 15%. A photograph usually wants \`backdropGrayscale=false\` and a lower opacity. Wide 16:9 around 1600 × 900 fills the panel without the middle being cropped out. Both images are optional — with no backdrop the theme gets a scene generated from its own palette.

## Files

\`theme:export\` writes a \`.ourgeotheme.json\`; \`theme:import\` reads one. The file declares which axis it is for, so importing an app theme into the code-theme list is refused with a sentence naming what the file actually is. Pass \`kind\` to \`theme:import\` only when you want that check; omit it to accept whatever the file holds.

The user can do all of this by hand in **Settings → Appearance → Theme Studio**. Point them there with \`ui:highlight\` on \`settings.themeStudio\` when the point is teaching rather than doing.`,

  packages: `# Which R package powers what

- **sf** — vector geometry: reading, writing, predicates, overlays, projection. The default for spatial data.
- **geos** — an alternative overlay engine, exposed as its own toolbox category. Faster for some operations; cannot represent curves.
- **sfarc** — curved geometry (CIRCULARSTRING, COMPOUNDCURVE, CURVEPOLYGON).
- **terra** — rasters. Every tool in the Raster category, plus the tile engine's warping.
- **ggplot2** — plots, and one of the two map exporters.
- **tmap** — thematic maps; the other exporter, and the default for map chunks.
- **ggspatial / maptiles / tidyterra** — basemaps and raster geoms inside ggplot2 exports.
- **dplyr** — the table categories, and the lazy database proxies.
- **DBI + duckdb** — .Rgeo databases.
- **knitr + rmarkdown** — knitting documents. pandoc is required and is not an R package.
- **httr2 + jsonlite** — the API connectors and the server itself.
- **httpuv + later** — the R server ouRGeo talks to.
- **png** — raster tile encoding.
- **ggnewscale** — emitted only when a ggplot export needs two fill scales to coexist.`,
  'plugin-store': `# The plugin store

Plugins other people wrote, at ourgeo.dev, reviewed by a moderator before they appear. Reading is open to anyone; **installing happens only from inside ouRGeo** and needs the user's ourgeo.dev account.

## Finding one

\`store:search\` before you offer to write a plugin. An installed plugin is code a moderator has read and other people are running; a plugin you write in the next ten minutes is neither. \`store:inspect\` gives you the detail that decides it: whether it runs code, what it asks to reach, and whether this ouRGeo is new enough.

\`store:open\` puts the store in front of the user with your search already typed, which is often better than installing for them — they can read the description and the reviews.

## Installing

\`store:install\` is **confirm** tier, and what it installs **arrives switched off**. Say so. Enabling is a separate decision the user makes in Settings → Plugins, and it is the moment code somebody else wrote starts running with everything ouRGeo can do.

Do not follow an install with an attempt to enable it. There is no action that does, and offering to "just turn it on" undoes the point of the switch.

\`store:updates\` lists installed store plugins with a newer version waiting; \`store:update\` takes one. An update keeps whatever on/off state the plugin already had — the user trusted it, and a version bump from the same author through the same review is not a new question.

A version that has been **revoked** — approved, shipped, and then withdrawn — is switched off automatically with a line in the console. If a user asks why a plugin stopped working, that line is the answer.

## What the store promises an author, and what it does not

What ships is a **built, minified bundle**: the author's TypeScript is never published. A source archive travels with every submission so a moderator can read what they are approving, and it is readable by the author and by staff and by nobody else.

That is the whole of it, and it must not be described as more:

- Minifying is obfuscation, not encryption. The bundle is on the user's disk, because ouRGeo has to run it.
- **Declarative contributions cannot be hidden at all.** A connector, a toolbox tool, an action is JSON in the manifest, and R library files are read by R. Only \`main\` is compiled.
- The private bucket is the real measure: a bundle is not on an open URL, and downloading one needs an account.

So a store plugin is not exportable from ouRGeo, and you cannot read its files: \`plugin:export\`, \`plugin:readFile\` and \`plugin:writeFile\` refuse, and \`plugin:inspect\` describes it without listing it. That is a promise to the author kept at the place ouRGeo would otherwise hand the code on — not a claim the code is unreachable. Do not go looking for it another way; \`execute_r_code\` and \`readLines()\` on a plugin folder is exactly the workaround the refusal exists to prevent.

## Publishing

You cannot publish, and there is no action that does. Submitting puts something on a public website under the user's name, which is a line you do not cross for them — the same reason nothing here posts to the forum.

What you can do is get them ready and then point:

1. The plugin has to work. \`plugin:validate\` and a real run first.
2. **Settings → Plugins**, then **Publish…** on their plugin. ouRGeo builds both archives — the minified bundle and the source — and uploads them.
3. Publishing needs trust level 1: three forum posts over two days, the same bar as uploading a forum image.
4. **Screenshots** are added in that dialog, several at a time. Worth saying out loud, because the ordering surprises people: a screenshot attaches to the plugin's row in the store, and that row is written by the FIRST submission — so pictures picked beforehand sit queued, marked "will upload when you submit", and go up as soon as it does. The first screenshot is the picture on the plugin's card.
5. A moderator installs it, runs it, and approves or sends it back with a note. The note appears on their account page and in the Publish dialog.

The plugin **id is the store's name for it** and cannot be changed afterwards — it is also the folder name on every machine that installs it, which is why two plugins cannot share one. Get it right before the first submission.

The other route is **Save a submission file…** and uploading it at ourgeo.dev/plugins-submit.html. Same bytes; the website cannot build one itself.
`,

  extending: `# Extending ouRGeo — plugins

ouRGeo cannot be edited in place once it is installed. The interface ships as one compiled bundle inside a read-only archive, and there is no compiler on the user's machine to rebuild it. **Changing ouRGeo itself always means cloning the repository and building from source** — a real option, and the one to name when someone wants to change how an existing feature behaves.

**Search the plugin store first** (\`store:search\`). Somebody may have written what the user needs, and an installed plugin is code a moderator has read and other people are running. See \`ourgeo_docs({topic: "plugin-store"})\` — it also covers publishing what you build here.

A **plugin** is the other route: new capabilities, added while the app is running. This is what you reach for when the user wants something ouRGeo does not do.

## The three kinds, in the order you should prefer them

| kind | what it is | trust needed |
|---|---|---|
| **Declarative** | JSON in the manifest: a data connector, a toolbox tool, an action, a docs topic | none — it is data |
| **R** | a \`.R\` file sourced into the live session | the same as any R the user runs |
| **Code** | a \`main.ts\` that runs inside ouRGeo | real: it runs with everything ouRGeo can do |

**Reach for JSON first, and stay there.** A declarative plugin runs no code, so enabling it is not a decision the user has to weigh — and your success rate writing JSON against a schema is far higher than writing TypeScript against an API you have to remember. Write \`main.ts\` only when a schema genuinely cannot express the thing, and say plainly in the same breath why it was needed.

## Where a plugin lives

One folder per plugin, under ouRGeo's app data directory, holding \`ourgeo-plugin.json\` and whatever else it needs. You never handle paths: every plugin action takes a plugin id and a file name relative to that folder, and a path that tries to leave it is refused.

## The workflow

    plugin:list                                   -- what is already installed
    plugin:scaffold id=noaa-tides name="NOAA Tides" permissions=["network"]
    plugin:writeFile id=noaa-tides file=ourgeo-plugin.json content=<the whole manifest>
    plugin:validate  id=noaa-tides                -- does it parse, what was dropped
    plugin:enable    id=noaa-tides                -- asks the user

\`plugin:scaffold\` writes a manifest with nothing in it. You then rewrite that file with the contributions — \`plugin:writeFile\` replaces the file whole, and **it validates a manifest before writing it**, so a manifest that would not parse is refused rather than saved (a saved broken manifest cannot be read back, which would cost you the ability to fix your own mistake).

## Enabling is the consent moment, and it is not yours

\`plugin:enable\` asks the user, every time. That is deliberate: writing a plugin changes nothing, and enabling one is when it starts affecting their session. If they decline, that is an answer — do not retry it, and do not work around it. Tell them what it would have added and leave it switched off; \`Settings → Plugins\` is where they can turn it on later.

\`plugin:disable\` needs no permission at all. Switching something off is never the risky direction, and it is the first thing to try when the app is misbehaving.

## What a manifest looks like

    {
      "id": "noaa-tides",
      "name": "NOAA Tides",
      "version": "1.0.0",
      "description": "Water levels and predictions from NOAA CO-OPS.",
      "permissions": ["network"],
      "contributes": {
        "connectors": [ ... ],
        "toolboxTools": [ ... ],
        "actions": [ ... ],
        "docs": [ { "topic": "usage", "summary": "...", "body": "..." } ]
      }
    }

\`id\` is lowercase and hyphenated, and it namespaces everything: an action \`quickSummary\` becomes \`noaa-tides:quickSummary\`, a tool becomes \`noaa-tides-<name>\`. A plugin can never shadow something ouRGeo ships — a contribution that tries is dropped, not preferred.

**Ask for no permission you do not use.** \`network\` to fetch, \`r\` to run R, \`ui\` to open dialogs and panels. The renderer has no filesystem. R operations run visibly in the console. OurGeo 1.16.0 also supports \`service\`: native system access for an installed JavaScript background process. Declare \`service: {entry: "server/service.mjs", files: ["server/service.mjs"]}\` and permission \`service\`, then call \`ourgeo.service.start()\` for its private loopback connection. The host owns startup and shutdown; do not ask users to run a companion terminal or enter a pairing key. Service code must handle the private Electron parentPort ready/stop protocol.

## Always contribute a docs topic

\`contributes.docs\` adds a topic to \`ourgeo_docs\`. A plugin that adds a connector and nothing else leaves the next assistant — or you, next session — guessing what it does from an id in a listing. One paragraph saying what it is for and how to use it costs nothing until someone opens it.

## The reference

- \`ourgeo_docs({topic: "plugin-connectors"})\` — the connector spec, field by field, and what it cannot express.
- \`ourgeo_docs({topic: "plugin-tools"})\` — toolbox tools and actions as JSON.
- \`ourgeo_docs({topic: "plugin-code"})\` — writing \`main.ts\`, and the rules it runs under.

## When something does not work

\`plugin:validate\` reports what was dropped and why. \`plugin:inspect\` shows the load error in full. A contribution that fails is dropped on its own — the rest of the plugin still loads — so "it installed but the tool is missing" is almost always a message waiting in one of those two.`,

  'plugin-connectors': `# Writing a data connector

A connector is a description of a JSON API's shape. ouRGeo compiles it into the same \`ApiProvider\` its fourteen shipped connectors implement, so a good spec is indistinguishable from a hand-written one in the Data Connector.

## Probe first. Always.

You cannot guess where a list lives in someone's JSON, and a wrong path compiles, installs, and produces an empty dropdown with nothing on screen to explain it.

    connector:probe url="https://api.example.org/datasets?limit=1"

It reports the shape: which key holds the array, what one item looks like, what type each value is. Probe every URL the spec will use — one per cascade level, one for metadata, one for preview.

Set \`docsUrl\` while you are there. It is the API's own documentation page, and it becomes the connector's Help button — the one place a user can go when the connector cannot answer their question, which for somebody else's API is most questions.

## The spec

    {
      "name": "stations",
      "label": "NOAA Stations",
      "category": "Scientific",
      "description": "Tide and current stations from NOAA CO-OPS.",
      "docsUrl": "https://api.tidesandcurrents.noaa.gov/api/prod/",
      "servers": [{ "id": "coops", "label": "CO-OPS", "baseUrl": "https://api.tidesandcurrents.noaa.gov" }],
      "cascade": [
        { "key": "station", "label": "Station",
          "url": "{{baseUrl}}/mdapi/prod/webapi/stations.json",
          "itemsPath": "stations", "valuePath": "id", "labelPath": "name", "hintPath": "state" }
      ],
      "metadata": {
        "url": "{{baseUrl}}/api/prod/datagetter?station={sel.station}&format=json",
        "fieldsFrom": "sampleRow", "rowsPath": "data",
        "spatial": false, "queryable": true
      },
      "filterDialect": "params",
      "preview": { "url": "...", "rowsPath": "data" },
      "import": { "template": "{{var}} <- ourgeo_read_json(r\\"({{baseUrl}}/...)\\")" }
    }

**\`cascade\`** is the chain of dropdowns; the LAST level selects the thing that gets imported. A level either has \`options\` (a fixed list — use this for a menu of routes) or a \`url\` plus \`itemsPath\` / \`valuePath\` / \`labelPath\`. Later levels can use \`{sel.<earlier key>}\`.

**\`metadata\`** describes the columns. Three ways, in order of preference: a literal \`fields\` array when the schema is fixed and known; \`fieldsPath\` when the API returns a schema; \`fieldsFrom: "sampleRow"\` with \`rowsPath\` when it does not, which infers columns and types from the first row. \`spatial: true\` means the import produces an \`sf\` object rather than a data frame.

**\`filterDialect\`** turns the user's filters into whatever the server takes. Name one of \`odata\`, \`cql\`, \`esri\`, \`soql\`, \`params\` — or give a table of your own. Only the operators the dialect can actually write are offered to the user; an operator with no template would produce a filter the server silently ignores, which reads as ouRGeo losing their query.

**\`import.template\`** is the R the Load button runs. It must contain \`{var}\`, or the import assigns to nothing and the user sees no object.

## Placeholders: \`{x}\` is encoded, \`{{x}}\` is raw

\`{sel.station}\` in a path needs URL-encoding; a filter clause going into a query string does too; a base URL and the R template do not. Getting this wrong works perfectly until the first dataset with a space in its name.

Available: \`{baseUrl}\`, \`{sel.<key>}\`, \`{filter}\`, \`{limit}\`, \`{q}\`, \`{var}\`, \`{apiKey.<name>}\`.

A query parameter whose value comes out empty is dropped from the URL, so an optional \`&$filter={filter}\` disappears when there are no filters rather than becoming \`&$filter=\`.

## Test it against the real server

    connector:test spec=<the spec object> server="https://api.example.org"

It walks the cascade for real, reads metadata, previews rows, and prints the generated R — reporting which stage failed and why. A wrong \`itemsPath\` two levels down cannot be found any other way. Do this before \`plugin:enable\`.

## What a spec cannot express

Write these in code (\`main.ts\` + \`ctx.register.connector\`), or do not attempt them:

- **XML capabilities documents** — WFS, WMS and WCS negotiate versions and parameter names by probing, and parse namespace-agnostic XML. That is a program.
- **Adaptive probing** — halving a page size until the server copes.
- **Cross-request derivation** — reprojecting an extent, discovering raster assets, estimating a download size.

If the user's API is one of those, say so plainly and offer the code route rather than spending three turns describing it in JSON.

## Adding a server to an existing connector

Often the right answer, and much cheaper than a new connector. Many APIs are one of the families ouRGeo already speaks — CKAN, Socrata, OGC API–Features, ArcGIS REST, ERDDAP, OData. \`connector:list\` shows them; \`connector:addServer\` adds an endpoint and validates it by listing its first level. Check this before writing anything.`,

  'plugin-tools': `# Toolbox tools and actions as JSON

Neither needs code. Both are namespaced by the plugin id.

## A toolbox tool

    {
      "name": "round-coords",
      "label": "Round coordinates",
      "description": "Reduce coordinate precision on an sf layer.",
      "category": "spatial-sf",
      "fields": [
        { "id": "ds",     "label": "Dataset", "type": "dataset", "filter": "sf" },
        { "id": "digits", "label": "Digits",  "type": "number",  "default": "3" },
        { "id": "out",    "label": "Output name", "type": "output-name" }
      ],
      "rTemplate": "{{out}} <- sf::st_set_precision({{ds}}, 10^{digits})"
    }

**\`rTemplate\` is the whole tool.** \`{field}\` inserts the value QUOTED the way R needs it — a number bare, a logical bare, anything else as a double-quoted string with its quotes and backslashes escaped. \`{{field}}\` inserts it raw, which is what you want for a variable name, a column list, or an output name. Using \`{ds}\` where you meant \`{{ds}}\` produces \`"my_layer"\` — a string, not the object — and the tool fails with something unhelpful about a character vector.

\`category\` is a shipped category id to append to (\`table\`, \`joins\`, \`aggregate\`, \`typestring\`, \`spatial-sf\`, \`spatial-geos\`, \`spatial-raster\`) or a new one your plugin declares with \`categoryLabel\`. Prefer a shipped one: a category with a single tool in it is a worse place to find that tool.

Field types: \`dataset\` (with \`filter\`: \`sf\` / \`geos\` / \`raster\` / \`any\`), \`column\` (with \`datasetField\`), \`band\`, \`text\`, \`number\`, \`select\` (with \`options\`), \`checkbox\`, \`output-name\`.

## An action

    {
      "name": "quickSummary",
      "summary": "Summarise a data frame in the session with summary().",
      "tier": "autopilot",
      "params": [{ "name": "object", "type": "string", "description": "The object to summarise.", "required": true }],
      "run": { "kind": "r", "code": "summary({{object}})" }
    }

Three forms of \`run\`:

- **\`{ "kind": "r", "code": "..." }\`** — runs R, with the same \`{param}\` / \`{{param}}\` quoting rule as a tool. Echoed to the console, like every other operation in ouRGeo.
- **\`{ "kind": "sequence", "steps": [{ "id": "map:addLayer", "params": {...} }] }\`** — runs existing actions in order. Each step is validated and tier-checked exactly as if you had called it, so composition cannot be used to get past a permission.
- **\`{ "kind": "js", "export": "..." }\`** — registered from code, not from the manifest.

\`tier\` defaults to \`autopilot\`. Use \`always\` only if the action reads and changes nothing; use \`confirm\` for anything destructive.

## A toolbar button

    { "name": "fetch", "label": "Fetch tides", "icon": "Waves", "action": "fetchLatest" }

\`icon\` is a lucide icon name; an unknown one falls back to a dot rather than failing the button. \`action\` names one of your own actions — the click runs it through the same registry the assistant uses, so its tier still applies.`,

  'plugin-code': `# When a plugin needs code

Only when a schema cannot express it: a bespoke filter dialect, an XML capabilities document, a panel with its own interface. Everything else belongs in the manifest, where it needs no trust decision and you are far more likely to get it right.

## The shape

\`main.ts\` — TypeScript and JSX are compiled when the plugin loads.

    export function activate(ctx: any): void {
      ctx.register.action({
        name: 'hello',
        summary: 'Say hello in the console.',
        tier: 'autopilot',
        run: { kind: 'r', code: 'cat("hello\\n")' },
      })
    }

\`activate\` runs when the plugin is enabled. Everything reachable comes through \`ctx\`.

## What ctx has

- \`ctx.register.{action, connector, toolboxTool, panel, toolbarButton, docs}\`
- \`ctx.r.execute(code)\` and \`ctx.r.source(file)\` — with the \`r\` permission
- \`ctx.http.fetch(url, init)\` — with the \`network\` permission
- \`ctx.ui.React\`, \`showDialog\`, \`openPanel\`, \`notify\` — with the \`ui\` permission
- \`ctx.read.{layers, objects, tabs, workingDir, rReady}\` — read-only
- \`ctx.plugin.storage\` — a JSON file of the plugin's own
- \`ctx.log\`

A permission you did not ask for is **absent**, not refused: without \`network\` there is no \`ctx.http\` at all.

## What is not there, and why

**No renderer filesystem.** R operations remain visible in the console. A plugin declaring \`service\` permission may run its installed native background entry through \`ourgeo.service.start()\`; this is native system access and must be disclosed. It does not expose shell commands or arbitrary executable paths to the renderer.

**No \`window.electronAPI\`**, and no \`fetch\`, \`require\`, \`process\`, \`localStorage\` or \`XMLHttpRequest\` — those names are blanked out while the plugin runs. Reaching for them is a bug in the plugin, not an obstacle to work around. Use \`ctx\`.

## Imports

\`import ... from 'ourgeo'\` gives you the host. Relative imports of your own files work — put them in the plugin folder. **There is no node_modules**: a bare import of anything else fails with a message saying so. Write what you need, or do without it.

## The rules that matter

1. **\`activate\` must not throw.** A plugin that takes the renderer down disables itself on the next launch and the user sees an app that appeared to break for no reason. Wrap anything that can fail.
2. **Do not block \`activate\`.** It runs during startup. Register your contributions and return; do the work when something calls them.
3. **Everything you do should be visible.** R through \`ctx.r\` is echoed to the console; \`ctx.http\` is logged. Do not find a quieter route.
4. **Never ask the user for a credential.** If a connector needs a key, it comes from \`{apiKey.<name>}\` in a template, which reads Settings → Data API Keys.`,

  layout: `# The workspace layout

Four zones. **left**, **centre**, **right**, **bottom**. Each holds an ordered list of panels; the centre takes whatever the others leave.

Any panel can go in any zone — the editor, the console, the map, the plots, the chat, Help, the Environment, Packages, Databases — and a plugin's panel is an ordinary panel from the moment it registers.

By hand, the user drags the small grip in a panel's top-right corner (it appears on hover) and drops it on the zone they want; every zone shows insertion slots while a drag is in progress, and an empty zone appears as a dashed strip along its edge. **Settings → Workspace** holds the same ground: the switch for those grips, the list of saved arrangements (apply, export, delete), Import, and Restore default arrangement.

    layout:setPanelDrag  enabled=false

turns the grips off. It removes the GESTURE only — the arrangement is untouched and every action here still works, so this is never a reason to tell a user you cannot move a panel.

## Read before you rearrange

    layout:describe

It says where every panel is, how big each zone is, and what is closed. The user may already have the arrangement they are asking for, and "put the map on the left" from someone whose map is closed is a different request from one whose map is open.

## Moving and sizing

    layout:movePanel     panel=spatial zone=left
    layout:setPanelSize  panel=spatial percent=70
    layout:evenPanels    zone=left
    layout:setZoneSize   zone=right size=500
    layout:setZoneMode   zone=right mode=tabs
    layout:reset

\`layout:movePanel\` also **opens** the panel — being asked to move something and leaving it invisible is not the request.

A zone is either **split** (panels share the space, side by side or stacked, per \`axis\`) or **tabs** (one at a time). Tabs are how a user gets full height for a panel without closing the others; suggest it when they want more room rather than telling them to close something.

**A zone's own size is pixels; a panel's size inside it is a percentage.** The two are different things: \`layout:setZoneSize\` sets how wide the left column is against the window, \`layout:setPanelSize\` sets how much of that column one panel gets against its neighbours.

Panels sharing a zone **start equal** — two take half each, three a third each, and that is what every zone comes back to when ouRGeo is restarted or when \`layout:evenPanels\` is called. So "the Environment panel is tiny" is usually not a sizing request at all: check \`layout:describe\` first, because they may have dragged it, or the zone itself may be too narrow. The result message says the share the panel actually ended up with, which can be less than you asked for — a panel will not shrink below its minimum height on screen. The centre has no size of its own.

## A second code editor

The **code editor** is the only panel that can exist more than once — up to four. Every other panel, the Spatial Editor included, shows one global thing (one console, one environment listing, one map), so a second copy would be two windows onto the same state.

    layout:addPanel    panel=editor
    layout:removePanel panel=editor#2

The second one is \`editor#2\`; the first keeps its plain id. It can also be named the way a user would say it — "Code editor 2".

- **A new editor starts empty**, and that is deliberate: nothing is duplicated or moved for you. The user drags a tab into it, or opens something with it focused. An empty editor says so on screen, with the two ways to fill it.
- **Only a panel that was ADDED can be removed.** \`editor\` itself never can — it is where documents come home to. If a user wants the original gone, remove the copy instead: everything ends up in one editor either way.
- **Removing never closes a document.** The copy's tabs move to the editor that remains. Say so when you offer it — a user who thinks Remove will lose their work will not press it.
- **Closing is not removing.** \`ui:panel\` hides a panel and the toolbar brings it straight back; \`layout:removePanel\` takes an added panel out of the workspace for good.

## The toolbar

    layout:setToolbarButtons order=["help","save"] hidden=["record"]

Buttons you do not list keep their place, so you can move one without describing the whole toolbar. Pass \`hidden=[]\` to show everything again.

## Presets

    layout:savePreset  name="Mapping"
    layout:applyPreset name="Mapping"

Worth offering unprompted when a user has just spent a while arranging things, and worth saving *before* you rearrange anything substantial on their behalf.

## The way out

\`layout:reset\` puts everything back where ouRGeo ships it. Offer it before the user starts dragging things back by hand — and if you have made a mess, offer it immediately rather than trying to reverse your own moves one at a time.`,
}

/** The topics ouRGeo ships. */
export const BUILTIN_OURGEO_TOPICS: Readonly<Record<string, string>> = BUILTIN_TOPICS

/**
 * The LIVE topic registry — shipped topics plus whatever plugins registered.
 *
 * This is how a plugin teaches the assistant about ITSELF. A plugin that adds
 * a connector and nothing else leaves the model to guess what it does from an
 * id in a listing; a plugin that adds a topic can explain its own workflow in
 * the same voice as the rest of the documentation, and pay for it only when
 * the model opens it.
 *
 * Same contract as the other registries: `registerPluginTopics` is the only
 * writer, a shipped key can never be shadowed, and React does not subscribe.
 */
export const OURGEO_TOPICS: Record<string, string> = { ...BUILTIN_TOPICS }

const PLUGIN_SUMMARIES: Record<string, string> = {}

export function registerPluginTopics(
  topics: { topic: string; summary: string; body: string }[],
): void {
  for (const key of Object.keys(OURGEO_TOPICS)) {
    if (!(key in BUILTIN_TOPICS)) delete OURGEO_TOPICS[key]
  }
  for (const key of Object.keys(PLUGIN_SUMMARIES)) delete PLUGIN_SUMMARIES[key]
  for (const t of topics) {
    const key = t.topic.trim().toLowerCase()
    if (!key || key in BUILTIN_TOPICS) continue
    OURGEO_TOPICS[key] = t.body
    PLUGIN_SUMMARIES[key] = t.summary
  }
}

/** Topic names, for when the model calls `ourgeo_docs` with nothing. */
export function topicListing(): string {
  const summaries: Record<string, string> = {
    interface: 'panels, toolbar, editor, console, viewers, settings',
    toolbox: 'the 88 geoprocessing tools, piping, Linearize and Calculation CRS',
    'data-import': 'Load Data, the Data Connector and its providers, .Rgeo',
    maps: 'layers, symbology, labels, selection, legend, export',
    drawing: 'edit mode, the ten tools, curves, distance & bearing, snapping, staged edits',
    projects: 'scratch vs .ourgeoproj, what persists, recording',
    documents: 'Markdown and R Markdown, chunks, knit, Visual mode, publish',
    databases: '.Rgeo files, connect vs load, raster pyramids',
    shortcuts: 'keyboard shortcuts',
    troubleshooting: 'the common failures and what they mean',
    packages: 'which R package powers which feature',
    themes: 'the three theme axes, switching, and building a theme for the user',
    extending: 'plugins — adding capabilities ouRGeo does not ship with',
    'plugin-connectors': 'writing a data connector for an API as JSON',
    'plugin-tools': 'toolbox tools, actions and toolbar buttons as JSON',
    'plugin-code': 'when a plugin needs real code, and the rules it runs under',
    layout: 'the four zones, moving and sizing panels, the toolbar, presets',
  }
  const lines = Object.keys(OURGEO_TOPICS)
    .map((t) => `- ${t} — ${summaries[t] ?? PLUGIN_SUMMARIES[t] ?? ''}`)
  return `ouRGeo documentation topics (pass one as \`topic\`):\n${lines.join('\n')}`
}

/** One topic, or a message naming the ones that exist. */
export function readTopic(topic: string): string {
  const key = topic.trim().toLowerCase()
  const hit = OURGEO_TOPICS[key]
    ?? OURGEO_TOPICS[key.replace(/[\s_]+/g, '-')]
    ?? Object.entries(OURGEO_TOPICS).find(([k]) => k.startsWith(key))?.[1]
  if (hit) return hit
  return `No documentation topic called "${topic}".\n\n${topicListing()}`
}
