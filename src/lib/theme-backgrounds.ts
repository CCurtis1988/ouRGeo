import { THEMES, BUILTIN_THEME_LIST } from '@/lib/themes'
import { FIELD_SCENE_NAMES } from '@/lib/field-theme-scenes'
import { generatedSceneUri, sceneDataUri, sceneBackdropStyle } from '@/lib/themeScenes'
import type { ThemeFolderImage } from '@/lib/theme-backgrounds-types'

export interface ThemeBackgroundImage {
  id: string
  label: string
  url: string
  posterUrl: string
  thumbnailUrl: string
  /** Animated WebP/APNG use the GIF playback path; their badge says Animated. */
  kind: 'image' | 'gif'
  source: 'theme' | 'gallery' | 'folder'
  folderId?: string
  width?: number
  height?: number
}

export interface ThemeBackgroundPreferences {
  selectedIds: string[]
  intervalSeconds: number
  /** Omitted in older files: use the authored theme's default presentation. */
  imageStrength?: number
}
export type ThemeBackgroundPreferencesMap = Record<string, ThemeBackgroundPreferences>
export const DEFAULT_BACKGROUND_INTERVAL = 30
export const MIN_BACKGROUND_INTERVAL = 5
export const MAX_BACKGROUND_INTERVAL = 3600

export function clampImageStrength(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0
}

/** Explicit strength means the original image's colours, including at 100%.
 * Authored legacy/custom filters still apply until the user adjusts the slider. */
export function backgroundPresentation(themeId: string, strength?: number): ReturnType<typeof sceneBackdropStyle> {
  const original = sceneBackdropStyle(themeId)
  return strength === undefined ? original : { ...original, opacity: clampImageStrength(strength) / 100, filter: 'none' }
}

// URL imports package the complete gallery offline without decoding it. Only
// thumbnails and the two active crossfade layers ever request image pixels.
const galleryAssets = import.meta.glob<string>('../assets/themes/gallery/*.{webp,gif}', { eager: true, query: '?url', import: 'default' })
const baseThemes = new Set(BUILTIN_THEME_LIST.filter(theme => !theme.legacy).map(theme => theme.id))
const sceneNames: Record<string, string[]> = {
  ...Object.fromEntries(Object.entries(FIELD_SCENE_NAMES).map(([id, names]) => [id, names.slice(1)])),
  dark: ['Moonlit observatory', 'Silverwater gorge', 'Quiet harbour', 'Mountain railway', 'Night garden'],
  bespin: ['Amber skyport', 'Cloud gardens', 'Golden observatory', 'Highland citadel', 'Cloudsea archipelago'],
  neonLights: ['Rain station', 'Electric canal', 'Rooftop sanctuary', 'Neon arcade', 'Skyline after rain'],
  forest: ['Fern ravine', 'Canopy refuge', 'Woodland falls', 'Misty grove', 'Meadow at dawn'],
  midnightDream: ['Starlit sanctuary', 'Nebula desert', 'Celestial arch', 'Dream orchard', 'Moonlit islands'],
  candyAddiction: ['Crystal lagoon', 'Sugar conservatory', 'Raspberry canyon', 'Confection village', 'Lavender candy dunes'],
  heaven: ['Skyward gardens', 'Cloud cathedral', 'Sunlit colonnade', 'Celestial coast', 'Cloudwater falls'],
  volcanic: ['Obsidian river', 'Caldera observatory', 'Basalt coast', 'Ember canyon', 'Fireglass plain'],
  arctic: ['Aurora harbour', 'Glacier cathedral', 'Polar observatory', 'Iceberg passage', 'Snowlight falls'],
  retroTerminal: ['Phosphor archive', 'Night control room', 'Signal station', 'Quiet workstation', 'Mainframe corridor'],
}

function animatedAuthoredImage(uri: string): boolean {
  if (/^data:image\/gif[;,]/i.test(uri)) return true
  // A portable Theme Studio backdrop has no file catalogue entry. Animated
  // WebP declares its animation bit in this fixed header, so inspecting thirty
  // bytes avoids decoding megabytes merely to build a gallery or respect motion.
  if (/^data:image\/webp;base64,/i.test(uri)) {
    try {
      const start = uri.indexOf(',') + 1
      const header = atob(uri.slice(start, start + 40))
      return header.slice(0, 4) === 'RIFF' && header.slice(8, 12) === 'WEBP' && header.slice(12, 16) === 'VP8X' && Boolean(header.charCodeAt(20) & 2)
    } catch { return false }
  }
  return false
}

