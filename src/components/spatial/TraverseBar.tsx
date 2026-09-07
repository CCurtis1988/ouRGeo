import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { Compass, Check, Undo2, Flag, MapPin } from 'lucide-react'
import { RibbonButton } from '../ui/ribbon'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import { useTraverseStore } from '@/store/traverse'
import { useDrawPreviewStore } from '@/store/drawPreview'
import { useDrawActions } from '@/hooks/useDrawActions'
import {
  traversePath, traverseOrigin, traverseIncoming, previewLeg, echoTraverse,
} from '@/lib/draw/tools/distance-bearing'
import {
  parseDistance, parseBearing, parseCoordinate, formatDistance, formatRatio,
  closure, formatDms, UNITS, UNIT_IDS, BEARING_MODES, BEARING_MODE_IDS,
} from '@/lib/draw/cogo'
import { canComplete } from '@/lib/draw/draft'
import { rClient } from '@/lib/r-client'
import type { DistanceUnit } from '@/lib/draw/cogo'
import type { CrsInfo, TraverseBasis } from '@/store/traverse'
import type { Position } from '@/lib/draw/types'

/**
 * Where a traverse is typed.
 *
 * A docked strip under the map rather than a card floating over it: it never
 * covers the geometry it is building, and it never has to be moved out of the
 * way. It appears only while the Distance & Bearing tool is active, so the map
 * loses those 60 pixels only to someone who asked for them.
 *
 * **The keyboard is the point.** Distance takes focus the moment there is a
 * start point; Enter places the leg and hands focus back to Distance, so a
 * traverse is `150 ⇥ N45-30-E ⏎ 82 ⇥ S12E ⏎` with no pointer at all. The
 * drawing hotkeys already ignore keystrokes aimed at an input
 * (`useDrawHotkeys.ts`), so D does not swap the tool out from under a distance
 * of "d150" being typed.
 */

const inputCls =
  'bg-geo-bg border border-geo-border rounded px-1.5 py-1 text-xs text-foreground ' +
  'outline-none focus:border-geo-accent placeholder:text-geo-muted/60'

const selectCls =
  'bg-geo-bg border border-geo-border rounded px-1 py-1 text-xs text-foreground ' +
  'outline-none focus:border-geo-accent'

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

