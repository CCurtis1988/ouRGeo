// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { ThemeBackground } from './ThemeBackground'
import { THEMES, registerCustomThemes } from '@/lib/themes'
import { useThemeBackgroundPlaybackStore } from '@/lib/theme-background-playback'
import { useThemeBackgroundStore } from '@/store/theme-backgrounds'

afterEach(() => {
  cleanup()
  registerCustomThemes([])
  useThemeBackgroundPlaybackStore.setState({ current: null, previous: null, reducedMotion: false, visible: true })
  useThemeBackgroundStore.setState({ preferences: {}, strengthPreview: {} })
})

it('shows light Field photographs more clearly by default and reaches unfiltered zero/full strength in every pane', () => {
  const first = render(<ThemeBackground themeId="field-linen" />)
  const second = render(<ThemeBackground themeId="field-linen" />)
  const backdrops = [first.container.firstElementChild, second.container.firstElementChild] as HTMLElement[]
  expect(backdrops[0].style.opacity).toBe('0.35')
  act(() => { useThemeBackgroundStore.getState().previewStrength('field-linen', 100) })
  for (const backdrop of backdrops) expect([backdrop.style.opacity, backdrop.style.filter]).toEqual(['1', 'none'])
  act(() => { useThemeBackgroundStore.getState().previewStrength('field-linen', 0) })
  for (const backdrop of backdrops) expect(backdrop.style.opacity).toBe('0')
})

it('never briefly animates an authored GIF while a reduced-motion poster is still being decoded', () => {
  const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='
  registerCustomThemes([{ ...THEMES.forest, id: 'custom-gif', basedOn: 'forest', backgroundImage: gif, custom: true }])
  useThemeBackgroundPlaybackStore.setState({ reducedMotion: true, current: null })
  const { container } = render(<ThemeBackground themeId="custom-gif" />)
  const backdrop = container.firstElementChild as HTMLElement
  expect(backdrop.style.backgroundImage).toContain('data:image/svg+xml,')
  expect(backdrop.style.backgroundImage).not.toContain('image/gif')
})
