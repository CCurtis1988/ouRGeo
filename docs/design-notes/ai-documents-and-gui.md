# Document skill and driving the GUI

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

### The document skill (`ai-skill-documents.ts`, `ai-doc-context.ts`, `ai-doc-tools.ts`)

A local model once produced an excellent earthquake report in which every figure
chunk was a bare session variable (`p1`, `combined_plot`), no chunk loaded the
data, and every headline number was typed into the prose. All three are invisible
from inside the model: running a chunk inline evaluates in the LIVE session and
succeeds, and only the Knit button — a clean child `Rscript` — tells the truth.
Nothing in the prompt mentioned documents at all.

- `buildDocumentSkill({ hasDocumentTools })` is retrieved on demand for document
  work, with a dispatcher prerequisite gate. It is absent from unrelated turns.
  Its centre is the
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
and settings — plus the 88 toolbox tools.

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
  call. The system prompt lists no action ids (`actionIndex()` was
  only ever in `buildOurgeoCore`, which ships nowhere); see `ai-skills.md`.
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
- **Knowledge is progressive.** (Historical: `buildOurgeoCore()` was meant to
  be ~1200 tokens in every prompt, but it reached no model after the context
  broker landed; the skill catalog replaced it, see `ai-skills.md`.) It held what ouRGeo is, the every-action-echoes-its-R rule, the layout, the
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
