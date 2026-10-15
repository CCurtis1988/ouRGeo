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

| Stage | Delivery | Starting status / closure evidence |
| --- | --- | --- |
| 3 | Typed provider SDK and response validation | Implemented; adversarial synthetic conformance fixtures exist |
| 3 | Managed Linux Mnemosyne | Experimental lexical profile: pinned artifacts, approved future writes, selected import, scoped recall, pause/deletion and offline fixtures exist; runtime upgrade/recovery and full qualification remain |
| 3 | External Mnemosyne | 1.16.19 delivers a named authenticated Linux loopback snapshot bridge through the external adapter contract, with conformance, scoped writes/recall/deletion and whole-process network evidence. Arbitrary upstream MCP/remote deployments remain unqualified |
| 3 | External/local-server Hindsight | Real pinned API conformance and cold-restart tests pass at their supported boundary. Copied ingestion history is removed in the experimental chunks-only profile; PostgreSQL/WAL still retains forgotten plaintext, so personal-memory qualification remains failed and no deployment review is registered |
| 3 | Provider activation, revocation and accounting | Managed activation implemented; external review, paid recall and deployment evidence remain |
| 3 | Scoped provider migration | 1.16.19 implements encrypted restartable journals, exact selection, current-revision acknowledgements, built-in migration, separate retention/cleanup consent and delete-only bindings. Previous activations in the same bank are included. Snapshot-backed Mnemosyne reads reconcile uncertain old writes without replay; other adapters require terminal receipts. Native Linux migration/recall/old-copy cleanup passes |
| 3 | Runtime install/update/rollback/health | Linux staging and supervision exist; 1.16.18 checks matching installation records before using/restoring runtime/data pointers. Crossed, incomplete and foreign-profile recovery fixtures pass. Complete upgrade/crash/backup and supported-platform qualification remain |
| 3 | Offline/disclosure conformance | Built-in Linux audit and managed lexical spike pass at their documented boundaries; every external deployment needs its own evidence |
| 4 | Declarative skills and documentation compatibility | 1.16.19 adds addressable sections, local dependency graphs, minimum app versions, mandatory section delivery and current evidence prerequisites. Packaging, adversarial broker fixtures and native section retrieval pass |
| 4 | Dynamic plugin sources and permissions | Implemented in 1.16.18: separate context-source consent, bounded own-resource reads, host revisions, live revocation, workspace withdrawal and update permission renewal. Adversarial fixtures and synthetic Linux native SDK checks pass; hostile-code isolation is outside the existing soft sandbox |
| 4 | Certified plugin memory providers | 1.16.19 adds declarative references to host-reviewed profiles, separate memory-provider grants, exact installed-manifest checks, native scoped activation and durable revocation. Native actual writes/disablement pass for the experimental managed Linux profile. Arbitrary executable/provider self-certification remains unsupported |
| 4 | Semantic retrieval and advanced reasoning | Optional features remain disabled. Published synthetic lexical comparison shows no relevance improvement over built-in lookup and higher latency; it does not evaluate semantic models or reflection. Establish a measured model-quality benefit before enabling either |
| 4 | Comparative results and usability | Development evidence retained; independent review/study deferred by owner |

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

No manual owner test is required for these Linux checks. Stage 3 remains open
for the recorded Hindsight deletion qualification, arbitrary remote deployment
qualification and remaining runtime/release certification. The implemented stage
4 SDK is tested for its supported named profiles; the deferred human studies
and benchmark-dependent model refinements retain their original requirements.
