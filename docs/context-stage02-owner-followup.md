# Stage 0–2: owner feedback and Linux follow-up

Version 1.16.16 addresses the owner’s acceptance feedback for items 4–7. The
original observations remain in [the acceptance pack](context-owner-acceptance.md).
The [machine-readable evidence](context-stage02-followup-evidence.json) preserves
measurements, implementation hashes, model answers and failures. Stages 0–2 are
**not fully certified**.
The owner retained the closure requirements, then deferred independent review
and the participant study until a review team is available. Those gates remain
open. The [qualification handoff](context-qualification-review.md) preserves the
review packet and study sheet for that later work.

## Changes prompted by the owner

- **Item 4:** ordinary exact object names in schema requests now select current
  schema without requiring square brackets. Ambiguous names remain unresolved.
  Real Electron checks inspect the same object with a column excluded and then
  allowed, verifying that its column metadata actually reaches the model fixture.
- **Item 5:** overlapping project privacy loads cannot report a newer pending load
  as an empty Error or overwrite its result. Genuine failures keep retrieval
  closed; successful retry clears the privacy warning. Direct library memories
  have no original transcript copy unless the text also occurred in a chat.
- **Item 6:** the supplied screenshot shows the intended identity choice. Open as
  a copy creates independent memories; Open as this project retains shared
  identity. Instructions now name both choices rather than relying on file names.
- **Item 7:** Conversation has local add, edit, forget, move, export and Always
  apply controls. Notes stay with their chat and persist inside saved projects.
  Scratch notes have scratch-chat lifetime. Tombstones prevent a removed derived
  card reappearing on reload. Original transcript messages remain intact and may
  still contain the instruction; removal explains that limit. Moves save the
  destination first and preserve the source on destination failure.

Chat-only instructions stay out of durable project/personal learning. Manual chat
notes cannot cause an external memory-provider query when no canonical authorised
project/personal memory exists. Changes invalidate retained sessions and stop an
in-flight answer before corrected notes can be used on the next turn. Selected
Always apply notes appear in the normal context receipt and share its instruction
budget; excess instructions produce a recovery message rather than being dropped.

Historical console evidence explicitly states its recorded execution time and
that it does not establish current schema. Recognisable recorded joins can also
select their two unambiguous current input schemas, within the normal effort,
privacy and lookup limits. First inspection can populate unknown column metadata;
prefetch may rebind once to the resulting current revision. A real R fixture
fails a join, repairs its schema, then verifies delivery of the historical failure
and repaired current schema. This does not prove general model compliance.

## Verification

The final full suite passed **2,469 tests in 244 files**, type checking and the
production build. Lint has **zero errors and 37 existing warnings**. Linux AppImage
and Debian artifacts built successfully. Real Electron acceptance passed,
including direct memory in both locations, conversation correction/moving/forget,
project-bundle persistence, delivery of the current correction, privacy filtering,
source exclusions, copy identity, transcript review, recovery and native protected
storage. Synthetic requests use a loopback model fixture; no model inference is
used for library writes.

The 1.16.16 AppImage passed disposable installation, full acceptance through an
actual FUSE mount, and cleanup. The native filesystem type was verified, and the
archive hash matched the unpacked artifact. The packaged desktop template also
passed private XDG registration, GTK launch, protected memory add/forget with zero
model calls, and removal of that registration. Regular menus and file associations
were untouched. The host is Garuda/Arch Linux: `/dev/fuse` exists outside the
restricted sandbox; its initial absence inside the sandbox was not a host fact.
Debian package-manager checks use a separate disposable Debian filesystem because
the host has no dpkg. Actual dpkg installation of 1.16.15, upgrade to 1.16.16,
installed archive/command/library checks, full installed-binary acceptance and
package removal passed. Removal preserved the actual protected acceptance profile.
The Debian runtime uses the host kernel, X11 and keyring session; it does not
certify a separately booted Debian desktop or file associations. Dependency setup
and unsuccessful driver attempts remain in the cache logs.

The native corpus has 10,000 objects, 100,000 console events, 100,000 document
buffers and 200 plugins. The context-only run passed after conservative metadata
filters reduced unnecessary ranking. A normal-layout run exposed saturated tab
rendering and excessive console DOM allocations. Large tab strips now render the
visible range; long console histories measure visible, wrapped entries while
retaining every original in the store. **Copy all console output** includes the
complete history, including entries outside the viewport.

