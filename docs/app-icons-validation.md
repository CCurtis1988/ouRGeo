# Desktop branding — 1.16.34

The desktop application uses the exact logo downloaded from the
[official homepage artwork](https://ourgeo.dev/images/ourgeo/logo.png).
The original is preserved in `build/logo-source.png`; provenance and regeneration
instructions are in `build/README.md`. The previous R/globe SVG is removed so
future packaging cannot accidentally select it.

## Checks

- Type checking and the production build passed.
- Lint passed with zero errors and 36 existing warnings.
- All **2,965 tests across 306 suites** passed, with local networking enabled for
  the integration fixtures. A documentation-contract test caught an incorrect
  update-dialog action name from the preceding feature; it now correctly uses
  `ui:openDialog`.
- PNG, all seven Windows ICO sizes and all eleven macOS ICNS representations
  were independently decoded using Pillow. No image-generation service, new
  package dependency or runtime network fetch is involved.
- A final Linux Debian package was built locally with Electron Builder and the
  installed Linux terminal backend preflight. Nothing was installed system-wide.
  Its `ourgeo.desktop` has `Icon=ourgeo` and `StartupWMClass=ourgeo`; all nine
  installed icon sizes match their generated PNGs byte for byte. The runtime
  `out/main/icon.png` inside `app.asar` also matches the source asset. Package
  metadata reports 1.16.34.
- `git diff --check` passed.

Logs: `.cache/app-icons-{typecheck,lint,tests,build,package}.log`.
Local installer: `.cache/app-icon-package/ouRGeo-1.16.34.deb`.

## Native Linux verification

`scripts/check-app-icons.mjs` launches a marked disposable profile, connects to
the real R backend and creates the workspace, Plot Preview and Active View
windows. It reads each window's actual X11 `_NET_WM_ICON` property rather than
assuming a web-content screenshot proves the native icon. For each window it
checks the 1024-pixel dimensions, complete property length and 133 pixels against
the expected artwork, then reads `WM_CLASS`. The renderer favicon also decodes
at its expected size.

Passing reports:

- Built development entry: `.cache/app-icons-ui/run-FXiQKN/report.json`.
- Real packaged executable: `.cache/app-icons-ui/run-jgXgPa/report.json`.

All three packaged windows report the expected `ourgeo` identity, matching the
installed launcher. The external development wrapper retains Electron's own
bootstrap class; its window artwork still matches. There were no renderer
exceptions. The packaged workspace screenshot and the generated 128-pixel icon
were visually reviewed.

The verifier uses a synthetic ID to create Active View; it verifies the native
window identity and icon, rather than testing an HTML widget's contents. It does
not add or modify system launcher entries, clear user icon caches or repin
shortcuts. Failed driver attempts were corrected for X11 property-read limits
and bounded teardown, and their identified test processes were cleaned up.

Windows/macOS native appearance and installation, and Wayland compositor
integration, remain deferred. Their packaging paths and decoded assets are
verified; their native desktop behaviour is not claimed as tested. Existing
launchers adopt the new artwork after installing a new build, and an operating
system may retain an old pinned-shortcut icon until it is refreshed or repinned.
