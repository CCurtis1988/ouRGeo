import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runUiTool, describeUiCall, UI_TOOLS, UI_TOOL_NAMES } from './ai-ui-tools'
import { clearTierOverrides, setTierOverride } from './ai-actions/permissions'
import { useUiStore } from '@/store/ui'
import { useSpatialStore } from '@/store/spatial'
import { useEnvironmentStore } from '@/store/environment'

vi.mock('@/lib/r-client', () => ({
  rClient: {
    listEnvironments: vi.fn(async () => ({ success: true, environments: [] })),
    listSpatialObjects: vi.fn(async () => ({ success: true, objects: [] })),
    execute: vi.fn(async () => ({ success: true, output: '' })),
  },
}))

const ON = { autoPilot: true }
const OFF = { autoPilot: false }

beforeEach(() => {
  clearTierOverrides()
  useUiStore.setState({ openDialog: null, dialogArg: null, highlight: null, confirm: null })
  useSpatialStore.setState({ layers: [], isOpen: false })
  useEnvironmentStore.setState({ environments: [] })
})

describe('the tool surface', () => {
  it('is five tools — a registry the model searches, not ninety definitions', () => {
    expect(UI_TOOLS).toHaveLength(5)
    expect([...UI_TOOL_NAMES].sort()).toEqual([
      'list_ui_actions', 'ourgeo_docs', 'run_toolbox_tool', 'run_ui_action', 'toolbox_tools',
    ])
  })

  it('documents every tool for the model', () => {
    for (const t of UI_TOOLS) {
      expect(t.description.length).toBeGreaterThan(40)
      expect(t.inputSchema.type).toBe('object')
    }
  })
})

describe('list_ui_actions', () => {
  it('finds actions by keyword, with their parameters', async () => {
    const out = await runUiTool('list_ui_actions', { query: 'basemap' }, ON)
    expect(out).toContain('map:setBasemap')
    expect(out).toContain('params:')
  })

  it('restricts to a group', async () => {
    const out = await runUiTool('list_ui_actions', { group: 'plots' }, ON)
    expect(out).toContain('plots:show')
    expect(out).not.toContain('map:addLayer')
  })
})

describe('run_ui_action', () => {
  it('runs an always-allowed action with Autopilot off', async () => {
    const out = await runUiTool('run_ui_action', { id: 'ui:panel', params: { panel: 'plots' } }, OFF)
    expect(out).toMatch(/Plots panel is now open/)
  })

  it('refuses an unknown id and points at the search tool', async () => {
    const out = await runUiTool('run_ui_action', { id: 'map.doTheThing' }, ON)
    expect(out).toMatch(/^Error: no action/)
    expect(out).toContain('list_ui_actions')
  })

  it('reports a missing required parameter instead of running', async () => {
    const out = await runUiTool('run_ui_action', { id: 'ui:highlight', params: {} }, ON)
    expect(out).toMatch(/Error: Invalid arguments/)
    expect(out).toContain('"target" is required')
    expect(useUiStore.getState().highlight).toBeNull()
  })

  it('reports a bad enum value with the allowed ones', async () => {
    // A fixed enum is rejected centrally, before the action runs.
    const out = await runUiTool('run_ui_action', { id: 'ui:panel', params: { panel: 'spatial', state: 'sideways' } }, ON)
    expect(out).toContain('must be one of')
    expect(out).toContain('toggle')
  })

  it('lets a lenient enum reach the action, which names the real options', async () => {
    // `panel` is lenient so the user's own words work — "Spatial Editor" as
    // well as `spatial`. The check therefore lives in the action, and its
    // refusal has to carry the list `validateArgs` would have given.
    const out = await runUiTool('run_ui_action', { id: 'ui:panel', params: { panel: 'kitchen' } }, ON)
    expect(out).toContain('Unknown panel')
    expect(out).toContain('spatial')
  })

  it('refuses an autopilot action when Autopilot is off, and stays refused', async () => {
    const out = await runUiTool('run_ui_action', { id: 'editor:openFile', params: { path: '/tmp/a.R' } }, OFF)
    expect(out).toMatch(/needs Autopilot/)
    expect(out).toMatch(/ui:highlight/)
  })

  it('accepts params as a JSON string, which is how some models send them', async () => {
    const out = await runUiTool(
      'run_ui_action', { id: 'ui:highlight', params: '{"target":"toolbar.toolbox"}' }, ON,
    )
    expect(out).toContain('Toolbox')
    expect(useUiStore.getState().highlight?.target).toBe('toolbar.toolbox')
  })
})

