import React, { useState } from 'react'
import { Download, Plus, RotateCcw, Save, Trash2, Upload, X } from 'lucide-react'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { useLayoutStore } from '@/store/layout'
import { openPanels, ZONE_IDS, ZONE_LABELS } from '@/lib/layout/model'
import { panelInfo, panelMaxInstances, multiInstancePanels } from '@/lib/layout/panel-meta'
import { isPanelInstance, panelInstanceIds } from '@/lib/layout/instances'
import { placedPanelIds } from '@/lib/panel-content'
import {
  addPanelInstance, removalSummary, removePanelInstance,
} from '@/lib/panel-instances'
import { useSessionStore } from '@/store/session'
import { useTerminalStore } from '@/store/terminal'
import { placeTerminal, terminalIsPlaced } from '@/lib/terminal/placement'

/**
 * Add and remove extra editors.
 *
 * Here rather than only on the panel grip because this is the surface that
 * SHOWS you what you have. The grip's menu is the fast way once a panel exists
 * and the pointer is already on it; a user who has lost track of how many
 * editors they have needs a list, not a gesture.
 *
 * Only the panels listed here can be added, and only the copies can be
 * removed — the originals have no ✕, because removing one would leave its
 * documents nowhere to go. Removing a copy never closes a document: they move
 * to the editor that remains, and the row says so before the button is
 * pressed.
 */
