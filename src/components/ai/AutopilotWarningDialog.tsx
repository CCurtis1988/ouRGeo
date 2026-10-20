import React, { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle } from 'lucide-react'
import { Button } from '../ui/button'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (dismissForever: boolean) => void
}

export function AutopilotWarningDialog({ open, onOpenChange, onConfirm }: Props): React.ReactElement {
  const [dismiss, setDismiss] = useState(false)
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] bg-geo-panel border border-geo-border rounded-lg shadow-xl focus:outline-none">
          <div className="p-5">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-yellow-500/15 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
              </div>
              <div>
                <Dialog.Title className="text-sm font-semibold text-foreground mb-1">
                  Enable Autopilot Mode?
                </Dialog.Title>
                <Dialog.Description className="text-xs text-geo-muted leading-relaxed">
                  Autopilot allows the AI model to execute R code directly in your live session.
                </Dialog.Description>
              </div>
            </div>

            <div className="space-y-2 text-xs text-geo-muted mb-5 ml-11">
              <p>• The model can <span className="text-foreground">create, modify, or delete</span> R objects and variables.</p>
              <p>• Some operations may be <span className="text-foreground">difficult or impossible to undo</span>.</p>
              <p>• Never include sensitive data or secrets in your conversation.</p>
              <p>• Review the code the model runs before trusting its results.</p>
            </div>

            <label className="flex items-center gap-2 text-xs text-geo-muted mb-5 ml-11 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dismiss}
                onChange={(e) => setDismiss(e.target.checked)}
                className="accent-geo-accent"
              />
              Don't show this warning again
              <span className="text-[10px] text-geo-muted/80">(Settings → Prompts turns it back on)</span>
            </label>

            <div className="flex items-center justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm">Cancel</Button>
              </Dialog.Close>
              <Button
                size="sm"
                className="bg-yellow-600 hover:bg-yellow-500 text-white"
                onClick={() => { onConfirm(dismiss); onOpenChange(false) }}
              >
                Enable Autopilot
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
