# Context memory provider adapter SDK

API version: 1. This contract and its reusable fixtures are available in the
working tree. Plugin provider registration and external deployment activation
remain gated on the remaining [delivery requirements](context-implementation.md).

An adapter implements `MemoryProviderDef` from
`src/lib/context/providers/types.ts`: a declarative descriptor and one typed
`dispatch(request, host)` method. Operations are probe, search, read, upsert,
delete by source, delete-scope, export and optional reflect. The scope deletion
request has no namespace parameter: only the host can resolve its destination.
Declare unsupported operations as false
capabilities and return `UNSUPPORTED`; a successful empty mutation receipt is
not an implementation.

ouRGeo owns canonical records, scopes, credentials, namespaces, permission
checks, prompts and actions. The model receives broker tools, never this host
interface. The host supplies a resolved namespace, cancellation signal, timeout,
policy revision, result/token limits, operation ID and processing authorisation.
An adapter returns records or attributed derived evidence. It cannot replace a
system prompt, inject tools, select another scope or change processing consent.
Provider records are never the only copy of user-created memory.

`providerDescriptorIssues`, `providerRequestIssues` and `providerResponseIssues` in
`src/lib/context/providers/validation.ts` supply runtime shape/boundary checks.
Diagnostics contain fixed codes rather than private excerpts. They reject
unsupported descriptor versions, undeclared fields, malformed capability flags,
forged operation receipts, secrets recognised by the shared redaction policy,
invented authority, invalid records/timestamps/usage and oversized responses.
Response budgets include the serialised envelope. Unknown monetary/token usage
remains unknown; no zero-cost or invoice-cap guarantee follows from a receipt.
Request validation rejects undeclared operations, extra endpoint/namespace
fields, malformed time filters, duplicate deletion IDs, unapproved reflection
and non-active/unbounded canonical writes. The host still matches writes to its
committed canonical snapshot; shape validation cannot grant scope access.
The outbox runner checks descriptors and payloads before dispatch and validates normal and
late receipts before completion or usage settlement. Malformed receipts leave
ingestion pending and deletions retryable; they cannot confirm a deletion or
invent zero usage.
Paid outbox routes also require `beforeDispatch` to durably mark their
reservation. The runner rechecks scope and bindings after that asynchronous
step. `settle(result, dispatched)` distinguishes a request that was never sent
from missing usage after dispatch. `prepareMaintenanceRoute` composes these
hooks with the encrypted worker ledger; it cannot grant provider access or
processing consent. Each billable reconciliation read needs its own reservation.
Monetary receipts must declare `usage.currency: 'USD'` when supplying `cost`.
Other currencies require a separately reviewed conversion; absent currency or
pricing remains unknown. Only a complete actual receipt releases the remaining
reservation. Estimated/interim receipts retain headroom rather than claiming
that background processing has finished.

These checks do not prove scope isolation, source authority, endpoint safety,
deletion of derivatives, offline behaviour or billing idempotence. Adapters must
still check authorisation and abort state before and after asynchronous work.
Main resolves destinations and namespaces from approved settings, and validates
returned evidence against canonical scope/revision state before broker delivery.
Native adapter code is trusted code with machine access, not an OS sandbox.

## Reusable conformance fixture

`runProviderConformance` in `src/lib/context/providers/conformance.ts` accepts
two explicitly isolated synthetic fixture scopes. Each supplies an adapter,
a host factory and a `commitCanonical(records)` callback. The callback changes
only fixture canonical records; it must never point at the user's real store.
Host factories keep their namespace stable and use the requested operation ID.
Dedicated-instance adapters may supply a separate instance for each scope.
An optional fixture `projectId` exercises project records; omit it for global
records. It must identify a synthetic project, never an active user's project.
Provision fresh test namespaces and processing budgets outside the model; do
not use an existing personal/project binding.

```ts
const report = await runProviderConformance({
  writesAcknowledged: true,
  scopes: {
    first: await createIsolatedFixtureScope(),
    second: await createIsolatedFixtureScope(),
  },
})
```

