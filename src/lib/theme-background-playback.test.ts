import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let documentEvents: EventTarget & { visibilityState: string }
let media: EventTarget & { matches: boolean }
let stop: (() => void) | undefined
let loaded: string[]
beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  documentEvents = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  media = Object.assign(new EventTarget(), { matches: false })
  loaded = []
  vi.stubGlobal('document', documentEvents)
  vi.stubGlobal('window', { matchMedia: () => media })
  vi.stubGlobal('Image', class {
    onload?: () => void
    onerror?: () => void
    set src(url: string) { loaded.push(url); Promise.resolve().then(() => url.includes('broken') ? this.onerror?.() : this.onload?.()) }
  })
})
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const setup = async (ids = ['folder:one:a', 'folder:one:b']) => {
  const { useThemeStore } = await import('@/store/theme')
  const { useThemeBackgroundStore } = await import('@/store/theme-backgrounds')
  const { startThemeBackgroundPlayback, useThemeBackgroundPlaybackStore } = await import('./theme-background-playback')
  useThemeStore.setState({ current: 'forest', revision: 0 })
  useThemeBackgroundStore.setState({ initialized: true, preferences: { forest: { selectedIds: ids, intervalSeconds: 5 } }, folders: [{ id: 'one', themeId: 'forest', name: 'Photos', path: '/photos', status: 'ready', images: [
    { id: 'folder:one:a', folderId: 'one', name: 'A.png', url: 'image:a', animated: false },
    { id: 'folder:one:b', folderId: 'one', name: 'B.gif', url: 'image:b.gif', posterUrl: 'image:b-poster', animated: true },
    { id: 'folder:one:broken', folderId: 'one', name: 'Missing.png', url: 'image:broken', animated: false },
  ] }] })
  stop = startThemeBackgroundPlayback()
  await vi.advanceTimersByTimeAsync(0)
  return { playback: useThemeBackgroundPlaybackStore, preferences: useThemeBackgroundStore, theme: useThemeStore }
}

it('uses one shared slideshow clock, preloads just the next selection and preserves position through editor-independent changes', async () => {
  const { playback, preferences } = await setup()
  expect(playback.getState().current?.id).toBe('folder:one:a')
  expect(loaded).toEqual(['image:a', 'image:b.gif'])
  await vi.advanceTimersByTimeAsync(4999)
  expect(playback.getState().current?.id).toBe('folder:one:a')
  await vi.advanceTimersByTimeAsync(1)
  expect(playback.getState()).toMatchObject({ current: { id: 'folder:one:b' }, previous: { id: 'folder:one:a' } })
  await vi.advanceTimersByTimeAsync(650)
  expect(playback.getState().previous).toBeNull()
  preferences.setState({ foldersLoading: true })
  await vi.advanceTimersByTimeAsync(4350)
  expect(playback.getState().current?.id).toBe('folder:one:a')
})

it('honours reduced motion with a static GIF poster and pauses the same slideshow while hidden', async () => {
  const { playback } = await setup()
  await vi.advanceTimersByTimeAsync(5000)
  expect(playback.getState().current?.url).toBe('image:b.gif')
  media.matches = true
  media.dispatchEvent(new Event('change'))
  await vi.advanceTimersByTimeAsync(0)
  expect(playback.getState()).toMatchObject({ reducedMotion: true, current: { url: 'image:b-poster' }, previous: null })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(playback.getState().current?.id).toBe('folder:one:b')
  media.matches = false
  media.dispatchEvent(new Event('change'))
  await vi.advanceTimersByTimeAsync(0)
  documentEvents.visibilityState = 'hidden'
  documentEvents.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(30_000)
  expect(playback.getState().current?.url).toBe('image:b-poster')
  documentEvents.visibilityState = 'visible'
  documentEvents.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(5000)
  expect(playback.getState().current?.id).toBe('folder:one:a')
})

