# Moving an object between panels

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

## Moving an object between panels (`src/lib/spatial-link.ts`)

The Environment panel, the data viewer and the Spatial Editor show the same R
objects from three angles, and each direction between them lives here.

- **The two directions share one question — "is this object already on the
  map?" — so they have to answer it the same way.** `layerShowsObject` is that
  answer, and the case it exists for is the **empty `envName`**: a
  database-backed layer has no R environment (`addDbSpatialLayer`), so a strict
  comparison says a `.Rgeo` dataset the user just sent to the map is not on the
  map and offers to add it again. An empty environment on either side matches on
  the name alone — which errs towards ASKING, and the answer feeds a prompt
  rather than a refusal, so that is the right way for it to be wrong.
- **"In the current view" means what Contents lists**, not every layer in the
  store: `SpatialRibbon` filters to the active named session's layers when there
  is one. `layersInView` states that, so the prompt can never claim a duplicate
  the user cannot see.
- **`AlreadyOnMapDialog` has three answers, not two.** A second layer from one
  object is legitimate (two symbologies of one roads layer) and far more often a
  user who forgot the layer was there — and nothing about the click distinguishes
  them. *Show existing layer* is the answer the forgetful case wants and the only
  one the old flow could not express. It is shared by the data viewer's **Add to
  Map** and the Environment panel's **Send to spatial editor**, so the same
  gesture gets the same question wherever it starts.
- **Map → table needs no dedupe of its own**: `addObjectTab` already keys on
  access path + environment and activates the tab it finds. `viewerTargetForLayer`
  decides *what* to open, refusing only a raster (bands, not rows — it names the
  symbology editor instead) and a class with no table view. When the environment
  listing has not caught up — a layer added seconds ago, an object reached
  through an expression — it opens anyway rather than refuse something that
  works; the data viewer reports a genuinely missing object itself, with a Retry.
- **Opening a panel is not showing it.** Both directions call
  `useLayoutStore.setActivePanel`, because in a tabbed zone the panel can open
  behind whatever tab is in front of it, and a table that opened where the user
  cannot see it is indistinguishable from a button that did nothing.
- `add-spatial-layer.ts` gained `addDbSpatialLayer`, lifted out of
  `EnvironmentItem`, so a `.Rgeo` dataset put on the map from the panel, from
  the data viewer or by the assistant is the same layer with the same tile
  source; and `addSpatialLayer` now infers `geometryType` from the geometry
  rather than leaving it `'Unknown'` for callers that (unlike Add Features)
  never asked `/spatial/list`.
