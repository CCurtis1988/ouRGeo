// The Spatial Editor.
//
// The largest group, because the map is where ouRGeo's GUI actually earns its
// keep: a layer is a *view* onto an R object, and symbology, labels, legend and
// north arrow are settings on that view rather than properties of the data. All
// of it lives in the spatial store, so all of it is drivable — and none of it
// can be reached with `execute_r_code`, which is exactly why these actions
// exist.
//
// `map:exportCode` is the payoff: the same generators the Export dialogs use,
// run against the same live snapshot, so "make me a map of this" produces the
// R the user would have got by clicking Export.

import { useSpatialStore, type SpatialLayer, type LayerSymbology } from '@/store/spatial'
import { useBasemapStore } from '@/store/basemap'
import { useSessionStore } from '@/store/session'
import { useSelectionStore } from '@/store/selection'
import { useEditorStore } from '@/store/editor'
import { rClient } from '@/lib/r-client'
import { addSpatialLayer, computeBbox, type SpatialObjectRef } from '@/lib/add-spatial-layer'
import { generateMapCode, hasVisibleLayers, lastExportEngine, type MapEngine } from '@/lib/map-export'
import { getEffectiveSym, getLayerDataColumns } from '@/lib/layer-symbology'
import { createRasterLayerInfo } from '@/lib/raster-layers'
import { RASTER_RAMPS } from '@/lib/raster-layers'
import { ALL_SCALE_KEYS } from '@/lib/color-scales'
import { BASEMAPS_BY_ID, FREE_BASEMAPS } from '@/lib/basemaps'
import { DEFAULT_LABEL_SETTINGS } from '@/lib/label-utils'
import { layerExtentBbox } from '@/lib/layer-bbox'
import { mapView, setMapView } from '@/lib/map-view'
import { useLayoutStore } from '@/store/layout'
import { useGeometryEditStore } from '@/store/geometryEdit'
import { mapPanels } from '@/lib/panel-content'
import { panelInfo, resolvePanelName } from '@/lib/layout/panel-meta'
import {
  isTransportFailure, retryOnNetworkError, transportFailureForModel,
} from '@/lib/transport-retry'
import {
  ok, fail, argStr, argNum, argNumOrNull, argBool, argBbox, argList, argNumList,
  type UiAction, type ActionResult, type Args,
} from './types'

// ── Layer lookup ───────────────────────────────────────────────────────────

function layers(): SpatialLayer[] {
  return useSpatialStore.getState().layers
}

function layerListing(): string {
  const ls = layers()
  return ls.length > 0 ? ls.map((l) => `"${l.name}"`).join(', ') : '(no layers on the map)'
}

/** By name first — that is what a user says — then by id. */
function findLayer(ref: string): SpatialLayer | null {
  const want = ref.trim()
  if (!want) return null
  const ls = layers()
  return ls.find((l) => l.name === want)
    ?? ls.find((l) => l.id === want)
    ?? ls.find((l) => l.name.toLowerCase() === want.toLowerCase())
    ?? null
}

const isResult = (v: unknown): v is ActionResult =>
  typeof v === 'object' && v !== null && 'ok' in v && 'message' in v

function requireLayer(args: Args, key = 'layer'): SpatialLayer | ActionResult {
  const ref = argStr(args, key)
  if (!ref) {
    // The selected layer is a reasonable default: it is the one the ribbon acts on.
    const selected = useSpatialStore.getState().selectedLayerId
    const sel = selected ? layers().find((l) => l.id === selected) : undefined
    if (sel) return sel
    return fail(`Which layer? On the map: ${layerListing()}.`)
  }
  const layer = findLayer(ref)
  return layer ?? fail(`No layer called "${ref}". On the map: ${layerListing()}.`)
}

