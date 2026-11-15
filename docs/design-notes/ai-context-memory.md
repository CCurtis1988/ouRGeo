# Context broker, memory and managed providers

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

### Context broker and memory (`src/lib/context/`, `electron/main/context/`)

The broker owns source selection, opaque handles, budgets and permission/freshness
checks. Bodies arrive as attributed user/tool evidence, not privileged system
instructions. `router.ts` uses local multi-label cues and declarative skill aliases;
the model can deepen discovery through four stable context tools. An unreferenced
synthetic request selects no auxiliary sources and never waits for R. Actual R
inspection uses a schema-only endpoint that refuses active/lazy bindings and never
prints objects or materialises a database. Computations still echo visible R.
`console-index.ts` reuses immutable session-event snapshots and updates affected
execution descriptors on append. It formats bodies on read, ignores metadata
audits and invalidates on clear/replacement or workspace/R-generation changes.
Older descriptors retain their event range; the broker rejects superseded handles.
Recorded join failures can select their two plainly named current input schemas.
The dependency comes from the captured command, never error prose. Ambiguous,
dynamic or excluded objects stay unresolved. Efficient effort retains its one
prefetch limit. Console bodies identify their execution time; the compact contract
requires rechecking current schema before treating a past defect as current.
An environment inventory replacement does not invalidate an unchanged selected
object revision, but runtime, epoch and disclosure changes still do. First schema
inspection can fill previously unknown cached columns without changing the
execution-bound source revision. If an adapter's initial reference becomes stale,
prefetch may rebind once through the normal checked reader and lookup budget.
Neither this retry nor inventory refresh can replay an execution or revive a
revoked source.

`budget.ts` counts serialized messages/schemas/wrappers conservatively. Every
full-message inference, including tool-loop follow-ups, reserves output and a
safety margin. Ollama probes the requested running model's context allocation;
an unknown allocation uses 4k. `tool-compaction.ts` shortens only completed older
result bodies, leaving calls/IDs/arguments and the newest batch intact. Original
results remain in an 8 MB, one-hour scoped renderer cache; chat deletion, policy
revocation and workspace changes invalidate it. Large original user instructions
are retained; an impossible fit returns a recovery move rather than clipping them.

`usage.ts` keeps provider-reported per-invocation counters separate from prompt
occupancy and estimates. Cache/reasoning subsets are counted once; streaming
updates replace cumulative observations. Claude CLI totals cover its transport
run and do not prove internal invocation occupancy. Failed/cancelled receipts
stay on the initiating turn (or its partial answer), never a later turn; a
workspace switch prevents attachment. Missing fields remain unknown, with no
invoice or zero-cost claim. Local recovery validates counters; portable chats
omit delivery traces.

