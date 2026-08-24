import React, { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Database, FileCode2, Check } from 'lucide-react'
import { Button } from '../ui/button'
import { usePendingEditGroups, useSaveEdits } from '@/hooks/useSaveEdits'

/**
 * Per-object save/discard for staged geometry edits. Lists every edited
 * object with exactly what will be written; the user can accept some
 * objects' changes while rejecting others'.
 */
export function SaveEditsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.ReactElement {
  const groups = usePendingEditGroups()
  const { saveGroups, discardGroups } = useSaveEdits()
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)

  // Newly appearing groups default to checked
  useEffect(() => {
    if (!open) return
    setChecked((prev) => {
      const next: Record<string, boolean> = {}
      for (const g of groups) next[g.key] = prev[g.key] ?? true
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, groups.map((g) => g.key).join('|')])

  // Close automatically when nothing is left to decide
  useEffect(() => {
    if (open && groups.length === 0 && !busy) onOpenChange(false)
  }, [open, groups.length, busy, onOpenChange])

  const selectedKeys = groups.filter((g) => checked[g.key]).map((g) => g.key)

  const handleSave = async () => {
    setBusy(true)
    try {
      await saveGroups(selectedKeys)
    } finally {
      setBusy(false)
    }
  }

  const handleDiscard = async () => {
    if (!window.confirm(
      `Discard staged edits for ${selectedKeys.length} object(s)? ` +
      `Geometry changes revert and rows added while drawing are deleted.`
    )) return
    setBusy(true)
    try {
      await discardGroups(selectedKeys)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] bg-geo-panel border border-geo-border rounded-lg shadow-xl p-4 flex flex-col gap-3">
          <Dialog.Title className="text-sm font-semibold text-foreground">Save Edits</Dialog.Title>
          <Dialog.Description className="text-xs text-geo-muted">
            Choose which objects' staged edits to write. Unchecked objects keep
            their edits staged.
          </Dialog.Description>

          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
            {groups.map((g) => (
              <label
                key={g.key}
                className="flex items-center gap-2 px-2 py-1.5 rounded border border-geo-border bg-geo-bg/40 cursor-pointer hover:bg-geo-bg"
              >
                <input
                  type="checkbox"
                  className="accent-[#4493f8]"
                  checked={checked[g.key] ?? true}
                  onChange={(e) => setChecked((c) => ({ ...c, [g.key]: e.target.checked }))}
                />
                {g.meta.source === 'database' ? (
                  <Database className="w-3.5 h-3.5 text-geo-accent flex-shrink-0" />
                ) : (
                  <FileCode2 className="w-3.5 h-3.5 text-geo-success flex-shrink-0" />
                )}
                <span className="text-xs text-foreground truncate">{g.displayName}</span>
                <span className="ml-auto text-[10px] text-geo-muted flex-shrink-0">
                  {g.geometryCount > 0 && `${g.geometryCount} geometry edit${g.geometryCount === 1 ? '' : 's'}`}
                  {g.geometryCount > 0 && g.rowAddCount > 0 && ' · '}
                  {g.rowAddCount > 0 && `${g.rowAddCount} row${g.rowAddCount === 1 ? '' : 's'} added`}
                </span>
                <span className="text-[9px] uppercase tracking-wide text-geo-muted flex-shrink-0">
                  {g.meta.source === 'database' ? 'db' : 'R env'}
                </span>
              </label>
            ))}
            {groups.length === 0 && (
              <div className="text-xs text-geo-muted px-2 py-3 text-center">No staged edits.</div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-geo-muted hover:text-foreground"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-geo-error hover:text-geo-error hover:bg-geo-error/10"
              onClick={() => void handleDiscard()}
              disabled={busy || selectedKeys.length === 0}
            >
              Discard selected
            </Button>
            <Button
              size="sm"
              className="h-6 text-xs bg-geo-accent hover:bg-geo-accent/80 text-white gap-1"
              onClick={() => void handleSave()}
              disabled={busy || selectedKeys.length === 0}
            >
              <Check className="w-3 h-3" />
              Save selected
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