function PanelInstances(): React.ReactElement {
  // Derived outside the selector: a selector returning a fresh array is a
  // new snapshot every render, and zustand re-renders on it.
  const layout = useLayoutStore((s) => s.layout)
  const placed = placedPanelIds(layout)
  const kinds = multiInstancePanels()
  const note = (kind: 'info' | 'error', text: string): void =>
    useSessionStore.getState().addConsoleEntry(kind, text)

  return (
    <div data-ourgeo-id="settings.panelInstances">
      {/* Named from the registry rather than written out, so this sentence
          cannot come to disagree with the list underneath it. */}
      <div className="text-[11px] text-geo-muted mb-2 leading-relaxed">
        The {kinds.map((p) => p.label.toLowerCase()).join(' and the ')} can be open
        more than once — two documents side by side, each panel with its own tabs.
        Every other panel shows one thing and exists once.
      </div>

      <div className="flex flex-col divide-y divide-geo-border border border-geo-border rounded">
        {kinds.map((base) => {
          const ids = panelInstanceIds(placed, base.id)
          const max = panelMaxInstances(base.id)
          return (
            <div key={base.id} className="flex flex-col gap-1 px-2 py-2">
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 text-xs text-foreground truncate">
                  {base.label}
                </span>
                <span className="text-[10px] text-geo-muted">
                  {ids.length} of {max}
                </span>
                <Button
                  variant="ghost" size="sm"
                  className="h-6 text-xs gap-1"
                  disabled={ids.length >= max}
                  onClick={() => {
                    const res = addPanelInstance(base.id)
                    note(res.ok ? 'info' : 'error',
                      res.ok ? `Added ${res.label}.` : res.message)
                  }}
                  title={ids.length >= max
                    ? `ouRGeo draws at most ${max} at once`
                    : `Add another ${base.label.toLowerCase()}`}
                >
                  <Plus className="w-3 h-3" />
                  Add
                </Button>
              </div>
              {ids.filter(isPanelInstance).map((id) => (
                <div key={id} className="flex items-center gap-2 pl-3">
                  <span className="flex-1 min-w-0 text-[11px] text-geo-muted truncate">
                    {panelInfo(id)?.label ?? id}
                  </span>
                  <span className="text-[10px] text-geo-muted/80 truncate">
                    {removalSummary(id)}
                  </span>
                  {/* Only the copies carry a ✕. The original is filtered out
                      above, because it is where the copies' documents come
                      home to — see lib/panel-instances.ts. */}
                  <Button
                    variant="ghost" size="sm"
                    className="h-6 w-6 p-0 text-geo-muted hover:text-geo-error"
                    onClick={() => {
                      const summary = removalSummary(id)
                      const label = panelInfo(id)?.label ?? id
                      const res = removePanelInstance(id)
                      note(res.ok ? 'info' : 'error',
                        res.ok ? `Removed ${label}. ${summary}`.trim() : res.message)
                    }}
                    title="Remove this panel"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Settings → Workspace.
//
// The arrangement was reachable from two places before this: the grip in a
// panel's corner, and the AI assistant. Both are gestures — neither shows you
// what you have, and neither survives being changed by accident. A saved
// arrangement is the undo for a workspace, which is why "Restore the default
// arrangement" sits with the list rather than somewhere else: the one thing a
// user needs after rearranging by mistake is the way back.

/** Whether panels can be dragged by their corner grip. */
function PanelDragToggle(): React.ReactElement {
  const dragEnabled = useLayoutStore((s) => s.dragEnabled)
  const setDragEnabled = useLayoutStore((s) => s.setDragEnabled)

  return (
    <Switch
      checked={dragEnabled}
      onChange={setDragEnabled}
      data-ourgeo-id="settings.panelDrag"
      label="Drag panels to rearrange them"
      // Off by default, so the description has to say what turning it ON
      // brings rather than what turning it off takes away — and it has to
      // mention the right-click menu, which is the grip's other half and
      // the only place "Move to" and "Remove" live outside this dialog.
      description={
        <>
          Puts a small grip in each panel’s top-right corner: drag it to drop the
          panel into another zone, or right-click it for that panel’s menu. The
          arrangement itself is unaffected either way — this list, and the
          assistant, can rearrange the workspace with the grips off.
        </>
      }
    />
  )
}

/**
 * Where the Terminal sits relative to the R console.
 *
 * The switch READS the arrangement rather than the stored preference, so it
 * tells the truth about the workspace: drag the terminal to the right column
 * and both positions read false, which is honest — it is in neither.
 *
 * Flipping it moves the panel NOW and remembers the choice for next time. What
 * it deliberately does not do is re-assert itself: the user is free to drag the
 * terminal anywhere afterwards and ouRGeo leaves it there. A setting that put
 * it back on every launch would be undoing the user's own arrangement, which
 * is the opposite of what a workspace preference is for.
 */
function TerminalPlacementToggle(): React.ReactElement {
  const layout = useLayoutStore((s) => s.layout)
  const transform = useLayoutStore((s) => s.transform)
  const setPlacement = useTerminalStore((s) => s.setPlacement)
  const split = terminalIsPlaced(layout, 'split')

  return (
    <Switch
      checked={split}
      onChange={(next) => {
        const placement = next ? 'split' : 'tab'
        setPlacement(placement)
        transform((l) => placeTerminal(l, placement))
      }}
      data-ourgeo-id="settings.terminalPlacement"
      label="Give the terminal its own pane"
      description={
        <>
          Off, the terminal is a tab in the R console’s pane. On, it sits beside the
          console so both are visible at once. Either way this moves it now and
          remembers the choice — drag it anywhere you like afterwards and it stays
          there. Tabs and splits are a property of the whole pane, so anything else
          sharing it follows along.
        </>
      }
    />
  )
}

/** The workspace in one line — what "Save" would be capturing. */
function summarize(layout: Parameters<typeof openPanels>[0]): string {
  const parts = ZONE_IDS.map((z) => {
    const names = openPanels(layout, z).map((p) => panelInfo(p)?.label ?? p)
    return names.length ? `${ZONE_LABELS[z]}: ${names.join(', ')}` : null
  }).filter(Boolean)
  return parts.length ? `Now — ${parts.join(' · ')}` : 'Nothing is open.'
}

/** Save, apply, export, import and delete named arrangements. */
export function LayoutSettings(): React.ReactElement {
  const presets = useLayoutStore((s) => s.presets)
  const savePreset = useLayoutStore((s) => s.savePreset)
  const applyPreset = useLayoutStore((s) => s.applyPreset)
  const deletePreset = useLayoutStore((s) => s.deletePreset)
  const exportPreset = useLayoutStore((s) => s.exportPreset)
  const importPresets = useLayoutStore((s) => s.importPresets)
  const reset = useLayoutStore((s) => s.reset)
  const layout = useLayoutStore((s) => s.layout)

  const [name, setName] = useState('')
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const taken = presets.some((p) => p.name.toLowerCase() === name.trim().toLowerCase())

  const save = async (): Promise<void> => {
    const n = name.trim()
    if (!n) return
    await savePreset(n)
    setName('')
    setNote({ kind: 'ok', text: `Saved “${n}”.` })
  }

  const doImport = async (): Promise<void> => {
    const res = await importPresets()
    if (!res) return                       // cancelled
    setNote(res.ok
      ? { kind: 'ok', text: `Imported ${res.names.join(', ')}.` }
      : { kind: 'error', text: res.error })
  }

  const doExport = async (preset: string): Promise<void> => {
    const path = await exportPreset(preset)
    if (path) setNote({ kind: 'ok', text: `Exported to ${path}.` })
  }

  return (
    <div className="flex flex-col gap-4">
      <PanelDragToggle />

      <TerminalPlacementToggle />

      <PanelInstances />

      <div>
        <div className="text-[11px] text-geo-muted mb-2 leading-relaxed">
          Save the panels as they are now, and come back to them later. An
          arrangement remembers which panels are open, which zone each is in, and
          how the space is divided.
        </div>

        <div className="flex items-center gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void save() }}
            placeholder="Name this arrangement…"
            className="flex-1 bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs
              text-foreground focus:outline-none focus:border-geo-accent"
            data-ourgeo-id="settings.layoutName"
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            disabled={name.trim().length === 0}
            onClick={() => void save()}
            title={taken ? `Replace the saved “${name.trim()}”` : 'Save the current arrangement'}
          >
            <Save className="w-3 h-3" />
            {taken ? 'Replace' : 'Save'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => void doImport()}
            title="Import arrangements from a .ourgeolayout.json file"
            data-ourgeo-id="settings.layoutImport"
          >
            <Upload className="w-3 h-3" />
            Import…
          </Button>
        </div>

        <div className="text-[10px] text-geo-muted mt-1.5">{summarize(layout)}</div>
      </div>

      {presets.length > 0 && (
        <div className="flex flex-col divide-y divide-geo-border border border-geo-border rounded">
          {presets.map((p) => (
            <div key={p.name} className="flex items-center gap-1 px-2 py-1.5">
              <button
                className="flex-1 min-w-0 text-left text-xs text-foreground hover:text-geo-accent truncate"
                onClick={() => { applyPreset(p.name); setNote({ kind: 'ok', text: `Applied “${p.name}”.` }) }}
                title="Apply this arrangement"
              >
                {p.name}
              </button>
              <Button
                variant="ghost" size="sm"
                className="h-6 w-6 p-0 text-geo-muted hover:text-foreground"
                onClick={() => void doExport(p.name)}
                title="Export to a file"
              >
                <Download className="w-3 h-3" />
              </Button>
              <Button
                variant="ghost" size="sm"
                className="h-6 w-6 p-0 text-geo-muted hover:text-geo-error"
                onClick={() => { void deletePreset(p.name); setNote(null) }}
                title="Delete this arrangement"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1 text-geo-muted hover:text-foreground"
          onClick={() => { reset(); setNote({ kind: 'ok', text: 'Restored the default arrangement.' }) }}
          title="Put every panel back where ouRGeo ships it"
          data-ourgeo-id="settings.layoutReset"
        >
          <RotateCcw className="w-3 h-3" />
          Restore default arrangement
        </Button>
        {note && (
          <span className={note.kind === 'ok' ? 'text-[10px] text-geo-success' : 'text-[10px] text-geo-error'}>
            {note.text}
          </span>
        )}
      </div>
    </div>
  )
}
