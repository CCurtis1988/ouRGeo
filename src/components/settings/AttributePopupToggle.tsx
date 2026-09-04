import React from 'react'
import { useSpatialSettingsStore } from '@/store/spatialSettings'
import { saveSpatialSettings } from '@/lib/spatial-settings-persistence'
import { Switch } from '../ui/switch'

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
    <Switch
      checked={showAttributePopup}
      onChange={toggle}
      label="Attribute popup for new features"
      description={
        <>
          After drawing a new feature&apos;s geometry, pop up a small form to fill
          its attribute values. When off, drawing continues uninterrupted and
          values are entered in the data editor.
        </>
      }
    />
  )
}
