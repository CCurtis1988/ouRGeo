// ── Identify (info-click) target assembly ────────────────────────────────────
// Pure helpers shared by MapView's identify handler and its tests.

export interface IdentifyTarget {
  kind: 'vector' | 'raster'
  layerId: string
  layerName: string // R accessPath (display + fetch)
  envName: string
  featureIndex?: number // vector only — row index == geojson array position
}

/** True if a 4326 lng/lat falls inside a raster layer's [w,s,e,n] bounds. */
export function rasterBoundsHit(
  lng: number,
  lat: number,
  bounds: [number, number, number, number],
): boolean {
  const [w, s, e, n] = bounds
  return lng >= w && lng <= e && lat >= s && lat <= n
}

export interface VectorHit {
  layerId: string
  layerName: string
  envName: string
  indices: number[] // sorted row indices for this layer
}

export interface RasterHit {
  layerId: string
  layerName: string
  envName: string
}

/**
 * Assemble the ordered identify pane list: one pane per hit vector feature
 * (in layer order, then row order), followed by one pane per hit raster layer.
 */
export function buildIdentifyTargets(
  vectorHits: VectorHit[],
  rasterHits: RasterHit[],
): IdentifyTarget[] {
  const targets: IdentifyTarget[] = []
  for (const h of vectorHits) {
    for (const idx of h.indices) {
      targets.push({
        kind: 'vector',
        layerId: h.layerId,
        layerName: h.layerName,
        envName: h.envName,
        featureIndex: idx,
      })
    }
  }
  for (const r of rasterHits) {
    targets.push({
      kind: 'raster',
      layerId: r.layerId,
      layerName: r.layerName,
      envName: r.envName,
    })
  }
  return targets
}
