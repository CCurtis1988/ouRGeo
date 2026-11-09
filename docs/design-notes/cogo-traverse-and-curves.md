# Distance & Bearing and Curves

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

## Distance & Bearing (v1.13)

ourgeo.dev has always said *"don't eyeball it — type it. Enter an absolute
coordinate, or place the next vertex relative to the last one by distance and
bearing. Distances are geodesic (measured on the globe), so precision holds
anywhere on Earth."* What shipped was a 128px text box in the drawing ribbon,
visible only while the draw tool was up on a non-point layer, speaking one
syntax (`d150 a45`) — and computing the destination on a **sphere**, which is
up to half a per cent out against WGS84 and leans every leg the same way. The
repository's own author could not find it.

- **`lib/draw/cogo.ts` is the whole model, and it is pure.** Vincenty direct
  and inverse on WGS84, pinned against Vincenty's published example to the
  millimetre. The inverse solution is not decoration: **a geodesic arrives on a
  different azimuth than it left on**, so a deflection or an angle right has to
  turn from `inverse(prevPrev, prev).finalAzimuth`. Driving the app showed it —
  a 100 m leg's arrival azimuth was 2″ off its departure, and the next leg
  carried that. Also: the notations a traverse is actually booked in (azimuth,
  DMS, quadrant, deflection, angle right), and the units it is booked in
  (metres, feet, **US survey feet** — the unit of most State Plane zones and
  2 ppm from the international foot), and closure with its 1:N.
- **An entry that can only mean one thing means it.** `N45°30'E` typed while
  the notation says Azimuth is a quadrant bearing; `R90` is a deflection.
  Both were refused at first, with a message complaining about the number,
  which is how a first traverse ends in the wrong dropdown instead of on the
  map. A bare `-12` still redirects rather than guessing — it is as likely a
  mistyped azimuth as a left turn, and guessing wrong puts the leg 24° out
  with nothing on screen to say so.
- **A leg is an ordinary vertex append.** The tool (`tools/distance-bearing.ts`)
  places vertices through the same store calls the draw tool uses, so undo,
  snapping, Save Edits and the R write know nothing about it. Clicking still
  works after the first click on a chain: a traverse with one eyeballed corner
  is a real thing, and the tool is about being *able* to type, not forbidden to
  point.
- **`traversePath` is a discriminated read, and that is the POINT session.**
  A line or polygon keeps its trail in the draft, where the ribbon's undo can
  reach it; a POINT session has no draft that outlives a leg (each leg commits
  and the draft is cleared), so its trail is the one `store/traverse.ts` keeps.
  Reading the store for both would go stale under Undo Vertex; reading the
  draft for both would give a point traverse no trail whatsoever.
- **A point traverse measures from a reference point, and the reference is not
  data.** The first version committed it — first click, first row — which is
  the one thing a click there must not do: the monument a set of points is shot
  from is usually not one of them, every row of a point layer is a separate
  feature, and answering *where am I measuring from?* by writing a row answers
  a different question. `usesReferencePoint` is the discriminator (POINT, and
  deliberately not MULTIPOINT, whose parts live in one draft and commit
  together), `startTraverseRun` places it, and `DrawingLayer` draws it as a
  hollow ring with the run dashed behind it — muted, so nothing there reads as
  a feature. A later click re-places it and **flushes the run first**, because
  the R a traverse echoes describes one chain from one origin and the chain has
  just been broken.
- **A leg walks the dataset, exactly as the draw tool does.** It used to call
  `commitPoint`, which is *add-point* semantics: open "Redraw geometry…" on row
  3 of ten and the typed points landed in rows 11, 12, 13. A leg now stages the
  geometry of the row the session is on and advances (`ctx.finish()`), so the
  data viewer's row indicator follows a typed traverse the way it follows a
  clicked one, and running out of rows raises the same "add another?" prompt.
  Typing the next distance and pressing Enter *is* that prompt's answer, so
  `submit` gives it — a traverse that stopped dead at the end of the table
  would be one the user finishes with the mouse.
- **`GeometryEditSession.appendRows` is what "Add Point(s)" means**, and it
  exists because nothing else on the session told the two intents apart. That
  button opens a session at row 0 of a dataset that already has rows and means
  *append per click*; the data viewer means *fill this row, then the next*.
  Without the flag, picking Distance & Bearing inside an Add Point(s) session
  would overwrite the layer's first point.
