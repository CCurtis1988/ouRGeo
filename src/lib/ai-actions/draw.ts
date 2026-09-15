// Drawing and geometry editing.
//
// Two levels, because tutorials and doing need different things:
//
//   * The MODE actions (start, tool, curve, stop) put the ribbon into the state
//     the user would put it in, so the assistant can say "now pick the polygon
//     tool" with the tool already highlighted, or set up an exercise and hand
//     over the mouse.
//   * `draw:addFeature` / `draw:updateFeature` take whole GeoJSON geometries.
//     They go through the same pending-edit staging as hand-drawn geometry:
//     the feature appears on the map, the Save Edits badge counts it, and
//     nothing reaches the R object until the user (or draw:saveEdits) commits —
//     at which point it is written by the same batched R statement, echoed to
//     the console.
//
// A geometry the assistant invents is exactly as reviewable as one the user
// drew, which is the only basis on which this is safe to offer at all.

import {
  useGeometryEditStore, selectActiveSession, type ColLib, type GeometryType,
} from '@/store/geometryEdit'
import { useSpatialStore, pendingGroupKey, type PendingEditMeta, type SpatialLayer } from '@/store/spatial'
import { useSessionStore } from '@/store/session'
import { useUiStore } from '@/store/ui'
import { rClient } from '@/lib/r-client'
import { geometryToWKT } from '@/lib/geometry-geojson'
import { destination, parseBearing, parseDistance, type BearingMode, type DistanceUnit, type TraverseLeg, UNIT_IDS, BEARING_MODE_IDS, incomingAzimuth } from '@/lib/draw/cogo'
import { buildTraverseRCode } from '@/lib/draw/traverse-rcode'
import type { Position } from '@/lib/draw/types'
import { saveEditGroups, discardEditGroups } from '@/lib/save-edits'
import { ok, fail, argStr, argNum, argBool, argJson, argNumList, type UiAction, type ActionResult, type Args } from './types'

const TOOL_IDS = [
  'select', 'draw', 'edit-vertices', 'move-feature', 'add-point',
  'rectangle', 'circle', 'freehand', 'trace', 'distance-bearing',
] as const

const isResult = (v: unknown): v is ActionResult =>
  typeof v === 'object' && v !== null && 'ok' in v && 'message' in v

function layerListing(): string {
  const ls = useSpatialStore.getState().layers.filter((l) => l.kind !== 'raster')
  return ls.length > 0 ? ls.map((l) => `"${l.name}"`).join(', ') : '(no vector layers on the map)'
}

function requireVectorLayer(args: Args): SpatialLayer | ActionResult {
  const ref = argStr(args, 'layer')
  const ls = useSpatialStore.getState().layers
  const layer = ref
    ? ls.find((l) => l.name === ref) ?? ls.find((l) => l.id === ref) ?? null
    : ls.find((l) => l.id === useSpatialStore.getState().selectedLayerId) ?? null
  if (!layer) {
    return fail(ref
      ? `No layer called "${ref}". Vector layers: ${layerListing()}.`
      : `Which layer? Vector layers: ${layerListing()}.`)
  }
  if (layer.kind === 'raster') return fail(`"${layer.name}" is a raster; rasters have no editable geometry.`)
  return layer
}

function metaFor(layer: SpatialLayer): PendingEditMeta {
  return {
    source: layer.tileSource ? 'database' : 'memory',
    layerId: layer.id,
    accessPath: layer.name,
    envName: layer.envName,
    columnName: layer.columnName,
    colLib: layer.colLib,
  }
}

/** Parse a geometry argument: GeoJSON geometry, a Feature, or [lng, lat]. */
function parseGeometry(args: Args, key: string): GeoJSON.Geometry | string {
  const raw = argJson(args, key)
  if (Array.isArray(raw) && raw.length === 2 && raw.every((n) => typeof n === 'number')) {
    return { type: 'Point', coordinates: raw as [number, number] }
  }
  if (!raw || typeof raw !== 'object') {
    return 'Pass a GeoJSON geometry object, e.g. {"type":"Point","coordinates":[-1.2,52.6]}, ' +
      'or [longitude, latitude] for a point.'
  }
  const obj = raw as { type?: string; geometry?: GeoJSON.Geometry; coordinates?: unknown }
  if (obj.type === 'Feature' && obj.geometry) return obj.geometry
  if (typeof obj.type === 'string' && 'coordinates' in obj) return obj as GeoJSON.Geometry
  if (obj.type === 'GeometryCollection') return obj as unknown as GeoJSON.Geometry
  return 'That is not a GeoJSON geometry. Expected {"type":"Polygon","coordinates":[…]} or similar.'
}

