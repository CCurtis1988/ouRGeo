import { create } from 'zustand'
import { createJsonFileStore } from '@/lib/persistence'
import { replacedProjectFile } from '@/lib/project-file-targets'
import type { ProjectFileEntry } from '@/lib/project-files'

// "Replace this project file?" — asked by every export dialog before it writes
// into Project Files over a file that is already there.
//
// Writing by name replaces, as writing over a file on disk does, and that is
// right for a script re-run. From a dialog it is easier to do by accident: the
// Environment menu names its output after the object, so exporting `sites`
// replaces the `sites.csv` imported last week. Hence a question, with a
// "don't ask again" for users who know, and a switch in Settings → Project
// Files that turns it back on — a dismissal with no way back would make the
// checkbox a one-way door.
//
// Only the GUI asks. R written by the user replaces silently, as it does on
// disk; the assistant's actions carry their own permission tiers.

const store = createJsonFileStore('project-file-preferences.json', 'Project File Preferences')

interface PendingReplace { name: string; existing: ProjectFileEntry; resolve: (replace: boolean) => void }

interface ProjectFileReplaceState {
  askBeforeReplacing: boolean
  pending: PendingReplace | null
  setAskBeforeReplacing: (ask: boolean) => void
  answer: (replace: boolean, dontAskAgain?: boolean) => void
}

export const useProjectFileReplaceStore = create<ProjectFileReplaceState>((set, get) => ({
  askBeforeReplacing: true,
  pending: null,
  setAskBeforeReplacing: ask => {
    set({ askBeforeReplacing: ask })
    void store.merge({ askBeforeReplacing: ask })
  },
  answer: (replace, dontAskAgain = false) => {
    const pending = get().pending
    if (!pending) return
    set({ pending: null })
    if (replace && dontAskAgain) get().setAskBeforeReplacing(false)
    pending.resolve(replace)
  },
}))

let loaded: Promise<void> | null = null
/** Read the preference once. Lazy, so nothing at startup waits on it. Only an
 *  explicit `false` turns the question off; an unreadable file asks. */
export function loadProjectFilePreferences(): Promise<void> {
  loaded ??= store.read<{ askBeforeReplacing?: unknown }>().then(data => {
    useProjectFileReplaceStore.setState({ askBeforeReplacing: data.askBeforeReplacing !== false })
  }, () => {})
  return loaded
}

/** True when the export may go ahead: nothing would be replaced, the user has
 *  turned the question off, or they answered Replace. Reads a fresh catalogue
 *  from main — the pane's mirror can lag a script that wrote seconds ago. */
export async function confirmProjectFileReplace(name: string): Promise<boolean> {
  await loadProjectFilePreferences()
  if (!useProjectFileReplaceStore.getState().askBeforeReplacing) return true
  const lease = await window.electronAPI.context.lease()
  const catalogue = await window.electronAPI.projectFiles.catalogue(lease.id)
  const existing = replacedProjectFile(catalogue, name)
  if (!existing) return true
  // One question at a time; a second export asking supersedes the first.
  useProjectFileReplaceStore.getState().pending?.resolve(false)
  return new Promise(resolve => useProjectFileReplaceStore.setState({ pending: { name, existing, resolve } }))
}
