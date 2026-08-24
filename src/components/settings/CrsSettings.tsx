import React from 'react'
import { useSpatialSettingsStore } from '@/store/spatialSettings'
import { saveSpatialSettings } from '@/lib/spatial-settings-persistence'
import { CALC_CRS_CHOICES } from '@/lib/calc-crs'

const CUSTOM = 'custom'

/**
 * Settings → Spatial Editor → CRS defaults:
 * - Calculation CRS: what planar spatial tools (buffer, overlays, centroid,
 *   simplify) compute in. Auto-detect (default) resolves per dataset at run
 *   time — UTM zone from the data's centroid; projected data unchanged.
 * - Default CRS for new geometry: seeds the CRS of sf columns created by
 *   the data-creation dialogs.
 */
export function CrsSettings(): React.ReactElement {
  const calcCrs = useSpatialSettingsStore((s) => s.calcCrs)
  const defaultCrs = useSpatialSettingsStore((s) => s.defaultCrs)
  const setCalcCrs = useSpatialSettingsStore((s) => s.setCalcCrs)
  const setDefaultCrs = useSpatialSettingsStore((s) => s.setDefaultCrs)
  const mode = useSpatialSettingsStore((s) => s.initialExtentMode)
  const userExtent = useSpatialSettingsStore((s) => s.userExtent)

  const isCurated = CALC_CRS_CHOICES.some((c) => c.value === calcCrs)
  const selectValue = isCurated ? calcCrs : CUSTOM

  const persist = () => void saveSpatialSettings(mode, userExtent)

  const updateCalcCrs = (v: string) => {
    setCalcCrs(v)
    // setState is synchronous; saveSpatialSettings reads the store
    persist()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-geo-muted">Default calculation CRS (spatial tools)</label>
        <select
          className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent"
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value
            if (v === CUSTOM) {
              // Keep the current custom value if any, else start blank-ish
              if (isCurated) updateCalcCrs('')
            } else {
              updateCalcCrs(v)
            }
          }}
        >
          {CALC_CRS_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
          <option value={CUSTOM}>Custom EPSG…</option>
        </select>
        {selectValue === CUSTOM && (
          <input
            className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent"
            placeholder="EPSG code or CRS string, e.g. 32610"
            value={isCurated ? '' : calcCrs}
            onChange={(e) => setCalcCrs(e.target.value)}
            onBlur={persist}
          />
        )}
        <span className="text-[10px] text-geo-muted">
          Buffer, overlay, centroid and simplify tools transform into this CRS,
          compute (exact curved results via sfarc), and transform back.
          Auto-detect picks the UTM zone from each dataset's centroid; already
          projected data is used as-is. Tools can override per run.
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-geo-muted">Default CRS for new geometry</label>
        <input
          className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent w-40"
          placeholder="e.g. 4326"
          value={defaultCrs}
          onChange={(e) => setDefaultCrs(e.target.value)}
          onBlur={() => {
            if (!defaultCrs.trim()) setDefaultCrs('4326')
            persist()
          }}
        />
        <span className="text-[10px] text-geo-muted">
          Used as the CRS (projected or geographic) of sf geometry columns
          created in ouRGeo's data dialogs.
        </span>
      </div>
    </div>
  )
}
