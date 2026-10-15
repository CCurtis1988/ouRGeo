# Context stages 3–4 delivery record

This is the continuation point after built-in Linux stage 0–2 engineering closed
in 1.16.17 (`66633e4`). The specification remains authoritative. A working
prototype, a passing synthetic fixture and a qualified deployment are separate
claims; every closure below needs evidence for its stated boundary.

The owner has deferred independent corpus review and the ten-participant
usability study until a team is available. Their requirements remain recorded in
`context-qualification-review.md`. The owner also explicitly deferred Windows and
macOS testing while asking the agent to handle Linux checks. Opaque provider
accounting remains unqualified; Linux evidence cannot certify those boundaries.

**Current status, 1.16.22:** stage 3–4 Linux engineering is closed for the
named profiles below. Human quality/usability review and Windows/macOS testing
remain deferred by the owner, not passed. Full release qualification is separate
from this Linux engineering closure. Machine-readable results and source/build
hashes are in [context-stage34-linux-closure-evidence.json](context-stage34-linux-closure-evidence.json).

The closure checks and installer hashes below were recorded against 1.16.21.
The 1.16.22 release advances version metadata with the same implementation;
its production build is checked separately. The recorded 1.16.21 results retain
their original versions and hashes.

| Stage | Delivery | Linux closure boundary |
| --- | --- | --- |
| 3 | Typed provider SDK and response validation | Closed: adversarial fixtures and real pinned provider conformance |
| 3 | Managed Mnemosyne | Closed for the reviewed Linux x64 lexical profile: actual installed-file integrity, scoped consent/import/recall, supervised lifetime, canonical checkpoint, update/rollback, crash, real ENOSPC and forgetting checks |
| 3 | External Mnemosyne | Closed for the named authenticated owned MCP loopback profile; protocol initialisation, tools, bank isolation, current protected writes, token rotation and native migration/recall are tested. Arbitrary upstream/remote deployments need their own review |
| 3 | External/local-server Hindsight | Closed for the dedicated operator-started Linux chunks profile: pinned distribution/process/listener verification, authenticated banks, actual API conformance, serial quiescent retention, SIGKILL recovery, native routing and physical deletion scans. Ordinary raw API deletion still fails and is unqualified |
| 3 | Activation, revocation and accounting | Closed for named non-billable local profiles. Native scope review and protected credentials are required. Reachability grants no memory access; arbitrary paid/hosted deployments remain unavailable without bounded accounting/deployment evidence |
| 3 | Scoped migration | Closed: exact selected canonical revisions, encrypted journals, restart/reconciliation, separate old-copy cleanup and canonical preservation. A host-only serial read barrier resolves cancelled snapshot writes before a cleanup binding exists |
| 3 | Offline/disclosure conformance | Closed at each named Linux boundary with strict whole-process connected-write/io_uring observation and working controls; no external attempts or opaque calls in the passing runs |
| 4 | Declarative skills and documentation compatibility | Closed: addressable/required sections, local dependencies, minimum versions and current evidence prerequisites are tested in the real broker/tool transport |
| 4 | Dynamic sources and permissions | Closed: separate source consent, bounded own-resource callbacks, revisions, workspace withdrawal, exclusions and live revocation/renewal. Hostile native-code isolation is outside the existing soft sandbox |
| 4 | Certified provider contributions | Closed for host-reviewed profile references, separate grants, exact manifest checks, scoped native activation and durable disablement. Plugins cannot self-certify or supply credentials/adapters |
| 4 | Measured refinement | Closed with the published lexical comparison: built-in remains the default. Semantic models and reflection stay disabled because this evidence establishes no benefit for enabling them |
| 4 | Quality/usability and other platforms | Deferred by owner: independent corpus review, representative usability participants and Windows/macOS native sessions. These are retained qualification requirements |


Authorisation carried forward: use local models or the configured ouRGeo OpenAI
subscription for evaluations. Do not use unrelated paid credentials. Work in
isolated synthetic profiles, preserve failed evidence, and keep built-in memory
independent of optional services. The owner asked to start closing stages 3–4;
do not relabel outstanding deployment/platform reviews as passed.

