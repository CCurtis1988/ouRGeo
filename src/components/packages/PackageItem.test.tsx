// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePackagesStore } from '@/store/packages'
import { useSessionStore } from '@/store/session'
import { rClient, type RLibrary } from '@/lib/r-client'
import { PackageItem } from './PackageItem'

vi.mock('@/lib/r-client', () => ({ rClient: { loadPackage: vi.fn(), unloadPackage: vi.fn(), listPackages: vi.fn() } }))
const initialLibraries = (): RLibrary[] => [
  { path: '/R/first library', packages: [{ name: 'dplyr', version: '1.1.3', loaded: true, isBase: false }] },
  { path: '/R/second library', packages: [{ name: 'dplyr', version: '1.1.4', loaded: false, isBase: false }] },
]
const switchedLibraries = () => initialLibraries().map((lib, index) => ({ ...lib, packages: lib.packages.map((pkg) => ({ ...pkg, loaded: index === 1 })) }))
function Packages(): React.ReactElement {
  const libraries = usePackagesStore((s) => s.libraries)
  return <>{libraries.flatMap((lib) => lib.packages.map((pkg) =>
    <PackageItem key={`${lib.path}/${pkg.name}`} {...pkg} libPath={lib.path} onContextMenu={() => {}} />))}</>
}
beforeEach(() => {
  vi.clearAllMocks()
  usePackagesStore.setState({ libraries: initialLibraries(), loadingPackages: new Set(), isLoading: false, error: null })
  useSessionStore.setState({ consoleHistory: [] })
  vi.mocked(rClient.loadPackage).mockResolvedValue({ success: true })
  vi.mocked(rClient.unloadPackage).mockResolvedValue({ success: true })
  vi.mocked(rClient.listPackages).mockResolvedValue({ success: true, libraries: switchedLibraries() })
})
afterEach(cleanup)

describe('package copy selection', () => {
  it('loads the selected library and version, and highlights only the actual loaded copy', async () => {
    let complete!: (value: { success: boolean }) => void
    vi.mocked(rClient.loadPackage).mockReturnValue(new Promise((resolve) => { complete = resolve }))
    render(<Packages />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Load dplyr 1.1.4 from /R/second library' }))
    expect(rClient.loadPackage).toHaveBeenCalledWith('dplyr', '/R/second library', '1.1.4')
    expect(useSessionStore.getState().consoleHistory.at(-1)?.text).toBe('unloadNamespace("dplyr")\nlibrary("dplyr", lib.loc = "/R/second library")')
    // No optimistic name-wide highlighting while R is still switching.
    expect(usePackagesStore.getState().libraries[0].packages[0].loaded).toBe(true)
    expect(usePackagesStore.getState().libraries[1].packages[0].loaded).toBe(false)
    // A second click, even on another version, cannot race the first request.
    fireEvent.click(screen.getAllByText('dplyr', { selector: 'span' })[0])
    expect(rClient.loadPackage).toHaveBeenCalledOnce()
    complete({ success: true })
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Unload dplyr 1.1.4 from /R/second library' })).toHaveAttribute('aria-checked', 'true'))
    expect(screen.getByRole('checkbox', { name: 'Load dplyr 1.1.3 from /R/first library' })).toHaveAttribute('aria-checked', 'false')
  })
  it('preserves the loaded copy and shows R’s error when an importer blocks switching', async () => {
    vi.mocked(rClient.loadPackage).mockResolvedValue({ success: false, error: 'Cannot unload dplyr: it is imported by tidyr.' })
    vi.mocked(rClient.listPackages).mockResolvedValue({ success: true, libraries: initialLibraries() })
    render(<Packages />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Load dplyr 1.1.4 from /R/second library' }))
    await waitFor(() => expect(usePackagesStore.getState().loadingPackages.size).toBe(0))
    expect(screen.getByRole('checkbox', { name: 'Unload dplyr 1.1.3 from /R/first library' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('checkbox', { name: 'Load dplyr 1.1.4 from /R/second library' })).toHaveAttribute('aria-checked', 'false')
    expect(useSessionStore.getState().consoleHistory.at(-1)).toMatchObject({ type: 'error', text: expect.stringContaining('imported by tidyr') })
  })
  it('shows neither copy as loaded when the new package fails after unloading the old one', async () => {
    vi.mocked(rClient.loadPackage).mockResolvedValue({ success: false, error: 'New package cannot load' })
    vi.mocked(rClient.listPackages).mockResolvedValue({ success: true, libraries: initialLibraries().map((lib) => ({ ...lib, packages: lib.packages.map((pkg) => ({ ...pkg, loaded: false })) })) })
    render(<Packages />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Load dplyr 1.1.4 from /R/second library' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Load dplyr 1.1.3 from /R/first library' })).toHaveAttribute('aria-checked', 'false'))
    expect(screen.getByRole('checkbox', { name: 'Load dplyr 1.1.4 from /R/second library' })).toHaveAttribute('aria-checked', 'false')
  })
  it('unloads only the selected library copy', async () => {
    vi.mocked(rClient.listPackages).mockResolvedValue({ success: true, libraries: initialLibraries().map((lib) => ({ ...lib, packages: lib.packages.map((pkg) => ({ ...pkg, loaded: false })) })) })
    render(<Packages />)
    fireEvent.keyDown(screen.getByRole('checkbox', { name: 'Unload dplyr 1.1.3 from /R/first library' }), { key: ' ' })
    await waitFor(() => expect(usePackagesStore.getState().loadingPackages.size).toBe(0))
    expect(rClient.unloadPackage).toHaveBeenCalledWith('dplyr', '/R/first library', '1.1.3')
    expect(useSessionStore.getState().consoleHistory[0].text).toBe('unloadNamespace("dplyr")')
  })
  it('quotes Windows library paths and loads without an unload when no copy is attached', async () => {
    const path = 'C:\\Users\\O"Brien\\R library'
    usePackagesStore.setState({ libraries: [{ path, packages: [{ name: 'dplyr', version: '1.1.4', loaded: false, isBase: false }] }] })
    render(<Packages />)
    fireEvent.click(screen.getByRole('checkbox', { name: `Load dplyr 1.1.4 from ${path}` }))
    await waitFor(() => expect(usePackagesStore.getState().loadingPackages.size).toBe(0))
    expect(rClient.loadPackage).toHaveBeenCalledWith('dplyr', path, '1.1.4')
    expect(useSessionStore.getState().consoleHistory[0].text).toBe('library("dplyr", lib.loc = "C:\\\\Users\\\\O\\"Brien\\\\R library")')
  })
})
