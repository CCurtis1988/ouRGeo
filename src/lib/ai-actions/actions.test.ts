import { describe, it, expect, beforeEach, vi } from 'vitest'
import { actionById } from './registry'
import type { Args } from './types'
import { useUiStore } from '@/store/ui'
import { useSpatialStore, type SpatialLayer } from '@/store/spatial'
import { useEditorStore, type TabState } from '@/store/editor'
import { useEnvironmentStore } from '@/store/environment'
import { usePlottingStore } from '@/store/plotting'
import { useSessionStore } from '@/store/session'
import { useHelpStore } from '@/store/help'
import { useBasemapStore } from '@/store/basemap'
import { useGeometryEditStore } from '@/store/geometryEdit'

// Actions drive the real stores — that is the whole point of them — so the
// tests drive the real stores too and assert the app actually moved. Only the R
// client and Electron are stubbed.

vi.mock('@/lib/r-client', () => ({
  rClient: {
    listEnvironments: vi.fn(async () => ({ success: true, environments: [] })),
    listSpatialObjects: vi.fn(async () => ({ success: true, objects: [] })),
    getSpatialGeoJSON: vi.fn(async () => ({ success: true, geojson: '{"type":"FeatureCollection","features":[]}' })),
    execute: vi.fn(async () => ({ success: true, output: 'ok' })),
    searchHelp: vi.fn(async () => ({ success: true, result: { results: [] } })),
    getVignettes: vi.fn(async () => ({ success: true, result: { vignettes: [] } })),
    envRemove: vi.fn(async () => ({ success: true })),
    envRename: vi.fn(async () => ({ success: true })),
    listPackages: vi.fn(async () => ({ success: true, libraries: [] })),
    loadPackage: vi.fn(async () => ({ success: true })),
    selectionQuery: vi.fn(async () => ({ success: true, rowIndices: [0, 2] })),
    setWorkingDir: vi.fn(async (p: string) => ({ success: true, path: p })),
    getWorkingDir: vi.fn(async () => ({ success: true, path: '/home/u' })),
    sessionReset: vi.fn(async () => ({ success: true })),
  },
}))

const run = async (id: string, args: Args = {}): Promise<string> => {
  const action = actionById(id)
  if (!action) throw new Error(`no action ${id}`)
  const res = await action.run(args)
  return `${res.ok ? '' : 'FAILED: '}${res.message}`
}

const layer = (over: Partial<SpatialLayer> = {}): SpatialLayer => ({
  id: over.id ?? 'l1',
  name: over.name ?? 'cities',
  envName: '.GlobalEnv',
  geometryType: 'POINT',
  geojson: {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { pop: 100, region: 'N' }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { pop: 900, region: 'S' }, geometry: { type: 'Point', coordinates: [2, 2] } },
    ],
  },
  visible: true,
  color: '#4493f8',
  opacity: 1,
  colLib: 'sf',
  columnName: 'geometry',
  ...over,
})

const tab = (over: Partial<TabState> = {}): TabState => ({
  id: over.id ?? 't1',
  filePath: null,
  fileName: 'Untitled-1',
  content: '',
  savedContent: '',
  isDirty: false,
  type: 'code',
  ...over,
})

beforeEach(() => {
  useUiStore.setState({ openDialog: null, dialogArg: null, highlight: null, confirm: null })
  useSpatialStore.setState({ layers: [], selectedLayerId: null, isOpen: false })
  useEditorStore.setState({ tabs: [], activeTabId: null, untitledCounter: 1 })
  useEnvironmentStore.setState({ environments: [], isOpen: false })
  usePlottingStore.setState({ plots: [], currentIndex: -1, isOpen: false })
  useSessionStore.setState({ consoleHistory: [] })
  useHelpStore.setState({ isOpen: false, requested: null })
  useBasemapStore.setState({ overrideBasemapId: null })
  // No named session by default: with one, the map's view belongs to it.
  useGeometryEditStore.setState({ namedSessions: [], activeSessionId: null })
  vi.stubGlobal('window', {
    electronAPI: {
      file: { read: vi.fn(async () => 'x <- 1'), write: vi.fn(async () => undefined) },
    },
  })
})