Composer attachments hold source ID/revision/epoch and a selected line range,
never a hidden body copy. The broker reads them before optional prefetch and caps
all serialized envelopes within the attachment allocation. Conversation selection
reserves this space before older assistant prose; original user instructions stay.
Document adapters locate selected line boundaries in the current buffer before
copying/redacting the bounded span; cursors preserve the original range. Private
key blocks remain redacted when their BEGIN marker precedes the selected lines.
Previously delivered environment evidence receives a host historical annotation
before inference budgeting after R changes its revision. First delivery of changed
evidence is refused. Only plaintext channels change; executable arguments, tool
pairs, signed reasoning and schemas remain intact.
Column exclusions use encrypted project-local policy with revision checks; scratch
choices remain transient. Save As forks the policy independently and first save
transfers scratch choices. Hydration/write failure blocks private reads until
policy recovery. They filter cached and current schemas, reset retained
sessions/results and increment policy revision.
Until other sources have reliable column lineage, private-source reads and generic
assistant execution pause. Original user instructions remain. Memory queries are
not dispatched externally when no authorised canonical memory is available.
Usage aggregates deduplicate turn/attempt receipts and show only available scoped
history; portable exports omit traces, so this is not an all-time spend ledger.
Schema 16 stores content-free inference accounting in encrypted SQLite rows,
with hashed scope/chat indexes and idempotent invocation/attempt identities.
Before inference the host issues a numeric-accounting capability bound to the
current lease's scope, chat, turn and provider. Renderer inputs contain only UUIDs,
provider enum, delivery state and bounded counters. Queued and final callbacks
keep that original scope after cancellation or a workspace switch; they cannot
read memories or authorise project mutations. Finalisation releases authority;
unfinished grants expire after 24 hours with at most 256 outstanding. Host restart
ends grants; already committed pre-dispatch receipts and reservations survive,
while unreceived provider counters remain unknown. Ledger restore does not roll
accounting back; portable exports omit it. Protected totals load explicitly.
`chat-budget.ts` stores an encrypted, content-free charge for each invocation in
the same transaction as its input estimate, before transport dispatch. API/local
tool follow-ups and context-size retries each reserve independently. The host
captures the model with the scoped accounting authority; renderer-provided scope
and model cannot redirect a charge. Frozen user-reviewed USD rates expire after
30 days for new calls. Reservations use the highest input/cache rate and bounded
output; missing counters stay pending across UTC rollover and restart. Complete
reported counters settle a price-based estimate once, with cache/reasoning subsets
counted once. Unpriced activity stays unknown, including subscription runs.
Enabled daily/monthly device-wide estimated limits refuse unresolved unpriced
reservations, missing/stale rates and opaque subscription processing. They are
not invoice caps. Expired unchanged rates can remain in settings when disabling
limits; changing prices requires a fresh review. Indexed charge lookups avoid
scanning every encrypted receipt on ordinary streaming updates. There is no
backfill for trace-free history or provider billing retrieval after a host crash.
Authorised folder metadata uses `CompactDescriptorIndex` and streams reusable
cards into broker ranking; only retained hits receive stable reader closures.
Packed identity/lower-case flags are host-classified out of band, checked against
current card fields, and cannot replace live scope/exclusion/revision checks.
Prototype reader accessors keep scan data fields efficient. Search validates each
matching candidate before counting or returning it, avoiding another full-corpus
filtering generator. Refresh withdraws old folder cards immediately; pending or
failed refreshes cannot re-authorise a previous snapshot. Old readers and paused
scans reject after revocation, including new column privacy. The narrow packed
benchmark now meets latency/RSS targets. The later normal-layout synthetic run
also meets them after bounding tab/console DOM rendering; production ingestion,
other panel combinations and transient peaks remain uncertified
(`docs/context-stage02-owner-followup.md`).
Canonical retention sweeps run in bounded batches independently of search:
30-day suggestions and explicit expiry boundaries use transactional forgetting.
Inferred preferences get a 180-day review marker, not an automatic correction.
Diagnostic evidence has a separate 1–7-day lifetime; accounting-only receipts
retain counters without excerpts. Raw result-cache eviction runs even when idle.

Personal records and project recovery journals use AES-GCM ciphertext in SQLite
on a worker thread, with FTS5 in an in-memory database. The key uses OS safeStorage;
Linux basic_text is refused. This protects the application's index/WAL/temp files,
not ordinary readable project exports. Main-issued project leases reject stale
draft IPC. Portable project JSONL is committed by atomic bundle save; Save As
forks UUIDs and memory lineage. Imports honour local tombstones and clear bundled
CLI session IDs rather than treating them as an authorised delivery receipt.
Only successful bundle saves publish committed project records to the canonical
store/outbox. Draft revision jumps are valid; an older conflicting snapshot is
refused with a recovery warning. Newer edits arriving during save remain journalled.
Explicit memory commands run locally before model dispatch, including without an
API key. Conversation memory has its own typed records on `AiChat`, separate
from canonical project/global records. Local additions/corrections are scoped
Always apply instructions by default; the user can unpin them for selective
retrieval. Derived constraints and decisions come from original user spans.
Corrections/tombstones override library cards without rewriting the transcript;
removal clearly states that originals remain. Imports validate notes and retain
tombstones; scratch has the chat lifetime and projects persist them in chat JSON.
Only the active chat exposes these notes to the broker. Writes stop in-flight
answers and revoke retained sessions/results; current pinned notes use the same
1,200-token explicit-instruction ceiling and delivery receipts. Moves save the
destination before removing the source; a failed destination preserves the source.
Overlapping privacy hydration uses generation checks after every await. An older
load cannot mistake a newer pending column policy for an empty Error, overwrite
its success, or leave a stale privacy warning after recovery.
 Narrow deterministic preference settings supersede within one scope in
the canonical transaction. Category routing uses meaningful terms, so generic
“this project” prose cannot displace a relevant unit convention.

