import React, { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Database, Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { rClient } from '@/lib/r-client'
import { useDatabaseStore } from '@/store/database'

interface CreateDatabaseDialogProps {
  onCreated: (filePath: string) => void
  onCancel: () => void
}

export function CreateDatabaseDialog({ onCreated, onCancel }: CreateDatabaseDialogProps): React.ReactElement {
  const workspaceFolder = useDatabaseStore((s) => s.workspaceFolder)
  const [name, setName] = useState('')
  const [folderPath, setFolderPath] = useState<string | null>(workspaceFolder)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pickFolder = async (): Promise<void> => {
    const p = await window.electronAPI.dialog.openDirectory('Select Save Folder')
    if (p) setFolderPath(p)
  }

  const create = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!folderPath || !trimmed) return
    const stem = trimmed.toLowerCase().endsWith('.rgeo') ? trimmed.slice(0, -5) : trimmed
    const filePath = `${folderPath}/${stem}.Rgeo`
    setBusy(true)
    setError(null)
    try {
      const res = await rClient.dbCreate(filePath)
      if (!res.success) {
        setError(res.error ?? 'Failed to create database')
        return
      }
      await rClient.dbRecentsAdd(filePath)
      onCreated(filePath)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create database')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[460px] bg-geo-panel border border-geo-border rounded-lg shadow-xl flex flex-col">
          <div className="flex items-center justify-between px-4 h-10 border-b border-geo-border">
            <Dialog.Title className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-geo-accent" />
              Create Database (.Rgeo)
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-geo-muted hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </Button>
            </Dialog.Close>
          </div>

          <div className="px-4 py-3 flex flex-col gap-3">
            <div>
              <label className="text-[10px] text-geo-muted">Database name</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full mt-1 bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent"
                placeholder="my_project"
              />
            </div>
            <div>
              <label className="text-[10px] text-geo-muted">Save location</label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  readOnly
                  value={folderPath ?? ''}
                  placeholder="(no folder chosen)"
                  className="flex-1 bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px] text-geo-accent"
                  onClick={pickFolder}
                >
                  Browse…
                </Button>
              </div>
              <div className="text-[10px] text-geo-muted mt-1">
                A new DuckDB-backed .Rgeo file will be created in this folder.
              </div>
            </div>
            {error && (
              <div className="text-[11px] text-geo-error">{error}</div>
            )}
          </div>

          <div className="px-4 py-2 border-t border-geo-border flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-7 text-xs text-geo-muted" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-geo-accent"
              onClick={create}
              disabled={busy || !folderPath || !name.trim()}
            >
              {busy && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
              Create
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
