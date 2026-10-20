import { beforeEach, expect, it, vi } from 'vitest'
import { useChatGptStore } from './chatgpt'
const ready = (id: string) => ({ activeId: id, planEnabled: true, signingIn: false, signedIn: true, accounts: [], error: null })
beforeEach(() => { useChatGptStore.setState({ status: null, models: [], error: null, loading: false }) })

it('shares simultaneous catalogue reads using the existing sign-in without registering an account', async () => {
  let finish!: (value: ReturnType<typeof ready>) => void
  const api = { status: vi.fn(() => new Promise(done => { finish = done })), models: vi.fn(async () => [{ id: 'plan-model', label: 'Eligible model' }]), signIn: vi.fn(), select: vi.fn() }
  vi.stubGlobal('window', { electronAPI: { chatgpt: api } })
  const refresh = useChatGptStore.getState().refresh
  const chat = refresh(), document = refresh()
  expect(chat).toBe(document); expect(api.status).toHaveBeenCalledOnce()
  finish(ready('existing-account')); await chat
  expect(api.models).toHaveBeenCalledOnce(); expect(api.signIn).not.toHaveBeenCalled(); expect(api.select).not.toHaveBeenCalled()
  expect(useChatGptStore.getState().models).toEqual([{ id: 'plan-model', label: 'Eligible model' }])
})

it('does not reuse an old account refresh after an explicit account action', async () => {
  let finishOld!: (value: ReturnType<typeof ready>) => void
  const status = vi.fn().mockImplementationOnce(() => new Promise(done => { finishOld = done })).mockResolvedValue(ready('new-account'))
  const models = vi.fn(async () => [{ id: 'new-eligible-model', label: 'New account model' }])
  vi.stubGlobal('window', { electronAPI: { chatgpt: { status, models } } })
  const old = useChatGptStore.getState().refresh()
  await useChatGptStore.getState().act(async () => undefined)
  finishOld(ready('old-account')); await old
  expect(useChatGptStore.getState().status?.activeId).toBe('new-account')
  expect(useChatGptStore.getState().models[0].id).toBe('new-eligible-model')
  expect(models).toHaveBeenCalledOnce()
})

it('can retry a failed status read without requiring a new registration', async () => {
  const status = vi.fn().mockImplementationOnce(() => { throw new Error('Connection lost') }).mockResolvedValue(ready('same-account'))
  const models = vi.fn(async () => [{ id: 'same-model', label: 'Same account model' }])
  vi.stubGlobal('window', { electronAPI: { chatgpt: { status, models } } })
  await useChatGptStore.getState().refresh()
  expect(useChatGptStore.getState().error).toBe('Connection lost')
  await useChatGptStore.getState().refresh()
  expect(status).toHaveBeenCalledTimes(2)
  expect(useChatGptStore.getState().models[0].id).toBe('same-model')
})
