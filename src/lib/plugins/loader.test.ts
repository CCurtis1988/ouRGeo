import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadPlugins, loadedPlugins, pluginEnabled, setPluginEnabled } from './loader'
import { actionById, actionList } from '@/lib/ai-actions/registry'
import { toolList } from '@/components/toolbox/tools'
import { OURGEO_TOPICS } from '@/lib/ai-skill-ourgeo'
import { providerById } from '@/lib/api-connectors/registry'

// A plugin folder is untrusted input from three directions at once: a file the
// user edited, a file another machine wrote, and a file a model generated. So
// what is pinned here is the loader's refusal to let any one of them break the
// rest — including the case where a plugin has already taken the app down once.

const APP = '1.11'

/** A fake plugins directory, plus the preferences file that says what is on. */
interface Fake {
  files: Record<string, string>
  prefs: Record<string, unknown>
}

let fake: Fake

function stubElectron(): void {
  vi.stubGlobal('window', {
    addEventListener: () => undefined,
    electronAPI: {
      app: { getDataPath: async () => '/data' },
      // `plugins.json` and any plugin storage go through the generic file API.
      file: {
        read: async (p: string) => {
          if (p.endsWith('plugins.json')) return JSON.stringify(fake.prefs)
          return '{}'
        },
        write: async (p: string, content: string) => {
          if (p.endsWith('plugins.json')) fake.prefs = JSON.parse(content)
        },
      },
      plugins: {
        list: async () => {
          const ids = new Set(Object.keys(fake.files).map((f) => f.split('/')[0]))
          return [...ids].sort().map((id) => ({
            id, dir: `/data/plugins/${id}`,
            hasManifest: fake.files[`${id}/ourgeo-plugin.json`] !== undefined,
          }))
        },
        readFile: async (p: string) => {
          if (fake.files[p] === undefined) throw new Error(`no such file: ${p}`)
          return fake.files[p]
        },
        listFiles: async (id: string) =>
          Object.keys(fake.files).filter((f) => f.startsWith(`${id}/`)).map((f) => f.slice(id.length + 1)),
        writeFile: async () => undefined,
        cacheRead: async () => null,
        cacheWrite: async () => undefined,
      },
    },
  })
}

const manifest = (over: Record<string, unknown>): string => JSON.stringify({
  id: 'demo', name: 'Demo', version: '1.0.0', ...over,
})

beforeEach(() => {
  fake = { files: {}, prefs: { enabled: {}, activating: null } }
  stubElectron()
})

it('retains a declared action prerequisite when its skill file is unavailable', async () => {
  fake.files['demo/ourgeo-plugin.json'] = manifest({
    context: { version: 1, skills: [{ id: 'flood', summary: 'Assess flood exposure', bodyFile: 'skills/flood.md', actions: ['assess'] }] },
    contributes: { actions: [{ name: 'assess', summary: 'Assess parcel flood exposure.', run: { kind: 'r', code: '1' } }] },
  })
  fake.prefs.enabled = { demo: true }
  await loadPlugins(APP)
  expect(actionById('demo:assess')?.contextPrerequisites).toEqual(['skill:demo:flood'])
  expect(OURGEO_TOPICS['demo:flood']).toBeUndefined()
})

describe('discovery', () => {
  it('reads an enabled plugin and registers its declarative contributions', async () => {
    fake.files['demo/ourgeo-plugin.json'] = manifest({
      contributes: {
        actions: [{
          name: 'hello', summary: 'Say hello in the R console.',
          run: { kind: 'r', code: 'cat("hi\\n")' },
        }],
        toolboxTools: [{
          name: 'thing', label: 'A thing', description: 'Does a thing.',
          category: 'table', fields: [], rTemplate: 'x <- 1',
        }],
        docs: [{ topic: 'usage', summary: 'how to', body: 'Use it like this.' }],
      },
    })
    fake.prefs = { enabled: { demo: true }, activating: null }

    const loaded = await loadPlugins(APP)
    expect(loaded[0].state).toBe('active')
    expect(actionById('demo:hello')).toBeDefined()
    expect(toolList().some((t) => t.id === 'demo-thing')).toBe(true)
    expect(OURGEO_TOPICS['demo-usage']).toContain('Use it like this.')
  })

  it('registers nothing for a plugin that is switched off', async () => {
    fake.files['demo/ourgeo-plugin.json'] = manifest({
      contributes: { actions: [{ name: 'hello', summary: 'Say hello in the R console.', run: { kind: 'r', code: '1' } }] },
    })
    const loaded = await loadPlugins(APP)
    expect(loaded[0].state).toBe('disabled')
    expect(actionById('demo:hello')).toBeUndefined()
  })

  it('compiles a declarative connector into a real provider', async () => {
    fake.files['demo/ourgeo-plugin.json'] = manifest({
      contributes: {
        connectors: [{
          name: 'portal', label: 'A portal', category: 'Open Data', description: 'x',
          servers: [{ id: 's', label: 'S', baseUrl: 'https://example.org' }],
          cascade: [{ key: 'set', label: 'Set', url: '{{baseUrl}}/sets', itemsPath: 'items' }],
          metadata: { spatial: false, queryable: true },
          import: { template: '{{var}} <- 1' },
        }],
      },
    })
    fake.prefs = { enabled: { demo: true }, activating: null }
    await loadPlugins(APP)
    expect(providerById('demo-portal')?.label).toBe('A portal')
  })
})

