import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { LoadedPlugin } from '@/lib/plugins/types'

// What the assistant may do with a plugin that came from the store.
//
// The rule is narrow and it is not a security boundary: the folder belongs to
// the user, the bundle is on their disk, and deleting the sidecar restores
// everything. What it is, is a promise to the author kept at the one place
// ouRGeo would otherwise hand their code on — and a promise kept in three
// places out of four is not kept at all, which is why every refusal comes from
// one function and this file checks all four.

const loaded: LoadedPlugin[] = []

vi.mock('@/lib/plugins/loader', () => ({
  loadedPlugins: () => loaded,
  pluginEnabled: () => true,
  reloadPlugins: async () => loaded,
  actionIsLoaded: () => false,
}))

const { pluginActions } = await import('./plugin')

function action(id: string) {
  const a = pluginActions.find((x) => x.id === id)
  if (!a) throw new Error(`no action ${id}`)
  return a
}

const storePlugin = (): LoadedPlugin => ({
  manifest: { id: 'tide', name: 'Tide Tools', version: '1.2.0', main: 'main.js' },
  dir: '/plugins/tide',
  state: 'active',
  registered: ['tool tide-height'],
  origin: {
    slug: 'tide',
    versionId: 'v-1',
    version: '1.2.0',
    sha256: 'a'.repeat(64),
    installedAt: '2026-01-02T00:00:00.000Z',
    name: 'Tide Tools',
    author: 'Someone',
  },
})

const localPlugin = (): LoadedPlugin => ({
  manifest: { id: 'mine', name: 'My Plugin', version: '0.1.0', main: 'main.ts' },
  dir: '/plugins/mine',
  state: 'active',
  registered: [],
})

beforeEach(() => {
  loaded.length = 0
  vi.stubGlobal('window', {
    electronAPI: {
      plugins: {
        listFiles: async () => ['main.ts'],
        readFile: async () => 'source',
        writeFile: async () => undefined,
        pack: async () => undefined,
      },
    },
  })
})

describe('a plugin from the store', () => {
  beforeEach(() => { loaded.push(storePlugin()) })

  it('is not exported', async () => {
    const r = await action('plugin:export').run({ id: 'tide', path: '/tmp/x.ourgeoplugin' })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('plugin store')
  })

  it('is not read', async () => {
    const r = await action('plugin:readFile').run({ id: 'tide', file: 'main.js' })
    expect(r.ok).toBe(false)
  })

  it('is not edited in place', async () => {
    const r = await action('plugin:writeFile').run({ id: 'tide', file: 'main.js', content: 'x' })
    expect(r.ok).toBe(false)
  })

  it('does not list its files, but still describes itself', async () => {
    const r = await action('plugin:inspect').run({ id: 'tide' })
    expect(r.ok).toBe(true)
    // Version, permissions and what it registered are all still reported —
    // only the file listing is withheld, because that is the step towards
    // reading the code.
    expect(String(r.data)).toContain('Tide Tools')
    expect(String(r.data)).toContain('tool tide-height')
    expect(String(r.data)).not.toContain('Files:')
  })

  it('names the way out in every refusal, not just the rule', async () => {
    // A model told only "you cannot" works around it — and the next thing it
    // reaches for is execute_r_code and readLines().
    for (const id of ['plugin:export', 'plugin:readFile', 'plugin:writeFile']) {
      const r = await action(id).run({ id: 'tide', file: 'main.js', content: 'x', path: '/tmp/x' })
      expect(r.message, id).toContain('ourgeo.dev/plugin.html?slug=tide')
      expect(r.message, id).toContain('plugin:scaffold')
    }
  })
})

describe('a plugin the user wrote', () => {
  beforeEach(() => { loaded.push(localPlugin()) })

  it('is exported, read, edited and listed exactly as before', async () => {
    expect((await action('plugin:export').run({ id: 'mine', path: '/tmp/x' })).ok).toBe(true)
    expect((await action('plugin:readFile').run({ id: 'mine', file: 'main.ts' })).ok).toBe(true)
    const inspected = await action('plugin:inspect').run({ id: 'mine' })
    expect(String(inspected.data)).toContain('Files: main.ts')
  })
})
