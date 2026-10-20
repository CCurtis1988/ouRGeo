import React, { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../ui/button'
import { useAskStore } from '@/store/ask'
import { cn } from '@/lib/utils'

/** The shared prompt behind `ask()` (store/ask.ts). Rendered once, in App,
 *  above every other dialog: a question raised while Settings or an export
 *  dialog is open has to be answerable without closing it. */
export function AskDialog(): React.ReactElement | null {
  const head = useAskStore(s => s.queue[0])
  const answer = useAskStore(s => s.answer)
  const [checked, setChecked] = useState(false)
  useEffect(() => { setChecked(false) }, [head])
  if (!head) return null
  return (
    <Dialog.Root open onOpenChange={open => { if (!open) answer(head.cancelId, false) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[310]" />
        <Dialog.Content data-ourgeo-id="project.ask" className={cn('fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[310] max-w-[94vw] max-h-[85vh] flex flex-col bg-geo-panel border border-geo-border rounded-lg shadow-xl focus:outline-none', head.wide ? 'w-[620px]' : 'w-[460px]')}>
          <div className="px-4 py-3 border-b border-geo-border shrink-0">
            <Dialog.Title className="text-sm font-semibold text-foreground">{head.title}</Dialog.Title>
          </div>
          <div className="px-4 py-3 space-y-2 overflow-y-auto min-h-0 text-xs text-geo-muted leading-relaxed">
            <Dialog.Description asChild><div>{head.body}</div></Dialog.Description>
            {head.checkbox && (
              <label className="flex items-start gap-2 pt-1 text-xs text-foreground cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={checked} onChange={e => setChecked(e.target.checked)} />
                <span>{head.checkbox.label}{head.checkbox.hint && <span className="block text-[10px] text-geo-muted">{head.checkbox.hint}</span>}</span>
              </label>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 border-t border-geo-border shrink-0">
            {head.choices.map(choice => (
              <Button key={choice.id} size="sm" variant={choice.variant === 'primary' || choice.variant === 'danger' ? 'default' : 'ghost'}
                onClick={() => answer(choice.id, checked)}
                className={cn(choice.variant === 'primary' && 'bg-geo-accent hover:bg-geo-accent/80 text-white', choice.variant === 'danger' && 'bg-geo-error hover:bg-geo-error/80 text-white', choice.variant === 'default' && 'border border-geo-border')}>
                {choice.label}
              </Button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
