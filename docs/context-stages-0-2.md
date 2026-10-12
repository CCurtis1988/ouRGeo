# Context delivery: stages 0–2 closure checklist

Priority: finish these stages before new provider/plugin feature work. This is
requirement coverage, not a release certificate or a percentage based on tests.
The full specification and `context-implementation.md` remain authoritative.

Current owner decision: close the **Linux** version first. Windows 11 and macOS
acceptance will run in later sessions on those machines and are deferred from the
current platform target. See `context-platform-acceptance.md` for the handoff.
The owner will perform the Linux manual acceptance tests personally, using
`context-owner-acceptance.md`. No independent usability results exist. Owner
acceptance is the current Linux usability handoff; the representative-participant
study remains unverified and separately tracked. Independent model-quality and
full offline/installer evidence are not established by owner acceptance.

`Verified` means evidence exists for the stated boundary. `Remaining` means the
requirement or its release evidence is incomplete. Synthetic fixtures do not
establish model task quality, supported-platform certification or usability.

| Stage | Requirement and evidence | Status |
| --- | --- | --- |
| 0 | Legacy/new prompt accounting, synthetic context-free and descriptor/console scale fixtures (`scripts/benchmark-context.mjs`, broker tests) | Verified for local synthetic fixtures |
| 0 | Packaged Electron worker SQLite/FTS5; canonical/index/WAL/temp protection; migration backup and wrong-key refusal | Verified on Linux x86_64 with kwallet6; Windows/macOS deferred to their native sessions |
| 0 | Canonical provider API pins and isolated dependency/deletion/network spikes | Prototype evidence available; not production certification |
| 0 | Versioned mixed 20-turn inference accounting (`scripts/evaluate-context.mjs`) | Scripted development fixtures estimate 51% lower total input; live multi-transport quality/cost baseline remaining |
| 1 | Compact base contract and schemas; zero auxiliary context/fetches on unrelated synthetic turns; local routing | Verified in unit and real Electron fixtures |
| 1 | Skills/actions/docs/live metadata/console/editor/conversation discovery; scoped search/read, revisions, prerequisites and revocation | Verified covered fixtures; held-out recall/precision and multilingual corpus remaining |
| 1 | Per-invocation conservative budgets, structured large results and valid tool compaction | Verified covered full-message transport fixtures |
| 1 | Rejected context-size reconstruction once without tool replay, preserving user instructions and tool pairs | Implemented; regression tests cover recovery boundaries |
| 1 | Retained transport session occupancy, upstream compaction acknowledgement and safe reconstruction | Per-call occupancy, compaction/failure acknowledgement and conservative reconstruction verified in mocked CLI tests; opaque internal invocation certification remaining |
| 1 | Inspector selected/sent distinction and effort controls | Verified in real Electron; Explicit current-descriptor available/excluded browsing verified in real Electron |
| 1 | Source/column disclosure controls, progressive explicit attachments and opt-in authorised folder indexing | Source exclusions, staged attachments and bounded large-document ranges implemented; Encrypted saved-project column policies and explicitly chosen bounded folder indexing verified in real Electron; scratch-to-project/fork transfer covered in integration logic/unit fixtures |
| 1 | Local routing/retrieval latency and resident-memory targets at full corpus size | Packed/default-adapter benchmarks cover the full corpus. Native Electron context-browser fixture now covers 10,000 objects / 100,000 console events / 100,000 document buffers / 200 plugins: warm search-handler p95 below 200 ms, additional manager resident memory below 150 MiB, no schema reads or auxiliary context on unrelated turns. Other panes are suppressed in this synthetic fixture; whole-app rendering and transient pre-GC peaks are not certified. See the version 1.16.14 follow-up evidence |
| 2 | Project UUID/forks/import tombstones; committed portable JSONL and dirty draft save/discard/recovery | Verified covered unit and Electron fixtures |
| 2 | Conversation/project/global isolation, explicit local commands, scoped preferences/supersession, suggestions and suppression | Verified covered fixtures |
| 2 | Deterministic source-linked working state from originals | Implemented; early/latest exact constraints and atomic persisted tool exchanges covered by regression tests; complete long-conversation model-quality gate remaining |
| 2 | Canonical forgetting and deletion of solely chat-derived memories; reset retained sessions | Verified covered fixtures; Reviewed current-workspace transcript-copy removal verified in real Electron |
| 2 | Durable content-free local purge intention, restart retry, bounded failures, manual recovery and stale receipt protection | Verified in regression and real Electron failure/repair fixtures |
| 2 | Retention/expiry sweeps and cache/trace limits; recoverable storage restore and disk-full handling | Bounded canonical sweeps, 30-day candidate expiry, 180-day inferred review and 1–7-day diagnostic expiry verified; healthy-store candidate/journal restore, readonly backup verification and native SQLite disk-full rollback covered; authenticated current-row usage-index repair preserves damaged original files and canonical/deletion rows; unsupported canonical damage fails closed for readonly inspection |
| 2 | Per-turn/project total inference cost and maintenance accounting | Available-receipt conversation/project token aggregates and maintenance reservation foundations implemented; encrypted content-free usage ledger survives deletion/restart and is wired to active-turn accounting; queued/final switched-scope receipts covered by regression tests; atomic pre-dispatch receipts and frozen-price daily/monthly estimated chat ceilings implemented; cancellation/restart/UTC rollover retain unresolved reserves, reported cache/reasoning counters reconcile once, missing/stale pricing and opaque subscription processing refuse dispatch. Earlier trace-free activity, provider billing retrieval after restart and invoice-cap certification remain open |
| 0–2 | Scope/concurrency/adversarial gates, quantitative provenance, comparable task quality and human review | Covered deterministic fixtures exist; full evaluated corpus and release report remaining |
| 0–2 | Supported platform packaging/protection/offline tests and usability | Windows/macOS deferred by owner. Standard Linux packages build outside the sandbox; disposable portable AppImage copy/extract/launch/removal verified. FUSE mounting, desktop integration and Debian installation remain untested. Startup/descendant offline operation succeeds, but a syscall audit detects external DNS/route-probe connects and cannot certify opaque kernel I/O queues; strict network gate remains open. Linux owner acceptance awaits the seven-test results form; representative-participant validation is separately unverified |

External provider deployment certification, provider migration, native runtime
platform certification, dynamic plugin/provider SDK certification and optional
semantic downloads belong to subsequent stages. They do not close these gaps.

Do not mark stages 0–2 complete until every applicable remaining row has its
implementation and evidence, or an explicit product decision changes the target.
