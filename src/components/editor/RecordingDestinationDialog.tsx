import React, { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { FilePlus, FolderOpen, FileText } from 'lucide-react'
import { Button } from '../ui/button'
import { useEditorStore } from '@/store/editor'
import { cn } from '@/lib/utils'
import type { RecordingDestType } from '@/store/session'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (targetTabId: string, destType: RecordingDestType, returnOutput: boolean) => void
}

const options: { value: RecordingDestType; label: string; description: string; Icon: React.ElementType }[] = [
  {
    value: 'current',
    label: 'Currently opened file',
    description: 'Append recorded code to the file currently active in the editor.',
    Icon: FileText,
  },
  {
    value: 'new',
    label: 'New blank file',
    description: 'Create a new untitled tab and append recorded code there.',
    Icon: FilePlus,
  },
  {
    value: 'saved',
    label: 'Saved file',
    description: 'Pick an existing file on disk and append recorded code to it.',
    Icon: FolderOpen,
  },
]

export function RecordingDestinationDialog({ open, onOpenChange, onConfirm }: Props): React.ReactElement {
  const [selection, setSelection] = useState<RecordingDestType>('current')
  const [returnOutput, setReturnOutput] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleConfirm() {
    setBusy(true)
    try {
      const editorState = useEditorStore.getState()

      if (selection === 'current') {
        const tab = editorState.getActiveTab()
        if (!tab) return
        onConfirm(tab.id, 'current', returnOutput)

      } else if (selection === 'new') {
        const tabId = editorState.addTab()
        onConfirm(tabId, 'new', returnOutput)

      } else if (selection === 'saved') {
        const filePath = await window.electronAPI.dialog.openFile()
        if (!filePath) return
        const content = await window.electronAPI.file.read(filePath)
        const tabId = editorState.addTab(filePath, content)
        onConfirm(tabId, 'saved', returnOutput)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] bg-geo-panel border border-geo-border rounded-lg shadow-xl p-5 flex flex-col gap-4">
          <Dialog.Title className="text-sm font-semibold text-foreground">
            Start Recording — Choose Destination
          </Dialog.Title>
          <Dialog.Description className="text-xs text-geo-muted">
            Recorded R input will be appended as plain code to the selected file.
          </Dialog.Description>

          <div className="flex flex-col gap-2">
            {options.map(({ value, label, description, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setSelection(value)}
                className={cn(
                  'flex items-start gap-3 rounded-md border p-3 text-left transition-colors',
                  selection === value
                    ? 'border-geo-accent bg-geo-accent/10 text-foreground'
                    : 'border-geo-border text-geo-muted hover:border-geo-muted hover:text-foreground'
                )}
              >
                <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', selection === value ? 'text-geo-accent' : '')} />
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium">{label}</span>
                  <span className="text-[11px] text-geo-muted">{description}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="return-output"
              checked={returnOutput}
              onChange={(e) => setReturnOutput(e.target.checked)}
              className="w-3.5 h-3.5 accent-geo-accent"
            />
            <label htmlFor="return-output" className="text-xs text-geo-muted cursor-pointer select-none">
              Return Output
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="text-geo-muted hover:text-foreground"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-geo-accent hover:bg-geo-accent/80 text-white"
              onClick={handleConfirm}
              disabled={busy}
            >
              Start Recording
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
