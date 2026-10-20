// Where the user was in each document: cursor, selection, scroll, folding.
//
// Monaco keeps this per EDITOR, not per model, and there is one editor per
// panel whose model is swapped on every tab change — so without a record kept
// here, switching tabs and back lands at line 1, and so does reopening a
// project. `saveViewState()` is plain JSON (cursor state, scroll, the folding
// contribution's ranges), which is what lets it go into the draft.
//
// Deliberately outside the editor store: it changes on every caret move, and
// the tab bar, the session autosave and the project dirty-tracker all
// subscribe to that store. Writers learn of changes through `onViewChange`.

type ViewState = unknown

const views = new Map<string, ViewState>()
const listeners = new Set<() => void>()

export function rememberView(tabId: string, state: ViewState | null | undefined): void {
  if (!state) return
  views.set(tabId, state)
  listeners.forEach(listener => listener())
}

export function viewFor(tabId: string): ViewState | undefined {
  return views.get(tabId)
}

export function allViews(liveTabIds?: Set<string>): Record<string, ViewState> {
  const out: Record<string, ViewState> = {}
  for (const [id, state] of views) if (!liveTabIds || liveTabIds.has(id)) out[id] = state
  return out
}

/** Replace the record wholesale — a project load, or a draft restore. */
export function restoreViews(record: Record<string, ViewState> | null | undefined): void {
  views.clear()
  for (const [id, state] of Object.entries(record ?? {})) if (state && typeof state === 'object') views.set(id, state)
  listeners.forEach(listener => listener())
}

export function onViewChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
