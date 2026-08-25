import React, { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Button } from '../ui/button'
import type { MdActionDef } from '@/lib/markdown/actions'

interface Props {
  /** The action being applied, or null when the dialog is closed. */
  action: MdActionDef | null
  /** Pre-fill for fields marked `fromSelection`. */
  selectionText: string
  onCancel: () => void
  onSubmit: (values: Record<string, string>) => void
}

/**
 * Collects the values an insert action can't infer.
 *
 * Only two actions need one — Link and Footnote — but they are the two the
 * ribbon previously got wrong: a link was inserted with an empty `()` and a
 * footnote as a literal `[^]`, because the snippet expander strips the caret
 * marker without putting anything in its place. There is no ProseMirror command
 * that prompts for a URL either, which is why Visual mode used to refuse both.
 */
export function MdPromptDialog({
  action, selectionText, onCancel, onSubmit,
}: Props): React.ReactElement | null {
  const prompt = action?.prompt ?? null
  const [values, setValues] = useState<Record<string, string>>({})
  const firstRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  // Reset (and re-seed from the selection) each time the dialog opens for a
  // different action — a stale URL from the previous link would be worse than
  // an empty box.
  useEffect(() => {
    if (!prompt) return
    const seed: Record<string, string> = {}
    for (const f of prompt.fields) seed[f.id] = f.fromSelection ? selectionText : ''
    setValues(seed)
    // Focus the first EMPTY field: with text already carried in from the
    // selection, the URL is what the user actually came here to type.
    const t = window.setTimeout(() => firstRef.current?.focus(), 30)
    return () => window.clearTimeout(t)
  }, [prompt, selectionText])

  if (!action || !prompt) return null

  const missing = prompt.fields.some((f) => f.required && !values[f.id]?.trim())
  const submit = (): void => { if (!missing) onSubmit(values) }

  // The first field with nothing in it, so autofocus lands where typing starts.
  const focusId = prompt.fields.find((f) => !values[f.id]?.trim())?.id ?? prompt.fields[0]?.id

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[200]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[201]
            w-[420px] bg-geo-panel border border-geo-border rounded-lg shadow-xl
            flex flex-col focus:outline-none"
          onKeyDown={(e) => {
            // Enter submits from single-line fields; a textarea keeps its
            // newlines unless Ctrl/Cmd is held.
            const inTextarea = (e.target as HTMLElement).tagName === 'TEXTAREA'
            if (e.key === 'Enter' && (!inTextarea || e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              submit()
            }
          }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-geo-border">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              {prompt.title}
            </Dialog.Title>
            <Dialog.Close className="text-geo-muted hover:text-foreground">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <div className="px-4 py-3 flex flex-col gap-3">
            {prompt.description && (
              <p className="text-[11px] text-geo-muted leading-snug">{prompt.description}</p>
            )}
            {prompt.fields.map((f) => (
              <label key={f.id} className="flex flex-col gap-1">
                <span className="text-[11px] text-geo-muted">{f.label}</span>
                {f.multiline ? (
                  <textarea
                    ref={f.id === focusId ? (firstRef as React.RefObject<HTMLTextAreaElement>) : undefined}
                    value={values[f.id] ?? ''}
                    placeholder={f.placeholder}
                    rows={3}
                    onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                    className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs
                      text-foreground focus:outline-none focus:border-geo-accent resize-y"
                  />
                ) : (
                  <input
                    ref={f.id === focusId ? (firstRef as React.RefObject<HTMLInputElement>) : undefined}
                    value={values[f.id] ?? ''}
                    placeholder={f.placeholder}
                    onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                    className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs
                      text-foreground focus:outline-none focus:border-geo-accent"
                  />
                )}
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-2 px-4 py-3 border-t border-geo-border">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 text-xs" disabled={missing} onClick={submit}>
              {prompt.submitLabel ?? 'Insert'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
