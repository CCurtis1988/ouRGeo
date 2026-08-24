import React, { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Loader2, FolderOpen } from 'lucide-react'
import { Button } from '../ui/button'
import { rClient } from '@/lib/r-client'

interface AddLibraryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: () => void
}

export function AddLibraryDialog({
  open,
  onOpenChange,
  onAdded
}: AddLibraryDialogProps): React.ReactElement {
  const [folderPath, setFolderPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasElectron =
    typeof window !== 'undefined' && !!window.electronAPI?.dialog?.openDirectory

  function handleClose() {
    if (loading) return
    onOpenChange(false)
    setError(null)
  }

  async function handleBrowse() {
    if (!hasElectron) return
    const path = await window.electronAPI.dialog.openDirectory()
    if (path) setFolderPath(path)
  }

  function validate(): string | null {
    if (!folderPath.trim()) return 'Enter a folder path.'
    return null
  }

  async function handleConfirm() {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setLoading(true)
    try {
      const res = await rClient.addLibraryPath(folderPath.trim())
      if (res.success) {
        onAdded()
        onOpenChange(false)
        setFolderPath('')
      } else {
        setError(res.error ?? 'Failed to add library path.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add library path.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] bg-geo-panel border border-geo-border rounded-md shadow-xl focus:outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-geo-border">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              Add Library Path
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-geo-muted hover:text-foreground" disabled={loading}>
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="px-4 py-4 space-y-4">
            <div className="space-y-1">
              <label className="text-xs text-geo-muted">Path</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={folderPath}
                  onChange={(e) => { setFolderPath(e.target.value); setError(null) }}
                  placeholder="/home/user/myRlibs"
                  disabled={loading}
                  className="flex-1 bg-geo-bg border border-geo-border rounded px-2 py-1.5 text-xs text-foreground placeholder:text-geo-muted outline-none focus:border-geo-accent"
                />
                {hasElectron && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7 px-2 text-geo-muted hover:text-foreground border border-geo-border"
                    onClick={handleBrowse}
                    disabled={loading}
                  >
                    <FolderOpen className="w-3 h-3 mr-1" />
                    Browse
                  </Button>
                )}
              </div>
              <p className="text-[10px] text-geo-muted leading-relaxed">
                Folder will be created if it doesn't exist. Changes persist to ~/.Rprofile.
              </p>
            </div>

            {error && <p className="text-xs text-geo-error">{error}</p>}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-geo-border">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="text-xs bg-geo-accent hover:bg-geo-accent/90 text-white"
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Library'
              )}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
