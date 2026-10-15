import { expect, it, vi } from 'vitest'
import { waitForAsync } from './wait-async.mjs'

it('does not accept a Promise that resolves false as a satisfied IPC condition', async () => {
  let attempts = 0, active = 0, peak = 0
  const page = { evaluate: async () => {
    peak = Math.max(peak, ++active)
    await new Promise(resolve => setTimeout(resolve, 2))
    active--
    return ++attempts === 3
  } }
  await expect(waitForAsync(page, () => false, undefined, { polling: 1, timeout: 1000 })).resolves.toBe(true)
  expect(attempts).toBe(3); expect(peak).toBe(1)
})

it('fails when the condition stays false and surfaces unexpected IPC failures', async () => {
  await expect(waitForAsync({ evaluate: async () => false }, () => false, undefined, { polling: 1, timeout: 5 })).rejects.toThrow('did not become true')
  const evaluate = vi.fn(async () => { throw new Error('Unexpected scope violation') })
  await expect(waitForAsync({ evaluate }, () => false)).rejects.toThrow('scope violation')
  expect(evaluate).toHaveBeenCalledOnce()
})

it('retries only explicitly recognised transient errors and preserves a failed scope guard', async () => {
  const evaluate = vi.fn().mockRejectedValueOnce(new Error('SCOPE_CHANGED')).mockResolvedValue(true)
  await expect(waitForAsync({ evaluate }, () => false, undefined, { polling: 1, retryError: async error => String(error).includes('SCOPE_CHANGED') })).resolves.toBe(true)
  expect(evaluate).toHaveBeenCalledTimes(2)
  const changedScope = vi.fn(async () => { throw new Error('SCOPE_CHANGED') })
  await expect(waitForAsync({ evaluate: changedScope }, () => false, undefined, { retryError: async () => false })).rejects.toThrow('SCOPE_CHANGED')
  expect(changedScope).toHaveBeenCalledOnce()
})
