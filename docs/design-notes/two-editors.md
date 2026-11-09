# Two editors / panel instances

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

## Two editors (v1.12.5)

The code editor can exist more than once. Nothing else can: every other panel
is a window onto one global thing — one console, one environment listing, one
map — and a second copy would be two views fighting over one store. The editor
owns a SET (its tabs), which is precisely what makes a second one useful and
what makes the split well-defined.

**The Spatial Editor owns a set too — named map sessions — and briefly had the
same cap. It was built, and then taken out again.** Worth recording, because
the reasoning is the reason not to reach for it lightly: a second map is a
second MapLibre context and a second tile stream against a `viewBbox` that is
one value (`DbSpatialTileLoader` reads it), a second extent that the export
codegen and the project bundle must not read from the wrong one, per-focus
mounting for the ribbon, the hotkeys, the draft sync and the three popups so
that none of them fire twice, and a third answer — a dialog — to every "send
this object to the map". What remains here is the *panel* machinery, which is
written over `basePanelId` rather than against the editor and cost nothing to
keep general; the map-side half is gone from the tree, so bringing two maps
back means writing it again, not flipping `maxInstances`.

One consequence outlives it: `layout.json`, a saved preset or a `.ourgeoproj`
written while two maps were possible can still name `spatial#2`. `normalize`
refuses it, `reconcilePanelContent` brings any orphaned tabs home, and named
map sessions were never persisted, so nothing is lost. Pinned by
`panel-meta.test.ts`.

### Instances are a naming scheme, not a new model

`src/lib/layout/instances.ts`. `PanelId` was already an opaque string to the
layout model, so a second panel costs nothing structural — what it costs is a
name, and **the first instance keeps the bare id**: `editor`, then `editor#2`.
That is why every `layout.json`, saved preset, `data-ourgeo-id` and `ui:panel`
call written before this feature still resolves. `#` rather than `:` (a
plugin's panel id is already `plugin:panel`) and rather than `.` (a dot in an
id reads as a property access — the same argument that made action ids use a
colon). `maxInstances` on `PanelMeta` is 4 for the editor and absent (so 1)
everywhere else.

`normalize` gained the rules that keep a bad file renderable: an instance of a
panel that may only exist once is dropped, so is one past the cap and one whose
suffix does not parse (`editor#1`, `editor#x`); and **an instance's open state
is its base panel's**. That last one is a decision, not an omission — the
toolbar has one button per panel, so a second editor that could be closed on
its own could only be reopened from Settings, and a panel holding documents
that is invisible and unreachable is the worst state this feature can produce.
Closing the editor closes every editor; *removing* one is the other gesture,
and it hands its documents on. `dropPanel` is that removal, and step 2 of
`normalize` never puts an instance back: an original that is missing from a
file was never seen, an extra one that is missing was removed.

**Dropping the cap is therefore also the migration.** A `layout.json`, a saved
preset or a `.ourgeoproj` written while two maps were possible still names
`spatial#2`; `metaFor` refuses it, step 1 drops it, and `reconcilePanelContent`
brings its sessions back to the map that remains. Pinned by
`panel-meta.test.ts`, which asserts against the SHIPPED registry rather than a
fixture — `model.test.ts` already proves the machinery is general, and a
fixture would go on passing after the shipped answer changed.

`resolvePanelName`'s squash keeps digits for a related reason. Stripping them
made "Code editor 2" squash to `codeeditor`, which is the FIRST editor — so the
spoken name of an added panel resolved, silently and confidently, to the
original, and the trailing-number branch written to handle it never ran.

### Only what was added can be removed

Remove and Close are different gestures and must not be offered as if they were
one. Closing hides a panel the toolbar brings straight back; removing takes a
panel out of the workspace for good. So **Remove applies only to a panel the
user asked for**, which by construction has a sibling for its contents to move
to — and the check is in `removePanelInstance`, not in each of the three menus,
because a rule enforced at every call site holds until someone adds a fourth.

