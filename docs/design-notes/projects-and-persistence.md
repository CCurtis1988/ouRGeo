# Stores, persistence, drafts, projects and Project Files

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

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
  Scratch's documents live in its **draft** (`project-drafts/scratch/`, see
  *Drafts* below); `session.json` is now only read once, as a legacy fallback.
- **Session-scoped (renderer reloads only)** — `workspace-persistence` writes
  spatial layers (`spatial-layers.json`), map view/legend settings
  (`spatial-ui.json`), console history (`console.json`), and object-backed
  data-viewer/function-editor tabs (`object-tabs.json`); `plots-persistence`
  writes `plots.json`. The `will-quit` handler deletes them on exit, and since
  1.16.37 `beginSession` (`electron/main/project-drafts.ts`) also deletes them
  at LAUNCH: they exist so a renderer reload keeps scratch's panels, and a
  crash must not resurrect scratch's map and plots on the next launch (spec
  §3.2). Named projects recover from their draft instead.

Files are split so a pan or console line never rewrites the large layer geojson.
On load, object tabs are appended after code tabs, then `pruneStaleObjectTabs`
drops any whose R object is gone. Workspace savers intentionally have **no
`beforeunload` flush** — that would race the on-exit deletion; the debounced
saves during the session suffice for reload recovery. All wired in `App.tsx`.

### Drafts, crash recovery and leaving a workspace (1.16.37)

The behaviour is specified in `docs/project-persistence-spec.md` and explained
to users in `docs/project-persistence.md`; `scripts/check-project-persistence.mjs`
runs its acceptance checks against the built app in disposable profiles.

- **A draft is the project's working state on this computer.**
  `electron/main/project-drafts.ts` keeps one directory per bundle path under
  `project-drafts/<sha16>/`: `ui.json`, `layers.json`, `plots.json`, `view.json`
  (cursors — kept even when nothing changed), one `docs/<tab id>.json` per
  document so one unreadable file never costs the others, `environment.RData`
  (the R checkpoint), `base.ourgeoproj` (the bundle as opened — what a merge
  compares against) and `lock.json`. Every write is temp + fsync + rename;
  `OURGEO_TEST_DRAFT_FAULT=kill-before-rename` exists only for acceptance C5.
  `meta.changed` is what the project menu's "kept on this computer" reports.
- **The renderer writes it** (`lib/project-draft.ts`): one subscription set,
  debounced to a second, comparing each slice with what it last wrote. A
  named project writes its change slices only while `isDirty`; Save discards
  them and refreshes the base. Writes are suspended while a project replaces
  the stores, or a half-hydrated workspace would land in either side's draft.
- **Documents are project content now.** A tab whose object changed marks a
  named project dirty, and `applySessionData` restores a dirty file-backed tab
  as edits against the file as it is NOW (savedContent = disk). The old rule
  that code tabs "always persist via session.json" is gone.
- **R checkpoints fork** (`r/lib/handlers-checkpoint.R`): on Unix
  `parallel::mcparallel` writes the snapshot from a copy-on-write child, so the
  console never waits; the renderer polls `/session/checkpoint/status`. Windows
  has no fork and snapshots in-process, in idle time. Snapshots — and bundle
  saves, which use the same endpoint synchronously — PACK terra objects
  (`terra::wrap`, by file reference when file-backed) because a raw
  SpatRaster saves as a dead pointer; `/session/snapshot-load` unpacks them,
  reattaches packages, and returns `notRestored` (closed DBI connections,
  rasters whose file is gone) for `lib/project-restore-report.ts` to name.
- **Leaving goes through one function** (`lib/project-leave.tsx`): the window's
  close, the project menu and `project:open`/`project:new` all call
  `leaveCurrentWorkspace`/`switchProject`. A named project keeps its draft by
  default (Settings → Projects); scratch asks Save as project, then Apply /
  Drop per dirty file. `UnsavedChangesDialog` is gone — its Don't Save
  discarded the Project Files and memory journals, which the spec forbids.
