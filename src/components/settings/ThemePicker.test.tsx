// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/store/theme', async () => {
  const { create } = await import('zustand')
  return { useThemeStore: create<{ current: string; revision: number; setTheme: (id: string) => void }>(set => ({ current: 'dark', revision: 0, setTheme: id => set({ current: id }) })) }
})
vi.mock('@/store/custom-themes', async () => {
  const { create } = await import('zustand')
  return { useCustomThemeStore: create(() => ({ system: [] })) }
})

import { useThemeStore } from '@/store/theme'
import { ThemePicker } from './ThemePicker'
import { applyTheme, THEMES, registerCustomThemes } from '@/lib/themes'
import { FIELD_THEME_LIST } from '@/lib/field-themes'
import { contrastRatio, hslTripleToHex, systemThemeFromTemplate, systemThemeToDef } from '@/lib/custom-themes'

beforeEach(() => { useThemeStore.setState({ current: 'dark', revision: 0 }) })
afterEach(() => { cleanup(); registerCustomThemes([]); applyTheme('dark') })

it('lets the two Forest themes be selected independently in their collections', () => {
  render(<ThemePicker />)
  fireEvent.click(screen.getByRole('tab', { name: 'Field collection' }))
  expect(screen.queryByRole('button', { name: 'Dark' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Forest' }))
  expect(useThemeStore.getState().current).toBe('field-forest')
  expect(screen.getByRole('tab', { name: 'Field collection' }).getAttribute('aria-selected')).toBe('true')
  fireEvent.click(screen.getByRole('tab', { name: 'Illustrated' }))
  fireEvent.click(screen.getByRole('button', { name: 'Forest' }))
  expect(useThemeStore.getState().current).toBe('forest')
  expect(screen.queryByRole('button', { name: 'Legacy Dark' })).toBeNull()
})

it('follows an assistant theme switch and supports keyboard navigation between collections', () => {
  render(<ThemePicker />)
  act(() => { useThemeStore.setState({ current: 'field-linen' }) })
  expect(screen.getByRole('button', { name: 'Linen' }).getAttribute('aria-pressed')).toBe('true')
  const field = screen.getByRole('tab', { name: 'Field collection' })
  field.focus()
  fireEvent.keyDown(field, { key: 'Home' })
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Illustrated' }))
  expect(useThemeStore.getState().current).toBe('field-linen')
  fireEvent.keyDown(document.activeElement!, { key: 'End' })
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Custom' }))
  expect(screen.getByText(/No custom themes yet/)).toBeTruthy()
})

it('keeps accent and destructive labels readable after Field duplication and recolouring', () => {
  for (const field of FIELD_THEME_LIST) {
    const copy = systemThemeToDef(systemThemeFromTemplate(field.id, 'My field theme', 'my-field-theme'))
    registerCustomThemes([copy])
    for (const id of [field.id, copy.id]) {
      applyTheme(id)
      expect(document.documentElement.dataset.geoThemeInks).toBe('field')
      expect(document.documentElement.dataset.geoThemeCollection).toBe(id === field.id ? 'field' : '')
      for (const fill of ['accent', 'accent-hover', 'error', 'error-hover']) {
        const ink = hslTripleToHex(document.documentElement.style.getPropertyValue(`--geo-on-${fill}`))
        const background = hslTripleToHex(fill === 'error-hover' ? document.documentElement.style.getPropertyValue('--geo-error-hover') : THEMES[id].vars[`--geo-${fill}`])
        expect(contrastRatio(ink, background), `${id} ${fill}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  }
  const edited = THEMES['my-field-theme']
  edited.vars['--geo-accent'] = '240 100% 30%'
  edited.vars['--geo-accent-hover'] = '60 100% 80%'
  applyTheme(edited.id)
  const primaryInk = document.documentElement.style.getPropertyValue('--geo-on-accent')
  const hoverInk = document.documentElement.style.getPropertyValue('--geo-on-accent-hover')
  expect(contrastRatio(hslTripleToHex(primaryInk), hslTripleToHex(edited.vars['--geo-accent']))).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(hslTripleToHex(hoverInk), hslTripleToHex(edited.vars['--geo-accent-hover']))).toBeGreaterThanOrEqual(4.5)
  expect(primaryInk).not.toBe(hoverInk)
  applyTheme('forest')
  expect(document.documentElement.dataset.geoThemeInks).toBe('')
  expect(document.documentElement.style.getPropertyValue('--geo-on-error')).toBe('')
})

it('puts a duplicated Field theme in Custom and keeps all four categories available', () => {
  const copy = systemThemeToDef(systemThemeFromTemplate('field-linen', 'My linen', 'my-linen'))
  registerCustomThemes([copy])
  useThemeStore.setState({ current: copy.id, revision: 1 })
  render(<ThemePicker />)
  expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Illustrated', 'Legacy', 'Field collection', 'Custom'])
  expect(screen.getByRole('tab', { name: 'Custom' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('button', { name: /My linen/ })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('tab', { name: 'Legacy' }))
  expect(screen.getAllByRole('button')).toHaveLength(10)
})
