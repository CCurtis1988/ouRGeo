import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { create } from 'zustand'
import { useProjectStore } from '@/store/project'
import { useContextStore } from '@/store/context'

export type UnsavedChoice = 'save' | 'discard' | 'cancel'

interface UnsavedDialogState {
  open: boolean
  projectName: string
  resolve: ((choice: UnsavedChoice) => void) | null
}

const useUnsavedDialog = create<UnsavedDialogState>(() => ({
  open: false,
  projectName: '',
  resolve: null,
}))

/**
 * Prompt the user to save unsaved project changes. Resolves to their choice.
 * Returns 'discard' immediately (no dialog) when the project isn't dirty, or when
 * it's the scratch project (path === null) — scratch is never savable in place,
 * so we just proceed. Callers do: if 'cancel' bail; if 'save' save first.
 */
export function confirmUnsaved(): Promise<UnsavedChoice> {
  const { isDirty, name, path } = useProjectStore.getState()
  if (path === null || !isDirty) return Promise.resolve('discard')
  return new Promise<UnsavedChoice>((resolve) => {
    useUnsavedDialog.setState({ open: true, projectName: name, resolve })
  })
}

async function choose(choice: UnsavedChoice): Promise<void> {
  if (choice === 'discard') {
    try {
      const lease = await window.electronAPI.context.lease()
      await window.electronAPI.projectFiles.discard(lease.id)
      await useContextStore.getState().discardProjectDraft()
    }
    catch (error) {
      useContextStore.setState({ error: `Could not discard the memory recovery journal: ${String(error)}. Try again before closing.` })
      return
    }
  }
  const { resolve } = useUnsavedDialog.getState()
  useUnsavedDialog.setState({ open: false, resolve: null })
  resolve?.(choice)
}

export function UnsavedChangesDialog(): React.ReactElement {
  const { open, projectName } = useUnsavedDialog()

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) choose('cancel') }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[60]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[60]
            w-[420px] bg-geo-panel border border-geo-border rounded-lg shadow-xl
            focus:outline-none"
        >
          <div className="px-5 py-4 border-b border-geo-border">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              Unsaved changes
            </Dialog.Title>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs text-geo-muted leading-relaxed">
              <span className="text-foreground font-medium">{projectName}</span> has unsaved
              changes to the R environment, workspace, project files or project memory. Save them before continuing?
            </p>
            <p className="text-[11px] text-geo-muted mt-2">
              Your open scripts and scratch tabs are always kept regardless of this choice.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-geo-border">
            <button
              type="button"
              onClick={() => choose('cancel')}
              className="px-3 py-1.5 text-xs rounded text-geo-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => choose('discard')}
              className="px-3 py-1.5 text-xs rounded border border-geo-border text-foreground hover:bg-white/5 transition-colors"
            >
              Don&apos;t Save
            </button>
            <button
              type="button"
              onClick={() => choose('save')}
              className="px-3 py-1.5 text-xs rounded bg-geo-accent text-white hover:bg-geo-accent/90 transition-colors"
            >
              Save
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