/** A custom theme keeps its authored artwork as the default. Its parent only
 * supplies extra choices; selecting none of those can never repaint the theme. */
export function backgroundGalleryBase(themeId: string): string {
  let id = themeId
  const seen = new Set<string>()
  while (!seen.has(id)) {
    if (baseThemes.has(id)) return id
    seen.add(id)
    const parent = THEMES[id]?.basedOn
    if (!parent) break
    id = parent
  }
  return 'dark'
}

export function themeBackgroundGallery(themeId: string, externalImages: readonly ThemeFolderImage[] = []): ThemeBackgroundImage[] {
  const authored = sceneDataUri(themeId)
  const authoredAnimated = animatedAuthoredImage(authored)
  const result: ThemeBackgroundImage[] = [{
    id: 'default', label: FIELD_SCENE_NAMES[themeId]?.[0] ?? 'Original artwork', url: authored,
    posterUrl: authoredAnimated ? generatedSceneUri(themeId) : authored,
    thumbnailUrl: galleryAssets[`../assets/themes/gallery/${themeId}-default-thumb.webp`] ?? (authoredAnimated ? generatedSceneUri(themeId) : authored),
    kind: authoredAnimated ? 'gif' : 'image', source: 'theme',
  }]
  const base = backgroundGalleryBase(themeId)
  if (themeId !== base) {
    const original = sceneDataUri(base)
    result.push({ id: `${base}:original`, label: `${THEMES[base]?.label ?? 'Original'} painting`, url: original, posterUrl: original, thumbnailUrl: galleryAssets[`../assets/themes/gallery/${base}-default-thumb.webp`] ?? original, kind: 'image', source: 'gallery' })
  }
  for (let index = 1; index <= 5; index++) {
    const url = galleryAssets[`../assets/themes/gallery/${base}-${index}.webp`]
    if (url) result.push({ id: `${base}:${index}`, label: sceneNames[base]?.[index - 1] ?? `Photograph ${index}`, url, posterUrl: url, thumbnailUrl: galleryAssets[`../assets/themes/gallery/${base}-${index}-thumb.webp`] ?? url, kind: 'image', source: 'gallery' })
  }
  const loop = galleryAssets[`../assets/themes/gallery/${base}-loop.gif`]
  const poster = galleryAssets[`../assets/themes/gallery/${base}-loop-poster.webp`]
  if (loop && poster) result.push({ id: `${base}:loop`, label: 'Original artwork · ambient loop', url: loop, posterUrl: poster, thumbnailUrl: galleryAssets[`../assets/themes/gallery/${base}-loop-thumb.webp`] ?? poster, kind: 'gif', source: 'gallery' })
  for (const image of externalImages) result.push({
    id: image.id, label: image.name, url: image.url,
    posterUrl: image.posterUrl ?? (image.animated ? generatedSceneUri(themeId) : image.url),
    // A grid must never decode each original 24-megapixel photograph merely
    // to fill a small card. The async thumbnail hook replaces this placeholder.
    thumbnailUrl: image.posterUrl ?? generatedSceneUri(themeId),
    kind: image.animated || /\.gif$/i.test(image.name) ? 'gif' : 'image', source: 'folder', folderId: image.folderId,
    width: image.width, height: image.height,
  })
  return result
}

export function getThemeBackgroundPreferences(themeId: string, preferences: ThemeBackgroundPreferencesMap): ThemeBackgroundPreferences {
  return Object.prototype.hasOwnProperty.call(preferences, themeId) ? preferences[themeId] : { selectedIds: ['default'], intervalSeconds: DEFAULT_BACKGROUND_INTERVAL }
}

export function normaliseBackgroundSelection(ids: readonly string[]): string[] {
  const unique = [...new Set(ids.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 2048))]
  return unique.length ? unique.slice(0, 1000) : ['default']
}

export function clampBackgroundInterval(seconds: number): number {
  return Number.isFinite(seconds) ? Math.max(MIN_BACKGROUND_INTERVAL, Math.min(MAX_BACKGROUND_INTERVAL, Math.round(seconds))) : DEFAULT_BACKGROUND_INTERVAL
}

/** Missing linked files remain selected in preferences for a later relink, but
 * never produce a blank editor or an interval spent showing a broken image. */
export function selectedThemeBackgrounds(gallery: readonly ThemeBackgroundImage[], selectedIds: readonly string[]): ThemeBackgroundImage[] {
  const images = new Map(gallery.map(image => [image.id, image]))
  const selected = [...new Set(selectedIds)].flatMap(id => images.has(id) ? [images.get(id)!] : [])
  return selected.length ? selected : gallery.slice(0, 1)
}
