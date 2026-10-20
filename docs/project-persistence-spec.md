# Project and document persistence — specification

Status: agreed with the maintainer 2026-10-20; implemented in 1.16.37. User guide:
[project-persistence.md](project-persistence.md). Acceptance driver:
`scripts/check-project-persistence.mjs`.
Owner of implementation and verification: the assistant. Every acceptance check
below is run by the assistant against the built app (`npm run build` + the
`run-ourgeo` driver), including forced kills and restarts. Nothing here is
delegated to the maintainer or to outside users.

## 0. Terms

- **Named project** — a project with a `.ourgeoproj` path.
- **Scratch** — the project with no path that ouRGeo launches into when no named
  project was open at quit.
- **Working state** — everything that makes up a project in the app (§1.1).
- **Draft** — the local, device-only copy of a named project's working state that
  differs from its `.ourgeoproj`. Kept in app data, keyed by project identity.
- **Base** — the version of the `.ourgeoproj` the draft started from: its archive
  signature plus a retained copy of that archive, used for conflict detection and
  three-way merge (§1.8).
- **Untitled document** — an editor tab with no file on disk.
- **File-backed document** — an editor tab bound to a file on disk.
- **Unsaved edits** — a file-backed tab whose text differs from its file, or an
  untitled tab with any text.

## 1. Named projects: total persistence

### 1.1 What is persisted

All of it, continuously, into the draft:

- Every open tab: kind, order, panel, active tab per panel, text (including
  unsaved edits), cursor, selection, scroll position, folding, Source/Visual mode,
  and chunk outputs.
- Object tabs (data viewer, function editor) and their view state.
- The R environment, including user environments and their placement.
- Spatial editor: layers, symbology, named sessions, extent, pending (unsaved)
  geometry edits, legend/annotation settings.
- Plots panel history and current plot.
- Console history.
- Assistant chats.
- Project Files catalogue and pending originals (already journalled; keep them).
- Working directory, working environment.
- Layout, if the project carries one.

Not persisted (live processes): terminal shells, running R evaluations, running
knits, in-flight assistant turns. Reopening shows them as not running, never as
alive.

### 1.2 When it is written

- UI state (tabs, text, layout, map, plots, console, chats): debounced ≤ 1.5 s
  after the change, so a crash loses at most ~2 s.
- R environment snapshot: on project close, on app quit, on switching project,
  and at idle checkpoints (R idle for the checkpoint interval and environment
  changed since the last checkpoint). The interval is a setting (§4.2), default
  30 s, range 10 s – 30 min, plus *Only when closing or switching*. A large
  environment snapshots slowly, so its user may want checkpoints less often.
  Checkpoints run in R's idle time and never block a command; one in progress is
  abandoned (not half-written) if a command arrives. The
  checkpoint time is recorded; it is what crash recovery reports (§3).
- A draft write is atomic (write temp, fsync, rename). A torn draft must never
  replace a good one.

### 1.3 Closing the app or switching project

- Never prompts by default. Working state is written to the draft, and reopening
  the project restores it exactly as in §1.1.
- Setting **Settings → Projects → When closing a saved project**:
  *Keep unsaved changes on this computer* (default) / *Save the project
  automatically* / *Ask*. "Ask" uses the existing Save / Don't Save / Cancel
  dialog; "Don't Save" keeps the draft (it does not discard it). Discarding is
  only ever done through Revert (§1.6).
- On launch, the project that was open at quit reopens, with its draft applied.

### 1.4 Closing a document

Applies in named projects and in scratch.

- File-backed tab with unsaved edits: **Save / Discard / Cancel**.
- Untitled tab with text: **Save to file… / Discard / Cancel**. Choosing "Save to
  file…" and cancelling the file picker cancels the close.
- Tab with no unsaved edits: closes without asking.
- Closing several tabs at once (Close All, Close Others): one dialog per dirty tab,
  each with an **Apply to all remaining** checkbox.

### 1.5 Save

- Writes the working state into the `.ourgeoproj` (the existing atomic save),
  makes that the new base, and clears the draft.
- By default, saving the project does NOT write file-backed documents to their
  files: their edits stay as unsaved edits, held in the project, until the
  document itself is saved.
- Setting **Settings → Projects → Save document edits when saving the project**
  (default off). When on, every project save also writes each file-backed tab's
  unsaved edits to its file first. That includes the automatic saves on close and
  on switching projects when §1.3 is set to *Save the project automatically*.
  Untitled tabs are not affected; they stay in the project.
