import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, X, TerminalSquare, RotateCcw, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/context-menu'
import { useTerminalStore } from '@/store/terminal'
import { useSessionStore } from '@/store/session'
import { TerminalView } from './TerminalView'
import {
  adoptRunningSessions, closeSession, ensureSession, openSession, interruptSession,
  refreshCwd,
} from '@/lib/terminal/sessions'
import { goToRWorkingDir, setRWorkingDirFromShell } from '@/lib/terminal/r-link'
import { ZoneTabs } from '../layout/ZoneTabs'
import { usePanelDrawsTabs } from '@/hooks/useZoneTabs'
import { usePanelId } from '../layout/panel-context'
import { TerminalDirBar } from './TerminalDirBar'

// The Terminal panel: a strip of shells, and whichever one is in front.
//
// The panel owns a SET, which is the same thing that makes a second code
// editor worth having and a second map not — and the reason "another terminal"
// is another tab in here rather than another panel in the workspace.

interface MenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

/** Rename in place. A dialog for one short string is three clicks where one
 *  would do, and the name is right there in the strip to type over. */
function TabName({ id, title, editing, stop }: {
  id: string; title: string; editing: boolean; stop: () => void
}): React.ReactElement {
  const patch = useTerminalStore((s) => s.patchSession)
  const [draft, setDraft] = useState(title)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) { setDraft(title); ref.current?.select() } }, [editing, title])

  if (!editing) return <>{title}</>
  return (
    <input
      ref={ref}
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onBlur={() => {
        const name = draft.trim()
        // `renamed` is what stops the shell's own title sequence — which fires
        // on every command in most default prompts — from erasing the name the
        // user just chose. Clearing the field hands the name back to the shell.
        if (name) patch(id, { title: name, renamed: true })
        else patch(id, { renamed: false })
        stop()
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') { setDraft(title); stop() }
      }}
      className="w-24 bg-geo-bg border border-geo-accent rounded px-1 text-xs text-foreground outline-none"
    />
  )
}

