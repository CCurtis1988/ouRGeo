# Workspace layout

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

## Workspace layout (v1.11)

Four zones — `left`, `center`, `right`, `bottom` — each an ordered list of
panels sharing one axis, either **split** or **tabs**. Any panel goes in any
zone, including the editor and the console.

Panel sizes used to be five `useState`s in `EditorLayout` (never persisted) and
panel position was decided by which JSX block a panel had been written into.
That is fine right up until something outside the component needs to read or
change it — the same argument that moved dialog state into `store/ui.ts`, and it
applies twice over now the assistant is expected to rearrange the workspace on
request.

- **`src/lib/layout/model.ts` is pure and React-free.** `movePanel`,
  `setZoneSize`, `setZoneMode`, `normalize` — every operation returns a new
  layout, so a caller can *preview* a move (which is what the drag indicator
  does) without committing. Tested with no DOM, like `computeMdEdit`.
- **Four named zones with optional pane-local trees.** Coarse placement stays
  simple for the assistant; `layout:dockPanel` names a source, target and side
  instead of a recursive path. `dock-tree.ts` handles local mixed-axis splits
  and tabs. Flat `order` remains canonical membership, and bounded normalisation
  prunes missing/duplicate leaves, repairs active tabs and restores missing
  members. Layout version 2 accepts version-one flat layouts unchanged on load.
- **`normalize` carries the invariants**, and they are the safety story: the
  editor is never homeless (a layout that lost it puts it back in `center`) and
  never closed; a panel is never in two zones (two placements means two MapLibre
  instances writing to one store); unknown panel ids — a plugin the user removed
  — are dropped; sizes clamp to each panel's `min`; `active` always names an
  open panel in that zone. Run on load, on import, and after every operation the
  store did not originate.
- **Registries, not JSX.** `layout/panel-meta.ts` (id, label, min, default zone)
  and `layout/toolbar.ts` (the 14 buttons, previously 14 copy-pasted `<Button>`
  blocks) are data. `ai-actions/targets.ts` DERIVES its `toolbar.*` entries from
  the latter rather than listing them again.
- **`panel-meta.ts` and `panel-render.ts` are separate from `panels.tsx`** for
  one reason: the component half imports `CodeEditor` → Monaco, which touches
  `window` at import time. The first version had `ai-actions/ui.ts` reaching
  panels through the .tsx, and eight node-environment test files died on
  `ReferenceError: window is not defined`. Anything that only reasons about the
  layout imports the meta module.
- **The feature stores still own `isOpen`.** `usePlottingStore.addPlot` opens
  the plots panel when a plot arrives; `useHelpStore` opens itself on `?lm`.
  `store/layout.ts` MIRRORS them — one subscription per panel, one direction —
  so there is exactly one writer per panel. `init` is the one moment the
  direction reverses, pushing a restored `layout.json` into the stores; getting
  that backwards loads the file and then immediately overwrites it with seven
  `false`s, so the workspace comes back empty every launch while the file on
  disk says otherwise.
- **Inside a zone, a panel's size is a SHARE, not pixels.** The first version
  gave every panel a px size with the last one `flex-1`, so opening Environment
  and Packages together left the first on a fixed 260px and the second with
  everything else — and no arithmetic in a pure model could have evened that
  out, because the model cannot know how tall the column is. Weights sidestep
  the measurement: equal weights ARE an even split, at any height, for any
  number of panels (`flex-grow: w; flex-basis: 0`), and the browser divides.
  Minimums stay in px and are enforced where px exist, as `min-height` on the
  panel. `InnerDivider` measures its own two DOM siblings on mousedown — the
  only place the pixels exist — and `splitPanels` re-weights just that pair,
  keeping their combined share, so a drag moves one boundary and no other.
  Double-clicking a divider calls `evenPanels`.
- **Shares are deliberately NOT persisted** (`forgetWeights`, applied by
  `saveLayoutFile`): every zone opens shared equally, whatever was dragged
  yesterday. Where a panel lives and how wide its column is are the
  arrangement, and those persist as before. A *preset* keeps its shares —
  applying one is a deliberate in-session act, and "restore that arrangement"
  means all of it.
- **Pane docking uses one mouse gesture owner** (`panel-drag.ts`). Four pixels
  distinguish a drag from a click. A target pane's border highlights; mouseup
  records a proposal rather than moving anything. `PaneDropDialog` offers icon
  choices for Vertical, Horizontal or Tab group; split choices cover the target
  with two clickable sections. Radix traps focus and supports outside/Escape
  cancellation. No mutation occurs before the final choice. Pending proposals
  are invalidated by any layout change or disabling dragging. Empty-zone drops
  commit directly. Mouseup lives in one owner so another overlay cannot clear
  the drag before the actual destination hears it. Escape/window blur clean up
  in-flight listeners, cursor and selection state. Document tab dragging remains
  separate in `content-drag.ts`.