- **Every prompt is `ask()`** (`store/ask.ts`, `components/project/AskDialog.tsx`,
  z-310): queued, Escape is always the cancel answer. Closing documents
  (`lib/document-close.tsx`) — ✕, Ctrl+W, Close Others/All, `editor:closeTab`
  — asks Save / Discard / Cancel with Apply to all remaining.
- **A changed bundle is a three-way decision** (`lib/project-merge.ts` pure,
  `lib/project-merge-flow.ts`, `MergeDialog.tsx`, `lib/text-diff.ts`). Mine is
  OPENED first (`loadProjectFromPath(path, { draft: 'mine' })`, which also
  asks the file library to prefer its journal over the changed bundle), so
  every comparison reads the live stores, R (`'live'` side of
  `/project/merge-env/compare`) and catalogue rather than a second
  reconstruction of the draft. `project:inspect` reads theirs and the base
  without activating anything; `project:adoptFiles` copies chosen entries;
  `project:acceptDestination` lets the next save replace the changed file.
- **Launch** asks `drafts:launch` how the last session ended
  (`last-session.json`, whose `cleanExit` is written LAST in `will-quit`) and
  which project to reopen. A renderer reload is not a launch: it reopens the
  project with `keepR`, since R still holds the objects.
- **One window per project**: `lock.json` records pid and (Linux) process
  start time; a dead or recycled pid's lock is taken over. The owner watches
  for a `focus-request` file so "Show that window" works across instances.
- **Snapshots are uncompressed; bundles get gzip level 1.** Measured on a
  480 MB vector: `save()`'s default gzip took 60 s, level 1 took 11.5 s for a
  file 1% larger, none took 0.5 s. A checkpoint is local and rewritten every
  idle interval; a 60-second one never finished before the next change.
- **Console lines written while a project opens are deferred** until after
  its console history is restored — written earlier, the restore overwrote
  them, and "Not restored: …" vanished from the console it was promised to.
- **"Not opened" can still mean opened.** Cancelling Resolve conflicts leaves
  the user's own version open, so the launch fallback to scratch checks the
  project path, and `restoreScratchDocuments` refuses to run over a named
  project: once it did, and the draft writer saved the project as one empty
  tab (`project-scratch-guard.test.ts`).
- **The project menu carries `data-restored`** once the launch restore has
  finished. "R session ready" comes first, and the project opens after it;
  automation that waited for R raced the restore.
- **Settings → Prompts** lists every persisted "don't ask again"
  (`PROMPTS` in `store/prompt-preferences.ts`); `PromptSettings.test.tsx` scans
  the source for the phrase and fails on an unregistered one. Settings → Project
  Files now points there.

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
  where ouRGeo starts when no named project was open at quit — a clean R env,
  never savable in place. It keeps only its untitled documents (in its draft);
  leaving it drops everything else at that moment, after the prompts in
  `lib/project-leave.tsx`. Save As spins off a real project.
