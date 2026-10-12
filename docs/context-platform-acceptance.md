# Memory/context acceptance handoff for stages 0–2

The current target is Linux. The owner has deferred Windows 11 and macOS to
separate Codex sessions on those machines. Their results must be collected there;
Linux keyring, packaging and filesystem evidence cannot certify them.

## Run on each target machine

Read `CLAUDE.md`, `docs/context-stages-0-2.md` and the repository agent instructions.
Preserve unrelated changes. Use a current Node version with `node:sqlite`, install
project dependencies, and install R plus the packages described in the README.
Run `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`.
Run the platform package command: `npm run package:win` on Windows,
`npm run package:mac` on macOS, or `npm run package:linux` on Linux.
These commands include the platform PTY check. Retain logs and artifact hashes.

Run the built acceptance harness first:

```sh
node scripts/check-context.mjs --stages-0-2
```

Then run it against the actual unpacked executable:

```sh
# Linux
node scripts/check-context.mjs --stages-0-2 --packaged dist/linux-unpacked/ourgeo
# Windows (PowerShell)
node scripts/check-context.mjs --stages-0-2 --packaged "dist/win-unpacked/ouRGeo.exe"
# macOS (substitute the actual architecture directory)
node scripts/check-context.mjs --stages-0-2 --packaged "dist/mac-arm64/ouRGeo.app/Contents/MacOS/ouRGeo"
```

Headless Linux needs an available display or `xvfb-run -a` before the command.
The harness creates private synthetic profiles under the OS temporary directory,
sets Electron's user-data directory before handlers initialise, verifies its
location, and refuses packages missing that guard before launching. It uses a
loopback mock model, synthetic R data and temporary projects. It neither sends
paid inference nor opens the ordinary user profile. Do not replace its isolation
with a test against a personal profile. Leave generated profiles for inspection.

Collect the JSON result and inspect the generated screenshots. Record the actual
secure-storage backend, worker SQLite/FTS5 availability, scope/refusal behaviour,
usage and budget reservations, folder/column privacy, forgetting, restart and
index recovery. Check OS permissions/ACLs and wrong-key refusal on that machine.
Windows symlink fixtures may need Developer Mode or the necessary OS privileges;
record failures rather than silently omitting them. Verify native installation,
launch and uninstall separately; running an unpacked executable does not prove
installer behaviour or signing/notarisation.

The Electron HTTP audit starts after attachment and covers HTTP(S) requests during
fixture actions. It does not certify cold-start or subprocess network traffic.
Linux can exercise startup and descendants with external networking disabled:

```sh
unshare --user --map-current-user --keep-caps --net sh -c 'ip link set lo up && ip -j address show && ip -j route show && exec node scripts/check-context.mjs --stages-0-2 --packaged dist/linux-unpacked/ourgeo'
```

Preserving the desktop UID is necessary for kwallet authentication. Mapping the
user to root caused the initial offline fixture to refuse protected writes; that
failed setup is retained in the Linux evidence. This namespace has only loopback
and no external routes. It verifies offline operation for the app and descendants,
including startup; it does not observe all attempted connections or desktop
services accessed through IPC. Use an OS-level capture for that broader audit and
record the exact boundary. Windows/macOS need their own equivalent checks.

## Linux evidence and remaining release gates

See `context-linux-stages-0-2-evidence.json` and the current closure checklist.
The workspace benchmark runs actual source adapters and broker against synthetic
10,000-object, 100,000-event and 100,000-document inputs. It reports cold and warm
times, manager memory, immutable input memory and their combined footprint.
It does not establish full Electron UI performance at that size.

The separate native context-browser fixture verifies the same corpus through
the actual Electron UI; other panes are suppressed, so it does not establish
whole-app rendering at that size. Run it after building:

```sh
node scripts/check-context-scale.mjs
```

Its JSON report includes warm search-handler times, resident memory after GC,
source hashes, screenshots and explicit gates. The version 1.16.14 follow-up
evidence retains earlier failures as well as the final result.

For the Linux syscall audit, supply an installed `strace` executable:

```sh
node scripts/check-context-network.mjs --strace /usr/bin/strace
```

The collector begins before application launch, follows descendants inside the
loopback-only namespace, suppresses payload strings and verifies detection with
an intentionally blocked outbound canary. External connect attempts are retained,
including failures. Successful or unfinished `io_uring` submissions prevent
certification because this capture cannot decode their operations. Unix IPC to
desktop/keyring services outside the traced process tree remains outside scope.
The current audit **fails** the strict network gate; offline operation passing
must not be substituted for this result.

For portable Linux installation acceptance without FUSE:

```sh
node scripts/check-context-package.mjs
```

This copies the current AppImage into a disposable workspace installation,
extracts it, verifies payload hashes, runs the full synthetic packaged fixture
and removes only that test installation. Logs and the isolated profile remain
available. FUSE mounting, desktop integration and Debian package-manager
installation are separate, untested boundaries. On a small RAM-backed `/tmp`,
set `TMPDIR` to a workspace cache directory when packaging; this changes temporary
storage rather than dependency collection or package contents.

Model quality and human usability are platform-independent gates. Follow the
frozen-corpus, comparable-model and independent-review protocol in
`../tests/fixtures/context/evaluation/README.md`. Retain failed answers as well as
passes. A separately authored corpus and blinded model-quality review are still
missing. The owner will perform the current Linux manual acceptance personally,
using `context-owner-acceptance.md`; collect its seven results before recording
owner acceptance. The specification's separate ten-participant study (at least
eight completing without assistance) remains unverified and cannot be inferred
from owner results. Live paid runs require an explicit evaluation budget.
A local smoke run or a scripted oracle retrieval cannot replace those results.

Known cost boundaries: reviewed prices enforce estimated daily/monthly ceilings;
unknown or interrupted bills remain reserved/unknown. Earlier activity without
receipts, provider billing retrieval after restart and invoice-cap guarantees are
not implemented. Opaque subscription transports refuse budgeted dispatch.
Recovery rebuilds a verified damaged usage secondary index from authenticated
current rows while preserving original files. Unreadable canonical records or
forgetting markers fail closed; old backups are never used to reconstruct them.