- **Groups are local.** A split wraps the target pane/tab group; joining tabs
  retains existing tabs and activates the moved pane. Splits of either axis can
  nest, their dividers resize locally, and closing/removing a pane collapses empty
  branches. `ZoneTabs` resolves the panel's group; Console/Terminal host the strip
  only when every member opts in, avoiding duplicate headers. `describeLayout`
  reports the tree, and panel sizing uses the nearest split. Explicit zone-level
  mode/axis/placement operations flatten their destination zone deliberately.
  Session weights still reset on reopen; topology and tab membership persist in
  `layout.json`, presets and project layouts. Existing layouts need no migration
  of their original placement, dimensions or mode.
- **An empty zone is a drop target only while dragging** (`EmptyZoneTarget`).
  A zone with no panels renders as nothing, which is right until you drag the
  last panel out of one — the column then has no pixels, and a panel could be
  moved out of a zone but never back into it.
- **Zone sizes are clamped at render, not in the model.** The stored px size is
  the user's and is never rewritten, but a measured ceiling keeps the centre
  above a floor — what the old layout did by hand with
  `max = min(innerWidth * 2/3, innerWidth - 380)`. Without it a stored 240px
  console on a short window leaves fifty pixels to type in, and three open
  panels leave the editor none.
- **Settings → Workspace** (`LayoutSettings.tsx`) is the third way to reach the
  arrangement, and — with the grips off by default — the first one most users
  will find, as well as the only one that shows you what you have. The grip is a gesture
  and the assistant is a conversation; neither lists the arrangements you saved,
  and neither is where a user looks after moving something by accident — which
  is why **Restore default arrangement** sits with the list rather than
  anywhere else.
  - **`dragEnabled` disables the GESTURE, not rearranging.** `layout:movePanel`,
    the presets and Restore all still work with the grips off, and the stored
    layout is untouched — otherwise switching it off would strand a user in
    whatever arrangement they had. It lives in `layout.json` beside the layout
    and the presets.
  - **It ships OFF**, and only an explicit `true` turns it on — an absent or
    unreadable value is OFF, which is the state a new install is in rather than
    one the user would have to recognise as wrong. The grip is hover-revealed
    over every panel's own header, so a gesture nobody went looking for is one
    that mostly fires by accident. The cost is that the grip's **right-click
    menu goes with it** — Move to, Add another, Remove — so the setting's
    description says so, and Settings → Workspace carries add and remove
    itself. The store also starts `false` rather than `true`, or a grip would
    flash onto every panel for the length of one file read.
  - **Arrangements export as `.ourgeolayout.json`** (`layout/layout-file.ts`),
    following the theme format for the same reason: an envelope that says what
    the file IS, so a file picked by mistake is answered by naming it (a theme,
    `theme.json`, a plugin manifest, a project manifest) rather than complaining
    about a missing property. ouRGeo's own `layout.json` is the likeliest
    mis-pick and is also a real arrangement, so it is READ, under the name
    "Imported layout". A format version from the future is refused; an
    arrangement whose `LAYOUT_VERSION` is stale is dropped. Imports are
    `normalize`d on the way in, because a file from another machine can name a
    panel this ouRGeo has never heard of.
- `layout.json` sits with `theme.json` on the **preference** side of the userData
  split, never in the `will-quit` delete list. The flush on quit is a single
  `write`, not a `merge`: a merge is a read-modify-write across two IPC calls and
  the renderer is destroyed as soon as it calls `app:confirm-quit`, so the layout
  was silently never saved on exit while `session.json` always was.
- Actions: `layout:describe / movePanel / setPanelSize / evenPanels /
  setZoneSize / setZoneMode / showTab / setToolbarButtons / setPanelDrag /
  savePreset / applyPreset / listPresets / deletePreset / reset`. `setPanelSize` takes a
  **percent** of the zone, not pixels, and refuses a panel that is alone in its
  zone by naming `setZoneSize` — silently doing nothing there would leave the
  model telling the user it had made the map bigger. All `always` except the two that write
  disk — moving a panel is undoable by moving it back, and gating it behind
  Autopilot would mean the user most likely to want the interface adjusted for
  them is the one who cannot have it.