export function TraverseBar(): React.ReactElement | null {
  const session = useGeometryEditStore(selectActiveSession)
  const activeToolId = useGeometryEditStore((s) => s.activeToolId)
  const addVertex = useGeometryEditStore((s) => s.addVertex)
  const undoVertex = useGeometryEditStore((s) => s.undoVertex)

  const storePath = useTraverseStore((s) => s.path)
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
  const { finish, commitPoint } = useDrawActions()

  const distanceRef = useRef<HTMLInputElement>(null)
  const startRef = useRef<HTMLInputElement>(null)

  const active = activeToolId === 'distance-bearing' && !!session
  const isPoint = session?.geometryType === 'POINT'
  const path = useMemo(
    () => (session ? traversePath(session, storePath) : []),
    [session, storePath]
  )
  const origin = session ? traverseOrigin(session, storePath) : null
  const incoming = session ? traverseIncoming(session, storePath) : null
  const here = !!origin && !!frameAt && frameAt[0] === origin[0] && frameAt[1] === origin[1]
  const usableFrame = here ? frame : null

  /** Put a vertex where the geometry keeps them: the draft, or a row of its
   *  own when every leg of this traverse is a point. */
  const place = useCallback((p: Position) => {
    if (isPoint) {
      tv.getState().pushVertex(p)
      void commitPoint(p[0], p[1])
    } else {
      addVertex(p[0], p[1])
    }
  }, [isPoint, addVertex, commitPoint, tv])

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
        const u = unitForCrs(info)
        if (u) tv.getState().setUnit(u)
      } else {
        tv.getState().setBasis('geodesic')
      }
    })()
    return () => { cancelled = true }
  }, [active, session?.accessPath, session?.envName, tv]) // eslint-disable-line react-hooks/exhaustive-deps

  // The grid frame at the vertex we are measuring FROM, so that even the first
  // leg previews where it will actually be committed. Without it the first leg
  // of a grid traverse is drawn geodesically and then jumps by the convergence
  // when R answers — about a metre in a UTM zone, which is exactly the error
  // this basis exists to avoid.
  useEffect(() => {
    if (!active || !session || basis !== 'grid' || !origin || here) return
    let cancelled = false
    void (async () => {
      const res = await rClient.spatialTraverse({
        origin, legs: [], basis: 'grid',
        name: session.accessPath, envName: session.envName,
      })
      if (!cancelled && res.success && res.frame) tv.getState().setFrame(res.frame, origin)
    })()
    return () => { cancelled = true }
  }, [active, session, basis, origin, here, tv])

  // What the fields currently describe, recomputed on every keystroke: the
  // destination for the readout, or the refusal to show under the fields.
  const pending = useMemo(() => {
    if (!origin) return null
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
  }, [origin, entry.distance, entry.bearing, unit, mode, incoming, basis, usableFrame])

  // The ghost is the leg being typed. Cleared when the tool goes away, or the
  // dashed line would outlive the strip that explains it.
  useEffect(() => {
    if (!active || !origin || !pending?.position) {
      setGhost(null)
      return
    }
    setGhost({
      type: 'LineString',
      coordinates: [[origin[0], origin[1]], [pending.position[0], pending.position[1]]],
    })
  }, [active, origin, pending, setGhost])

  useEffect(() => () => setGhost(null), [setGhost])

  // Focus follows the state of the traverse: the coordinate box while there is
  // no start point, the distance the moment there is one.
  useEffect(() => {
    if (!active) return
    if (origin) distanceRef.current?.focus()
    else startRef.current?.focus()
  }, [active, !!origin]) // eslint-disable-line react-hooks/exhaustive-deps

  const placeStart = useCallback((text: string) => {
    const parsed = parseCoordinate(text)
    if (!parsed.ok) {
      tv.getState().setError(parsed.error)
      return
    }
    place(parsed.value)
    tv.getState().setEntry({ distance: '', bearing: '' })
  }, [place, tv])

  const submit = useCallback(() => {
    if (!session || !origin) return
    const d = parseDistance(entry.distance, unit)
    if (!d.ok) { tv.getState().setError(d.error); return }
    const b = parseBearing(entry.bearing, mode, incoming)
    if (!b.ok) { tv.getState().setError(b.error); return }

    const leg = {
      distanceText: entry.distance.trim(),
      bearingText: entry.bearing.trim(),
      unit, mode, distanceM: d.value, azimuth: b.value,
    }

    if (basis === 'geodesic') {
      place(previewLeg(origin, d.value, b.value, 'geodesic', null))
      tv.getState().addLeg(leg)
      setGhost(null)
      distanceRef.current?.focus()
      return
    }

    // Grid: the vertex that is KEPT is R's projected arithmetic, never the
    // local reduction the ghost was drawn with. The reply also carries the
    // frame at the new vertex, which is what previews the next leg.
    tv.getState().setBusy(true)
    void (async () => {
      try {
        const res = await rClient.spatialTraverse({
          origin, basis: 'grid',
          legs: [{ distance: d.value, azimuth: b.value }],
          name: session.accessPath, envName: session.envName,
        })
        if (!res.success || !res.vertices || res.vertices.length < 2) {
          tv.getState().setError(res.error ?? 'R could not place that leg on the layer’s grid.')
          return
        }
        const landed = res.vertices[res.vertices.length - 1]
        place(landed)
        // The reply's frame belongs to the vertex it just produced, which is
        // where the next leg starts.
        tv.getState().setFrame(res.frame ?? null, landed)
        tv.getState().addLeg(leg)
        setGhost(null)
        distanceRef.current?.focus()
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
  }, [session, origin, entry, unit, mode, incoming, basis, place, setGhost, tv])

  const undoLeg = useCallback(() => {
    if (!session) return
    if (isPoint) tv.getState().popVertex()
    else undoVertex()
    tv.getState().dropLastLeg()
  }, [session, isPoint, undoVertex, tv])

  const closeRing = useCallback(() => {
    if (!session || path.length < 3) return
    place(path[0])
    setGhost(null)
    echoTraverse()
    if (!isPoint) void finish()
  }, [session, path, isPoint, place, setGhost, finish])

  const shut = useMemo(() => closure(path), [path])

  if (!active || !session) return null

  const legCount = path.length > 0 ? path.length - 1 : 0
  const canFinish = !isPoint && canComplete(session)

  return (
    <div
      data-ourgeo-id="draw.traverse"
      data-export-hide
      className="flex-shrink-0 border-t border-geo-border bg-geo-panel px-3 py-1.5 text-xs"
    >
      {/* Row 1 — where you are measuring from, and where this leg lands. The
          tool's own name is on the ribbon button an inch below; repeating it
          here cost the width the readout needs on a narrow panel. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
        <Compass className="w-3 h-3 flex-shrink-0 text-geo-accent" />
        {origin ? (
          <span className="flex-shrink-0 text-geo-muted">
            From <span className="font-mono text-foreground">{fmtCoord(origin)}</span>
            {legCount > 0 && <span className="ml-1">· vertex {path.length}</span>}
          </span>
        ) : (
          <span className="flex-shrink-0 text-geo-muted">
            Click the map to place the start point — or type one:
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
        {/* The readout, in priority order: what is wrong, else where this leg
            lands. A readout that showed both would be one nobody reads. */}
        <span className="flex-shrink-0 font-mono">
          {error || pending?.complaint ? (
            <span className="font-sans text-geo-error">{error ?? pending?.complaint}</span>
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
                : 'Distances and bearings on the layer’s own projected grid, which is what a survey plat in a projected CRS is drawn to.'
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
          hidden tool can be reached another way, but a hidden "Add leg" is a
          form with no submit. On a narrow map pane the buttons drop to a line
          of their own instead of off the edge. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 min-w-0">
        <label className="flex items-center gap-1 flex-shrink-0 text-geo-muted">
          Distance
          <input
            ref={distanceRef}
            className={`${inputCls} w-24`}
            value={entry.distance}
            disabled={!origin || busy}
            placeholder="150.00"
            data-ourgeo-id="draw.traverse.distance"
            onChange={(e) => tv.getState().setEntry({ distance: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
          />
          <select
            className={selectCls}
            value={unit}
            data-ourgeo-id="draw.traverse.unit"
            onChange={(e) => tv.getState().setUnit(e.target.value as typeof unit)}
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
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
          />
          <select
            className={selectCls}
            value={mode}
            data-ourgeo-id="draw.traverse.mode"
            onChange={(e) => tv.getState().setMode(e.target.value as typeof mode)}
          >
            {BEARING_MODE_IDS.map((id) => (
              <option key={id} value={id}>{BEARING_MODES[id].label}</option>
            ))}
          </select>
        </label>

        <RibbonButton
          accent
          title={busy ? 'Asking R for the grid position…' : 'Place this leg (Enter)'}
          disabled={!origin || busy}
          onClick={submit}
        >
          <Check className="w-3 h-3" />
          Add leg
          <kbd className="ml-1 text-[9px] text-geo-muted">⏎</kbd>
        </RibbonButton>
        <RibbonButton title="Remove the last leg" disabled={path.length === 0} onClick={undoLeg}>
          <Undo2 className="w-3 h-3" />
          Undo leg
        </RibbonButton>
        <RibbonButton
          title="Return to the first vertex and finish"
          disabled={path.length < 3}
          onClick={closeRing}
        >
          <Flag className="w-3 h-3" />
          Close
        </RibbonButton>
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
        <span className="flex-shrink-0 text-geo-muted">
          {legCount} leg{legCount === 1 ? '' : 's'}
          {shut && (
            <>
              {' · '}{formatDistance(shut.perimeterM, unit)}
              {' · closure '}
              <span className="font-mono">{formatDistance(shut.distanceM, unit)}</span>
              {' ('}{formatRatio(shut.ratio)}{')'}
            </>
          )}
        </span>
      </div>
    </div>
  )
}
