import { useShallow } from 'zustand/react/shallow'
import { useSpatialStore } from '@/store/spatial'
import { useDbSpatialTile } from '@/hooks/useDbSpatialTile'

// Bridges the spatial store to the per-layer tile fetcher. Mounted once
// inside SpatialEditor; renders nothing visible.
//
// The selector returns layer IDs (primitives) rather than layer objects so
// that re-renders only fire when db-backed layers are added or removed —
// not on every `setLayerTileGeoJSON` (which mutates layer references but
// not the set of IDs).
export function DbSpatialTileLoader(): React.ReactElement | null {
  const tileLayerIds = useSpatialStore(
    useShallow((s) =>
      s.layers.filter((l) => l.tileSource && l.visible).map((l) => l.id)
    )
  )
  return (
    <>
      {tileLayerIds.map((id) => (
        <DbSpatialTileBinding key={id} layerId={id} />
      ))}
    </>
  )
}

function DbSpatialTileBinding({ layerId }: { layerId: string }) {
  useDbSpatialTile(layerId)
  return null
}

// Saving/discarding pending edits lives in src/hooks/useSaveEdits.ts — the
// unified per-object Save Edits workflow covers db-backed and in-memory
// groups alike.
