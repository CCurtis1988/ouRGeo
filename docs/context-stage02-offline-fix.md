# Stage 0–2 local-runtime fixes (1.16.17)

This follow-up resolves the two engineering issues identified in the 1.16.16
offline audit. Earlier failures remain in
[the previous evidence](context-stage02-followup-evidence.json). Independent
review, participant testing and the deferred native-platform work retain their
existing requirements; this change does not turn those unknowns into passes.

## External IPv6 probes

Chromium's resolver checks global IPv6 reachability even for literal loopback
requests. Local R HTTP, R-console WebSockets and local-model HTTP therefore
triggered external UDP `connect()` attempts. Blocking them at the OS or omitting
them from the audit would not satisfy the no-attempt requirement.

Loopback HTTP now uses `node:http.request` with literal destinations. Renderer
HTTP and R assets enter that path through the application's protocol handler,
before Chromium resolves them. The R console uses a main-process WebSocket bridge
which accepts only the currently running R port. Remote HTTP(S) keeps the existing
Chromium transport. Local redirects must stay at the same origin; they cannot
silently move content or credentials to a remote server or another local service.

This deliberately avoids Node's global fetch and its implicit five-minute response
timeouts. A real synthetic server held response headers for **320 seconds**;
the new HTTP path returned the complete streamed response. Regression tests cover
request bodies, binary/Unicode output, compressed responses, empty/HEAD responses,
redirect refusal, cancellation and severed streams. Cancelling decompressed output
also closes the original socket.

The native fixture exposed a separate schema-cache race. Learning cached column
names, or receiving a late inventory replacement, could invalidate a current
schema read despite no R mutation. Schema revisions now bind scope, runtime,
execution, shape and disclosure rather than column-cache hydration. Changes to
any of those actual source or permission boundaries still revoke the observation.

## Inspecting I/O rings

Ordinary strace records ring setup/submission syscalls without seeing submitted
operations. Libuv uses these rings for batching readiness registrations;
`UV_USE_IO_URING=0` does not disable that batching in the bundled runtime.
Runtime identity alone cannot prove a particular queue contains no networking.

The pinned strace 7.2 extension reads submitted SQE opcodes and flags at the
syscall stop. It matches kernel ring identity to its mapped queue, validates
layout, indices and submitted counts, and emits no buffers, source text,
addresses or `user_data`. Only completely observed `IORING_OP_EPOLL_CTL` entries
without flags qualify as readiness-only. Unsupported layouts, SQPOLL, registered
rings, unreadable entries and other operations remain opaque and fail the audit.
The collector checks source, observer and executable hashes before trusting the
annotations. Ordinary traces cannot acquire that verdict just by containing a
marker.

Two native ring canaries validate the boundary: readiness registration must pass;
a hidden `IORING_OP_CONNECT` must be rejected. The original direct outbound canary
also remains required. No syscall is disabled, intercepted or exempted to make
the application capture pass.

Build the observer from a supplied, unmodified strace 7.2 source tree, then pass
the printed executable path to the collector:

```sh
node scripts/build-context-network-tracer.mjs --source /path/to/strace-7.2
node scripts/check-context-network.mjs --strace /printed/path/to/strace
node scripts/check-local-transport.mjs --seconds=320
```

The collector traces launch through shutdown of the marked synthetic application
and its descendants inside a loopback-only namespace. Shared desktop/keyring
services accessed through Unix IPC remain outside that process-tree capture.
Production ingestion, other panel combinations and separately booted desktop
sessions retain their stated validation boundaries.

## Engineering closure and qualification

The final build passed **2,479 tests in 246 files**, type checking and lint
(zero errors, 37 existing warnings). Full native acceptance passed through a real
FUSE-mounted AppImage and the installed Debian binary. Debian installation of
1.16.16, upgrade to 1.16.17 and removal preserved the actual protected synthetic
profile. Private GTK desktop registration, launch and local memory edits passed.
All these captures match the final compiled archive hash.

The complete packaged syscall capture also passed: **zero external connection
attempts**, **837 decoded readiness-only I/O-ring calls**, **zero opaque calls**,
and successful full acceptance. All three canaries verified their expected
boundaries. Earlier partial-audit passes with failed acceptance are retained as
failed overall runs; neither those nor ordinary offline operation substitutes
for this final combined result. Search ranking also avoids repeating the packed
producer's metadata filter. Native CPU profiling identified temporary lower-case
copies of mixed-case summaries as a major allocation cost. A spare packed flag
certifies ASCII summaries, allowing escaped case-insensitive literal matching
without retaining another text index. Changed or Unicode metadata uses the
existing lower-case path. Scores, ordering, counts and eligibility checks retain
their semantics; parity tests cover punctuation, Unicode and edited cards.

The normal-layout native development scale run passes at the declared
**1120×900 viewport**: warm search p95 **88.0–186.1 ms**, additional manager
resident memory **61.1 MiB**, no schema reads or auxiliary sources for unrelated
turns, and all first/last-tab, older-output, multiline-height and complete-history
copy checks. The corpus retains 10,000 objects, 100,000 console events, 100,000
document buffers and 200 plugins. Slower wide/reference-window runs and diagnostic
CPU sampling remain preserved; sampling measurements are not the final certificate.

The applicable phase 0–2 implementation is the built-in Linux broker, budgets,
conversation/project/global memory, save/discard, retention, corrections, deletion
and local recovery. Optional provider deployment/migration and SDK certification
belong to subsequent phases.

The cost contract in specification section 10.6 permits explicitly labelled
estimates when provider guarantees are unavailable. The implementation commits
reservations before dispatch, preserves interrupted requests across restart,
reconciles available counters once and refuses opaque/unbounded processing while
estimated limits are enabled. It does not invent a provider invoice, retrieve
unavailable historical counters or promise an unenforceable hard invoice cap.
Provider-side billing/internal-occupancy evidence remains a qualification
boundary; the configured subscription cannot supply that proof.

Likewise, unreadable canonical/deletion data keeps retrieval closed and preserves
the damaged originals. A backup cannot safely replace an unreadable deletion
ledger automatically. Healthy-store restore, authenticated secondary-index repair
and explicit recovery warnings remain the supported implementation.

The [closure checklist](context-stages-0-2.md) separates implementation completion
from the still-open qualification requirements. Known model-answer failures remain
in the development evidence for independent review. No human results or provider
billing guarantees have been fabricated or waived.

Upstream references: [Electron's transport](https://www.electronjs.org/docs/latest/api/net/),
[Chromium's resolver](https://chromium.googlesource.com/chromium/src/+/refs/tags/146.0.7680.72/net/dns/host_resolver_manager.cc),
[libuv's readiness batching](https://github.com/libuv/libuv/commit/69bad8201b3c463b2c7d882d9055a2fa8624e180),
[kernel ring layouts](https://github.com/torvalds/linux/blob/master/include/uapi/linux/io_uring.h).
