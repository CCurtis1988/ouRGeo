# Dedicated Hindsight local profile

`hindsight-local-chunks-v1` is the reviewed **operator-started Linux x64**
connection profile. It uses Hindsight 0.10.2 from commit
`5fc4ce20917b916240cef27c212c387a177f115b`, a separately installed private Python
3.14 environment and the PostgreSQL 18.1 distribution recorded in
[`context-hindsight-local-evidence.json`](context-hindsight-local-evidence.json).
It is an external local server, not a managed Hindsight installer. The built-in
memory manager works without these dependencies.

The release review covers the exact installed dependency and PostgreSQL file
fingerprints, interpreter and three launcher/helper source hashes. A version
string, health response, plugin manifest or operator checkbox cannot substitute
for these checks. Other distributions and hosted deployments require their own
review. The current dependencies occupy 898,496,405 bytes and PostgreSQL occupies
73,610,945 bytes, before the database, interpreter and installation overhead.

## Processing and deletion

The profile retains approved canonical text as chunks. A small implementation of
Hindsight's public `Embeddings` interface computes deterministic lexical token
features in process. It downloads no model and makes no semantic-quality claim.
Extraction, reflection, observations, telemetry and sync are disabled. Recall
uses the upstream API and RRF, resolves canonical IDs/revisions through document
metadata, and is checked against the current approved canonical records by the
desktop. No paid processing runs in this profile. The separately chosen chat
assistant still receives selected context under its own settings.

The API binds only numeric IPv4 loopback, validates Host/Origin and authenticates
each host-created bank with an unpredictable per-server-launch secret. A bank's
token cannot access another bank or administrative/reflection APIs. PostgreSQL
has **no TCP listener**: the server accesses it through a private mode-0700 Unix
socket directory. No database credential is placed in a process argument. The
dependencies run as trusted native code with this account's machine access;
this is not an OS security sandbox.

Mutations are serial. Before changing upstream state, the gateway fsyncs a
content-free retention journal. Before returning an acknowledgement it drains
the API and workers, closes their pools, rewrites live PostgreSQL relations and
statistics catalogues, and advances/checkpoints WAL with recycling and archiving
disabled. It then opens a fresh API and removes the journal. Active clients,
replicas, replication slots and query logging make maintenance fail closed.
Interrupted or failed cleanup blocks reads until recovery completes. PostgreSQL
runs with fsync, synchronous commits and full-page writes enabled.

The original raw API fixture still fails its physical deletion audit. Its HTTP
deletion response is not the retention guarantee used by this profile. Cleanup
does not promise erasure from storage hardware, filesystem snapshots or
independently made backups. This deployment has no replication/archive/backup
service; operators must separately honour retention for any copies they create.

## Starting and connecting

Provision the private dependency environment separately from the immutable
Hindsight source pin above. The tested dependency set is recorded in the release
evidence and [`context-hindsight-requirements.txt`](context-hindsight-requirements.txt);
changing it requires rerunning qualification and a host-reviewed
release. `pg0`'s packaged PostgreSQL distribution can be provisioned separately;
the launcher runs its verified PostgreSQL binaries directly and does not invoke
pg0's development supervisor or download anything at startup.

Keep `hindsight-local-server.py`, `hindsight-gateway.py` and
`hindsight-retention.py` together, from this ouRGeo release's
`electron/main/context/` directory (also bundled in `out/main/`). Choose a new
empty private server directory. For an existing qualified environment:

```sh
mkdir -m 700 /absolute/path/to/private-server
/absolute/path/to/venv/bin/python -I -B /absolute/path/to/hindsight-local-server.py \
  --state /absolute/path/to/private-server \
  --postgres /absolute/path/to/postgresql-18.1/bin/postgres
```

The server chooses an available API port; `--port` can specify one. It creates
its own dedicated database in that directory and refuses unrelated pre-existing
contents. It clears ambient provider credentials/configuration before importing
Hindsight. Stop it normally with SIGTERM; after a crash it verifies and reconnects
only its exact surviving database process. The retention journal is recovered
before API reads become available.

In **Settings → AI Assistant → Advanced → Mnemosyne and Hindsight connections**,
choose **Review dedicated Hindsight** for About you or the saved project. Select
the private server directory. The native host checks ownership/permissions,
running Python arguments/identity, listener ownership, pinned distributions,
launcher hashes and authenticated health. It stores the bank token in protected
memory storage. No secret or server folder is an assistant tool parameter.

Review activation separately. Existing memories stay local until selected for
import. If another provider is active, use the migration controls after the
connection appears; migration separately reviews old-copy deletion. Pause and
disconnect stop new desktop requests and preserve canonical memory. They do not
erase previously transmitted copies. A cold desktop restart requires a new
native folder review. Explicit reconnection retains the bank identity, pauses
old authorisations and carries outstanding forgetting tombstones into the newly
approved binding without replaying ingestion.

## Qualification

The real upstream API/database conformance suite, authentication/namespace
negative controls, actual SIGKILL during a journalled mutation, restart, unrelated
bank preservation and physical scans of all fixture PostgreSQL files pass.
The strict whole-process audit observes connected writes and io_uring inside a
loopback-only namespace with positive/negative controls. Its recorded boundary
and source hashes are in the evidence JSON; this is not a hosted-service or
other-platform certificate.

Reproduce with separately provisioned assets:

```sh
node scripts/check-context-hindsight-isolated.mjs --gateway \
  --python /absolute/path/to/venv/bin/python \
  --postgres /absolute/path/to/postgresql-18.1/bin/postgres
python3 scripts/check-context-hindsight-gateway.py
node scripts/check-context-network.mjs --fixture hindsight-local \
  --strace /absolute/path/to/verified-ring-observer/strace
node scripts/check-context-plugin-sdk.mjs --managed-profile --local-server --hindsight
```

The native fixture uses this repository's separately provisioned `.cache` assets,
synthetic records and a fresh guarded Electron profile. No real user profile,
account or model is used. Failed earlier runs remain evidence of the catalogue,
request-delivery, listener-reuse and crash-recovery defects they exposed; they
are not counted as passes.
