# Context and memory implementation status

This is the delivery record for [the specification](context-management-spec.md).
The full specification is **not complete or release-certified**. The default
local broker and the controls described below are implemented; optional provider
external adapters remain prototypes; connection reachability alone grants no
retrieval/ingestion authority. The reviewed experimental Linux managed profile
supports separately approved future updates, selected committed-memory imports
and broker recall with authorised local fallback.

The 1.16.18 [plugin context SDK](context-plugin-sdk.md) adds separately approved
declarative and dynamic own-resource sources, on-demand Markdown reads,
revision/revocation enforcement and update permission renewal. Runtime/data
recovery validates each pair's installation record before rollback health.
Stage 3–4 progress and the remaining deployment/migration/SDK qualification gates
are recorded in [the delivery checklist](context-stages-3-4.md).

Built-in Linux stage 0–2 engineering closed in 1.16.17. Their unwaived release
qualification requirements and evidence boundaries remain in
[the closure checklist](context-stages-0-2.md). The owner has advanced delivery to
[stages 3–4](context-stages-3-4.md); provider/plugin work does not close deferred
quality, usability or platform gates.

## Available in this working tree

- Selective prompt assembly with a stable application contract, current scope
  card, compact schemas and Efficient/Balanced/Thorough retrieval limits.
  A fresh dummy-data request does not inspect R, console history, documents or
  an external memory provider.
- Provider-neutral `context_search`, `context_read`, `context_remember` and
  `context_forget`; scoped opaque references, bounded pages, time filters,
  revision checks and permission checks at read/send/action boundaries.
- On-demand application documentation, document guidance and action schemas.
  Broad action discovery is paginated. Theme/document prerequisites must reach
  an invocation before a consequential action runs. Declarative plugin skills
  contribute namespaced summaries, aliases, exclusions and prerequisites;
  disable/update cancels active context work and resets retained sessions.
- Current R schema inspection, without samples, print methods, active bindings,
  unforced promises or lazy database materialisation. Every R execution
  invalidates schema observations even if dimensions stay the same. Actual
  computations still use visible, permission-controlled R execution.
- Console execution retrieval now maintains an incremental immutable-event index.
  Unchanged snapshots reuse execution descriptors; appends update affected
  executions, audit-only appends do not change evidence, and clear/replacement or
  workspace/R-generation changes invalidate descriptors. Full console bodies
  are formatted on read instead of duplicated during discovery. Older descriptors
  preserve their event range; broker freshness checks reject superseded handles.
- Open-buffer document ranges, supported read-only
  snapshots of active Visual documents and authorised conversation search.
  Saved projects can search their other chats; scratch can search only the
  current chat. Individual messages are discoverable beyond the first chat
  summary.