describe('panels and dialogs', () => {
  it('opens, closes and toggles a panel', async () => {
    expect(await run('ui:panel', { panel: 'environment' })).toMatch(/Environment panel is now open/)
    expect(useEnvironmentStore.getState().isOpen).toBe(true)

    await run('ui:panel', { panel: 'environment', state: 'toggle' })
    expect(useEnvironmentStore.getState().isOpen).toBe(false)

    await run('ui:panel', { panel: 'environment', state: 'close' })
    expect(useEnvironmentStore.getState().isOpen).toBe(false)
  })

  it('names the valid panels when given a bad one', async () => {
    const out = await run('ui:panel', { panel: 'nope' })
    expect(out).toMatch(/FAILED/)
    expect(out).toContain('spatial')
  })

  it('opens a dialog', async () => {
    await run('ui:openDialog', { dialog: 'toolbox' })
    expect(useUiStore.getState().openDialog).toBe('toolbox')
    await run('ui:closeDialog')
    expect(useUiStore.getState().openDialog).toBeNull()
  })

  it('refuses to open symbology without a layer, and lists what is on the map', async () => {
    useSpatialStore.setState({ layers: [layer()] })
    const out = await run('ui:openDialog', { dialog: 'symbology' })
    expect(out).toMatch(/FAILED/)
    expect(out).toContain('cities')
  })

  it('opens symbology on a named layer, and opens the map to show it', async () => {
    useSpatialStore.setState({ layers: [layer()] })
    await run('ui:openDialog', { dialog: 'symbology', layer: 'cities' })
    expect(useUiStore.getState().openDialog).toBe('symbology')
    expect(useUiStore.getState().dialogArg).toBe('l1')
    expect(useSpatialStore.getState().isOpen).toBe(true)
  })
})

describe('highlighting', () => {
  it('points at a real control', async () => {
    const out = await run('ui:highlight', { target: 'toolbar.toolbox', message: 'here' })
    expect(out).toContain('Toolbox')
    expect(useUiStore.getState().highlight).toEqual({ target: 'toolbar.toolbox', message: 'here' })
  })

  it('refuses an unknown control and lists the real ones', async () => {
    const out = await run('ui:highlight', { target: 'toolbar.nonsense' })
    expect(out).toMatch(/FAILED/)
    expect(out).toContain('toolbar.toolbox')
    expect(useUiStore.getState().highlight).toBeNull()
  })

  it('clears', async () => {
    await run('ui:highlight', { target: 'toolbar.help' })
    await run('ui:clearHighlight')
    expect(useUiStore.getState().highlight).toBeNull()
  })
})

describe('ui:describe', () => {
  it('reports what is open rather than guessing', async () => {
    useEnvironmentStore.setState({ isOpen: true })
    useSpatialStore.setState({ layers: [layer(), layer({ id: 'l2', name: 'roads', visible: false })] })
    useEditorStore.setState({ tabs: [tab({ fileName: 'a.R', isDirty: true })], activeTabId: 't1' })

    const out = await run('ui:describe')
    expect(out).toContain('Environment')
    expect(out).toContain('a.R')
    expect(out).toContain('unsaved changes')
    expect(out).toContain('cities')
    expect(out).toContain('roads (hidden)')
  })
})

