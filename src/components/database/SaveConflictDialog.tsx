import React, { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, AlertTriangle } from 'lucide-react'
import { Button } from '../ui/button'

export type SaveConflictDecision =
  | { action: 'overwrite' }
  | { action: 'rename'; newName: string }
  | { action: 'cancel' }

interface SaveConflictDialogProps {
  objectName: string
  databaseName: string
  existingNames: string[]
  onResolve: (decision: SaveConflictDecision) => void
}

function suggestUniqueName(base: string, existing: Set<string>): string {
  let i = 2
  while (existing.has(`${base}_${i}`)) i++
  return `${base}_${i}`
}

export function SaveConflictDialog({
  objectName,
  databaseName,
  existingNames,
  onResolve,
}: SaveConflictDialogProps): React.ReactElement {
  const existing = new Set(existingNames)
  const [renameValue, setRenameValue] = useState(suggestUniqueName(objectName, existing))

  const renameInvalid = !renameValue.trim() || existing.has(renameValue.trim())

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onResolve({ action: 'cancel' }) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[460px] bg-geo-panel border border-geo-border rounded-lg shadow-xl flex flex-col">
          <div className="flex items-center justify-between px-4 h-10 border-b border-geo-border">
            <Dialog.Title className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-geo-accent" />
              Object already exists
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-geo-muted hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </Button>
            </Dialog.Close>
          </div>

          <div className="px-4 py-3 flex flex-col gap-3">
            <div className="text-xs text-foreground">
              <span className="font-mono text-geo-accent">{objectName}</span> already exists in{' '}
              <span className="font-mono">{databaseName}</span>.
            </div>
            <div>
              <label className="text-[10px] text-geo-muted">Save under a different name</label>
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !renameInvalid) {
                    onResolve({ action: 'rename', newName: renameValue.trim() })
                  } else if (e.key === 'Escape') {
                    onResolve({ action: 'cancel' })
                  }
                }}
                className="w-full mt-1 bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent font-mono"
              />
              {existing.has(renameValue.trim()) && (
                <div className="text-[10px] text-geo-error mt-1">This name is also taken.</div>
              )}
            </div>
          </div>

          <div className="px-4 py-2 border-t border-geo-border flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-geo-muted"
              onClick={() => onResolve({ action: 'cancel' })}
            >
              Cancel
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-geo-error"
              onClick={() => onResolve({ action: 'overwrite' })}
            >
              Overwrite
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-geo-accent"
              disabled={renameInvalid}
              onClick={() => onResolve({ action: 'rename', newName: renameValue.trim() })}
            >
              Save as new
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
