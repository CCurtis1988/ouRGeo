// @vitest-environment jsdom
import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ThemeImageFolder } from '@/lib/theme-backgrounds-types'

vi.mock('@/store/theme', async () => {
  const { create } = await import('zustand')
  return { useThemeStore: create(() => ({ current: 'dark', revision: 0 })) }
})
vi.mock('@/lib/theme-backgrounds', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/theme-backgrounds')>()
  return { ...original, themeBackgroundGallery: (_theme: string, external: Array<{ id: string; name: string; folderId: string; url: string; posterUrl?: string; animated: boolean }> = []) => [
    { id: 'default', label: 'Original artwork', url: '/original.webp', posterUrl: '/original.webp', thumbnailUrl: '/original-thumb.webp', kind: 'image', source: 'theme' },
    { id: 'dark:1', label: 'Quiet lake', url: '/lake.webp', posterUrl: '/lake.webp', thumbnailUrl: '/lake-thumb.webp', kind: 'image', source: 'gallery' },
    { id: 'dark:loop', label: 'Ambient loop', url: '/loop.gif', posterUrl: '/loop-poster.webp', thumbnailUrl: '/loop-thumb.webp', kind: 'gif', source: 'gallery' },
    ...original.themeBackgroundGallery(_theme, external).filter(image => image.source === 'folder'),
  ] }
})
import { useThemeBackgroundStore } from '@/store/theme-backgrounds'
import { useThemeStore } from '@/store/theme'
import { useUiStore } from '@/store/ui'
import { ThemeBackgroundDialog, ThemeBackgroundSettings } from './ThemeBackgroundSettings'
import { useThemeBackgroundPlaybackStore } from '@/lib/theme-background-playback'

const forget = vi.fn(), link = vi.fn(), rescan = vi.fn(), relink = vi.fn()
let folders: ThemeImageFolder[]
let files: Map<string, string>
const folder = (): ThemeImageFolder => ({ id: 'pictures', themeId: 'dark', name: 'Field pictures', path: '/home/user/Pictures', status: 'ready', images: [{ id: 'folder:pictures:lake.jpg', folderId: 'pictures', name: 'My lake', url: '/external.jpg', animated: false }] })
const open = (): void => { render(<ThemeBackgroundDialog open onOpenChange={() => undefined} />) }

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', undefined)
  folders = []; files = new Map()
  forget.mockReset().mockImplementation(async () => { folders = [] })
  link.mockReset().mockImplementation(async () => { folders = [folder()]; return folders[0] })
  rescan.mockReset(); relink.mockReset()
  useThemeStore.setState({ current: 'dark', revision: 0 })
  useThemeBackgroundStore.setState({ initialized: true, preferences: {}, error: null, folders: [], foldersLoading: false, folderError: null })
  useThemeBackgroundPlaybackStore.setState({ reducedMotion: false })
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: {
    app: { getDataPath: async () => '/data' }, file: { read: async (path: string) => { if (!files.has(path)) throw new Error('ENOENT'); return files.get(path) }, write: async (path: string, contents: string) => { files.set(path, contents) } },
    themeBackgrounds: { list: async () => folders, link, forget, rescan, relink, onChanged: () => () => undefined },
  } })
})

it('defers thumbnail and GIF decoding until gallery cards approach the visible scroll area', () => {
  let callback: IntersectionObserverCallback | undefined
  const observe = vi.fn(), unobserve = vi.fn(), disconnect = vi.fn()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(notify: IntersectionObserverCallback) { callback = notify }
    observe = observe
    unobserve = unobserve
    disconnect = disconnect
  })
  open()
  const gif = screen.getByRole('button', { name: 'Ambient loop, GIF' })
  expect(gif.querySelector('img')).toBeNull()
  act(() => callback?.([{ target: gif, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver))
  expect(gif.querySelector('img')).toHaveAttribute('src', '/loop-thumb.webp')
  expect(observe).toHaveBeenCalledWith(gif)
})