`createIsolatedFixtureScope` is an adapter-specific fixture factory, not a
library helper. It returns `isolatedFixture: true`, `provider`, `host` and
`commitCanonical`. The fixture creates random synthetic record IDs, uses no
real chat/data and deletes only its own IDs during cleanup. It does not call
reflection or request paid processing. If a provider's ordinary ingestion
requires paid processing, the host must separately authorise and budget it;
acknowledging synthetic writes does not provide that permission.

Checks cover response contracts, permission revocation, cancellation, canonical
ingestion/retries, cross-namespace reads/search, bounded results, revision
replacement and source deletion while preserving unrelated records. Cleanup
requires verified absence of the fixture records. Offline or incomplete reads
do not establish deletion. Timeouts abort the supplied operation; an adapter
that ignores cancellation may continue remotely, so its processing/quota and
late-result behaviour still require deployment review.
Declared temporal search, scoped export, scope deletion/retry and reflection
permissions/lineage have separate checks. Missing capabilities are reported as
unsupported. Paid reflection is skipped unless the fixture host separately
authorises it; acknowledging synthetic writes never increases that budget.

Reports have `certification: 'not-issued'`. A failed capability/lifecycle check
blocks endorsement; unavailable write/deletion capabilities remain unsupported.
Passing fixtures are evidence for certification, not permission to activate
personal memory. Further gates include derivative cleanup audits,
concurrency and ingestion/deletion races, transport/authentication, cost limits,
crash recovery and supported platforms.

Run the adversarial fixture tests with:

```sh
npx vitest run src/lib/context/providers/conformance.test.ts
```

The managed Mnemosyne packaging spike also runs the reusable fixture against
the pinned private Python sidecar. It requires the separately downloaded,
verified test assets documented in the delivery record:

```sh
node scripts/spike-context-mnemosyne.mjs
```

That command uses temporary namespaces and canonical snapshots, never a real
profile. Optional OS network observation uses the independently verified strace
executable and a positive control; see the delivery record. External Hindsight
and Mnemosyne connections remain prototypes until their deployments pass the
additional gates. A generic MCP server or HTTP URL is not a certified provider.

## Protected host routing

The main-process resolver in `electron/main/context/providers/routing.ts`
requires a host-owned certificate for the exact binding, adapter version,
connection revision/digest, scope and processing destinations. Reachability,
endpoint self-description and this conformance report cannot issue one.
Operations need an explicit non-billable profile or an unexpired bounded paid
estimate. Paid writes and reconciliation reads reserve separately before
dispatch. Credentials stay behind purpose-specific worker operations.

The worker bridge intersects requested scopes with global and the active saved
project, checks leases before dispatch and after replies, and returns a late
unsent claim to the queue. Cancellation or a deadline prevents late preparation
from dispatching. Duplicate preparation cannot release another invocation's
dispatched reservation. Invalid, absent or incomplete monetary receipts remain
unknown and reserved.
Abandoned reconciliation keeps the original write pending; retrying a read is
never permission to repeat uncertain ingestion.

These are implementation helpers and synthetic regression gates. No production
certificate registry, provider activation or automatic ingestion is enabled by
constructing a bridge, configuring a connection or passing these tests.


The experimental managed Linux Mnemosyne profile has a host-owned reviewed
activation path. It checks immutable runtime artifacts and bridge bytes against
bundled OS offline/deletion evidence, then requires native scope approval. It can
synchronise future committed canonical updates without importing old records.
Pause/disconnect revoke access. A provider factory may be asynchronous; authority
is checked again after construction before dispatch. Managed namespaces are
host-owned, and snapshots include only approved writes in that binding. This
review does not certify an arbitrary MCP endpoint, external deployment, plugin
adapter or external provider recall path. See the delivery record for remaining gates.


Managed recall is now exposed through broker search as canonical ordinal matches.
Search needs a separately reviewed operation; external recall is still gated.
Results are scoped and revision-validated before ranking, with a bounded deadline,
cancellation and local canonical fallback. No bank ID or endpoint is accepted
from assistant tools. Selected imports have a native review and atomic worker
commit; they do not alter the provider's future-update policy. Namespace snapshot
generations must account for approved import selections independently of canonical
scope generations. Otherwise an unchanged record imported later cannot rebuild
an already materialised provider index safely.
