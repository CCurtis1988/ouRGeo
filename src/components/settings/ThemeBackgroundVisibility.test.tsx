// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
vi.mock('@/store/theme', async () => {
  const { create } = await import('zustand')
  return { useThemeStore: create(() => ({ current: 'field-linen', revision: 0 })) }
})
import { ThemeBackgroundVisibility } from './ThemeBackgroundVisibility'
import { useThemeBackgroundStore } from '@/store/theme-backgrounds'

const write = vi.fn()
let files: Map<string, string>
beforeEach(() => {
  files = new Map()
  write.mockReset().mockImplementation(async (path: string, contents: string) => { files.set(path, contents) })
  useThemeBackgroundStore.setState({ initialized: true, preferences: {}, strengthPreview: {}, folders: [], error: null })
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: {
    app: { getDataPath: async () => '/visibility-test' },
    file: { read: async (path: string) => { if (!files.has(path)) throw new Error('ENOENT'); return files.get(path) }, write },
  } })
})
afterEach(cleanup)

it('previews without writing, saves on keyboard release, and restores only visibility', async () => {
  useThemeBackgroundStore.setState({ preferences: { 'field-linen': { selectedIds: ['default'], intervalSeconds: 75 } } })
  render(<ThemeBackgroundVisibility />)
  const slider = screen.getByRole('slider', { name: 'Background visibility' })
  expect(slider).toHaveValue('35')
  fireEvent.change(slider, { target: { value: '100' } })
  expect(useThemeBackgroundStore.getState().strengthPreview['field-linen']).toBe(100)
  expect(write).not.toHaveBeenCalled()
  fireEvent.keyUp(slider, { key: 'End' })
  fireEvent.blur(slider)
  await waitFor(() => expect(useThemeBackgroundStore.getState().preferences['field-linen'].imageStrength).toBe(100))
  expect(write).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Theme default' }))
  await waitFor(() => expect(slider).toHaveValue('35'))
  expect(useThemeBackgroundStore.getState().preferences['field-linen']).toEqual({ selectedIds: ['default'], intervalSeconds: 75 })
})

it('saves an unfinished drag when the settings close', async () => {
  const view = render(<ThemeBackgroundVisibility />)
  fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } })
  view.unmount()
  await waitFor(() => expect(useThemeBackgroundStore.getState().preferences['field-linen'].imageStrength).toBe(0))
  expect(write).toHaveBeenCalledTimes(1)
})
