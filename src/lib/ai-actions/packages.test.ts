import { beforeEach, describe, expect, it, vi } from 'vitest'
import { packagesActions } from './environment'
import { usePackagesStore } from '@/store/packages'
import { rClient, type RLibrary } from '@/lib/r-client'

vi.mock('@/lib/r-client', () => ({ rClient: { loadPackage: vi.fn(), unloadPackage: vi.fn(), listPackages: vi.fn() } }))
const libraries: RLibrary[] = [
  { path: '/R/first', packages: [{ name: 'dplyr', version: '1.1.3', loaded: false, isBase: false }] },
  { path: '/R/second', packages: [{ name: 'dplyr', version: '1.1.4', loaded: true, isBase: false }] },
]
beforeEach(() => {
  vi.clearAllMocks()
  usePackagesStore.setState({ libraries: [], loadingPackages: new Set(), error: null })
  vi.mocked(rClient.listPackages).mockResolvedValue({ success: true, libraries })
})
describe('package assistant actions', () => {
  it('selects a library copy and uses R’s actual loaded flags', async () => {
    vi.mocked(rClient.loadPackage).mockResolvedValue({ success: true })
    const result = await packagesActions.find((action) => action.id === 'packages:load')!.run({ name: 'dplyr', libPath: '/R/second' })
    expect(result.ok).toBe(true)
    expect(rClient.loadPackage).toHaveBeenCalledWith('dplyr', '/R/second')
    expect(usePackagesStore.getState().libraries).toEqual(libraries)
    expect(usePackagesStore.getState().libraries[0].packages[0].loaded).toBe(false)
  })
  it('refreshes actual state on a refused load instead of marking copies loaded by name', async () => {
    vi.mocked(rClient.loadPackage).mockResolvedValue({ success: false, error: 'Namespace in use' })
    const result = await packagesActions.find((action) => action.id === 'packages:load')!.run({ name: 'dplyr', libPath: '/R/first' })
    expect(result.ok).toBe(false)
    expect(result.message).toBe('Namespace in use')
    expect(usePackagesStore.getState().libraries).toEqual(libraries)
  })
  it('identifies duplicate versions by library when listing packages', async () => {
    const result = await packagesActions.find((action) => action.id === 'packages:list')!.run({ pattern: 'dplyr' })
    expect(result.message).toContain('dplyr 1.1.3 · /R/first')
    expect(result.message).toContain('dplyr 1.1.4 (attached) · /R/second')
  })
})
