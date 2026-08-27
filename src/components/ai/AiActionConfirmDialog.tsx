import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ShieldAlert } from 'lucide-react'
import { Button } from '../ui/button'
import { useUiStore } from '@/store/ui'

/**
 * The one-click gate on destructive assistant actions.
 *
 * Modal rather than a card in the transcript because the tool call is BLOCKED
 * on the answer: the model is mid-turn waiting on a promise, and a control the
 * user might scroll past would strand it. Closing the dialog is a "no" — the
 * safe answer has to be the one you get by doing nothing.
 */
export function AiActionConfirmDialog(): React.ReactElement | null {
  const confirm = useUiStore((s) => s.confirm)
  const answer = useUiStore((s) => s.answerConfirm)
  if (!confirm) return null

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) answer(false) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[60]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[60]
            w-[440px] bg-geo-panel border border-geo-border rounded-lg shadow-xl focus:outline-none"
        >
          <div className="flex items-start gap-3 px-5 py-4 border-b border-geo-border">
            <ShieldAlert className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold text-foreground">
                Let the assistant do this?
              </Dialog.Title>
              <Dialog.Description className="text-[11px] text-geo-muted mt-1">
                {confirm.summary}
              </Dialog.Description>
            </div>
          </div>

          <div className="px-5 py-4 space-y-2">
            <p className="text-[11px] text-geo-muted">Action</p>
            <code className="block text-xs text-geo-accent font-mono">{confirm.actionId}</code>
            <p className="text-[11px] text-geo-muted pt-2">Parameters</p>
            <pre className="text-[11px] text-foreground font-mono bg-geo-bg border border-geo-border
                            rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap">
              {confirm.details}
            </pre>
          </div>

          <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-geo-border">
            <span className="text-[10px] text-geo-muted">
              Change what needs confirming with the gear beside Autopilot.
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="h-7" onClick={() => answer(false)}>
                Don&apos;t
              </Button>
              <Button size="sm" className="h-7" onClick={() => answer(true)}>
                Allow
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