**Turn-start memory routing runs on every message (1.17.1).** `memory-routing.ts`
scores every saved memory against the request (`memoryRelevance`: a shared category,
units, formats, CRS, communication or graphics, or shared meaningful words; generic
verbs such as "make", "show" and "add" never count) and reads the best two before
skills and other evidence, on their own allowance. It used to run only when the
message contained a memory keyword ("remember", "prefer", "units", "format"…), and
memories were last in the three prefetch slots, so "draw a histogram" never brought
in "Always make all plots dark themed". Measured (docs/context-memory-diagnosis.md):
a memory that reaches the model was followed every time on Haiku, Sonnet and Qwen;
the gate let one reach the model in 18–25% of plain requests, and the Context
setting changed nothing (Thorough 18–20%). A request no memory fits still selects
none. Do not reintroduce a keyword gate; a memory that must be on every message is
what "Always apply" (pinned) is for. Suggestions and
inferred text never silently supersede a user-declared active instruction.
Project mutations are queued because an R reset/load cannot be cancelled once
it reaches the server. Imported editor/database paths are authorised against a
protected profile-local registry, never against the bundle's claims. Unrecognised
scripts use bundled buffers; unrecognised database paths require a local choice.
Global edits do not change project memory identity or dirty state. Forgetting
removes journal copies and resets retained sessions even if journal recovery fails.
The encrypted project-location registry detects surviving duplicate bundles;
rename/move and symlink/hardlink aliases retain identity. A copy filters original
deletion tombstones before forking memory IDs, then remains unsaved until its
new identity is committed. Paths remain local warning metadata, never scope IDs.

Source exclusions are encrypted local policy, not bundle content. Scratch policy
is transient. Protected-policy failure disables retrieval rather than reopening
an unrestricted legacy prompt. While a private source is excluded, generic R,
document and interface execution pauses because it could bypass source adapters;
theme-only actions and direct GUI/R use remain available. Future prompt views omit
old assistant prose with unverifiable source lineage and preserve user originals.
Session/cache resets alone do not mark project chats dirty. Structured IDs escape
names before joining namespace components; legacy IDs can only exclude a source,
never grant access. Read limits count escaped wrappers, not just text bodies.
Inspector delivery flags reflect excerpts found in serialized invocation payloads;
selection after the last invocation is not a claim of delivery.
The inspector's explicit current-source browser pages local descriptors without
reading their bodies, R or remote providers. Available/excluded are separate from
historical selection/delivery. Folder grants are explicit and workspace-local;
bounded UTF-8 indexing refuses symlinks, ignored/secret files and oversized roots.
File watcher changes revoke descriptors until explicit refresh.
Browser discovery uses the broker's packed metadata scans, retaining only the
ranked page. Host-only descriptor classification caches identity/control and
redaction checks; unchanged IDs/titles/summaries are required to reuse a verdict.
Console descriptions classify on immutable execution updates, rather than on
every browser keystroke. Changed or provider-supplied metadata is checked again.
The native scale fixture isolates context UI from editor/console tab rendering
by default. Its separate `--whole-app` mode retains the normal layout and checks
visible rendering and navigation across 100,000 buffers and console events.
Neither mode certifies production ingestion or every panel combination.
Encrypted backups have host-issued IDs, bounded catalogue retention and read-only
verification in a worker. Healthy-store restore preserves current tombstones and
records, imports missing global records as candidates, and stages authorised
project journals. Disk-full failures pause writes until an actual transactional
write probe succeeds. Damaged deletion ledgers cannot safely activate an older
backup; automatic damaged-store replacement remains unfinished.
Reviewed transcript forgetting selects exact complete messages from loaded saved-
project chats, or only the active scratch chat. No copies are selected by default.
Canonical deletion and evidence suppression commit before transcript changes;
scope and message snapshots are rechecked after the asynchronous commit. Remaining
traces retain content-free accounting, sessions reset, working state rebuilds and
project dirty tracking requires a save. Earlier exports/backups, unopened projects
and external assistant retention are outside that removal.