function TabStrip({ onMenu }: { onMenu: (m: MenuState) => void }): React.ReactElement {
  const sessions = useTerminalStore((s) => s.sessions)
  const activeId = useTerminalStore((s) => s.activeId)
  const setActive = useTerminalStore((s) => s.setActive)
  const workingDir = useSessionStore((s) => s.workingDir)
  const [renaming, setRenaming] = useState<string | null>(null)

  const menuFor = useCallback(async (id: string, x: number, y: number) => {
    // Asked before the menu is built, not while it is open: the enabled state
    // of "Set R's working directory to here" is the answer, and a menu item
    // that enables itself a moment after you looked at it is worse than one
    // that was right when it appeared.
    const cwd = await refreshCwd(id)
    const session = useTerminalStore.getState().sessions.find((s) => s.id === id)
    if (!session) return
    const others = useTerminalStore.getState().sessions.filter((s) => s.id !== id)
    onMenu({
      x,
      y,
      items: [
        { label: 'Rename…', onClick: () => setRenaming(id) },
        {
          label: 'Duplicate',
          // Same shell, same directory — which is what "another one of these"
          // means, and is not the same as the `+` button's default profile.
          onClick: () => { void openSession({ profileId: session.profileId, cwd: session.cwd }) },
        },
        { separator: true, label: '' },
        {
          label: cwd
            ? `Set R’s working directory to ${cwd}`
            : 'Set R’s working directory to here — this shell’s directory is unknown',
          // Disabled rather than absent, because the reason is worth telling;
          // and never guessed, since `setwd` to the wrong place silently
          // changes what every relative path in the R session means.
          disabled: !cwd,
          onClick: () => { void setRWorkingDirFromShell(id) },
        },
        {
          label: workingDir ? `Go to ${workingDir}` : 'Go to R’s working directory',
          disabled: !workingDir,
          onClick: () => { goToRWorkingDir(id) },
        },
        { separator: true, label: '' },
        {
          label: 'Interrupt (Ctrl+C)',
          disabled: !session.alive,
          onClick: () => { interruptSession(id) },
        },
        { label: 'Close', onClick: () => { void closeSession(id) } },
        {
          label: 'Close others',
          disabled: others.length === 0,
          onClick: () => { for (const o of others) void closeSession(o.id) },
        },
      ],
    })
  }, [onMenu, workingDir])

  return (
    // Sized by its tabs, not `flex-1`: the space left over belongs to the
    // directory, which is the one thing in this row that grows usefully.
    <div className="flex items-center gap-0.5 min-w-0 shrink overflow-x-auto">
      {sessions.map((s) => (
        <div
          key={s.id}
          role="tab"
          aria-selected={s.id === activeId}
          title={s.cwd ? `${s.title} — ${s.cwd}` : s.title}
          onDoubleClick={() => setRenaming(s.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            setActive(s.id)
            void menuFor(s.id, e.clientX, e.clientY)
          }}
          onMouseDown={(e) => {
            // Middle-click closes, the way it does in every tab strip; done on
            // mousedown so it cannot land on whatever scrolled underneath.
            if (e.button === 1) { e.preventDefault(); void closeSession(s.id) }
            else if (e.button === 0) setActive(s.id)
          }}
          // A pill, not an underline. The pane's own tabs beside these are
          // underlined, and two underlined rows of tabs an inch apart read as
          // peers when one of them lives inside the other.
          className={cn(
            'group flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] cursor-pointer',
            'max-w-[200px] flex-shrink-0 transition-colors',
            s.id === activeId
              ? 'bg-geo-panel text-foreground'
              : 'text-geo-muted hover:text-foreground hover:bg-geo-panel/50',
          )}
          data-ourgeo-id="terminal.tab"
        >
          {/* A bell in a tab that is not in front is the only way to know a
              long command finished in one you are not watching. */}
          {s.bell && <span className="h-1.5 w-1.5 rounded-full bg-geo-accent flex-shrink-0" />}
          <span className={cn('truncate', !s.alive && 'line-through opacity-60')}>
            <TabName
              id={s.id}
              title={s.title}
              editing={renaming === s.id}
              stop={() => setRenaming(null)}
            />
          </span>
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
  const setProfiles = useTerminalStore((s) => s.setProfiles)
  const profiles = useTerminalStore((s) => s.profiles)
  const loadPrefs = useTerminalStore((s) => s.loadPrefs)
  const setPrefs = useTerminalStore((s) => s.setPrefs)
  const [checked, setChecked] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const started = useRef(false)
  const panelId = usePanelId('terminal')
  const drawsTabs = usePanelDrawsTabs(panelId)

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
      // The placement preference is applied once at startup (EditorLayout) and
      // whenever the setting is changed — deliberately NOT here. Mounting is
      // what happens when the user clicks the Terminal tab, and re-arranging
      // the zone at that moment would undo a split the user had set up by hand
      // every time they looked at their shell.
      const availability = await window.electronAPI.terminal.available()
      setChecked(true)
      if (!availability.ok) {
        setBackendError(availability.error ?? 'unknown')
        return
      }
      setBackendError(null)
      setProfiles(await window.electronAPI.terminal.shells())
      // Adopt first: after a reload main is still running the user's shells,
      // and creating a new one before looking would leave the old ones with no
      // tab and no way to reach them.
      await adoptRunningSessions()
      await ensureSession()
    })()
  }, [loadPrefs, setBackendError, setProfiles])

  const profileMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const { prefs } = useTerminalStore.getState()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...profiles.map((p) => ({
          // A tick on the default, so the menu says which one the plain `+`
          // button opens rather than leaving it to be discovered.
          label: `${prefs.profileId === p.id ? '✓ ' : ' '}${p.label}`,
          onClick: () => { void openSession({ profileId: p.id }) },
        })),
        { separator: true, label: '' },
        ...profiles.map((p) => ({
          label: `Always open ${p.label}`,
          disabled: prefs.profileId === p.id,
          onClick: () => setPrefs({ profileId: p.id }),
        })),
      ],
    })
  }, [profiles, setPrefs])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-geo-border pl-1 pr-2 py-0.5 flex-shrink-0">
        {/* The pane's tabs, then this panel's own. One row rather than two:
            the zone used to draw a strip above this header, which put a tab
            called "Terminal" directly on top of a header that said the same. */}
        {drawsTabs && <ZoneTabs panel={panelId} className="flex-shrink-0" />}
        {drawsTabs && <span className="h-4 w-px flex-shrink-0 bg-geo-border" />}
        <TabStrip onMenu={setMenu} />
        {activeId && <TerminalDirBar sessionId={activeId} />}
        <button
          type="button"
          title="New terminal"
          aria-label="New terminal"
          onClick={() => { void openSession() }}
          onContextMenu={profileMenu}
          disabled={backendError !== null}
          className={cn(
            'flex-shrink-0 rounded p-1 text-geo-muted transition-colors',
            backendError ? 'opacity-40 cursor-not-allowed' : 'hover:text-foreground hover:bg-geo-bg',
          )}
          data-ourgeo-id="terminal.new"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        {/* The same menu on a visible control as well as on right-click: a
            second shell is discoverable, a DIFFERENT shell should be too. */}
        <button
          type="button"
          title="Choose a shell"
          aria-label="Choose a shell"
          onClick={profileMenu}
          disabled={backendError !== null || profiles.length < 2}
          className={cn(
            'flex-shrink-0 rounded p-1 text-geo-muted transition-colors',
            backendError || profiles.length < 2
              ? 'opacity-40 cursor-not-allowed'
              : 'hover:text-foreground hover:bg-geo-bg',
          )}
          data-ourgeo-id="terminal.profiles"
        >
          <ChevronDown className="h-3.5 w-3.5" />
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
                    onClick={() => { void closeSession(s.id).then(() => openSession({ profileId: s.profileId, cwd: s.cwd })) }}
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

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
