import { useMemo } from 'react'
import { useSpatialStore } from '@/store/spatial'
import type { PendingEditMeta } from '@/store/spatial'
import { saveEditGroups, discardEditGroups } from '@/lib/save-edits'

export interface PendingEditGroupView {
  key: string
  meta: PendingEditMeta
  displayName: string
  geometryCount: number
  rowAddCount: number
}

/**
 * Summarize the staged edits per object, for the ribbon badge and the Save
 * Edits dialog.
 *
 * Subscribe to the two raw store records (stable references that only change
 * on an actual store write) and derive the group objects in useMemo. Deriving
 * them inside the zustand selector — even with useShallow — returns freshly
 * allocated objects on every getSnapshot call, which React treats as an
 * ever-changing snapshot and re-renders until "Maximum update depth exceeded".
 */
export function usePendingEditGroups(): PendingEditGroupView[] {
  const pendingGeometryEdits = useSpatialStore((s) => s.pendingGeometryEdits)
  const pendingEditMeta = useSpatialStore((s) => s.pendingEditMeta)
  return useMemo(() => {
    const groups: PendingEditGroupView[] = []
    for (const [key, edits] of Object.entries(pendingGeometryEdits)) {
      const meta = pendingEditMeta[key]
      if (!meta || edits.length === 0) continue
      groups.push({
        key,
        meta,
        displayName: meta.accessPath.split('$')[0] || meta.accessPath,
        geometryCount: edits.filter((e) => (e.kind ?? 'geometry') === 'geometry').length,
        rowAddCount: edits.filter((e) => e.kind === 'row-add').length
      })
    }
    return groups
  }, [pendingGeometryEdits, pendingEditMeta])
}

/**
 * Save / discard staged edits per object group. Memory groups write back as
 * one batched R statement echoed to the console; database groups flush via
 * /dataset/update-geometry. Saving or discarding a group is an undo barrier
 * (its commit-log entries are dropped).
 */
export function useSaveEdits(): {
  saveGroups: (keys: string[]) => Promise<void>
  discardGroups: (keys: string[]) => Promise<void>
} {
  // The work itself lives in src/lib/save-edits.ts — nothing in it was
  // React-specific, and the AI assistant needs the same path.
  return { saveGroups: saveEditGroups, discardGroups: discardEditGroups }
}
