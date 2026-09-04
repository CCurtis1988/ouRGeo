import { create } from 'zustand'
import type { ViewState } from './geometryEdit'

export type InitialExtentMode = 'world' | 'user'

export interface UserExtent {
  minLng: number
  maxLng: number
  minLat: number
  maxLat: number
}

export const DEFAULT_USER_EXTENT: UserExtent = {
  minLng: -180,
  maxLng: 180,
  minLat: -90,
  maxLat: 90
}

/** Which geometry parts the snapping engine locks onto, and within how many pixels. */
export interface SnapSettings {
  kinds: {
    vertex: boolean
    edge: boolean
    midpoint: boolean
    intersection: boolean
  }
  tolerancePx: number
}

/** Which map-code generator the export dialogs last used. */
export type ExportCodeMode = 'tmap' | 'ggplot'

/**
 * What "send this object to the map" does when there is more than one map.
 *
 * `ask` is the default because the wrong answer is invisible: the layer lands
 * on a map the user is not looking at, reports success, and looks exactly like
 * nothing having happened. `last` is for anyone who has settled into using one
 * of the two maps and does not want a dialog every time.
 */
export type MapTargetMode = 'ask' | 'last'

export const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  kinds: { vertex: true, edge: true, midpoint: true, intersection: true },
  tolerancePx: 15
}

interface SpatialSettingsState {
  initialExtentMode: InitialExtentMode
  userExtent: UserExtent
  snapSettings: SnapSettings
  /** Show the attribute popup after drawing a new feature's geometry (persisted; the popup's "ignore until next save" checkbox snoozes it transiently). */
  showAttributePopup: boolean
  /**
   * Default calculation CRS for spatial tools that need planar math (buffer,
   * overlays, centroid, simplify). 'auto' = detect per input in R (UTM zone
   * from the dataset centroid; projected input passes through unchanged);
   * otherwise an EPSG code / CRS string.
   */
  calcCrs: string
  /** Default CRS (EPSG code / CRS string) for sf geometry created in ouRGeo. */
  defaultCrs: string
  /**
   * Which "Export to …" code dialog the user opened last. Read by the R
   * Markdown map chunk when its engine setting is 'auto', so the chunk it
   * inserts matches the flavour of code the user has been working in.
   */
  lastExportMode: ExportCodeMode
  /** Where a sent object goes when the workspace has two Spatial Editors.
   *  Ignored when there is only one — there is nothing to ask about. */
  mapTarget: MapTargetMode
  setInitialExtentMode: (mode: InitialExtentMode) => void
  setUserExtent: (extent: UserExtent) => void
  setSnapSettings: (s: SnapSettings) => void
  setShowAttributePopup: (v: boolean) => void
  setCalcCrs: (v: string) => void
  setDefaultCrs: (v: string) => void
  setLastExportMode: (v: ExportCodeMode) => void
  setMapTarget: (v: MapTargetMode) => void
}

export const useSpatialSettingsStore = create<SpatialSettingsState>((set) => ({
  initialExtentMode: 'world',
  userExtent: DEFAULT_USER_EXTENT,
  snapSettings: DEFAULT_SNAP_SETTINGS,
  showAttributePopup: true,
  calcCrs: 'auto',
  defaultCrs: '4326',
  lastExportMode: 'tmap',
  mapTarget: 'ask',
  setInitialExtentMode: (initialExtentMode) => set({ initialExtentMode }),
  setUserExtent: (userExtent) => set({ userExtent }),
  setSnapSettings: (snapSettings) => set({ snapSettings }),
  setShowAttributePopup: (showAttributePopup) => set({ showAttributePopup }),
  setCalcCrs: (calcCrs) => set({ calcCrs }),
  setDefaultCrs: (defaultCrs) => set({ defaultCrs }),
  setLastExportMode: (lastExportMode) => set({ lastExportMode }),
  setMapTarget: (mapTarget) => set({ mapTarget })
}))

export function computeInitialViewState(mode: InitialExtentMode, userExtent: UserExtent): ViewState {
  if (mode === 'world') return { longitude: 0, latitude: 20, zoom: 2 }
  const longitude = (userExtent.minLng + userExtent.maxLng) / 2
  const latitude = (userExtent.minLat + userExtent.maxLat) / 2
  const lngSpan = userExtent.maxLng - userExtent.minLng
  const latSpan = userExtent.maxLat - userExtent.minLat
  const zoom = Math.max(0, Math.min(18, Math.floor(Math.log2(360 / Math.max(lngSpan, latSpan * 2)))))
  return { longitude, latitude, zoom }
}