describe('map', () => {
  beforeEach(() => useSpatialStore.setState({ layers: [layer()], isOpen: true }))

  it('describes the map', async () => {
    const out = await run('map:status')
    expect(out).toContain('1 layer(s)')
    expect(out).toContain('cities')
  })

  it('hides and shows a layer by name', async () => {
    await run('map:setLayerVisible', { layer: 'cities', visible: false })
    expect(useSpatialStore.getState().layers[0].visible).toBe(false)
    await run('map:setLayerVisible', { layer: 'cities', visible: true })
    expect(useSpatialStore.getState().layers[0].visible).toBe(true)
  })

  it('lists the columns you can style or label by', async () => {
    const out = await run('map:listColumns', { layer: 'cities' })
    expect(out).toContain('pop (numeric)')
    expect(out).toContain('region (categorical)')
  })

  it('styles a layer', async () => {
    await run('map:setSymbology', { layer: 'cities', fillColor: '#ff0000', pointSize: 9 })
    const sym = useSpatialStore.getState().layers[0].symbology
    expect(sym?.fillColor).toBe('#ff0000')
    expect(sym?.pointSize).toBe(9)
  })

  it('colours a layer by a column, and refuses a column that is not there', async () => {
    await run('map:setSymbology', { layer: 'cities', colorBy: 'pop', scale: 'viridis' })
    expect(useSpatialStore.getState().layers[0].symbology?.fillColorBinding)
      .toEqual({ column: 'pop', type: 'numeric', scale: 'viridis' })

    const out = await run('map:setSymbology', { layer: 'cities', colorBy: 'nope' })
    expect(out).toMatch(/FAILED/)
    expect(out).toContain('pop')
  })

  it('labels a layer, and refuses without a column', async () => {
    await run('map:setLabels', { layer: 'cities', column: 'region' })
    expect(useSpatialStore.getState().layers[0].labelSettings)
      .toMatchObject({ enabled: true, field: 'region' })

    useSpatialStore.setState({ layers: [layer()] })
    expect(await run('map:setLabels', { layer: 'cities' })).toMatch(/FAILED.*column/s)
  })

  it('zooms to a layer, a bbox, or everything', async () => {
    const before = useSpatialStore.getState().fitTargetSignal
    await run('map:zoomTo', { layer: 'cities' })
    expect(useSpatialStore.getState().fitTargetSignal).toBeGreaterThan(before)

    await run('map:zoomTo', { bbox: [-1, -1, 1, 1] })
    expect(useSpatialStore.getState().fitTarget).toEqual([-1, -1, 1, 1])

    const fit = useSpatialStore.getState().fitBoundsSignal
    await run('map:zoomTo', { all: true })
    expect(useSpatialStore.getState().fitBoundsSignal).toBeGreaterThan(fit)
  })

  it('moves the view the map actually renders from, not just the mirror', async () => {
    // The bug this pins: adding any layer creates a "Default" named session,
    // and from then on MapView renders `sessionViewState ?? globalViewState`.
    // `map:setView` used to write only the spatial store, so an assistant
    // touring a user around Spain reported seven successful moves and the map
    // never moved once. Both stores now, every time — see lib/map-view.ts.
    useGeometryEditStore.getState().createNamedSession('Default')
    await run('map:setView', { longitude: 2.1734, latitude: 41.4036, zoom: 16 })

    const edit = useGeometryEditStore.getState()
    const active = edit.namedSessions.find((ns) => ns.id === edit.activeSessionId)
    expect(active?.viewState).toMatchObject({ longitude: 2.1734, latitude: 41.4036, zoom: 16 })
    expect(useSpatialStore.getState().viewState).toMatchObject({ longitude: 2.1734, zoom: 16 })
  })

  it('reads the shown view for the parts it was not given', async () => {
    useGeometryEditStore.getState().createNamedSession('Default')
    await run('map:setView', { longitude: 10, latitude: 50, zoom: 7 })
    const out = await run('map:setView', { longitude: 11, latitude: 51 })
    expect(out).toContain('zoom 7')
  })

  it('says when the map it just moved is not on screen', async () => {
    useSpatialStore.setState({ isOpen: false })
    expect(await run('map:setView', { longitude: 0, latitude: 0, zoom: 3 })).toContain('closed')
  })

  it('changes the basemap and refuses an unknown one', async () => {
    await run('map:setBasemap', { basemap: 'carto-dark-matter' })
    expect(useBasemapStore.getState().overrideBasemapId).toBe('carto-dark-matter')
    expect(await run('map:setBasemap', { basemap: 'not-a-basemap' })).toMatch(/FAILED/)
  })

  it('toggles the legend and north arrow', async () => {
    await run('map:setLegend', { show: false })
    expect(useSpatialStore.getState().showLegend).toBe(false)
    await run('map:setNorthArrow', { show: true, style: 'compass' })
    expect(useSpatialStore.getState().showNorthArrow).toBe(true)
    expect(useSpatialStore.getState().northArrowSettings.style).toBe('compass')
  })

  it('reads one feature\'s attributes, and reports an out-of-range row', async () => {
    expect(await run('map:identify', { layer: 'cities', index: 2 })).toContain('pop: 900')
    expect(await run('map:identify', { layer: 'cities', index: 99 })).toMatch(/FAILED.*out of range/s)
  })

  it('names the layers when asked about one that is not there', async () => {
    const out = await run('map:setLayerOpacity', { layer: 'nope', opacity: 0.5 })
    expect(out).toMatch(/FAILED/)
    expect(out).toContain('cities')
  })

  it('refuses to generate map code for an empty map', async () => {
    useSpatialStore.setState({ layers: [] })
    expect(await run('map:exportCode', { engine: 'tmap' })).toMatch(/FAILED.*no visible layers/s)
  })

  it('generates tmap code without running it', async () => {
    const out = await run('map:exportCode', { engine: 'tmap' })
    expect(out).toContain('tmap')
    expect(out).toContain('not run')
  })
})

