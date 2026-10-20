import { afterEach, expect, it } from 'vitest'
import { backgroundGalleryBase, getThemeBackgroundPreferences, selectedThemeBackgrounds, themeBackgroundGallery } from './theme-backgrounds'
import { THEMES, registerCustomThemes } from './themes'
import { sceneDataUri, themeIconUri } from './themeScenes'

afterEach(() => registerCustomThemes([]))

it('keeps authored artwork and icons intact while offering the parent gallery as extra choices', () => {
  registerCustomThemes([{ ...THEMES.arctic, id: 'custom-ice', basedOn: 'arctic', backgroundImage: 'data:image/png;base64,custom', iconImage: 'data:image/png;base64,icon', custom: true }])
  const gallery = themeBackgroundGallery('custom-ice')
  expect(gallery[0]).toMatchObject({ id: 'default', url: 'data:image/png;base64,custom', source: 'theme' })
  expect(gallery.find(image => image.id === 'arctic:original')?.url).toBe(sceneDataUri('arctic'))
  expect(themeIconUri('custom-ice')).toBe('data:image/png;base64,icon')
  expect(getThemeBackgroundPreferences('custom-ice', {})).toEqual({ selectedIds: ['default'], intervalSeconds: 30 })
  expect(backgroundGalleryBase('legacy-arctic')).toBe('arctic')
  THEMES['custom-ice'].basedOn = 'custom-ice'
  expect(backgroundGalleryBase('custom-ice')).toBe('dark')
})

it('retains selection order, skips unavailable files and provides original artwork as recovery', () => {
  const gallery = themeBackgroundGallery('forest', [
    { id: 'folder:one:a', folderId: 'one', name: 'A.png', url: 'asset:a', animated: false },
    { id: 'folder:one:b', folderId: 'one', name: 'B.gif', url: 'asset:b', posterUrl: 'asset:poster-b', animated: true },
  ])
  expect(selectedThemeBackgrounds(gallery, ['folder:one:b', 'missing', 'folder:one:a', 'folder:one:b']).map(image => image.id)).toEqual(['folder:one:b', 'folder:one:a'])
  expect(selectedThemeBackgrounds(gallery, ['missing'])).toEqual([gallery[0]])
  expect(gallery.find(image => image.id === 'folder:one:a')?.thumbnailUrl).toMatch(/^data:image\/svg\+xml,/)
  expect(gallery.find(image => image.id === 'folder:one:a')?.posterUrl).toBe('asset:a')
  expect(gallery.at(-1)).toMatchObject({ kind: 'gif', thumbnailUrl: 'asset:poster-b', source: 'folder' })
})

it('recognises a portable animated WebP backdrop without decoding its full image', () => {
  const header = new Uint8Array(30)
  header.set(new TextEncoder().encode('RIFF'), 0)
  header.set(new TextEncoder().encode('WEBPVP8X'), 8)
  header[20] = 2
  const animated = `data:image/webp;base64,${btoa(String.fromCharCode(...header))}`
  registerCustomThemes([{ ...THEMES.forest, id: 'custom-webp', basedOn: 'forest', backgroundImage: animated, custom: true }])
  expect(themeBackgroundGallery('custom-webp')[0]).toMatchObject({ kind: 'gif', url: animated })
  expect(themeBackgroundGallery('custom-webp')[0].posterUrl).toMatch(/^data:image\/svg\+xml,/)
})
