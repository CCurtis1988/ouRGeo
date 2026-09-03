import React, { useState } from 'react'
import { Download, RotateCcw, Save, Trash2, Upload } from 'lucide-react'
import { Button } from '../ui/button'
import { useLayoutStore } from '@/store/layout'
import { openPanels, ZONE_IDS, ZONE_LABELS } from '@/lib/layout/model'
import { panelInfo } from '@/lib/layout/panel-meta'

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
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        className="accent-[#4493f8] mt-0.5"
        checked={dragEnabled}
        onChange={(e) => setDragEnabled(e.target.checked)}
        data-ourgeo-id="settings.panelDrag"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-xs text-foreground">Drag panels to rearrange them</span>
        <span className="text-[10px] text-geo-muted">
          Shows a small grip in each panel’s top-right corner; drag it to drop the
          panel into another zone. Turning this off only removes the gesture — the
          arrangement is unchanged, and saved arrangements below still apply.
        </span>
      </span>
    </label>
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
