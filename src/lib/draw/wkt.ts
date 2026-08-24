import type { GeometryType } from '@/store/geometryEdit'
import type { DraftGeometry, DraftPart, DraftPath, Position, SegmentKind } from './types'
import type { GeometryFamily } from '@/lib/geometry-family'
import { emptyPart, isPathExplicitlyClosed } from './draft'

/**
 * WKT bridge between the draft model and sf's OGC curve types (handled in R
 * by the sfarc package). Arc segments drawn with the Arc tool are PRESERVED
 * as CIRCULARSTRING / COMPOUNDCURVE / CURVEPOLYGON / MULTICURVE /
 * MULTISURFACE instead of being densified — densification remains only for
 * map display (GeoJSON has no curve types).
 *
 * Emission (draftToWkt) mirrors draftToGeoJSON's strict commit gating.
 * Parsing (parseWktToDraft) accepts sf::st_as_text output — whitespace after
 * type keywords and LINESTRING-labeled COMPOUNDCURVE components included —
 * and restores symbolic arc segments for lossless re-editing.
 */

const EPS = 1e-12

function samePos(a: Position, b: Position): boolean {
  return Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS
}

export function pathHasArcs(path: DraftPath): boolean {
  return path.segments.some((s) => s !== 'line')
}

function partHasArcs(part: DraftPart): boolean {
  return pathHasArcs(part.exterior) || part.holes.some(pathHasArcs)
}

export function draftHasArcs(draft: DraftGeometry): boolean {
  return draft.parts.some(partHasArcs)
}

/** True when a WKT string uses any OGC curve type. */
export function isCurvedWkt(wkt: string): boolean {
  return /\b(CIRCULARSTRING|COMPOUNDCURVE|CURVEPOLYGON|MULTICURVE|MULTISURFACE)\b/i.test(wkt)
}

// ── Emission ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toString() : '0'
}

interface Run {
  kind: 'line' | 'arc'
  /** Line runs: vertices. Arc runs: v, via, v, via, v … (odd length). */
  pts: Position[]
}

/**
 * Group a path's segments into maximal same-kind runs, sharing junction
 * vertices. `ring` appends a straight closing edge back to the first vertex
 * unless the path is already explicitly closed.
 */
function pathRuns(path: DraftPath, ring: boolean): Run[] {
  const verts = path.vertices
  if (verts.length === 0) return []
  const runs: Run[] = []

  const push = (kind: 'line' | 'arc', from: Position) => {
    const last = runs[runs.length - 1]
    if (last && last.kind === kind) return last
    const run: Run = { kind, pts: [from] }
    runs.push(run)
    return run
  }

  for (let i = 1; i < verts.length; i++) {
    const seg: SegmentKind = path.segments[i - 1] ?? 'line'
    if (seg === 'line') {
      push('line', verts[i - 1]).pts.push(verts[i])
    } else {
      const run = push('arc', verts[i - 1])
      run.pts.push(seg.via, verts[i])
    }
  }

  if (ring && verts.length >= 3 && !isPathExplicitlyClosed(path)) {
    push('line', verts[verts.length - 1]).pts.push(verts[0])
  }
  return runs
}

const list = (pts: Position[]) => pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(', ')

/**
 * WKT body for a path: bare list when all-straight, CIRCULARSTRING when one
 * arc run, COMPOUNDCURVE when mixed.
 */
function runsBody(runs: Run[]): { body: string; curved: boolean } {
  if (runs.length === 1 && runs[0].kind === 'line') {
    return { body: `(${list(runs[0].pts)})`, curved: false }
  }
  if (runs.length === 1) {
    return { body: `CIRCULARSTRING(${list(runs[0].pts)})`, curved: true }
  }
  const parts = runs.map((r) =>
    r.kind === 'arc' ? `CIRCULARSTRING(${list(r.pts)})` : `(${list(r.pts)})`
  )
  return { body: `COMPOUNDCURVE(${parts.join(', ')})`, curved: true }
}

function lineBody(path: DraftPath): { body: string; curved: boolean } {
  return runsBody(pathRuns(path, false))
}

function ringBody(path: DraftPath): { body: string; curved: boolean } {
  return runsBody(pathRuns(path, true))
}

const validRing = (p: DraftPath) => p.vertices.length >= 3

/**
 * Emit the draft as WKT (WGS84 coordinates), preserving arc segments as OGC
 * curve types. Returns null when the draft doesn't form a valid geometry of
 * the session type (same gating as strict draftToGeoJSON).
 */
