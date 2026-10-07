import { afterEach, expect, it, vi } from 'vitest'
import { activateContextProject, contextLease } from './scope'
import { ManagedMnemosyneRuntime } from './managed-runtime'

const mocks = vi.hoisted(() => ({ current: vi.fn(async (): Promise<null> => null), install: vi.fn(async () => ({})), rollback: vi.fn(async () => ({})), cancel: vi.fn() }))
vi.mock('./runtime-installer', () => ({ RuntimeInstaller: class {
  current = mocks.current
  canRollback = async (): Promise<boolean> => false
  install = mocks.install
  rollback = mocks.rollback
  cancel = mocks.cancel
} }))
afterEach(() => { vi.clearAllMocks(); activateContextProject(null) })

it('requires deliberate native-runtime acknowledgement before preparing any installation', async () => {
  const runtime = new ManagedMnemosyneRuntime('/tmp/synthetic-runtime-only', '/tmp/unused-fixture.py')
  await expect(runtime.stage(contextLease().id, false)).rejects.toThrow('acknowledge')
  expect(mocks.current).not.toHaveBeenCalled()
  expect(mocks.install).not.toHaveBeenCalled()
})

it('rejects stale setup leases before touching assets', async () => {
  const runtime = new ManagedMnemosyneRuntime('/tmp/synthetic-runtime-only', '/tmp/unused-fixture.py')
  await expect(runtime.stage(crypto.randomUUID(), true)).rejects.toThrow('SCOPE_CHANGED')
  expect(mocks.current).not.toHaveBeenCalled()
  expect(mocks.install).not.toHaveBeenCalled()
})

it.skipIf(process.platform !== 'linux' || process.arch !== 'x64')('cancels startup before an asynchronous metadata read can start downloads', async () => {
  let finish!: (value: null) => void
  mocks.current.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const runtime = new ManagedMnemosyneRuntime('/tmp/synthetic-runtime-only', '/tmp/unused-fixture.py')
  const staging = runtime.stage(contextLease().id, true)
  await vi.waitFor(() => expect(mocks.current).toHaveBeenCalledOnce())
  runtime.cancel()
  finish(null)
  await expect(staging).rejects.toThrow('cancelled')
  expect(mocks.install).not.toHaveBeenCalled()
  expect((await runtime.status()).state).toBe('cancelled')
})

it.skipIf(process.platform !== 'linux' || process.arch !== 'x64')('refuses a workspace change during startup and does not certify a successful staging receipt', async () => {
  let finish!: (value: null) => void
  mocks.current.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const runtime = new ManagedMnemosyneRuntime('/tmp/synthetic-runtime-only', '/tmp/unused-fixture.py')
  const staging = runtime.stage(contextLease().id, true)
  await vi.waitFor(() => expect(mocks.current).toHaveBeenCalledOnce())
  activateContextProject(crypto.randomUUID())
  finish(null)
  await expect(staging).rejects.toThrow('SCOPE_CHANGED')
  expect(mocks.install).not.toHaveBeenCalled()
  expect(await runtime.stage(contextLease().id, true)).toMatchObject({ state: 'ready-for-certification', certification: 'pending' })
})