describe('the confirmation gate', () => {
  it('asks, and runs when the user allows', async () => {
    const pending = runUiTool('run_ui_action', { id: 'session:clearConsole' }, ON)
    // Not a confirm action by default, so it should not have asked.
    expect(useUiStore.getState().confirm).toBeNull()
    await pending

    setTierOverride('session:clearConsole', 'confirm')
    const gated = runUiTool('run_ui_action', { id: 'session:clearConsole' }, ON)
    await vi.waitFor(() => expect(useUiStore.getState().confirm).not.toBeNull())
    expect(useUiStore.getState().confirm?.actionId).toBe('session:clearConsole')
    useUiStore.getState().answerConfirm(true)
    expect(await gated).toMatch(/Console cleared/)
  })

  it('tells the model not to retry when the user declines', async () => {
    setTierOverride('ui:panel', 'confirm')
    const gated = runUiTool('run_ui_action', { id: 'ui:panel', params: { panel: 'help' } }, ON)
    await vi.waitFor(() => expect(useUiStore.getState().confirm).not.toBeNull())
    useUiStore.getState().answerConfirm(false)
    const out = await gated
    expect(out).toMatch(/Refused/)
    expect(out).toMatch(/Do not retry/)
  })

  it('shows the arguments it is asking about', async () => {
    setTierOverride('ui:highlight', 'confirm')
    const gated = runUiTool(
      'run_ui_action', { id: 'ui:highlight', params: { target: 'toolbar.save' } }, ON,
    )
    await vi.waitFor(() => expect(useUiStore.getState().confirm).not.toBeNull())
    expect(useUiStore.getState().confirm?.details).toContain('toolbar.save')
    useUiStore.getState().answerConfirm(false)
    await gated
  })

  it('denies an earlier request rather than losing it when a second arrives', async () => {
    setTierOverride('ui:panel', 'confirm')
    const first = runUiTool('run_ui_action', { id: 'ui:panel', params: { panel: 'help' } }, ON)
    await vi.waitFor(() => expect(useUiStore.getState().confirm).not.toBeNull())
    const second = runUiTool('run_ui_action', { id: 'ui:panel', params: { panel: 'plots' } }, ON)
    await vi.waitFor(() => expect(useUiStore.getState().confirm?.details).toContain('plots'))
    expect(await first).toMatch(/Refused/)
    useUiStore.getState().answerConfirm(false)
    expect(await second).toMatch(/Refused/)
  })
})

describe('the toolbox', () => {
  it('searches by keyword', async () => {
    const out = await runUiTool('toolbox_tools', { query: 'buffer' }, ON)
    expect(out.toLowerCase()).toContain('buffer')
  })

  it('describes one tool\'s fields', async () => {
    const out = await runUiTool('toolbox_tools', { toolId: 'select-columns' }, ON)
    expect(out).toContain('Fields')
    expect(out).toContain('ds (dataset)')
    expect(out).toContain('cols (column)')
  })

  it('names the categories when nothing matches', async () => {
    const out = await runUiTool('toolbox_tools', { query: 'zzzznope' }, ON)
    expect(out).toContain('Spatial')
  })

  it('rejects a field the tool does not have, and shows the real ones', async () => {
    const out = await runUiTool(
      'run_toolbox_tool', { toolId: 'select-columns', values: { nonsense: '1' }, dryRun: true }, ON,
    )
    expect(out).toMatch(/no field/)
    expect(out).toContain('Fields')
  })

  it('asks for the dataset instead of generating nonsense R', async () => {
    const out = await runUiTool('run_toolbox_tool', { toolId: 'select-columns', values: {}, dryRun: true }, ON)
    expect(out).toMatch(/Failed/)
    expect(out).toContain('"ds"')
  })

  it('returns the generated R without running it on dryRun', async () => {
    const out = await runUiTool('run_toolbox_tool', {
      toolId: 'select-columns', values: { ds: 'cities', cols: 'name', out: 'cities_sel' }, dryRun: true,
    }, ON)
    expect(out).toMatch(/not executed/)
    expect(out).toContain('cities_sel')
  })
})

describe('ourgeo_docs', () => {
  it('lists the topics when asked for none', async () => {
    const out = await runUiTool('ourgeo_docs', {}, ON)
    expect(out).toContain('toolbox')
    expect(out).toContain('troubleshooting')
  })

  it('returns a topic', async () => {
    const out = await runUiTool('ourgeo_docs', { topic: 'documents' }, ON)
    expect(out).toMatch(/clean child Rscript/)
  })

  it('names the real topics for an unknown one', async () => {
    const out = await runUiTool('ourgeo_docs', { topic: 'wombats' }, ON)
    expect(out).toMatch(/No documentation topic/)
    expect(out).toContain('interface')
  })
})

describe('console logging', () => {
  it('names the action and its arguments', () => {
    expect(describeUiCall('run_ui_action', { id: 'map:addLayer', params: { object: 'cities' } }))
      .toBe('AI: map:addLayer (object: cities) [autopilot]')
  })

  it('marks a toolbox preview as a preview', () => {
    expect(describeUiCall('run_toolbox_tool', { toolId: 'buffer', dryRun: true }))
      .toContain('preview only')
  })

  it('has a line for every tool', () => {
    for (const t of UI_TOOLS) expect(describeUiCall(t.name, {})).toMatch(/^AI: /)
  })
})

describe('unknown tools', () => {
  it('answers rather than throwing', async () => {
    expect(await runUiTool('not_a_tool', {}, ON)).toMatch(/unknown interface tool/)
  })
})