## First delivery: 1.16.18

The plugin source SDK and runtime/data pair validation are delivered. Authoring
is documented in `context-plugin-sdk.md`. Machine-readable evidence is in
`context-stage34-sdk-evidence.json`; native screenshots and raw logs retain the
synthetic fixture paths. The full suite, TypeScript, lint and production build
are checked alongside the actual Electron SDK integration.
Final verification passed 2,508 tests in 248 files, TypeScript, lint with zero
errors and 37 existing warnings, and the production build. The final native SDK
run used 11 synthetic local model requests and reported no renderer errors.

The existing native context fixture also passed managed staging/cancellation,
native activation review, future-only writes, selected import, scoped recall,
pause/disconnect, deletion across runtime pairs, local cleanup repair, project
save/fork/discard and protected canonical recovery. It used 17 local synthetic
model requests and kwallet6. Its HTTP hook observes only Electron HTTP after
attachment; it is not a new strict whole-process offline audit. Its wrapper
reports Electron 41.0.2 as app.getVersion(), rather than the ouRGeo package
version; the build/package version is recorded separately.

The pinned Mnemosyne spike passed ten supported conformance checks and verified
interrupted snapshot recovery. Five OS-observed launches attempted zero network
syscalls; the socket positive control was detected. Four forgotten IDs were
absent from seven remaining derived files, with no staged/WAL copies. Temporal
search, provider export, reflection and scope-delete capabilities remain declared
unsupported by this lexical adapter. It remains experimental and uncertified for
the full specification.

Earlier native SDK harness runs failed on an incorrect response selector,
immediate checkbox assertions during asynchronous enablement and an exact context
summary selector. Corrected checks pass. A restricted Node/WASM packaging test
run timed out on five compiler tests; the same real-compiler tests passed outside
the sandbox and in Electron. No timeout was counted as a pass. The new shared
native permission helper also needed explicit inclusion in tsconfig.node.json;
that TypeScript configuration failure was corrected before completion.

Next: qualify external provider deployments and their processing/deletion
semantics, complete scoped migration and interrupted-migration reconciliation,
then add certified plugin provider registration. Optional semantic retrieval and
advanced reasoning require comparative evidence of benefit. Deferred human
reviews and other-platform sessions remain separately tracked.

## Second delivery: 1.16.19

This is a historical delivery record. Its raw Hindsight failure remains valid;
the separate dedicated profile delivered in 1.16.21 supplies the missing
retention boundary rather than changing that result.

The skill contract, scoped migration and reviewed profile contribution SDK are
implemented. Migration uses schema 17's encrypted journal and preserves canonical
scope/IDs. It pauses old routing atomically, copies only selected committed
records, waits for current destination revisions, then separately reviews keeping
or removing all previously approved copies in the old bank. Prior paused
activations are included. Native deletion-only grants cannot become ingestion or
recall authority. Cancelled migrations preserve local memory and transmitted
copies. Unknown old writes remain blocked unless a supported snapshot profile's
bounded fresh read proves quiescence; no ingestion is blindly replayed.

The authenticated local-server option uses the pinned Mnemosyne lexical bridge
and a protected token for each host-owned namespace. It starts only through
explicit settings review. Native writes require a current protected outbox job
and exactly its canonical snapshot, with live workspace/policy checks. Changing
or disabling provider descriptors withdraws access and pauses contributed
bindings, including outside the current project. Re-enabling a plugin requires
fresh scoped activation. Unrelated current providers remain active.

`context-mnemosyne-local-server-evidence.json` records actual upstream engine
conformance, authentication, namespace isolation, recovery and removal of 515
synthetic source IDs from five remaining derived files, with no staged/WAL
copies. The whole Node/HTTP/Python process tree attempted zero external
connections; a separate socket/bind positive control was detected. This is an
experimental named Linux x64 loopback profile, not certification of arbitrary
remote MCP servers or other platforms.