- **Load** → `/session/reset` (clears user objects — keeping `system_names` —
  plus DB conns + proxies), the snapshot (the draft's checkpoint when it has
  one, else the bundle's) through `/session/snapshot-load`, hydrate UI stores
  (from the draft when it holds changes), then `/db/reconnect`
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
- **Dirty tracking**: env/spatial/plots/document/chat/map-session changes mark
  a *named* project dirty (`enableDirtyTracking` after startup; suppressed
  during load/new). Dirty means the draft holds changes the bundle does not.
  On window close the main process fires `app:before-quit`; the renderer runs
  `leaveCurrentWorkspace('quit')` and calls `app:confirm-quit` unless the user
  cancelled.
- Recent projects (max 5) persist in `recent-projects.json` (never deleted).

### Embedded Project Files (1.16.23)

`electron/main/project-files/` owns original-file staging, catalogue journals,
scoped reads, protected derived indexes and streaming project archives. A named
saved project is required before importing. The pane (`ProjectFilesPanel`) shares
the Console/Terminal tab group initially and follows ordinary remembered layout;
the project menu restores a hidden pane. Renderer state is a catalogue mirror,
not ownership of bytes or running jobs. Chat attachments hold portable references;
the broker resolves current bytes under its existing scope/exclusion/budget checks.

The first saved library upgrades `project.json` to manifest version 2, with
`files/catalogue.json` and content-hash-addressed original blobs. Legacy v1 readers
reject v2, preventing their packer from silently stripping embedded originals.
The new reader keeps v1 support. Display names/logical folders never become archive
paths. Packing/unpacking/verification runs in a bounded worker and reads entries
incrementally using pinned yauzl/yazl. A staged save verifies all referenced
original hashes before atomic publication; a destination changed outside the app
requires Save As. If R is unavailable, preserve the last committed R snapshot
rather than dropping it during a file-library save. Later edits stay dirty.
Open workspaces have main-owned opaque receipts. The renderer releases one after
R loading and UI hydration, including failure paths; it cannot request recursive
deletion of an arbitrary path. Failed opens and normal shutdown also clean those
temporary copies, so repeated opens do not retain complete R snapshots in userData.

Pending originals and catalogue edits are durable project content, separate from
discardable derived previews/indexes. Recovery binds to project identity and base
archive signature. A conflicting draft remains recoverable into an independent
copy. Save As carries library identities into a new project namespace and rebinds
portable citations; it revokes live context/transport handles. Never put encoded
file/image bodies in persisted chat/project JSON.

PDF.js supplies PDF text/pages; a bounded OOXML adapter preserves DOCX structural
locations and XLSX raw/type/formula/format metadata using fast-xml-parser/numfmt.
Parser children receive only the managed original and runtime code through Node
filesystem permissions, a scrubbed environment, disabled network entry points and
heap/RSS/time/output limits. They never follow Office external relationships or
run scripts, macros or formula recalculation. Hidden workbook content is excluded
unless explicitly enabled under protected local policy. Full-text bodies persist
encrypted under the existing safeStorage-backed key and remain local.

Project-file source descriptors participate in ordinary discovery; a local content
search callback additionally finds passages absent from descriptions. Typed page,
section, cell and line reads retain source revision, coverage, bounded continuation
and clickable citations. Absence from a partial index is not proof of absence.
The read buffer's offset domain stays fixed through continuation; source coverage
and the existence of another page are separate facts. CSV source line spans are
physical file lines, not generated row descriptions. Workbook ranges must filter
source cells and their titles, not only their formatted body strings.

Image evidence is transient and materialised immediately before provider dispatch.
The initial qualified route is native Ollama `gemma4:e2b`; other routes remain
unsupported/unknown until verified. Token reservations are separate from base64
length and reported usage. PDF human/model renditions share a bounded PDF.js canvas
helper and bundled worker. A host-authorised custom scheme streams original PDFs;
it requires current project lease and revision and grants no arbitrary path access.
Revisions/revocations reset retained provider context and cancel affected turns.

User guidance is in `docs/project-files.md`, the requirements in
`docs/project-files-spec.md`, and measured qualification/deferred platform checks
in `docs/project-files-implementation.md`. Native Windows/macOS verification is
deferred; Linux evidence does not qualify their locking/packaging/keyring behaviour.

### Linked project folders (1.16.24)

Project Files combines **In project** originals with **Linked folders**. The
linked-folder library shares previews, user metadata, source IDs, attachments,
exclusions and evidence budgets with embedded files. Its files stay on disk;
linking and rescanning build the local catalogue and encrypted derived index.
Generated metadata never establishes that a whole file was read. Oversized or
unsupported assets remain discoverable as metadata with explicit read limits.

Folder references and relative file metadata are portable; canonical roots and
their filesystem identity are protected local grants. A bundle cannot authorise
an arbitrary path on the machine opening it. Relink explicitly authorises a local
root; trusted Save As can carry currently authorised roots into its new identity.
Changed/missing roots and files revoke old evidence until a valid rescan/relink.
Readers recheck containment, ignore rules and file identity. Parsers, image
decoders, exports and PDF streaming use verified immutable snapshots when needed,
so a source changing during a read cannot substitute new bytes under an old ref.

Linked catalogues use schema 2 and project manifest 3. Older writers reject the
new manifest rather than strip the references or silently embed external bytes.
Only embedded hashes become archive blobs; external byte sizes do not count as
the portable bundle's original-byte payload. Existing v1/v2 projects still open.

Forget removes the reference, local authority and derived retrieval access. It
never deletes the directory or its contents. Removing an individual linked item
hides it from the project, rather than deleting its external source. The assistant
has registry actions to list, link, create, rename, rescan, relink and forget;
link/create/relink/forget default to confirmation, and model actions require
explicit paths rather than opening invisible native pickers. Physical creation
creates one new directory beneath an existing parent and never overwrites one.
The legacy settings folder sources remain temporary, workspace-scoped text access.

See `docs/linked-project-folders-spec.md` and the Project Files guide for the
workflow. Native Windows/macOS checks remain deferred.

### Project Files from R (1.16.36)

`r/lib/project-files.R` gives every R session ouRGeo runs five helpers that slot
INTO ordinary R: `ourgeo_project_file(name)` returns a readable path,
`ourgeo_project_path(name)` a writable one, plus `ourgeo_project_save()`,
`ourgeo_project_files()` and `ourgeo_project_commit()`. The user keeps
`write.csv`, `ggsave`, `sf::st_write`; only the path changes, and that is also
the R every export dialog echoes, so the GUI teaches the script.

- **R asks main directly, over a loopback door** (`project-files/r-access.ts`).
  The renderer channel cannot serve `read.csv(ourgeo_project_file(…))`: it only
  runs while R is idle, and the path is needed mid-evaluation. Bound to
  127.0.0.1, per-launch bearer token passed in `OURGEO_PROJECT_FILES_URL/_TOKEN`,
  started before R spawns, refuses any request carrying an Origin. The token
  grants only what the user's R already has; writes still go through the library.
- **A writer needs a path before the file exists**, so `ourgeo_project_path`
  hands out a staging path and the commit runs in `handle_execute`/chunk sweeps
  (`.ourgeo_pf_finish_command`), beside the env/wd sweeps. A read commits pending
  writes first, so write-then-read in one command behaves as on disk. A staged
  path nothing wrote to is reported and dropped rather than committed by some
  later unrelated command.
- **`ProjectFileLibrary.put` is add-or-replace BY NAME**, unlike `add`, which
  de-duplicates names because two dragged-in files are two files. A re-run must
  update `summary.csv`, not collect `summary (2).csv`. `put` deliberately does
  not claim `state.operation`: that slot is shared with indexing, and a script's
  second write met "A file operation is running" while the first was indexing.
  Indexing is queued through `pendingIndex`. Identical bytes are `unchanged`.
- **Embedded reads are read-only copies** under `tempdir()/ourgeo-project-files/
  <sha>/<name>`: readers (readxl, GDAL) need the extension the content-addressed
  blob lacks, and read-only makes a writer pointed there fail loudly rather than
  change a copy nothing saves. Linked files are read in place.
- **Knit sources the same file** into its clean child and passes the same env,
  or a document using the helpers would be the newest "works in console, fails
  on Knit". That is why the file is self-contained (base + curl + jsonlite).
- `src/lib/project-file-targets.ts` is the one parser of "folder/name" (main
  resolves, renderer emits); `project-file-code.ts` is the R the dialogs emit
  (`FileDestination` union, `writeTableCode`, `savePlotCode`). The plot export
  dialog now always runs `ourgeo_save_plot()` — the old base64 write echoed
  nothing and resolved an empty directory against main's cwd, not R's. The map
  image is a screenshot, so it goes through `projectFiles:putBytes` with an
  info line naming Export Code as the reproducible route.
- **Checked vector export reaches Project Files through its own pipeline**,
  not around it (`dq_export_project_stage` in `vector-export.R`). The plan is
  fingerprinted and revalidated at preflight, approval and publication, so the
  staging path is FIXED per name (`tempdir()/ourgeo-project-export/<sha16>/`),
  not `ourgeo_project_path()`'s fresh one — a new temporary path each time read
  as a changed destination. Add/replace-layer stages the project's current
  copy, whose hash becomes `destinationRevision`, so a project file changed
  between check and save is refused like a changed file on disk. Publication
  then `put`s the verified file and deletes the stage. `tempdir()` is
  normalised because macOS's sits under `/var`, a symlink the destination check
  rightly refuses. The echoed `dq_export_run(...)` carries `projectFile`, so it
  replays.
- **Dialogs ask before replacing; R does not** (`store/project-file-replace.ts`,
  `ReplaceProjectFileDialog`). The Environment menu names its file after the
  object, so re-exporting `sites` silently replaced the `sites.csv` imported
  last week. `replacedProjectFile` states `put`'s rule (same display name, any
  folder, never a linked file) so the question is about the file that will
  actually be overwritten. "Don't ask again" counts only with Replace, persists
  in `project-file-preferences.json` (a preference, never session-scoped), and
  Settings → Project Files turns it back on — a dismissal with no way back
  makes the checkbox a one-way door. The dialog is z-300 because Export Code's
  own dialog is z-201. A new vector file asks; add/replace-layer does not,
  since the checks already review that update. Assistant actions do not ask:
  they have their own tiers.