The encrypted outbox commits with canonical changes. It keeps operation IDs
stable, cancels stale/revoked writes, quarantines uncertain paid ingestion and
compensates when a deleted source's write completes late. The bounded runner
leases only authorised scopes, rechecks bindings after asynchronous preparation,
and settles cancelled/late usage without importing returned records into canonical
storage. Uncertain ingestion is reconciled through complete matching-revision
reads, with six attempts before review; it never replays paid retain on a guess.
These fixtures remain gated on certified connections; no provider is active yet.
`maintenance-ledger.ts` reserves integer USD millionths transactionally in the
encrypted canonical worker before paid background work. Schema 12 adds an
encrypted budget/receipt table; migration backs up schema 11 first. Default
consent is off. Unknown, failed, cancelled and incomplete receipts retain their
reservation across restarts and date changes. A late complete actual receipt
reconciles once; reported estimates cannot become zero or overwrite a conflicting
final charge. The outbox calls durable preparation before dispatch, then rechecks
scope/binding state; settlement distinguishes an unsent request from unknown
delivered work. Settings expose estimated maintenance limits separately from chat
inference. They do not activate a provider or guarantee an invoice cap.
`providers/routing.ts` resolves one protected canonical job and binding against
a host-reviewed deployment certificate. Connection revision, namespace,
processing destinations, adapter version, scope, expiry and pricing must match
before credentials or reservations are read. It checks live consent again after
asynchronous preparation; reconciliation reads have separate reservations.
`worker-port.ts` narrows worker access to global and the active project, checks
leases before queued work and after replies, and repairs a late unsent claim.
Preparation and dispatch waits are bounded independently. Only the route whose
atomic dispatch mark succeeded can release its own marked-but-unsent charge;
a duplicate losing that race cannot release another route's pending spend.
An abandoned reconciliation read keeps uncertain ingestion pending, including
at the canonical completion boundary; a retry receipt cannot replay that write.
These helpers do not issue certificates or start processing on their own. The
reviewed deployment registry, live authorisation controller, scoped selection
and reconciliation scheduler own those permissions; endpoint health cannot
add a review.
The published adapter SDK is in `docs/context-provider-sdk.md`. Runtime
descriptor/response validation rejects forged receipts and unbounded or secret
content; outbox completion applies it to both normal and late results. Invalid
usage stays unknown rather than settling as zero. The acknowledged synthetic
conformance harness checks isolated global/project namespaces, retries, revisions,
deletion and declared temporal/export/scope-delete/reflection semantics. Paid
reflection requires separate host authorisation. Its report never certifies a
deployment: native access, derivative cleanup, processing destinations and billing
limits still need deployment evidence.
Connection setup stores encrypted metadata and authentication in the canonical
worker, behind host-issued scope leases. Public setup records omit credentials
and namespaces. Health tests are bounded and send no personal content; a successful
probe records reachability, never isolation/deletion certification. Disconnect
aborts tests before awaiting storage, destroys the credential, revokes bindings
and cancels their outbox. Late responses cannot reactivate it. Removing disconnected
settings preserves revocation/deletion receipts rather than claiming remote erasure.
Generic connection setup remains gated; only named host-reviewed profiles have
separate native activation flows.
Mnemosyne's pinned recall computes embeddings independently of vector scoring
weights, so an unverified connection cannot become local-only by passing zero.
The managed candidate now has bounded, supervised stdio and a private bridge:
scope snapshots rebuild and atomically replace a derived database, with monotonic
generations preventing stale activation. Cancellation kills the child, and the
next launch removes incomplete staged rebuilds. Upstream YAML overrides env flags,
so this profile writes its fixed local settings before loading the engine. The
engine at the v0.7.4 Hermes tag is 4.0.0b4; catalogue version fields distinguish
those releases and keep the beta out of the default profile. This remains a
beta upstream; its named Linux lexical profile has a separate host review and
scoped activation, rather than inheriting trust from installation.

Learning starts with suggestions, with scratch off. Narrow local cues recognise
user-declared preferences and project decisions after successful turns; no paid
extractor runs. Candidates are excluded from retrieval until accepted, expire
after 30 days, and forgotten/dismissed source events are suppressed transactionally.
Always apply instructions have a separate visible cost and never lose a required
pin through ranking. Changing pins, exclusions, plugin availability or forgetting
resets provider-held sessions and cancels affected work.
Context initialisation is shared at app startup, before settings or chat use.
Sends wait for local policy/pinned instructions with cancellation and a timeout,
never for R. A fresh profile with no protected files permits basic source
discovery without a keyring; an unreadable existing policy fails closed. Retrying
storage clears stale personal cards first. A late startup read cannot resurrect
an intervening correction or deletion.

Chat deletion removes solely derived memories before deleting the transcript.
Its review offers retention of edited or pinned records; accepted suggestions
alone do not count as independent edits. Failures keep the chat reviewable and
tombstones/suppression keep completed deletions blocked. Missing protected memory
storage blocks deletion of a non-empty chat unless main proved the store absent,
so unknown derivatives are not silently orphaned. Project/global scope changes
and memory revisions are rechecked throughout the operation.

The complete product specification remains unfinished. Read
`docs/context-implementation.md` for verified behaviour, the storage/platform
decision, immutable upstream API pins and the pending runtime/connection/runner,
dynamic plugin permission and release-certification work.
Do not describe the provider prototypes as production connections or installers.
Experimental Linux staging is wired through owner-only, leased IPC: public
artifacts have immutable checksums, bounded conditional-resume downloads and
exclusive staging. The private Python health check uses synthetic data and no
inherited credentials. Atomic activation and rollback keep separate runtime/data
pairs; cancellation preserves the active pair. Staging is not personal-memory
activation. The network spike optionally traces every private child with strace
and requires a detected socket positive control before accepting an empty trace.
Remote namespace ownership survives removal of connection settings, preventing
another scope from accidentally taking over the original bank.
Canonical-store migrations validate the existing key before making a verified
`VACUUM INTO` recovery snapshot; copying only the database file would miss WAL
content. Schema changes and namespace claims commit together. A failed backup
leaves the original schema intact. Recovery copies contain encrypted payloads,
require the original protected key and can retain earlier memories; restoring
them must reconcile newer deletion state first.
Conversation compaction inserts a bounded, source-linked derived working-state
card alongside the retained original user messages. Decisions are explicit user
declarations, questions need checking against originals and failures are prior
reports. Conflicting declarations stay separate. The card is rebuilt from
originals, never recursively summarised or promoted into personal memory.

