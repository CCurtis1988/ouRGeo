import React, { useEffect, useState } from 'react'
import { Switch } from '../ui/switch'
import { useTerminalStore } from '@/store/terminal'
import type { ShellProfile } from '@/lib/terminal/shells'
import { cn } from '@/lib/utils'

// Settings → Terminal.
//
// Where the terminal SITS is in Settings → Workspace with the rest of the
// arrangement, not here: that is a fact about the workspace, and a user
// looking for it goes where the other panel settings are. This section is
// about the shell and how it is drawn.

const FONT_MIN = 8
const FONT_MAX = 32

const CURSORS: { id: 'block' | 'underline' | 'bar'; label: string }[] = [
  { id: 'block', label: 'Block' },
  { id: 'underline', label: 'Underline' },
  { id: 'bar', label: 'Bar' },
]

const selectClass = cn(
  'bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground',
  'outline-none focus:border-geo-accent',
)

function Row({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-foreground">{label}</div>
        {hint && <div className="text-[10px] text-geo-muted leading-relaxed">{hint}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

export function TerminalSettings(): React.ReactElement {
  const prefs = useTerminalStore((s) => s.prefs)
  const setPrefs = useTerminalStore((s) => s.setPrefs)
  const loadPrefs = useTerminalStore((s) => s.loadPrefs)
  const storedProfiles = useTerminalStore((s) => s.profiles)
  const setProfiles = useTerminalStore((s) => s.setProfiles)
  const [error, setError] = useState<string | null>(null)

  // Settings can be the first thing a user opens, before the panel has ever
  // been shown — so this section reads the preferences and the shell list
  // itself rather than assuming the panel already did.
  useEffect(() => {
    void (async () => {
      await loadPrefs()
      const availability = await window.electronAPI.terminal.available()
      if (!availability.ok) {
        setError(availability.error ?? 'The terminal backend is unavailable.')
        return
      }
      const found: ShellProfile[] = await window.electronAPI.terminal.shells()
      setProfiles(found)
    })()
  }, [loadPrefs, setProfiles])

  if (error) {
    return (
      <p className="text-[11px] text-geo-muted leading-relaxed">
        The terminal cannot start on this system, so there is nothing to configure.
        <span className="block mt-1 text-geo-muted/70 break-words">{error}</span>
      </p>
    )
  }

  return (
    <div className="flex flex-col divide-y divide-geo-border">
      <Row
        label="Shell"
        hint="What a new terminal opens. Only shells found on this machine are listed."
      >
        <select
          value={prefs.profileId ?? ''}
          onChange={(e) => setPrefs({ profileId: e.target.value || null })}
          className={selectClass}
          data-ourgeo-id="settings.terminalShell"
        >
          {/* The default is a real choice, not a blank: on a machine where the
              user installs fish next week, "this machine's default" should
              follow $SHELL rather than stay pinned to the bash they never
              chose. */}
          <option value="">This machine’s default</option>
          {storedProfiles.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </Row>

      <Row
        label="Start in R’s working directory"
        hint="A relative path then means the same thing in the shell as at the R prompt."
      >
        <Switch
          checked={prefs.followRWorkingDir}
          onChange={(v) => setPrefs({ followRWorkingDir: v })}
          label=""
          className="w-auto"
        />
      </Row>

      <Row label="Font size">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={FONT_MIN}
            max={FONT_MAX}
            value={prefs.fontSize}
            onChange={(e) => setPrefs({ fontSize: Number(e.target.value) })}
            className="w-28 accent-geo-accent"
          />
          <span className="w-6 text-right text-[10px] text-geo-muted">{prefs.fontSize}</span>
        </div>
      </Row>

      <Row label="Cursor">
        <div className="flex items-center gap-2">
          <select
            value={prefs.cursorStyle}
            onChange={(e) => setPrefs({
              cursorStyle: e.target.value as 'block' | 'underline' | 'bar',
            })}
            className={selectClass}
          >
            {CURSORS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <label className="flex items-center gap-1 text-[10px] text-geo-muted">
            <input
              type="checkbox"
              checked={prefs.cursorBlink}
              onChange={(e) => setPrefs({ cursorBlink: e.target.checked })}
              className="accent-geo-accent"
            />
            Blink
          </label>
        </div>
      </Row>

      <Row
        label="Scrollback"
        hint="Lines kept per terminal. Held in memory only — terminal output is never written to disk."
      >
        <select
          value={prefs.scrollback}
          onChange={(e) => setPrefs({ scrollback: Number(e.target.value) })}
          className={selectClass}
        >
          <option value={1000}>1,000 lines</option>
          <option value={10000}>10,000 lines</option>
          <option value={50000}>50,000 lines</option>
          <option value={200000}>200,000 lines</option>
        </select>
      </Row>

      <Row
        label="Copy on select"
        // Konsole's habit, and genuinely useful once you expect it — but a
        // selection that silently replaces the clipboard is a surprise to
        // everyone who does not, which is why it ships off.
        hint="Selecting text copies it immediately. Ctrl+Shift+C copies either way."
      >
        <Switch
          checked={prefs.copyOnSelect}
          onChange={(v) => setPrefs({ copyOnSelect: v })}
          label=""
          className="w-auto"
        />
      </Row>
    </div>
  )
}
