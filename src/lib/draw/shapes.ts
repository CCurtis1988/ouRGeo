import type { Position } from './types'

type Project = (lngLat: [number, number]) => { x: number; y: number }
type Unproject = (point: [number, number]) => { lng: number; lat: number }

/**
 * Screen-aligned rectangle between two corners. Shift constrains to a square
 * (in pixel space, so it *looks* square at the current view). Returns the 4
 * corners, unclosed, counter-clockwise in screen space.
 */
export function rectangleCorners(
  a: Position,
  b: Position,
  square: boolean,
  project: Project,
  unproject: Unproject
): Position[] {
  const pa = project(a)
  const pb = project(b)
  let dx = pb.x - pa.x
  let dy = pb.y - pa.y
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy))
    dx = Math.sign(dx || 1) * side
    dy = Math.sign(dy || 1) * side
  }
  const cornersPx: [number, number][] = [
    [pa.x, pa.y],
    [pa.x + dx, pa.y],
    [pa.x + dx, pa.y + dy],
    [pa.x, pa.y + dy]
  ]
  return cornersPx.map((p) => {
    const ll = unproject(p)
    return [ll.lng, ll.lat] as Position
  })
}

/**
 * Circle around a center through an edge point, densified to `segments`
 * vertices. Computed in pixel space so it renders as a visual circle.
 */
export function circleVertices(
  center: Position,
  edge: Position,
  project: Project,
  unproject: Unproject,
  segments = 64
): Position[] {
  const pc = project(center)
  const pe = project(edge)
  const r = Math.hypot(pe.x - pc.x, pe.y - pc.y)
  if (r === 0) return []
  const out: Position[] = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    const ll = unproject([pc.x + r * Math.cos(a), pc.y + r * Math.sin(a)])
    out.push([ll.lng, ll.lat])
  }
  return out
}

/** Ramer–Douglas–Peucker simplification in pixel space. */
export function simplifyPathPx(
  points: Position[],
  project: Project,
  epsilonPx = 2
): Position[] {
  if (points.length <= 2) return points
  const px = points.map((p) => project(p))

  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1

  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [start, end] = stack.pop()!
    const a = px[start]
    const b = px[end]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    let maxDist = 0
    let maxIdx = -1
    for (let i = start + 1; i < end; i++) {
      const p = px[i]
      const dist =
        len === 0
          ? Math.hypot(p.x - a.x, p.y - a.y)
          : Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len
      if (dist > maxDist) {
        maxDist = dist
        maxIdx = i
      }
    }
    if (maxDist > epsilonPx && maxIdx > 0) {
      keep[maxIdx] = 1
      stack.push([start, maxIdx], [maxIdx, end])
    }
  }
  return points.filter((_, i) => keep[i] === 1)
}