export function draftToWkt(draft: DraftGeometry, geometryType: GeometryType): string | null {
  switch (geometryType) {
    case 'POINT': {
      const v = draft.parts[0]?.exterior.vertices[0]
      return v ? `POINT(${fmt(v[0])} ${fmt(v[1])})` : null
    }
    case 'MULTIPOINT': {
      const verts = draft.parts.flatMap((p) => p.exterior.vertices)
      if (verts.length === 0) return null
      return `MULTIPOINT(${verts.map(([x, y]) => `(${fmt(x)} ${fmt(y)})`).join(', ')})`
    }
    case 'LINESTRING': {
      const path = draft.parts[0]?.exterior
      if (!path || path.vertices.length < 2) return null
      const { body, curved } = lineBody(path)
      return curved ? body : `LINESTRING${body}`
    }
    case 'MULTILINESTRING': {
      const lines = draft.parts.map((p) => p.exterior).filter((p) => p.vertices.length >= 2)
      if (lines.length === 0) return null
      if (draft.parts.some((p) => p.exterior.vertices.length === 1)) return null
      const bodies = lines.map(lineBody)
      if (bodies.some((b) => b.curved)) {
        // MULTICURVE members: bare lists (straight) or curve components
        return `MULTICURVE(${bodies.map((b) => b.body).join(', ')})`
      }
      return `MULTILINESTRING(${bodies.map((b) => b.body).join(', ')})`
    }
    case 'POLYGON': {
      const part = draft.parts[0]
      if (!part || !validRing(part.exterior)) return null
      if (part.holes.some((h) => h.vertices.length > 0 && !validRing(h))) return null
      const rings = [part.exterior, ...part.holes.filter(validRing)].map(ringBody)
      if (rings.some((r) => r.curved)) {
        return `CURVEPOLYGON(${rings.map((r) => r.body).join(', ')})`
      }
      return `POLYGON(${rings.map((r) => r.body).join(', ')})`
    }
    case 'MULTIPOLYGON': {
      const parts = draft.parts.filter((p) => validRing(p.exterior))
      if (parts.length === 0) return null
      const bad = draft.parts.some(
        (p) =>
          (p.exterior.vertices.length > 0 && !validRing(p.exterior)) ||
          p.holes.some((h) => h.vertices.length > 0 && !validRing(h))
      )
      if (bad) return null
      const polys = parts.map((p) => {
        const rings = [p.exterior, ...p.holes.filter(validRing)].map(ringBody)
        return {
          curved: rings.some((r) => r.curved),
          bare: `(${rings.map((r) => r.body).join(', ')})`,
          curve: `CURVEPOLYGON(${rings.map((r) => r.body).join(', ')})`
        }
      })
      if (polys.some((p) => p.curved)) {
        // MULTISURFACE members: CURVEPOLYGON for curved parts, bare ((...)) otherwise
        return `MULTISURFACE(${polys.map((p) => (p.curved ? p.curve : p.bare)).join(', ')})`
      }
      return `MULTIPOLYGON(${polys.map((p) => p.bare).join(', ')})`
    }
  }
}

// ── Parsing ──────────────────────────────────────────────────────────────────

class Scanner {
  i = 0
  constructor(readonly s: string) {}

  ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++
  }

  /** Read an identifier (type keyword) if present. */
  keyword(): string | null {
    this.ws()
    const m = /^[A-Za-z]+/.exec(this.s.slice(this.i))
    if (!m) return null
    this.i += m[0].length
    return m[0].toUpperCase()
  }

  peek(): string {
    this.ws()
    return this.s[this.i] ?? ''
  }

  take(ch: string): boolean {
    this.ws()
    if (this.s[this.i] === ch) {
      this.i++
      return true
    }
    return false
  }

  number(): number | null {
    this.ws()
    const m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(this.s.slice(this.i))
    if (!m) return null
    this.i += m[0].length
    return parseFloat(m[0])
  }

  atEnd(): boolean {
    this.ws()
    return this.i >= this.s.length
  }
}

/** `(x y, x y, ...)` → positions. Null on malformed input. */
function parsePointList(sc: Scanner): Position[] | null {
  if (!sc.take('(')) return null
  const pts: Position[] = []
  for (;;) {
    const x = sc.number()
    if (x === null) return null
    const y = sc.number()
    if (y === null) return null
    pts.push([x, y])
    if (sc.take(',')) continue
    if (sc.take(')')) return pts
    return null // Z/M coordinate or junk
  }
}

function pathFromLine(pts: Position[]): DraftPath {
  return {
    vertices: pts,
    segments: pts.length > 1 ? Array.from({ length: pts.length - 1 }, () => 'line' as const) : []
  }
}