### Historical delivery baseline (`ai-session-context.ts`, v1.15.3)

Every turn used to carry the session state as ONE block — the environment, the
console tail and the open documents — re-sent whole whenever any byte of it
moved. Full-message transports also pay for included tokens on each invocation;
rebuilding a prompt does not make its contents free. Caching affects price, not
context occupancy. For the Claude Code transport,
because what is sent once STAYS in the transcript and is re-read on every turn
after, so a block that is merely large becomes a bill that compounds.

Measured against the real CLI (2.1.268), six turns, four objects in the
environment, two documents open, Autopilot running two commands a turn:

| | turn 1 | turn 6 | six-turn total | growth/turn |
|---|---|---|---|---|
| before | 6,293 | 12,194 | 54,212 | +1,180 |
| after | 6,220 | 8,063 | 43,060 | +369 |

21% over six turns, and — the number that matters — **3.2× slower growth**,
because the waste was proportional to how long you had been talking. Straight-
lined to a twenty-turn conversation it is about 44%.

Two rules, which are the same rule twice: **say only what has changed, and
never say what the model already has.**

- **Sections are compared independently.** One console line moving used to
  re-send the full object listing; eleven identical copies of it over a twelve-
  turn chat, ~2,800 tokens saying nothing.
- **The environment is compared per OBJECT, not per block** — that is the grain
  at which it actually changes. Autopilot creating one result is a change, so
  the block IS sent; but a listing grows, and re-sending sixteen objects to
  report the one that is new is the same waste in a smaller box. This is what
  flattened the per-turn cost from "climbing to 1,118 tokens" to a level ~166.
- **The console is a delta, and the assistant's own lines are dropped from it.**
  `ConsoleEntry.origin === 'ai'` marks the code the assistant ran, the output
  that came back, and the note logged for every doc/UI/web call — every one of
  which it was handed as a TOOL RESULT moments earlier. With Autopilot on those
  are most of the console, so the block was largely the model's own output read
  back to it. Nothing on screen reads `origin`: the console is one record of
  what happened to the session, and who typed a line is not what a reader wants.
- **The mark advances past the lines that were dropped**, or they are
  reconsidered — and re-dropped — on every turn for ever. It is an entry id, and
  an id that is no longer in the history means `clearConsole` ran (ids keep
  counting up across a clear, so the old mark can never match again); the honest
  answer there is a capped tail, not silence.

**A partial update read as a complete one is the failure this has to avoid**,
and it is silent: a model told only about the console concludes the objects it
heard about three turns ago have been deleted, and tells the user so. Hence the
wording, which is load-bearing rather than decorative — the frame says a section
that is absent has not changed and that the console block is additions rather
than a replacement; the environment delta says the objects not named are still
there; and a section that goes genuinely EMPTY (every object removed, the last
document closed) is reported in words, because silence there would mean the
opposite.

`fullSessionContext` and its incremental counterparts now remain legacy accounting
fixtures. Active transports use the broker; do not reconnect these builders to
chat as a fallback because that would bypass source exclusions and selective
disclosure. The historical measurements below are not new broker quality results.