- **`commitAndAdvance` reads the session, it does not subscribe to it.** It
  used to close over the `session` its render saw, which is fine for every
  caller that commits what the user just drew — and wrong the moment a caller
  moves the session on first. Answering the row-add prompt and placing the leg
  in one keystroke did exactly that, and the point went into the row *before*
  the one just appended, overwriting the previous one with nothing on screen to
  say so. Pinned by `useGeometryCommit.test.tsx`, which holds a stale callback
  on purpose.
- **A matched drawing hotkey is now consumed** (`useDrawHotkeys`). Nothing
  needed it until B, whose strip focuses a text field on activation: React
  flushes a discrete event's update DURING dispatch, so the keystroke's own
  default action typed "b" into the field that had just taken focus. The first
  coordinate driven through the app came back as `b-122.4200, 37.7750`.
- **Undoing a placed point is two facts, not one.** The staged geometry
  (`ctx.undoLast`, the ribbon's own Ctrl+Z, reachable from a tool through the
  new `DrawToolContext.undoLast`) *and* the row the session moved on to
  (`retreatRow`). Undoing only the first leaves the next leg writing into the
  row it has just emptied. A commit that ran out of dataset never advanced
  anything — it raised the prompt — so undoing that one cancels the prompt
  instead, which is what `retreatRow` checks first.
- **The strip is docked, not floating** (`TraverseBar.tsx`): it never covers the
  geometry it is building and never has to be moved. It **wraps rather than
  scrolls** — the drawing ribbon below scrolls because a hidden tool can be
  reached another way, but a hidden "Add leg" is a form with no submit.

### The coordinate system is the feature, not a footnote

A bearing off a survey plat in a projected CRS is measured from GRID north and
its distance is a GRID distance. Measuring those on the ellipsoid rotates the
traverse by the grid convergence — up to 3° at a UTM zone edge — and scales it
by ~1:2500. Both are invisible: the figure closes, it is just in the wrong
place. So there are two bases, the strip always names which is in force, and a
projected layer defaults to its own grid with its own unit already selected.

- **The grid arithmetic is R's** (`/spatial/traverse`, `r/lib/handlers-cogo.R`).
  proj4js in the renderer was the obvious alternative and is wrong twice over:
  a dependency, and a second projection engine whose disagreement with PROJ over
  datum shifts would land as metres of silent error when the geometry it
  produced was transformed BACK to the layer's CRS on save. One engine writes
  the geometry; the same engine decides where it goes.
- **The reply carries the frame at the new vertex** — projected position, grid
  convergence, point scale factor — so the NEXT leg previews on the grid it
  will be committed on without a round trip per keystroke. `frameAt` is stored
  beside it because a frame is true of exactly one point and the origin moves;
  a frame kept alone goes stale silently and previews with the convergence of
  the last vertex.
- **`legs: []` is a legitimate question**, not an error: it is how the strip
  asks for the frame at a start point, so even the first leg previews where it
  lands. Without it the first grid leg drew geodesically and jumped a metre
  when R answered.
- **Convergence and scale are measured, not looked up**: project the vertex and
  a point a metre north, and see what the projection did. There is no general
  formula across every projection PROJ supports, and this one is right for a
  Lambert or an oblique Mercator as much as for a UTM zone.
- **`json_response` rounded every number to four decimals** — jsonlite's
  default, and four decimals of longitude is eleven metres. It now takes a
  `digits` argument that position-carrying handlers pass `NA` to. Nothing else
  changed: layer geometry never went through it (GeoJSON is spliced in as a
  pre-built string), which is why this had never surfaced.

### Rule 0, on the one thing the geometry write cannot say

The vertices reach R the way all drawn geometry does — staged, then written by
the batched `buildBatchedGeometryRCode` statement on Save Edits. What that
statement cannot carry is that the figure was *measured*: it writes coordinates,
not the distances and bearings they came from. So finishing a traverse echoes a
runnable `ourgeo_traverse()` call (`lib/draw/traverse-rcode.ts`) naming the
origin, the legs and the CRS. It is an `info` entry rather than executed R,
because running it would build a second geometry nobody asked for.

