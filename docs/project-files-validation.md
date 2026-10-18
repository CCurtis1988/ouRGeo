# Project Files: implementation validation

Recorded on 16 October 2026. These results cover the implemented library and its
document adapters. Native Windows and macOS verification remains deferred. Linux
unit, process and synthetic ASAR checks do not establish native qualification on
those platforms.

## Document adapters and parser process

The pinned runtime dependencies are PDF.js (`pdfjs-dist` 6.4.299, Apache-2.0),
`fast-xml-parser` 5.11.2 (MIT), `yauzl` 3.4.0 (MIT), and `numfmt` 3.2.6 (MIT).
Bundle writing uses `yazl` 3.3.1 (MIT). Structural DOCX/XLSX adapters read bounded
OOXML parts directly; they retain paragraph/table and sheet/cell locations.
Unknown workbook number formats retain raw values and report incomplete display
coverage. Formula results remain cached evidence; no formula is recalculated.

Original bytes are read by a separate, supervised Node process. Its environment
contains only the Electron Node-mode flag, production mode, UTC timezone and a
locale. Node permissions grant reads of the managed original and runtime code;
filesystem writes, child processes, native addons and worker threads are denied.
Electron's embedded Node 24 does not enforce network permissions, so the worker
also disables fetch, socket, HTTP, TLS, datagram and ordinary DNS entry points.
OOXML relationships never trigger filesystem or network reads. PDF.js receives
bytes directly, with no external font/CMap locations, system fonts or WASM;
PDF.js 6 has removed the earlier eval-based font path. These controls constrain
the trusted parsers' access; they are not an operating-system sandbox for
arbitrary malicious JavaScript.

Managed originals and journals sync their containing directories after file
rename where supported, before acknowledging an import. Bundle saves compute
the verified staged signature before publication. An unexpected directory-sync
failure after publication returns success with an explicit durability warning;
it retains the prior confirmed journal baseline and, for Save As, both working
drafts. A reverted archive after power loss can therefore recover pending files.
Tests inject directory I/O failure, cancellation during publication and a failed
new-project journal to verify committed outcomes and preservation of the prior
active library.

Fixed adapter limits are:

| Work | Limit |
| --- | --- |
| Parser duration | 45 seconds |
| V8 old-generation heap | 384 MiB |
| Linux process RSS | 640 MiB, sampled every 200 ms |
| Parser concurrency | At most two processes; current library background indexing is sequential |
| Original | 100 MiB |
| Office expansion | 256 MiB actual aggregate inflated bytes |
| Individual Office XML part | 32 MiB |
| Office entries | 10,000 |
| Extracted text | 20 MiB per original |
| PDF pages | 2,000 |
| Workbook cells | 100,000 |
| Worker response | 24 MiB serialised response |

Heap, time, output and input limits apply on all platforms. RSS supervision is
currently Linux-specific. Archive size checks count actual streamed bytes and
reject inconsistent size claims, unsafe paths, links and conflicting entries.
Originals survive parser failure or cancellation. Hidden workbook sheets, rows
and columns are omitted by default; explicit inclusion travels through a
separate protected selection and index revision.

The parser process tests execute the installed Electron 41 / Node 24.14 runtime
and a synthetic `app.asar` containing the actual parser, XML/ZIP/number-format
dependencies and PDF.js module/worker. Both extract independently specified PDF
text. ASAR virtual directories require explicit descendant read grants; the
process client supplies these without granting the parent resources directory.
No additional unpacked parser runtime is required by this verified Linux path.

## Automated evidence

`electron/main/project-files/` contains independent fixture tests for:

- UTF-8 lines, rejected encodings, CSV/TSV quoting, multiline physical locations,
  leading zeros and literal delimiters inside quoted values.
- PDF text found on physical page 80, mixed text/image-only pages, encrypted
  documents and truthful coverage.
- DOCX headings, lists and table-cell structure, hidden/deleted runs, omitted
  unsupported structures, disabled XML entities and archive size conflicts.
- XLSX non-first-sheet evidence, raw/type/display/formula values, 1904 date
  interpretation, blank cells, merged ranges, default hidden-content exclusion
  and explicit inclusion.
- Credential scrubbing, denied unrelated filesystem reads, cancellation of
  active/queued parsers, fresh parsing after cancellation and synthetic ASAR
  dependency/worker resolution.
