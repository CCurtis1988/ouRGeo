import { describe, it, expect, afterEach } from 'vitest'
import {
  BUILTIN_PROVIDERS, providerList, providerById, providersByCategory, registerPluginProviders,
} from '@/lib/api-connectors/registry'
import {
  BUILTIN_TOOL_CATEGORIES, categoryList, toolList, registerPluginTools,
} from '@/components/toolbox/tools'
import { findTool, categoryListing } from '@/lib/ai-actions/toolbox'
import type { ApiProvider } from '@/lib/api-connectors/types'
import type { Category, ToolDef } from '@/components/toolbox/tools'

// The connector and toolbox registries have the same job as the action
// registry: hold what ouRGeo ships plus what the user has added, and never let
// the second quietly replace the first. Both are checked here rather than in
// their own suites because the *contract* is what matters, not the contents.

const fakeProvider = (id: string): ApiProvider => ({
  id,
  label: `Provider ${id}`,
  category: 'Open Data',
  description: 'A plugin-contributed provider.', docsUrl: '',
  builtinServers: [],
  cascade: [{ key: 'resource', label: 'Resource' }],
  listLevel: async () => [],
  getMetadata: async () => ({ fields: [], spatial: false, queryable: true }),
  preview: async () => [],
  buildCode: () => '',
  opsFor: () => ['is'],
})

const fakeTool = (id: string): ToolDef => ({
  id,
  label: `Tool ${id}`,
  description: 'A plugin-contributed tool.',
  fields: [],
  buildCode: () => `# ${id}`,
})

const fakeCategory = (id: string, tools: ToolDef[]): Category =>
  ({ id, label: `Category ${id}`, tools })

afterEach(() => {
  registerPluginProviders([])
  registerPluginTools([])
})

describe('the connector registry', () => {
  it('surfaces a plugin provider everywhere the picker looks', () => {
    registerPluginProviders([fakeProvider('demo-portal')])

    expect(providerById('demo-portal')?.label).toBe('Provider demo-portal')
    expect(providerList().map((p) => p.id)).toContain('demo-portal')
    const openData = providersByCategory().find((g) => g.category === 'Open Data')
    expect(openData?.providers.map((p) => p.id)).toContain('demo-portal')
  })

  it('drops it again when the plugin goes', () => {
    registerPluginProviders([fakeProvider('demo-portal')])
    registerPluginProviders([])
    expect(providerById('demo-portal')).toBeUndefined()
  })

  it('never lets a plugin shadow a shipped provider', () => {
    // Two providers answering to `esri` would make an import that went wrong
    // impossible to attribute.
    registerPluginProviders([fakeProvider('esri')])
    expect(providerById('esri')).toBe(BUILTIN_PROVIDERS.find((p) => p.id === 'esri'))
    expect(providerList().filter((p) => p.id === 'esri')).toHaveLength(1)
  })

  it('keeps the shipped providers first', () => {
    registerPluginProviders([fakeProvider('demo-portal')])
    const ids = providerList().map((p) => p.id)
    expect(ids.indexOf('ckan')).toBeLessThan(ids.indexOf('demo-portal'))
  })
})

describe('the toolbox registry', () => {
  it('appends a plugin tool to a shipped category without reordering it', () => {
    const before = categoryList().find((c) => c.id === 'table')!.tools.map((t) => t.id)
    registerPluginTools([fakeCategory('table', [fakeTool('demo-count')])])

    const after = categoryList().find((c) => c.id === 'table')!.tools.map((t) => t.id)
    expect(after.slice(0, before.length)).toEqual(before)
    expect(after).toContain('demo-count')
  })

  it('adds a category of its own after the shipped ones', () => {
    registerPluginTools([fakeCategory('demo', [fakeTool('demo-thing')])])
    const ids = categoryList().map((c) => c.id)
    expect(ids[ids.length - 1]).toBe('demo')
    expect(ids.slice(0, BUILTIN_TOOL_CATEGORIES.length))
      .toEqual(BUILTIN_TOOL_CATEGORIES.map((c) => c.id))
  })

  it('is visible to the assistant, not just the dialog', () => {
    registerPluginTools([fakeCategory('demo', [fakeTool('demo-thing')])])
    expect(findTool('demo-thing')?.label).toBe('Tool demo-thing')
    expect(categoryListing()).toContain('Category demo')
  })

  it('never lets a plugin shadow a shipped tool id', () => {
    // `run_toolbox_tool` takes a bare tool id, with no category — so a
    // duplicate id is genuinely ambiguous, not merely untidy.
    registerPluginTools([fakeCategory('demo', [fakeTool('sf-buffer')])])
    expect(toolList().filter((t) => t.id === 'sf-buffer')).toHaveLength(1)
    expect(findTool('sf-buffer')?.label).not.toBe('Tool sf-buffer')
  })

  it('leaves the shipped set exactly as it found it', () => {
    const before = toolList().length
    registerPluginTools([fakeCategory('demo', [fakeTool('demo-thing')])])
    registerPluginTools([])
    expect(toolList().length).toBe(before)
    expect(categoryList()).toBe(BUILTIN_TOOL_CATEGORIES)
  })
})

describe('every shipped provider names its documentation', () => {
  // The Help button in the Web APIs tab is only as good as the link behind it.
  // A provider added without one would draw a control that goes nowhere — and
  // the type cannot catch it, because a plugin-contributed provider is
  // deliberately allowed an empty string.
  it.each(BUILTIN_PROVIDERS.map((p) => [p.id, p.docsUrl] as const))('%s', (_id, url) => {
    expect(url).toMatch(/^https:\/\//)
  })
})
