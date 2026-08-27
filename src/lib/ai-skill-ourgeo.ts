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

A top toolbar; a left column (Environment, Packages, Databases); a centre column (the Monaco code editor above, the R console below); a right column (Spatial Editor, Plots, AI chat, Help). Panels toggle from the toolbar. The project menu sits far right, with the R status dot.

### What you can do

You can drive all of it. \`run_ui_action\` performs one interface action; \`list_ui_actions\` gives you the parameters. These are the ids:

${actionIndex()}

**These are not R functions.** They exist only as \`run_ui_action\` calls — \`run_ui_action({ id: "map:addLayer", params: { object: "pts" } })\`. R has never heard of \`map:addLayer\`, and neither has any package. So:

- Never write an action id into R code, a chunk, or a block for the user to run. It will fail with \`could not find function\`, and the user will think their installation is broken.
- If you cannot perform an action — Autopilot is off, or the user declined — do not hand them the id. Tell them which **button** does it, and point at it with \`ui:highlight\`.
- R code is for R: \`sf\`, \`terra\`, \`dplyr\`, \`ggplot2\`. The interface is for actions. They never mix in one block.

\`toolbox_tools\` searches the 87 geoprocessing tools and \`run_toolbox_tool\` runs one (with \`dryRun\` to show the code without running it). \`ourgeo_docs\` reads ouRGeo's documentation — use it rather than guessing how a feature works.

Actions are tiered: navigation and reading are always allowed; anything touching R state or the filesystem needs Autopilot; destructive ones ask the user to confirm. The user can move any action between tiers from the gear beside the Autopilot switch. A refusal is an answer — report it and offer to point at the control instead.

### Running a tutorial

This is what the interface access is for. When a user asks how to do something in ouRGeo:

1. **Look before you speak.** \`ui:describe\` and \`map:status\` tell you what is actually open and loaded. Never describe a panel you have not read back.
2. **One step at a time.** Say what the step does and why, do or point at it, then wait. Do not run six actions and summarise.
3. **Point rather than press, when the point is teaching.** \`ui:highlight\` rings a real control and lets the user click it — they remember where it is. Do it for them when they asked you to do it, or when the step is incidental.
4. **Show the R.** Every operation prints its code; refer to it. \`run_toolbox_tool\` with \`dryRun: true\` shows exactly what a dialog would produce, which is often the best thing to put in front of a learner.
5. **Never invent the interface.** If you are not sure a button exists, read \`ourgeo_docs\` or search \`list_ui_actions\`. A confidently wrong instruction wastes more of the user's time than a lookup.`
}

// ── The reference, served by `ourgeo_docs` ─────────────────────────────────

