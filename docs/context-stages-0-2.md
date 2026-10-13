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
The owner retained the closure requirements, then deferred independent corpus/
quality review and the representative-participant study because no team is
available. They will revisit them if reviewers become available. These gates
remain open and stages 0–2 are not certified. See `context-qualification-review.md`.

The owner's subsequent direction is to finish implementation while retaining
deferred testing. The 1.16.17 [local-runtime follow-up](context-stage02-offline-fix.md)
resolves the outstanding IPv6-probe and opaque-I/O engineering issues. The built-in
Linux phase 0–2 implementation is complete for the stated supported behaviour;
release qualification remains open. This is a distinction between code delivery
and required evidence, not a waiver of the existing closure requirements.

`Verified` means evidence exists for the stated boundary. `Remaining` means the
requirement or its release evidence is incomplete. Synthetic fixtures do not
establish model task quality, supported-platform certification or usability.

| Stage | Requirement and evidence | Status |
| --- | --- | --- |
| 0 | Legacy/new prompt accounting, synthetic context-free and descriptor/console scale fixtures (`scripts/benchmark-context.mjs`, broker tests) | Verified for local synthetic fixtures |
| 0 | Packaged Electron worker SQLite/FTS5; canonical/index/WAL/temp protection; migration backup and wrong-key refusal | Verified on Linux x86_64 with kwallet6; Windows/macOS deferred to their native sessions |
| 0 | Canonical provider API pins and isolated dependency/deletion/network spikes | Prototype evidence available; not production certification |
| 0 | Versioned mixed 20-turn inference accounting (`scripts/evaluate-context.mjs`) | Scripted development fixtures estimate 51% lower total input; live hosted development comparison measured 43.1% lower reported input including retrieval; local comparison has empty answers/missing counters; independent quality and invoice gates remain |
| 1 | Compact base contract and schemas; zero auxiliary context/fetches on unrelated synthetic turns; local routing | Verified in unit and real Electron fixtures |
| 1 | Skills/actions/docs/live metadata/console/editor/conversation discovery; scoped search/read, revisions, prerequisites and revocation | Verified covered fixtures; held-out recall/precision and multilingual corpus remaining |
| 1 | Per-invocation conservative budgets, structured large results and valid tool compaction | Verified covered full-message transport fixtures |
| 1 | Rejected context-size reconstruction once without tool replay, preserving user instructions and tool pairs | Implemented; regression tests cover recovery boundaries |
| 1 | Retained transport session occupancy, upstream compaction acknowledgement and safe reconstruction | Per-call occupancy, compaction/failure acknowledgement and conservative reconstruction verified in mocked CLI tests; opaque internal invocation certification remaining |
| 1 | Inspector selected/sent distinction and effort controls | Verified in real Electron; Explicit current-descriptor available/excluded browsing verified in real Electron |
| 1 | Source/column disclosure controls, progressive explicit attachments and opt-in authorised folder indexing | Source exclusions, staged attachments and bounded large-document ranges implemented; Encrypted saved-project column policies and explicitly chosen bounded folder indexing verified in real Electron; scratch-to-project/fork transfer covered in integration logic/unit fixtures |
| 1 | Local routing/retrieval latency and resident-memory targets at full corpus size | Packed/default-adapter and native normal-layout fixtures cover 10,000 objects / 100,000 console events / 100,000 document buffers / 200 plugins. Filtering, bounded tab/console rendering and allocation-free ASCII summary matching resolve observed failures. Final 1.16.17 normal-layout development run at the declared 1120×900 viewport passes: p95 88.0–186.1 ms, additional manager 61.1 MiB, no schema reads or auxiliary sources on unrelated turns; first/last tabs, older/multiline console output and complete-history copying verified. Production file ingestion, other panel combinations and transient pre-GC peaks remain outside this certificate |
| 2 | Project UUID/forks/import tombstones; committed portable JSONL and dirty draft save/discard/recovery | Verified covered unit and Electron fixtures |
| 2 | Conversation/project/global isolation, explicit local commands, scoped preferences/supersession, suggestions and suppression | Verified covered fixtures; 1.16.16 adds local conversation-memory CRUD/moves, portable validation, chat isolation and current-correction delivery |
| 2 | Deterministic source-linked working state from originals | Implemented; early/latest exact constraints and atomic persisted tool exchanges covered by regression tests; live compacted hosted probe preserved exact constraints but its generated code failed a CRS type check; model-quality gate remains failed/unverified |
| 2 | Canonical forgetting and deletion of solely chat-derived memories; reset retained sessions | Verified covered fixtures; Reviewed current-workspace transcript-copy removal verified in real Electron |
| 2 | Durable content-free local purge intention, restart retry, bounded failures, manual recovery and stale receipt protection | Verified in regression and real Electron failure/repair fixtures |
| 2 | Retention/expiry sweeps and cache/trace limits; recoverable storage restore and disk-full handling | Bounded canonical sweeps, 30-day candidate expiry, 180-day inferred review and 1–7-day diagnostic expiry verified; healthy-store candidate/journal restore, readonly backup verification and native SQLite disk-full rollback covered; authenticated current-row usage-index repair preserves damaged original files and canonical/deletion rows; unsupported canonical damage fails closed for readonly inspection |
| 2 | Per-turn/project total inference cost and maintenance accounting | Estimated-budget implementation complete under specification section 10.6: protected content-free receipts/reservations survive deletion/restart; scoped callbacks and available counters reconcile once; frozen-price daily/monthly limits refuse missing/stale rates, unresolved unpriced requests and opaque processing. Unavailable historical/provider counters remain unknown. Provider invoice/internal-occupancy qualification remains open; no hard invoice cap or unsupported provider billing retrieval is promised |
| 0–2 | Scope/concurrency/adversarial gates, quantitative provenance, comparable task quality and human review | Covered deterministic fixtures exist; repaired-schema/historical-join delivery verified in real Electron. Independent corpus/quality review deferred by owner pending reviewers; known model failures retained |
| 0–2 | Supported platform packaging/protection/offline tests and usability | Windows/macOS deferred by owner. 1.16.17 actual FUSE-mounted acceptance, private GTK launch/local memory/removal, and isolated Debian 1.16.16→1.16.17 install/upgrade/installed-binary acceptance/removal/profile preservation pass. A separately booted Debian desktop and associations remain unverified. Dictionary requests and local Chromium route probes are eliminated. Complete packaged process-tree audit passes: zero external attempts, 837 fully observed readiness-only ring calls, zero opaque operations; direct and hidden ring-connect canaries detect/reject networking. Shared desktop services remain outside capture. Owner observations preserved; representative-participant validation deferred pending a team and remains required |

External provider deployment certification, provider migration, native runtime
platform certification, dynamic plugin/provider SDK certification and optional
semantic downloads belong to subsequent stages. They do not close these gaps.

Do not mark stages 0–2 complete until every applicable remaining row has its
implementation and evidence, or an explicit product decision changes the target.

The [1.16.16 owner follow-up](context-stage02-owner-followup.md) preserves owner
fixes and live model observations; the [1.16.17 runtime follow-up](context-stage02-offline-fix.md)
records the final implementation fixes and verification. Do not
interpret token reduction or a completed response as a task-quality pass.
