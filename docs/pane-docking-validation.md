# Pane docking — 1.16.32

- Type checking passed.
- Lint: zero errors, 36 existing warnings.
- Full suite: 2,950 tests across 303 suites passed.
- Final focused verification: 182 tests across 12 suites passed, including
  docking model, dialog/gesture, assistant actions and documentation contracts.
- Production build passed.

## Native Linux verification

`node scripts/check-pane-docking.mjs` launches the built Electron app with a
marked disposable profile and blocks external HTTP requests. The final passing
report is `.cache/pane-docking-ui/run-GJqMjI/report.json`.
Screenshots are alongside it; the drop menu, split previews, mixed layout and
reopened groups were visually reviewed.

Actual mouse gestures verify target-border highlighting, release-to-menu,
cancellation before committing, vertical and horizontal placement, local
mixed-axis splits, joining an existing tab group, dropping over a group’s tab
header, extracting a tab, divider resizing, double-click equalisation, Escape
while dragging, and direct placement into an empty zone. A version-one initial
layout migrates to version two without resetting its placement. Group topology
and active tabs survive a native app restart. There were no renderer exceptions.

Pure tests cover every side, existing groups, unrelated-zone preservation,
removal/closure, malformed/duplicate trees, session-weight reset, serialisation,
nearest-split sizing and version-one exported-layout compatibility. Assistant
operations are exercised through argument validation. Dialog tests prove no
layout change occurs before final placement, stale proposals are discarded,
and both directions expose the correct sections.

Windows/macOS native verification remains deferred until suitable hardware is
available. No outside testing is required.