- With that setting on, a document write failure (permission, file gone) stops
  the save before the bundle is written, names the file and offers **Save As…**
  for that document, **Skip this file** (it stays unsaved in the project) or
  **Cancel**. When the save was triggered by a close or switch, Cancel also
  cancels the close or switch.

### 1.6 Revert to saved

- Project menu item. Confirms, naming what will be lost (counts: documents with
  unsaved edits, R objects changed, layers, plots, chats). Then it discards the
  draft and reloads from the `.ourgeoproj`.

### 1.7 Indicator

- The project menu shows *Unsaved changes, kept on this computer* while a draft
  exists, so a user on a shared drive knows colleagues cannot see them.

### 1.8 The `.ourgeoproj` changed elsewhere

On open, and before Save, compare the file's archive signature with the draft's
base. If they differ and a draft exists, ask:

- **Discard my changes and open theirs** — drop the draft, open the file.
- **Open my version and save it over theirs** — apply the draft and save it over
  the file, after a second confirmation naming the file's modification time.
- **Resolve conflicts** — open the merge view (§1.9). Nothing is written until the
  user finishes it.

Cancel leaves the project unopened and the draft untouched.

### 1.9 Resolve conflicts

A three-way merge between base, mine (the draft) and theirs (the file):

- Changes made on only one side are combined automatically and listed as such.
- Text documents: a side-by-side diff per conflicting hunk, with mine / theirs /
  both (mine first) / edit-by-hand.
- Whole items that cannot be merged inside (R objects, map layers, plots, Project
  Files entries, chats, layout): choose mine / theirs / keep both. Keeping both
  renames mine with a `_mine` suffix (`_mine_2`, … on collision).
- Every item can be inspected before choosing: text diff; for R objects, `str()`
  of both versions plus size and class; for layers, feature counts, fields and
  CRS; for plots, both images.
- **Finish** saves the merged result to the `.ourgeoproj` and makes it the new
  base. **Cancel** changes nothing; the conflict is asked again next time.
- If the base archive copy is missing (draft from before this feature), only the
  first two choices are offered, and the dialog says why.

### 1.10 One window per project

A second ouRGeo instance opening a project that is already open on this machine
is refused, with a message telling the user it is already open and offering to
focus that window. Enforced with a lock file next to the draft that records the
process id and its start time (a stale lock from a dead process is taken over).

### 1.11 Restoring the R environment

- Restore everything that was snapshotted. Rebuild or reconnect what can be:
  `.Rgeo` proxies (the existing `/db/reconnect`), raster layers (re-register),
  file-backed `SpatRaster`/`terra` objects whose source still exists.
- Anything that cannot be rebuilt (dead connections, external pointers, temp-file
  rasters whose file is gone) is listed by name and reason in one warning:
  "Not restored: con (database connection), r_tmp (temporary raster file is
  gone)". The other objects are restored.
- The warning has **Don't show again**; **Settings → Prompts** turns it back on.
  While silenced, the same list still goes to the console as an `info` line, so
  it is never invisible.

## 2. Scratch: a clean desk with your notes

### 2.1 What survives

- Untitled tabs with their text, cursor and position. Nothing else.

### 2.2 What is dropped when leaving scratch

Leaving = quitting the app, or switching to any named project, new project or
opened project.

- The R environment, map layers and sessions, plots, console history, object
  tabs, assistant chats, and file-backed tabs (after §2.4).
- Returning to scratch later in the same session finds it clean except for the
  untitled tabs. Scratch is cleared at the moment the user leaves it, not on the
  next launch.

### 2.3 Prompt 1: save as a project

- Shown only when something would be dropped: R objects, map layers, plots,
  open file-backed tabs, or chats. If scratch holds only untitled tabs, there is
  no prompt.
- Lists what would be lost (counts), and offers **Save as project… / Don't save /
  Cancel** plus **Don't ask again**. **Settings → Prompts** turns it back on.
- **Save as project…** creates the named project with everything, including
  unsaved edits to file-backed tabs as unsaved edits (not written to their
  files). Prompt 2 is skipped. Then the quit or switch continues.
- **Cancel** aborts the quit or switch.
- If the checkbox is set, it behaves as if **Don't save** was chosen.

### 2.4 Prompt 2: unsaved edits to file-backed tabs