describe('editor', () => {
  it('lists tabs and marks the active one', async () => {
    useEditorStore.setState({
      tabs: [tab({ id: 't1', fileName: 'a.R' }), tab({ id: 't2', fileName: 'b.Rmd', language: 'rmarkdown' })],
      activeTabId: 't2',
    })
    const out = await run('editor:listTabs')
    expect(out).toContain('a.R')
    expect(out).toContain('* "b.Rmd"')
    expect(out).toContain('R Markdown')
  })

  it('opens a file from disk', async () => {
    await run('editor:openFile', { path: '/tmp/x.R' })
    expect(useEditorStore.getState().tabs[0].filePath).toBe('/tmp/x.R')
  })

  it('refuses to save a tab that has never been saved, and says what to do', async () => {
    useEditorStore.setState({ tabs: [tab()], activeTabId: 't1' })
    const out = await run('editor:save')
    expect(out).toMatch(/FAILED/)
    expect(out).toContain('editor:saveAs')
  })

  it('refuses to knit an unsaved document', async () => {
    useEditorStore.setState({
      tabs: [tab({ fileName: 'r.Rmd', language: 'rmarkdown', isDirty: true, filePath: '/tmp/r.Rmd' })],
      activeTabId: 't1',
    })
    const out = await run('editor:knit', { format: 'html' })
    expect(out).toMatch(/FAILED/)
    expect(out).toMatch(/unsaved changes/)
  })
})

describe('help', () => {
  it('drives the panel rather than answering from itself', async () => {
    await run('help:topic', { topic: 'st_buffer', package: 'sf' })
    expect(useHelpStore.getState().requested).toEqual({ kind: 'doc', topic: 'st_buffer', pkg: 'sf' })
    expect(useHelpStore.getState().isOpen).toBe(true)
  })
})

describe('plots', () => {
  it('reports an empty history rather than pretending', async () => {
    expect(await run('plots:list')).toMatch(/No plots yet/)
    expect(await run('plots:show')).toMatch(/FAILED/)
  })

  it('shows one and opens the panel', async () => {
    usePlottingStore.setState({ plots: [{ dataUrl: 'a', plotId: 'p1' }, { dataUrl: 'b', plotId: 'p2' }], currentIndex: 1 })
    expect(await run('plots:show', { index: 1 })).toContain('plot 1 of 2')
    expect(usePlottingStore.getState().currentIndex).toBe(0)
    expect(usePlottingStore.getState().isOpen).toBe(true)
    expect(await run('plots:show', { index: 5 })).toMatch(/FAILED.*out of range/s)
  })
})

