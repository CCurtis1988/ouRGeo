import { afterEach, describe, expect, it } from 'vitest'
import { BUILTIN_THEME_LIST, THEMES, registerCustomThemes } from './themes'
import { generatedSceneUri, sceneBackdropStyle, sceneDataUri, themeIconUri } from './themeScenes'

afterEach(() => registerCustomThemes([]))

describe('shipped theme paintings', () => {
  it('gives every shipped theme its own bundled painting in both locations', () => {
    const images = BUILTIN_THEME_LIST.filter(theme => !theme.legacy).map((theme) => {
      const image = sceneDataUri(theme.id)
      expect(image).toContain(`/assets/themes/${theme.id}.webp`)
      expect(themeIconUri(theme.id)).toBe(image)
      expect(sceneBackdropStyle(theme.id).filter).toBe(theme.id === 'heaven' ? 'contrast(0.9) saturate(0.9)' : 'none')
      return image
    })
    expect(new Set(images).size).toBe(BUILTIN_THEME_LIST.filter(theme => !theme.legacy).length)
    expect(sceneBackdropStyle('heaven').opacity).toBe(0.30)
  })

  it('keeps every original scene and syntax palette available as a legacy theme', () => {
    const legacy = BUILTIN_THEME_LIST.filter(theme => theme.legacy)
    expect(legacy).toHaveLength(10)
    for (const theme of legacy) {
      expect(sceneDataUri(theme.id)).toBe(generatedSceneUri(theme.id))
      expect(sceneBackdropStyle(theme.id)).toMatchObject({ filter: 'grayscale(1)', opacity: 0.15 })
      expect(theme.defaultCodeTheme).toBe(theme.basedOn)
      expect(theme.defaultMarkdownTheme).toBe(theme.basedOn)
    }
  })

  it('preserves a custom theme’s palette scene and original backdrop defaults', () => {
    registerCustomThemes([{ ...THEMES.arctic, id: 'my-arctic', custom: true, basedOn: 'arctic' }])
    expect(sceneDataUri('my-arctic')).toBe(generatedSceneUri('my-arctic'))
    expect(themeIconUri('my-arctic')).toBe(generatedSceneUri('my-arctic'))
    expect(sceneBackdropStyle('my-arctic')).toMatchObject({ filter: 'grayscale(1)', opacity: 0.15 })
  })

  it('preserves custom uploads and their explicit presentation settings', () => {
    registerCustomThemes([{
      ...THEMES.forest, id: 'my-forest', custom: true, basedOn: 'forest',
      backgroundImage: 'data:image/png;base64,backdrop', iconImage: 'data:image/png;base64,card',
      backgroundGrayscale: false, backgroundOpacity: 0.42,
    }])
    expect(sceneDataUri('my-forest')).toBe('data:image/png;base64,backdrop')
    expect(themeIconUri('my-forest')).toBe('data:image/png;base64,card')
    expect(sceneBackdropStyle('my-forest')).toMatchObject({ filter: 'none', opacity: 0.42 })
  })
})