describe('one bad plugin never costs another', () => {
  it('fails only the plugin whose manifest is broken', async () => {
    fake.files['broken/ourgeo-plugin.json'] = '{ not json'
    fake.files['good/ourgeo-plugin.json'] = JSON.stringify({
      id: 'good', name: 'Good', version: '1.0.0',
      contributes: { docs: [{ topic: 'x', summary: 's', body: 'b' }] },
    })
    fake.prefs = { enabled: { broken: true, good: true }, activating: null }

    const loaded = await loadPlugins(APP)
    expect(loaded.find((p) => p.manifest.id === 'broken')?.state).toBe('failed')
    expect(loaded.find((p) => p.manifest.id === 'good')?.state).toBe('active')
    expect(OURGEO_TOPICS['good-x']).toBe('b')
  })

  it('drops one malformed contribution and keeps the rest', async () => {
    fake.files['demo/ourgeo-plugin.json'] = manifest({
      contributes: {
        actions: [
          { name: 'good', summary: 'A perfectly fine action here.', run: { kind: 'r', code: '1' } },
          { name: 'bad', summary: 'Missing its run entirely.' },
        ],
      },
    })
    fake.prefs = { enabled: { demo: true }, activating: null }
    const loaded = await loadPlugins(APP)
    expect(actionById('demo:good')).toBeDefined()
    expect(actionById('demo:bad')).toBeUndefined()
    expect(loaded[0].error).toContain('"run"')
  })

  it('refuses a folder whose name and manifest id disagree', async () => {
    // The folder is the plugin's address on disk; letting them differ makes
    // plugin:inspect and the folder describe different things.
    fake.files['folder-name/ourgeo-plugin.json'] = manifest({ id: 'other-name', contributes: { docs: [{ topic: 'a', summary: 's', body: 'b' }] } })
    fake.prefs = { enabled: { 'folder-name': true }, activating: null }
    const loaded = await loadPlugins(APP)
    expect(loaded[0].state).toBe('failed')
    expect(loaded[0].error).toContain('folder')
  })

  it('says so when a folder has no manifest at all', async () => {
    fake.files['stray/readme.txt'] = 'hello'
    const loaded = await loadPlugins(APP)
    expect(loaded[0].error).toContain('ourgeo-plugin.json')
  })
})

describe('the crash guard', () => {
  // Without this, one bad plugin means an app that dies on launch and a Plugin
  // Manager that can only be reached from inside the app that dies.
  beforeEach(() => {
    fake.files['culprit/ourgeo-plugin.json'] = JSON.stringify({
      id: 'culprit', name: 'Culprit', version: '1.0.0', main: 'main.js',
    })
    fake.files['culprit/main.js'] = 'export function activate() {}'
    fake.files['bystander/ourgeo-plugin.json'] = JSON.stringify({
      id: 'bystander', name: 'Bystander', version: '1.0.0',
      contributes: { docs: [{ topic: 'x', summary: 's', body: 'b' }] },
    })
    fake.prefs = {
      enabled: { culprit: true, bystander: true },
      activating: 'culprit',   // it was mid-activation when the app went down
    }
  })

  it('disables the plugin that was starting, and skips every other one', async () => {
    const loaded = await loadPlugins(APP)
    const culprit = loaded.find((p) => p.manifest.id === 'culprit')!
    const bystander = loaded.find((p) => p.manifest.id === 'bystander')!

    expect(culprit.state).toBe('skipped')
    expect(culprit.error).toContain('closed unexpectedly')
    expect(bystander.state).toBe('skipped')
    expect(bystander.error).toContain('culprit')
    expect(pluginEnabled('culprit')).toBe(false)
  })

  it('clears the marker, so the next launch is normal', async () => {
    await loadPlugins(APP)
    expect(fake.prefs.activating).toBeNull()

    const loaded = await loadPlugins(APP)
    expect(loaded.find((p) => p.manifest.id === 'bystander')?.state).toBe('active')
  })

  it('leaves the bystander enabled — it did nothing wrong', async () => {
    await loadPlugins(APP)
    expect(pluginEnabled('bystander')).toBe(true)
  })
})

describe('turning one off', () => {
  it('removes everything it contributed', async () => {
    fake.files['demo/ourgeo-plugin.json'] = manifest({
      contributes: { actions: [{ name: 'hello', summary: 'Say hello in the R console.', run: { kind: 'r', code: '1' } }] },
    })
    fake.prefs = { enabled: { demo: true }, activating: null }
    await loadPlugins(APP)
    const before = actionList().length
    expect(actionById('demo:hello')).toBeDefined()

    await setPluginEnabled('demo', false, APP)
    expect(actionById('demo:hello')).toBeUndefined()
    expect(actionList().length).toBe(before - 1)
    expect(loadedPlugins()[0].state).toBe('disabled')
  })
})
