import React, { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../ui/button'
import { useProjectFileReplaceStore } from '@/store/project-file-replace'
import { formatProjectFileTarget } from '@/lib/project-file-targets'
import { fileSize } from '@/lib/project-files-ui'

/**
 * Asked before an export dialog writes over a file already in Project Files.
 * Rendered once, in EditorLayout, and raised by `confirmProjectFileReplace`
 * from whichever export dialog is open — it sits above that dialog (z-300: Export Code's own dialog is at 201) so
 * the export keeps its settings if the answer is Cancel.
 */
export function ReplaceProjectFileDialog(): React.ReactElement | null {
  const pending = useProjectFileReplaceStore(s => s.pending)
  const answer = useProjectFileReplaceStore(s => s.answer)
  const [dontAskAgain, setDontAskAgain] = useState(false)
  useEffect(() => { if (pending) setDontAskAgain(false) }, [pending])
  if (!pending) return null
  const { existing } = pending
  const added = new Date(existing.updatedAt || existing.importedAt)
  return (
    <Dialog.Root open onOpenChange={open => { if (!open) answer(false) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[300]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[300] w-[440px] max-w-[94vw] bg-geo-panel border border-geo-border rounded-lg shadow-xl">
          <div className="px-4 py-3 border-b border-geo-border">
            <Dialog.Title className="text-sm font-semibold text-foreground">Replace a project file?</Dialog.Title>
          </div>
          <div className="px-4 py-3 space-y-2">
            <Dialog.Description className="text-sm text-foreground">
              <span className="font-medium">{formatProjectFileTarget(existing)}</span> is already in Project Files
              ({fileSize(existing.bytes)}{Number.isNaN(added.getTime()) ? '' : `, last changed ${added.toLocaleDateString()}`}).
            </Dialog.Description>
            <p className="text-xs text-geo-muted leading-relaxed">
              Exporting as <span className="font-mono">{pending.name}</span> replaces its contents; it keeps its
              description. The saved .ourgeoproj still holds the previous version until you save the project.
            </p>
            <label className="flex items-start gap-2 pt-1 text-xs text-foreground cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={dontAskAgain} onChange={e => setDontAskAgain(e.target.checked)} />
              <span>Don&apos;t ask again<span className="block text-[10px] text-geo-muted">Turn this question back on in Settings → Prompts.</span></span>
            </label>
          </div>
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-geo-border">
            <Button variant="ghost" size="sm" onClick={() => answer(false)}>Cancel</Button>
            <Button size="sm" onClick={() => answer(true, dontAskAgain)} className="bg-geo-accent hover:bg-geo-accent/80 text-white" data-ourgeo-id="projectFiles.replaceConfirm">
              Replace
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
