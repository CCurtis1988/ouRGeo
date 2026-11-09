# Release numbering, app updates, installation health check

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

### Release numbering

The maintainer moved managed plugin services to **1.16.0**, ChatGPT plan usage
to **1.16.1**, subscription stream corrections to **1.16.2**, and the guided
installation health check to **1.16.3**, followed by data preflight in **1.16.4**.
The current settings and memory usability patch is **1.16.16**, without a new
maintainer release-history entry.
These announced patches have explicit entries in `versionHistory.ts`;
`currentRelease()` prefers an exact entry before falling back to the older
`a.b` histories. The running version still comes from `package.json`.
The website generates its notes from this array and stamps its docs with the
package version. Published installer versions are tracked separately until
new binaries are uploaded.

### Application updates (`app-updates.ts`)

The main process owns update checking, preferences and browser destinations.
The official download page publishes active installer cards independently of
source-release notes; comparing the source version would offer releases that
have no binary. `src/lib/app-updates.ts` parses only official `download.php`
installer cards, selects the installation's format and architecture, and compares
numeric stable versions. Existing unsuffixed assets are x64. ARM and unavailable
platforms receive no incompatible installer. Debian installations keep `.deb`;
other Linux builds use AppImage. Ahead-of-release builds are never downgraded.

`electron/main/app-updates.ts` fetches the catalogue with a 12-second timeout and
1 MiB body limit, then verifies newer installers with HEAD. No binary is fetched
until the user opens its browser download. Renderer IPC accepts an offered
format or a fixed official page destination, never an arbitrary URL. This is a
guided installer hand-off: the distribution has no signed auto-update feed,
and the app never runs installers or replaces itself. Keep publishing enabled
download cards only when the corresponding installer is available.

`AppUpdateController` checks once, three seconds after startup; development
builds and opted-out installations make no startup request. Current, offline
and unavailable checks remain quiet. An available update waits for other
dialogs, project restoration and drag gestures. The sibling `AppUpdateDialog`
offers download guidance, save, normal window close, later and per-version skip.
Closing uses `BrowserWindow.close()`, preserving the existing unsaved-project
prompt and flush; it must never call `confirmQuit` or destroy the window.
Settings → Updates offers manual checking even when automatic checking is off
or a version was skipped. Source checkouts get development-workflow guidance.

`app-updates.json` is a device preference, kept across sessions and outside
projects. Its main-process writes are serialised and atomically renamed, with
failures surfaced to the renderer. The renderer's `createJsonFileStore` cannot
own this file because the network authority must honour the setting before
checking. See `docs/app-updates.md` and its validation report.

### Installation health check (`health-check.ts`, `r/health-check.R`)

The first-launch invitation and last report persist in `health-check.json` in
app data. Dismissing the invitation does not run diagnostics; Settings can open
the full check again. The renderer walks through R, packages, system resources
and AI, with explicit approval before each installation or inference request.

Package diagnostics run through an independent Rscript process using base R,
so missing `httpuv` or `jsonlite` cannot prevent the check that repairs them.
The check compares package versions with compatible CRAN releases, tests loading
and compares the Built R major/minor version with the selected R. Core package
dependencies are included recursively; `sfarc` uses its GitHub DESCRIPTION.
Repairs use the selected R's user library and stop the backend to release DLL
locks on Windows. Offer to save the project first, then recheck and reconnect;
register backend subscriptions before initial startup so recovery also works
when the first launch failed. An offline recheck retains known update targets.

`r/lib/health-s2.R` probes spherical distance plus three 100-metre buffers,
validity and containment without sf. A namespace load alone missed native
geometry failures; sf can also load while S2 cannot. The `s2` diagnostic row
retains the loader/engine error, OS repair and target library. An engine failure
adds a package reason even when the namespace loaded, so the existing approved
repair path selects it. Windows/macOS repairs use compatible CRAN binaries
without falling back to source; source-only R installations get an explicit
manual recovery route. Linux forces bundled Abseil, checks CMake/make/pkg-config
and restores the build environment afterwards. Compilation reports missing
C++17/OpenSSL prerequisites. No system package manager runs automatically.
S2 resolves its active writable library before repair changes `.libPaths()`;
a custom profile can otherwise leave a broken higher-priority copy in place.
Protected copies can be overridden only in an earlier writable library, or
the user must configure one in Packages. The independent post-repair probe
uses a fresh Rscript and the normal startup profile, never a cached namespace.
`scripts/check-s2-repair.R` exercises a real CRAN source rebuild in a disposable
Linux library and confirms the user's S2 binary stayed unchanged.

Local recommendations use measured free RAM, usable GPU memory and free model
storage with reserves for R and the operating system. Multiple GPUs and unified
memory are not added together. The Qwen catalogue and download sizes are fixed
in `health-policy.ts`; each download is approved separately. AI discovery reads
metadata without inference. An approved connection test sends only a minimal
diagnostic message, with bounded output and a 4K Ollama context; it sends no
project, chat history or tools. Credentials use the existing provider settings.
