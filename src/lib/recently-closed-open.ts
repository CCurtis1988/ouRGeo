import { useEditorStore } from '@/store/editor'
import { removeRecentlyClosed, useRecentlyClosedStore } from '@/store/recently-closed'
import { useSessionStore } from '@/store/session'

/** Reopen a file dropped from scratch, as it is on disk NOW — the edits that
 *  were dropped are gone by the user's own choice, and the file may have
 *  moved on since (docs/project-persistence-spec.md §2.5). */
export async function openRecentlyClosed(path: string): Promise<boolean> {
  try {
    const content = await window.electronAPI.file.read(path)
    useEditorStore.getState().addTab(path, content)
    removeRecentlyClosed(path)
    return true
  } catch {
    useRecentlyClosedStore.setState(state => ({ missing: { ...state.missing, [path]: true } }))
    useSessionStore.getState().addConsoleEntry('info', `${path}: file not found. It may have been moved or deleted since it was closed.`)
    return false
  }
}

/** Which listed files still exist, for greying out the ones that do not. */
export async function refreshRecentlyClosedExistence(): Promise<void> {
  const missing: Record<string, boolean> = {}
  for (const item of useRecentlyClosedStore.getState().items) {
    try { missing[item.path] = !(await window.electronAPI.fs.fileStat(item.path)).exists } catch { missing[item.path] = true }
  }
  useRecentlyClosedStore.setState({ missing })
}