`ourgeo_traverse()` is defined in `handlers-cogo.R` at startup, so the
`system_names` snapshot at the end of `server.R` already keeps it out of the
user's Environment panel and project bundles — the same treatment as
`ourgeo_calc_crs`, without needing `handle_session_init`'s explicit union. It
implements the identical Vincenty direct solution as `cogo.ts`; each file names
the other as the thing it must stay in step with. Verified by driving the app:
the echoed call reproduced the saved geometry to 7e-13 degrees.

## Curves (v1.15)

Distance & Bearing could only place **straight** courses, and every real deed,
plat and alignment mixes lines with curves:

> *"…thence N45°30'E 150.00 feet; **thence along a curve to the right having a
> radius of 250.00 feet, a central angle of 45°30'00"**; thence S12°00'E 82.00
> feet…"*

That middle call had to be eyeballed with the draw tool's Arc mode, which throws
away the numbers the plat was written in. Now it is typed, and so are tangent
curves, non-tangent curves, clothoid spirals, the spiral–curve–spiral a highway
plan quotes as one unit, and a free curve between two headings.

- **One tool, two doors.** Distance & Bearing (B) and Curve (U) activate the
  same tool and the same strip; the Course selector switches between five kinds.
  Splitting them would have split the FIGURE: the course list, the closure ratio
  and the echoed `ourgeo_traverse()` would each have seen half of it, and a
  closure computed on a path missing its curves announces nothing.
- **`closure()` takes courses, and a curve contributes its ARC.** A curve reaches
  the draft as arc segments, so the old vertex walk measured chords — and the
  1:N a traverse is judged by would have read better than the figure deserved,
  by exactly the amount the curves were shortened.
- **`traverseIncoming` reads the draft's last SEGMENT**, not its last two
  vertices: after a curve those two are a chord and the tangent is half an
  arc-piece away. Recovered from the arc's own three points
  (`curve-cogo.ts:arcEndAzimuth`), so it survives an undo and a feature reopened
  from the layer, which no remembered value would.

### `arc.ts` was wrong, and had been all along

`circumcircle` took its circumcircle in raw lng/lat **degrees**, where a circle
on the ground is an ellipse — a degree of longitude is 111 320·cos φ metres
against 111 132 for a degree of latitude. Measured against true ground geometry,
one three-point arc of radius 250 m through 90° landed **24.6 m** out at latitude
45 and **46.8 m** at latitude 60.

Subdivision could not rescue it: the error bottomed out near 15 mm and then
climbed again, because the degeneracy test was an absolute `1e-12` on a quantity
in degree² units, so a short arc went singular before it went accurate.
`local-frame.ts` is the fix — metres east and north of one origin — and the
degeneracy test is now relative to the input's own scale. `curves.ts` had to
follow or the fix would have introduced two bugs of its own: a tangent curve
made tangent in the lng/lat plane leaves a visible kink once drawn as a ground
circle, and a Bézier's preview and the arcs it commits would have described
different curves. **The three defining points of an arc are untouched**, so
geometry already stored round-trips unchanged and only draws correctly now.

### One solver, not twenty-eight

Every circular element except the central angle is the radius times a function
of that angle alone — `L = RΔ`, `C = 2R sin(Δ/2)`, `T = R tan(Δ/2)`,
`E = R(sec(Δ/2)−1)`, `M = R(1−cos(Δ/2))`, and R itself with `f ≡ 1`. So for ANY
two the ratio depends on Δ alone: one root-find gets the angle and the radius
falls out. Degree of curve is not a seventh freedom — it is a restatement of the
radius, which is why quoting both is refused rather than averaged.

**Counting roots rather than assuming one** turned out to matter twice, and the
two cases want different answers. A radius and a chord fit the minor arc AND its
reflex partner (400 ft radius with a 400 ft chord is 60° or 300°); a tangent
length and a mid-ordinate fit a shallow curve and a sharp one, both ordinary.
The rule is **exactly one ordinary curve wins**: where the alternatives are
reflex, the arc you would draw is taken — safe only because the readout prints
every element back, Δ included, so a user who wanted the other can see they did
not get it. Where two ORDINARY curves fit, only the surveyor knows, and it is
refused by name with both angles listed.

