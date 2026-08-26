import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Folder, FolderOpen, Check, Copy, ExternalLink, RefreshCw } from 'lucide-react'
import { useSessionStore } from '@/store/session'
import {
  changeWorkingDir, refreshWorkingDir, loadRecentDirs, elidePath,
} from '@/lib/working-dir'

// The working directory, shown where relative paths are typed.
//
// It is a button, not a label: the path is the control. Clicking it opens the
// one menu that does everything you can do with a working directory — change
// it, copy it, open it, or jump back to one you were in earlier. A separate
// "browse" button beside a passive label would take the same space to offer
// less, and would leave the path itself looking like decoration.
//
// The path is spelled out in full whenever it fits, and elided by whole
// segments when it does not (see `elidePath`). The untruncated path is always
// one hover away in the tooltip and always shown in full at the top of the menu.

/**
 * A path shortened to whatever width it is given.
 *
 * Measured against a canvas in the element's own font rather than left to CSS,
 * because `text-overflow: ellipsis` cuts the END off — and the end of a path is
 * the part that names the directory. The `direction: rtl` trick that truncates
 * the other way reorders the separators, which on a path is worse than either.
 */
function ElidedPath({ path, className }: { path: string; className?: string }): React.ReactElement {
  const boxRef = useRef<HTMLSpanElement>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [shown, setShown] = useState(path)

  // Laid out before paint, so the label never flashes at full width first.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) { setShown(path); return }
    const fit = (): void => {
      canvas.current ??= document.createElement('canvas')
      const ctx = canvas.current.getContext('2d')
      const available = box.clientWidth
      if (!ctx || available === 0) { setShown(path); return }
      const style = getComputedStyle(box)
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      setShown(elidePath(path, (c) => ctx.measureText(c).width <= available))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(box)
    return () => ro.disconnect()
  }, [path])

  // `flex-1` is load-bearing, not styling. Without it this box is sized by its
  // own text, so measuring it measures the elided string rather than the space
  // available — the label shrinks once and can never grow back, because the
  // ResizeObserver only ever sees the width the short text produced.
  return (
    <span
      ref={boxRef}
      className={`block min-w-0 flex-1 overflow-hidden whitespace-nowrap ${className ?? ''}`}
    >
      {shown}
    </span>
  )
}