export const mapActions: UiAction[] = [
  {
    id: 'map:status',
    group: 'map',
    tier: 'always',
    summary: 'What is on the map: layers, symbology, view, basemap, legend and north arrow.',
    params: [],
    run: () => {
      const s = useSpatialStore.getState()
      if (!s.isOpen) return ok('The Spatial Editor is closed. Open it with ui:panel(panel=spatial).')
      const lines: string[] = []
      lines.push(s.layers.length === 0
        ? 'No layers on the map.'
        : `${s.layers.length} layer(s), drawn bottom to top:`)
      for (const l of s.layers) {
        const bits = [`"${l.name}"`, l.kind === 'raster' ? 'raster' : l.geometryType]
        if (!l.visible) bits.push('hidden')
        if (l.id === s.selectedLayerId) bits.push('selected')
        if (l.labelSettings?.enabled) bits.push(`labelled by ${l.labelSettings.field}`)
        if (l.kind !== 'raster') {
          const sym = getEffectiveSym(l)
          bits.push(sym.fillColorBinding
            ? `coloured by ${sym.fillColorBinding.column} (${sym.fillColorBinding.scale})`
            : `fill ${sym.fillColor}`)
        }
        lines.push(`  ${bits.join(', ')}`)
      }
      const basemapId = useBasemapStore.getState().overrideBasemapId
      lines.push(`View: ${s.viewState.latitude.toFixed(4)}, ${s.viewState.longitude.toFixed(4)} at zoom ${s.viewState.zoom.toFixed(1)}.`)
      lines.push(`Basemap: ${basemapId ? BASEMAPS_BY_ID[basemapId]?.name ?? basemapId : 'the theme default'}.`)
      lines.push(`Legend ${s.showLegend ? 'on' : 'off'}; north arrow ${s.showNorthArrow ? 'on' : 'off'}.`)
      return ok(lines.join('\n'))
    },
  },

  {
    id: 'map:listObjects',
    group: 'map',
    tier: 'always',
    summary: 'List the spatial objects in R that could be added to the map (sf, sfc, SpatRaster).',
    params: [],
    run: async () => {
      const res = await rClient.listSpatialObjects()
      if (!res.success) return fail('Could not list spatial objects from R.')
      useSpatialStore.getState().setAvailableObjects(res.objects)
      if (res.objects.length === 0) {
        return ok('No spatial objects in the R session yet. Import one with data:load, or read one in R.')
      }
      const lines = res.objects.map((o) =>
        `${o.name} (${o.class}${o.geometryType ? `, ${o.geometryType}` : ''}` +
        `${o.nFeatures ? `, ${o.nFeatures} features` : ''}${o.crs ? `, ${o.crs}` : ''})`)
      return ok(`Spatial objects in R:\n${lines.join('\n')}`)
    },
  },

  {
    id: 'map:addLayer',
    group: 'map',
    tier: 'autopilot',
    summary: 'Add an R spatial object to the map — the Add Features dialog, for one object.',
    params: [
      { name: 'object', type: 'string', required: true, description: 'Name of the sf / sfc / SpatRaster object.' },
      { name: 'env', type: 'string', default: '.GlobalEnv', description: 'Environment it lives in.' },
      { name: 'zoomTo', type: 'boolean', default: true, description: 'Zoom the map to the new layer.' },
      {
        name: 'map', type: 'enum', valuesAt: () => mapPanels(useLayoutStore.getState().layout),
        lenient: true,
        description:
          'Which Spatial Editor, when the workspace has more than one. Omit for the map the user '
          + 'last worked in.',
      },
    ],
    run: async (args) => {
      const name = argStr(args, 'object')
      if (!name) return fail('object is required.')
      const listed = await retryOnNetworkError(() => rClient.listSpatialObjects())
      const known = listed.success ? listed.objects : []
      const obj = known.find((o) => o.name === name && (!argStr(args, 'env') || o.envName === argStr(args, 'env')))
        ?? known.find((o) => o.name === name)
      if (!obj) {
        return fail(`"${name}" is not a spatial object in R. Available: ` +
          `${known.map((o) => o.name).join(', ') || '(none)'}.`)
      }
      const spatial = useSpatialStore.getState()
      spatial.ensureOpen()
      // Which map. The assistant is told rather than asked: a modal raised in
      // the middle of a tool call would block the answer it is composing, and
      // the honest fallback — the map the user last worked in — is the same
      // one the "last used" setting picks.
      const maps = mapPanels(useLayoutStore.getState().layout)
      const wanted = argStr(args, 'map')
      const target = wanted
        ? maps.find((p) => p === resolvePanelName(wanted)?.id)
        : useGeometryEditStore.getState().focusedSpatialPanel
      if (wanted && !target) {
        return fail(`No Spatial Editor called "${wanted}". Maps: ${maps.join(', ')}.`)
      }
      const where = maps.length > 1 ? ` on ${panelInfo(target!)?.label ?? target}` : ''
      try {
        const added = await addSpatialLayer(obj as SpatialObjectRef, target)
        if (argBool(args, 'zoomTo', true) && added.bbox) {
          useSpatialStore.getState().fitMapToBbox(added.bbox, target)
        }
        return ok(`Added "${added.name}"${where} as a ${added.kind} layer` +
          `${added.bbox ? ` and zoomed to it` : ''}.`)
      } catch (e) {
        if (isTransportFailure(e)) {
          return fail(transportFailureForModel(`adding "${name}" to the map`, `"${name}"`))
        }
        return fail(`Could not add "${name}": ${e instanceof Error ? e.message : String(e)}`)
      }
    },
  },

  {
    id: 'map:removeLayer',
    group: 'map',
    tier: 'autopilot',
    summary: 'Take a layer off the map. The R object it views is untouched.',
    params: [{ name: 'layer', type: 'string', required: true, description: 'Layer name or id.' }],
    run: (args) => {
      const layer = requireLayer(args)
      if (isResult(layer)) return layer
      useSpatialStore.getState().removeLayer(layer.id)
      return ok(`Removed "${layer.name}" from the map. The R object \`${layer.name}\` still exists.`)
    },
  },

  {
    id: 'map:setLayerVisible',
    group: 'map',
    tier: 'always',
    summary: 'Show or hide a layer.',
    params: [
      { name: 'layer', type: 'string', required: true, description: 'Layer name or id.' },
      { name: 'visible', type: 'boolean', required: true, description: 'Whether it is drawn.' },
    ],
    run: (args) => {
      const layer = requireLayer(args)
      if (isResult(layer)) return layer
      const want = argBool(args, 'visible', true)
      if (layer.visible !== want) useSpatialStore.getState().toggleLayerVisibility(layer.id)
      return ok(`"${layer.name}" is now ${want ? 'visible' : 'hidden'}.`)
    },
  },

  {
    id: 'map:setLayerOpacity',
    group: 'map',
    tier: 'always',
    summary: 'Set a layer\'s overall opacity.',
    params: [
      { name: 'layer', type: 'string', required: true, description: 'Layer name or id.' },
      { name: 'opacity', type: 'number', required: true, description: '0 (invisible) to 1 (solid).' },
    ],
    run: (args) => {
      const layer = requireLayer(args)
      if (isResult(layer)) return layer
      const opacity = Math.max(0, Math.min(1, argNum(args, 'opacity', 1)))
      useSpatialStore.getState().setLayerOpacity(layer.id, opacity)
      return ok(`"${layer.name}" opacity is now ${opacity}.`)
    },
  },

  {
    id: 'map:reorderLayers',
    group: 'map',
    tier: 'always',
    summary: 'Set the drawing order. Give every layer name, bottom of the list drawn on top.',
    params: [
      { name: 'order', type: 'strings', required: true, description: 'Layer names in the order they should appear in the Contents list.' },
    ],
    run: (args) => {
      const names = argList(args, 'order')
      const ids: string[] = []
      for (const n of names) {
        const l = findLayer(n)
        if (!l) return fail(`No layer called "${n}". On the map: ${layerListing()}.`)
        ids.push(l.id)
      }
      const all = layers()
      if (ids.length !== all.length) {
        return fail(`Give every layer: the map has ${all.length} (${layerListing()}), you listed ${ids.length}.`)
      }
      useSpatialStore.getState().reorderLayers(ids)
      return ok(`Layer order is now: ${names.join(', ')}.`)
    },
  },

  {
    id: 'map:selectLayer',
    group: 'map',
    tier: 'always',
    summary: 'Make a layer the selected one, which is what the ribbon buttons act on.',
    params: [{ name: 'layer', type: 'string', required: true, description: 'Layer name or id.' }],
    run: (args) => {
      const layer = requireLayer(args)
      if (isResult(layer)) return layer
      useSpatialStore.getState().setSelectedLayerId(layer.id)
      return ok(`"${layer.name}" is selected.`)
    },
  },

  {
    id: 'map:listColumns',
    group: 'map',
    tier: 'always',
    summary: 'Columns available on a vector layer, with numeric/categorical type — what you can colour or label by.',
    params: [{ name: 'layer', type: 'string', required: true, description: 'Layer name or id.' }],
    run: (args) => {
      const layer = requireLayer(args)
      if (isResult(layer)) return layer
      if (layer.kind === 'raster') return fail(`"${layer.name}" is a raster; it has bands, not columns. Use map:rasterInfo.`)
      const cols = getLayerDataColumns(layer)
      return cols.length > 0
        ? ok(`"${layer.name}" columns: ${cols.map((c) => `${c.name} (${c.type})`).join(', ')}.`)
        : ok(`"${layer.name}" carries no attribute columns.`)
    },
  },

  {
    id: 'map:setSymbology',
    group: 'map',
    tier: 'autopilot',
    summary:
      'Style a vector layer. Pass only what you want to change; pass colorBy to colour features ' +
      'by a column instead of a single colour.',
    params: [
      { name: 'layer', type: 'string', required: true, description: 'Layer name or id.' },
      { name: 'fillColor', type: 'string', description: 'Hex colour for fills and points.' },
      { name: 'fillOpacity', type: 'number', description: '0 to 1.' },
      { name: 'borderColor', type: 'string', description: 'Hex colour for outlines.' },
      { name: 'borderWidth', type: 'number', description: 'Outline width in px.' },
      { name: 'pointSize', type: 'number', description: 'Point radius in px.' },
      {
        name: 'pointShape', type: 'enum',
        values: ['circle', 'square', 'triangle', 'diamond', 'star', 'cross'],
        description: 'Marker shape.',
      },
      { name: 'lineWidth', type: 'number', description: 'Line width in px.' },
      {
        name: 'lineDash', type: 'enum', values: ['solid', 'dashed', 'dotted', 'dash-dot'],
        description: 'Line pattern.',
      },
      { name: 'colorBy', type: 'string', description: 'Column to colour by. Pass "" to go back to one colour.' },
      {
        name: 'scale', type: 'string', default: 'viridis',
        description: `Colour scale for colorBy. One of: ${ALL_SCALE_KEYS.join(', ')}.`,
      },
    ],
    run: (args) => {
      const layer = requireLayer(args)
      if (isResult(layer)) return layer
      if (layer.kind === 'raster') {
        return fail(`"${layer.name}" is a raster — use map:setRasterSymbology.`)
      }
      const sym: LayerSymbology = { ...getEffectiveSym(layer) }
      const changed: string[] = []
      const setIf = (key: keyof LayerSymbology, arg: string, kind: 'string' | 'number'): void => {
        if (!(arg in args)) return
        const v = kind === 'number' ? argNum(args, arg, 0) : argStr(args, arg)
        ;(sym[key] as unknown) = v
        changed.push(arg)
      }
      setIf('fillColor', 'fillColor', 'string')
      setIf('fillOpacity', 'fillOpacity', 'number')
      setIf('borderColor', 'borderColor', 'string')
      setIf('borderWidth', 'borderWidth', 'number')
      setIf('pointSize', 'pointSize', 'number')
      setIf('pointShape', 'pointShape', 'string')
      setIf('lineWidth', 'lineWidth', 'number')
      setIf('lineDash', 'lineDash', 'string')

      if ('colorBy' in args) {
        const column = argStr(args, 'colorBy')
        if (!column) {
          delete sym.fillColorBinding
          changed.push('colour binding removed')
        } else {
          const cols = getLayerDataColumns(layer)
          const col = cols.find((c) => c.name === column)
          if (!col) {
            return fail(`"${layer.name}" has no column "${column}". Columns: ` +
              `${cols.map((c) => c.name).join(', ') || '(none)'}.`)
          }
          const scale = argStr(args, 'scale', 'viridis') || 'viridis'
          sym.fillColorBinding = { column, type: col.type, scale }
          changed.push(`coloured by ${column} (${col.type}, ${scale})`)
        }
      }
      if (changed.length === 0) return fail('Nothing to change — pass at least one style property.')
      useSpatialStore.getState().updateLayerSymbology(layer.id, sym)
      return ok(`Restyled "${layer.name}": ${changed.join(', ')}.`)
    },
  },

  {
    id: 'map:rasterInfo',
    group: 'map',
    tier: 'always',
    summary: 'Band statistics, dimensions and CRS of a raster layer or R SpatRaster.',
    params: [
      { name: 'object', type: 'string', required: true, description: 'Layer name, or the R object name.' },
      { name: 'env', type: 'string', default: '.GlobalEnv', description: 'Environment, when naming an R object.' },
    ],
    run: async (args) => {
      const name = argStr(args, 'object')
      const layer = findLayer(name)
      const objName = layer?.name ?? name
      const env = layer?.envName ?? (argStr(args, 'env') || '.GlobalEnv')
      const m = await rClient.rasterInfo(objName, env)
      if (!m.success) return fail(m.error ?? `Could not read raster info for "${objName}".`)
      const bands = m.bands.map((b) =>
        `  band ${b.index} "${b.name}": min ${b.min}, max ${b.max}, mean ${b.mean.toFixed(3)}`)
      return ok([
        `${objName}: ${m.ncol}×${m.nrow}, ${m.nbands} band(s), ${m.dtype}, CRS ${m.crs ?? 'unset'}.`,
        ...bands,
      ].join('\n'))
    },
  },

  {
    id: 'map:setRasterSymbology',
    group: 'map',
    tier: 'autopilot',
    summary: 'Style a raster layer: band, stretch and colour ramp. Re-registers the tiles.',
    params: [
      { name: 'layer', type: 'string', required: true, description: 'Layer name or id.' },
      {
        name: 'mode', type: 'enum', values: ['singleband', 'rgb', 'categorical'],
        description: 'How to render it.',
      },
      { name: 'bands', type: 'numbers', description: '1-based band numbers: one for singleband, three for rgb.' },
      {
        name: 'stretch', type: 'enum', values: ['minmax', 'percent', 'stddev', 'custom'],
        description: 'How values map to colours.',
      },
      { name: 'min', type: 'number', description: 'Low end, for stretch=custom.' },
      { name: 'max', type: 'number', description: 'High end, for stretch=custom.' },
      { name: 'ramp', type: 'string', description: `Colour ramp: ${Object.keys(RASTER_RAMPS).join(', ')}.` },
      { name: 'invert', type: 'boolean', description: 'Reverse the ramp.' },
    ],
    run: async (args) => {
      const layer = requireLayer(args)
      if (isResult(layer)) return layer
      if (layer.kind !== 'raster' || !layer.raster) {
        return fail(`"${layer.name}" is a vector layer — use map:setSymbology.`)
      }
      const cur = layer.raster.symbology
      const ramp = argStr(args, 'ramp') || cur.ramp
      if (!(ramp in RASTER_RAMPS)) {
        return fail(`Unknown ramp "${ramp}". Available: ${Object.keys(RASTER_RAMPS).join(', ')}.`)
      }
      const bands = argNumList(args, 'bands')
      const bandList = bands.length > 0 ? bands : cur.bands
      const customMin = argNumOrNull(args, 'min')
      const customMax = argNumOrNull(args, 'max')
      const next = {
        ...cur,
        mode: (argStr(args, 'mode') || cur.mode) as typeof cur.mode,
        bands: bandList,
        ramp,
        invertRamp: 'invert' in args ? argBool(args, 'invert') : cur.invertRamp,
        // A custom stretch is per band; a single min/max from the model applies
        // to every band it is styling.
        stretch: {
          ...cur.stretch,
          type: (argStr(args, 'stretch') || cur.stretch.type) as typeof cur.stretch.type,
          min: customMin !== null ? bandList.map(() => customMin) : cur.stretch.min,
          max: customMax !== null ? bandList.map(() => customMax) : cur.stretch.max,
        },
      }
      try {
        const info = await createRasterLayerInfo(layer.name, layer.envName, next)
        useSpatialStore.getState().updateRasterInfo(layer.id, info)
        return ok(`Restyled raster "${layer.name}" (${next.mode}, ${next.ramp}${next.invertRamp ? ' inverted' : ''}).`)
      } catch (e) {
        return fail(`Could not restyle "${layer.name}": ${e instanceof Error ? e.message : String(e)}`)
      }
    },
  },

  {
    id: 'map:setLabels',
    group: 'map',
    tier: 'autopilot',
    summary: 'Label a vector layer by one of its columns.',
    params: [
      { name: 'layer', type: 'string', required: true, description: 'Layer name or id.' },
      { name: 'column', type: 'string', description: 'Column to label with. Required when turning labels on.' },
      { name: 'enabled', type: 'boolean', default: true, description: 'Whether labels are drawn.' },
      { name: 'fontSize', type: 'number', description: 'Text size in px.' },
      { name: 'color', type: 'string', description: 'Hex text colour.' },
      { name: 'haloColor', type: 'string', description: 'Hex outline colour behind the text.' },
      {
        name: 'overlap', type: 'enum', values: ['never', 'cooperative', 'always'],
        description: 'What to do when labels collide.',
      },
    ],
    run: (args) => {
      const layer = requireLayer(args)
      if (isResult(layer)) return layer
      if (layer.kind === 'raster') return fail(`"${layer.name}" is a raster; rasters carry no labels.`)
      const enabled = argBool(args, 'enabled', true)
      const base = layer.labelSettings ?? DEFAULT_LABEL_SETTINGS
      const column = argStr(args, 'column') || base.field
      if (enabled && !column) {
        const cols = getLayerDataColumns(layer)
        return fail('Labels need a column. Columns on ' +
          `"${layer.name}": ${cols.map((c) => c.name).join(', ') || '(none)'}.`)
      }
      const next = {
        ...base,
        enabled,
        field: column,
        fontSize: argNum(args, 'fontSize', base.fontSize),
        color: argStr(args, 'color') || base.color,
        haloColor: argStr(args, 'haloColor') || base.haloColor,
        overlapStrategy: (argStr(args, 'overlap') || base.overlapStrategy) as typeof base.overlapStrategy,
      }
      useSpatialStore.getState().updateLabelSettings(layer.id, next)
      return ok(enabled
        ? `"${layer.name}" is now labelled by ${column}.`
        : `Labels turned off for "${layer.name}".`)
    },
  },

  {
    id: 'map:zoomTo',
    group: 'map',
    tier: 'always',
    summary: 'Zoom the map to a layer, to a bounding box, or to everything.',
    params: [
      { name: 'layer', type: 'string', description: 'Layer to zoom to.' },
      { name: 'bbox', type: 'numbers', description: '[west, south, east, north] in lon/lat.' },
      { name: 'all', type: 'boolean', description: 'Fit every visible layer.' },
    ],
    run: (args) => {
      const spatial = useSpatialStore.getState()
      if (argBool(args, 'all')) {
        if (!hasVisibleLayers()) return fail('There are no visible layers to fit.')
        spatial.requestFitBounds()
        return ok('Zoomed to fit every visible layer.')
      }
      const bbox = argBbox(args, 'bbox')
      if (bbox) {
        spatial.fitMapToBbox(bbox)
        return ok(`Zoomed to [${bbox.join(', ')}].`)
      }
      const ref = argStr(args, 'layer')
      if (!ref) return fail('Pass a layer, a bbox, or all=true.')
      const layer = findLayer(ref)
      if (!layer) return fail(`No layer called "${ref}". On the map: ${layerListing()}.`)
      const box = layer.kind === 'raster' && layer.raster
        ? layer.raster.bounds
        : layerExtentBbox(layer) ?? computeBbox(layer.geojson)
      if (!box) return fail(`"${layer.name}" has no extent to zoom to.`)
      spatial.fitMapToBbox(box)
      return ok(`Zoomed to "${layer.name}".`)
    },
  },

  {
    id: 'map:setView',
    group: 'map',
    tier: 'always',
    summary: 'Move the map to a specific centre and zoom.',
    params: [
      { name: 'longitude', type: 'number', required: true, description: 'Centre longitude.' },
      { name: 'latitude', type: 'number', required: true, description: 'Centre latitude.' },
      { name: 'zoom', type: 'number', description: 'Zoom level, 0 (world) to ~20 (street).' },
    ],
    run: (args) => {
      // Through `setMapView`, never `useSpatialStore.setViewState`: once any
      // layer is on the map the view belongs to the active named session, and
      // the spatial store is a mirror nothing renders from. See lib/map-view.ts.
      const current = mapView()
      const view = {
        longitude: argNum(args, 'longitude', current.longitude),
        latitude: argNum(args, 'latitude', current.latitude),
        zoom: argNum(args, 'zoom', current.zoom),
      }
      setMapView(view)
      const where = `Map centred on ${view.latitude.toFixed(4)}, ${view.longitude.toFixed(4)} at zoom ${view.zoom}.`
      // Moving a map nobody can see is the one way this still does nothing
      // visible, so say so rather than letting it read as a move that failed.
      return useSpatialStore.getState().isOpen
        ? ok(where)
        : ok(`${where} The Spatial Editor is closed, so it is not on screen — open it with ui:panel (panel=spatial).`)
    },
  },

  {
    id: 'map:listBasemaps',
    group: 'map',
    tier: 'always',
    summary: 'Basemaps that need no API key.',
    params: [],
    run: () => ok(`Key-free basemaps: ${FREE_BASEMAPS.map((b) => `${b.id} (${b.name})`).join(', ')}. ` +
      'Others need a provider key in Settings → Basemaps.'),
  },

  {
    id: 'map:setBasemap',
    group: 'map',
    tier: 'always',
    summary: 'Change the basemap. Pass "" to go back to the theme default.',
    params: [
      { name: 'basemap', type: 'string', required: true, description: 'Basemap id, or "" for the theme default.' },
    ],
    run: (args) => {
      const id = argStr(args, 'basemap')
      if (!id) {
        useBasemapStore.getState().setOverride(null)
        return ok('Basemap is back to the theme default.')
      }
      const def = BASEMAPS_BY_ID[id]
      if (!def) {
        return fail(`Unknown basemap "${id}". Key-free options: ${FREE_BASEMAPS.map((b) => b.id).join(', ')}.`)
      }
      useBasemapStore.getState().setOverride(id)
      return ok(`Basemap is now "${def.name}".`)
    },
  },

  {
    id: 'map:setLegend',
    group: 'map',
    tier: 'always',
    summary: 'Show, hide or reposition the legend. It carries through to exported code.',
    params: [
      { name: 'show', type: 'boolean', description: 'Whether the legend is drawn.' },
      {
        name: 'position', type: 'enum',
        values: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
        description: 'Corner it sits in.',
      },
      { name: 'title', type: 'string', description: 'Legend title.' },
    ],
    run: (args) => {
      const s = useSpatialStore.getState()
      const changed: string[] = []
      if ('show' in args) { s.setShowLegend(argBool(args, 'show', true)); changed.push('visibility') }
      if ('position' in args || 'title' in args) {
        s.setLegendSettings({
          ...s.legendSettings,
          position: (argStr(args, 'position') || s.legendSettings.position) as typeof s.legendSettings.position,
          title: 'title' in args ? argStr(args, 'title') : s.legendSettings.title,
        })
        changed.push('position/title')
      }
      if (changed.length === 0) return fail('Nothing to change — pass show, position or title.')
      return ok(`Legend updated (${changed.join(', ')}).`)
    },
  },

  {
    id: 'map:setNorthArrow',
    group: 'map',
    tier: 'always',
    summary: 'Show, hide or restyle the north arrow. It carries through to exported code.',
    params: [
      { name: 'show', type: 'boolean', description: 'Whether the arrow is drawn.' },
      {
        name: 'style', type: 'enum', values: ['split', 'simple', 'open', 'dot', 'compass'],
        description: 'Arrow style.',
      },
      {
        name: 'position', type: 'enum',
        values: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
        description: 'Corner it sits in.',
      },
    ],
    run: (args) => {
      const s = useSpatialStore.getState()
      const changed: string[] = []
      if ('show' in args) { s.setShowNorthArrow(argBool(args, 'show', true)); changed.push('visibility') }
      if ('style' in args || 'position' in args) {
        s.setNorthArrowSettings({
          ...s.northArrowSettings,
          style: (argStr(args, 'style') || s.northArrowSettings.style) as typeof s.northArrowSettings.style,
          position: (argStr(args, 'position') || s.northArrowSettings.position) as typeof s.northArrowSettings.position,
        })
        changed.push('style/position')
      }
      if (changed.length === 0) return fail('Nothing to change — pass show, style or position.')
      return ok(`North arrow updated (${changed.join(', ')}).`)
    },
  },

  {
    id: 'map:select',
    group: 'map',
    tier: 'autopilot',
    summary:
      'Select features on a layer with an R expression over its columns, the way the Select By ' +
      'Attributes dialog does. The selection scopes toolbox operations.',
    params: [
      { name: 'layer', type: 'string', required: true, description: 'Layer name or id.' },
      { name: 'where', type: 'string', required: true, description: 'R expression, e.g. `pop > 1e6 & region == "West"`.' },
    ],
    run: async (args) => {
      const layer = requireLayer(args)
      if (isResult(layer)) return layer
      const where = argStr(args, 'where')
      if (!where) return fail('where is required — an R expression over the layer\'s columns.')
      const code = `subset(${layer.name}, ${where})`
      const res = await rClient.selectionQuery({
        code: where, sourceName: layer.name, sourceEnv: layer.envName,
      })
      if (!res.success) return fail(res.error ?? 'The selection query failed.')
      useSessionStore.getState().addConsoleEntry('input', `# selection: ${code}`)
      useSelectionStore.getState().setSelection(layer.name, layer.envName, res.rowIndices)
      return ok(`Selected ${res.rowIndices.length} feature(s) on "${layer.name}" where ${where}.`)
    },
  },

  {
    id: 'map:clearSelection',
    group: 'map',
    tier: 'always',
    summary: 'Clear the feature selection.',
    params: [{ name: 'layer', type: 'string', description: 'Layer to clear; omit to clear everything.' }],
    run: (args) => {
      const ref = argStr(args, 'layer')
      if (!ref) {
        useSelectionStore.getState().clearAll()
        return ok('Cleared every feature selection.')
      }
      const layer = findLayer(ref)
      if (!layer) return fail(`No layer called "${ref}". On the map: ${layerListing()}.`)
      useSelectionStore.getState().clearSelection(layer.name, layer.envName)
      return ok(`Cleared the selection on "${layer.name}".`)
    },
  },

  {
    id: 'map:exportCode',
    group: 'map',
    tier: 'autopilot',
    summary:
      'Generate standalone R that reproduces the map on screen — the Export to tmap/ggplot ' +
      'dialogs. With run=true it also executes, so the figure lands in the Plots panel.',
    params: [
      {
        name: 'engine', type: 'enum', values: ['tmap', 'ggplot'],
        description: 'Which package to generate for; defaults to whichever Export dialog was used last.',
      },
      { name: 'run', type: 'boolean', default: false, description: 'Also run the code.' },
      { name: 'path', type: 'string', description: 'Write the figure to this file instead of drawing it.' },
      { name: 'width', type: 'number', default: 7, description: 'Figure width in inches, when writing a file.' },
      { name: 'height', type: 'number', default: 5, description: 'Figure height in inches, when writing a file.' },
      { name: 'dpi', type: 'number', default: 150, description: 'Resolution, when writing a file.' },
    ],
    run: async (args) => {
      if (!hasVisibleLayers()) {
        return fail('The map has no visible layers, so there is nothing to generate. ' +
          'Add one with map:addLayer first.')
      }
      const engine = (argStr(args, 'engine') || lastExportEngine()) as MapEngine
      if (!['tmap', 'ggplot'].includes(engine)) return fail('engine must be tmap or ggplot.')
      const path = argStr(args, 'path')
      const code = generateMapCode({
        engine,
        exportOpts: path
          ? {
              path,
              width: argNum(args, 'width', 7),
              height: argNum(args, 'height', 5),
              units: 'in',
              dpi: argNum(args, 'dpi', 150),
              format: (path.split('.').pop() ?? 'png') as 'png',
            }
          : undefined,
      })
      if (!code) return fail('The map produced no code — check that a layer is visible.')
      if (!argBool(args, 'run')) {
        return ok(`Generated ${engine} code for the current map (not run):\n\n${code}`)
      }
      const session = useSessionStore.getState()
      session.addConsoleEntry('input', code)
      session.addInputHistory(code)
      const res = await rClient.execute(code)
      if (res.output) session.addConsoleEntry('output', res.output)
      if (!res.success) {
        session.addConsoleEntry('error', res.error ?? '')
        return fail(`The generated ${engine} code errored: ${res.error ?? 'unknown error'}\n\n${code}`)
      }
      return ok(
        path
          ? `Wrote the map to ${path} with ${engine}.`
          : `Ran the ${engine} map — it is in the Plots panel.`,
        code,
      )
    },
  },

  {
    id: 'map:exportImage',
    group: 'map',
    tier: 'autopilot',
    summary: 'Save a picture of the map canvas exactly as it appears, including the basemap.',
    params: [
      { name: 'path', type: 'string', required: true, description: 'Absolute path ending .png.' },
      { name: 'scale', type: 'number', default: 2, description: 'Pixel multiplier for a higher-resolution capture.' },
    ],
    run: async (args) => {
      const path = argStr(args, 'path')
      if (!path) return fail('path is required.')
      const container = document.querySelector<HTMLDivElement>('[data-ourgeo-id="map.canvas"]')
      if (!container) {
        return fail('The map canvas is not on screen. Open the Spatial Editor with ui:panel first.')
      }
      const { captureMapContainer, dataUriToBase64 } = await import('@/lib/export-canvas')
      const rect = container.getBoundingClientRect()
      const scale = Math.max(1, argNum(args, 'scale', 2))
      const dataUri = await captureMapContainer(container, {
        widthPx: Math.round(rect.width * scale),
        heightPx: Math.round(rect.height * scale),
        dpi: 96 * scale,
        format: 'png',
        marginPx: 0,
      })
      if (!dataUri) return fail('Could not capture the map canvas.')
      await window.electronAPI.file.writeBinary(path, dataUriToBase64(dataUri))
      return ok(`Saved a picture of the map to ${path}.`)
    },
  },

  {
    id: 'map:identify',
    group: 'map',
    tier: 'always',
    summary: 'Read the attributes of one feature by its row number, as clicking it would.',
    params: [
      { name: 'layer', type: 'string', required: true, description: 'Layer name or id.' },
      { name: 'index', type: 'number', required: true, description: '1-based feature number.' },
    ],
    run: (args) => {
      const layer = requireLayer(args)
      if (isResult(layer)) return layer
      const n = argNum(args, 'index', 1)
      const feature = layer.geojson.features[n - 1]
      if (!feature) {
        return fail(`"${layer.name}" has ${layer.geojson.features.length} feature(s) loaded; ${n} is out of range.`)
      }
      const props = Object.entries(feature.properties ?? {})
        .map(([k, v]) => `${k}: ${String(v)}`).join('\n')
      return ok(`"${layer.name}" feature ${n} (${feature.geometry?.type}):\n${props || '(no attributes)'}`)
    },
  },
]

/** Open a data viewer on a layer's R object — used by the tutorials that pair
 *  the map with the table. Kept out of the list above so `map.*` stays about
 *  the map itself. */
export function openLayerTable(layer: SpatialLayer): void {
  useEditorStore.getState().addObjectTab(layer.name, layer.envName, 'sf', layer.name, 'data-viewer')
}