The final normal-layout development run passed: warm search p95 **81.2–174.5 ms**
and additional manager resident memory **26.8 MiB**. It checks first/last document
selection, scrolling to the oldest console entry, multiline measurement and full
history copying through a clipboard stub. No system clipboard was overwritten.
Unrelated turns still have no schema reads or auxiliary sources. Failed latency,
renderer and resident-memory attempts remain in the evidence. This is synthetic
development-renderer evidence for the normal layout, not production file ingestion,
every panel combination or transient pre-GC memory certification.

The hardened syscall audit handles resumed calls, connected socket writes and
IPv6 peers. Packaged acceptance exited successfully, but the strict audit remains
**failed**: **30 blocked external connection attempts**, **zero successful external
calls**, and **477 opaque io_uring calls**. Shared desktop/keyring services outside
the traced process tree are also outside its certificate. Blocked attempts are
not counted as offline success and opaque operations are not ignored.
Chromium's native diagnostic log identified automatic Hunspell dictionary requests
to Google's CDN. Disabling spelling at window level alone did not stop them;
disabling the session service and clearing its language list before window
creation eliminated the dictionary requests in the synthetic run. Linux/Windows
windows use that setting; macOS retains its native spelling behaviour. The
[Electron documentation](https://www.electronjs.org/docs/latest/tutorial/spellchecker)
describes the default dictionary download. Remaining IPv6 route probes still count
as attempts. Official, checksum-pinned symbols identify the runtime UDP/system
resolver frames; stack tracing slowed acceptance enough to fail its time limits,
so that capture is diagnostic rather than the final acceptance result.

## Live model evidence and remaining quality work

The configured ouRGeo OpenAI subscription ran gpt-5.6-luna against the development
20-turn paired context-assembly comparison. Eager context used **246,924 reported
input tokens**; broker context used **140,468**, a **43.1% reduction**, including
model-selected retrieval follow-ups. All 20 answers completed in both conditions.
This comparison uses current legacy-contract builders as an eager counterfactual;
it is not a historical app run, independent hold-out, human correctness score or
invoice saving. Its earlier snapshot is identified by source hashes; that report
did not record an appVersion field.

The installed local gemma4:e2b comparison completed **3/6 eager** and **5/6 broker**
answers. Empty answers and missing eager usage counters are retained. No complete
local savings estimate or quality pass is inferred.

The 1.16.16 long-chat subscription probe kept the exact 100 metres, EPSG:32610 and
unchanged-source instruction after omitting 19 older assistant replies using a
4,000-token broker conversation-selection budget within a 32,768-token window.
The broker answer’s R nevertheless failed `identical()` on integer versus double
CRS identifiers; the eager answer ran successfully. The code was checked with the
existing configured R library and no startup profile. Constraint retention is
verified for this probe; comparable executable-code quality is **not passed**.
A separate initial current-schema probe made an unsupported current-state claim
before qualifying that only the historical failure was known. That failure stays
visible. After adding recorded-command dependency routing, a new paired probe
attributed the missing column to execution time and identified the current indexed
schema, while requesting a live check before relying on it. Its broker condition
used 2,486 reported input tokens across two calls. This improved development
observation cannot certify independent task quality or erase the earlier failure.

A blind development review packet with 29 pairs is ready at
`.cache/stage02/model-review-evidence/pairs.md`, with pending ratings in `reviews.json`.
It includes the exact source fixture and preceding reported mixed-task dialogue.
Regenerate into a new directory with:

```sh
node scripts/prepare-context-review.mjs --output .cache/stage02/model-review-new \
  .cache/stage02/subscription-mixed20.json \
  .cache/stage02/local-comparison-smoke.json \
  .cache/stage02/subscription-long-compacted.json \
  .cache/stage02/subscription-current-schema.json \
  .cache/stage02/subscription-current-schema-with-dependencies.json
```

The generator refuses to overwrite existing reviews. Human scoring of this tuned,
correlated development corpus still cannot establish the independent held-out
non-inferiority gate. Independent corpus/review and representative-participant
usability are deferred pending reviewers and remain open, along with strict offline
certification, retained-provider internal accounting/invoice evidence, remaining
native platform boundaries and production-ingestion/panel-combination scale
certification. Owner feedback is evidence of owner usability only.
