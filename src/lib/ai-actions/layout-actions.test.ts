import { describe, it, expect, beforeEach, vi } from 'vitest'
import { actionById, actionList } from './registry'
import { validateArgs, type Args } from './types'
import { useLayoutStore } from '@/store/layout'
import { zoneOf, isOpen, openPanels } from '@/lib/layout/model'
import { BUILTIN_TOOLBAR, resolveToolbar } from '@/lib/layout/toolbar'

// The layout actions are driven by a sentence — "put the map on the left" — so
// what is pinned here is the behaviour a user would describe, not the shape of
// the store underneath.

/**
 * Run an action the way `run_ui_action` does — validation first.
 *
 * The order is the point, and it is the same lesson `theme-actions.test.ts`
 * records: calling `action.run` directly hides a parameter that the boundary
 * would have rejected before the handler ever saw it.
 */
const run = async (id: string, args: Args = {}): Promise<string> => {
  const action = actionById(id)
  if (!action) throw new Error(`no action ${id}`)
  const invalid = validateArgs(action, args)
  if (invalid) return `FAILED: ${invalid}`
  const res = await action.run(args)
  return `${res.ok ? '' : 'FAILED: '}${res.message}${res.data ? `\n${String(res.data)}` : ''}`
}

const layout = (): ReturnType<typeof useLayoutStore.getState>['layout'] =>
  useLayoutStore.getState().layout

beforeEach(() => {
  // No Electron in a node test: the persistence layer writes through
  // `window.electronAPI`, so give it somewhere harmless to write.
  vi.stubGlobal('window', {
    electronAPI: {
      app: { getDataPath: async () => '/tmp' },
      file: { read: async () => '{}', write: async () => undefined },
    },
    addEventListener: () => undefined,
  })
  useLayoutStore.getState().reset()
  useLayoutStore.setState({ presets: [] })
})

describe('the layout group is registered like every other', () => {
  it('appears in the registry under its own group', () => {
    const ids = actionList().filter((a) => a.group === 'layout').map((a) => a.id)
    expect(ids).toContain('layout:describe')
    expect(ids).toContain('layout:movePanel')
    expect(ids.every((id) => id.startsWith('layout:'))).toBe(true)
  })
})

describe('layout:describe', () => {
  it('says where things are and which zones exist', async () => {
    const out = await run('layout:describe')
    expect(out).toContain('Centre')
    expect(out).toContain('Code editor')
    expect(out).toContain('Zones you can move a panel to')
  })
})

describe('layout:movePanel', () => {
  it('moves a panel and opens it in one call', async () => {
    // Two calls for one instruction is where a model drops the second.
    expect(isOpen(layout(), 'spatial')).toBe(false)
    const out = await run('layout:movePanel', { panel: 'spatial', zone: 'left' })
    expect(out).toContain('Moved Spatial Editor')
    expect(zoneOf(layout(), 'spatial')).toBe('left')
    expect(isOpen(layout(), 'spatial')).toBe(true)
  })

  it('takes the name the user would say, not just the id', async () => {
    await run('layout:movePanel', { panel: 'Spatial Editor', zone: 'bottom' })
    expect(zoneOf(layout(), 'spatial')).toBe('bottom')
  })

  it('honours an index', async () => {
    await run('layout:movePanel', { panel: 'plots', zone: 'left', index: 0 })
    expect(layout().zones.left.order[0]).toBe('plots')
  })

  it('names the panels when it does not recognise one', async () => {
    const out = await run('layout:movePanel', { panel: 'the map thing', zone: 'left' })
    expect(out).toContain('FAILED')
    expect(out).toContain('spatial')
    expect(out).toContain('Spatial Editor')
  })

  it('rejects a zone that does not exist at the boundary', async () => {
    const out = await run('layout:movePanel', { panel: 'spatial', zone: 'north' })
    expect(out).toContain('must be one of')
  })

  it('cannot strand the editor', async () => {
    // Whatever the assistant does, there is always somewhere to type.
    await run('layout:movePanel', { panel: 'editor', zone: 'bottom' })
    expect(zoneOf(layout(), 'editor')).toBe('bottom')
    expect(isOpen(layout(), 'editor')).toBe(true)
  })
})

