import { create } from 'zustand'
import { THEMES } from '@/lib/themes'
import { useThemeStore } from '@/store/theme'
import { useThemeBackgroundStore } from '@/store/theme-backgrounds'
import { getThemeBackgroundPreferences, selectedThemeBackgrounds, themeBackgroundGallery, type ThemeBackgroundImage } from '@/lib/theme-backgrounds'
import { pruneThemeBackgroundPosters, resolveThemeBackgroundPoster } from '@/lib/theme-background-posters'

export const BACKGROUND_CROSSFADE_MS = 650
interface BackgroundFrame { id: string; url: string; themeId: string; animated: boolean }
interface BackgroundPlaybackState {
  current: BackgroundFrame | null
  previous: BackgroundFrame | null
  reducedMotion: boolean
  visible: boolean
}
export const useThemeBackgroundPlaybackStore = create<BackgroundPlaybackState>(() => ({
  current: null, previous: null, reducedMotion: false, visible: true,
}))

/** One clock belongs to the workspace, rather than each editor mount. Opening
 * a second editor or changing tabs therefore cannot restart or desynchronise a
 * slideshow, and only the current and next selected images are preloaded. */
export function startThemeBackgroundPlayback(): () => void {
  let disposed = false
  let generation = 0
  let signature = ''
  let index = 0
  let images: ThemeBackgroundImage[] = []
  let themeId = useThemeStore.getState().current
  let intervalMs = 30_000
  let timer: ReturnType<typeof setTimeout> | undefined
  let fadeTimer: ReturnType<typeof setTimeout> | undefined
  let media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined
  let reducedMotion = media?.matches ?? false
  let visible = document.visibilityState !== 'hidden'
  const loaded = new Map<string, Promise<boolean>>()
  const failed = new Set<string>()
  const pendingLoads = new Set<() => void>()
  useThemeBackgroundPlaybackStore.setState({ reducedMotion, visible })

  const load = (url: string): Promise<boolean> => {
    const existing = loaded.get(url)
    if (existing) return existing
    const promise = new Promise<boolean>(resolve => {
      const image = new Image()
      let settled = false
      const finish = (available: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        pendingLoads.delete(cancel)
        image.onload = null
        image.onerror = null
        if (!available) failed.add(url)
        resolve(available)
      }
      const cancel = (): void => finish(false)
      const timeout = setTimeout(cancel, 15_000)
      pendingLoads.add(cancel)
      image.decoding = 'async'
      image.onload = () => finish(true)
      image.onerror = () => finish(false)
      image.src = url
    })
    loaded.set(url, promise)
    // Keep promises rather than Image objects: old full-resolution decoders
    // can be collected after their crossfade instead of pinning the gallery.
    if (loaded.size > 32) loaded.delete(loaded.keys().next().value!)
    return promise
  }
  const urlOf = (image: ThemeBackgroundImage): string => reducedMotion || !visible ? image.posterUrl : image.url
  const clearTimer = (): void => { if (timer !== undefined) clearTimeout(timer); timer = undefined }
  const prunePosters = (): void => {
    const state = useThemeBackgroundStore.getState()
    const frames = useThemeBackgroundPlaybackStore.getState()
    pruneThemeBackgroundPosters(new Set([
      ...state.folders.flatMap(folder => folder.images.map(image => image.url)),
      ...Object.values(THEMES).flatMap(theme => theme.backgroundImage ? [theme.backgroundImage] : []),
    ]), new Set([frames.current?.url, frames.previous?.url].filter((url): url is string => Boolean(url))))
  }

  const publish = (image: ThemeBackgroundImage, token: number, resolvedUrl = urlOf(image)): void => {
    if (disposed || token !== generation) return
    const current: BackgroundFrame = { id: image.id, url: resolvedUrl, themeId, animated: image.kind === 'gif' && resolvedUrl === image.url }
    const old = useThemeBackgroundPlaybackStore.getState().current
    if (old?.id === current.id && old.url === current.url && old.themeId === current.themeId) return
    if (fadeTimer !== undefined) clearTimeout(fadeTimer)
    useThemeBackgroundPlaybackStore.setState({ current, previous: !reducedMotion && visible && old?.themeId === themeId ? old : null })
    prunePosters()
    if (!reducedMotion && visible) fadeTimer = setTimeout(() => { useThemeBackgroundPlaybackStore.setState({ previous: null }); prunePosters() }, BACKGROUND_CROSSFADE_MS)
  }

  const schedule = (): void => {
    clearTimer()
    if (disposed || reducedMotion || !visible || images.length < 2) return
    // Prefetch just one upcoming image. The rest of the library stays on disk.
    void load(urlOf(images[(index + 1) % images.length]))
    timer = setTimeout(() => { void show((index + 1) % images.length, generation) }, intervalMs)
  }
  const show = async (nextIndex: number, token: number): Promise<void> => {
    for (let attempt = 0; attempt < images.length; attempt++) {
      const candidateIndex = (nextIndex + attempt) % images.length
      const image = images[candidateIndex]
      if (!image) return
      const url = reducedMotion || !visible ? await resolveThemeBackgroundPoster(image, true) : image.url
      if (disposed || token !== generation) return
      const available = !failed.has(url) && await load(url)
      if (disposed || token !== generation) return
      if (available) { index = candidateIndex; publish(image, token, url); schedule(); return }
    }
    // A removed or unreadable folder never leaves a broken image on screen.
    const original = themeBackgroundGallery(themeId)[0]
    if (await load(original.posterUrl) && !disposed && token === generation) publish({ ...original, url: original.posterUrl, kind: 'image' }, token)
    schedule()
  }

  const refresh = (force = false): void => {
    const theme = useThemeStore.getState()
    const state = useThemeBackgroundStore.getState()
    const preference = getThemeBackgroundPreferences(theme.current, state.preferences)
    const external = state.folders.filter(folder => folder.themeId === theme.current && folder.status === 'ready').flatMap(folder => folder.images)
    prunePosters()
    const nextImages = selectedThemeBackgrounds(themeBackgroundGallery(theme.current, external), preference.selectedIds)
    const nextSignature = JSON.stringify([theme.current, theme.revision, state.folderRevision, preference.intervalSeconds, nextImages.map(image => [image.id, image.url, image.posterUrl])])
    if (!force && signature === nextSignature) return
    const previousId = images[index]?.id
    const sameTheme = themeId === theme.current
    signature = nextSignature
    for (const cancel of pendingLoads) cancel()
    for (const url of failed) loaded.delete(url)
    failed.clear()
    for (const [url] of loaded) {
      // Failed loads must be retried after an explicit folder rescan, even if
      // fixing permissions did not change the file's size or modification time.
      if (!nextImages.some(image => image.url === url || image.posterUrl === url)) loaded.delete(url)
    }
    themeId = theme.current
    intervalMs = preference.intervalSeconds * 1000
    images = nextImages
    index = sameTheme ? Math.max(0, images.findIndex(image => image.id === previousId)) : 0
    generation++
    clearTimer()
    void show(index, generation)
  }
  const updateMotion = (): void => {
    const frame = useThemeBackgroundPlaybackStore.getState().current
    if (reducedMotion || !visible) {
      const image = frame?.themeId === themeId ? images.find(image => image.id === frame.id) : undefined
      const current = frame?.animated ? {
        ...frame, url: image?.posterUrl ?? themeBackgroundGallery(frame.themeId)[0].posterUrl, animated: false,
      } : frame
      // Freeze synchronously. A full-resolution first-frame decode can be
      // queued behind two other files; motion must stop before that promise
      // resolves, while already-static frames keep their current picture.
      if (fadeTimer !== undefined) clearTimeout(fadeTimer)
      useThemeBackgroundPlaybackStore.setState({ reducedMotion, visible, current, previous: null })
      prunePosters()
    } else useThemeBackgroundPlaybackStore.setState({ reducedMotion, visible })
    refresh(true)
  }
  const onMotion = (): void => {
    reducedMotion = media?.matches ?? false
    updateMotion()
  }
  const onVisibility = (): void => {
    visible = document.visibilityState !== 'hidden'
    updateMotion()
  }
  media?.addEventListener('change', onMotion)
  document.addEventListener('visibilitychange', onVisibility)
  const unsubscribeTheme = useThemeStore.subscribe(() => refresh())
  const unsubscribeBackgrounds = useThemeBackgroundStore.subscribe(() => refresh())
  refresh()
  return () => {
    disposed = true
    generation++
    clearTimer()
    if (fadeTimer !== undefined) clearTimeout(fadeTimer)
    for (const cancel of pendingLoads) cancel()
    unsubscribeTheme()
    unsubscribeBackgrounds()
    media?.removeEventListener('change', onMotion)
    media = undefined
    document.removeEventListener('visibilitychange', onVisibility)
    useThemeBackgroundPlaybackStore.setState({ current: null, previous: null })
    prunePosters()
  }
}
