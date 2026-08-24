import React from 'react'
import { useSpatialSettingsStore } from '@/store/spatialSettings'
import { saveSpatialSettings } from '@/lib/spatial-settings-persistence'

/** Settings toggle: show/hide the attribute popup after drawing a new feature. */
export function AttributePopupToggle(): React.ReactElement {
  const showAttributePopup = useSpatialSettingsStore((s) => s.showAttributePopup)
  const setShowAttributePopup = useSpatialSettingsStore((s) => s.setShowAttributePopup)
  const mode = useSpatialSettingsStore((s) => s.initialExtentMode)
  const userExtent = useSpatialSettingsStore((s) => s.userExtent)

  const toggle = (next: boolean) => {
    setShowAttributePopup(next)
    void saveSpatialSettings(mode, userExtent, undefined, next)
  }

  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        className="accent-[#4493f8] mt-0.5"
        checked={showAttributePopup}
        onChange={(e) => toggle(e.target.checked)}
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-xs text-foreground">Attribute popup for new features</span>
        <span className="text-[10px] text-geo-muted">
          After drawing a new feature's geometry, pop up a small form to fill its
          attribute values. When off, drawing continues uninterrupted and values
          are entered in the data editor.
        </span>
      </span>
    </label>
  )
}