### File-analysis task models (1.16.25)

`ai-task-models.json` stores device-local document/image selections and the
optional import/rescan AI-description preference, off by default. Null follows
the assistant. Explicit selections never mutate the active chat or its provider
connection. Invalid destinations and persistence failures remain actionable;
there is no silent fallback to another provider. Strict read-back verification
surfaces failures hidden by the ordinary JSON helper's best-effort writes.

On-demand project-file reads pass only their bounded authorised excerpt to the
document specialist, retaining original text and exact citations alongside its
labelled interpretation. An image specialist receives transient typed pixels and
returns labelled text to the main assistant; a text-only chat can use this route.
Native Ollama image serialisation is qualified at the transport level and gated
by each selected model's reported vision capability, rather than a single model
name. Other image transports remain unsupported/unknown. Interpretation accuracy
is model-dependent; transport capability is not proof of correctness.

`runFileAnalysis` offers no tools, history or resumed sessions. It resolves the
target's own context, validates scope/source policy before and after preparation,
dispatch and response, and accounts with a separate main-owned inference
authority bound to the actual provider/model. It never overwrites the assistant's
trace or context occupancy. Stop, project switches, source revocation and task
configuration changes invalidate in-flight work.

Optional background descriptions originate from explicit renderer import/rescan/
reindex events. Hydration, reopening and enabling the preference do not enqueue a
library. The serial, cancellable queue waits for local extraction, honours source
exclusions, reuses unchanged revision/model descriptions and persists separate
AI provenance through `setAnalysis`. Descriptions cover the first bounded text
excerpt or selected image only. User descriptions and local extraction metadata
remain authoritative separate fields; stale AI descriptions are not used for
discovery. Originals and schema versions are unchanged.

In 1.16.26, `useAiModelCatalogue` shares one live catalogue between chat, provider
settings and file-task settings. It merges saved per-provider choices, chat/task
custom IDs, built-in aliases and discovered models without another registration
store. Model IDs deduplicate within a provider, preserving distinct API and
subscription destinations. Local discovery coalesces requests per connection and
refuses late results from replaced URLs/keys; credentials remain private volatile
request identity, never catalogue state. ChatGPT refresh coalesces simultaneous
status/model reads through the existing account store. Explicit account actions
invalidate that in-flight generation; an old account response cannot replace the
new account's catalogue. Task selection never calls sign-in, adds an account,
changes a CLI path or mutates the active chat.