After prompt 1 when **Don't save** was chosen (or prompt 1 is silenced):

- One dialog per file-backed tab with unsaved edits, showing the file name and a
  diff summary: **Apply** (write the edits to the file) / **Drop** (discard) /
  **Cancel** (abort the quit or switch), with an **Apply to all remaining**
  checkbox that repeats the choice for the rest.
- A write failure (permission, file gone) stops the sequence and names the file
  and the recovery move (Save As… to a new path, or Drop). It never drops silently.

### 2.5 Recently closed

- File-backed tabs dropped from scratch are added to a **Recently closed** list
  (file menu and the empty-editor state), max 20, persisted in app data. Opening
  one re-reads the file from disk. Missing files are shown greyed out with
  "file not found".

## 3. Crash recovery

### 3.1 Detection

- A clean-exit marker is written at the end of `will-quit`. Its absence on the
  next launch means the last session did not close cleanly.

### 3.2 What is recovered

- Named project: the draft, i.e. everything in §1.1 up to its last write; the R
  environment from its last checkpoint.
- Scratch: untitled tabs from their last write. Everything else in scratch is
  dropped, as it would have been on a clean quit (§2.2), so a crash cannot
  resurrect it.

### 3.3 The warning

- Says ouRGeo did not close properly, then lists:
  - documents restored (and any whose recovery copy was unreadable, by name);
  - the time of the R checkpoint, and "objects created after this need
    re-running; the console history shows what you ran";
  - the time of the newest recovered change.
- Has **Show console history** and **Dismiss**. It is never silenced by any
  setting.

### 3.4 R crashed, app did not

- The app keeps every document, the map and the console. After R restarts, the
  R environment is restored from the last checkpoint and the message says only
  that: the R session stopped, objects were restored from the checkpoint time,
  and later ones need re-running.

## 4. Settings and maintenance

### 4.1 Settings → Prompts (new page)

One place listing every "don't ask/show again" in the app, each as a switch:

- Ask before an export replaces a project file (moved from Settings → Project
  Files; the Project Files page links to it).
- Offer to save scratch as a project when closing it.
- Warn when R objects could not be restored.

New silenceable prompts must be added here; a test asserts that every persisted
"don't ask again" preference key has a switch on this page.

### 4.2 Settings → Projects (new page)

- When closing a saved project (§1.3).
- R snapshot interval (§1.2): default 30 s; 10 s – 30 min or *Only when
  closing or switching*. The time the last snapshot took is shown beside it, so
  the user can see what a shorter interval costs.
- Save document edits when saving the project (§1.5), default off.
- **Stored unsaved changes**: lists drafts held on this computer (project name,
  path, last changed, size, and whether the file still exists), total size, and
  per-draft **Delete** plus **Delete drafts older than…** (30 / 90 / 365 days).
  Deleting confirms, and it never touches a `.ourgeoproj`. Drafts are kept
  indefinitely unless deleted here.

### 4.3 Health check step

- A **Stored project changes** step: reports draft count, total size, drafts
  whose project file no longer exists, and drafts older than 90 days. It offers
  the same cleanout as §4.2 with explicit approval, like the existing repair
  steps. It is not a failure, only information plus an optional action.

## 5. Acceptance checks

Each is a driver script in `scripts/check-project-persistence.mjs` (built app,
isolated profile), plus unit tests for the pure parts (draft store, merge,
prompt sequencing). "Kill" means SIGKILL to the Electron main process; "restart"
means a fresh launch on the same profile.

