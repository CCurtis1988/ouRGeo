import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, History } from 'lucide-react'
import { VERSION_HISTORY, APP_VERSION } from './versionHistory'

interface VersionHistoryDialogProps {
  children: React.ReactNode
}

// A read-only timeline of ouRGeo releases, newest first. Opened from the
// version badge in Settings; renders as its own (nestable) Radix dialog.
export function VersionHistoryDialog({ children }: VersionHistoryDialogProps): React.ReactElement {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[60]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[60]
            w-[560px] max-h-[85vh] flex flex-col
            bg-geo-panel border border-geo-border rounded-lg shadow-xl
            focus:outline-none"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-geo-border shrink-0">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-geo-accent" />
              <div>
                <Dialog.Title className="text-sm font-semibold text-foreground">
                  Version History
                </Dialog.Title>
                <p className="text-[11px] text-geo-muted mt-0.5">
                  The story of ouRGeo, from the first release to today
                </p>
              </div>
            </div>
            <Dialog.Close className="text-geo-muted hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          {/* Timeline */}
          <div className="overflow-y-auto px-5 py-4">
            <ol className="relative border-l border-geo-border ml-2">
              {VERSION_HISTORY.map((rel, i) => {
                const isCurrent = rel.version === APP_VERSION
                return (
                  <li key={rel.version} className={`ml-5 ${i === VERSION_HISTORY.length - 1 ? '' : 'pb-6'}`}>
                    {/* Timeline node */}
                    <span
                      className={`absolute -left-[6px] mt-1.5 w-3 h-3 rounded-full border-2 ${
                        isCurrent
                          ? 'bg-geo-accent border-geo-accent'
                          : 'bg-geo-panel border-geo-muted'
                      }`}
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">
                        v{rel.version}
                      </span>
                      <span className="text-xs text-foreground/80">— {rel.title}</span>
                      {isCurrent && (
                        <span className="text-[10px] font-medium uppercase tracking-wider text-geo-accent border border-geo-accent/40 bg-geo-accent/10 rounded px-1.5 py-0.5">
                          Current
                        </span>
                      )}
                      <span className="text-[11px] text-geo-muted ml-auto">{rel.date}</span>
                    </div>
                    <p className="text-xs text-geo-muted mt-1.5 leading-relaxed">{rel.summary}</p>
                    <ul className="mt-2.5 space-y-1.5">
                      {rel.highlights.map((h, j) => (
                        <li key={j} className="flex gap-2 text-xs text-foreground/90 leading-relaxed">
                          <span className="text-geo-accent shrink-0 mt-1.5 w-1 h-1 rounded-full bg-geo-accent" />
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                )
              })}
            </ol>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
