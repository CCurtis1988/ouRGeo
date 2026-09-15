import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Compass, Check, Undo2, Flag, MapPin, Crosshair, Spline } from 'lucide-react'
import { RibbonButton } from '../ui/ribbon'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import { useTraverseStore } from '@/store/traverse'
import { useDrawPreviewStore } from '@/store/drawPreview'
import { useDrawActions } from '@/hooks/useDrawActions'
import { useAddFeature } from '@/hooks/useAddFeature'
import {
  traversePath, traverseOrigin, traverseIncoming, previewLeg, echoTraverse,
  usesReferencePoint, appendsRows, startTraverseRun, undoTraverseLeg,
} from '@/lib/draw/tools/distance-bearing'
import {
  parseDistance, parseBearing, parseAngle, parseCoordinate, formatDistance, formatRatio,
  closure, formatDms, formatBearing, norm360, toMetres, courseLengthM, inverse,
  UNITS, UNIT_IDS, BEARING_MODES, BEARING_MODE_IDS,
  type TraverseLeg, type TraverseCourse, type ParseResult,
} from '@/lib/draw/cogo'
import {
  solveSpiral, spiralGeometry, type SpiralElements, type SpiralForm, type SpiralRun,
} from '@/lib/draw/spiral'
import {
  solveCurve, curveGeometry, tangentAzimuthFromChord, tangentAzimuthFromRadial,
  CURVE_ELEMENTS, CURVE_ELEMENT_IDS,
  type CurveElementId, type CurveElements, type CurveGeometry,
} from '@/lib/draw/curve-cogo'
import { arcSplineFit, arcSplineFromSamples, type ArcPiece } from '@/lib/draw/arc-spline'
import { bezierCourse, type BezierRun } from '@/lib/draw/curves'
import { canComplete } from '@/lib/draw/draft'
import { useSpatialSettingsStore } from '@/store/spatialSettings'
import { saveSpatialSettings } from '@/lib/spatial-settings-persistence'
import { rClient } from '@/lib/r-client'
import type { DistanceUnit } from '@/lib/draw/cogo'
import type { CrsInfo, TraverseBasis, CourseType } from '@/store/traverse'
import type { Position } from '@/lib/draw/types'

/**
 * Where a traverse is typed.
 *
 * A docked strip under the map rather than a card floating over it: it never
 * covers the geometry it is building, and it never has to be moved out of the
 * way. It appears only while the Distance & Bearing tool is active, so the map
 * loses those 60 pixels only to someone who asked for them.
 *
 * **The keyboard is the point.** The first field takes focus the moment there
 * is a start point; Enter places the course and hands focus back to it, so a
 * traverse is `150 ⇥ N45-30-E ⏎ 82 ⇥ S12E ⏎` with no pointer at all. The
 * drawing hotkeys already ignore keystrokes aimed at an input
 * (`useDrawHotkeys.ts`), so D does not swap the tool out from under a distance
 * of "d150" being typed.
 *
 * **Straight courses and curves are one figure, and one strip.** A deed call
 * runs *"N45°30'E 150.00 feet; thence along a curve to the right, R = 250,
 * Δ = 45°30'; thence S12°E 82.00 feet"*. The Course selector changes which
 * fields are shown; everything else — the origin, the basis, the closure, the
 * echoed R — spans the whole figure, because the figure is what it is.
 *
 * **A course goes where the other drawing tools put one.** On a line or polygon
 * a straight course is a draft vertex and a curve is a run of arc segments,
 * finished with Finish. On a POINT layer either one writes the geometry of the
 * row the session is on and moves to the next row — for a curve that is its END
 * point, since a point layer's rows are points and not the path between them.
 */

const inputCls =
  'bg-geo-bg border border-geo-border rounded px-1.5 py-1 text-xs text-foreground ' +
  'outline-none focus:border-geo-accent placeholder:text-geo-muted/60'

const selectCls =
  'bg-geo-bg border border-geo-border rounded px-1 py-1 text-xs text-foreground ' +
  'outline-none focus:border-geo-accent'

/**
 * How far the committed arcs may sit from the curve that was typed.
 *
 * A millimetre: below survey noise, well below what a CRS round trip
 * preserves, and — the number that actually sets it — two orders of magnitude
 * finer than the 10 cm a coordinate readout is quoted to.
 */
const CURVE_TOLERANCE_M = 0.001

/**
 * Samples asked of R for a grid curve. A power of two, because
 * `arcSplineFromSamples` fits pieces at 1, 2, 4 … and every boundary and
 * midpoint has to land exactly on a sample rather than between two of them.
 */
const GRID_CURVE_SAMPLES = 128

/** A coordinate, in the form the readouts print and `parseCoordinate` reads
 *  back — six decimals is ~10 cm, which is the resolution of the claim. */
function fmtCoord([lng, lat]: [number, number]): string {
  const f = (n: number): string => (n < 0 ? '−' : '') + Math.abs(n).toFixed(6)
  return `${f(lng)}, ${f(lat)}`
}

/**
 * The unit to start in on a projected layer: its own.
 *
 * A plat in a State Plane zone is booked in US survey feet, and offering
 * metres first means every distance is converted by hand before it is typed.
 * Anything else — links, chains, a unit R could not name — is left on metres,
 * which the entry still accepts and converts.
 */
function unitForCrs(info: CrsInfo): DistanceUnit | null {
  const name = (info.unitName ?? '').toLowerCase()
  if (name.includes('us survey')) return 'usft'
  if (name.includes('foot') || name.includes('feet')) return 'ft'
  if (name.includes('metre') || name.includes('meter')) return 'm'
  return null
}

/** The segmented Turn control's two states. */
function turnCls(on: boolean): string {
  return on ? 'bg-geo-accent/10 text-geo-accent' : 'text-foreground hover:bg-geo-bg'
}

/** A curve element parses as a distance or as an angle, depending which it is. */
function parseElement(id: CurveElementId, text: string, unit: DistanceUnit): ParseResult<number> {
  return CURVE_ELEMENTS[id].quantity === 'length' ? parseDistance(text, unit) : parseAngle(text)
}

/**
 * Degree of curve is defined on 100-unit stations and is a US highway
 * convention, so it is offered only where the station means something: feet.
 * Showing it against metres would invite a number that is right on the page
 * and wrong in the field.
 */
function elementIdsFor(unit: DistanceUnit): CurveElementId[] {
  const feet = unit === 'ft' || unit === 'usft'
  return CURVE_ELEMENT_IDS.filter((id) => feet || id !== 'degreeOfCurve')
}

/** One course in the words it was entered in. */
function describeCourse(c: TraverseCourse): string {
  const abbr = UNITS[c.unit].abbr
  if (c.type === 'line') return `${c.distanceText} ${abbr} · ${c.bearingText}`
  if (c.type === 'bezier') {
    return `∿ ${c.distanceText} ${abbr} · ${c.bearingText} → ${c.arriveText}`
  }
  const arrow = c.turn === 'left' ? '↰' : '↱'
  if (c.type === 'spiral') {
    return `${arrow} ${c.entered.map((e) => `${e.label} ${e.text}`).join('  ')}`
  }
  return `${arrow} ${c.entered.map((e) => `${CURVE_ELEMENTS[e.id].symbol} ${e.text}`).join('  ')}`
}

/** The angle a course turned through, for the right-hand column of the list. */
function courseAngle(c: TraverseCourse): number {
  if (c.type === 'line') return c.azimuth
  if (c.type === 'bezier') return c.arriveAzimuth
  if (c.type === 'spiral') return c.elements.totalDeltaDeg
  return c.elements.deltaDeg
}

/**
 * What has been entered so far, in the words it was entered in.
 *
 * The list keeps each course's RAW text rather than the numbers it resolved to,
 * because that is what a user checks against their notes: "S44-30-W" is what
 * the page says, and 224°30' is what the computer made of it. Both are shown,
 * in that order.
 *
 * Read-only, deliberately. Editing a course in the middle moves everything
 * after it, which is a different feature (and a bigger one); Undo walks back
 * from the end, which is how a traverse is corrected in practice.
 */
