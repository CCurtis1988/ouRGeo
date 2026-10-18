# Project Files: delivery record

Implementation date: 16 October 2026. Application version: 1.16.23. This record
separates implementation, measured checks and deferred qualification; the
[specification](project-files-spec.md) remains the original requirement baseline.
See the [user guide](project-files.md) for the normal workflows and
[adapter and benchmark evidence](project-files-validation.md) for processing limits.
The [Linked folders delivery record](linked-project-folders-implementation.md)
describes the subsequent 1.16.24 extension.

## Delivered behaviour

- A movable Project Files pane joins the Console/Terminal group. Existing layouts
  receive the panel while retaining their active panel and split/tab choice.
- Import requires a successfully saved, named project. Pane drops, native file
  selection and chat imports share one durable library. Imports preserve originals;
  duplicate bytes reuse an existing entry, and conflicting names are disambiguated.
- Users can search, filter, organise, describe, replace, export, remove and undo
  removal. Reindexing is local and preserves user-authored metadata. Native previews
  cover PDF pages, bounded images, Office structure, spreadsheet grids and text.
- Text/PDF/DOCX/XLSX/CSV adapters expose bounded evidence with real page, section,
  cell/range or source-line locations. Incomplete coverage is visible. Spreadsheet
  formulas retain cached results; hidden workbook contents require an explicit
  protected assistant selection. A separate human preview control grants no AI
  access.
- The existing context broker discovers metadata and searches local extracted
  contents on demand. It controls exclusions, source freshness, budgets and cited
  reads. Chat stores portable references rather than encoded image/file bodies.
  Citations open their source location and identify earlier revisions.
- Actual image delivery is qualified for native Ollama with `gemma4:e2b`.
  Unsupported/unverified routes report the limitation without silently changing
  models or dropping image evidence. Rendering and model disclosure remain separate.
- Originals and the portable catalogue live in a version-2 `.ourgeoproj`. Version-1
  projects remain readable. Streaming workers stage, verify and publish a complete
  save; unknown required schemas and damaged/missing originals are rejected.
  Archive conflicts preserve the destination. The previous R snapshot and memory
  survive a save when their current exports are unavailable.
- Journalled originals and metadata survive a crash before project save. Conflicting
  drafts can be recovered into an independently saved project copy. Save As forks
  project-qualified references and leaves local disclosure choices independent.
  An unexpected durability failure after publication reports a committed save
  with a warning and retains the pending draft and last confirmed baseline,
  including the source draft during Save As. A failed open does not replace the
  prior active file library.

Project-file management records readable information in the console. It does not
invent R operations for storage/indexing actions that do not execute R.

## Design decisions made during implementation

The embedded ZIP design and save-first prerequisite are unchanged. Original bytes
are stored without a second compression pass: already-compressed documents gain
little, and predictable save latency matters more. The archive remains compatible
with ZIP tools and is verified before atomic publication.

PDF.js, bounded OOXML adapters, `numfmt`, `yauzl` and `yazl` provide the required
formats. Extraction runs in supervised child processes with scrubbed environments,
restricted filesystem permissions, disabled network entry points and explicit
resource limits. These controls constrain the selected parsers; they are not an
OS sandbox for arbitrary hostile JavaScript. Derived indexes are encrypted with
the existing protected local key. Locked/unavailable protected storage pauses
assistant indexing/reads without a plaintext fallback; original export and human
preview remain available.

Automatic descriptions are factual, local extraction summaries. Optional
model-written descriptions, OCR, external links, embeddings, in-place document
editing and additional qualified vision transports remain follow-on work, as
allowed by the specification.

## Verification evidence

Final source checks passed: **272 test files / 2,710 tests**, TypeScript, the
production build and the Linux terminal-backend preflight. ESLint reported
**zero errors and 37 existing warnings**, with no warning increase. The complete
suite used two workers and took 127.45 s on the recorded host. The Linux directory
package was built with the installed Electron 41 distribution and its real ASAR
resources; this is a packaged executable check, not an installer/signing claim.