- v1/v2 archive roundtrips, native original bytes, retained R environment/memory,
  missing/corrupt/unreferenced/future entries, external destination conflicts and
  preservation of the previous save after staged verification failure.
- Named-project prerequisites, queued imports, deduplication, batch failures,
  revision checks, descriptions preserved through replacement/reindex, encrypted
  cache reuse, crash recovery, recovery into an independent copy, mutations made
  during save, exact range reads and original checksum verification.

Run the parser subprocess checks outside execution environments that prohibit
spawning Node, using workspace temporary storage if `/tmp` is constrained:

```sh
mkdir -p .cache/tmp
TMPDIR="$PWD/.cache/tmp" npx vitest run electron/main/project-files/ --maxWorkers=1
```

PDF process tests allow up to 60 seconds for test setup and shutdown under host
load; each actual parser still has its independent 45-second production limit.

An npm advisory query returned 57 pre-existing repository findings. No advisory
in that report named the chosen pinned parsers, ZIP writer, or their newly
introduced dependency chains. This records the advisory query at implementation
time, rather than claiming that the wider dependency tree is vulnerability-free.

## Reference workload

The reference run used 250 distinct UTF-8 originals of exactly 1 MiB each
(250 MiB total), real managed imports, production restricted child extraction,
encrypted derived indexes, full bundle save and reopen. One independently placed
rare requirement appeared 80% through one original and had to be found uniquely.
Generated files were fresh; their OS page-cache pages were warm after generation.
The derived extraction cache was initially absent. Search and catalogue samples
use 21 repetitions.

Host: Linux `7.2.8-zen1-2-zen`, Intel Core i5-11500H at 2.90 GHz, 12 logical CPUs,
15,709 MiB physical memory, Node 26.10.0. The final-source run was recorded at
2026-10-17 05:18 UTC (16 October, 22:18 PDT), after the complete frozen-source
suite passed 271 suites / 2,707 tests and the final production build completed.
The benchmark includes the final directory-sync and journal-retention changes.
The host was not reserved exclusively for the benchmark.

| Backend operation | Measured result |
| --- | --- |
| Import 250 MiB | 5.12 s |
| Background indexing after import | 40.00 s |
| First indexed search | 128.6 ms |
| Warm indexed search | Median 90.0 ms; p95 110.6 ms |
| 250-file catalogue snapshot | Median 0.027 ms; p95 0.052 ms |
| 2,000-entry catalogue snapshot | Median 17.2 ms; p95 24.4 ms |
| Save 250 MiB bundle, including verification | 3.49 s |
| Reopen 250 MiB bundle, including verification | 1.62 s |
| Benchmark parent peak RSS | 517 MiB |

The 2,000-entry catalogue is a separate valid metadata workload referencing one
small shared blob; it measures the actual catalogue API without a second large
indexing workload. RSS samples cover the benchmark parent, not the sum of parent
and parser processes. The benchmark runs the backend bundle functions in its
own process; the application dispatches those functions through a worker.

These are backend measurements. They do not establish pane/DOM opening latency,
arbitrary PDF/Office throughput or whole packaged-application performance. The
warm indexed-search result meets the spec's 500 ms p95 target on this corpus.
UI timing and native platform qualification need separate evidence.

Reproduce after building the application:

```sh
node_modules/.bin/esbuild scripts/benchmark-project-files.ts \
  --bundle --platform=node --packages=external \
  --outfile=.cache/benchmark-project-files.cjs
TMPDIR="$PWD/.cache/tmp" node .cache/benchmark-project-files.cjs
```

The script writes `.cache/project-files-benchmark.json` and removes its generated
originals, working library and bundles. Optional `OURGEO_BENCH_FILES` and
`OURGEO_BENCH_FILE_BYTES` environment variables support smaller diagnostic runs.

Primary dependency/runtime references:
[PDF.js](https://mozilla.github.io/pdf.js/),
[fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser),
[yauzl](https://github.com/thejoshwolfe/yauzl),
[numfmt](https://github.com/borgar/numfmt),
[Node permissions](https://nodejs.org/api/permissions.html), and
[Electron ASAR support](https://www.electronjs.org/docs/latest/tutorial/asar-archives).