function CourseList(
  { courses, unit }: { courses: TraverseCourse[]; unit: DistanceUnit }
): React.ReactElement | null {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('[data-ourgeo-id="draw.traverse.legs"]')) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  if (courses.length === 0) return null
  const total = courses.reduce((t, c) => t + courseLengthM(c), 0)
  return (
    <div className="relative flex-shrink-0" data-ourgeo-id="draw.traverse.legs">
      <button
        type="button"
        className="rounded px-1 text-geo-muted underline decoration-dotted underline-offset-2 hover:text-foreground"
        title="What has been entered so far"
        onClick={() => setOpen((v) => !v)}
      >
        {courses.length} course{courses.length === 1 ? '' : 's'}
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-1 z-50 max-h-64 w-80 overflow-y-auto
          rounded border border-geo-border bg-geo-panel py-1 shadow-lg">
          {courses.map((c, i) => (
            <div key={i} className="flex items-baseline gap-2 px-2 py-0.5 text-[11px]">
              <span className="w-5 flex-shrink-0 text-right text-geo-muted">{i + 1}</span>
              <span className="flex-1 font-mono text-foreground">{describeCourse(c)}</span>
              <span className="flex-shrink-0 font-mono text-geo-muted">{formatDms(courseAngle(c))}</span>
            </div>
          ))}
          <div className="mt-1 border-t border-geo-border px-2 pt-1 text-[10px] text-geo-muted">
            {formatDistance(total, unit)} entered
            {courses.some((c) => c.type !== 'line') && ' (curves measured along the arc)'}
          </div>
        </div>
      )}
    </div>
  )
}

const COURSE_LABELS: Record<CourseType, string> = {
  line: 'Distance & bearing',
  'tangent-curve': 'Tangent curve',
  curve: 'Curve',
  spiral: 'Spiral',
  scs: 'Spiral–curve–spiral',
  bezier: 'Free curve (Bézier)',
}

