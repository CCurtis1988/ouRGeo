import React, { useState, useEffect, useCallback } from 'react'
import { Check, X } from 'lucide-react'
import { useGeometryEditStore } from '@/store/geometryEdit'
import { useSessionStore } from '@/store/session'
import { rClient } from '@/lib/r-client'
import type { ColumnInfo } from '@/lib/r-client'
import { triggerDataViewerRefresh } from '@/lib/data-viewer-refresh'
import { isGeomColumn } from '@/components/editor/dataViewerShared'

const NUMERIC_TYPES = new Set(['numeric', 'integer', 'double', 'logical'])

function rValueFor(colType: string, raw: string): string {
  const v = raw.trim()
  if (v === '' || v.toUpperCase() === 'NA') return 'NA'
  if (NUMERIC_TYPES.has(colType)) {
    if (colType === 'logical') {
      const up = v.toUpperCase()
      if (up === 'TRUE' || up === 'FALSE' || up === 'T' || up === 'F') return up
      return 'NA'
    }
    return Number.isFinite(Number(v)) ? v : 'NA'
  }
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Compact attribute form shown after a new feature's geometry is drawn
 * (feature-template style). Writes the values with one echoed R statement.
 * "Ignore until next save" snoozes the popup — drawing continues
 * uninterrupted until Save Edits runs, then it comes back. It can be turned
 * off permanently in Settings → Spatial Editor.
 */
export function AttributePopover(): React.ReactElement | null {
  const prompt = useGeometryEditStore((s) => s.attributePrompt)
  const setPrompt = useGeometryEditStore((s) => s.setAttributePrompt)
  const setSnoozed = useGeometryEditStore((s) => s.setAttributePromptSnoozed)
  const addEntry = useSessionStore((s) => s.addConsoleEntry)
  const addHistory = useSessionStore((s) => s.addInputHistory)

  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!prompt) {
      setColumns([])
      setValues({})
      return
    }
    let cancelled = false
    setLoading(true)
    const baseName = prompt.accessPath.split(/[$[]/)[0]
    rClient
      .getObjectDataFrame(baseName, prompt.envName, prompt.accessPath, prompt.row, 1)
      .then((res) => {
        if (cancelled || !res.success) return
        const cols = res.columns.filter((c) => !isGeomColumn(c.type))
        setColumns(cols)
        setValues(Object.fromEntries(cols.map((c) => [c.name, ''])))
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [prompt])

  const handleSave = useCallback(async () => {
    if (!prompt) return
    const assignments = columns
      .filter((c) => values[c.name]?.trim())
      .map((c) => `${prompt.accessPath}[${prompt.row + 1}L, "${c.name}"] <- ${rValueFor(c.type, values[c.name])}`)
    if (assignments.length === 0) {
      setPrompt(null)
      return
    }
    const code = assignments.join('\n')
    addEntry('input', code)
    addHistory(code)
    setSaving(true)
    try {
      const res = await rClient.execute(code)
      if (!res.success && res.error) addEntry('error', res.error)
    } catch (e) {
      addEntry('error', String(e))
    } finally {
      setSaving(false)
    }
    triggerDataViewerRefresh(prompt.accessPath, prompt.envName)
    setPrompt(null)
  }, [prompt, columns, values, addEntry, addHistory, setPrompt])

  const snoozeUntilSave = useCallback(() => {
    // Suppress the popup for the rest of this editing run; Save Edits resets
    // it. Focus stays on the spatial editor so Enter keeps adding features.
    setSnoozed(true)
    setPrompt(null)
  }, [setSnoozed, setPrompt])

  if (!prompt) return null
  const displayName = prompt.accessPath.split('$')[0] || prompt.accessPath

  return (
    <div className="absolute bottom-12 right-3 z-40 w-64 bg-geo-panel border border-geo-border rounded-lg shadow-xl p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">
          New feature — <span className="text-geo-accent">{displayName}</span> row {prompt.row + 1}
        </span>
        <button
          className="text-geo-muted hover:text-foreground"
          title="Skip attribute entry"
          onClick={() => setPrompt(null)}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {loading ? (
        <span className="text-xs text-geo-muted py-2">Loading columns…</span>
      ) : columns.length === 0 ? (
        <span className="text-xs text-geo-muted py-2">No attribute columns.</span>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
          {columns.map((c, i) => (
            <label key={c.name} className="flex items-center gap-2 text-xs">
              <span className="w-20 truncate text-geo-muted" title={`${c.name} (${c.type})`}>
                {c.name}
              </span>
              <input
                autoFocus={i === 0}
                className="flex-1 min-w-0 bg-geo-bg border border-geo-border rounded px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-geo-accent"
                value={values[c.name] ?? ''}
                placeholder="NA"
                onChange={(e) => setValues((v) => ({ ...v, [c.name]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleSave()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setPrompt(null)
                  }
                }}
              />
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <label
          className="flex items-center gap-1.5 text-[10px] text-geo-muted hover:text-foreground cursor-pointer"
          title="Don't show this popup again until you save your edits — the map keeps focus so Enter keeps adding features"
        >
          <input
            type="checkbox"
            className="accent-[#4493f8]"
            checked={false}
            onChange={snoozeUntilSave}
          />
          Ignore until next save
        </label>
        <div className="flex gap-1.5">
          <button
            className="px-2 py-1 text-xs rounded border border-geo-border text-foreground hover:bg-geo-bg"
            onClick={() => setPrompt(null)}
            disabled={saving}
          >
            Skip
          </button>
          <button
            className="px-2 py-1 text-xs rounded border border-geo-accent bg-geo-accent/10 text-geo-accent hover:bg-geo-accent/20 flex items-center gap-1"
            onClick={() => void handleSave()}
            disabled={saving || loading}
          >
            <Check className="w-3 h-3" />
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