| ID | Check |
|---|---|
| N1 | Named project: open 3 tabs (1 untitled with text, 1 file-backed edited, 1 clean), split editor, move cursors, add layer, plot, create objects, chat. Quit cleanly with no prompt. Restart: everything in §1.1 identical, including cursor and scroll position. |
| N2 | N1 setup, switch to another project and back: identical; no prompt. |
| N3 | Close a dirty file-backed tab: Save / Discard / Cancel each behave per §1.4; file contents on disk verified. |
| N4 | Close an untitled tab with text: Save to file… (picker stubbed; then cancelled → tab stays) / Discard / Cancel. |
| N5 | Close All with 3 dirty tabs, "Apply to all remaining" on the first: one dialog only; outcome applied to all. |
| N6 | Project Save writes the bundle and clears the draft; file-backed edits remain unsaved and the files on disk are unchanged. |
| N6a | With "Save document edits when saving the project" on: project Save, and an automatic save on switch (§1.3 set to Save automatically), write each dirty file-backed tab to disk; untitled tabs stay in the bundle; a read-only file stops the save with Save As… / Skip / Cancel, and Cancel also cancels the switch. |
| N7 | Revert: confirmation lists counts; after it, state equals the bundle and the draft is gone. |
| N8 | Indicator present iff a draft exists. |
| N9 | Each setting in §1.3: Keep / Save automatically / Ask, verified on quit. |
| N10 | Modify the `.ourgeoproj` from a second profile, reopen in the first: three choices appear; Discard and Overwrite verified on the resulting files. |
| N11 | Resolve conflicts: one-sided changes auto-merged; a text hunk conflict, an R object conflict and a layer conflict each resolved via mine / theirs / both; the saved bundle contains exactly the choices; Cancel writes nothing. |
| N12 | Draft without a base copy: Resolve conflicts is absent with an explanation. |
| N12a | R snapshot interval set to 10 s, 5 min and "Only when closing": checkpoints occur accordingly (timestamps from the draft); a command arriving mid-checkpoint is not blocked and leaves the previous snapshot intact. |
| N13 | Second instance on the same project is refused; a stale lock from a killed process is taken over. |
| N14 | R env with a `.Rgeo` proxy, a raster layer, a closed DBI connection and a deleted temp raster: first two rebuilt; the other two named in the warning; silenced warning still logs to the console; Settings → Prompts re-enables it. |
| S1 | Scratch with only untitled text: quit, no prompt; restart: text, cursor and position intact; env, map, plots, console, chats empty. |
| S2 | Scratch with objects/layer/plot/file tab: quit shows prompt 1 with correct counts; Cancel aborts quit. |
| S3 | Prompt 1 → Save as project…: new project contains everything, file-backed edits held as unsaved; files on disk unchanged; prompt 2 not shown. |
| S4 | Prompt 1 → Don't save → prompt 2 for 3 dirty file tabs: Apply, Drop, then Apply to all; disk contents verified; a read-only file produces the named error and stops. |
| S5 | Prompt 1 "Don't ask again" persists across restart; Settings → Prompts turns it back on. |
| S6 | Switch scratch → named → scratch in one session: scratch is clean except untitled tabs. |
| S7 | Dropped file tabs appear in Recently closed; reopening reads the current disk content; a deleted file shows "file not found". |
| C1 | Named project: edit text, wait 2 s, create objects, wait for an idle checkpoint, create one more object, kill. Restart: warning shown with checkpoint time; text present; checkpointed objects present; last object absent and the warning says so. |
| C2 | Scratch: kill with untitled text and objects. Restart: untitled text recovered; objects/map/plots absent; warning shown. |
| C3 | Corrupt one recovery document file before restart: the others recover; the bad one is named in the warning. |
| C4 | Kill R only: documents and map untouched; environment restored from the checkpoint; R-specific message shown. |
| C5 | Kill during a draft write (fault injection hook in test profile): previous draft intact and loads. |
| M1 | Settings → Projects lists drafts with sizes; Delete and Delete older than… remove only drafts; bundles untouched. |
| M2 | Health check step reports counts/orphans/age and cleans up only after approval. |
| M3 | Every persisted "don't ask again" key has a switch on Settings → Prompts (unit test). |

Gates for completion: all checks above pass on Linux; `npm run typecheck`,
`npm run lint` (0 errors, warning count not rising), `npm run test` green;
CLAUDE.md, README, `docs/project-files.md` (or a new user guide section), the
`projects` docs topic in `ai-skill-ourgeo.ts`, and the patch version updated.
Windows/macOS verification is deferred, as for Project Files.

## 6. Decisions made in writing this spec

Flag any of these to change them.

1. R checkpoint cadence: a setting, default 30 s idle after a change, plus
   close/quit/switch. No size cap; the snapshot shows progress and runs in R
   idle time.
2. Saving a project saves file-backed documents to disk only when the setting
   in §1.5 is on (default off).
3. The base for three-way merge is a retained copy of the opened archive, stored
   with the draft; this roughly doubles a draft's disk use.
4. "Keep both" names the draft's copy with a `_mine` suffix.
5. The crash warning cannot be silenced.
6. Recently closed holds 20 entries.
7. Settings → Prompts becomes the single home for silenceable prompts, and the
   existing replace-file switch moves there.
