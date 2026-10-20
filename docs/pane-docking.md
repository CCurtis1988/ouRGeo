# Arranging panes

Enable **Settings → Workspace → Drag panels to rearrange them**. Drag the grip
in a pane’s top-right corner, or drag its pane-group tab. This moves the pane;
dragging a document’s own tab still moves that document between editors.

Hover over another pane to highlight its border. Release to open a compact menu:

- **Vertical** divides the target left/right. Click the section for the moved pane.
- **Horizontal** divides it top/bottom. Click the section for the moved pane.
- **Tab group** puts the panes in one group and selects the moved pane. Existing
  target tabs stay together; splitting a tabbed target keeps that group intact.

The preview has Back and Cancel controls. Escape or clicking outside cancels.
Nothing moves before the final choice. Drops onto the same pane or outside a
valid destination leave the workspace alone. Escape or leaving the app window
also cancels a drag. Empty workspace zones remain direct drop targets.

Splits can nest with different directions: an editor on the left can stay full
height while a neighbour on the right splits top/bottom. Drag a divider to
resize; double-click it to share that zone evenly. Pane tab groups support
Left/Right and Home/End keyboard navigation. Drag an individual tab to extract
it into another split or group. Closing/removing panes keeps the remaining
panes accessible and selects a remaining open tab.

Groups are remembered after restarting ouRGeo and in saved/exported arrangements.
Existing version-one layouts load with their original placement and mode. The
new layout version is 2; old builds cannot read its exported arrangements.
Divider weights remain session-scoped, as before; reopening shares groups evenly.
Use **Restore default arrangement** in Workspace to return to the shipped layout.

The assistant can use `layout:dockPanel` with `panel`, `target`, and `placement`
(`left`, `right`, `top`, `bottom`, `tab`). Both panes must be visible/open. This
works independently of the drag-grip switch. `layout:describe` reports local
groups, and `layout:setPanelSize` adjusts the nearest split group. Explicit
zone-wide operations remain available and flatten their destination zone.