For 512 synthetic records and 25 exact-token queries, all three lookup variants
found the expected ID on every query. Median/p95 latency was 0.10/0.16 ms for
built-in, 35.10/41.21 ms for managed lexical and 36.37/43.43 ms for authenticated
local-server lookup. These are controlled lexical measurements, not semantic
quality or complete desktop resource measurements. The built-in manager remains
the default. No semantic model or reflection is enabled on this evidence.

The native SDK fixture passes actual profile staging, native cancellation and
activation, direct Memory Library creation, migration to the authenticated
server, protected-credential recall, explicit old-copy cleanup and canonical
preservation. It also verifies addressable skill sections, source exclusions,
permission renewal and durable provider disablement, using synthetic local model
replies. No real account/model is used and no owner testing is requested.

Hindsight is a remaining qualification failure, not a deferred human/platform
test. `test:context-hindsight` provisions no dependencies; after separate private
venv setup it launches the real pinned upstream API and embedded PostgreSQL in a
fresh synthetic directory, disables LLM processing and ambient credentials, uses
synthetic hash vectors and RRF, and checks restart, supported conformance,
network destinations and deletion. The strict run reports zero live content
rows and zero external connections, but four database/WAL files retain forgotten
plaintext. Its failed exit is intentional evidence of the unmet gate. Ordinary
HTTP document deletion cannot certify physical PostgreSQL/WAL/backup erasure.
Personal-memory activation stays unavailable for this deployment. A supported
retention/cleanup deployment profile is still needed; do not mark stage 3 closed
or relabel this failure as passed/deferred.

Earlier failed runs are retained: mock-only timestamp assumptions, unsafe query
transport, ingestion-operation type/status mapping, missing schema-17 index
repair allowlisting, test-profile permissions and tests that selected stale
renderer memory after raw IPC writes. Corrections are checked against the actual
services and UI. A transient same-workspace recall invalidation during migration
uses bounded fresh read attempts in the fixture; cross-workspace retries fail.

Final verification for this delivery passed **2,549 tests in 252 files**, TypeScript,
lint (zero errors; 37 existing warnings), production build, Linux AppImage/deb
packaging and all 13 native SDK/profile checks. The final packaged cold-start
offline run passed with zero external attempts, 830 decoded io_uring calls and
zero opaque calls, with working positive controls. Source/build hashes, raw log
paths and explicit failed/deferred boundaries are retained in
`context-stage34-delivery-evidence.json`. Earlier 1.16.18 evidence remains a
historical record. Test health requests now use the owned server's snapshot RPC,
and restarting an owned listener pauses old bindings before endpoint renewal.
Reactivation preserves only acknowledged current imported revisions; revisions
edited while paused and deliberately removed copies are never silently imported.

No manual owner test was required for these Linux checks. At this delivery, stage 3 remained open
for the recorded Hindsight deletion qualification, arbitrary remote deployment
qualification and remaining runtime/release certification. The implemented stage
4 SDK is tested for its supported named profiles; the deferred human studies
and benchmark-dependent model refinements retain their original requirements.


## Linux engineering closure: 1.16.21

The final native SDK/provider run passes actual staging, cancellation and scope
approval; protected MCP credentials and cold restart; selected migration and
old-copy removal; direct library creation; Hindsight native folder verification,
future writes, canonical recall, pause and physical plaintext removal. It uses
14 synthetic local model replies and records no renderer errors. No real user
profile, provider account or paid inference is used.

Runtime activation now checkpoints encrypted canonical memory, verifies actual
installed artifact inventories, journals the pointer switch and probes health
after activation. Failures and cancellation restore the previous compatible
runtime/data pair. Actual SIGKILL and disk-exhaustion fixtures preserve canonical
records and readable snapshots. Linux parent-death supervision, an exclusive
store lock and exact legacy process recovery prevent abandoned writers. Older
installations without inventories remain visible and can be restaged without
hiding canonical settings.

