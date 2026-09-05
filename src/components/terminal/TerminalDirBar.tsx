import React, { useCallback, useEffect, useState } from 'react'
import { Folder, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/context-menu'
import { useTerminalStore } from '@/store/terminal'
import { useSessionStore } from '@/store/session'
import { refreshCwd, writeToSession } from '@/lib/terminal/sessions'
import { goToRWorkingDir, setRWorkingDirFromShell, quoteForShell } from '@/lib/terminal/r-link'

// Where the shell is, shown beside the tab that is in it.
//
// The same idea as `WorkingDirBar` in the console header, and deliberately the
// same shape: the path IS the control. Clicking it opens the one menu that does
// everything you can do with a directory — change it, copy it, open it in the
// file manager, or reconcile it with R's.
//
// It is not the same COMPONENT, though, and that is the interesting part. R's
// working directory is a value ouRGeo owns and can set (`/session/setwd`); a
// shell's is a fact about a process we can only read, and the way to change it
// is to type `cd` and hope. Sharing one component would have meant a prop
// deciding which of two quite different things every menu item did.

/** How often to re-read the shell's directory while its tab is on screen.
 *  Cheap (a readlink in main) and the alternative is a stale path beside a
 *  prompt that has plainly moved on. */
const POLL_MS = 2000

export function TerminalDirBar({ sessionId }: { sessionId: string }): React.ReactElement | null {
  const session = useTerminalStore((s) => s.sessions.find((x) => x.id === sessionId))
  const rDir = useSessionStore((s) => s.workingDir)
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!session?.alive) return
    void refreshCwd(sessionId)
    const id = setInterval(() => { void refreshCwd(sessionId) }, POLL_MS)
    return () => clearInterval(id)
  }, [sessionId, session?.alive])

  const cwd = session?.cwd ?? null

  const open = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const items: ContextMenuItem[] = [
      {
        label: 'Change directory…',
        onClick: () => {
          void (async () => {
            const picked = await window.electronAPI.dialog.openDirectory('Change the shell’s directory')
            if (!picked) return
            // Typed, not set: a shell's directory is a fact about a running
            // process, and `cd` is the only way in. Sending it as a keystroke
            // means it lands in the shell's own history and scrollback, so
            // what happened is visible where it happened.
            writeToSession(sessionId, `cd ${quoteForShell(picked)}\r`)
          })()
        },
      },
      {
        label: copied ? 'Copied' : 'Copy path',
        disabled: !cwd,
        onClick: () => {
          if (!cwd) return
          void navigator.clipboard.writeText(cwd)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        },
      },
      {
        label: 'Open in file manager',
        disabled: !cwd,
        onClick: () => { if (cwd) void window.electronAPI.shell.openPath(cwd) },
      },
      { separator: true, label: '' },
      {
        label: cwd ? `Set R’s working directory to ${cwd}` : 'Set R’s working directory here',
        // Never guessed: `setwd` to the wrong place silently changes what every
        // relative path in the R session means.
        disabled: !cwd || cwd === rDir,
        onClick: () => { void setRWorkingDirFromShell(sessionId) },
      },
      {
        label: rDir ? `Go to R’s directory (${rDir})` : 'Go to R’s working directory',
        disabled: !rDir || rDir === cwd,
        onClick: () => { goToRWorkingDir(sessionId) },
      },
    ]
    setMenu({ x: e.clientX, y: e.clientY, items })
  }, [sessionId, cwd, rDir, copied])

  if (!session) return null

  // Highlighted when the two have drifted apart, because that is the moment
  // the menu below has something worth doing — and the moment a relative path
  // means two different things in the two halves of this pane.
  const diverged = !!cwd && !!rDir && cwd !== rDir

  return (
    <>
      <button
        type="button"
        onClick={open}
        onContextMenu={open}
        title={cwd
          ? `${cwd}${diverged ? `\nR is in ${rDir}` : ''}\nClick for directory actions`
          : 'This shell has not reported a directory'}
        data-ourgeo-id="terminal.workingDir"
        className={cn(
          'flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors',
          'hover:bg-geo-bg',
          diverged ? 'text-geo-warning' : 'text-geo-muted hover:text-foreground',
        )}
      >
        {copied
          ? <Check className="h-3 w-3 flex-shrink-0 text-geo-success" />
          : <Folder className="h-3 w-3 flex-shrink-0" />}
        <span className="truncate">{cwd ?? 'unknown directory'}</span>
      </button>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </>
  )
}
