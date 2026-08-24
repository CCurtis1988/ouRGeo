/**
 * Out-of-band refresh registry for DataViewer.
 *
 * Allows code outside React's rendering cycle (e.g. geometry commit hooks) to
 * directly trigger a soft-refresh on a specific DataViewer without going
 * through Zustand signals or useEffect — which suffer from React 18
 * useSyncExternalStore intermediate-render ordering issues.
 */

const callbacks = new Map<string, () => void>()

/** A single geometry-cell display update: set `columnName` at `rowIdx` to `value`. */
export interface DataViewerCellUpdate {
  rowIdx: number
  columnName: string
  value: string
}

const cellUpdaters = new Map<string, (updates: DataViewerCellUpdate[]) => void>()

function key(accessPath: string, envName: string): string {
  // Normalize the env so a layer created with an empty/undefined envName (e.g.
  // db-backed layers, some draw paths) still matches a data viewer registered
  // under the default '.GlobalEnv'. Without this, triggerDataViewerRefresh
  // silently misses and the grid only updates on a manual refresh.
  return `${accessPath}::${envName || '.GlobalEnv'}`
}

export function registerDataViewerRefresh(
  accessPath: string,
  envName: string,
  fn: () => void
): void {
  callbacks.set(key(accessPath, envName), fn)
}

export function unregisterDataViewerRefresh(
  accessPath: string,
  envName: string
): void {
  callbacks.delete(key(accessPath, envName))
}

export function triggerDataViewerRefresh(
  accessPath: string,
  envName: string
): void {
  callbacks.get(key(accessPath, envName))?.()
}

/**
 * Targeted cell updates. Lets a mutation that already knows the new display
 * value (e.g. Save Edits, which holds each edited row's WKT) patch just those
 * cells directly, instead of forcing a whole-object re-fetch that would also
 * be far heavier.
 */
export function registerDataViewerCellUpdate(
  accessPath: string,
  envName: string,
  fn: (updates: DataViewerCellUpdate[]) => void
): void {
  cellUpdaters.set(key(accessPath, envName), fn)
}

export function unregisterDataViewerCellUpdate(
  accessPath: string,
  envName: string
): void {
  cellUpdaters.delete(key(accessPath, envName))
}

export function triggerDataViewerCellUpdate(
  accessPath: string,
  envName: string,
  updates: DataViewerCellUpdate[]
): void {
  if (updates.length > 0) cellUpdaters.get(key(accessPath, envName))?.(updates)
}