- Provider-reported input/output/cache/reasoning counters are recorded separately
  from estimated prompt occupancy for each host invocation. Stream observations
  reconcile cumulatively rather than adding every delta. Failed/cancelled turns
  retain available receipts on their initiating message or partial answer; scope
  changes cannot attach them to another workspace. Claude CLI reports aggregate
  run usage, with unconfirmed internal invocation counts. Missing counters and
  monetary costs remain unknown. Provider semantics are checked against
  [OpenAI](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create),
  [Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
  and [Gemini](https://ai.google.dev/api/generate-content#UsageMetadata) documentation.
  This does not yet implement project monetary totals or spend reservation.
- Conservative per-invocation token checks on hosted and local tool loops.
  Deterministic conversation selection retains original user instructions.
  When older replies are omitted, a bounded derived working-state card carries
  exact user constraints, declared decisions, referenced entities, questions to
  check and attributed failed attempts, with original message IDs. It is rebuilt
  from originals and does not resolve conflicting declarations or promote facts.
  Completed older tool results can be compacted without changing call IDs,
  arguments or the latest result batch. Originals remain in a bounded,
  one-hour, in-memory cache for the same chat/scope. No result blobs enter a
  project manifest or `session.json`.
- Context inspector, effort controls, Conversation/Project/About you library,
  explicit memory creation, correction, scope movement, readable clipboard
  export, forgetting, and separately budgeted Always apply instructions.
- Explicit remember/forget commands and simple saved-project instructions are
  fulfilled locally without model inference or an assistant API key. Project
  instructions await Save. Narrow conflicting unit-system/English preferences
  supersede earlier records in their own scope; suggestions do not replace
  active instructions. Category routing finds units/CRS conventions without
  adding memories to unrelated synthetic or general-R turns.
- Encrypted, profile-local source exclusions. Project choices do not cross
  project boundaries or travel in bundles; scratch choices are transient.
  Earlier assistant answers are omitted from future prompts while exclusions
  apply, preserving original user messages. Generic assistant execution that
  could bypass a private-source filter is paused; theme actions and ordinary
  GUI/R use remain available. The inspector distinguishes selected evidence
  from excerpts included in an actual invocation and marks uncertain delivery.
- Suggestion policies and opt-in automatic learning for narrow, user-declared
  units, communication/output preferences and project decisions. There is no
  paid extractor. Scratch learning is separately opt-in. Suggestions are not
  retrieved before acceptance and expire after 30 days. Content-free source
  suppression markers prevent immediate relearning after dismissal/forgetting.
- UUID project identities; Save As forks identity and active memory records
  while preserving lineage. Project memory drafts are dirty changes and use
  an encrypted recovery journal bound to the saved revision. Bundle saves
  atomically include portable `context/project-memory.jsonl`; imports respect
  newer local deletion tombstones. Remote credentials/bindings are not imported.
- A protected local location registry distinguishes renamed/moved bundles from
  two surviving files with the same UUID. Duplicate opens offer the original
  identity, an independent copy, or cancellation. Copies filter deletion
  tombstones before generating new memory IDs and require saving their identity.
- Serialised project save/open/reset operations prevent overlapping R loads.
  A protected local registry preserves previously authorised editor/database
  links on the same profile. Imported or substituted absolute paths use bundled
  editor text and require choosing local database files. Malformed chats and
  quarantined memory records produce visible recovery notices.
- Encrypted transactional outbox primitives: approved certified bindings only,
  one primary per scope, stable operation IDs, bounded backoff, expiry,
  uncertain-ingestion reconciliation and late-write deletion compensation.
  A bounded runner now fixture-tests scoped delivery, revision-based read-only
  reconciliation, cancellation and late billed receipts. It is not activated
  against an uncertified connection. Successful bundle saves commit scoped canonical project records and
  queue only active committed revisions. Candidates and unsaved project journals
  never enqueue ingestion. Older conflicting copies cannot overwrite a newer
  canonical revision; a visible save warning points to opening an independent
  copy. Edits arriving during a save retain a journal against the new base.

## Storage decision and platform evidence

The built-in durable store uses Electron's Node `node:sqlite` in a worker thread,
with transactional SQLite records and FTS5. Canonical global/committed-project
records and project recovery journals are AES-256-GCM encrypted with per-record authenticated IDs.
The database, WAL and disk temporary files contain encrypted payloads. The FTS
database and its temporary pages exist only in memory. Before a schema migration,
the worker validates the old key and creates a consistent encrypted-payload
SQLite snapshot, including committed WAL data. It verifies the snapshot before
the transactional migration; wrong keys, damaged stores and unavailable recovery
directories do not advance the schema. Recovery copies remain under the private
context directory and need the same OS-protected key. They can contain earlier
memories; full restore must reconcile newer deletion records before retrieval.
This is application-level
encryption, **not a claim that ordinary SQLite files are encrypted**.

The encryption key is protected by Electron `safeStorage`. Linux `basic_text`
is refused; unavailable/corrupt key storage does not generate a replacement key
over an existing store. A fresh profile with no protected context files can use
reference/workspace retrieval without a keyring. If protected policy files exist
but cannot be read, retrieval stays disabled rather than treating exclusions as
empty. Startup waits for local settings and pinned personal instructions, with
cancellation and a bounded wait; unavailable personalisation is shown in the
inspector. Project JSONL exports and portable bundles are readable files.
Deletion removes future retrieval and managed logical copies, not physical SSD
sectors, backups or an assistant service's independent retention.

| Platform/profile | Delivery evidence |
| --- | --- |
| Linux x86_64, repository Electron, kwallet6 | Built worker launched in the real app; create/edit/delete, encrypted DB/WAL, FTS5 and reopen/recovery fixtures verified |
| macOS, Windows and other Linux keyrings/architectures | Not certified; packaging, backup/restore and protected-storage checks remain required |
| Unavailable keyring or Linux basic_text | Fail closed for durable personal memory; no plaintext fallback |

## Provider prototypes and pinned API research

Chat deletion reviews the number of memories supported solely by that chat and
forgets them before removing the transcript. Edited/pinned records can be kept
deliberately; shared evidence and manually added records remain independent.
Partial storage failures retain the chat for review, while completed deletions
stay excluded. A non-empty chat cannot be deleted while protected memory is
unavailable unless main verifies there is no local store. Scope/transcript/memory
revision checks prevent a late deletion from attaching to a newly opened
workspace. The memory library displays source chat titles or source unavailability
and renders records in pages of 50.

The typed adapter SDK and bounded host transport are under
`src/lib/context/providers/` and `electron/main/context/providers/`. They are
not registered as production provider choices. No user data was sent to either
upstream during the spike.

| Adapter | Reviewed immutable source | Prototype limits |
| --- | --- | --- |
| Mnemosyne | Canonical mnemosyne-oss/mnemosyne commit `e871f39480b9b9156faa4396162f7ec1f3b11525`: engine v4.0.0b4, Hermes plugin v0.7.4 | Read-only MCP read/probe with explicit bank and protocol/session negotiation. Recall requires verified local processing or explicit external-processing approval. Writes, export and deletion are refused until their identity/deletion semantics are certified. Managed stdio is a candidate, not an enabled provider. |
| Hindsight | Canonical vectorize-io/hindsight v0.10.2, commit `5fc4ce20917b916240cef27c212c387a177f115b` | Retain/recall/read/delete/reflect translation; paid-processing approval required for recall/retain/reflect. Source receipts, bank/revision read checks, bounded evidence, temporal filtering and policy revocation are fixture-tested. Scoped connection settings and health probes exist; deployment/version/isolation/deletion certification remains pending. |

API evidence: [Mnemosyne pinned source](https://github.com/mnemosyne-oss/mnemosyne/tree/e871f39480b9b9156faa4396162f7ec1f3b11525),
[Hindsight pinned OpenAPI](https://github.com/vectorize-io/hindsight/blob/5fc4ce20917b916240cef27c212c387a177f115b/hindsight-docs/static/openapi.json),
[MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).
These source pins are not certified installable profiles. The pinned engine is
a beta, despite the separate stable-looking Hermes plugin tag; the
[upstream release channels](https://github.com/mnemosyne-oss/mnemosyne/releases)
and [engine version](https://github.com/mnemosyne-oss/mnemosyne/blob/e871f39480b9b9156faa4396162f7ec1f3b11525/mnemosyne/__init__.py)
are recorded separately. It is excluded from the default profile.

The pinned [Beam recall implementation](https://github.com/mnemosyne-oss/mnemosyne/blob/e871f39480b9b9156faa4396162f7ec1f3b11525/mnemosyne/core/beam.py)
can compute query embeddings even with `vec_weight=0`; weights select ranking,
not processing destinations. The adapter defaults to refusing unverified recall.
Local-only certification must disable embedding/cloud fallbacks independently
and observe the runtime's network behaviour. A tier-specific delete receipt alone
does not certify removal of every extracted derivative.

### Managed-runtime packaging spike

`runtime-catalogue.ts` records candidate hashes for the pinned Mnemosyne source,
PyYAML 6.0.3 and private CPython 3.12.15 distributions from the immutable
[Python Build Standalone 20261003 release](https://github.com/astral-sh/python-build-standalone/releases/tag/20261003).
Only Linux x86_64 has been exercised; macOS/Windows entries are metadata,
not certified installers. No system Python, pip installation or downloaded
embedding model was used. The required PyYAML dependency runs from its verified
source in the private process.

`runtime-archive.ts` verifies checksums before and after staging, bounds compressed,
decompressed and materialised bytes, rejects traversal/platform aliases/special
entries, and copies checked internal aliases as ordinary files. It does not
create links. The Linux distribution contains case-distinct terminfo entries;
its profile verifies the target filesystem supports them. Parser advisories were
checked and the archive dependency is pinned to tar 7.5.22.

After downloading the three catalogue artifacts to their documented `/tmp`
fixture paths, `node scripts/spike-context-mnemosyne.mjs` creates an isolated
temporary runtime and runs synthetic health checks. The current Linux result
has a 216,725,378-byte staged footprint (including source, dependencies and test
data), about one second for initialisation/operations, FTS5, separate scope
databases, stable distinct IDs for duplicate content, correction and working-tier
deletion. The Python audit hook observed no socket attempts. A separate Linux
run traced network syscalls across four private-runtime launches, including
health, search/read, restart, interrupted rebuild and deletion. It observed zero
network syscalls; a socket-only positive control was detected. This is fixture
evidence, not an install-size promise, a process sandbox or complete
derivative-deletion certification. Its provider database is readable SQLite;
canonical application encryption does not encrypt it.

`runtimes.ts` supplies lazy, deduplicated startup, a profile readiness handshake,
bounded stdio, idle shutdown, operation cancellation and bounded process shutdown.
The child gets a minimal environment and no inherited model credentials or
proxy/Python settings. `mnemosyne-sidecar.py` fixes the dedicated configuration
before loading upstream code (its YAML settings otherwise override environment
flags). Search/read use canonical IDs/revisions; host-only replacement snapshots
rebuild the entire derived database and activate it atomically. A stale snapshot
cannot replace a newer generation. The private-runtime fixture verifies isolated
scopes, retries, corrections, restart, interrupted rebuild recovery and removal
from subsequent retrieval. These checks do not certify physical erasure or a
complete upstream deployment.
The managed adapter can additionally accept a host-only canonical snapshot port.
Its upsert/delete receipts use committed canonical records, full derived-index
replacement and monotonic worker-owned scope generations. Reads reject mismatched
generations, revisions or invented provider prose. Suggestions and unsaved project
journals are excluded. The synthetic private-runtime spike exercises adapter
writes, retries, corrections, restart and deletion while preserving unrelated
records. The experimental Linux profile is now wired to scoped activation and
future committed updates and selected imports; managed recall now contributes
current canonical matches to the broker.

Settings now exposes explicitly acknowledged experimental staging on Linux
x86_64. Downloads use immutable checksums, bounded sizes, approved destinations
and conditional resume. An exclusive installation lease prevents competing
staging; interrupted staging is recoverable. Synthetic health precedes atomic
runtime/data-pair activation, with a separate previous pair for rollback.
Cancellation preserves the active pair. The desktop fixture exercised actual
private Python staging from cached verified artifacts and cancellation; download,
resume, failed health and rollback also have deterministic fixtures. This does
not itself select a personal-memory provider. Separate native activation review
can enable future committed updates for the reviewed Linux lexical profile.
Production backup/upgrade handling and other platform certification remain gates. The spike
preserves reports in `/tmp/ourgeo-mnemosyne-spike-report.json`; no real profile
or user memory is opened. To repeat OS network observation, build the official
strace 7.2 release archive (SHA-256
`4bde6246926890dcee824f6e6ac42a06752f47d77e5097d86e3c0d6d4b709fe5`)
in a temporary directory and set `OURGEO_CONTEXT_STRACE_PATH` to that executable
when running the spike. No system installation is required. This traces only
the newly unpacked synthetic runtime, and requires permission to use ptrace.

## 1.16.7 checkpoint

The 1.16.7 commit records the implemented local broker, memory controls and
experimental provider groundwork. It is a checkpoint, not completion or
certification of the full specification. Unrelated pending vector export,
package-health and sleep-recovery work is excluded from the context commit.

The context-only snapshot passes typecheck/lint and the context/output-budget
fixtures. Its unchanged legacy preflight fixture also fails on the unmodified
1.16.4 baseline on this machine: an sf-buffer geometry is classified uncheckable
and refused. The full working-tree suite includes separate pending preflight
changes; its results must not be attributed solely to this context commit.
The actual-server fixture now verifies that context.R is loaded at startup,
same-name schemas resolve by environment and active bindings remain unevaluated.

## Provider SDK continuation after 1.16.7

The [adapter SDK](context-provider-sdk.md) now has reusable descriptor/response
runtime checks and an explicitly acknowledged synthetic two-scope conformance
harness. Fixtures cover permission revocation, cancellation, ingestion/retries,
isolation, bounded responses, revisions, deletion and cleanup. Adversarial tests
reject shared namespaces, stale revisions, ineffective deletion, malformed or
oversized content, and offline reads presented as deletion evidence. Reports
never issue a deployment certificate. The private Mnemosyne spike runs the same
harness against its actual sidecar; production routing remains outstanding.
Optional declared temporal filters, exports, scope deletion and reflection
permission/lineage now have independent fixtures. Unsupported operations stay
unsupported; the harness does not grant paid processing. The outbox checks
descriptor and receipt shape/bounds before dispatch/completion, including late
receipts. Invalid usage cannot settle as zero or falsely confirm ingestion.

## Verification and remaining release gates

The maintenance continuation adds encrypted transactional USD reservations and
receipts in schema 12, with migration backup, default-off consent and profile-wide
estimated daily/monthly limits. Unknown/cancelled/incomplete charges stay reserved
across restarts and date changes; late actual receipts reconcile once. Outbox
dispatch requires durable paid preparation and a fresh scope/binding check.
Settings show maintenance spending separately from chat inference, and refuse a
hard-cap configuration. These controls do not activate a provider. The resolver
now checks a host-owned certificate against the exact canonical job, binding,
adapter, connection revision, scope, processing destinations and price validity
before credentials and paid reservations. Its protected worker bridge narrows
access to the active project/global scope and repairs late unsent claims.
Preparation waits are bounded; duplicate preparation cannot release a charge
held by the route that dispatched. Regression fixtures include actual encrypted
worker credential isolation and cancellation/revocation during credential lookup.
Production certificate issuance, price profiles, live revocation, scheduling,
usage completeness and provider-side processing quotas remain required.

Latest local verification on 8 October 2026: typecheck and build passed, lint
reported zero errors and 37 existing warnings. The 1.16.7 checkpoint working
tree passed 2,075 tests in 188 files; the maintenance/SDK continuation passes
2,141 tests in 192 files, including request validation, malformed deletion
receipts, encrypted spend reservations, certified route validation, actual
worker credential isolation and dispatch/reconciliation races. The focused
provider/maintenance suite passes 56 tests. Abandoned reconciliation remains
pending rather than replaying uncertain ingestion.
The latest private Mnemosyne run passes ten supported conformance checks across
synthetic global/project namespaces, reports five optional checks unsupported,
and observes zero network syscalls across five runtime launches with a positive
control. Its report is `/tmp/ourgeo-mnemosyne-spike-report.json`; the materialised
runtime is 217,889,059 bytes. These are Linux fixture results, not certification
of other platforms or the default runtime. The latest built Electron
fixture passes in an isolated temporary profile with the maintenance settings,
including default-off consent, saved limits and hard-cap refusal without paid
dispatch, experimental runtime staging/cancellation and protected connections,
plus reported-usage inspection. Its screenshots were visually checked; the
maintenance controls are captured in `/tmp/ourgeo-context-maintenance.png`.

Automated fixtures cover simple routing, multilingual bounds, stale/revoked
handles, source races, scratch separation, project identity forks, prerequisites,
encrypted storage/FTS5, suppression, provider translation and tool-loop protocol
integrity. A real Electron run uses an isolated temporary profile and a synthetic
loopback model, without a paid inference call or changes to the user's profile.
Run `npm run build` followed by `npm run test:context-ui` for the isolated
desktop fixture. It checks zero auxiliary context, protected memory edits,
suggestions/pins/suppression, project save, Save As lineage, discard/reopen,
responses during paused R loading, scoped exclusion persistence/restoration,
duplicate-project copy lineage, explicit memory commands with zero inference,
relevant project/global unit retrieval and supersession, and chat-derived deletion
with deliberate edited-memory retention. Fresh keyring-free source discovery and
unreadable-policy refusal run in a separate basic_text profile. Its model is a synthetic loopback fixture;
these checks do not measure model task quality.

`src/lib/context/accounting.test.ts` compares conservative serialized token
estimates against the legacy builders and a 10,000-object synthetic workspace.
This is a local counterfactual, not a paid invoice, model quality benchmark or
proof of the 20-turn savings target. Re-run it for current absolute estimates.
The current fixture estimates 8,558 legacy non-dialogue tokens versus 2,517
with the broker (1,554 compact tool-schema tokens; zero auxiliary context), a
71% reduction. With 10,000 unrelated object descriptors, the legacy estimate is
214,876 tokens and the broker estimate remains 2,517. No duplicate paid model
request was issued to obtain these figures.

`npm run benchmark:context` measures a synthetic 210,400-descriptor corpus
(10,000 objects, 100,000 console descriptors, 100,000 document descriptors and
200 plugin skill/action pairs) without fetching bodies, running R or invoking a
model. On Linux x86_64, Node 26.10.0, Intel i5-11500H, the current warm query p95
was about 63 ms after streaming bounded ranked pages, removing repeated query
parsing and bounding identifier caches. Context-free routing/prefetch p95 was
about 0.04 ms with zero source discoveries/fetches. Exact-identifier Recall@5
was 100% for the measured synthetic questions. These are pure descriptor
measurements, not UI indexing latency, representative source recall or task
quality. Total additional resident memory was about 206 MB, exceeding the
proposed 150 MB target; memory use and real source-adapter indexing remain gates.
The report at `/tmp/ourgeo-context-benchmark.json` records hardware, runtime,
corpus, latency and memory. The separate real console-index fixture groups
100,000 synthetic events into 25,000 executions: cold index construction was
about 48 ms, unchanged lookup p95 below 1 ms, and appended-event indexing p95
about 4.4 ms, with zero body reads. Other cold starts require separate measurement.
The generic descriptor corpus remains above the memory target; its resident
figures fluctuate with GC and report descriptor/query allocations separately.
Broad discovery now measures empty and corpus-wide queries with complete counts
and unique pages: p95 was about 165 ms and 220 ms respectively, so the latter
also misses the proposed 200 ms target. Heap, buffer and peak-RSS diagnostics
include all corpus construction and query allocations; no allocation is excluded
to pass the memory gate.

Scoped Mnemosyne/Hindsight connection setup now stores encrypted credentials and
metadata through main-owned leases. Tests use bounded health calls without chat
or memory content. Reachability is distinct from certification; external
retrieval and ingestion remain disabled. The reviewed managed Linux lexical
profile supports separately approved future committed updates. Disconnect cancels pending probes, removes credentials
and revokes related bindings/jobs. A content-free namespace ownership ledger
survives disconnection/removal and refuses reuse by another scope.
Disconnected settings can be removed without
losing deletion receipts or claiming remote erasure. The desktop fixture checks
this flow and writes `/tmp/ourgeo-context-connections.png`.

This prototype backlog is superseded by `context-stages-0-2.md` and the current
`context-stages-3-4.md` delivery record. Built-in Linux engineering closed in
1.16.17. Versions 1.16.18–19 add dynamic plugin sources, complete declarative
skill dependencies/sections, reviewed profile contributions, encrypted scoped
migration and an authenticated Linux Mnemosyne local-server profile. Current
limitations include Hindsight's failed PostgreSQL/WAL plaintext deletion gate,
arbitrary remote deployment qualification, complete runtime backup/upgrade and
resource certification, and the retained human/platform/accounting gates.
The deterministic working-state view is useful but does not yet implement the
complete compaction and task-state model described in the specification.

Do not advertise full specification completion, automatic provider writes, a
hard invoice cap, certified offline runtimes or benchmark task-quality results
until the corresponding gates pass.


## Experimental managed Linux activation evidence

The host now checks the pinned Mnemosyne engine, private Python/PyYAML artifacts,
bridge hash and bundled `context-mnemosyne-linux-evidence.json` before offering
activation. Reviews expire after 90 days. Runtime responses, imported projects,
renderer fields and successful health probes cannot grant certification.

Activation uses a short-lived preview bound to the current scope, canonical
snapshot generation and exact connection revision. A native Cancel/Activate
review names the scope, native access, readable derived storage and processing
destinations. Settings activates future committed updates only; existing records
require separate selection and are not copied automatically. Local operations
remain non-billable with the paid maintenance policy off. Canonical records stay
in the protected application store. Scoped outbox jobs revalidate authority at
each boundary; project switches, exclusions, forgetting, pause and disconnect
cancel access. Source exclusions also filter managed snapshots and ingestion.

The isolated Electron fixture covers native cancellation and approval, future-only
updates, deletion in the active and older derived runtime pairs, pause and
connection removal. `/tmp/ourgeo-context-activation.png` records the real UI.
The private runtime fixture passes ten supported conformance checks. OS observation
covers five launches with zero network syscalls and a detected positive control.
Four forgotten source IDs are absent from seven remaining derived files, with
no staging/WAL copies. The sidecar checkpoints SQLite and switches to DELETE
journalling before replacing a snapshot; a renamed database must never inherit
an older WAL. This verifies logical removal in managed files, not physical erasure.

This is an experimental Linux x86_64 lexical profile, not full release
certification. The named authenticated Linux Mnemosyne bridge now supports
external-contract recall and verified native cross-provider migration. Arbitrary
remote deployment reviews, Hindsight's failed plaintext deletion qualification,
multi-platform runtime/upgrade recovery, complete desktop resource measurements
and the full task-quality/usability gates remain outstanding.
The broker retains authorised local canonical memory as its authority and fallback.


## Scoped recall and selected import

`context_search` now consults the approved managed-local lexical provider when
memory discovery is requested. Capability/workspace searches and context-free
initial turns make no provider request. A saved project is the default provider
scope; a separate global provider is not queried with detailed project text.
Explicit global search remains available. Current native profiles are local-only;
external recall needs separate search billing and destination certification.

Main accepts a bounded relative scope/query and current lease, never a bank or
endpoint. At most two recalls run concurrently. Startup and search share a
three-second deadline, with cancellation on scope/policy changes and an offline
circuit breaker. Every hit must resolve to an approved current canonical ID and
revision. Provider prose, foreign IDs and stale derivatives are refused. Only
ordinal canonical matches reach the broker; it fuses ranks with local lexical
results, creates its normal opaque references and reads local provenance. Cached
rankings are filtered again for exclusions, deletion and revisions. Degraded
coverage is visible without blocking ordinary local retrieval.

Active connections expose a searchable checkbox selection for existing committed
memories. Unsaved project records are unavailable until saved. Native review names
scope, count and estimated ingestion cost. The worker atomically rechecks the
exact binding/policy, connection revision, canonical generation and selection.
Retries do not duplicate jobs. Imports do not change future update permissions,
promote conversation history or remove the canonical copy.

A provider namespace has its own durable snapshot generation, including binding
policy and approved record revisions. Importing an unchanged canonical record
must advance that generation; using the whole scope's generation previously made
the runtime refuse the changed subset. Namespace generations survive binding
replacement, and their initial floor exceeds the older scope-based generation.
Read checks validate the same binding snapshot, including after asynchronous
provider construction. A cleanup failure after committed deletion reports pending cleanup rather than
leaving the old renderer record eligible for retrieval. Persistent cleanup retry
receipts now commit with canonical deletion (see below). Forgetting removes
managed derived indexes even after
connection removal, without executing native code or reconnecting a service.
Other namespaces and installed artifacts remain intact. Remaining authorised
indexes are rebuilt through approved updates; local canonical fallback is usable
while a derived index is absent.

The real Electron fixture covers managed recall, native selected import and
forgetting after disconnect/removal, in addition to the earlier activation gates.
Its import view is captured in `/tmp/ourgeo-context-import.png`.


## Stages 0–2: recovery and rejected-input handling

Schema 13 adds encrypted, content-free local cleanup receipts. Forgetting queues
a namespace purge with its tombstone in the same transaction, including for
disconnected bindings. Receipt IDs are hashes rather than readable namespace
IDs. Restart resumes pending private-file cleanup without credentials, remote
calls or native execution. Six failures stop automatic retries for review;
Context & memory shows current-scope counts and a manual retry control.
Generation/attempt checks prevent a late acknowledgement from clearing a newer
purge, including after a previous purge succeeded. Migrating older tombstones
queues a safe rebuildable-cache purge, with the usual encrypted backup first.
Canonical exclusion and evidence suppression remain effective throughout.

Full-message transports now recover once from an explicit HTTP rejection of
context size. The failed inference is reconstructed, not the whole tool turn.
Only optional older assistant prose is removed; original user messages, host
rules, schemas, working-state cards, reasoning and complete tool exchanges stay
unchanged. A bounded omission receipt points to authorised conversation search.
The retry is budgeted and recorded as another invocation. A second rejection,
an essential-only input or a non-shrinking reconstruction returns a recovery
move. Authentication/rate limits, arbitrary upload-size failures and accepted
partial streams are not retried by this path. Responses accounting now includes
the actual namespace/schema envelope and output fields, rather than an abbreviated
pre-serialization tool representation. CLI-owned internal loops still need their
separate retained-transcript certification.

Verification: 2,207 tests in 199 files passed, typecheck/build passed and lint
reported zero errors with 37 existing warnings. Real Electron used an isolated
kwallet6 profile and synthetic data: redirected-cache refusal kept the forgotten
record excluded, showed a pending receipt, and completed through the settings
retry control after repair. `/tmp/ourgeo-context-cleanup.png` was inspected.
Unit fixtures cover restart, encrypted receipts, migration, retry bounds and
stale completion. The synthetic scale run measured 0.030 ms context-free warm
p95, 94.6 ms lexical warm p95 and 226.3 MB additional resident memory. Timing
targets pass this run; the 150 MB resident-memory target remains unmet. Model
task quality, supported-platform and human/usability gates remain unverified.

## Stages 0–2: retention, attachments and evaluation

Canonical retention runs independently of retrieval, in bounded worker batches.
Unaccepted suggestions expire after 30 days; explicit validity boundaries also
expire records through transactional forgetting, with suppression and deletion
jobs. Inferred preferences receive a review marker after 180 days without support;
explicit preferences are not rewritten by age. Diagnostic excerpts expire after
the configured 1–7 days, while content-free accounting receipts remain. Idle raw
result caches release their contents after one hour. Expiry revokes provider
access, cancels affected work and resets retained sessions.

The composer stages up to three explicit references: active layer schema, recent
execution/failure or current document section. Staging stores identity, revision,
workspace epoch and range; current authorised evidence is read on send. Attachments
receive bounded space before optional older assistant replies and prefetch.
Failed preparation retains the staged selections for correction.

`node scripts/evaluate-context.mjs` adds versioned synthetic development fixtures:
20 turns and 52 scripted inference envelopes, including search/read rounds,
estimate about 159,000 input tokens versus a conservative 325,000-token legacy
counterfactual (51% reduction). No real model was invoked. Development source
Recall@5 was 100%, precision 96.7%; skill discovery was 93.75%, below the proposed
98% gate. Initial untuned observations are retained in the fixture directory.
These tuned fixtures are development evidence, not independent held-out quality,
paid cost, human review or multi-transport task-success certification.

Claude CLI resumes only with usable per-call occupancy and sufficient headroom.
Unknown occupancy, compaction events, failed/cancelled delivery and missing
acknowledgements invalidate retention and require reconstruction. CLI-owned
internal invocations remain opaque, so per-internal-call certification is still
outstanding. All remaining gates are tracked in `context-stages-0-2.md`.

Small line ranges in multi-megabyte current buffers are now read before full-body
copying. Range-specific cache keys and continuation handles preserve the selected
span. A selected span over 1 MB still requires a narrower selection; this does
not claim arbitrary-size document materialisation. Private-key block redaction
covers ranges beginning after the block header. Changed first-delivery evidence
is rejected; previously delivered environment observations get an attributed
historical correction before the next invocation is budgeted, preserving tool
arguments, signed reasoning and valid tool exchanges.

Workspace column privacy filters cached descriptors and current schema reads.
Policy changes cancel work, clear transient results and reset retained sessions.
Until reliable column lineage exists, other private-source reads and generic
assistant execution pause; direct GUI/R use remains. Saved-project policies are encrypted local records with revision checks, independent
Save As copies and fail-closed hydration; scratch choices are transient. No external
memory query is dispatched when all canonical memories are unavailable locally.

Usage totals aggregate available conversation/project receipts, deduplicating
copied/streamed records and keeping cached/reasoning breakdowns separate. Missing
usage remains unknown; background/provider charges and earlier trace-free chats
are excluded explicitly. Portable exports omit traces, so durable all-time spend
and monetary ceiling requirements remain unfinished.

The integrated 8 October 2026 check passed 2,279 tests across 210 files,
typecheck and the production build. Lint reports zero errors and the existing
37 warnings. The isolated Linux Electron fixture
(`/tmp/ourgeo-context-ui-MNULqT`) passed ten mock inference requests, verifying
staging without inference, selected document delivery, column omission from
both metadata/schema context, usage totals and retention controls. Screenshots
`/tmp/ourgeo-context-attachments.png` and
`/tmp/ourgeo-context-column-privacy.png` were opened for visual inspection.
This run found and fixed singleton-column R metadata unboxing; both array and
single-object wire shapes now pass through the same bounded schema whitelist.
It does not establish model answer quality, monetary savings or other-platform
certification, and stages 0–2 remain incomplete.


## Stages 0–2: source controls, recovery and protected accounting

The isolated Linux Electron stages-0–2 fixture passed ten synthetic mock requests
in `/tmp/ourgeo-context-ui-pEZaUi`. It verified protected column-policy reads,
explicit bounded folder indexing, watcher revocation until refresh, encrypted
backup inspection, current available/excluded descriptor browsing and reviewed
transcript-copy removal. New screenshots `/tmp/ourgeo-context-folders.png`,
`/tmp/ourgeo-context-backups.png` and `/tmp/ourgeo-context-forget-copies.png` were
opened for inspection. `--stages-0-2` selects this fixture independently of the
optional managed provider; the full optional run stopped during runtime unpacking
while `/tmp` was at 99% capacity. That failure is retained, not a provider certificate.

Backup recovery preserves current records and deletion markers. Missing global
preferences return as candidates; authorised project journals remain unsaved.
Actual SQLite disk-full rollback and a transactional write probe are tested.
Automatic replacement of a damaged store with an unreadable deletion ledger is
unfinished; an older backup cannot safely reactivate forgotten records.

Schema 15 adds encrypted content-free inference receipts, with stable scope/chat/
turn/invocation/attempt identities. Repeated counters update one receipt; retries
remain separate and transport-run views avoid duplicate counting. Cache/reasoning
breakdowns, unknown usage and uncertain delivery stay explicit. Protected totals
are loaded on demand and survive chat deletion and restart. They cover recorded
activity since activation, not earlier trace-free activity, imported project
exports or provider/background charges. Host-issued numeric-only turn authority
now preserves the original scope for queued and final receipts after a workspace
switch or cancellation. Regression fixtures cover turn/provider isolation, stale
leases, bounded grants, expiry and renderer queue draining. Finalisation releases
authority; host restart or callbacks beyond the 24-hour expiry remain gaps. Monetary pricing/ceilings and a complete all-time ledger remain
unfinished. No invoice cap is claimed.

Compaction regression tests now preserve early constraints alongside recent exact
corrections, avoid re-extracting previous summaries and retain persisted linked
or unfinished tool exchanges atomically. Original user instructions remain intact.
These deterministic tests do not establish complete-task model quality.

Self-hosted Ollama testing used existing `gemma4:e2b` on `chris@10.0.0.10`, CPU-only,
with synthetic data and no downloads or paid inference. Two corrected production-
prefetch smoke tasks used 2,472 reported input and 200 output tokens: schema
identity/columns and an explicitly attached malicious document passed their
source checks. Initial discovery failures are preserved separately in
`tests/fixtures/context/evaluation/local-observations-2026-10-08.json`. Two smoke
tasks do not satisfy held-out or multi-transport quality certification; hosted
certification remains pending by user choice.

An experimental packed descriptor representation measured about 125 MiB additional
RSS and 129 MiB peak growth on 210,400 synthetic descriptors, with construction
and query allocations counted. Lexical p95 was 247 ms and broad p95 381–397 ms,
above target. The default app does not use this representation. The combined runner
with an additional 100,000-event console fixture measured 179 MiB growth. The
memory/performance release gate remains open.

Final integrated verification: 2,342 tests across 223 files, typecheck and production
build passed. Lint has zero errors and 37 existing warnings. The final native
fixture also asserted that protected accounting contains reported usage counters.


## Stage 2 follow-up: receipts after switching workspaces

Queued and final inference counters now use a host-issued capability captured
before sending. Scope comes from the active lease at capture, never from the
project open when a late counter arrives. The capability binds chat, turn and
provider and permits only validated numeric accounting. Current leases still
govern ledger reads and all memory/project operations. Finalisation releases the
capability; abandoned grants expire after 24 hours, with 256 outstanding at most.
Host restart and unavailable counters remain explicit accounting gaps.

Verification: TypeScript passed; ESLint reported zero errors and 37 existing
warnings; the full suite passed 226 files / 2,349 tests with four workers outside
the sandbox. The first sandbox run could not bind R's local TCP server and was
stopped after the unrestricted run passed. New regression tests cover queued
writes and final cancellation after a workspace switch, original scope retention,
turn/provider isolation, stale capture leases, expiry and bounded authority.
This closes the covered in-process reconciliation gap, not stages 0–2 overall.


## Stage 1 follow-up: packed local discovery performance

Authorised folder discovery now retains a packed descriptor snapshot and streams
cards into broker ranking. Only selected hits get stable reader closures. Refresh
immediately withdraws the old catalogue, including on a failed refresh; late
reads and paused scans are revoked. File bodies remain host-read with the current
lease and revision, and column privacy also blocks previously selected readers.
UI pickers retain their stable array interface. Existing folder limits remain.

The packed index stores host-checked identity and lower-case flags in existing
numeric metadata. Scan cards use prototype reader accessors and out-of-band weak
classification; changed IDs or text do not inherit the prior classification.
Empty discovery avoids lexical normalisation. Search scores descriptors before
checking matching candidates for kind, scope, exclusions, group, time, revision
bounds and secret-bearing IDs; only eligible hits contribute to totals or pages.
This removes a redundant full-corpus filtering generator without changing access.

Linux synthetic evidence in `context-performance-linux-evidence.json` includes
all construction and query allocations. On 210,400 descriptors, the recorded
baseline had lexical p95 203 ms and broad p95 351–366 ms. The verified packed run
has lexical p95 137 ms, broad p95 96–152 ms, about 125 MiB additional RSS and
complete counted pagination/identifier recall. Cold construction is about 394 ms
and is reported separately. The combined extra console fixture and object-backed
sources still exceed the memory target; complete default-app certification stays
open. No model quality, monetary savings or other-platform certificate is inferred.

TypeScript passed, lint has zero errors / 37 existing warnings, and 2,353 tests
across 226 files passed. New tests cover encoded credential rejection, mutable
identity/case metadata, packed trust/order parity, selected reader stability,
paused-scan revocation, pending refresh and late column privacy.

The built Electron stages-0–2 fixture passed in the isolated Linux profile
`/tmp/ourgeo-context-ui-OuKpB5` with kwallet6 and 13 synthetic requests. The new
three-invocation folder loop exercised actual `context_search` → `context_read`
→ follow-up delivery through the packed broker path. It returned refreshed
folder evidence and excluded the `.env` fixture. Existing watcher revocation,
protected SQLite accounting, source controls and recovery fixtures also passed.
Folder/recovery screenshots were opened for inspection. The production build
passed. This is synthetic Linux integration evidence, not live model quality.


## Stage 2 follow-up: durable pre-dispatch accounting and estimated chat budgets

Schema 16 adds encrypted invocation charges and optional device-wide daily/monthly
USD estimates. A transport waits for the worker to commit its numeric input receipt
and bounded input/output reservation in one transaction before dispatch. Failed
budget checks roll both back. Tool follow-ups and overflow retries each prepare
a distinct invocation, and preceding completed counters reconcile before the next
reservation. Queued counters continue using their original scoped authority.

User-reviewed provider/model rates are explicit, including zero and cache rates;
missing prices stay unknown and new reservations refuse rates older than 30 days
when enforcement is enabled. Rates are frozen on a charge. Final reported counters
settle once, including cache/write subsets and separately reported reasoning.
Subscription transports with opaque internal processing are refused while the
estimated budget is enabled. Ordinary chat remains available without an OS keyring
only in a fresh profile with no protected policy to silently bypass.

Interrupted requests retain their receipt and reserve across restart and UTC date
changes. Unpriced complete receipts remain unknown; pending unpriced requests block
subsequent budgeted requests. There is no invented provider billing reconciliation
or all-time total for earlier trace-free activity. These are price-based estimated
ceilings, not a provider invoice cap; provider quotas are a separate control.
Settings can disable a limit while retaining expired rates without renewing their
review timestamp. Indexed charge lookups avoid full-ledger reads on streaming
updates. Policy writes do not invalidate memory-provider routing.

Linux verification is recorded in `context-linux-stages-0-2-evidence.json`.
The packaged fixture checks a refused tiny budget without sending a request, then
reconciles a three-request folder tool loop against its frozen reviewed rates.
These are loopback synthetic model responses, not paid invoice evidence.


## Linux stages 0–2 follow-up: default adapters, guarded packaging and recovery

The owner selected Linux closure first, with Windows 11 and macOS acceptance in
later native sessions. `context-platform-acceptance.md` carries the exact commands
and evidence boundaries; this decision does not waive model-quality or human gates.

Default document and environment discovery now retains compact metadata rather
than rebuilding object/reader arrays for every search. Immutable inventory and
scope/runtime/disclosure keys invalidate the snapshots; Visual document snapshots
remain uncached until their content is safe to snapshot. Selected reads validate
current revision and permissions, and late results are revoked. R-generation
checks bind directly to selected readers. A packaged test found a wrapper closing
over the reused scan card and reading the final environment object; the regression
now selects the first object while scanning a later function and proves the right
schema reader runs. No per-candidate wrapper allocation remains.

Document range availability occupies a packed metadata flag, removing a JSON
parse for every document candidate. `scripts/benchmark-context-workspace.mjs`
exercises the production adapters and broker with 10,000 objects, 100,000 console
events (25,000 executions), 100,000 documents and 200 plugins. Warm p95 across four
queries is 135–166 ms; peak additional manager RSS is about 122 MiB. Cold document
indexing is 665 ms and the combined immutable input/store and manager footprint is
about 191 MiB. All construction/query allocations are included; only GUI/R/model
boundaries use synthetic inputs. This is not a full native UI scale certificate.
Earlier generic combined-fixture memory failures remain in the historical report.

Startup now recognises only rebuildable `inference_usage_scope` secondary-index
damage. It authenticates current encrypted records, preserves original database,
WAL and SHM files privately, hashes all canonical/privacy tables, rebuilds the
index and verifies integrity plus unchanged rows before committing. Wrong keys,
canonical damage or unreadable deletion markers refuse writes. No old backup is
imported to reconstruct canonical state. Actual byte corruption is exercised in
unit tests and the packaged app; the native fixture retains its original bytes,
recovers 1,030 reported tokens and displays the recovery receipt.

The native harness supports built and packaged executables, checks the guarded
synthetic profile before opening an app, and verifies its actual user-data path.
The Linux package uses Electron 41.0.2 and kwallet6. Its post-attachment HTTP audit
allows loopback traffic and observed no external hosts; a final loopback-only Linux namespace also verified startup and descendant offline
operation while preserving the desktop UID for kwallet. Complete attempted-network
capture and installer behaviour need separate evidence. AppImage and
Debian artifacts were built with a verified direct npm dependency snapshot because
nested npm collection returned empty stdout in this execution environment. No
project dependency or production collector was replaced. The ordinary package
command's failure is retained alongside the successful artifact build.

A CPU-only `gemma4:e2b` development smoke issued six real requests, reporting
6,236 input and 527 output tokens. Five tasks produced visible answers; one returned
no answer despite output usage. The client now reports empty tool-free model output
as a recoverable error while retaining usage. All six had zero model-selected
context tool calls. Named console-failure selection was corrected and a targeted
join retry received the right causal evidence, but its answer still needed human
judgement. The script differs from the complete application protocol and has no
legacy model run. Neither this smoke nor the scripted 51% input-token counterfactual
certifies comparable quality, billed savings or independent multilingual recall.

Remaining release gates are explicit in the checklist: independently frozen corpus
and comparable models/transports, independent provenance/answer review, ten human
usability participants, complete Linux offline capture and installer checks,
native UI scale and opaque retained-transport certification, and unavailable
historical/provider billing reconciliation. Windows/macOS are deferred platform
work. Stages 0–2 must not be labelled fully closed without those results or an
explicit further product-scope decision.


Final verification: TypeScript passed; lint has zero errors and 37 existing
warnings; all 2,378 tests across 231 files passed with two workers. The final
packaged Linux fixture passed in `/tmp/ourgeo-context-ui-IVyguM` with 13 synthetic
requests, kwallet6 and no external Electron HTTP hosts. It also passed inside a
network namespace containing only loopback and no routes. The initial root-mapped
namespace could not authenticate kwallet and correctly refused protected writes;
using the desktop UID fixed that test setup. Screenshots were opened. AppImage
extraction succeeded and its executable/archive hashes exactly match the packaged
payload tested above. AppImage FUSE mounting and system install/uninstall were not
performed. Both successful checks and remaining release gates are recorded in
`context-linux-stages-0-2-evidence.json`.

### Linux follow-up: native source browser and owner acceptance (1.16.14)

Native source browsing now uses packed default-adapter scans, retaining the
ranked page rather than materialising and redacting all document descriptions
on every search. Host classification caches the complete identity/control and
metadata-redaction verdict, requires unchanged ID/title/summary to reuse it, and
classifies console descriptors on immutable execution updates. Regression cases
cover later secret-bearing edits, appended failures, forged metadata, reused
scan-card pagination and encoded controls without reading bodies.

`scripts/check-context-scale.mjs` verifies the actual Electron context UI with
10,000 objects, 100,000 console events, 100,000 document buffers and 200 plugins.
The final run measured warm search-handler p95 129–190 ms and about 64 MiB of
additional manager resident memory after GC; two unrelated turns selected no
auxiliary evidence and made no schema reads. Essential editor/console panes are
suppressed in this context-only fixture: an initial fixture accidentally reopened
them and stalled on 100,000 tab buttons. Whole-app tab rendering and transient
pre-GC peaks are not certified. Intermediate native runs missed the latency gate;
their measurements are retained alongside the final explicit gate result.

The standard Linux packaging command succeeds outside the sandbox without the
earlier dependency-tree workaround. A later Debian tar/xz run failed with little
free space in RAM-backed `/tmp`; directing `TMPDIR` to the workspace cache fixed
it without altering dependency collection. `scripts/check-context-package.mjs`
copies and extracts the actual AppImage, verifies its executable/archive against
the unpacked payload, runs the full isolated packaged acceptance, then removes
only that disposable installation. FUSE mounting, desktop integration and Debian
package-manager installation/removal remain separate boundaries.

`scripts/check-context-network.mjs` starts strace before the packaged harness,
follows descendants in a loopback-only namespace, suppresses payload strings and
verifies detection with an intentionally blocked external canary. Offline
acceptance succeeds, but the strict audit fails: it records external DNS and IPv6
route-probe connects, and successful/unfinished `io_uring` calls prevent proof
that every network operation was observed. Desktop/keyring services reached
through Unix IPC are outside the traced tree. Preserve this failure rather than
using offline success as network certification.

The owner will perform Linux manual acceptance personally; no independent
usability results were supplied. `context-owner-acceptance.md` supplies an isolated
profile launch, seven exact workflows, expected outcomes and a results template.
Owner acceptance is pending; a representative-participant study is separately
unverified. Live comparative model quality, held-out recall/provenance, full
network/installer coverage and cost/opaque-transport boundaries remain open.
Current evidence and historical failed checks are in
`context-linux-stage02-followup-evidence.json`; earlier checkpoints are retained.


### Settings navigation and owner-feedback follow-up

Settings now has a persistent category menu instead of a long accordion.
The selected category heading stays visible. AI Assistant settings has
separate pages for Memory Library, Provider & model, Learning & context,
Privacy & sources, Budgets, Storage & recovery and Advanced. Narrow windows
use category and page pickers; ordinary windows use the sidebar and tabs.
Hidden pages retain their form state and leave the keyboard tab order.

The Memory Library has the same visible title in settings and below the
conversation. Scope controls have selected styling, and record actions use
bordered buttons. Direct entry sits above saved records, calls the local
remember operation, prevents repeated submission while saving, keeps failed
drafts and explains the additional save needed for project memory.

Workspace column privacy can refresh the R object inventory and offers
in-memory data frames even when their columns are not cached. Selecting an
uncached object reads the narrow schema-only endpoint locally. Stale schema
and inventory responses are rejected after workspace changes or R restarts.
No model is needed to populate these controls. The owner acceptance pack,
README and assistant guidance now name the corresponding settings pages;
readable memory export is described as a clipboard action.

A retrieval-call limit now reports the active effort and lookup allowance,
with a recovery move. Retrieval token limits also have an explanation.
The owner's earlier bare BUDGET_LIMIT has insufficient provider/trace
information to establish its exact cause; these changes do not certify that
specific live-model request.

Linux engineering verification: all 2,439 tests in 238 files passed; the
production build and TypeScript checks passed. ESLint reported zero errors
and 37 warnings in other files. The complete isolated Electron harness
passed with a loopback simulated assistant and the downloaded managed-local
runtime fixtures, including category navigation, narrow pickers, direct
memory entry in both locations without model dispatch, edits, project saves
and forks, privacy, suggestions, pins, cleanup, recovery, transcript
forgetting and budget enforcement. Desktop and narrow screenshots were
inspected. These are engineering checks, separate from the owner's recorded
acceptance results, native Windows/macOS testing and live-model quality.
