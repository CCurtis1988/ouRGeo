// Closing documents that hold unsaved edits (docs/project-persistence-spec.md
// §1.4). The editor store's `closeTab` is the mechanism; this is the policy
// every way of closing goes through — the tab's ✕, Ctrl+W, Close Others,
// Close All and the assistant's editor:closeTab — so none of them can throw
// away work without asking.

import React from 'react'
import { useEditorStore, type TabState } from '@/store/editor'
import { languageOf } from '@/lib/markdown/doc-kind'
import { ask } from '@/store/ask'

/** "Unsaved edits" in the spec's sense. An untitled document counts once it
 *  holds text of the user's own — the starter scaffold a new R Markdown
 *  document opens with is not that. Object tabs are views of R objects and
 *  hold nothing to lose. */
export function hasUnsavedEdits(tab: TabState): boolean {
  if (tab.type && tab.type !== 'code') return false
  if (tab.filePath) return tab.isDirty
  return tab.content.trim() !== '' && tab.content !== tab.savedContent
}

export type CloseOutcome = 'closed' | 'cancelled'
type Decision = 'save' | 'discard'

/** Write one document to its file, or to a new one the user picks. Returns
 *  false when the picker was cancelled — which cancels the close. */
export async function saveDocument(tab: TabState, forceNewPath = false): Promise<boolean> {
  let path = forceNewPath ? null : tab.filePath
  if (!path) {
    path = await window.electronAPI.dialog.saveFile(languageOf(tab))
    if (!path) return false
  }
  await window.electronAPI.file.write(path, tab.content)
  useEditorStore.getState().markTabSaved(tab.id, path, tab.content)
  return true
}

function question(tab: TabState, remaining: number): Parameters<typeof ask>[0] {
  const untitled = !tab.filePath
  return {
    title: untitled ? `Save ${tab.fileName} to a file?` : `Save changes to ${tab.fileName}?`,
    body: untitled
      ? <p><span className="text-foreground font-medium">{tab.fileName}</span> has never been saved to a file. Closing it without saving discards its text.</p>
      : <p><span className="text-foreground font-medium">{tab.fileName}</span> has edits that are not in <span className="font-mono">{tab.filePath}</span>. Closing it without saving discards them.</p>,
    choices: [
      { id: 'cancel', label: 'Cancel' },
      { id: 'discard', label: 'Discard', variant: 'default' },
      { id: 'save', label: untitled ? 'Save to file…' : 'Save', variant: 'primary' },
    ],
    cancelId: 'cancel',
    checkbox: remaining > 0 ? { label: `Apply to all remaining (${remaining} more)` } : undefined,
  }
}

/**
 * Close tabs in order, asking about each one with unsaved edits. "Apply to
 * all remaining" answers the rest the same way. Cancel — or cancelling a
 * Save to file… picker, or a write that fails — stops the sequence there;
 * tabs already closed stay closed, the rest stay open.
 */
export async function closeTabs(ids: string[]): Promise<CloseOutcome> {
  let blanket: Decision | null = null
  const pending = ids.filter(id => useEditorStore.getState().tabs.some(t => t.id === id))
  for (let index = 0; index < pending.length; index++) {
    const tab = useEditorStore.getState().tabs.find(t => t.id === pending[index])
    if (!tab) continue
    if (!hasUnsavedEdits(tab)) { useEditorStore.getState().closeTab(tab.id); continue }
    const remaining = pending.slice(index + 1).filter(id => {
      const other = useEditorStore.getState().tabs.find(t => t.id === id)
      return other ? hasUnsavedEdits(other) : false
    }).length
    let decision: Decision
    if (blanket) decision = blanket
    else {
      const answer = await ask(question(tab, remaining))
      if (answer.choice === 'cancel') return 'cancelled'
      decision = answer.choice as Decision
      if (answer.checked) blanket = decision
    }
    if (decision === 'save') {
      try {
        if (!await saveDocument(tab)) return 'cancelled'
      } catch (error) {
        await ask({
          title: `Could not save ${tab.fileName}`,
          body: <p>{String(error)}. The document is still open with its edits. Use Save As… to write it somewhere else, or close it and choose Discard.</p>,
          choices: [{ id: 'ok', label: 'OK', variant: 'primary' }], cancelId: 'ok',
        })
        return 'cancelled'
      }
    }
    useEditorStore.getState().closeTab(tab.id)
  }
  return 'closed'
}

export const closeTab = (id: string): Promise<CloseOutcome> => closeTabs([id])

/** Close All / Close Others, within one editor panel. */
export function closeAllTabs(panelTabIds: string[], except?: string): Promise<CloseOutcome> {
  return closeTabs(panelTabIds.filter(id => id !== except))
}