/** CIRCULARSTRING point list (odd count ≥ 3) → path with arc segments. */
function pathFromCircular(pts: Position[]): DraftPath | null {
  if (pts.length < 3 || pts.length % 2 === 0) return null
  const vertices: Position[] = []
  const segments: SegmentKind[] = []
  vertices.push(pts[0])
  for (let i = 1; i < pts.length; i += 2) {
    const start = pts[i - 1]
    const via = pts[i]
    const end = pts[i + 1]
    if (samePos(start, end)) {
      // Full circle: start == end with via at the diametral antipode
      // (OGC/PostGIS convention — sfarc's disc examples use it). The draft
      // model needs distinct arc endpoints, so split into two half-circles.
      const cx = (start[0] + via[0]) / 2
      const cy = (start[1] + via[1]) / 2
      const r = Math.hypot(via[0] - start[0], via[1] - start[1]) / 2
      if (r <= EPS) return null // zero-radius circle
      const ux = (via[0] - start[0]) / (2 * r)
      const uy = (via[1] - start[1]) / (2 * r)
      // perpendicular (CCW) of the diameter direction
      const via1: Position = [cx - uy * r, cy + ux * r]
      const via2: Position = [cx + uy * r, cy - ux * r]
      segments.push({ kind: 'arc', via: via1 })
      vertices.push(via)
      segments.push({ kind: 'arc', via: via2 })
      vertices.push(end)
    } else {
      segments.push({ kind: 'arc', via })
      vertices.push(end)
    }
  }
  return { vertices, segments }
}

/** Concatenate COMPOUNDCURVE component paths (shared junction vertices). */
function joinPaths(paths: DraftPath[]): DraftPath | null {
  if (paths.length === 0) return null
  const out: DraftPath = { vertices: [...paths[0].vertices], segments: [...paths[0].segments] }
  for (let i = 1; i < paths.length; i++) {
    const p = paths[i]
    if (p.vertices.length < 2) return null
    const junction = out.vertices[out.vertices.length - 1]
    if (!samePos(junction, p.vertices[0])) return null // components must chain
    out.vertices.push(...p.vertices.slice(1))
    out.segments.push(...p.segments)
  }
  return out
}

/**
 * One curve component: bare `(x y, ...)`, `LINESTRING(...)` (sf's output
 * labels straight components), or `CIRCULARSTRING(...)`. `allowCompound`
 * additionally accepts nested `COMPOUNDCURVE(...)` (ring positions).
 */
function parseCurveComponent(sc: Scanner, allowCompound: boolean): DraftPath | null {
  if (sc.peek() === '(') {
    const pts = parsePointList(sc)
    return pts && pts.length >= 2 ? pathFromLine(pts) : null
  }
  const kw = sc.keyword()
  if (kw === 'LINESTRING') {
    const pts = parsePointList(sc)
    return pts && pts.length >= 2 ? pathFromLine(pts) : null
  }
  if (kw === 'CIRCULARSTRING') {
    const pts = parsePointList(sc)
    return pts ? pathFromCircular(pts) : null
  }
  if (kw === 'COMPOUNDCURVE' && allowCompound) {
    return parseCompound(sc)
  }
  return null
}

function parseCompound(sc: Scanner): DraftPath | null {
  if (!sc.take('(')) return null
  const parts: DraftPath[] = []
  for (;;) {
    const p = parseCurveComponent(sc, false)
    if (!p) return null
    parts.push(p)
    if (sc.take(',')) continue
    if (sc.take(')')) break
    return null
  }
  return joinPaths(parts)
}

/**
 * Normalize a parsed ring path: WKT rings are explicitly closed. When the
 * closing segment is straight, drop the duplicate vertex (the drawn model's
 * implicit closure); when it is an arc, keep the explicit closure so the
 * curve survives round-trips.
 */
function normalizeRing(path: DraftPath): DraftPath | null {
  const n = path.vertices.length
  if (n < 3) return null
  if (!samePos(path.vertices[0], path.vertices[n - 1])) return null // rings must close
  const closing = path.segments[path.segments.length - 1]
  if (closing === 'line') {
    return { vertices: path.vertices.slice(0, -1), segments: path.segments.slice(0, -1) }
  }
  return path
}

/** Ring inside POLYGON/CURVEPOLYGON: bare list or curve component. */
function parseRing(sc: Scanner, curvePolygon: boolean): DraftPath | null {
  const raw = curvePolygon ? parseCurveComponent(sc, true) : (() => {
    const pts = parsePointList(sc)
    return pts ? pathFromLine(pts) : null
  })()
  return raw ? normalizeRing(raw) : null
}

function parsePolygonBody(sc: Scanner, curvePolygon: boolean): DraftPart | null {
  if (!sc.take('(')) return null
  const rings: DraftPath[] = []
  for (;;) {
    const r = parseRing(sc, curvePolygon)
    if (!r) return null
    rings.push(r)
    if (sc.take(',')) continue
    if (sc.take(')')) break
    return null
  }
  if (rings.length === 0) return null
  return { exterior: rings[0], holes: rings.slice(1) }
}

