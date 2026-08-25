import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileOutput, ChevronDown, Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { rClient } from '@/lib/r-client'
import { useSessionStore } from '@/store/session'
import {
  allAvailability, remedyCode, type KnitDeps, type KnitFormat, type FormatAvailability,
} from '@/lib/markdown/knit-deps'
import { cn } from '@/lib/utils'

interface Props {
  filePath: string | null
  isDirty: boolean
  /** Save the document first; resolves to its path, or null if cancelled. */
  onSaveRequest: () => Promise<string | null>
  /** Move the caret to a line, for knitr's "Quitting from lines N" errors. */
  onRevealLine: (line: number) => void
}

export function KnitMenu({
  filePath, isDirty, onSaveRequest, onRevealLine,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [deps, setDeps] = useState<KnitDeps | null>(null)
  const [busy, setBusy] = useState<KnitFormat | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const addEntry = useSessionStore((s) => s.addConsoleEntry)

  // Refresh when the menu OPENS, so items are already disabled with a reason
  // before the user can click one.
  const refresh = useCallback(async () => {
    try {
      const res = await rClient.rmarkdownDeps()
      setDeps(res)
    } catch { setDeps(null) }
  }, [])

  useEffect(() => {
    if (!open) return
    void refresh()
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, refresh])

  const toggle = (): void => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 2, left: Math.max(8, r.right - 300) })
    setOpen((v) => !v)
  }

  const runRemedy = (kind: NonNullable<FormatAvailability['remedy']>['kind']): void => {
    const code = remedyCode(kind)
    setOpen(false)
    addEntry('input', code)
    void rClient.execute(code).then((res) => {
      if (res.output) addEntry('output', res.output)
      if (res.error) addEntry('error', res.error)
      void refresh()
    })
  }

  const knit = async (format: KnitFormat): Promise<void> => {
    setOpen(false)
    // rmarkdown::render works on a FILE — relative paths inside the document
    // resolve against its directory, so an unsaved buffer has nowhere to anchor.
    let path = filePath
    if (!path || isDirty) {
      path = await onSaveRequest()
      if (!path) return
    }

    setBusy(format)
    const id = crypto.randomUUID()
    addEntry('info', `Knitting ${path.split(/[\\/]/).pop()} to ${format.toUpperCase()}…`)
    const off = window.electronAPI.knit.onProgress(id, (text) => {
      const trimmed = text.trim()
      if (trimmed) addEntry('output', trimmed)
    })
    try {
      const res = await window.electronAPI.knit.render({ id, filePath: path, format })
      if (res.success && res.outputPath) {
        addEntry('info', `Knit complete: ${res.outputPath}`)
        const err = await window.electronAPI.shell.openPath(res.outputPath)
        if (err) await window.electronAPI.shell.showItemInFolder(res.outputPath)
      } else {
        addEntry('error', res.error ?? 'Knit failed.')
        if (res.hint) addEntry('info', res.hint)
        if (res.errorLine) onRevealLine(res.errorLine)
      }
    } catch (e) {
      addEntry('error', e instanceof Error ? e.message : String(e))
    } finally {
      off()
      setBusy(null)
      // A failed knit may be a missing dependency — re-check so the menu updates.
      void refresh()
    }
  }

  const items = allAvailability(deps)

  return (
    <>
      <Button
        ref={btnRef as React.RefObject<HTMLButtonElement>}
        variant="ghost" size="sm" className="h-6 text-xs gap-1"
        onClick={toggle}
        disabled={busy !== null}
        title="Render this document to a file"
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileOutput className="w-3 h-3" />}
        {busy ? `Knitting ${busy.toUpperCase()}…` : 'Knit'}
        <ChevronDown className="w-2.5 h-2.5" />
      </Button>

      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="z-[9999] w-[300px] bg-geo-panel border border-geo-border rounded shadow-lg py-1"
        >
          {items.map((item) => (
            <div key={item.format}>
              <button
                disabled={!item.available}
                onClick={() => { void knit(item.format) }}
                className={cn(
                  'block w-full text-left text-xs px-3 py-1.5',
                  item.available
                    ? 'text-foreground hover:bg-geo-bg/50'
                    : 'text-geo-muted cursor-not-allowed'
                )}
              >
                {item.label}
              </button>
              {!item.available && item.reason && (
                <div className="px-3 pb-1.5 text-[10px] text-geo-muted leading-snug">
                  {item.reason}
                  {item.remedy && (
                    <button
                      onClick={() => runRemedy(item.remedy!.kind)}
                      className="block mt-1 text-geo-accent hover:underline"
                    >
                      {item.remedy.label}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {deps?.pandocVersion && (
            <div className="px-3 pt-1 mt-1 border-t border-geo-border text-[10px] text-geo-muted">
              pandoc {deps.pandocVersion}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  )
}
