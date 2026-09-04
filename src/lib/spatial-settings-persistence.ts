import type {
  InitialExtentMode, UserExtent, SnapSettings, ExportCodeMode, MapTargetMode
} from '@/store/spatialSettings'
import {
  DEFAULT_USER_EXTENT,
  DEFAULT_SNAP_SETTINGS,
  useSpatialSettingsStore
} from '@/store/spatialSettings'
import { createJsonFileStore } from '@/lib/persistence'

const store = createJsonFileStore('spatial-settings.json', 'SpatialSettings')

export async function loadSpatialSettings(): Promise<{
  mode: InitialExtentMode
  userExtent: UserExtent
  snapSettings: SnapSettings
  showAttributePopup: boolean
  calcCrs: string
  defaultCrs: string
  lastExportMode: ExportCodeMode
  mapTarget: MapTargetMode
}> {
  const data = await store.read<{
    initialExtentMode?: unknown
    showAttributePopup?: unknown
    newFeatureAttributeMode?: unknown // legacy key, replaced by showAttributePopup
    calcCrs?: unknown
    defaultCrs?: unknown
    lastExportMode?: unknown
    mapTarget?: unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    userExtent?: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snapSettings?: any
  }>()
  const mode: InitialExtentMode = data.initialExtentMode === 'user' ? 'user' : 'world'
  const ue = data.userExtent
  const userExtent: UserExtent =
    ue &&
    typeof ue.minLng === 'number' &&
    typeof ue.maxLng === 'number' &&
    typeof ue.minLat === 'number' &&
    typeof ue.maxLat === 'number'
      ? { minLng: ue.minLng, maxLng: ue.maxLng, minLat: ue.minLat, maxLat: ue.maxLat }
      : DEFAULT_USER_EXTENT
  const ss = data.snapSettings
  const snapSettings: SnapSettings =
    ss && typeof ss.tolerancePx === 'number' && ss.kinds
      ? {
          tolerancePx: Math.max(2, Math.min(50, ss.tolerancePx)),
          kinds: {
            vertex: ss.kinds.vertex !== false,
            edge: ss.kinds.edge !== false,
            midpoint: ss.kinds.midpoint !== false,
            intersection: ss.kinds.intersection !== false
          }
        }
      : DEFAULT_SNAP_SETTINGS
  const showAttributePopup =
    data.showAttributePopup === false || data.newFeatureAttributeMode === 'grid' ? false : true
  const calcCrs =
    typeof data.calcCrs === 'string' && data.calcCrs.trim() ? data.calcCrs.trim() : 'auto'
  const defaultCrs =
    typeof data.defaultCrs === 'string' && data.defaultCrs.trim() ? data.defaultCrs.trim() : '4326'
  const lastExportMode: ExportCodeMode = data.lastExportMode === 'ggplot' ? 'ggplot' : 'tmap'
  const mapTarget: MapTargetMode = data.mapTarget === 'last' ? 'last' : 'ask'
  return {
    mode, userExtent, snapSettings, showAttributePopup, calcCrs, defaultCrs, lastExportMode,
    mapTarget
  }
}

export async function saveSpatialSettings(
  mode: InitialExtentMode,
  userExtent: UserExtent,
  snapSettings?: SnapSettings,
  showAttributePopup?: boolean
): Promise<void> {
  const state = useSpatialSettingsStore.getState()
  await store.write({
    initialExtentMode: mode,
    userExtent,
    snapSettings: snapSettings ?? state.snapSettings,
    showAttributePopup: showAttributePopup ?? state.showAttributePopup,
    calcCrs: state.calcCrs,
    defaultCrs: state.defaultCrs,
    lastExportMode: state.lastExportMode,
    mapTarget: state.mapTarget
  })
}