The repeatable native driver is `scripts/check-project-files.mjs`. It uses an
isolated, explicitly marked application profile and self-authored fixtures. It
checks save-first cancellation/success; every declared original type; real PDF
worker rendering on two pages; CSV/XLSX grid values and formulas; independent
human-only hidden previews; metadata editing; removal/undo; version-2 saving;
original-byte equality; fresh-profile reopening; narrow details and image preview.

`scripts/check-project-files-chat.mjs` drives the real Electron renderer, preload,
main IPC, parsers and production chat transport against a deterministic loopback
Ollama response fixture. Its ten checks passed with zero renderer errors: opening
a hidden assistant on attachment, exact native image payload bytes, deep text
retrieval, correct PDF citation navigation, rendered PDF-page image delivery,
unrelated turns without fresh library bodies/images, immediate shared-library
chat imports, cancellation after replacement, exclusions and portable saved chat.
This verifies wiring and bytes, rather than claiming that a synthetic provider
understands documents.

`scripts/check-project-files-vision.mjs` separately uses the existing configured
local `gemma4:e2b` through production message assembly and transport. It correctly
identified a self-authored red square left of a blue circle from actual image
bytes. The test does not transmit private project material. Reports omit endpoint
credentials.

`scripts/check-project-files-grounding.mjs` separately qualified text and spreadsheet
tool use with the existing local OpenAI-compatible `strata/Qwen3.6-35b` route and
an 8,192-token window. The actual model chose `context_search` then `context_read`
and correctly reported a 0.6 m requirement on physical page 80 and
`Measurements!G80 = 12.75`, citing the exact returned source URI. Each task used
three production inferences. These tasks use synthetic extracted-source adapters
with the production broker/tools/transport; native import, parsers, IPC and source
navigation have separate integration evidence. A repeat on the Ollama route failed
at model loading with HTTP 500 due to server resources, so it does not qualify
Ollama text/tool comprehension from that run or erase the earlier visual result.

Independent automated fixtures additionally cover late/stale results, parser
upgrades, bounded physical ranges, protected cached reads, visibility-policy races,
snapshot carryover, archive conflicts/corruption, required capabilities, cancellation,
crash recovery and Save As. Parser process checks exercise the installed Electron
Node runtime and an ASAR containing the actual parser dependencies and PDF worker.
Managed open-workspace regressions additionally cover removal of a 100 MiB
temporary snapshot, failed extraction cleanup, and shutdown waiting for workers
before deleting their outputs. Saved bundles and durable drafts are preserved;
renderer cleanup requests use window-owned opaque receipts rather than paths.

The final 250-file / 250-MiB backend workload completed import in 5.12 s, background
indexing in 40.00 s, save/verification in 3.49 s and reopen/verification in 1.62 s.
Warm search p95 was 110.6 ms. A separate 2,000-entry catalogue snapshot p95 was
24.4 ms. These figures are backend timings, not inferred DOM timings or a whole-app
memory claim; the validation document records host, corpus and sampling details.

Generated reports and inspected screenshots live under `.cache/project-files-review/`,
`.cache/project-files-chat/` and `.cache/project-files-qualification/`. They are
local verification artefacts, not dependencies required to open a project.

The final Linux ASAR package passed all 20 native library checks with zero renderer
errors (`run-GKuRIG`), including actual restricted child extraction, PDF worker
resources, byte-identical originals, a fresh application profile and verified
release of extracted R snapshots after loading. The test's
first polling attempt hit an expected old-lease response during named-project
creation; its retry now handles only that recognised transition response and
continues to fail other exceptions. No product guard was weakened.

