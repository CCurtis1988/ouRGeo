// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AppUpdateDialog, AppUpdateSettings } from './AppUpdateDialog'
import { AppUpdateController } from './AppUpdateController'
import { useAppUpdatesStore } from '@/store/app-updates'
import { useUiStore } from '@/store/ui'
import type { AppUpdateStatus } from '@/lib/app-updates'
vi.mock('@/lib/project-persistence', () => ({ saveCurrentProject: vi.fn(async () => true) }))
const status = (state: AppUpdateStatus['state'] = 'available'): AppUpdateStatus => ({ state, currentVersion: '1.0.0', latestVersion: state === 'available' ? '2.0.0' : '1.0.0', installation: 'appimage', platform: 'linux', arch: 'x64', preferences: { automatic: true, skippedVersion: null }, checkedAt: null, message: state === 'error' ? 'Offline. Check your connection and try again.' : null, downloads: state === 'available' ? [{ version: '2.0.0', format: 'AppImage', fileName: 'ouRGeo-2.0.0.AppImage', url: 'https://ourgeo.dev/download.php?file=ouRGeo-2.0.0.AppImage' }] : [] })
const open = vi.fn(), quit = vi.fn(), check = vi.fn(), preferences = vi.fn()
beforeEach(() => {
  vi.useRealTimers()
  open.mockReset().mockResolvedValue(undefined); quit.mockReset().mockResolvedValue(undefined); check.mockReset().mockResolvedValue(status())
  preferences.mockReset().mockImplementation(async patch => ({ ...status(), preferences: { ...status().preferences, ...patch } }))
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { updates: { status: async () => status(), check, open, quit, preferences } } })
  useUiStore.setState({ openDialog: null, confirm: null })
  useAppUpdatesStore.setState({ status: null, checking: false, error: null, startupOffer: false, allowStartupOffer: true })
})
afterEach(() => { cleanup(); vi.useRealTimers() })
it('opens only after consent, then gives installation guidance without automatically closing or installing', async () => {
  useAppUpdatesStore.setState({ status: status() }); useUiStore.setState({ openDialog: 'app-update' })
  render(<AppUpdateDialog />)
  expect(open).not.toHaveBeenCalled(); expect(quit).not.toHaveBeenCalled()
  expect(screen.getByRole('heading')).toHaveTextContent('2.0.0')
  fireEvent.click(screen.getByRole('button', { name: 'Download update' }))
  await waitFor(() => expect(open).toHaveBeenCalledExactlyOnceWith('AppImage'))
  expect(screen.getByText(/download was opened in your browser/)).toBeInTheDocument()
  expect(quit).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Close ouRGeo…' }))
  await waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
})
it('skips only the offered version and preserves a failed preference save for retry', async () => {
  useAppUpdatesStore.setState({ status: status() }); useUiStore.setState({ openDialog: 'app-update' })
  render(<AppUpdateDialog />)
  preferences.mockRejectedValueOnce(new Error('Cannot save. Check permissions and retry.'))
  fireEvent.click(screen.getByRole('button', { name: 'Skip this version' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Skip this version' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(preferences).toHaveBeenCalledWith({ skippedVersion: '2.0.0' })
})
it('offers manual checks even when automatic checks are disabled', async () => {
  useAppUpdatesStore.setState({ status: { ...status('current'), preferences: { automatic: false, skippedVersion: '2.0.0' } } })
  render(<AppUpdateSettings />)
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates…' }))
  await waitFor(() => expect(check).toHaveBeenCalledExactlyOnceWith('manual'))
  expect(useUiStore.getState().openDialog).toBe('app-update')
})
it('keeps current and offline startup checks quiet and queues an update behind another dialog', async () => {
  check.mockResolvedValueOnce(status('current')).mockResolvedValueOnce(status('error')).mockResolvedValue(status())
  await useAppUpdatesStore.getState().check('startup')
  expect(useAppUpdatesStore.getState().startupOffer).toBe(false)
  await useAppUpdatesStore.getState().check('startup')
  expect(useAppUpdatesStore.getState().startupOffer).toBe(false)
  useUiStore.setState({ openDialog: 'health-check' })
  await useAppUpdatesStore.getState().check('startup')
  vi.useFakeTimers()
  render(<AppUpdateController />)
  expect(useUiStore.getState().openDialog).toBe('health-check')
  act(() => { useUiStore.setState({ openDialog: null }); vi.advanceTimersByTime(1000) })
  expect(useUiStore.getState().openDialog).toBe('app-update')
})
it('does not surface a skipped version at startup but a newer version can be offered', async () => {
  check.mockResolvedValueOnce({ ...status(), preferences: { automatic: true, skippedVersion: '2.0.0' } })
  await useAppUpdatesStore.getState().check('startup')
  expect(useAppUpdatesStore.getState().startupOffer).toBe(false)
  check.mockResolvedValueOnce({ ...status(), latestVersion: '2.0.1', preferences: { automatic: true, skippedVersion: '2.0.0' } })
  await useAppUpdatesStore.getState().check('startup')
  expect(useAppUpdatesStore.getState().startupOffer).toBe(true)
})
