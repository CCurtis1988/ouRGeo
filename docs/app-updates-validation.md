# Application updates — 1.16.33

Type checking and the production build passed. Lint reports zero errors and
36 existing warnings. The full suite passed **2,965 tests across 306 suites**.
After final wording and cross-platform fixture adjustments, focused update and
UI registry verification passed **42 tests across four suites**.

Logs are in `.cache/app-updates-{typecheck,lint,build,full-tests,focused}.log`.
`git diff --check` passed.

## Release discovery and main-process checks

The live official download page was retrieved and parsed. Its three active
installer cards identify version 1.15.6 (AppImage, Debian package and Windows
installer); newer source-release prose and the inactive macOS placeholder do
not enter the installer catalogue. Newer local versions are not downgraded.

Automated tests cover numeric version comparison, stable/prerelease behaviour,
malformed versions, source-only releases, coming-soon cards, trusted URLs,
duplicate links, format and architecture selection, and platform instructions.
Main-process tests exercise startup coalescing, GET metadata and HEAD probes,
current/ahead builds, disabled checking, development builds, overlapping
preference writes and restart persistence, invalid IPC arguments, offline and
oversized responses, missing catalogue data, broken installer links, and normal
window closing. The backend fixture explicitly selects Linux/x64 so host
platform differences do not change its assertions.

Component/store tests verify explicit download consent, no automatic quitting,
failed skip persistence and retry, manual checking while opted out, quiet current
and failed startup checks, queuing behind another dialog and per-version skip.

## Native Linux verification

`node scripts/check-app-updates.mjs` drove the final built Electron app with a
marked disposable profile and a real R session. The final passing report is:

`.cache/app-updates-ui/run-AumFju/report.json`

Screenshots alongside the report were visually reviewed. The script verifies:

- A newer compatible published installer prompts after startup; no browser opens
  before a user action, and source-only versions are ignored.
- Download consent hands off the exact official URL and displays installation
  steps. The driver intercepts browser launch without fetching an installer.
- **Save project…** writes a real `.ourgeoproj` bundle. After an R edit,
  **Close ouRGeo…** shows the existing unsaved-project prompt; **Cancel** keeps
  the workspace open.
- Later and Skip work; skipping survives restart and manual checking bypasses
  it. A newer release is offered even when the prior version was skipped.
- Disabling automatic checking survives restart and causes zero startup network
  requests, while manual checking still works.
- Current installations and offline checks stay silent during startup. Manual
  current and error states provide appropriate status and recovery.
- Development startup makes zero update requests; manual checking offers source
  workflow guidance and no installer.

No renderer exceptions occurred. Release responses and packaged/version state
are synthetic fixtures served locally through the production checker, parser,
IPC, store and UI. An isolated resources directory points to the repository's
real R resources for the simulated packaged build. No real installer was
downloaded, installed or executed, and no actual external browser opened.

Windows/macOS native installer and UI verification remains deferred until
suitable hardware is available. Platform selection and instruction generation
are covered by automated tests; native installation success is not claimed.
