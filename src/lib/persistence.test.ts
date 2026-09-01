import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createJsonFileStore } from './persistence'

// A fake app-data directory with deliberately slow IPC, so a read-modify-write
// really does straddle another one. Without the store's queue every test in
// "concurrent writes" fails.
function fakeDisk(latencyMs = 5): {
  files: Map<string, string>
  api: Record<string, unknown>
  writes: number
} {
  const files = new Map<string, string>()
  const state = { writes: 0 }
  const wait = (): Promise<void> => new Promise((r) => setTimeout(r, latencyMs))
  const api = {
    app: { getDataPath: async () => '/data' },
    file: {
      read: async (p: string): Promise<string> => {
        await wait()
        const v = files.get(p)
        if (v === undefined) throw new Error('ENOENT')
        return v
      },
      write: async (p: string, content: string): Promise<void> => {
        await wait()
        state.writes++
        files.set(p, content)
      },
    },
  }
  return { files, api, get writes() { return state.writes } }
}

let disk: ReturnType<typeof fakeDisk>

beforeEach(() => {
  disk = fakeDisk()
  vi.stubGlobal('window', { electronAPI: disk.api })
})
afterEach(() => { vi.unstubAllGlobals() })

const read = (): Record<string, unknown> =>
  JSON.parse(disk.files.get('/data/theme.json') ?? '{}')

describe('createJsonFileStore', () => {
  it('reads {} for a file that is not there', async () => {
    const store = createJsonFileStore('theme.json', 'Theme')
    expect(await store.read()).toEqual({})
  })

  it('reads {} rather than throwing on unparseable content', async () => {
    disk.files.set('/data/theme.json', '{"theme":"dark"}",oops')
    const store = createJsonFileStore('theme.json', 'Theme')
    expect(await store.read()).toEqual({})
  })

  it('merges into what is already there', async () => {
    const store = createJsonFileStore('theme.json', 'Theme')
    await store.merge({ theme: 'dark' })
    await store.merge({ uiScale: 1.2 })
    expect(read()).toEqual({ theme: 'dark', uiScale: 1.2 })
  })
})

// The bug this queue exists for. `setTheme` writes the app theme, the code
// theme and the markdown theme in one tick; run concurrently, each merge reads
// the file BEFORE any of them has written, so the last write wins and the other
// two keys are gone. On a real filesystem the overlapping writes also produced
// a splice of two payloads — invalid JSON, which the loader reads as {} and the
// app starts on Dark with the user's theme apparently forgotten.
describe('concurrent writes', () => {
  it('keeps every key when merges are fired without awaiting', async () => {
    const store = createJsonFileStore('theme.json', 'Theme')
    await Promise.all([
      store.merge({ theme: 'my-sunset' }),
      store.merge({ codeTheme: 'monokai' }),
      store.merge({ markdownTheme: 'prose' }),
    ])
    expect(read()).toEqual({
      theme: 'my-sunset', codeTheme: 'monokai', markdownTheme: 'prose',
    })
  })

  it('leaves the file parseable — never a splice of two payloads', async () => {
    const store = createJsonFileStore('theme.json', 'Theme')
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => store.merge({ [`k${i}`]: i })),
    )
    const text = disk.files.get('/data/theme.json') ?? ''
    expect(() => JSON.parse(text)).not.toThrow()
    expect(Object.keys(read())).toHaveLength(12)
  })

  it('applies writes in call order, so the last one is what lands', async () => {
    const store = createJsonFileStore('theme.json', 'Theme')
    await Promise.all([
      store.merge({ theme: 'first' }),
      store.merge({ theme: 'second' }),
      store.merge({ theme: 'third' }),
    ])
    expect(read()).toEqual({ theme: 'third' })
  })

  it('does not let a read overtake a merge that is already queued', async () => {
    const store = createJsonFileStore('theme.json', 'Theme')
    const write = store.merge({ theme: 'my-sunset' })
    const seen = await store.read<{ theme?: string }>()
    await write
    expect(seen.theme).toBe('my-sunset')
  })

  it('survives a failing write without wedging the queue', async () => {
    const store = createJsonFileStore('theme.json', 'Theme')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const original = (disk.api.file as { write: unknown }).write
    ;(disk.api.file as Record<string, unknown>).write = async () => {
      throw new Error('EACCES')
    }
    await store.merge({ theme: 'doomed' })
    ;(disk.api.file as Record<string, unknown>).write = original
    await store.merge({ theme: 'fine' })
    expect(read()).toEqual({ theme: 'fine' })
    warn.mockRestore()
  })
})
