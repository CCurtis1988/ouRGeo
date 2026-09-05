import React, { useEffect, useRef, useState } from 'react'
import { Plus, X, TerminalSquare, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTerminalStore } from '@/store/terminal'
import { TerminalView } from './TerminalView'
import {
  adoptRunningSessions, closeSession, ensureSession, openSession,
} from '@/lib/terminal/sessions'
import { alignTerminalMode } from '@/lib/terminal/placement'
import { useLayoutStore } from '@/store/layout'

// The Terminal panel: a strip of shells, and whichever one is in front.
//
// The panel owns a SET, which is the same thing that makes a second code
// editor worth having and a second map not — and the reason "another terminal"
// is another tab in here rather than another panel in the workspace.

function TabStrip(): React.ReactElement {
  const sessions = useTerminalStore((s) => s.sessions)
  const activeId = useTerminalStore((s) => s.activeId)
  const setActive = useTerminalStore((s) => s.setActive)

  return (
    <div className="flex items-center gap-0.5 min-w-0 flex-1 overflow-x-auto">
      {sessions.map((s) => (
        <div
          key={s.id}
          role="tab"
          aria-selected={s.id === activeId}
          title={s.cwd ? `${s.title} — ${s.cwd}` : s.title}
          onMouseDown={(e) => {
            // Middle-click closes, the way it does in every tab strip; done on
            // mousedown so it cannot land on whatever scrolled underneath.
            if (e.button === 1) { e.preventDefault(); void closeSession(s.id) }
            else if (e.button === 0) setActive(s.id)
          }}
          className={cn(
            'group flex items-center gap-1.5 px-2 py-1 rounded-t text-xs cursor-pointer',
            'border-b-2 max-w-[180px] flex-shrink-0 transition-colors',
            s.id === activeId
              ? 'border-geo-accent text-foreground'
              : 'border-transparent text-geo-muted hover:text-foreground',
          )}
          data-ourgeo-id="terminal.tab"
        >
          {/* A bell in a tab that is not in front is the only way to know a
              long command finished in one you are not watching. */}
          {s.bell && <span className="h-1.5 w-1.5 rounded-full bg-geo-accent flex-shrink-0" />}
          <span className={cn('truncate', !s.alive && 'line-through opacity-60')}>{s.title}</span>
          {!s.alive && s.exitCode !== null && (
            <span className={cn(
              'flex-shrink-0 text-[10px]',
              s.exitCode === 0 ? 'text-geo-muted' : 'text-geo-error',
            )}>
              {s.exitCode}
            </span>
          )}
          <button
            type="button"
            aria-label={`Close ${s.title}`}
            onMouseDown={(e) => { e.stopPropagation() }}
            onClick={(e) => { e.stopPropagation(); void closeSession(s.id) }}
            className="opacity-0 group-hover:opacity-100 hover:text-geo-error flex-shrink-0"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}

/** What a machine with no usable pty binary sees, instead of a terminal that
 *  fails on the first keystroke with nothing to explain it. */
function BackendUnavailable({ error }: { error: string }): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md space-y-2 text-center">
        <TerminalSquare className="mx-auto h-6 w-6 text-geo-muted" />
        <p className="text-xs text-foreground">The terminal cannot start on this system.</p>
        <p className="text-[11px] text-geo-muted leading-relaxed">
          ouRGeo needs a pseudo-terminal, and no build of one is available for this
          platform. You can still run system commands from the R console with{' '}
          <code className="text-geo-accent">system(&quot;…&quot;)</code>.
        </p>
        <p className="text-[10px] text-geo-muted/70 break-words">{error}</p>
      </div>
    </div>
  )
}

function EmptyState(): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="space-y-2 text-center">
        <TerminalSquare className="mx-auto h-6 w-6 text-geo-muted" />
        <p className="text-xs text-geo-muted">No terminal open.</p>
        <button
          type="button"
          onClick={() => { void openSession() }}
          className="text-xs text-geo-accent hover:underline"
        >
          Open a shell
        </button>
      </div>
    </div>
  )
}

export function TerminalPanel(): React.ReactElement {
  const sessions = useTerminalStore((s) => s.sessions)
  const activeId = useTerminalStore((s) => s.activeId)
  const backendError = useTerminalStore((s) => s.backendError)
  const setBackendError = useTerminalStore((s) => s.setBackendError)
  const loadPrefs = useTerminalStore((s) => s.loadPrefs)
  const [checked, setChecked] = useState(false)
  const started = useRef(false)

  // Opening the panel is what starts a shell — nothing spawns one in the
  // background, so a user who never opens the Terminal never has a pty. Guarded
  // against StrictMode's double-invoke twice over: the ref here, and
  // `ensureSession`'s own in-flight promise, which is what actually holds when
  // two different callers race.
  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      await loadPrefs()
      // The placement preference has nothing to apply to until the panel is
      // open, and this is that moment: a workspace built before the terminal
      // existed has it in the bottom strip in `split`, and the default is a
      // tab. `alignTerminalMode` never MOVES the panel, so a terminal the user
      // has dragged elsewhere is left exactly where they put it.
      const { placement } = useTerminalStore.getState().prefs
      useLayoutStore.getState().transform((l) => alignTerminalMode(l, placement))

      const availability = await window.electronAPI.terminal.available()
      setChecked(true)
      if (!availability.ok) {
        setBackendError(availability.error ?? 'unknown')
        return
      }
      setBackendError(null)
      // Adopt first: after a reload main is still running the user's shells,
      // and creating a new one before looking would leave the old ones with no
      // tab and no way to reach them.
      await adoptRunningSessions()
      await ensureSession()
    })()
  }, [loadPrefs, setBackendError])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-geo-border px-2 py-0.5 flex-shrink-0">
        <TabStrip />
        <button
          type="button"
          title="New terminal"
          aria-label="New terminal"
          onClick={() => { void openSession() }}
          disabled={backendError !== null}
          className={cn(
            'flex-shrink-0 rounded p-1 text-geo-muted transition-colors',
            backendError ? 'opacity-40 cursor-not-allowed' : 'hover:text-foreground hover:bg-geo-bg',
          )}
          data-ourgeo-id="terminal.new"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {backendError
          ? <BackendUnavailable error={backendError} />
          : sessions.length === 0
            ? (checked ? <EmptyState /> : <div />)
            : sessions.map((s) => (
              <div key={s.id} className="absolute inset-0">
                <TerminalView id={s.id} active={s.id === activeId} />
                {!s.alive && s.id === activeId && (
                  <button
                    type="button"
                    onClick={() => { void closeSession(s.id).then(() => openSession()) }}
                    className={cn(
                      'absolute bottom-2 right-3 flex items-center gap-1 rounded px-2 py-1',
                      'border border-geo-border bg-geo-panel text-[11px] text-geo-muted',
                      'hover:text-foreground',
                    )}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Restart
                  </button>
                )}
              </div>
            ))}
      </div>
    </div>
  )
}
