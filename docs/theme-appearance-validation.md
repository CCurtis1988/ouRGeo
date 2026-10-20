# Theme appearance — ouRGeo 1.16.30

Implemented four app theme collections (Illustrated, Legacy, Field collection,
Custom), Settings tabs, matching collapsible Studio groups, and a shared
per-theme background visibility control in Appearance and the image gallery.
Light Field themes now use 35% opacity with adjusted syntax contrast. Explicit
0% hides artwork; 100% uses original image colours without filters.

## Automated verification

- Type checking passed.
- Lint: zero errors, 36 existing warnings.
- Full test suite: 2,921 tests across 297 suites passed.
- Production build passed.
- Focused tests cover preview without writes, release/unmount persistence,
  default reset without changing selection/timing, failed-write rollback, slow
  saves preserving newer previews, independent themes and older preference files.
- Classification tests cover custom copies inherited from Field and Legacy;
  Settings tests cover four tabs and keyboard navigation.
- Field text/syntax contrast tests use the increased light image blend bound.

## Native Linux verification

`node scripts/check-theme-appearance.mjs` drives the built Electron app with
an isolated disposable profile and blocks remote requests. The successful report
is `.cache/theme-appearance/run-f7T8i0/report.json`; six screenshots are alongside
it and were visually inspected. Checks cover:

- Both editor panes at default 35%, faded 0% and original-colour 100%.
- Actual keyboard interaction with the range control and persisted endpoints.
- Independent Linen and Glacier settings.
- Reset restoring 35% while preserving image selection and the 75-second interval.
- Gallery and Appearance sharing the same preference.
- Four Settings tabs and four Studio groups, with Field open for the active theme.
- App restart preserving Linen 100% and Glacier 0%.
- No renderer exceptions.

Windows and macOS native verification remains deferred until suitable hardware
is available. No external testing is required.