export const OURGEO_TOPICS: Record<string, string> = {
  interface: `# The interface

**Top toolbar**, left to right: Toggle Environment, Toggle Packages, Open File (Ctrl+O), Save (Ctrl+S), Save As, Load Data, Toggle Database Connections, Data Connector, Toolbox, AI Assistant, Record Console, Toggle Spatial Editor, Toggle Plotting Preview, Help. Settings is pinned far right, next to the project menu. A toggled-on panel's button turns blue.

**Environment panel** — objects in the R session, grouped by environment, with class, size and a preview. Search filters. Clicking a data frame, matrix or vector opens it in the Data Viewer; clicking a function opens it in the function editor. Right-click for remove / rename / copy / move.

**Packages panel** — installed packages with attach/detach checkboxes, search, an install dialog, an update checker, and library-path management.

**Databases panel** — .Rgeo (DuckDB-backed) files: pick a workspace folder, create or connect a database, and bring tables out as R variables.

**Code editor** — Monaco, the VS Code engine. R syntax highlighting with autocomplete driven by the live R session, so it completes objects that actually exist. Tabs are either documents (.R, .md, .Rmd, .qmd) or object tabs (Data Viewer, function editor). Ctrl+N new tab, Ctrl+W close, Ctrl+Space autocomplete. The toolbar has "Line" (Ctrl+Enter) and "Run All".

**R console** — a real prompt below the editor. Shift+Enter for a newline, arrow keys for history, live streaming output, colour-coded errors. Plots are captured automatically into the Plots panel. The header shows the working directory; clicking it opens the menu that changes it. "Clear console" clears the display only — the session keeps its objects.

**Data Viewer** — opens as a tab, not a sidebar. Sortable grid; sf geometry columns show alongside attributes. Add Column and a per-column type dropdown edit in place.

**Plots panel** — plot history with previous/next, an Active View mode for live previews, a ggplot2 chart builder, and Export at publication resolution.

**Help panel** — R documentation in-app and offline: search, back/forward, package pages and vignettes. Typing \`?something\` in the console opens it here.

**Settings** — one scrollable dialog: Appearance (10 themes, interface scale), R Backend, Spatial Editor (initial extent, attribute popup, default and calculation CRS), Basemaps (API keys), Data API Keys, AI Assistant (provider, model, base URL, context window).`,

  toolbox: `# The Toolbox

87 tools in seven categories:

- **Table Operations** (11) — filter, select, mutate, slice, distinct, rename and friends.
- **Joins & Combine** (2) — stacking and joining datasets.
- **Aggregate & Reshape** (5) — group summaries and pivoting.
- **Type & String** (8) — type conversion and text handling.
- **Spatial — sf** (16) — geometry operations through the sf package.
- **Spatial — geos** (11) — overlays through the geos engine.
- **Spatial — Raster** (34) — terra, for gridded data.

**Running one.** Pick a dataset from the environment dropdown, fill the fields, name the output. A live preview pane shows the exact R the form produces. Three buttons: **Run**, **Pipe →** (chain into the next tool as a \`|>\` pipeline instead of creating an intermediate object) and **Copy Code**.

**Piping.** Pipe → feeds one tool's output into the next. The output name locks from the first step, later forms predict the columns earlier steps produce, and a banner shows the chain with an × to clear it.

**Linearize curved geometry** appears on spatial tools and is unticked by default, so CIRCULARSTRING and friends keep their exact geometry. Tick it for GEOS-only operations that cannot handle curves — Spatial Filter and Spatial Join are GEOS-only and need it.

**Calculation CRS** appears on nine tools (Buffer, Intersection, Union, Difference, Erase, Clip, Centroid, Simplify and one more). Choose the default from Settings, the layer's native CRS, auto-detect, a named projection, or a custom EPSG. The generated code projects, computes, and projects back.

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

**Contents** lists the layers: visibility, order, removal, and the way in to symbology and labels.

**Symbology.** Vector layers style fill and border colour, line width, marker shape, halo and opacity — each either uniform or driven by a column. Raster layers choose singleband, RGB composite or categorical, with a stretch (min-max, percent clip, standard deviations, custom) and a colour ramp.

**Labels** are per layer: the column, typography, placement, halo, and what to do when labels collide.

**Selection** is point-click or lasso, plus attribute queries. A selection scopes toolbox operations.

**Map Settings** holds the legend and north arrow. Both carry into exported code as real ggplot2/tmap components, not as decorations painted on top.

**Export** has three destinations. *Export to IMG* captures the canvas at publication resolution. *Export to tmap* and *Export to ggplot* generate standalone R that reproduces what is on screen — basemap via maptiles, vector geoms with the symbology you set, rasters via \`geom_spatraster\` or \`tm_raster\`. The AI action \`map:exportCode\` calls the same generators.`,

  drawing: `# Drawing and editing geometry

Edit Mode opens a dedicated ribbon with nine tools: select, draw, edit-vertices, move-feature, add-point, rectangle, circle, freehand and trace.

**True curves.** The curve mode draws circular arcs rather than straight segments. An sf column stores them exactly as CIRCULARSTRING; a geos column cannot hold curves, so they are densified — the console says so when that happens. Reading curves back needs the \`sfarc\` package.

**Snapping** works across visible layers, to vertices, edges, midpoints and intersections, within a pixel tolerance set in Settings.

**Precise input.** Coordinates can be typed: \`lng,lat\` for an absolute position, or \`d150 a45\` for a relative distance and bearing.

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

**"R session not ready" / no connection.** ouRGeo spawns Rscript and reads the port it prints. If it never appears, R or one of httpuv, jsonlite, later, httr2 is missing. Running \`Rscript r/server.R\` by hand shows the real error.

**\`object '…' not found\` when knitting.** Knit is a clean session; console objects do not exist in it. The document needs a chunk that loads or builds the object.

**pandoc not found.** pandoc is not an R package and R does not bundle it. Install it from pandoc.org, or the \`pandoc\` R package which ships a copy. PDF additionally needs LaTeX — \`tinytex::install_tinytex()\`.

**Curved geometry looks wrong or fails.** CIRCULARSTRING, COMPOUNDCURVE and CURVEPOLYGON need the \`sfarc\` package. GEOS operations cannot take curves — tick Linearize on the tool.

**Unexpected CRS results.** Check the Calculation CRS on the tool and the default in Settings → Spatial Editor. Area and distance in degrees are meaningless; project first.

**A raster layer disappears.** Layer registrations are session-scoped. After an R restart or a project load they are re-registered automatically; if the backing R object is gone the layer is dropped instead.

**A black window after sleep.** The app forces a repaint on resume. If a request was in flight when the machine suspended, it may have been aborted — long operations hold a power-save blocker to prevent that.

Beyond these, ourgeo.dev/forum.html is the community forum.`,

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
}

/** Topic names, for when the model calls `ourgeo_docs` with nothing. */
export function topicListing(): string {
  const summaries: Record<string, string> = {
    interface: 'panels, toolbar, editor, console, viewers, settings',
    toolbox: 'the 87 geoprocessing tools, piping, Linearize and Calculation CRS',
    'data-import': 'Load Data, the Data Connector and its providers, .Rgeo',
    maps: 'layers, symbology, labels, selection, legend, export',
    drawing: 'edit mode, the nine tools, curves, snapping, staged edits',
    projects: 'scratch vs .ourgeoproj, what persists, recording',
    documents: 'Markdown and R Markdown, chunks, knit, Visual mode, publish',
    databases: '.Rgeo files, connect vs load, raster pyramids',
    shortcuts: 'keyboard shortcuts',
    troubleshooting: 'the common failures and what they mean',
    packages: 'which R package powers which feature',
  }
  const lines = Object.keys(OURGEO_TOPICS).map((t) => `- ${t} — ${summaries[t] ?? ''}`)
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