it('skips an unreadable selection and falls back safely after a linked folder disappears', async () => {
  const { playback, preferences } = await setup(['folder:one:broken', 'folder:one:b'])
  expect(playback.getState().current?.id).toBe('folder:one:b')
  preferences.setState({ folders: [] })
  await vi.advanceTimersByTimeAsync(0)
  expect(playback.getState().current?.id).toBe('default')
  expect(preferences.getState().preferences.forest.selectedIds).toEqual(['folder:one:broken', 'folder:one:b'])
  await vi.advanceTimersByTimeAsync(30_000)
  expect(playback.getState().current?.id).toBe('default')
})

it('does not schedule a slideshow for a single image or retain timers after the workspace closes', async () => {
  const { playback } = await setup(['folder:one:b'])
  await vi.advanceTimersByTimeAsync(60_000)
  expect(playback.getState().current?.id).toBe('folder:one:b')
  expect(loaded).toEqual(['image:b.gif'])
  stop?.()
  stop = undefined
  expect(vi.getTimerCount()).toBe(0)
  expect(playback.getState().current).toBeNull()
})

it('ignores a late preload after the user replaces the selected images', async () => {
  let finishOldImage!: () => void
  vi.stubGlobal('Image', class {
    onload?: () => void
    onerror?: () => void
    set src(url: string) {
      if (url === 'image:b.gif') { const oldHandler = this.onload; finishOldImage = () => oldHandler?.() }
      else Promise.resolve().then(() => this.onload?.())
    }
  })
  const { playback, preferences } = await setup()
  await vi.advanceTimersByTimeAsync(5000)
  preferences.setState({ preferences: { forest: { selectedIds: ['folder:one:a'], intervalSeconds: 5 } } })
  await vi.advanceTimersByTimeAsync(0)
  finishOldImage()
  await vi.advanceTimersByTimeAsync(30_000)
  expect(playback.getState().current?.id).toBe('folder:one:a')
  expect(vi.getTimerCount()).toBe(0)
})

it('recovers from an image request that never responds instead of leaving the slideshow stuck', async () => {
  vi.stubGlobal('Image', class {
    onload?: () => void
    onerror?: () => void
    set src(url: string) { if (url !== 'image:a') Promise.resolve().then(() => this.onload?.()) }
  })
  const { playback } = await setup()
  expect(playback.getState().current).toBeNull()
  await vi.advanceTimersByTimeAsync(15_000)
  expect(playback.getState().current?.id).toBe('folder:one:b')
})

it.each(['a', 'b'])('stops an already displayed animation immediately when reduced motion changes, even while its poster is queued (%s)', async selected => {
  let finishPoster!: (url: string) => void
  const posters = await import('./theme-background-posters')
  vi.spyOn(posters, 'resolveThemeBackgroundPoster').mockImplementation(() => new Promise(resolve => { finishPoster = resolve }))
  const { playback } = await setup([`folder:one:${selected}`])
  const previous = playback.getState().current
  expect(previous?.url).toBe(selected === 'b' ? 'image:b.gif' : 'image:a')
  media.matches = true
  media.dispatchEvent(new Event('change'))
  // This assertion intentionally runs before any microtask or timer, while
  // the decoder's promise remains blocked behind unrelated image work.
  expect(playback.getState().current?.url).toBe(selected === 'b' ? 'image:b-poster' : 'image:a')
  expect(playback.getState().previous).toBeNull()
  if (selected === 'a') expect(playback.getState().current).toBe(previous)
  await vi.advanceTimersByTimeAsync(2000)
  expect(playback.getState().current?.url).not.toBe('image:b.gif')
  finishPoster(selected === 'b' ? 'blob:actual-frozen-frame' : 'image:a')
  await vi.advanceTimersByTimeAsync(0)
  expect(playback.getState().current?.url).toBe(selected === 'b' ? 'blob:actual-frozen-frame' : 'image:a')
})