describe('layout:setPanelSize and layout:setZoneSize', () => {
  it('gives a panel the share it asked for and reports what it got', async () => {
    await run('layout:movePanel', { panel: 'spatial', zone: 'right' })
    await run('layout:movePanel', { panel: 'plots', zone: 'right' })
    const out = await run('layout:setPanelSize', { panel: 'spatial', percent: 70 })
    expect(out).toContain('70%')
  })

  it('refuses a panel that is alone in its zone, and says what to do instead', async () => {
    // It already has all of it. Silently doing nothing would leave the model
    // telling the user it had made the map bigger.
    await run('layout:movePanel', { panel: 'spatial', zone: 'right' })
    const out = await run('layout:setPanelSize', { panel: 'spatial', percent: 70 })
    expect(out).toContain('layout:setZoneSize')
  })

  it('evens a zone back out', async () => {
    await run('layout:movePanel', { panel: 'spatial', zone: 'right' })
    await run('layout:movePanel', { panel: 'plots', zone: 'right' })
    await run('layout:setPanelSize', { panel: 'spatial', percent: 80 })
    const out = await run('layout:evenPanels', { zone: 'right' })
    expect(out).toContain('equally')
    expect(out).toContain('50%')
  })

  it('refuses to size the centre at the boundary, naming the zones that can be', async () => {
    // `center` is deliberately not in the enum — it takes whatever the other
    // zones leave. The *reason* lives in the action's summary, which the model
    // reads in `list_ui_actions`; the refusal only needs to name the options.
    const out = await run('layout:setZoneSize', { zone: 'center', size: 400 })
    expect(out).toContain('must be one of: left, right, bottom')
    expect(actionById('layout:setZoneSize')!.summary).toContain('centre has no size of its own')
  })

  it('resizes a real zone', async () => {
    await run('layout:setZoneSize', { zone: 'right', size: 500 })
    expect(layout().zones.right.size).toBe(500)
  })
})

describe('layout:setZoneMode and layout:showTab', () => {
  it('tabs a zone and brings a panel to the front', async () => {
    await run('layout:movePanel', { panel: 'spatial', zone: 'right' })
    await run('layout:movePanel', { panel: 'plots', zone: 'right' })
    await run('layout:setZoneMode', { zone: 'right', mode: 'tabs' })
    expect(layout().zones.right.mode).toBe('tabs')

    await run('layout:showTab', { panel: 'plots' })
    expect(layout().zones.right.active).toBe('plots')
  })

  it('sets the axis alongside the mode when asked', async () => {
    await run('layout:setZoneMode', { zone: 'left', mode: 'split', axis: 'row' })
    expect(layout().zones.left.axis).toBe('row')
  })
})

describe('layout:setToolbarButtons', () => {
  it('reorders without needing the whole toolbar described', async () => {
    const out = await run('layout:setToolbarButtons', { order: ['help', 'save'] })
    expect(out).not.toContain('FAILED')
    const shown = resolveToolbar(layout().toolbar.order, layout().toolbar.hidden).map((b) => b.id)
    expect(shown.slice(0, 2)).toEqual(['help', 'save'])
    // Everything unmentioned still there, in registry order.
    expect(shown).toHaveLength(BUILTIN_TOOLBAR.length)
  })

  it('hides and un-hides', async () => {
    await run('layout:setToolbarButtons', { hidden: ['record'] })
    expect(resolveToolbar(layout().toolbar.order, layout().toolbar.hidden).map((b) => b.id))
      .not.toContain('record')
    await run('layout:setToolbarButtons', { hidden: [] })
    expect(resolveToolbar(layout().toolbar.order, layout().toolbar.hidden).map((b) => b.id))
      .toContain('record')
  })

  it('names the real buttons when given one that does not exist', async () => {
    const out = await run('layout:setToolbarButtons', { order: ['teleport'] })
    expect(out).toContain('FAILED')
    expect(out).toContain('dataConnector')
  })

  it('refuses an empty call rather than doing nothing quietly', async () => {
    const out = await run('layout:setToolbarButtons', {})
    expect(out).toContain('Nothing to change')
  })
})

describe('presets', () => {
  it('saves, lists and re-applies an arrangement', async () => {
    await run('layout:movePanel', { panel: 'spatial', zone: 'left' })
    await run('layout:savePreset', { name: 'Mapping' })
    expect(await run('layout:listPresets')).toContain('Mapping')

    await run('layout:movePanel', { panel: 'spatial', zone: 'bottom' })
    expect(zoneOf(layout(), 'spatial')).toBe('bottom')

    await run('layout:applyPreset', { name: 'Mapping' })
    expect(zoneOf(layout(), 'spatial')).toBe('left')
  })

  it('points at savePreset when there are none yet', async () => {
    const out = await run('layout:applyPreset', { name: 'Mapping' })
    expect(out).toContain('FAILED')
    expect(out).toContain('layout:savePreset')
  })

  it('deletes one, and refuses a name that is not there', async () => {
    await run('layout:savePreset', { name: 'Mapping' })
    expect(await run('layout:deletePreset', { name: 'Nope' })).toContain('FAILED')
    expect(await run('layout:deletePreset', { name: 'Mapping' })).toContain('Deleted')
    expect(await run('layout:listPresets')).toContain('No saved layouts')
  })
})

describe('layout:reset', () => {
  it('is the way out of any arrangement', async () => {
    await run('layout:movePanel', { panel: 'spatial', zone: 'left' })
    await run('layout:setZoneSize', { zone: 'right', size: 900 })
    await run('layout:setToolbarButtons', { hidden: ['record'] })

    await run('layout:reset')
    expect(zoneOf(layout(), 'spatial')).toBe('right')
    expect(isOpen(layout(), 'spatial')).toBe(false)
    expect(layout().toolbar.hidden).toEqual([])
    expect(openPanels(layout(), 'center')).toEqual(['editor'])
  })
})