The final development-renderer run (`run-eXRjjb`) passed all 20 library and UI
checks with zero renderer errors. Five measured warm pane openings took
32.3–33.5 ms. Rendering a synthetic 2,000-entry metadata catalogue took 61 ms,
with only 18 list rows mounted at either scroll extreme. Keyboard range selection,
moving/reopening the pane, actual layout preference write/read and resetting the
default tabs passed. All 20 shipped theme definitions were measured: pane text
contrast was at least 10.63:1 and controls/placeholders at least 12.36:1. The first
measurement exposed a light-theme placeholder at 2.35:1; the final run verifies
the corrected foreground token. These sampled controls do not constitute an
audit of every pixel in the application. The synthetic UI workload does not
pretend to import or index 2,000 originals.

## Acceptance coverage and limits

| Spec scenarios | Evidence and boundary |
| --- | --- |
| PF-01–02 | Native import/save/reopen and original hashes; backend save-first and failed-batch fixtures. Native picker outcomes are deterministic; operating-system dialog pointer interaction is not certified. |
| PF-03–04 | Default/migrated layout and attachment tests, native shared-library chat flows; moved/reopened placement, preference persistence and reset checks. Existing drag/layout persistence mechanisms are reused. |
| PF-05, PF-07 | Independent page-80, DOCX table, non-first-sheet, dates/formulas and coverage fixtures; native text/PDF citation and spreadsheet previews. |
| PF-06 | Native unrelated-message payload check plus broker budget tests; backend 250/2,000 catalogue workload. No claim that backend timings measure prompt tokens or pane latency. |
| PF-08 | Native exact-byte image/PDF payload checks plus separate real-model visual task. Only the recorded model/transport pair is qualified. |
| PF-09–10 | Revision/scope/exclusion fixtures, native replacement cancellation and historical citations; project-qualified Save As rebinding. |
| PF-11–13 | Journal recovery, preserved R/memory, staged verification failure, changed destinations, mutation-during-save, v1/v2/future/corrupt archive fixtures. These are controlled failures, not a claim to have simulated every filesystem/power-loss condition. |
| PF-14–16 | Incremental encrypted reuse, parser-version invalidation, metadata preservation, bounds, hostile archive/process and unavailable protected-key fixtures. |
| PF-17 | Native narrow/wide previews, measured warm opening, 2,000-entry virtualisation, keyboard selection and all 20 shipped theme definitions. Unmeasured event-loop and cancellation thresholds remain unqualified. |
| PF-18 | Existing context budget/compaction/tool-pair regression suite plus located-read, cursor, stale-image and attachment tests. Previous evidence already sent to a model remains subject to normal chat retention/compaction. |

Native Windows and macOS checks remain deferred by the owner. Linux evidence does
not establish Windows locks/UNC paths, macOS signing/keychain behaviour, or native
platform save durability. No outside testers or owner testing are required for the
Linux checks performed here. The spec's numerical UI/event-loop/cancellation
targets must be treated as unqualified wherever no measurement is recorded;
passing functional tests alone does not establish those latency targets.

## Reproduce

Use workspace temporary storage on hosts with a constrained `/tmp`:

```sh
mkdir -p .cache/tmp
TMPDIR="$PWD/.cache/tmp" npm run typecheck
TMPDIR="$PWD/.cache/tmp" npm run lint
TMPDIR="$PWD/.cache/tmp" npm run test -- --maxWorkers=2
TMPDIR="$PWD/.cache/tmp" npm run build
TMPDIR="$PWD/.cache/tmp" node scripts/check-project-files.mjs
TMPDIR="$PWD/.cache/tmp" node scripts/check-project-files.mjs --dev
TMPDIR="$PWD/.cache/tmp" node scripts/check-project-files-chat.mjs
# After packaging, pass the real application executable:
TMPDIR="$PWD/.cache/tmp" node scripts/check-project-files.mjs --packaged /path/to/ourgeo
```

Native drivers require a working desktop display and permission to launch Electron
and fixture HTTP servers. Profiles and synthetic bundles remain isolated from the
user's normal ouRGeo data. The real-model scripts additionally require the already
configured authorised local endpoint; ordinary library use does not.
