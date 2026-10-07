# Context and memory implementation status

This is the delivery record for [the specification](context-management-spec.md).
The full specification is **not complete or release-certified**. The default
local broker and the controls described below are implemented; optional provider
adapters remain prototypes; connection setup can test reachability but does not
activate retrieval/ingestion. Experimental managed-runtime staging is available
on the tested Linux architecture and does not activate personal memory.

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
records. This is not yet wired to personal-provider selection or a production
outbox route.

Settings now exposes explicitly acknowledged experimental staging on Linux
x86_64. Downloads use immutable checksums, bounded sizes, approved destinations
and conditional resume. An exclusive installation lease prevents competing
staging; interrupted staging is recoverable. Synthetic health precedes atomic
runtime/data-pair activation, with a separate previous pair for rollback.
Cancellation preserves the active pair. The desktop fixture exercised actual
private Python staging from cached verified artifacts and cancellation; download,
resume, failed health and rollback also have deterministic fixtures. This does
not select a personal-memory provider. Production backup/upgrade handling,
platform certification and complete scope/deletion conformance still gate that
choice. The spike
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

## Verification and remaining release gates

Latest local verification on 7 October 2026: typecheck and build passed, lint
reported zero errors and 37 existing warnings, and all 2,074 tests in 187 files
passed. The final built Electron fixture passed in an isolated temporary profile,
including reported-usage inspection; its screenshots were visually checked.

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
was about 95 ms after removing repeated query parsing, unnecessary allocations
and duplicate identifier validation. Context-free routing/prefetch p95 was
about 0.03 ms with zero source discoveries/fetches. Exact-identifier Recall@5
was 100% for the measured synthetic questions. These are pure descriptor
measurements, not UI indexing latency, representative source recall or task
quality. Total additional resident memory was about 227 MB, exceeding the
proposed 150 MB target; memory use and real source-adapter indexing remain gates.
The report at `/tmp/ourgeo-context-benchmark.json` records hardware, runtime,
corpus, latency and memory. The separate real console-index fixture groups
100,000 synthetic events into 25,000 executions: cold index construction was
about 48 ms, unchanged lookup p95 below 1 ms, and appended-event indexing p95
about 4.4 ms, with zero body reads. Other cold starts require separate measurement.
The generic descriptor corpus remains above the memory target; its resident
figures fluctuate with GC and report descriptor/query allocations separately.

Scoped Mnemosyne/Hindsight connection setup now stores encrypted credentials and
metadata through main-owned leases. Tests use bounded health calls without chat
or memory content. Reachability is distinct from certification; retrieval and
ingestion remain disabled. Disconnect cancels pending probes, removes credentials
and revokes related bindings/jobs. A content-free namespace ownership ledger
survives disconnection/removal and refuses reuse by another scope.
Disconnected settings can be removed without
losing deletion receipts or claiming remote erasure. The desktop fixture checks
this flow and writes `/tmp/ourgeo-context-connections.png`.

Required work still outstanding includes managed/external Mnemosyne delivery,
certified Hindsight operations and provider bindings,
production outbox activation/deletion reconciliation, scoped provider migrations
and runtime backup/upgrade certification;
dynamic plugin sources/provider permissions and certification; optional embedding
downloads; column disclosure controls, explicit attachments
and folder indexing; complete retained-session
delivery accounting and model-overflow recovery; total monetary/maintenance
budgets; the full scale, quality, platform/offline and usability release gates.
The deterministic working-state view is useful but does not yet implement the
complete compaction and task-state model described in the specification.

Do not advertise full specification completion, automatic provider writes, a
hard invoice cap, certified offline runtimes or benchmark task-quality results
until the corresponding gates pass.