**The other half of the same problem was one tool result.** `list_ui_actions`
has no required argument, so calling it with none is what the schema invites —
and that answered with all 164 actions and every parameter of each, 41,833
characters. `truncateForModel` then cut it to 24,000 by dropping the MIDDLE, so
the model paid ~6,500 tokens — more than the entire system prompt — for a
listing with a hole in it, permanently in the transcript. Above `MAX_DESCRIBED`
(40, comfortably clear of `map`'s 24, so no group query is affected) the listing
is ids by group and a sentence saying how to narrow: 2,891 characters, every id
kept. A model that asks for everything does not yet know what it wants.


### Reviewed managed memory activation

`context/providers/activation.ts` owns expiring activation previews, current
scope/generation/revision checks and the scoped outbox runner. Main registers the
experimental Linux Mnemosyne review only after `managed-profile.ts` matches the
installed immutable artifacts and actual bridge hash to bundled offline/deletion
evidence. Native approval is independent of staging. Cloud health cannot create a
review. Future-only activation never implicitly imports existing canonical memory;
managed snapshots contain only approved binding revisions and exclude revoked
sources. Pause, disconnect and scope changes revoke asynchronous dispatch authority.
The paid maintenance policy is unnecessary for certified non-billable local writes.

The Mnemosyne bridge seals both old and staged SQLite indexes before atomic rename,
then removes staging locks. Otherwise stale WAL bytes can survive snapshot deletion.
A successful replacement removes corresponding derived indexes in older installed
pairs too. Canonical encrypted memory remains authoritative; derived SQLite is
readable and explicitly disclosed. Changing the bridge requires rerunning the
private offline/deletion spike and regenerating its bundled evidence hash.
`check-context.mjs` verifies native cancel/approve, future-only updates, deletion,
pause and disconnect in a synthetic Electron profile. This is experimental Linux
activation, not a stable all-platform release or an external provider certificate.
The named authenticated Linux local-server profile now supports protected-token
recall through the external adapter contract. Native writes require a current
outbox job and its exact canonical snapshot; workspace/policy changes invalidate
server authority. Its reviewed evidence is in
`docs/context-mnemosyne-local-server-evidence.json`. Its external endpoint now
uses authenticated Streamable HTTP MCP, with initialisation, bounded tool calls,
Host/Origin/version validation and isolated bank tokens. Arbitrary remote MCP
deployments still require separate review.
Scoped migration uses encrypted schema-17 journals, includes previous bindings
in the same bank and separately reviews old-copy retention/deletion. Snapshot
profiles reconcile uncertain old writes by bounded read barriers; other adapters
require terminal receipts. Keep unresolved writes blocked rather than replaying
them. Reconciliation uses an explicit host-only read purpose: the proposed
cleanup binding does not exist yet and cannot supply a canonical snapshot.
The read-only serial barrier can resolve a cancelled old write, but cannot
repair or ingest anything. Actual cleanup still uses its separately approved
delete-only binding and current protected snapshot.

The raw Hindsight API still fails physical retention; that failure remains
recorded. `hindsight-local-server.py` is a separate operator-started Linux
profile, with a pinned private environment and PostgreSQL distribution. Native
folder review checks actual interpreter/dependency/library/source fingerprints,
the owning process and its listening socket, private credentials and authenticated
health before the registry can register this exact local deployment. A generic
URL, plugin manifest or server self-report cannot do so. PostgreSQL is accessed
only through a private Unix socket; the public API has per-launch, per-bank
authentication. In-process lexical features implement the upstream public
embedding interface; there is no embedding HTTP listener, model download or
paid processing. The ASGI retention boundary serialises operations, fsyncs a
dirty journal before mutation, drains all API/worker pools and runs quiescent
maintenance before returning an acknowledgement. Rewriting only public tables
was insufficient: ANALYZE's pg_statistic copies and WAL also need cleanup.
Failed cleanup blocks reads; restart recovers before reopening the API. A
surviving database is adopted only after exact owned-process/argument checks.
Database fsync, synchronous commit and full-page writes are on. Explicit
reconnection preserves the bank and carries forgetting tombstones to the new
approved binding, without replaying cancelled ingestion. See
`docs/context-hindsight-local-profile.md` for the operator boundary and evidence.
Runtime pointer recovery now matches the immutable installation record in the
same provider/data pair before current-state reporting or rollback health. A
crossed, incomplete or foreign-profile restore cannot launch a binary or replace
the surviving pointer. JSON field order is not identity; validated metadata is
normalised for comparison. Installed artifact inventories now hash actual files,
paths and executable bits, reject links and are checked before native launch.
Eight bounded file readers preserve the original digest order while avoiding
the serial verifier's cold-start deadlock: its ~3.3 s verification exceeded the
unchanged 3 s recall deadline and was cancelled before readiness on every retry.
The direct verified cold probe now takes ~2.1 s on the reference machine.
Older installations without that inventory need restaging; a failed optional
review must withdraw its certificate without hiding canonical memory/settings.
Activation has a fsynced pointer journal, a canonical encrypted checkpoint and a
post-switch health check. Failure/cancel restores the prior compatible pair;
startup recovers a crashed pointer transaction. Real ENOSPC and SIGKILL fixtures
verify the old runtime, readable snapshot and canonical records survive. Linux
parent-death supervision and the exclusive Python store lock prevent abandoned
writers from outliving the host; recovery reaps only an exact private legacy
runtime layout and rechecks process start time before signalling.

Ordinary canonical saves no longer decrypt an entire scope unless a recognised
user preference needs supersession checks. The Mnemosyne bridge uses pinned
upstream remember_batch plus a canonical-ID mapping, rather than repeated
single-row inserts. Staged databases use in-memory journalling, then seal/fsync
before rename; the committed store retains its durability boundary. Missing or
stale approved snapshots queue repair through the protected outbox. No read
directly rebuilds or imports unapproved/paused edited revisions. The 10,000-record
reference comparison and strict network/retention fixtures are distinct runs:
ptrace timings do not establish capacity latency. Native acceptance waits use
`waitForAsync`: Playwright's synchronous waitForFunction treats even a Promise
resolving false as truthy, which previously allowed tests to race activation.
Provider reload may invalidate an in-flight status read without changing the
workspace. The SDK fixture retries that explicit refresh error only while the
original workspace lease still matches; other errors and real scope changes
remain failures. Packaged plaintext scans recurse into encrypted migration
backups instead of assuming the canonical directory contains only files.

### Plugin context SDK

`context.sources` declares plugin-relative Markdown resources;
`ctx.context.publish` provides bounded dynamic own-resource evidence. Both require
separate `context-source` consent. `context.required` preserves capability names
so older hosts reject source manifests instead of dropping their resources.
Context-only skills/sources are real contributions and their declared Markdown
must be included in store packages. Static sources retain SHA-256 observations,
not bodies; reads recheck the current file and refuse changes until reload.

`context/sources/plugin.ts` owns activation sessions, namespaced document IDs,
untrusted provenance, per-publication host revisions, 64-source limits, two-second
reads and 100,000-character responses. Search uses local descriptors and gives
no query to callbacks. A callback gets only cancellation; no personal context
or memory API is supplied. Disable/reload revokes old owners before disk/code
waits. Workspace changes abort and remove dynamic resources while installed
Markdown remains application reference. Republishing emits the plugin revision
signal and invalidates retained assistant sessions. Existing broker exclusions,
secret redaction and token budgets still apply.

Plugin preferences now retain explicitly approved permission sets. Legacy enabled
flags preserve their existing permission categories once and grant no new context
sharing. Added update permissions disable the plugin for review; the enable switch
rechecks the displayed manifest against disk. Lifecycle operations are serialised
so an overlapping reload cannot reinstall revoked owners. Main's native-service
boundary checks approved permissions too. This is enforcement of host APIs within
the existing soft code sandbox, not isolation from a hostile renderer plugin.
`docs/context-plugin-sdk.md` documents authoring and
`scripts/check-context-plugin-sdk.mjs` drives the real built app in a synthetic
profile. The remaining stage 3–4 gates are in `docs/context-stages-3-4.md`.

### Managed recall and selected import

`ContextBroker.searchWithMemory` adds approved ordinal provider matches to local
ranking; synchronous discovery remains available for compatibility tools. Main
recall currently permits only the reviewed non-billable managed-local search
operation, with a shared startup/search deadline, cancellation and circuit breaker.
It returns IDs/revisions only after canonical binding snapshot validation. The
broker rereads current local memory, so provider prose is never new authority.
Project-first routing avoids sending project queries to a separate global provider.

Selected imports use the same expiring native review, but `importBinding` checks
an existing exact active binding and queues only selected committed revisions.
From 1.16.19, plugin skills support addressable Markdown sections, mandatory
section/dependency delivery, minimum app versions and current evidence category
prerequisites. Declarative provider contributions reference host-reviewed profile
IDs under the separate `memory-provider` permission. The native host rechecks
installed bytes and grants; disabling/changing descriptors cancels routes and
pauses contributed bindings. Unknown profiles remain unavailable. Context source
callbacks never receive personal memory. See `docs/context-plugin-sdk.md`.

Provider migration uses schema 17's encrypted `provider_migrations` journal.
It atomically pauses old primary routing, queues the exact committed selection
and tracks current destination revisions across restart. Switching to built-in
memory sends no provider content. Old copies require a separate retain/delete
decision. Cleanup bindings permit deletion only and are pinned to the reviewed
connection revision. Unresolved old ingestion blocks deletion; cancelled
migrations preserve canonical memory and transmitted copies. Linux UI fixtures
cover native review cancellation and built-in migration; storage/controller
fixtures cover interrupted copying, stale selection and deletion scope.

`bindingSnapshot` owns a namespace generation independent of whole-scope memory:
importing an unchanged record changes the approved subset without changing the
canonical scope generation. Include binding policy and selected revisions in its
digest; validation must use `bindingSnapshotCurrent`. Initialise above old scope
generations to avoid a stale generation when rebuilding older experimental caches.
Forgetting purges managed copies in all installed pairs even after disconnection,
without native execution. Those indexes are rebuildable; canonical data is retained.

Schema 13 commits an encrypted content-free local purge receipt with the deletion
tombstone. Hash namespace receipt IDs too: a plaintext SQLite primary key would
otherwise leak the namespace even when its payload is protected. A single main
runner resumes private-file cleanup after restart, caps automatic failures at six
and exposes a current-scope settings retry. Keep completed generation metadata so
a late completion cannot acknowledge a new purge that reused the same namespace.
This does not reconnect remote stores or grant native execution. Old tombstones
migrate to a safe derived-cache purge after the standard encrypted backup.

`requestInvocation` handles explicit HTTP context-size rejection once per user
turn on full-message transports. Rebuild the rejected inference, never replay
already executed tools. Preserve all user originals, rules, schemas, tool pairs,
reasoning and working-state cards; remove only optional earlier assistant prose
with a searchable omission receipt. Recheck cancellation, scope and budgets before
retry. Never retry a non-shrinking reconstruction, another context rejection,
authentication/rate limiting or an accepted partial stream. Responses checks
count the actual namespace/schema and output envelope sent to the provider.
This is not certification of CLI-owned internal invocation occupancy.


Context discovery caches default document/environment descriptors in compact
indexes keyed by immutable inventories plus scope/runtime/disclosure revisions.
Selected readers revalidate before and after asynchronous reads. Bind R-generation
checks at the selected reader, never by closing over a reused scan card; metadata
scans must not allocate stable wrapper objects for every environment candidate.
The production-adapter benchmark reports manager and input-store RSS separately.
Warm discovery uses host-owned 128-bit trigram filters on packed descriptions
before decoding irrelevant cards. These filters index metadata only. Collisions
retain extra candidates; they cannot confer a rank or permission. Partial-title
matches, provider-ranked IDs, short/Unicode queries and descriptions requiring
redaction retain the ordinary path. Changed materialised metadata invalidates its
filter. Empty and filtered scans still check scope/privacy before and after
iteration; candidate ranking, counts and every selected reader remain checked.
Ranking does not repeat the packed producer's signature filter. Native profiling
showed temporary lower-case summary copies dominating broad-search allocation.
A spare packed bit certifies ASCII summaries; escaped case-insensitive literal
patterns then preserve scoring without those copies or another retained text
index. Unicode and edited metadata keep the normal lower-case path. Empty identity
metadata reuses one frozen object instead of allocating one per scanned document.
The reference corpus also exposed ordinary UI costs. Tab strips above 200 buffers
render a fixed-width visible window and scroll selected documents into view.
Console histories above 2,000 entries use TanStack's measured virtual rows; store
originals, source discovery and complete-history copying retain every entry.
Variable-height/wrapped output is measured rather than clipped to an estimated
height. Normal-layout checks exercise first/last tabs, older output and copying
through a synthetic clipboard, alongside latency and resident-memory targets.

Schema-16 startup may repair only recognised `inference_usage_scope` secondary
index damage after authenticating current encrypted rows and hashing all canonical
and privacy tables. Preserve the original database/WAL/SHM in private recovery
copies before mutation; verify integrity and unchanged rows before committing.
Unrecognised damage or unreadable forgetting markers fail closed. Never salvage
canonical state from an old backup to perform automatic repair.

Packaged context acceptance uses a private marked synthetic profile selected by
`OURGEO_CONTEXT_TEST_PROFILE` before main handlers initialise. The harness refuses
old packages lacking this guard before launch and verifies the actual user-data
path. OS keyring overrides are confined to these validated profiles. Windows/macOS
acceptance is deferred to native sessions; follow `docs/context-platform-acceptance.md`.
Linux acceptance separately checks actual FUSE mounting, the packaged desktop
template through a private GTK registration, and dpkg install/upgrade/removal in
an isolated Debian filesystem. A launch wrapper must preserve debugger stderr
and share the harness's marked profile path with the guest. Host desktop/keyring
services remain a stated boundary; these tests cannot certify their network use.
Fresh-profile Chromium net logs exposed unsolicited Hunspell dictionary downloads.
Window `spellcheck=false` is insufficient because the session is initialised
earlier. On Linux/Windows, disable the session spellchecker and clear its language
list before constructing windows; macOS keeps its native spelling behaviour.
Cold diagnostic captures verify zero dictionary requests. The subsequent local
HTTP/console transport fix removes Chromium route probes from the local profile.
`scripts/native/strace-ring-observer.h` extends pinned strace 7.2 with payload-free
SQE opcode/flag observation at syscall entry. It matches kernel ring identity and
mapped queue offsets, validates all submitted entries, and accepts only observed
epoll-control operations. Unknown operations/layouts, SQPOLL and registrations
remain opaque; a ring CONNECT canary must fail. No runtime syscall is blocked or
exempted to obtain a passing audit. The collector verifies its observer and tracer
hashes before trusting annotations; ordinary strace cannot grant that verdict.
Schema revisions bind scope/runtime/execution, shape and column disclosure.
Learning cached column names or receiving a late inventory replacement is not an
R mutation; including those cache fields in the revision caused a false stale
failure during the new transport's actual historical-join acceptance scenario.
