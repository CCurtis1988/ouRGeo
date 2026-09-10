import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { LoadedPlugin } from '@/lib/plugins/types'
import type { StoreDetail } from '@/lib/plugin-store/types'

// What the assistant may do with the plugin store.
//
// Two claims worth pinning, and one absence.
//
// The claims: an install arrives SWITCHED OFF and says so, and a plugin that
// needs a newer ouRGeo is refused BEFORE it downloads. The second is not
// tidiness — an incompatible plugin that installs and then fails to load reads
// as a broken plugin rather than an old app, and the user's next move is to
// report a bug against somebody else's work.
//
// The absence: nothing here submits a plugin or writes a review. Both publish
// under the user's name to a public site, which is the line `ai-actions` has
// never crossed. A test that only checked what the actions DO would not notice
// one being added.

const loaded: LoadedPlugin[] = []
const installs: { slug: string; versionId: string }[] = []
let detail: StoreDetail | null = null
let detailThrows: Error | null = null

vi.mock('@/lib/plugins/loader', () => ({
  loadedPlugins: () => loaded,
  pluginEnabled: () => false,
  reloadPlugins: async () => loaded,
  setPluginEnabled: async () => undefined,
  actionIsLoaded: () => false,
}))

vi.mock('@/lib/plugin-store/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/plugin-store/client')>(
    '@/lib/plugin-store/client')
  return {
    ...actual,
    detail: async () => { if (detailThrows) throw detailThrows; return detail },
    catalogue: async () => [],
    install: async (slug: string, versionId: string) => {
      installs.push({ slug, versionId })
      return {
        slug, versionId, version: '2.0.0', sha256: 'a'.repeat(64),
        installedAt: new Date().toISOString(), name: 'Tide Tools',
      }
    },
  }
})

const { storeActions } = await import('./store')
const { validateArgs } = await import('./types')

function action(id: string) {
  const a = storeActions.find((x) => x.id === id)
  if (!a) throw new Error(`no action ${id}`)
  return a
}

/** The path `run_ui_action` takes: validate, then run. */
async function invoke(id: string, args: Record<string, unknown>) {
  const a = action(id)
  const problem = validateArgs(a, args)
  if (problem) return { ok: false, message: problem }
  return a.run(args)
}

const version = (over: Partial<StoreDetail['versions'][0]> = {}) => ({
  id: 'v-2', version: '2.0.0', status: 'approved', bytes: 4096,
  sha256: 'b'.repeat(64), ourgeoVersion: null, permissions: ['ui'], hasCode: true,
  changelog: null, submittedAt: '2026-01-01T00:00:00Z', reviewedAt: null,
  reviewNotes: null, storagePath: 'x', sourcePath: null, ...over,
})

const tide = (over: Partial<StoreDetail> = {}): StoreDetail => ({
  slug: 'tide', name: 'Tide Tools', summary: 'Tides.', description: null,
  category: 'tools', tags: [], homepage: null, repository: null, license: null,
  installCount: 12, ratingAvg: 4.5, ratingCount: 2,
  publishedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  isRemoved: false, isMine: false,
  author: { username: 'someone', displayName: 'Someone', avatarUrl: null },
  media: [], versions: [version()], installedByMe: false, canReview: false,
  pageUrl: 'https://ourgeo.dev/plugin.html?slug=tide',
  ...over,
})

beforeEach(() => {
  loaded.length = 0
  installs.length = 0
  detail = tide()
  detailThrows = null
  vi.stubGlobal('window', { electronAPI: {} })
})

describe('store:install', () => {
  it('says outright that what it installed is switched off', async () => {
    const r = await invoke('store:install', { slug: 'tide' })
    expect(r.ok).toBe(true)
    expect(r.message).toMatch(/switched off/i)
    expect(installs).toEqual([{ slug: 'tide', versionId: 'v-2' }])
  })

  it('is the confirm tier, like plugin:enable', () => {
    // The moment code somebody else wrote arrives on the user's machine. A
    // moderator having read it is worth something and is not the same as the
    // user having decided.
    expect(action('store:install').tier).toBe('confirm')
    expect(action('store:update').tier).toBe('confirm')
  })

  it('refuses an incompatible plugin before downloading it', async () => {
    detail = tide({ versions: [version({ ourgeoVersion: '>=99.0.0' })] })
    const r = await invoke('store:install', { slug: 'tide' })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('99.0.0')
    expect(installs).toEqual([])
  })

  it('does nothing when that version is already installed', async () => {
    loaded.push({
      manifest: { id: 'tide', name: 'Tide Tools', version: '2.0.0' },
      dir: '/p/tide', state: 'active', registered: [],
    })
    const r = await invoke('store:install', { slug: 'tide' })
    expect(r.ok).toBe(true)
    expect(installs).toEqual([])
  })

  it('names the search action when the slug is unknown', async () => {
    detail = null
    const r = await invoke('store:install', { slug: 'nope' })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('nope')
  })

  it('requires a slug, and validateArgs is what says so', async () => {
    const r = await invoke('store:install', {})
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/slug/i)
  })
})

describe('store:update', () => {
  it('refuses a plugin that did not come from the store, and says why', async () => {
    loaded.push({
      manifest: { id: 'tide', name: 'Tide Tools', version: '1.0.0' },
      dir: '/p/tide', state: 'active', registered: [],
    })
    const r = await invoke('store:update', { slug: 'tide' })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('did not come from the store')
    expect(installs).toEqual([])
  })
})

describe('store:inspect', () => {
  it('reports what it runs and what it asks to reach', async () => {
    const r = await invoke('store:inspect', { slug: 'tide' })
    expect(r.ok).toBe(true)
    expect(String(r.data)).toContain('Ships code')
    expect(String(r.data)).toContain('ui')
  })

  it('turns an unreachable store into a sentence, not a stack', async () => {
    detailThrows = new Error("Error invoking remote method 'store:detail': Error: offline")
    const r = await invoke('store:inspect', { slug: 'tide' })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('Could not reach the plugin store')
    expect(r.message).not.toContain('remote method')
  })
})

describe('what the group deliberately cannot do', () => {
  it('never submits a plugin or writes a review', () => {
    // Both publish under the user's name to a public website. The distance
    // between "help me write this" and "and publish it as yours" is one the
    // user crosses by pressing a button.
    for (const a of storeActions) {
      expect(a.id).not.toMatch(/submit|publish|review|rate/i)
    }
  })

  it('never approves anything', () => {
    // An assistant that could approve a plugin could approve one it wrote.
    for (const a of storeActions) {
      expect(a.id).not.toMatch(/approve|moderat|reject/i)
    }
  })
})
