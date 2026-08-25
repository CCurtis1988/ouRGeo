import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle } from 'lucide-react'
import { Button } from '../ui/button'
import type { RoundTripReport } from '@/lib/markdown/roundtrip'

interface Props {
  open: boolean
  report: RoundTripReport | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

/**
 * Shown before entering Visual mode when the document would not survive the
 * round trip unchanged.
 *
 * Silently rewriting someone's file is the worst thing this feature could do, so
 * the switch is gated rather than merely logged — and the dialog names the lines
 * that would change instead of warning in the abstract.
 */
export function RoundTripWarningDialog({
  open, report, onOpenChange, onConfirm,
}: Props): React.ReactElement {
  const unsupported = report?.unsupported ?? []
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[460px] bg-geo-panel border border-geo-border rounded-lg shadow-xl focus:outline-none">
          <div className="p-5">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-yellow-500/15 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
              </div>
              <div>
                <Dialog.Title className="text-sm font-semibold text-foreground mb-1">
                  Visual mode would rewrite this document
                </Dialog.Title>
                <Dialog.Description className="text-xs text-geo-muted leading-relaxed">
                  Parts of this file have no equivalent in the visual editor. Switching
                  will change them when the document is written back.
                </Dialog.Description>
              </div>
            </div>

            {unsupported.length > 0 && (
              <div className="ml-11 mb-4 max-h-40 overflow-y-auto rounded border border-geo-border bg-geo-bg">
                {unsupported.slice(0, 8).map((u, i) => (
                  <div key={i} className="px-2.5 py-1.5 text-[11px] border-b border-geo-border last:border-0">
                    <span className="text-geo-muted">
                      {u.line != null ? `Line ${u.line}` : 'Somewhere'} · {labelFor(u.kind)}
                    </span>
                    <pre className="mt-0.5 font-mono text-foreground/80 whitespace-pre-wrap m-0">
                      {u.snippet}
                    </pre>
                  </div>
                ))}
                {unsupported.length > 8 && (
                  <div className="px-2.5 py-1.5 text-[11px] text-geo-muted">
                    …and {unsupported.length - 8} more
                  </div>
                )}
              </div>
            )}

            <p className="ml-11 mb-5 text-xs text-geo-muted">
              You can keep editing in Source mode, where the file is left exactly as written.
            </p>

            <div className="flex items-center justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm">Stay in Source</Button>
              </Dialog.Close>
              <Button
                size="sm"
                className="bg-yellow-600 hover:bg-yellow-500 text-white"
                onClick={() => { onConfirm(); onOpenChange(false) }}
              >
                Switch anyway
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function labelFor(kind: string): string {
  if (kind === 'html') return 'raw HTML'
  return kind
}