/** Stage one geometry against a row, exactly as a hand-drawn commit does. */
function stageGeometry(
  layer: SpatialLayer, rowId: number, geometry: GeoJSON.Geometry, isNewRow: boolean,
): void {
  const meta = metaFor(layer)
  const wkt = geometryToWKT(geometry) ?? undefined
  const prevGeometry = layer.geojson.features[rowId]?.geometry ?? null
  const spatial = useSpatialStore.getState()
  const edit = { rowId, kind: 'geometry' as const, wkt, geometry, originalGeometry: prevGeometry }
  if (isNewRow) {
    spatial.addPendingGeometryEdit(meta, edit)
    spatial.appendLayerFeature(layer.id, geometry)
  } else {
    spatial.commitGeometryEdit(meta, rowId, edit)
  }
  useGeometryEditStore.getState().logCommit({
    kind: 'geometry',
    groupKey: pendingGroupKey(meta),
    rowId,
    prevPending: null,
    prevGeometry,
    accessPath: meta.accessPath,
    envName: meta.envName,
  })
}

export const drawActions: UiAction[] = [
  {
    id: 'draw:status',
    group: 'draw',
    tier: 'always',
    summary: 'Whether edit mode is on, which tool is active, and how many edits are staged.',
    params: [],
    run: () => {
      const g = useGeometryEditStore.getState()
      const s = useSpatialStore.getState()
      const session = selectActiveSession(g)
      const staged = Object.entries(s.pendingGeometryEdits)
        .filter(([, e]) => e.length > 0)
        .map(([k, e]) => `${s.pendingEditMeta[k]?.accessPath ?? k}: ${e.length}`)
      return ok([
        g.isEditMode ? `Edit mode ON, tool "${g.activeToolId ?? 'select'}".` : 'Edit mode off.',
        session
          ? `Drawing on ${session.accessPath}, row ${session.currentRow + 1} of ${session.totalRows}, geometry type ${session.geometryType}.`
          : 'No drawing session.',
        staged.length > 0 ? `Staged edits — ${staged.join('; ')}.` : 'No staged edits.',
      ].join('\n'))
    },
  },

  {
    id: 'draw:start',
    group: 'draw',
    tier: 'autopilot',
    summary:
      'Turn on edit mode for a layer and start a drawing session on one of its rows. ' +
      'This is what the ribbon\'s Edit button does.',
    params: [
      { name: 'layer', type: 'string', required: true, description: 'Vector layer to edit.' },
      { name: 'row', type: 'number', description: '1-based feature to draw; omit for the first.' },
      { name: 'tool', type: 'enum', values: TOOL_IDS, default: 'draw', description: 'Which drawing tool to arm.' },
    ],
    run: (args) => {
      const layer = requireVectorLayer(args)
      if (isResult(layer)) return layer
      const g = useGeometryEditStore.getState()
      const total = layer.geojson.features.length
      const row = Math.max(1, Math.min(total || 1, argNum(args, 'row', 1))) - 1
      useSpatialStore.getState().ensureOpen()
      g.startEditing({
        accessPath: layer.name,
        envName: layer.envName,
        columnName: layer.columnName,
        colLib: layer.colLib as ColLib,
        geometryType: (layer.geometryType.toUpperCase() as GeometryType),
        currentRow: row,
        totalRows: total,
        originalGeometry: layer.geojson.features[row]?.geometry ?? null,
      })
      g.setActiveTool((argStr(args, 'tool', 'draw') || 'draw') as typeof TOOL_IDS[number])
      return ok(`Editing "${layer.name}" on feature ${row + 1} of ${total} with the ` +
        `"${argStr(args, 'tool', 'draw')}" tool.`)
    },
  },

  {
    id: 'draw:tool',
    group: 'draw',
    tier: 'always',
    summary: 'Arm a drawing tool, the way clicking it in the edit ribbon does.',
    params: [
      { name: 'tool', type: 'enum', values: TOOL_IDS, required: true, description: 'Which tool.' },
    ],
    run: (args) => {
      const tool = argStr(args, 'tool')
      if (!(TOOL_IDS as readonly string[]).includes(tool)) {
        return fail(`Unknown tool "${tool}". Tools: ${TOOL_IDS.join(', ')}.`)
      }
      const g = useGeometryEditStore.getState()
      if (!g.isEditMode && !selectActiveSession(g)) {
        return fail('There is no drawing session. Start one with draw:start first.')
      }
      g.setActiveTool(tool as typeof TOOL_IDS[number])
      return ok(`The "${tool}" tool is armed. The user draws on the map with it.`)
    },
  },

  {
    id: 'draw:curveMode',
    group: 'draw',
    tier: 'always',
    summary: 'Draw true curves (CIRCULARSTRING) instead of straight segments, or back again.',
    params: [
      {
        name: 'mode', type: 'enum', values: ['none', 'arc', 'endpoint-arc', 'tangent', 'bezier'],
        required: true,
        description: '"none" draws straight segments; the others draw curves. sf columns keep ' +
          'curves exactly (CIRCULARSTRING); geos columns densify them.',
      },
    ],
    run: (args) => {
      const modes = ['none', 'arc', 'endpoint-arc', 'tangent', 'bezier'] as const
      const mode = argStr(args, 'mode')
      if (!(modes as readonly string[]).includes(mode)) {
        return fail(`mode must be one of: ${modes.join(', ')}.`)
      }
      useGeometryEditStore.getState().setCurveType(mode as typeof modes[number])
      return ok(mode === 'none'
        ? 'Drawing straight segments.'
        : `Drawing ${mode} curves. sf columns store them exactly; geos columns densify them.`)
    },
  },

  {
    id: 'draw:stop',
    group: 'draw',
    tier: 'always',
    summary: 'End the drawing session. Staged edits are kept — save or discard them separately.',
    params: [],
    run: () => {
      useGeometryEditStore.getState().stopEditing()
      return ok('Drawing session ended. Any staged edits are still waiting in Save Edits.')
    },
  },

  {
    id: 'draw:addFeature',
    group: 'draw',
    tier: 'autopilot',
    summary:
      'Add a complete geometry to a layer. Appends a row in R, then stages the geometry the way ' +
      'a drawn feature is staged — it is not written to the object until the edits are saved.',
    params: [
      { name: 'layer', type: 'string', required: true, description: 'Vector layer to add to.' },
      {
        name: 'geometry', type: 'json', required: true,
        description: 'GeoJSON geometry in lon/lat, or [longitude, latitude] for a point.',
      },
    ],
    run: async (args) => {
      const layer = requireVectorLayer(args)
      if (isResult(layer)) return layer
      const geometry = parseGeometry(args, 'geometry')
      if (typeof geometry === 'string') return fail(geometry)
      if (layer.tileSource) {
        return fail(`"${layer.name}" is database-backed. Add rows to the .Rgeo table itself rather ` +
          'than through the map.')
      }

      // The row has to exist in R before a geometry can be staged against it —
      // the same order the ＋ Add Feature button uses.
      const code = `${layer.name}[nrow(${layer.name}) + 1L, ] <- NA`
      const session = useSessionStore.getState()
      session.addConsoleEntry('input', code)
      session.addInputHistory(code)
      const res = await rClient.execute(code)
      if (!res.success) return fail(res.error ?? `Could not append a row to "${layer.name}".`)

      const meta = metaFor(layer)
      const newRow = layer.geojson.features.length
      useSpatialStore.getState().addPendingGeometryEdit(meta, {
        rowId: newRow, kind: 'row-add', originalGeometry: null,
      })
      stageGeometry(layer, newRow, geometry, true)
      return ok(
        `Staged a ${geometry.type} as feature ${newRow + 1} of "${layer.name}". ` +
        'It is on the map and counted in Save Edits, but not yet written to the R object — ' +
        'use draw:saveEdits, or let the user press Save Edits.'
      )
    },
  },

  {
    id: 'draw:traverse',
    group: 'draw',
    tier: 'autopilot',
    summary:
      'Build a feature from a start point and a list of distance-and-bearing legs — a traverse, ' +
      'the way a boundary or a survey line is written down. Staged like any drawn geometry.',
    params: [
      { name: 'layer', type: 'string', required: true, description: 'Vector layer to add to.' },
      {
        name: 'start', type: 'json', required: true,
        description: '[longitude, latitude] of the first point.',
      },
      {
        name: 'legs', type: 'json', required: true,
        description:
          'Array of legs in order, each {distance, bearing}. `distance` is a number (or a string ' +
          'with a unit, "150ft"); `bearing` is an azimuth, a DMS azimuth (45°30\'15"), a ' +
          'quadrant bearing (N45°30\'E) or a deflection from the previous leg (R90, L12°30\').',
      },
      {
        name: 'unit', type: 'enum', values: [...UNIT_IDS], default: 'm',
        description: 'Unit the distances are in, unless a leg names its own.',
      },
      {
        name: 'notation', type: 'enum', values: [...BEARING_MODE_IDS], default: 'azimuth',
        description:
          'How to read a bearing that is not self-describing. `interior` is an angle right, ' +
          'turned clockwise from the back line.',
      },
      {
        name: 'close', type: 'boolean', default: false,
        description: 'Return to the start point after the last leg — for a closed boundary.',
      },
    ],
    // Geodesic only, and the summary above says so rather than the tool
    // pretending otherwise: the layer's own grid needs R per leg, and an
    // assistant firing a dozen of those into a serial server while the user
    // waits is a worse trade than one honest basis. The person at the strip
    // has both.
    run: async (args) => {
      const layer = requireVectorLayer(args)
      if (isResult(layer)) return layer
      if (layer.tileSource) {
        return fail(`"${layer.name}" is database-backed. Add rows to the .Rgeo table itself rather ` +
          'than through the map.')
      }
      const start = argJson(args, 'start')
      if (!Array.isArray(start) || start.length !== 2 || start.some((n) => typeof n !== 'number')) {
        return fail('`start` must be [longitude, latitude].')
      }
      const rawLegs = argJson(args, 'legs')
      if (!Array.isArray(rawLegs) || rawLegs.length === 0) {
        return fail('`legs` must be a non-empty array of {distance, bearing}.')
      }

      const unit = argStr(args, 'unit', 'm') as DistanceUnit
      const notation = argStr(args, 'notation', 'azimuth') as BearingMode
      const vertices: Position[] = [start as Position]
      const legs: TraverseLeg[] = []

      for (let i = 0; i < rawLegs.length; i++) {
        const leg = rawLegs[i] as { distance?: unknown; bearing?: unknown }
        const distanceText = String(leg?.distance ?? '')
        const bearingText = String(leg?.bearing ?? '')
        const d = parseDistance(distanceText, unit)
        if (!d.ok) return fail(`Leg ${i + 1}: ${d.error}`)
        const b = parseBearing(bearingText, notation, incomingAzimuth(vertices))
        if (!b.ok) return fail(`Leg ${i + 1}: ${b.error}`)
        vertices.push(destination(vertices[vertices.length - 1], d.value, b.value))
        legs.push({ type: 'line', distanceText, bearingText, unit, mode: notation, distanceM: d.value, azimuth: b.value })
      }
      if (argBool(args, 'close', false)) vertices.push(vertices[0])

      const isPolygon = layer.geometryType.toUpperCase().includes('POLYGON')
      if (isPolygon && vertices.length < 4) {
        return fail('A polygon needs at least three legs and a closing leg — pass close: true.')
      }
      const geometry: GeoJSON.Geometry = isPolygon
        ? { type: 'Polygon', coordinates: [vertices[0] === vertices[vertices.length - 1] ? vertices : [...vertices, vertices[0]]] }
        : { type: 'LineString', coordinates: vertices }

      const code = `${layer.name}[nrow(${layer.name}) + 1L, ] <- NA`
      const session = useSessionStore.getState()
      session.addConsoleEntry('input', code)
      session.addInputHistory(code)
      const res = await rClient.execute(code)
      if (!res.success) return fail(res.error ?? `Could not append a row to "${layer.name}".`)

      const meta = metaFor(layer)
      const newRow = layer.geojson.features.length
      useSpatialStore.getState().addPendingGeometryEdit(meta, {
        rowId: newRow, kind: 'row-add', originalGeometry: null,
      })
      stageGeometry(layer, newRow, geometry, true)

      // The same echo the strip writes when a hand-typed traverse finishes:
      // the geometry is staged, and this is the line that says where it came
      // from, in R the user can re-run.
      const rcode = buildTraverseRCode(start as Position, legs, 'geodesic', null)
      if (rcode) session.addConsoleEntry('info', rcode)

      return ok(
        `Staged a ${geometry.type} of ${legs.length} leg${legs.length === 1 ? '' : 's'} as feature ` +
        `${newRow + 1} of "${layer.name}", measured geodesically on WGS 84. ` +
        'It is on the map and counted in Save Edits, but not yet written to the R object.'
      )
    },
  },

  {
    id: 'draw:updateFeature',
    group: 'draw',
    tier: 'autopilot',
    summary: 'Replace the geometry of an existing feature. Staged, not written, until edits are saved.',
    params: [
      { name: 'layer', type: 'string', required: true, description: 'Vector layer.' },
      { name: 'row', type: 'number', required: true, description: '1-based feature number.' },
      { name: 'geometry', type: 'json', required: true, description: 'Replacement GeoJSON geometry.' },
    ],
    run: (args) => {
      const layer = requireVectorLayer(args)
      if (isResult(layer)) return layer
      const geometry = parseGeometry(args, 'geometry')
      if (typeof geometry === 'string') return fail(geometry)
      const n = argNum(args, 'row', 0)
      const total = layer.geojson.features.length
      if (n < 1 || n > total) return fail(`"${layer.name}" has ${total} feature(s); ${n} is out of range.`)
      stageGeometry(layer, n - 1, geometry, false)
      return ok(`Staged a new ${geometry.type} for feature ${n} of "${layer.name}". ` +
        'Save Edits writes it to the R object.')
    },
  },

  {
    id: 'draw:deleteFeatures',
    group: 'draw',
    // Deletes rows from the R object outright.
    tier: 'confirm',
    summary: 'Delete features from a layer\'s R object by row number. This runs immediately.',
    params: [
      { name: 'layer', type: 'string', required: true, description: 'Vector layer.' },
      { name: 'rows', type: 'numbers', required: true, description: '1-based feature numbers.' },
    ],
    run: async (args) => {
      const layer = requireVectorLayer(args)
      if (isResult(layer)) return layer
      const rows = argNumList(args, 'rows').filter((n) => n >= 1)
      if (rows.length === 0) return fail('Pass at least one 1-based row number.')
      const code = `${layer.name} <- ${layer.name}[-c(${rows.join(', ')}), ]`
      const session = useSessionStore.getState()
      session.addConsoleEntry('input', code)
      session.addInputHistory(code)
      const res = await rClient.execute(code)
      if (!res.success) return fail(res.error ?? 'Delete failed.')
      useSpatialStore.getState().removeLayerFeatures(layer.id, rows.map((r) => r - 1))
      return ok(`Deleted ${rows.length} feature(s) from "${layer.name}".`)
    },
  },

  {
    id: 'draw:saveEdits',
    group: 'draw',
    // Writes to the user's R object.
    tier: 'confirm',
    summary: 'Write staged geometry edits back to their R objects, echoing the R to the console.',
    params: [
      { name: 'layer', type: 'string', description: 'Only this layer\'s edits; omit for all of them.' },
    ],
    run: async (args) => {
      const s = useSpatialStore.getState()
      const groups = Object.entries(s.pendingGeometryEdits).filter(([, e]) => e.length > 0)
      if (groups.length === 0) return ok('There are no staged edits to save.')
      const ref = argStr(args, 'layer')
      const keys = ref
        ? groups.filter(([k]) => s.pendingEditMeta[k]?.accessPath === ref).map(([k]) => k)
        : groups.map(([k]) => k)
      if (keys.length === 0) return fail(`No staged edits for "${ref}".`)
      await saveEditGroups(keys)
      return ok(`Saved staged edits for ${keys.length} object(s).`)
    },
  },

  {
    id: 'draw:discardEdits',
    group: 'draw',
    // Throws away work.
    tier: 'confirm',
    summary: 'Throw away staged geometry edits, restoring the pre-edit geometry on the map.',
    params: [
      { name: 'layer', type: 'string', description: 'Only this layer\'s edits; omit for all of them.' },
    ],
    run: async (args) => {
      const s = useSpatialStore.getState()
      const groups = Object.entries(s.pendingGeometryEdits).filter(([, e]) => e.length > 0)
      if (groups.length === 0) return ok('There are no staged edits to discard.')
      const ref = argStr(args, 'layer')
      const keys = ref
        ? groups.filter(([k]) => s.pendingEditMeta[k]?.accessPath === ref).map(([k]) => k)
        : groups.map(([k]) => k)
      if (keys.length === 0) return fail(`No staged edits for "${ref}".`)
      await discardEditGroups(keys)
      return ok(`Discarded staged edits for ${keys.length} object(s).`)
    },
  },

  {
    id: 'draw:reviewEdits',
    group: 'draw',
    tier: 'always',
    summary: 'Open the Save Edits dialog so the user can see and decide about the staged edits.',
    params: [],
    run: () => {
      const staged = Object.values(useSpatialStore.getState().pendingGeometryEdits)
        .reduce((n, e) => n + e.length, 0)
      if (staged === 0) return ok('There are no staged edits, so there is nothing to review.')
      useUiStore.getState().showDialog('save-edits')
      return ok(`Opened Save Edits with ${staged} staged edit(s) for the user to save or discard.`)
    },
  },
]