The grip's right-click menu briefly carried both, and that was wrong twice
over: a right-click could take the console or the map out of the workspace — a
destructive answer to a gesture made to *move* something — and the way back was
a toolbar button nothing in the menu mentioned. The menu now moves a panel,
adds one, and removes one that was added; hiding a panel is what the toolbar is
for. Settings shows the ✕ only on the copies, and `layout:removePanel` refuses
the original by name.

Removing the ORIGINAL is not merely disallowed, it could not have worked: the
editor is `essential`, so `normalize` would put it straight back — empty,
having already handed its documents to the copy.

### Removing a panel never removes what is in it

`src/lib/panel-instances.ts` is the only thing that should call
`useLayoutStore.removePanel`, and it moves the content first — to the FIRST
remaining panel of the same kind, which for anyone who added exactly one extra
is always the original. Three surfaces call it and must agree: Settings →
Workspace (which is also the only surface that SHOWS you what you have), the
panel grip's right-click menu (the fast way, when the pointer is already on the
panel), and `layout:removePanel`. All three print the same sentence about where
the documents went, read *before* the removal — `removalSummary` afterwards
would describe a panel that is already empty.

`src/lib/panel-content.ts` is the safety net for the other direction.
Content pointing at a panel that is gone arrives from three real places — a
`session.json` or `.ourgeoproj` written when the workspace had two editors, a
layout preset applied from Settings, `layout:reset` — and its symptom is the
worst kind: the tab still exists, still holds the user's work, and is drawn
nowhere. So `reconcilePanelContent` runs after EVERY layout change, from the
one place every change passes through (`useLayoutStore.apply`), and puts
orphans back in the original panel.

### What each store had to grow

- `TabState.panelId`, **absent meaning the original** — the same
  backwards-compatibility tolerance `language` needed, so a `session.json` or a
  bundle written before this reads back unchanged, and a tab moved to the
  second editor and back is byte-identical to one that never left.
- `activeTabId` **stays a single value**, because almost everything that asks —
  Save, Knit, the document tools — means "the one in front of me". What a
  second panel needs is `activeByPanel`, which is what each panel RENDERS:
  switching focus to the other editor must not disturb the tab this one is
  showing.
- `focusedEditor`: where a new tab opens. Set from `Zone`'s **mousedown
  capture** (`lib/panel-focus.ts`), so focus has moved before the click does
  whatever it was for. `PanelSlot` draws a focus ring, but only when there is
  more than one editor: with one, the question has no answer worth showing.

### Moving content between panels

`src/lib/content-drag.ts` + `src/store/contentDrag.ts`, written the same way as
`startPanelDrag` and for the same hard-won reasons: plain mouse events (not
HTML5 dnd), a 4px threshold so a plain click on a tab still selects it, and
**the drop committed in the one mouseup handler** rather than by the panel
dropped on — React flushes a discrete native event's update synchronously, so
the first overlay to clear the drag would unmount the rest mid-dispatch.

A tab strip is a strip, so tabs drag, and the strip also carries an explicit
**Move to** in the tab's own context menu — a drag inside a scrolling tab strip
is easy to start by accident, and easy to miss if nobody tells you it is there.
`ContentKind` stays a union with one member rather than collapsing to a
boolean, because the drop targets key off it (`data-dock-kind`): a panel that
accepted anything dragged near it is the failure the type exists to prevent.

### Two smaller consequences

- **An empty editor is a normal state**, and it says so, with the two ways to
  fill it. `closeTab` only invents an Untitled when the last tab *anywhere*
  goes; a panel that silently grew an `Untitled-7` whenever it emptied would be
  one the user cannot leave empty.
- **`CodeEditor` disposes a model when its tab leaves the panel**, not when the
  tab is closed. `getOrCreateModel` returns a cached model without refreshing
  its text, so dragging a tab out and back would resurrect the document as it
  was when it left. Chunk outputs are a different lifetime — keyed by tab id in
  a shared store — and are dropped only when the tab is gone from the app.
- **`HighlightOverlay` picks the control inside the focused panel** when an id
  appears twice. A tutorial says "the New file button", not "the New file
  button in the second editor".
