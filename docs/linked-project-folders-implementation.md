# Linked folders: delivery record

Implementation date: 17 October 2026. Application version: 1.16.24.
See the [specification](linked-project-folders-spec.md) and
[Project Files guide](project-files.md#linked-folders).

## Delivered behaviour

Linked folders and embedded originals share Project Files, selective context
retrieval, descriptions, roles, previews and citations. The pane retains its
Console/Terminal placement and the user's layout choices. Location filters and
storage badges distinguish **In project** from each labelled external folder.

The folder manager links existing directories, creates one new physical child
under a chosen parent, renames project labels, rescans, relinks and forgets links.
A saved, named project is required. Removing an individual linked file excludes
it from subsequent scans and supports Undo. Forgetting a folder removes its
catalogue entries and access through that link; it never deletes physical files.

Imports and rescans index supported documents locally. Unchanged rescans preserve
revisions, user metadata and encrypted extraction caches. Cache identity includes
media type, so identical CSV and text bytes retain their correct location types.
Filesystem changes mark the folder as needing a scan; every evidence read also
checks the actual source, applicable ignore rules and root identity. Supported
preview/export/parse operations use bounded immutable temporary snapshots.

External originals remain outside the project archive. Portable folder labels and
relative file metadata use manifest 3 and portable catalogue 2. Device-local path
grants remain encrypted. Reopening locally restores a valid grant; a fresh profile
must explicitly Relink, even when the external directory physically exists.
Trusted Save As transfers local grants into the new project identity. Earlier
manifest versions remain readable; unsupported required capabilities are refused.

Seven assistant actions cover listing, linking, creating, renaming, rescanning,
relinking and forgetting. They use the existing action validation and permission
system. Link/create/relink/forget default to confirmation and require explicit
paths rather than model-controlled native pickers. Natural requests to forget a
folder link no longer enter the separate memory-forgetting workflow.

Unavailable roots revoke file evidence and relevant retained context. Ready
metadata-only files remain discoverable through ordinary source search, with
body and image access refused clearly. Folder metadata is available for recovery
through `project:folders`. Normal chat does not scan or inject every file body.

## Bounds and practical limits

- Up to 32 links and 2,000 catalogue entries across embedded and external files.
- Per-folder scan: 10,000 visited nodes, 512 directories, depth 20, 15 seconds and
  512 MiB of eligible hashed bytes. Reached limits and omissions are visible.
- Originals above 100 MiB remain metadata-only in place; their size is genuine,
  and they have no fabricated content hash or searchable body.
- Unsupported binaries, including database formats, remain discoverable assets;
  this feature does not add database/spatial dataset interpretation.
- Ignore policies and private-path exclusions apply. Symlink/hardlink aliases
  are not followed. Overlapping roots are refused to avoid ambiguous aliases.
- External files are not portable snapshots. Rescan after editing them; use
  embedded imports when exact originals must travel with the project.
- Existing image-provider qualifications and format-extraction limits remain as
  recorded in [Project Files validation](project-files-validation.md).

## Verification

The final application tree passed TypeScript checks, production build and all
**2,757 tests in 275 suites**. ESLint reported **0 errors and 37 existing warnings**.
Lifecycle and security fixtures cover source changes during parsing, immutable
snapshots, ignore changes, traversal, hardlink/symlink exclusion, root replacement,
large-file metadata, unchanged cache reuse, Save As, discard and nondestructive
removal/forgetting.

The native built-app driver passed 11 checks, including real pane link/create/
forget controls, Markdown deep search, PDF page reads, changed-file rescan,
metadata preservation, local reopen, fresh-profile refusal, explicit relinking
and original-byte preservation. Its fixture includes a sparse 200 MiB external
file and excluded credential/ignore entries. No renderer errors occurred.

The native assistant driver passed 13 checks. A deterministic loopback model
exercised the production dispatcher and real confirmation dialogs for physical
creation and natural-language folder forgetting, plus rescan and broker retrieval.
The original Markdown SHA remained unchanged after forgetting. Existing document,
image, citation, stale-source and save checks also passed. This proves application
integration; it is not a new real-model comprehension benchmark.

The Linux x64 Electron 41.0.2 ASAR package also passed all 11 linked-folder
checks and all 20 embedded-library regression checks, with no renderer errors.
The embedded regression includes PDF canvas rendering, typed spreadsheet grids,
hidden-content disclosure, image previews, portable reopen and temporary R-open
snapshot cleanup. Embedded-only saves still use manifest 2; projects containing
links use manifest 3.

Reproducible commands and local evidence:

```sh
TMPDIR=$PWD/.cache/tmp npm run typecheck
TMPDIR=$PWD/.cache/tmp npm run lint
TMPDIR=$PWD/.cache/tmp npm run test -- --maxWorkers=2
TMPDIR=$PWD/.cache/tmp npm run build
TMPDIR=$PWD/.cache/tmp node scripts/check-linked-project-folders.mjs
TMPDIR=$PWD/.cache/tmp node scripts/check-project-files-chat.mjs --linked-actions
TMPDIR=$PWD/.cache/tmp node scripts/check-linked-project-folders.mjs --packaged .cache/project-files-package/linux-unpacked/ourgeo
TMPDIR=$PWD/.cache/tmp node scripts/check-project-files.mjs --packaged .cache/project-files-package/linux-unpacked/ourgeo
```

Built-app evidence: `.cache/linked-project-folders/run-9LzxGV/report.json`.
Assistant evidence: `.cache/project-files-chat/run-cxMloc/report.json`.
Packaged linked evidence: `.cache/linked-project-folders/run-SK3znc/report.json`.
Packaged embedded evidence: `.cache/project-files-review/run-mNe4UG/report.json`.
Full-suite log: `.cache/linked-project-folders-final-tests.log`.

Native picker results use deterministic fixtures. Operating-system dialog pointer
interaction is not certified. Native Windows and macOS checks remain deferred
until machines are available; they are not assigned to outside testers.