export function TraverseBar(): React.ReactElement | null {
  const session = useGeometryEditStore(selectActiveSession)
  const activeToolId = useGeometryEditStore((s) => s.activeToolId)
  const addVertex = useGeometryEditStore((s) => s.addVertex)
  const pendingRowAdd = useGeometryEditStore((s) => s.pendingRowAdd)

  const storePath = useTraverseStore((s) => s.path)
  const courses = useTraverseStore((s) => s.courses)
  const courseType = useTraverseStore((s) => s.courseType)
  const curve = useTraverseStore((s) => s.curve)
  const spiral = useTraverseStore((s) => s.spiral)
  const bezier = useTraverseStore((s) => s.bezier)
  const entry = useTraverseStore((s) => s.entry)
  const unit = useTraverseStore((s) => s.unit)
  const mode = useTraverseStore((s) => s.mode)
  const basis = useTraverseStore((s) => s.basis)
  const crs = useTraverseStore((s) => s.crs)
  const frame = useTraverseStore((s) => s.frame)
  const frameAt = useTraverseStore((s) => s.frameAt)
  const busy = useTraverseStore((s) => s.busy)
  const error = useTraverseStore((s) => s.error)
  const tv = useTraverseStore

  const setGhost = useDrawPreviewStore((s) => s.setGhost)
  const { finish, commitPoint, undoLast } = useDrawActions()
  const { confirmPendingRowAdd } = useAddFeature()

  const firstFieldRef = useRef<HTMLInputElement>(null)
  const startRef = useRef<HTMLInputElement>(null)

  const active = activeToolId === 'distance-bearing' && !!session
  const isCurve = courseType === 'curve' || courseType === 'tangent-curve'
  const isSpiral = courseType === 'spiral' || courseType === 'scs'
  const isBezier = courseType === 'bezier'
  // A Bézier ends at a distance and a bearing like a straight course does —
  // what makes it a curve is how it gets there, not where it goes. So it keeps
  // those two fields and has no turn direction: its shape comes from the two
  // headings rather than from a hand.
  const showLineFields = courseType === 'line' || isBezier
  const showTurn = isCurve || isSpiral
  // A point traverse measures from a reference point rather than from a
  // vertex, because a point layer's rows are separate features and the mark
  // they were shot from is usually not one of them.
  const isPoint = !!session && usesReferencePoint(session)
  const path = useMemo(
    () => (session ? traversePath(session, storePath) : []),
    [session, storePath]
  )
  const origin = session ? traverseOrigin(session, storePath) : null
  const incoming = session ? traverseIncoming(session, storePath, courses) : null
  const here = !!origin && !!frameAt && frameAt[0] === origin[0] && frameAt[1] === origin[1]
  const usableFrame = here ? frame : null

  /**
   * Say where the measuring starts.
   *
   * On a chain that IS the first vertex. On a point layer it is a reference
   * point and nothing else: no row, no geometry, no attributes — just the mark
   * the first distance and bearing are turned from.
   */
  const anchor = useCallback((p: Position) => {
    if (isPoint) startTraverseRun(p)
    else addVertex(p[0], p[1])
  }, [isPoint, addVertex])

  /**
   * Put the point a course landed on where this session keeps its geometry.
   *
   * A chain appends a vertex. A point session writes a feature — into the row
   * it is on (and moves to the next), or as a new row when the session was
   * opened by "Add Point(s)", which means append by construction.
   */
  const advance = useCallback(async (p: Position) => {
    if (!isPoint) { addVertex(p[0], p[1]); return }
    tv.getState().pushVertex(p)
    const sess = selectActiveSession(useGeometryEditStore.getState())
    if (sess && appendsRows(sess)) await commitPoint(p[0], p[1])
    else { addVertex(p[0], p[1]); await finish() }
  }, [isPoint, addVertex, commitPoint, finish, tv])

  /**
   * Put a curve where this session keeps its geometry.
   *
   * On a chain the arc pieces are appended as ordinary arc segments — the same
   * thing the draw tool's Arc mode produces, so the WKT emitter writes a real
   * CIRCULARSTRING and nothing downstream knows this came from a form.
   *
   * On a point layer only the END lands. Every row there is its own feature and
   * the path between two of them is not data; a curve says where the next point
   * is, and the arc it travelled is kept in the course record and the echoed R.
   */
  const placeCurve = useCallback(async (pieces: ArcPiece[], pt: Position) => {
    if (isPoint) { await advance(pt); return }
    useGeometryEditStore.getState().appendArcSegmentsToActivePath(pieces)
  }, [isPoint, advance])

  // The two preferences that outlive a session: the unit distances are typed
  // in and the notation bearings are written in. Seeded here rather than in
  // the store's initial state, because the file is read asynchronously at
  // startup and the tool may come up before or after that.
  useEffect(() => {
    if (!active) return
    const prefs = useSpatialSettingsStore.getState()
    if (prefs.traverseUnit && (UNIT_IDS as string[]).includes(prefs.traverseUnit)) {
      tv.getState().setUnit(prefs.traverseUnit as DistanceUnit)
    }
    if ((BEARING_MODE_IDS as string[]).includes(prefs.traverseNotation)) {
      tv.getState().setMode(prefs.traverseNotation as typeof mode)
    }
  }, [active, tv])

  const remember = useCallback((p: { unit?: string | null; notation?: string }) => {
    const st = useSpatialSettingsStore.getState()
    st.setTraversePrefs(p)
    void saveSpatialSettings(st.initialExtentMode, st.userExtent)
  }, [])

  // What the layer's coordinate system is, asked once when the tool comes up.
  // The answer decides the DEFAULT basis and unit: a projected layer is one
  // whose bearings most likely came off something drawn on that grid, and
  // silently measuring those on the ellipsoid would rotate the traverse by the
  // convergence. The user can still say otherwise; what they cannot do is not
  // be told which it is.
  useEffect(() => {
    if (!active || !session) return
    let cancelled = false
    void (async () => {
      const res = await rClient.spatialCrs({ name: session.accessPath, envName: session.envName })
      if (cancelled) return
      if (!res.success) { tv.getState().setCrs(null); return }
      const info: CrsInfo = {
        input: res.input ?? null,
        epsg: res.epsg ?? null,
        name: res.name ?? null,
        isGeographic: res.isGeographic !== false,
        unitName: res.unitName ?? null,
        unitToMetre: res.unitToMetre ?? null,
      }
      tv.getState().setCrs(info)
      if (!info.isGeographic) {
        tv.getState().setBasis('grid')
        // The layer's own unit, but only while the user has not chosen one:
        // `traverseUnit: null` is "follow the layer", and anything else is a
        // decision that should not be overridden by opening another layer.
        const u = unitForCrs(info)
        if (u && !useSpatialSettingsStore.getState().traverseUnit) tv.getState().setUnit(u)
      } else {
        tv.getState().setBasis('geodesic')
      }
    })()
    return () => { cancelled = true }
  }, [active, session?.accessPath, session?.envName, tv]) // eslint-disable-line react-hooks/exhaustive-deps

  // The grid frame at the vertex we are measuring FROM, so that even the first
  // course previews where it will actually be committed. Without it the first
  // leg of a grid traverse is drawn geodesically and then jumps by the
  // convergence when R answers — about a metre in a UTM zone, which is exactly
  // the error this basis exists to avoid.
  useEffect(() => {
    if (!active || !session || basis !== 'grid' || !origin || here) return
    let cancelled = false
    void (async () => {
      const res = await rClient.spatialTraverse({
        origin, courses: [], basis: 'grid',
        name: session.accessPath, envName: session.envName,
      })
      if (!cancelled && res.success && res.frame) tv.getState().setFrame(res.frame, origin)
    })()
    return () => { cancelled = true }
  }, [active, session, basis, origin, here, tv])

  // What the straight-course fields describe, recomputed on every keystroke:
  // the destination for the readout, or the refusal to show under the fields.
  const pending = useMemo(() => {
    if (!origin || !showLineFields) return null
    const d = parseDistance(entry.distance, unit)
    const b = parseBearing(entry.bearing, mode, incoming)
    if (!d.ok || !b.ok) {
      // Only complain about a field that has something in it — an empty form
      // is not a mistake, it is a form nobody has filled in yet.
      const complaint = (!d.ok && entry.distance.trim() && d.error)
        || (!b.ok && entry.bearing.trim() && b.error) || null
      return { position: null, distanceM: null, azimuth: null, complaint }
    }
    return {
      position: previewLeg(origin, d.value, b.value, basis, usableFrame),
      distanceM: d.value,
      azimuth: b.value,
      complaint: null,
    }
  }, [origin, showLineFields, entry.distance, entry.bearing, unit, mode, incoming, basis, usableFrame])

  /**
   * What the curve fields describe.
   *
   * `tangentAz` is in the BASIS's own terms — a grid bearing on the grid basis,
   * because that is what the user is typing and what R will be given. The
   * preview then converts back: a geodesic curve is the only thing the renderer
   * can draw, so the radius is divided by the point scale factor and the
   * tangent turned by the convergence, exactly the reduction `reduceGridLeg`
   * makes for a straight leg.
   */
  const pendingCurve = useMemo((): {
    elements: CurveElements | null
    geometry: CurveGeometry | null
    tangentAz: number | null
    complaint: string | null
  } | null => {
    if (!origin || !isCurve) return null
    const none = { elements: null, geometry: null, tangentAz: null }

    const a = parseElement(curve.aId, curve.aText, unit)
    const b = parseElement(curve.bId, curve.bText, unit)
    if (!a.ok || !b.ok) {
      const complaint = (!a.ok && curve.aText.trim() && a.error)
        || (!b.ok && curve.bText.trim() && b.error) || null
      return { ...none, complaint }
    }

    const solved = solveCurve({
      turn: curve.turn,
      a: { id: curve.aId, value: a.value },
      b: { id: curve.bId, value: b.value },
      stationM: toMetres(100, unit),
      degreeDefinition: curve.degreeDefinition,
    })
    if (!solved.ok) return { ...none, complaint: solved.error }

    let tangentAz: number
    if (courseType === 'tangent-curve') {
      if (incoming === null) {
        return {
          ...none,
          complaint: 'A tangent curve continues the course before it, and there is not one yet. '
            + 'Use Curve and give it a chord or radial bearing.',
        }
      }
      // `incoming` is read off the geometry, which is geodesic. On the grid
      // basis every number in this strip is a grid number, so the tangent has
      // to be turned back onto the grid before it joins them.
      tangentAz = basis === 'grid' && usableFrame
        ? norm360(incoming - usableFrame.convergence)
        : incoming
    } else {
      const ob = parseBearing(curve.orientText, mode, incoming)
      if (!ob.ok) return { ...none, complaint: curve.orientText.trim() ? ob.error : null }
      tangentAz = curve.orientKind === 'chord'
        ? tangentAzimuthFromChord(ob.value, solved.value.deltaDeg, curve.turn)
        : tangentAzimuthFromRadial(ob.value, curve.turn)
    }

    const reduce = basis === 'grid' && usableFrame
    const drawElements = reduce
      ? { ...solved.value, radiusM: solved.value.radiusM / usableFrame.scale }
      : solved.value
    const drawTangent = reduce ? norm360(tangentAz + usableFrame.convergence) : tangentAz

    return {
      elements: solved.value,
      geometry: curveGeometry(origin, drawTangent, drawElements),
      tangentAz,
      complaint: null,
    }
  }, [origin, isCurve, courseType, curve, unit, mode, incoming, basis, usableFrame])

  /**
   * What the transition fields describe.
   *
   * A spiral is always tangential — it transitions FROM something, which is
   * what it is for — so there is no orientation to give it and no course it can
   * be the first of. Saying that is more use than drawing one pointing north.
   */
  const pendingSpiral = useMemo((): {
    elements: SpiralElements | null
    run: SpiralRun | null
    tangentAz: number | null
    form: SpiralForm
    complaint: string | null
  } | null => {
    if (!origin || !isSpiral) return null
    const form: SpiralForm = courseType === 'scs' ? 'scs' : spiral.direction
    const none = { elements: null, run: null, tangentAz: null, form }

    const len = parseDistance(spiral.lengthText, unit)
    const rad = parseDistance(spiral.radiusText, unit)
    const wantsOut = courseType === 'scs' && spiral.lengthOutText.trim() !== ''
    const lenOut = wantsOut ? parseDistance(spiral.lengthOutText, unit) : null
    const delta = courseType === 'scs' ? parseAngle(spiral.deltaText) : null

    if (!len.ok || !rad.ok || (lenOut && !lenOut.ok) || (delta && !delta.ok)) {
      const complaint = (!len.ok && spiral.lengthText.trim() && len.error)
        || (!rad.ok && spiral.radiusText.trim() && rad.error)
        || (lenOut && !lenOut.ok && lenOut.error)
        || (delta && !delta.ok && spiral.deltaText.trim() && delta.error)
        || null
      return { ...none, complaint }
    }

    if (incoming === null) {
      return {
        ...none,
        complaint: 'A transition curve continues the course before it, and there is not one yet. '
          + 'Place a distance and bearing first.',
      }
    }

    const reduce = basis === 'grid' && usableFrame
    const scale = reduce ? usableFrame.scale : 1
    const solved = solveSpiral({
      form,
      turn: curve.turn,
      radiusM: rad.value / scale,
      lengthInM: len.value / scale,
      lengthOutM: lenOut && lenOut.ok ? lenOut.value / scale : undefined,
      totalDeltaDeg: delta && delta.ok ? delta.value : undefined,
    })
    if (!solved.ok) return { ...none, complaint: solved.error }

    // `incoming` is geodesic; on the grid basis the typed numbers are grid
    // numbers, so the tangent is turned onto the grid and then back again for
    // the preview — the same reduction a straight leg makes.
    const gridTangent = reduce ? norm360(incoming - usableFrame.convergence) : incoming
    const drawTangent = reduce ? norm360(gridTangent + usableFrame.convergence) : gridTangent

    return {
      elements: solved.value,
      run: spiralGeometry(origin, drawTangent, solved.value, form, curve.turn),
      tangentAz: gridTangent,
      form,
      complaint: null,
    }
  }, [origin, isSpiral, courseType, spiral, curve.turn, unit, incoming, basis, usableFrame])

  /**
   * What the free-curve fields describe.
   *
   * The destination comes from `pending` — a Bézier ends at a distance and a
   * bearing exactly as a straight course does — so all this adds is the
   * heading to arrive on and how hard to bend getting there.
   */
  const pendingBezier = useMemo((): {
    run: BezierRun | null
    arriveAz: number | null
    tension: number
    lengthM: number
    complaint: string | null
  } | null => {
    if (!origin || !isBezier) return null
    const tension = Number(bezier.tensionText)
    const none = { run: null, arriveAz: null, tension: 1, lengthM: 0 }
    if (!pending?.position) return { ...none, complaint: null }
    if (incoming === null) {
      return {
        ...none,
        complaint: 'A free curve continues the course before it, and there is not one yet. '
          + 'Place a distance and bearing first.',
      }
    }
    if (!Number.isFinite(tension) || tension < 0) {
      return { ...none, complaint: 'Bend is a number — 1 is the roundest curve between the two headings.' }
    }
    const arrive = parseBearing(bezier.arriveText, mode, incoming)
    if (!arrive.ok) {
      return { ...none, complaint: bezier.arriveText.trim() ? arrive.error : null }
    }
    // The typed arrival is a grid bearing on the grid basis; the curve is drawn
    // on the ground either way, so it is turned by the convergence to be drawn
    // and kept as typed in the record.
    const drawArrive = basis === 'grid' && usableFrame
      ? norm360(arrive.value + usableFrame.convergence)
      : arrive.value
    const run = bezierCourse(origin, incoming, pending.position, drawArrive, tension)
    // Measured along the curve, which is what the closure has to count.
    let lengthM = 0
    let prev = run.at(0)
    for (let i = 1; i <= 256; i++) {
      const p = run.at(i / 256)
      lengthM += inverse(prev, p).distanceM
      prev = p
    }
    return { run, arriveAz: arrive.value, tension, lengthM, complaint: null }
  }, [origin, isBezier, bezier, pending, incoming, mode, basis, usableFrame])

  const complaint = pending?.complaint ?? pendingCurve?.complaint
    ?? pendingSpiral?.complaint ?? pendingBezier?.complaint ?? null

  // The ghost is the course being typed. Cleared when the tool goes away, or
  // the dashed line would outlive the strip that explains it.
  useEffect(() => {
    if (!active || !origin) {
      setGhost(null)
      tv.getState().setLegLabel(null)
      return
    }
    if (isBezier) {
      const run = pendingBezier?.run
      if (!run) { setGhost(null); tv.getState().setLegLabel(null); return }
      const coords: Position[] = []
      for (let i = 0; i <= 96; i++) coords.push(run.at(i / 96))
      setGhost({ type: 'LineString', coordinates: coords.map(([x, y]) => [x, y]) })
      tv.getState().setLegLabel(
        `${formatDistance(pendingBezier?.lengthM ?? 0, unit)} along`
        + ` · arrives ${formatDms(run.outAzimuthDeg)}`
      )
      return
    }
    if (isSpiral) {
      const run = pendingSpiral?.run
      const el = pendingSpiral?.elements
      if (!run || !el) { setGhost(null); tv.getState().setLegLabel(null); return }
      const coords: Position[] = [run.parts[0].at(0)]
      for (const part of run.parts) {
        const steps = Math.max(8, Math.round(64 * (part.lengthM / el.totalLengthM)))
        for (let i = 1; i <= steps; i++) coords.push(part.at(i / steps))
      }
      setGhost({ type: 'LineString', coordinates: coords.map(([x, y]) => [x, y]) })
      tv.getState().setLegLabel(
        `Ls ${formatDistance(el.lengthInM, unit)} · R ${formatDistance(el.radiusM, unit)}`
        + ` · θs ${formatDms(el.thetaInDeg)}`
      )
      return
    }
    if (isCurve) {
      const g = pendingCurve?.geometry
      const el = pendingCurve?.elements
      if (!g || !el) { setGhost(null); tv.getState().setLegLabel(null); return }
      const coords: Position[] = []
      for (let i = 0; i <= 96; i++) coords.push(g.at(i / 96))
      setGhost({ type: 'LineString', coordinates: coords.map(([x, y]) => [x, y]) })
      tv.getState().setLegLabel(
        `R ${formatDistance(el.radiusM, unit)} · Δ ${formatDms(el.deltaDeg)}`
        + ` · L ${formatDistance(el.arcLengthM, unit)}`
      )
      return
    }
    if (!pending?.position) { setGhost(null); tv.getState().setLegLabel(null); return }
    setGhost({
      type: 'LineString',
      coordinates: [[origin[0], origin[1]], [pending.position[0], pending.position[1]]],
    })
    // The same two numbers as the readout, put where the line is: on a wide
    // map the strip is a long way from the geometry it is describing.
    tv.getState().setLegLabel(
      `${formatDistance(pending.distanceM ?? 0, unit)} · ${formatBearing(pending.azimuth ?? 0, mode, incoming)}`
    )
  }, [active, origin, isCurve, isSpiral, isBezier, pending, pendingCurve, pendingSpiral,
    pendingBezier, setGhost, unit, mode, incoming, tv])

  useEffect(() => () => setGhost(null), [setGhost])

  // Focus follows the state of the traverse: the coordinate box while there is
  // no start point, the first number the moment there is one.
  useEffect(() => {
    if (!active) return
    if (origin) firstFieldRef.current?.focus()
    else startRef.current?.focus()
  }, [active, !!origin, courseType]) // eslint-disable-line react-hooks/exhaustive-deps

  const placeStart = useCallback((text: string) => {
    const parsed = parseCoordinate(text)
    if (!parsed.ok) {
      tv.getState().setError(parsed.error)
      return
    }
    anchor(parsed.value)
    tv.getState().setEntry({ distance: '', bearing: '' })
  }, [anchor, tv])

  /** The last leg used up the dataset and the ribbon is asking whether to add
   *  another row. Typing the next course and pressing Enter is an unambiguous
   *  yes, so answer it here: the alternative is a traverse that stops dead
   *  every time it reaches the end of the table. */
  const answerRowPrompt = useCallback(async (): Promise<boolean> => {
    if (!useGeometryEditStore.getState().pendingRowAdd) return true
    await confirmPendingRowAdd()
    if (!selectActiveSession(useGeometryEditStore.getState())) {
      tv.getState().setError('The row could not be added, so nothing was placed.')
      return false
    }
    return true
  }, [confirmPendingRowAdd, tv])

  const submitLine = useCallback(() => {
    if (!session || !origin) return
    const d = parseDistance(entry.distance, unit)
    if (!d.ok) { tv.getState().setError(d.error); return }
    const b = parseBearing(entry.bearing, mode, incoming)
    if (!b.ok) { tv.getState().setError(b.error); return }

    const leg: TraverseLeg = {
      type: 'line',
      distanceText: entry.distance.trim(),
      bearingText: entry.bearing.trim(),
      unit, mode, distanceM: d.value, azimuth: b.value,
    }

    tv.getState().setBusy(true)
    void (async () => {
      try {
        if (!(await answerRowPrompt())) return

        if (basis === 'geodesic') {
          await advance(previewLeg(origin, d.value, b.value, 'geodesic', null))
          tv.getState().addCourse(leg)
          setGhost(null)
          firstFieldRef.current?.focus()
          return
        }

        // Grid: the vertex that is KEPT is R's projected arithmetic, never the
        // local reduction the ghost was drawn with. The reply also carries the
        // frame at the new vertex, which is what previews the next course.
        const res = await rClient.spatialTraverse({
          origin, basis: 'grid',
          courses: [{ type: 'line', distance: d.value, azimuth: b.value }],
          name: session.accessPath, envName: session.envName,
        })
        if (!res.success || !res.vertices || res.vertices.length < 2) {
          tv.getState().setError(res.error ?? 'R could not place that leg on the layer’s grid.')
          return
        }
        const landed = res.vertices[res.vertices.length - 1]
        await advance(landed)
        tv.getState().setFrame(res.frame ?? null, landed)
        tv.getState().addCourse(leg)
        setGhost(null)
        firstFieldRef.current?.focus()
      } catch (e) {
        // A severed connection is not a data problem — say so, and name the
        // basis that needs nothing from R.
        tv.getState().setError(
          `${String(e)} — the geodesic basis needs nothing from R if this keeps happening.`
        )
      } finally {
        tv.getState().setBusy(false)
      }
    })()
  }, [session, origin, entry, unit, mode, incoming, basis, advance, answerRowPrompt, setGhost, tv])

  const submitCurve = useCallback(() => {
    if (!session || !origin) return
    const pc = pendingCurve
    if (!pc?.elements || !pc.geometry || pc.tangentAz === null) {
      tv.getState().setError(pc?.complaint ?? 'Fill in both curve elements.')
      return
    }
    const elements = pc.elements
    const tangentAz = pc.tangentAz
    // A curve of half a turn or more cannot be one arc: three points two of
    // which coincide define no circle, and at exactly 180° the via is the only
    // thing distinguishing the two halves.
    const minPieces = elements.deltaDeg >= 170 ? 2 : 1

    const record: TraverseCourse = {
      type: 'curve',
      tangential: courseType === 'tangent-curve',
      turn: curve.turn,
      entered: [
        { id: curve.aId, text: curve.aText.trim() },
        { id: curve.bId, text: curve.bText.trim() },
      ],
      unit,
      orientation: courseType === 'tangent-curve'
        ? null
        : { kind: curve.orientKind, text: curve.orientText.trim(), mode },
      elements,
      inAzimuth: tangentAz,
      outAzimuth: norm360(tangentAz + (curve.turn === 'right' ? 1 : -1) * elements.deltaDeg),
    }

    tv.getState().setBusy(true)
    void (async () => {
      try {
        if (!(await answerRowPrompt())) return

        if (basis === 'geodesic') {
          const fit = arcSplineFit(pc.geometry!.at, { toleranceM: CURVE_TOLERANCE_M, minPieces })
          await placeCurve(fit.pieces, pc.geometry!.pt)
          tv.getState().addCourse(record)
          setGhost(null)
          firstFieldRef.current?.focus()
          return
        }

        // Grid: the curve is a true circle in the layer's projected CRS, and
        // that arithmetic is R's. It comes back as samples at exact parameters
        // so the arcs can be fitted through them without interpolating.
        const res = await rClient.spatialTraverse({
          origin, basis: 'grid',
          courses: [{
            type: 'curve',
            azimuth: tangentAz,
            radius: elements.radiusM,
            delta: elements.deltaDeg,
            turn: curve.turn === 'left' ? 'L' : 'R',
            samples: GRID_CURVE_SAMPLES,
          }],
          name: session.accessPath, envName: session.envName,
        })
        if (!res.success || !res.vertices || res.vertices.length < 3) {
          tv.getState().setError(res.error ?? 'R could not place that curve on the layer’s grid.')
          return
        }
        const samples = res.vertices as Position[]
        const landed = samples[samples.length - 1]
        const fit = arcSplineFromSamples(samples, { toleranceM: CURVE_TOLERANCE_M, minPieces })
        await placeCurve(fit.pieces, landed)
        tv.getState().setFrame(res.frame ?? null, landed)
        tv.getState().addCourse(record)
        setGhost(null)
        firstFieldRef.current?.focus()
      } catch (e) {
        tv.getState().setError(
          `${String(e)} — the geodesic basis needs nothing from R if this keeps happening.`
        )
      } finally {
        tv.getState().setBusy(false)
      }
    })()
  }, [session, origin, pendingCurve, courseType, curve, unit, mode, basis,
    placeCurve, answerRowPrompt, setGhost, tv])

  const submitSpiral = useCallback(() => {
    if (!session || !origin) return
    const ps = pendingSpiral
    if (!ps?.elements || !ps.run || ps.tangentAz === null) {
      tv.getState().setError(ps?.complaint ?? 'Fill in the spiral length and the radius.')
      return
    }
    const elements = ps.elements
    const tangentAz = ps.tangentAz

    const entered: { label: string; text: string }[] = [
      { label: 'Ls', text: spiral.lengthText.trim() },
      { label: 'R', text: spiral.radiusText.trim() },
    ]
    if (courseType === 'scs') {
      entered.push({ label: 'Δ', text: spiral.deltaText.trim() })
      if (spiral.lengthOutText.trim()) {
        entered.push({ label: 'Ls out', text: spiral.lengthOutText.trim() })
      }
    }
    const record: TraverseCourse = {
      type: 'spiral',
      form: ps.form,
      turn: curve.turn,
      unit,
      entered,
      elements,
      inAzimuth: tangentAz,
      outAzimuth: ps.run.outAzimuthDeg,
    }

    tv.getState().setBusy(true)
    void (async () => {
      try {
        if (!(await answerRowPrompt())) return

        if (basis === 'geodesic') {
          // Each part is fitted separately: the circular middle of an SCS is
          // exactly an arc and wants one piece, where a spiral wants about
          // eight. Fitting them together would spend the spiral's piece count
          // on the part that did not need it.
          const pieces: ArcPiece[] = []
          for (const part of ps.run!.parts) {
            pieces.push(...arcSplineFit(part.at, { toleranceM: CURVE_TOLERANCE_M }).pieces)
          }
          await placeCurve(pieces, ps.run!.end)
          tv.getState().addCourse(record)
          setGhost(null)
          firstFieldRef.current?.focus()
          return
        }

        const res = await rClient.spatialTraverse({
          origin, basis: 'grid',
          courses: [{
            type: 'spiral',
            form: ps.form,
            azimuth: tangentAz,
            radius: elements.radiusM,
            length: elements.lengthInM,
            lengthOut: ps.form === 'scs' ? elements.lengthOutM : undefined,
            delta: ps.form === 'scs' ? elements.totalDeltaDeg : undefined,
            turn: curve.turn === 'left' ? 'L' : 'R',
            samples: GRID_CURVE_SAMPLES,
          }],
          name: session.accessPath, envName: session.envName,
        })
        if (!res.success || !res.vertices || res.vertices.length < 3) {
          tv.getState().setError(res.error ?? 'R could not place that spiral on the layer’s grid.')
          return
        }
        const samples = res.vertices as Position[]
        const landed = samples[samples.length - 1]
        const fit = arcSplineFromSamples(samples, { toleranceM: CURVE_TOLERANCE_M })
        await placeCurve(fit.pieces, landed)
        tv.getState().setFrame(res.frame ?? null, landed)
        tv.getState().addCourse(record)
        setGhost(null)
        firstFieldRef.current?.focus()
      } catch (e) {
        tv.getState().setError(
          `${String(e)} — the geodesic basis needs nothing from R if this keeps happening.`
        )
      } finally {
        tv.getState().setBusy(false)
      }
    })()
  }, [session, origin, pendingSpiral, courseType, spiral, curve.turn, unit, basis,
    placeCurve, answerRowPrompt, setGhost, tv])

  const submitBezier = useCallback(() => {
    if (!session || !origin) return
    const pb = pendingBezier
    if (!pb?.run || pb.arriveAz === null || !pending?.position) {
      tv.getState().setError(
        pb?.complaint ?? 'Fill in the distance, the bearing and the heading to arrive on.'
      )
      return
    }

    const record: TraverseCourse = {
      type: 'bezier',
      unit,
      mode,
      distanceText: entry.distance.trim(),
      bearingText: entry.bearing.trim(),
      arriveText: bezier.arriveText.trim(),
      distanceM: pending.distanceM ?? 0,
      azimuth: pending.azimuth ?? 0,
      arriveAzimuth: pb.arriveAz,
      tension: pb.tension,
      lengthM: pb.lengthM,
      inAzimuth: incoming ?? 0,
      outAzimuth: pb.run.outAzimuthDeg,
    }

    tv.getState().setBusy(true)
    void (async () => {
      try {
        if (!(await answerRowPrompt())) return

        if (basis === 'geodesic') {
          const fit = arcSplineFit(pb.run!.at, { toleranceM: CURVE_TOLERANCE_M })
          await placeCurve(fit.pieces, pb.run!.end)
          tv.getState().addCourse(record)
          setGhost(null)
          firstFieldRef.current?.focus()
          return
        }

        // On the grid basis the curve is R's, exactly as a circular curve or a
        // spiral is: the ends are a distance and a bearing measured on the
        // layer's own grid, and the shape between them is drawn in that plane.
        // Asking only for the end point and drawing the rest here would commit
        // a curve a few millimetres from the one the echo reproduces.
        const gridTangent = usableFrame
          ? norm360((incoming ?? 0) - usableFrame.convergence)
          : incoming ?? 0
        const res = await rClient.spatialTraverse({
          origin, basis: 'grid',
          courses: [{
            type: 'bezier',
            // `azimuth` is the bearing to the END point, so where the curve
            // leaves is its own field rather than something R can infer from a
            // single course sent on its own.
            leave: gridTangent,
            distance: record.distanceM,
            azimuth: record.azimuth,
            arrive: record.arriveAzimuth,
            tension: record.tension,
            samples: GRID_CURVE_SAMPLES,
          }],
          name: session.accessPath, envName: session.envName,
        })
        if (!res.success || !res.vertices || res.vertices.length < 3) {
          tv.getState().setError(res.error ?? 'R could not place that curve on the layer’s grid.')
          return
        }
        const samples = res.vertices as Position[]
        const landed = samples[samples.length - 1]
        const fit = arcSplineFromSamples(samples, { toleranceM: CURVE_TOLERANCE_M })
        await placeCurve(fit.pieces, landed)
        tv.getState().setFrame(res.frame ?? null, landed)
        tv.getState().addCourse(record)
        setGhost(null)
        firstFieldRef.current?.focus()
      } catch (e) {
        tv.getState().setError(String(e))
      } finally {
        tv.getState().setBusy(false)
      }
    })()
  }, [session, origin, pendingBezier, pending, entry, bezier, unit, mode, incoming,
    basis, usableFrame, placeCurve, answerRowPrompt, setGhost, tv])

  const submit = useCallback(() => {
    if (isBezier) submitBezier()
    else if (isSpiral) submitSpiral()
    else if (isCurve) submitCurve()
    else submitLine()
  }, [isCurve, isSpiral, isBezier, submitCurve, submitLine, submitSpiral, submitBezier])

  const undoCourse = useCallback(() => {
    void undoTraverseLeg({ undoLast })
  }, [undoLast])

  /** Return to the first vertex and finish. Chains only: a point layer's
   *  reference is not one of its features, so there is nothing to return to. */
  const closeRing = useCallback(async () => {
    if (!session || isPoint || path.length < 3) return
    await advance(path[0])
    setGhost(null)
    echoTraverse()
    void finish()
  }, [session, path, isPoint, advance, setGhost, finish])

  const shut = useMemo(() => closure(path, courses), [path, courses])

  if (!active || !session) return null

  const canFinish = !isPoint && canComplete(session)
  // On a point traverse path[0] is the reference and is not a leg, so there is
  // nothing to take back until something has actually been placed.
  const canUndo = path.length > (isPoint ? 1 : 0)
  const atReference = isPoint && path.length === 1
  const elementIds = elementIdsFor(unit)
  const onEnter = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') { e.preventDefault(); submit() }
  }

  return (
    <div
      data-ourgeo-id="draw.traverse"
      data-export-hide
      className="flex-shrink-0 border-t border-geo-border bg-geo-panel px-3 py-1.5 text-xs"
    >
      {/* Row 1 — where you are measuring from, and where this course lands. The
          tool's own name is on the ribbon button an inch below; repeating it
          here cost the width the readout needs on a narrow panel. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
        <Compass className="w-3 h-3 flex-shrink-0 text-geo-accent" />
        {origin ? (
          <span className="flex-shrink-0 text-geo-muted">
            From <span className="font-mono text-foreground">{fmtCoord(origin)}</span>
            {atReference && <span className="ml-1">· reference</span>}
            {path.length > 1 && (
              <span className="ml-1">· {isPoint ? 'point' : 'vertex'} {path.length}</span>
            )}
          </span>
        ) : (
          <span className="flex-shrink-0 text-geo-muted">
            {isPoint
              ? 'Click the map to place a reference point to measure from — or type one:'
              : 'Click the map to place the start point — or type one:'}
          </span>
        )}
        {!origin && (
          <input
            ref={startRef}
            className={`${inputCls} w-44 font-mono`}
            placeholder="−122.419400, 37.774900"
            data-ourgeo-id="draw.traverse.start"
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              placeStart((e.target as HTMLInputElement).value)
            }}
          />
        )}
        {/* The readout, in priority order: what is wrong, else where this
            course lands. A readout that showed both would be one nobody reads. */}
        <span className="flex-shrink-0 font-mono">
          {error || complaint ? (
            <span className="font-sans text-geo-error">{error ?? complaint}</span>
          ) : isCurve && pendingCurve?.geometry ? (
            <span className="text-foreground">→ {fmtCoord(pendingCurve.geometry.pt)}</span>
          ) : pending?.position ? (
            <>
              <span className="text-foreground">→ {fmtCoord(pending.position)}</span>
              <span className="ml-2 text-geo-muted">
                {formatDistance(pending.distanceM ?? 0, unit)} · {formatDms(pending.azimuth ?? 0)}
              </span>
            </>
          ) : null}
        </span>

        <div className="flex-1 min-w-0" />
        {/* What the numbers mean, stated rather than assumed — and changeable,
            because only the person holding the plat knows whether the bearings
            on it were measured from true north or from the grid. */}
        <label className="flex flex-shrink-0 items-center gap-1 text-geo-muted">
          Measured on
          <select
            className={selectCls}
            value={basis}
            data-ourgeo-id="draw.traverse.basis"
            title={
              basis === 'geodesic'
                ? 'Distances on the WGS84 ellipsoid, bearings from true north — the same numbers anywhere on Earth, whatever the layer’s CRS.'
                : 'Distances and bearings on the layer’s own projected grid, which is what a survey plat in a projected CRS is drawn to. A curve there is a true circle.'
            }
            onChange={(e) => tv.getState().setBasis(e.target.value as TraverseBasis)}
          >
            <option value="geodesic">Geodesic · WGS 84</option>
            <option value="grid" disabled={!crs || crs.isGeographic}>
              {crs && !crs.isGeographic
                ? `Grid · ${crs.input ?? crs.name ?? 'layer CRS'}`
                : 'Grid · (layer is not projected)'}
            </option>
          </select>
        </label>
      </div>

      {/* Row 2 — the numbers, what they produce, and what to do with them. */}
      {/* Wrapping, not scrolling — the drawing ribbon below scrolls because a
          hidden tool can be reached another way, but a hidden "Add course" is a
          form with no submit. On a narrow map pane the buttons drop to a line
          of their own instead of off the edge. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 min-w-0">
        <select
          className={selectCls}
          value={courseType}
          data-ourgeo-id="draw.traverse.course"
          title="What kind of course this is. A traverse mixes them freely — the closure and the echoed R span all of it."
          onChange={(e) => tv.getState().setCourseType(e.target.value as CourseType)}
        >
          {(Object.keys(COURSE_LABELS) as CourseType[]).map((id) => (
            <option key={id} value={id}>{COURSE_LABELS[id]}</option>
          ))}
        </select>

        {showLineFields && (
          <>
            <label className="flex items-center gap-1 flex-shrink-0 text-geo-muted">
              Distance
              <input
                ref={firstFieldRef}
                className={`${inputCls} w-24`}
                value={entry.distance}
                disabled={!origin || busy}
                placeholder="150.00"
                data-ourgeo-id="draw.traverse.distance"
                onChange={(e) => tv.getState().setEntry({ distance: e.target.value })}
                onKeyDown={onEnter}
              />
              <select
                className={selectCls}
                value={unit}
                data-ourgeo-id="draw.traverse.unit"
                onChange={(e) => {
                  tv.getState().setUnit(e.target.value as typeof unit)
                  remember({ unit: e.target.value })
                }}
              >
                {UNIT_IDS.map((id) => (
                  <option key={id} value={id}>{UNITS[id].abbr}</option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-1 flex-shrink-0 text-geo-muted">
              Bearing
              <input
                className={`${inputCls} w-28`}
                value={entry.bearing}
                disabled={!origin || busy}
                placeholder={mode === 'quadrant' ? "N45°30'E" : mode === 'azimuth' ? "45°30'" : 'R90'}
                title={BEARING_MODES[mode].hint}
                data-ourgeo-id="draw.traverse.bearing"
                onChange={(e) => tv.getState().setEntry({ bearing: e.target.value })}
                onKeyDown={onEnter}
              />
              <select
                className={selectCls}
                value={mode}
                data-ourgeo-id="draw.traverse.mode"
                onChange={(e) => {
                  tv.getState().setMode(e.target.value as typeof mode)
                  remember({ notation: e.target.value })
                }}
              >
                {BEARING_MODE_IDS.map((id) => (
                  <option key={id} value={id}>{BEARING_MODES[id].label}</option>
                ))}
              </select>
            </label>
          </>
        )}

        {showTurn && (
          <>
            {/* Which way it bends is the first thing a deed says, so it is a
                pair of buttons rather than a dropdown to open. */}
            <div className="flex flex-shrink-0 items-center gap-1 text-geo-muted">
              Turn
              <div className="flex overflow-hidden rounded border border-geo-border">
                {/* Written out rather than mapped: the highlight catalogue is
                    checked against literal id attributes found in the source,
                    so an interpolated one would leave the assistant pointing at
                    a control the test believes does not exist. (The scanner
                    reads comments too, so this one says it in prose.) */}
                <button
                  type="button"
                  disabled={!origin || busy}
                  data-ourgeo-id="draw.traverse.turn.left"
                  className={`px-2 py-1 ${turnCls(curve.turn === 'left')}`}
                  title="Curve to the left"
                  onClick={() => tv.getState().setCurve({ turn: 'left' })}
                >
                  ↰ Left
                </button>
                <button
                  type="button"
                  disabled={!origin || busy}
                  data-ourgeo-id="draw.traverse.turn.right"
                  className={`px-2 py-1 ${turnCls(curve.turn === 'right')}`}
                  title="Curve to the right"
                  onClick={() => tv.getState().setCurve({ turn: 'right' })}
                >
                  ↱ Right
                </button>
              </div>
            </div>
          </>
        )}

        {isBezier && (
          <>
            <label className="flex items-center gap-1 flex-shrink-0 text-geo-muted">
              Arrive
              <input
                className={`${inputCls} w-28`}
                value={bezier.arriveText}
                disabled={!origin || busy}
                placeholder={mode === 'quadrant' ? "S30°E" : "150°"}
                title="The heading the curve arrives on. It leaves on the one it inherited, so these two are the shape."
                data-ourgeo-id="draw.traverse.bezier.arrive"
                onChange={(e) => tv.getState().setBezier({ arriveText: e.target.value })}
                onKeyDown={onEnter}
              />
            </label>
            <label className="flex items-center gap-1 flex-shrink-0 text-geo-muted">
              Bend
              <input
                className={`${inputCls} w-14`}
                value={bezier.tensionText}
                disabled={!origin || busy}
                placeholder="1"
                title="How far the handles reach, as a multiple of a third of the chord. 1 is the roundest curve between the two headings; less tightens the bend toward the ends, more overshoots."
                data-ourgeo-id="draw.traverse.bezier.tension"
                onChange={(e) => tv.getState().setBezier({ tensionText: e.target.value })}
                onKeyDown={onEnter}
              />
            </label>
          </>
        )}

        {isSpiral && (
          <>
            {/* Entry or exit. An exit spiral runs from a curve back out to a
                tangent, which is a different geometry and not a label. */}
            {courseType === 'spiral' && (
              <div className="flex flex-shrink-0 overflow-hidden rounded border border-geo-border">
                <button
                  type="button"
                  disabled={!origin || busy}
                  data-ourgeo-id="draw.traverse.spiral.in"
                  className={`px-2 py-1 ${turnCls(spiral.direction === 'in')}`}
                  title="Entry spiral — tangent into the curve, curvature growing from zero"
                  onClick={() => tv.getState().setSpiral({ direction: 'in' })}
                >
                  Entry
                </button>
                <button
                  type="button"
                  disabled={!origin || busy}
                  data-ourgeo-id="draw.traverse.spiral.out"
                  className={`px-2 py-1 ${turnCls(spiral.direction === 'out')}`}
                  title="Exit spiral — curve back out to a tangent, curvature falling to zero"
                  onClick={() => tv.getState().setSpiral({ direction: 'out' })}
                >
                  Exit
                </button>
              </div>
            )}

            <label className="flex items-center gap-1 flex-shrink-0 text-geo-muted">
              Ls
              <input
                ref={firstFieldRef}
                className={`${inputCls} w-20`}
                value={spiral.lengthText}
                disabled={!origin || busy}
                placeholder="150.00"
                title="Spiral length — how far it takes to get from the tangent to the radius."
                data-ourgeo-id="draw.traverse.spiral.length"
                onChange={(e) => tv.getState().setSpiral({ lengthText: e.target.value })}
                onKeyDown={onEnter}
              />
              <span className="text-geo-muted">{UNITS[unit].abbr}</span>
            </label>

            <label className="flex items-center gap-1 flex-shrink-0 text-geo-muted">
              R
              <input
                className={`${inputCls} w-20`}
                value={spiral.radiusText}
                disabled={!origin || busy}
                placeholder="1000.00"
                title="The radius the spiral reaches — the circular curve it transitions onto."
                data-ourgeo-id="draw.traverse.spiral.radius"
                onChange={(e) => tv.getState().setSpiral({ radiusText: e.target.value })}
                onKeyDown={onEnter}
              />
              <span className="text-geo-muted">{UNITS[unit].abbr}</span>
            </label>

            {courseType === 'scs' && (
              <>
                <label className="flex items-center gap-1 flex-shrink-0 text-geo-muted">
                  Δ
                  <input
                    className={`${inputCls} w-24`}
                    value={spiral.deltaText}
                    disabled={!origin || busy}
                    placeholder="45°30'"
                    title="Total deflection of the whole unit — both spirals and the curve between them."
                    data-ourgeo-id="draw.traverse.spiral.delta"
                    onChange={(e) => tv.getState().setSpiral({ deltaText: e.target.value })}
                    onKeyDown={onEnter}
                  />
                </label>
                <label className="flex items-center gap-1 flex-shrink-0 text-geo-muted">
                  Ls out
                  <input
                    className={`${inputCls} w-20`}
                    value={spiral.lengthOutText}
                    disabled={!origin || busy}
                    placeholder="same"
                    title="Leave blank for a symmetric unit, which is the norm."
                    data-ourgeo-id="draw.traverse.spiral.lengthOut"
                    onChange={(e) => tv.getState().setSpiral({ lengthOutText: e.target.value })}
                    onKeyDown={onEnter}
                  />
                </label>
              </>
            )}
          </>
        )}

        {isCurve && (
          <>
            {/* Two element slots, each saying WHAT it is. A plan quotes
                whichever two it likes, and converting by hand before typing is
                exactly what this tool exists to stop. */}
            <label className="flex items-center gap-1 flex-shrink-0 text-geo-muted">
              <select
                className={selectCls}
                value={curve.aId}
                data-ourgeo-id="draw.traverse.curve.aId"
                title={CURVE_ELEMENTS[curve.aId].hint}
                onChange={(e) => tv.getState().setCurve({ aId: e.target.value as CurveElementId })}
              >
                {elementIds.map((e) => (
                  <option key={e} value={e}>{CURVE_ELEMENTS[e].label}</option>
                ))}
              </select>
              <input
                ref={firstFieldRef}
                className={`${inputCls} w-24`}
                value={curve.aText}
                disabled={!origin || busy}
                placeholder={CURVE_ELEMENTS[curve.aId].quantity === 'angle' ? "45°30'" : '250.00'}
                data-ourgeo-id="draw.traverse.curve.a"
                onChange={(e) => tv.getState().setCurve({ aText: e.target.value })}
                onKeyDown={onEnter}
              />
              {CURVE_ELEMENTS[curve.aId].quantity === 'length' && (
                <span className="text-geo-muted">{UNITS[unit].abbr}</span>
              )}
            </label>

            <label className="flex items-center gap-1 flex-shrink-0 text-geo-muted">
              <select
                className={selectCls}
                value={curve.bId}
                data-ourgeo-id="draw.traverse.curve.bId"
                title={CURVE_ELEMENTS[curve.bId].hint}
                onChange={(e) => tv.getState().setCurve({ bId: e.target.value as CurveElementId })}
              >
                {elementIds.map((e) => (
                  <option key={e} value={e}>{CURVE_ELEMENTS[e].label}</option>
                ))}
              </select>
              <input
                className={`${inputCls} w-24`}
                value={curve.bText}
                disabled={!origin || busy}
                placeholder={CURVE_ELEMENTS[curve.bId].quantity === 'angle' ? "45°30'" : '250.00'}
                data-ourgeo-id="draw.traverse.curve.b"
                onChange={(e) => tv.getState().setCurve({ bText: e.target.value })}
                onKeyDown={onEnter}
              />
              {CURVE_ELEMENTS[curve.bId].quantity === 'length' && (
                <span className="text-geo-muted">{UNITS[unit].abbr}</span>
              )}
            </label>

            {/* Degree of curve means two different radii depending on the
                convention the plan was drawn to, and nothing in the number says
                which — so it is asked, and only where it applies. */}
            {(curve.aId === 'degreeOfCurve' || curve.bId === 'degreeOfCurve') && (
              <select
                className={selectCls}
                value={curve.degreeDefinition}
                data-ourgeo-id="draw.traverse.curve.degreeDef"
                title="Arc definition: the angle subtending a 100-unit ARC. Chord definition: a 100-unit CHORD. Highway plans usually mean arc, railroads chord."
                onChange={(e) => tv.getState().setCurve({
                  degreeDefinition: e.target.value as 'arc' | 'chord',
                })}
              >
                <option value="arc">arc def.</option>
                <option value="chord">chord def.</option>
              </select>
            )}

            {/* A non-tangent curve does not continue anything, so the page has
                to say which way it faces. */}
            {courseType === 'curve' && (
              <label className="flex items-center gap-1 flex-shrink-0 text-geo-muted">
                <select
                  className={selectCls}
                  value={curve.orientKind}
                  data-ourgeo-id="draw.traverse.curve.orientKind"
                  onChange={(e) => tv.getState().setCurve({
                    orientKind: e.target.value as 'chord' | 'radial',
                  })}
                >
                  <option value="chord">Chord bearing</option>
                  <option value="radial">Radial in</option>
                </select>
                <input
                  className={`${inputCls} w-28`}
                  value={curve.orientText}
                  disabled={!origin || busy}
                  placeholder={mode === 'quadrant' ? "S22°45'W" : "202°45'"}
                  title={
                    curve.orientKind === 'chord'
                      ? 'Bearing of the long chord, start of the curve to its end — what a plat quotes.'
                      : 'Bearing from the start of the curve to its centre.'
                  }
                  data-ourgeo-id="draw.traverse.curve.orient"
                  onChange={(e) => tv.getState().setCurve({ orientText: e.target.value })}
                  onKeyDown={onEnter}
                />
              </label>
            )}
          </>
        )}

        <RibbonButton
          accent
          title={
            busy
              ? 'Asking R for the grid position…'
              : pendingRowAdd
                ? 'Add a row and place this course in it (Enter)'
                : isPoint
                  ? 'Place this point and move to the next row (Enter)'
                  : 'Place this course (Enter)'
          }
          disabled={!origin || busy}
          onClick={submit}
        >
          {isCurve ? <Spline className="w-3 h-3" /> : <Check className="w-3 h-3" />}
          {pendingRowAdd ? 'Add row + course' : 'Add course'}
          <kbd className="ml-1 text-[9px] text-geo-muted">⏎</kbd>
        </RibbonButton>
        <RibbonButton
          title={isPoint ? 'Take back the last point and step back a row' : 'Remove the last course'}
          disabled={!canUndo || busy}
          onClick={undoCourse}
        >
          <Undo2 className="w-3 h-3" />
          Undo
        </RibbonButton>
        {isPoint ? (
          <RibbonButton
            title="Measure from somewhere else — click the map, or type a coordinate"
            disabled={!origin || busy}
            data-ourgeo-id="draw.traverse.reference"
            onClick={() => { echoTraverse(); setGhost(null); startRef.current?.focus() }}
          >
            <Crosshair className="w-3 h-3" />
            New reference
          </RibbonButton>
        ) : (
          <RibbonButton
            title="Return to the first vertex and finish"
            disabled={path.length < 3}
            onClick={() => void closeRing()}
          >
            <Flag className="w-3 h-3" />
            Close
          </RibbonButton>
        )}
        {!isPoint && (
          <RibbonButton
            title="Finish this feature (Enter on an empty form)"
            disabled={!canFinish}
            onClick={() => { echoTraverse(); void finish() }}
          >
            <MapPin className="w-3 h-3" />
            Finish
          </RibbonButton>
        )}

        <div className="flex-1 min-w-0" />

        {/* How the traverse is going: what it has cost so far, and — once it
            could be a ring — how far it is from closing. */}
        {courses.length > 0
          ? <CourseList courses={courses} unit={unit} />
          : <span className="flex-shrink-0 text-geo-muted">no courses yet</span>}
        {shut && (
          <span className="flex-shrink-0 text-geo-muted">
            {formatDistance(shut.perimeterM, unit)} · closure{' '}
            <span className="font-mono">{formatDistance(shut.distanceM, unit)}</span>
            {' ('}{formatRatio(shut.ratio)}{')'}
          </span>
        )}
      </div>

      {/* Row 3, for a free curve — what it cost to get there, which is not the
          distance that was typed: that is the straight line to the end point
          and this is the way round. */}
      {isBezier && pendingBezier?.run && !complaint && (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-[11px] text-geo-muted">
          <span>
            <span className="text-geo-muted/70">along</span>{' '}
            <span className="text-foreground">{formatDistance(pendingBezier.lengthM, unit)}</span>
          </span>
          <span>
            <span className="text-geo-muted/70">chord</span>{' '}
            <span className="text-foreground">{formatDistance(pendingBezier.run.chordM, unit)}</span>
          </span>
          <span className="text-geo-muted/70">
            · leaves {formatDms(incoming ?? 0)}, arrives {formatDms(pendingBezier.run.outAzimuthDeg)}
          </span>
        </div>
      )}

      {/* Row 3, for a transition course — the figures a plan-and-profile sheet
          prints beside the alignment, so the entry can be checked against it.
          θs is the angle the spiral absorbs; p is how far it throws the curve
          off the tangent; Ts is the tangent distance from the TS to the
          intersection, which is what a field crew stakes from. */}
      {isSpiral && pendingSpiral?.elements && !complaint && (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-[11px] text-geo-muted">
          {([
            ['θs', formatDms(pendingSpiral.elements.thetaInDeg)],
            ['A', formatDistance(pendingSpiral.elements.parameterInM, unit)],
            ['p', formatDistance(pendingSpiral.elements.shiftM, unit)],
            ['k', formatDistance(pendingSpiral.elements.kM, unit)],
            ...(pendingSpiral.elements.curveDeltaDeg !== null
              ? [
                ['Δc', formatDms(pendingSpiral.elements.curveDeltaDeg)] as const,
                ['Lc', formatDistance(
                  pendingSpiral.elements.radiusM * pendingSpiral.elements.curveDeltaDeg * (Math.PI / 180),
                  unit
                )] as const,
              ]
              : []),
            ...(pendingSpiral.elements.tangentM !== null
              ? [['Ts', formatDistance(pendingSpiral.elements.tangentM, unit)] as const]
              : []),
            ['total', formatDistance(pendingSpiral.elements.totalLengthM, unit)],
          ] as const).map(([sym, value]) => (
            <span key={sym}>
              <span className="text-geo-muted/70">{sym}</span> <span className="text-foreground">{value}</span>
            </span>
          ))}
          <span className="text-geo-muted/70">
            · leaves {formatDms(pendingSpiral.tangentAz ?? 0)}, arrives{' '}
            {formatDms(pendingSpiral.run?.outAzimuthDeg ?? 0)}
          </span>
        </div>
      )}

      {/* Row 3 — every element of the curve, not just the two that were typed.
          Checking a curve against a plat means checking L, C, T, E and M, and
          those are the numbers a deed quotes to be checked against. It appears
          only while a curve is being typed, so a straight traverse looks
          exactly as it always did. */}
      {isCurve && pendingCurve?.elements && !complaint && (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-[11px] text-geo-muted">
          {([
            ['R', formatDistance(pendingCurve.elements.radiusM, unit)],
            ['Δ', formatDms(pendingCurve.elements.deltaDeg)],
            ['L', formatDistance(pendingCurve.elements.arcLengthM, unit)],
            ['C', formatDistance(pendingCurve.elements.chordM, unit)],
            ['T', pendingCurve.elements.tangentM === null
              ? '—' : formatDistance(pendingCurve.elements.tangentM, unit)],
            ['E', pendingCurve.elements.externalM === null
              ? '—' : formatDistance(pendingCurve.elements.externalM, unit)],
            ['M', formatDistance(pendingCurve.elements.midOrdinateM, unit)],
          ] as const).map(([sym, value]) => (
            <span key={sym}>
              <span className="text-geo-muted/70">{sym}</span> <span className="text-foreground">{value}</span>
            </span>
          ))}
          {pendingCurve.geometry && (
            <span>
              <span className="text-geo-muted/70">chord brg</span>{' '}
              <span className="text-foreground">
                {formatBearing(pendingCurve.geometry.chordAzimuthDeg, mode === 'quadrant' ? 'quadrant' : 'azimuth')}
              </span>
            </span>
          )}
          {(unit === 'ft' || unit === 'usft') && (
            <span title="Degree of curve, arc definition, on 100-unit stations">
              <span className="text-geo-muted/70">D</span>{' '}
              <span className="text-foreground">{formatDms(pendingCurve.elements.degreeOfCurveArc)}</span>
            </span>
          )}
          <span className="text-geo-muted/70">
            · leaves {formatDms(pendingCurve.tangentAz ?? 0)}, arrives{' '}
            {formatDms(norm360((pendingCurve.tangentAz ?? 0)
              + (curve.turn === 'right' ? 1 : -1) * pendingCurve.elements.deltaDeg))}
          </span>
        </div>
      )}
    </div>
  )
}