export interface ParsedWkt {
  draft: DraftGeometry
  family: GeometryFamily
}

/**
 * Parse WKT (straight + curve forms) back into a draft with symbolic arcs.
 * Returns null for anything unsupported (Z/M, EMPTY, GEOMETRYCOLLECTION,
 * malformed input) — callers fall back to the linearized GeoJSON.
 */
export function parseWktToDraft(wkt: string): ParsedWkt | null {
  const sc = new Scanner(wkt)
  const kw = sc.keyword()
  if (!kw) return null
  if (/^(POINT|MULTIPOINT|LINESTRING|MULTILINESTRING|POLYGON|MULTIPOLYGON|CIRCULARSTRING|COMPOUNDCURVE|CURVEPOLYGON|MULTICURVE|MULTISURFACE)$/.test(kw) === false) {
    return null
  }
  // Z/M dimension markers and EMPTY are unsupported
  const rest = wkt.slice(sc.i).trimStart()
  if (/^(Z|M|ZM)\b/i.test(rest) || /^EMPTY\b/i.test(rest)) return null

  const done = (draft: DraftGeometry, family: GeometryFamily): ParsedWkt | null =>
    sc.atEnd() ? { draft, family } : null

  switch (kw) {
    case 'POINT': {
      if (!sc.take('(')) return null
      const x = sc.number()
      const y = sc.number()
      if (x === null || y === null || !sc.take(')')) return null
      return done({ parts: [{ exterior: pathFromLine([[x, y]]), holes: [] }] }, 'POINT')
    }
    case 'MULTIPOINT': {
      if (!sc.take('(')) return null
      const pts: Position[] = []
      for (;;) {
        // Both WKT forms: (x y) or bare x y
        let x: number | null, y: number | null
        if (sc.peek() === '(') {
          sc.take('(')
          x = sc.number(); y = sc.number()
          if (!sc.take(')')) return null
        } else {
          x = sc.number(); y = sc.number()
        }
        if (x === null || y === null) return null
        pts.push([x, y])
        if (sc.take(',')) continue
        if (sc.take(')')) break
        return null
      }
      return done({ parts: [{ exterior: pathFromLine(pts), holes: [] }] }, 'MULTIPOINT')
    }
    case 'LINESTRING': {
      const pts = parsePointList(sc)
      if (!pts || pts.length < 2) return null
      return done({ parts: [{ exterior: pathFromLine(pts), holes: [] }] }, 'LINESTRING')
    }
    case 'CIRCULARSTRING': {
      const pts = parsePointList(sc)
      const path = pts ? pathFromCircular(pts) : null
      if (!path) return null
      return done({ parts: [{ exterior: path, holes: [] }] }, 'LINESTRING')
    }
    case 'COMPOUNDCURVE': {
      const path = parseCompound(sc)
      if (!path) return null
      return done({ parts: [{ exterior: path, holes: [] }] }, 'LINESTRING')
    }
    case 'MULTILINESTRING':
    case 'MULTICURVE': {
      if (!sc.take('(')) return null
      const parts: DraftPart[] = []
      for (;;) {
        const p =
          kw === 'MULTICURVE'
            ? parseCurveComponent(sc, true)
            : (() => {
                const pts = parsePointList(sc)
                return pts && pts.length >= 2 ? pathFromLine(pts) : null
              })()
        if (!p || p.vertices.length < 2) return null
        parts.push({ exterior: p, holes: [] })
        if (sc.take(',')) continue
        if (sc.take(')')) break
        return null
      }
      return done({ parts: parts.length ? parts : [emptyPart()] }, 'MULTILINESTRING')
    }
    case 'POLYGON':
    case 'CURVEPOLYGON': {
      const part = parsePolygonBody(sc, kw === 'CURVEPOLYGON')
      if (!part) return null
      return done({ parts: [part] }, 'POLYGON')
    }
    case 'MULTIPOLYGON':
    case 'MULTISURFACE': {
      if (!sc.take('(')) return null
      const parts: DraftPart[] = []
      for (;;) {
        let part: DraftPart | null
        if (sc.peek() === '(') {
          part = parsePolygonBody(sc, kw === 'MULTISURFACE')
        } else {
          const inner = sc.keyword()
          if (inner === 'CURVEPOLYGON' && kw === 'MULTISURFACE') {
            part = parsePolygonBody(sc, true)
          } else if (inner === 'POLYGON') {
            part = parsePolygonBody(sc, kw === 'MULTISURFACE')
          } else {
            return null
          }
        }
        if (!part) return null
        parts.push(part)
        if (sc.take(',')) continue
        if (sc.take(')')) break
        return null
      }
      return done({ parts: parts.length ? parts : [emptyPart()] }, 'MULTIPOLYGON')
    }
    default:
      return null
  }
}
