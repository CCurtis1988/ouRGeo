import { beforeEach, describe, expect, it, vi } from 'vitest'

const http = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } }))
vi.mock('axios', () => ({ default: { create: () => http } }))
import { rClient } from './r-client'

beforeEach(() => { vi.clearAllMocks(); rClient.init(10000) })
describe('package copy requests', () => {
  it('sends the selected library and version through the real R client', async () => {
    http.post.mockResolvedValue({ data: { success: true } })
    await rClient.loadPackage('dplyr', 'C:\\R libraries\\second', '1.1.4')
    expect(http.post).toHaveBeenCalledWith('/packages/load', { name: 'dplyr', libPath: 'C:\\R libraries\\second', version: '1.1.4' })
    await rClient.unloadPackage('dplyr', 'C:\\R libraries\\second', '1.1.4')
    expect(http.post).toHaveBeenLastCalledWith('/packages/unload', { name: 'dplyr', libPath: 'C:\\R libraries\\second', version: '1.1.4' })
  })
  it('returns R’s namespace refusal so callers can display it', async () => {
    const data = { success: false, error: 'Cannot unload dplyr: it is imported by tidyr.' }
    http.post.mockRejectedValue({ response: { status: 500, data } })
    expect(await rClient.loadPackage('dplyr', '/R/library', '1.1.4')).toEqual(data)
    expect(await rClient.unloadPackage('dplyr', '/R/library', '1.1.4')).toEqual(data)
  })
  it('still rejects transport failures when R cannot answer', async () => {
    http.post.mockRejectedValue(new Error('Connection refused'))
    await expect(rClient.loadPackage('dplyr', '/R/library')).rejects.toThrow('Connection refused')
  })
})