describe('session', () => {
  it('clears the console without touching R', async () => {
    useSessionStore.setState({ consoleHistory: [{ id: '1', type: 'output', text: 'x', timestamp: 0 }] })
    const out = await run('session:clearConsole')
    expect(useSessionStore.getState().consoleHistory).toHaveLength(0)
    expect(out).toMatch(/Nothing in the R session changed/)
  })

  it('echoes setwd() to the console, the way the picker does', async () => {
    await run('session:workingDir', { path: '/home/u/project' })
    const inputs = useSessionStore.getState().consoleHistory.filter((e) => e.type === 'input')
    expect(inputs.at(-1)?.text).toBe('setwd("/home/u/project")')
  })

  it('will not record without a document to record into', async () => {
    expect(await run('session:record', { state: 'start' })).toMatch(/FAILED.*No active document/s)
  })
})

describe('drawing', () => {
  beforeEach(() => {
    useSpatialStore.setState({ layers: [layer()], isOpen: true, pendingGeometryEdits: {}, pendingEditMeta: {} })
    useGeometryEditStore.setState({ isEditMode: false, activeToolId: null })
  })

  it('reports that nothing is being edited', async () => {
    const out = await run('draw:status')
    expect(out).toMatch(/Edit mode off/)
    expect(out).toMatch(/No staged edits/)
  })

  it('will not arm a tool with no session', async () => {
    expect(await run('draw:tool', { tool: 'rectangle' })).toMatch(/FAILED.*draw:start/s)
  })

  it('starts a session and arms the tool', async () => {
    await run('draw:start', { layer: 'cities', tool: 'add-point' })
    expect(useGeometryEditStore.getState().activeToolId).toBe('add-point')
    expect(await run('draw:status')).toMatch(/Drawing on cities/)
  })

  it('stages a geometry instead of writing it, and says so', async () => {
    const out = await run('draw:addFeature', {
      layer: 'cities', geometry: { type: 'Point', coordinates: [5, 5] },
    })
    expect(out).toContain('Staged')
    expect(out).toMatch(/not yet written to the R object/)
    const edits = Object.values(useSpatialStore.getState().pendingGeometryEdits).flat()
    expect(edits.some((e) => e.kind === 'geometry')).toBe(true)
    expect(useSpatialStore.getState().layers[0].geojson.features).toHaveLength(3)
  })

  it('accepts a bare [lng, lat] as a point', async () => {
    expect(await run('draw:addFeature', { layer: 'cities', geometry: [1, 2] })).toContain('Point')
  })

  it('rejects something that is not geometry, with an example', async () => {
    const out = await run('draw:addFeature', { layer: 'cities', geometry: 'over there' })
    expect(out).toMatch(/FAILED/)
    expect(out).toContain('coordinates')
  })

  it('has nothing to save when nothing is staged', async () => {
    expect(await run('draw:saveEdits')).toMatch(/no staged edits/i)
  })
})

describe('environment', () => {
  it('reports an empty environment plainly', async () => {
    expect(await run('env:list')).toMatch(/No matching objects/)
  })

  it('will not open an object that does not exist', async () => {
    expect(await run('env:view', { name: 'ghost' })).toMatch(/FAILED/)
  })
})

// A severed connection is not a bad request. Told only "Network Error", a local
// model decided the user's buffer geometry was at fault and spent twenty turns
// simplifying and rebuilding it — see lib/transport-retry.ts.
describe('map:addLayer when the connection drops', () => {
  it('retries, then says the object is fine and to stop rather than rebuild it', async () => {
    const severed = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' })
    const { rClient } = await import('@/lib/r-client')
    vi.mocked(rClient.listSpatialObjects).mockResolvedValue({
      success: true,
      objects: [{ name: 'buf', envName: '.GlobalEnv', class: 'sf', geometryType: 'POLYGON' }],
    } as Awaited<ReturnType<typeof rClient.listSpatialObjects>>)
    vi.mocked(rClient.getSpatialGeoJSON).mockRejectedValue(severed)

    const out = await run('map:addLayer', { object: 'buf' })
    expect(vi.mocked(rClient.getSpatialGeoJSON)).toHaveBeenCalledTimes(3)
    expect(out).toMatch(/transport failure/)
    expect(out).toMatch(/"buf" is valid and unchanged/)
    expect(out).toMatch(/Do not simplify geometry, rebuild the object/)
    expect(out).not.toMatch(/Network Error/)
    expect(useSpatialStore.getState().layers).toHaveLength(0)
  })
})
