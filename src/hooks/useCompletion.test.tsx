// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

/**
 * A lookup R cannot answer must be asked ONCE.
 *
 * Autocomplete fetches lazily and re-runs the query when a fetch lands, which
 * is how newly-arrived columns and formals reach an open menu. Nothing was
 * written to the caches on failure, though, so the re-run asked for the same
 * thing again — immediately, for ever. Measured against a real session before
 * the fix: an unresolvable `foo(` left sitting in the editor fired **340
 * requests in 17 seconds** with nothing typed, and `nosuchobject$` did the same
 * to `/object/dataframe`. About twenty a second each, at a SERIAL R server,
 * with every real command queued behind them.
 *
 * It is a loop rather than a wasted call, so the assertion is a COUNT that
 * stays put while time passes, not a "was it cached" flag.
 */

const getObjectFormals = vi.fn(async () => ({ success: false, error: 'no such function' }))
const getObjectDataFrame = vi.fn(async () => ({ success: false, error: 'object not found' }))

vi.mock('@/lib/r-client', () => ({
  rClient: {
    getObjectFormals: (...a: unknown[]) => getObjectFormals(...(a as [])),
    getObjectDataFrame: (...a: unknown[]) => getObjectDataFrame(...(a as [])),
  },
}))

const envState = {
  environments: [{
    name: '.GlobalEnv', isSearchPath: false,
    objects: [{ name: 'roads', class: 'sf', type: 'sf' }],
  }],
  setEnvironments: vi.fn(),
}
vi.mock('@/store/environment', () => ({
  useEnvironmentStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel(envState),
    { getState: () => envState }
  ),
}))

const pkgState = { libraries: [], refreshPackages: vi.fn(async () => undefined) }
vi.mock('@/store/packages', () => ({
  usePackagesStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel(pkgState),
    { getState: () => pkgState }
  ),
}))

import { useCompletion } from './useCompletion'

const settle = async (): Promise<void> => {
  // Long enough that a loop running at ~20 Hz would be unmistakable.
  await act(async () => { await new Promise((r) => setTimeout(r, 300)) })
}

describe('useCompletion lazy fetches', () => {
  beforeEach(() => {
    getObjectFormals.mockClear()
    getObjectDataFrame.mockClear()
  })

  it('asks once for a function it cannot resolve, and then stops', async () => {
    const { result } = renderHook(() => useCompletion())
    act(() => { result.current.query('notafunction(', 13, false) })

    await waitFor(() => expect(getObjectFormals).toHaveBeenCalled())
    await settle()
    const after = getObjectFormals.mock.calls.length
    await settle()
    // The count must not move while nothing happens. Before the fix it climbed
    // for as long as the text sat there.
    expect(getObjectFormals).toHaveBeenCalledTimes(after)
    expect(after).toBeLessThanOrEqual(2)
  })

  it('asks once for an object whose columns it cannot read', async () => {
    const { result } = renderHook(() => useCompletion())
    act(() => { result.current.query('nosuchobject$', 13, false) })

    await settle()
    const after = getObjectDataFrame.mock.calls.length
    await settle()
    expect(getObjectDataFrame).toHaveBeenCalledTimes(after)
    expect(after).toBeLessThanOrEqual(2)
  })

  /**
   * A dropped socket stops it too, and that is deliberate.
   *
   * Leaving transport failures retryable was the first shape of this fix, and
   * it only moved the loop behind a rarer condition: R restarting is an
   * ordinary event here, and a server that is not answering is the one this
   * helps least. Writing that test crashed the vitest worker after 71 seconds,
   * which is the same evidence from the other side.
   */
  it('stops asking when the server could not be reached at all', async () => {
    getObjectFormals.mockRejectedValue(
      Object.assign(new Error('Network Error'), { isAxiosError: true, response: undefined })
    )
    const { result } = renderHook(() => useCompletion())
    act(() => { result.current.query('notafunction(', 13, false) })

    await waitFor(() => expect(getObjectFormals).toHaveBeenCalled())
    await settle()
    const after = getObjectFormals.mock.calls.length
    await settle()
    expect(getObjectFormals).toHaveBeenCalledTimes(after)
    expect(after).toBeLessThanOrEqual(2)
  })
})