The strip prints **all** the elements, not the two that were typed, because
checking a curve against a plat means checking L, C, T, E and M — a plat quotes
them redundantly precisely so they can be checked.

### No format ouRGeo writes has a clothoid

ISO 19107 defines one abstractly; OGC WKT, GeoPackage, Shapefile and PostGIS do
not, so `sf` has nowhere to put it. Approximation is not a shortcut, it is the
only thing available — and what it is approximated WITH is the real choice.
Measured on a highway spiral (Ls = 100 m, R = 250 m):

| pieces | as circular arcs | as straight segments |
|---|---|---|
| 4 | 5.0 mm | 273 mm |
| 8 | **0.63 mm** | 73 mm |
| 16 | 0.08 mm | 19 mm |

Eight arcs put a spiral inside a millimetre AND keep it a real `CIRCULARSTRING`.
Sixty-four chords would still be worse and would have thrown the curve semantics
away to get there. `arc-spline.ts` fits to a measured tolerance rather than a
constant piece count, and **measures against the circle, not a densified
polyline of it** — densifying at a 0.5° step leaves a 1.2 mm sagitta at
R = 122 m, so that ruler was coarser than the millimetre being asked for and the
fitter subdivided for ever chasing its own discretisation.

### Two implementations of the spiral, deliberately

The renderer uses the closed-form series (`spiral.ts`), because it runs per
keystroke and at every probe the fitter takes. R integrates the CURVATURE
instead (`handlers-cogo.R`): a clothoid is *defined* by curvature growing
linearly, so integrating that definition needs no case analysis for entry, exit
or spiral–curve–spiral, and an exit spiral stops being a curve built backwards.

**Their disagreement is the check neither could perform alone.** They land
0.11–0.15 mm apart on a lone spiral. The SCS was 1.57 mm apart until R stopped
laying the whole unit out in one plane frame — the difference was the meridian
convergence across the circular middle, which a geodesic circle's tangent turns
by and a plane circle's does not, and the exit spiral carried that heading error
along its whole length. R composes the unit from its three parts now, using the
same geodesic circle a plain curve course uses, and they agree to 0.26 mm. The
free curve had the same shape of problem (4.1 mm, from building against a
geodesic chord instead of the local metric frame) and the same fix.

### `ourgeo_traverse()` grew columns, not a signature

It is a user-facing name people have saved in scripts, so curves arrive as
**additive columns** — `type`, `radius`, `delta`, `turn`, `form`, `length`,
`length_out`, `arrive`, `tension`, `leave`. No `type` column reads as
all-straight, so a two-column call still means exactly what it meant.

`azimuth` is NA on a tangential course, which is what tells R to inherit the
previous course's arrival — the whole meaning of *tangent*, and the one thing a
list of numbers cannot otherwise say. A free curve is the exception that proves
it: its `azimuth` is the bearing to its END point, so where it LEAVES needs a
column of its own (`leave`).

**On the grid basis a curve is a true circle in the layer's projected CRS**, and
that arithmetic is R's, exactly as a straight leg's is. It comes back as samples
at exact parameters (`samples`, a power of two) so arcs can be fitted through
them without interpolating — a grid circle and the geodesic circle through three
of its points agree to 0.03 mm at R = 250 m over 30° and diverge to 31 mm at
R = 1000 m over 180°, so the piece count answers to a measurement.

### Verified against the real session

`sf` reads the emitted `COMPOUNDCURVE` as a curve, keeps it through
`st_transform` to EPSG:2227 and through a GeoPackage round trip, and
`sfarc::st_arc_parameters` reads back a sweep of 45.4999° clockwise, a chord of
193.341 ft and an arc of 198.517 ft from a curve typed as *"R 250 ft, Δ 45°30',
right"*. The radius reads **249.982** grid feet rather than 250 — a GROUND radius
is what the geodesic basis promises, and the projection's point scale factor is
the difference. Chord and radius are off by the same 0.999928, which is what says
it is the projection and not an error. It is also exactly why the grid basis sits
beside the geodesic one.

`draw:traverse` takes the curved course types too, and `stageGeometry` gained a
`wktOverride` so they survive: GeoJSON has no curve, so the staged `geometry` is
the densified line the map draws while the WKT keeps it a curve. Two paths to
the same figure that disagreed about what it IS would be invisible until someone
reopened the feature.