export function WorkingDirBar(): React.ReactElement | null {
  const workingDir = useSessionStore((s) => s.workingDir)
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | null>(null)

  // Recents are read when the menu opens rather than kept in sync: they only
  // matter while it is showing, and a stale list is worse than a fresh read.
  useEffect(() => {
    if (!open) return
    void loadRecentDirs().then(setRecent)
    setAnchorRect(buttonRef.current?.getBoundingClientRect() ?? null)
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current?.contains(e.target as Node)) return
      if (buttonRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Place the menu once it has a height. The console pane sits at the bottom of
  // the window and is often only a few rows tall, so a menu anchored below the
  // header is usually taller than the space under it — measure, then flip above
  // the button when it does not fit. A layout effect, so it never paints in the
  // wrong place first.
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!open || !anchorRect || !menu) { setMenuStyle(null); return }
    const height = menu.offsetHeight
    const below = window.innerHeight - anchorRect.bottom
    const flipUp = height + 8 > below && anchorRect.top > below
    setMenuStyle({
      left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - menu.offsetWidth - 8)),
      top: flipUp ? undefined : anchorRect.bottom + 4,
      bottom: flipUp ? window.innerHeight - anchorRect.top + 4 : undefined,
      maxHeight: Math.max(160, (flipUp ? anchorRect.top : below) - 12),
    })
  }, [open, anchorRect, recent.length, error])

  useEffect(() => { if (!open) { setError(null); setCopied(false) } }, [open])

  const applyDir = useCallback(async (path: string) => {
    setBusy(true)
    setError(null)
    const res = await changeWorkingDir(path)
    setBusy(false)
    if (!res.ok) { setError(res.error ?? 'Could not change directory.'); return }
    if (res.recent) setRecent(res.recent)
    setOpen(false)
  }, [])

  const browse = useCallback(async () => {
    const picked = await window.electronAPI.dialog.openDirectory('Choose working directory')
    if (picked) await applyDir(picked)
  }, [applyDir])

  if (!workingDir) return null

  return (
    <>
      <div className="min-w-0 flex-1">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={`Working directory\n${workingDir}\n\nClick to change`}
          aria-label={`Working directory: ${workingDir}`}
          className={`flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-xs
            text-geo-muted transition-colors hover:bg-geo-bg hover:text-foreground
            ${open ? 'bg-geo-bg text-foreground' : ''}`}
        >
          <Folder className="h-3 w-3 flex-shrink-0" />
          <ElidedPath path={workingDir} className="font-mono text-left" />
        </button>
      </div>

      {open && anchorRect && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 w-[380px] max-w-[92vw] overflow-y-auto rounded-md border
            border-geo-border bg-geo-panel shadow-2xl shadow-black/50"
          // Hidden for the one frame before it has been measured, rather than
          // drawn at 0,0 and moved.
          style={menuStyle ?? { left: anchorRect.left, top: anchorRect.bottom + 4, visibility: 'hidden' }}
        >
          <div className="border-b border-geo-border px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-geo-muted">
              Working directory
            </div>
            {/* Selectable and wrapped: this is the one place the whole path is
                always readable, however narrow the console pane is. */}
            <div className="mt-1 select-text break-all font-mono text-xs text-foreground">
              {workingDir}
            </div>
          </div>

          <div className="p-1">
            <MenuItem
              icon={<FolderOpen className="h-3.5 w-3.5" />}
              label="Change directory…"
              hint="Browse"
              disabled={busy}
              onClick={() => { void browse() }}
            />
            <MenuItem
              icon={copied ? <Check className="h-3.5 w-3.5 text-geo-success" /> : <Copy className="h-3.5 w-3.5" />}
              label={copied ? 'Copied' : 'Copy path'}
              onClick={() => {
                void navigator.clipboard.writeText(workingDir).then(() => setCopied(true))
              }}
            />
            <MenuItem
              icon={<ExternalLink className="h-3.5 w-3.5" />}
              label="Open in file manager"
              onClick={() => {
                // openPath, not showItemInFolder: this is a directory, so the
                // useful action is to open it, not to select it in its parent.
                void window.electronAPI.shell.openPath(workingDir)
              }}
            />
            <MenuItem
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              label="Refresh from R"
              hint="getwd()"
              onClick={() => { void refreshWorkingDir() }}
            />
          </div>

          {recent.filter((p) => p !== workingDir).length > 0 && (
            <div className="border-t border-geo-border p-1">
              <div className="px-2 pb-1 pt-1 text-[10px] uppercase tracking-wide text-geo-muted">
                Recent
              </div>
              {recent.filter((p) => p !== workingDir).map((path) => (
                <button
                  key={path}
                  type="button"
                  disabled={busy}
                  onClick={() => { void applyDir(path) }}
                  title={path}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left
                    text-xs text-geo-muted hover:bg-geo-bg hover:text-foreground
                    disabled:opacity-50"
                >
                  <Folder className="h-3 w-3 flex-shrink-0" />
                  <ElidedPath path={path} className="font-mono" />
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="border-t border-geo-border px-3 py-2 text-xs text-geo-error">
              {error}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  )
}

function MenuItem({
  icon, label, hint, onClick, disabled,
}: {
  icon: React.ReactNode
  label: string
  hint?: string
  onClick: () => void
  disabled?: boolean
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs
        text-foreground hover:bg-geo-bg disabled:opacity-50"
    >
      <span className="flex-shrink-0 text-geo-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="font-mono text-[10px] text-geo-muted">{hint}</span>}
    </button>
  )
}
