import { useEffect, useState } from 'react'
import type { ThemeBackgroundImage } from '@/lib/theme-backgrounds'
import { needsThemeBackgroundPoster, resolveThemeBackgroundPoster, resolveThemeBackgroundThumbnail } from '@/lib/theme-background-posters'

export function useThemeBackgroundPoster(image: ThemeBackgroundImage, mode: 'thumbnail' | 'poster' = 'thumbnail'): string {
  const [resolved, setResolved] = useState<{ url: string; mode: string; poster: string } | null>(null)
  const { url, posterUrl, thumbnailUrl, kind, source } = image
  useEffect(() => {
    if (!needsThemeBackgroundPoster(image) && !(mode === 'thumbnail' && source === 'folder')) return
    let cancelled = false
    const pending = mode === 'thumbnail' ? resolveThemeBackgroundThumbnail(image) : resolveThemeBackgroundPoster(image)
    void pending.then(poster => { if (!cancelled) setResolved({ url, mode, poster }) })
    return () => { cancelled = true }
    // Labels and selection badges do not change the underlying file bytes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, posterUrl, thumbnailUrl, kind, source, mode])
  return resolved?.url === url && resolved.mode === mode ? resolved.poster : mode === 'poster' ? posterUrl : thumbnailUrl
}
