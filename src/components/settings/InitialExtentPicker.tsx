import React from 'react'
import { useSpatialSettingsStore } from '@/store/spatialSettings'
import type { UserExtent } from '@/store/spatialSettings'
import { saveSpatialSettings } from '@/lib/spatial-settings-persistence'
import { cn } from '@/lib/utils'

export function InitialExtentPicker(): React.ReactElement {
  const mode = useSpatialSettingsStore((s) => s.initialExtentMode)
  const userExtent = useSpatialSettingsStore((s) => s.userExtent)
  const setMode = useSpatialSettingsStore((s) => s.setInitialExtentMode)
  const setUserExtent = useSpatialSettingsStore((s) => s.setUserExtent)

  const handleModeChange = (next: 'world' | 'user') => {
    setMode(next)
    saveSpatialSettings(next, userExtent)
  }

  const handleExtentChange = (field: keyof UserExtent, raw: string) => {
    const value = parseFloat(raw)
    if (!Number.isFinite(value)) return
    const clamped =
      field === 'minLat' || field === 'maxLat'
        ? Math.max(-90, Math.min(90, value))
        : Math.max(-180, Math.min(180, value))
    const next = { ...userExtent, [field]: clamped }
    setUserExtent(next)
    saveSpatialSettings(mode, next)
  }

  return (
    <div className="space-y-3">
      {/* Mode buttons */}
      <div className="flex gap-2">
        {(['world', 'user'] as const).map((opt) => (
          <button
            key={opt}
            onClick={() => handleModeChange(opt)}
            className={cn(
              'flex-1 py-1.5 text-xs rounded border transition-colors',
              mode === opt
                ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                : 'border-geo-border text-geo-muted hover:text-foreground hover:border-geo-muted'
            )}
          >
            {opt === 'world' ? 'World' : 'User Definable'}
          </button>
        ))}
      </div>

      {/* Bound inputs — only shown in user mode */}
      {mode === 'user' && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {(
            [
              { field: 'minLat', label: 'Min Latitude', min: -90, max: 90 },
              { field: 'maxLat', label: 'Max Latitude', min: -90, max: 90 },
              { field: 'minLng', label: 'Min Longitude', min: -180, max: 180 },
              { field: 'maxLng', label: 'Max Longitude', min: -180, max: 180 },
            ] as { field: keyof UserExtent; label: string; min: number; max: number }[]
          ).map(({ field, label, min, max }) => (
            <div key={field} className="flex flex-col gap-0.5">
              <label className="text-xs text-geo-muted">{label}</label>
              <input
                type="number"
                step="0.1"
                min={min}
                max={max}
                defaultValue={userExtent[field]}
                key={`${field}-${userExtent[field]}`}
                onBlur={(e) => handleExtentChange(field, e.target.value)}
                className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