The owned external Mnemosyne endpoint now speaks Streamable HTTP MCP. It
validates protocol versions, Host/Origin, authentication and bank scope; normal
health uses its snapshot tool. A cold app restart rotates the protected token
and requires renewed scope approval. Stale/missing derived snapshots repair only
through protected outbox writes for already approved current revisions. A
cancelled write reconciles through an explicitly read-only serial barrier,
without requiring a not-yet-created cleanup binding or replaying ingestion.

The dedicated Hindsight profile is documented in
[context-hindsight-local-profile.md](context-hindsight-local-profile.md), with
installed distribution/source hashes in
[context-hindsight-local-evidence.json](context-hindsight-local-evidence.json).
It uses the upstream public API and embedding extension interface without a
private engine fork. In-process lexical features need no model or embedding
listener. PostgreSQL is on a private Unix socket with durable writes enabled.
Before acknowledging mutations, the gateway journals, drains API/workers,
rewrites live relations and statistics catalogues, advances/checkpoints WAL,
then reopens a fresh API. Failed cleanup blocks reads; actual SIGKILL recovery
runs maintenance before reads resume. Unrelated bank data survives, while scans
find no forgotten IDs/plaintext after cleanup and restart. The strict audit
observes zero external attempts and zero opaque io_uring calls. This is an
operator-started existing server, not the optional managed Hindsight installer.

For 10,000 synthetic records and 100 exact-token queries, built-in, managed
lexical and authenticated MCP lookup each find the expected canonical ID on
all queries. The comparison records hardware, warmed median/p95, a separate
cold probe and sampled Python RSS. Timing comes from an untraced loopback-only
run; strict network observations are separate. The exact measurements are in
the closure JSON. This is lexical correctness/performance evidence, not a
semantic model-quality or human usability study. Built-in stays the default;
semantic retrieval and advanced reflection remain disabled.

The larger workload exposed quadratic canonical-save scans and individual
upstream inserts. Ordinary memories now avoid scanning/decrypting an entire
scope, and the bridge uses pinned public remember_batch with an explicit
canonical-ID map. Staged indexes use in-memory journalling, are sealed/fsynced
before rename, and keep committed durability independent of staging.

Failed checks remain recorded rather than counted as passes: raw Hindsight
retention; the first gateway's request-delivery loop, statistics copies and
restart defects; native migration's proposed cleanup-binding lookup; and cold
verification overrunning recall. The last defect was measured: serial installed
file verification made a direct cold request take about 3.34 s, so the 3 s recall
deadline repeatedly cancelled startup. Eight bounded readers preserve existing
inventory digests and reduce that direct probe to about 2.13 s. The production
recall deadline is unchanged. Ptrace scale-ingestion timeouts remain failed
runs and do not establish performance.

Native acceptance now explicitly awaits asynchronous IPC polling. Playwright's
synchronous waitForFunction treated promises resolving false as truthy and
previously let fixtures race activation. The library's saved paragraph is also
selected independently of its transient populated input. Provider status refresh
errors are retried only while the original workspace lease remains current;
unexpected failures and real scope changes still fail. Packaged plaintext scans
include encrypted migration-backup files recursively. Debian upgrade checks
read the actual older artifact version, set a guest-local temporary directory
and start from a clean disposable package state. No regular installation,
desktop menu or owner profile is modified.

Release checks and their exact boundaries are collected in the closure JSON.
Final verification passes 2,577 tests in 258 files, three Python gateway tests,
TypeScript, lint with zero errors and 37 existing warnings, production packaging,
the 15-check native SDK run and packaged managed-runtime acceptance. Actual FUSE
launch, private desktop registration and Debian 1.16.19-to-1.16.21 installation,
upgrade and removal pass against the recorded final artifacts.
Deferred human/platform requirements stay in
[context-qualification-review.md](context-qualification-review.md) and
[context-platform-acceptance.md](context-platform-acceptance.md). Arbitrary remote
services, hosted processing/accounting and managed Hindsight require their own
future named qualification; they cannot inherit the local certificates.