it('opens the gallery through the shared dialog controller and keeps the original selected by default', () => {
  render(<ThemeBackgroundSettings />)
  fireEvent.click(screen.getByRole('button', { name: /Background images/ }))
  expect(useUiStore.getState().openDialog).toBe('theme-backgrounds')
  open()
  expect(screen.getByRole('button', { name: 'Original artwork' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('spinbutton', { name: 'Switch every' })).toBeDisabled()
})

it('switches between a fixed image and a timed slideshow while preserving at least one selection', async () => {
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Quiet lake' }))
  await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Switch every' })).toBeEnabled())
  const interval = screen.getByRole('spinbutton', { name: 'Switch every' })
  fireEvent.change(interval, { target: { value: '90' } }); fireEvent.blur(interval)
  await waitFor(() => expect(useThemeBackgroundStore.getState().preferences.dark.intervalSeconds).toBe(90))
  fireEvent.click(screen.getByRole('button', { name: 'Original artwork' }))
  await waitFor(() => expect(interval).toBeDisabled())
  expect(useThemeBackgroundStore.getState().preferences.dark.selectedIds).toEqual(['dark:1'])
  fireEvent.click(screen.getByRole('button', { name: 'Quiet lake' }))
  expect(useThemeBackgroundStore.getState().preferences.dark.selectedIds).toEqual(['dark:1'])
  expect(JSON.parse(files.get('/data/theme-backgrounds.json')!).preferences.dark).toEqual({ selectedIds: ['dark:1'], intervalSeconds: 90 })
})

it('marks GIFs and loads still thumbnails until the user explicitly plays a preview', async () => {
  open()
  const gif = screen.getByRole('button', { name: 'Ambient loop, GIF' })
  expect(gif).toHaveTextContent('GIF')
  expect(gif.querySelector('img')).toHaveAttribute('src', '/loop-thumb.webp')
  fireEvent.click(gif)
  await waitFor(() => expect(gif).toHaveAttribute('aria-pressed', 'true'))
  fireEvent.click(screen.getByRole('button', { name: 'Original artwork' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Original artwork' })).toHaveAttribute('aria-pressed', 'false'))
  expect(screen.getByText('1 image selected · looping animation')).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Ambient loop preview' })).toHaveAttribute('src', '/loop-poster.webp')
  fireEvent.click(screen.getByRole('button', { name: 'Play GIF preview' }))
  expect(screen.getByRole('img', { name: 'Ambient loop preview' })).toHaveAttribute('src', '/loop.gif')
})

it('distinguishes a looping animation from a fixed picture and explains when reduced motion pauses it', () => {
  useThemeBackgroundStore.setState({ preferences: { dark: { selectedIds: ['dark:loop'], intervalSeconds: 30 } } })
  render(<ThemeBackgroundSettings />)
  expect(screen.getByText('One animation · loops continuously')).toBeInTheDocument()
  act(() => useThemeBackgroundPlaybackStore.setState({ reducedMotion: true }))
  expect(screen.getByText('One animation · still frame while reduced motion is enabled')).toBeInTheDocument()
})

it('links a folder and leaves it visible when forgetting fails, with a successful retry pruning its selections', async () => {
  open()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Link image folder…' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Link image folder…' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'My lake' })).toBeInTheDocument())
  expect(link).toHaveBeenCalledWith('dark')
  fireEvent.click(screen.getByRole('button', { name: 'My lake' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'My lake' })).toHaveAttribute('aria-pressed', 'true'))
  forget.mockRejectedValueOnce(new Error('Cannot update folder preferences. Check disk space and retry.'))
  fireEvent.click(screen.getByRole('button', { name: 'Forget Field pictures' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Check disk space'))
  expect(screen.getByRole('button', { name: 'My lake' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Forget Field pictures' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'My lake' })).not.toBeInTheDocument())
  await waitFor(() => expect(useThemeBackgroundStore.getState().preferences.dark.selectedIds).toEqual(['default']))
  expect(screen.getByText(/forgetting a folder leaves its files on disk/)).toBeInTheDocument()
})

it('explains unavailable selections and lets the user restore the original artwork', async () => {
  useThemeBackgroundStore.setState({ preferences: { dark: { selectedIds: ['folder:missing:file'], intervalSeconds: 30 } } })
  open()
  expect(screen.getByText(/1 selected image is unavailable/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Remove unavailable selections' }))
  await waitFor(() => expect(useThemeBackgroundStore.getState().preferences.dark.selectedIds).toEqual(['default']))
})

it('respects reduced motion and rejects invalid slideshow timing without replacing the saved interval', async () => {
  useThemeBackgroundPlaybackStore.setState({ reducedMotion: true })
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Ambient loop, GIF' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Play GIF preview' })).toBeDisabled())
  expect(screen.getByText(/Slideshows stay still and GIFs use a still frame/)).toBeInTheDocument()
  const interval = screen.getByRole('spinbutton', { name: 'Switch every' })
  fireEvent.change(interval, { target: { value: '2' } }); fireEvent.blur(interval)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('5 to 3,600 seconds'))
  expect(useThemeBackgroundStore.getState().preferences.dark.intervalSeconds).toBe(30)
})
