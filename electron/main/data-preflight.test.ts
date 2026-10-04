import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ show: vi.fn(), interrupt: vi.fn(), active: null as string | null, handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>() }))
vi.mock('electron', () => ({ dialog: { showMessageBox: mocks.show }, BrowserWindow: { fromWebContents: () => null } }))
vi.mock('./r-bridge', () => ({ rBridge: { port: 1234, preflightSecret: 'private-main-secret', get activePreflight() { return mocks.active }, interrupt: mocks.interrupt } }))
import { registerDataPreflightHandlers } from './data-preflight'
const id = 'dq-' + 'a'.repeat(64)
const report = { status: 'needs_confirmation', validationFingerprint: 'exact-plan', operationType: 'left-join', profiles: [], executionPlan: {}, issues: [{ stableCode: 'JOIN-EXPANSION', severity: 'warning', requiresAcknowledgment: true, message: '4 result rows from 3 left source rows', consequence: 'The left A row has two matches' }] }
beforeEach(() => { vi.resetAllMocks(); mocks.active=null; mocks.handlers.clear(); registerDataPreflightHandlers({ handle: (name: string, fn: (...args: unknown[]) => Promise<unknown>) => mocks.handlers.set(name, fn) } as never) })
const review = () => mocks.handlers.get('preflight:review')!({ sender: {} }, id)
describe('Desktop preflight approval authority', () => {
  it('never offers a generic override for a blocked backend report', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ...report, status: 'blocked' }) }))
    vi.stubGlobal('fetch', fetch)
    expect(await review()).toBe(false)
    expect(mocks.show).not.toHaveBeenCalled()
  })
  it('denial sends no approval and exposes no private secret to the dialog', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => report }))
    vi.stubGlobal('fetch', fetch); mocks.show.mockResolvedValue({ response: 0 })
    expect(await review()).toBe(false); expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(mocks.show.mock.calls)).not.toContain('private-main-secret')
  })
  it('approval uses the backend fingerprint and lists the exact change', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => report }).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', fetch); mocks.show.mockResolvedValue({ response: 1 })
    expect(await review()).toBe(true)
    expect(mocks.show.mock.calls[0][0].detail).toContain('4 result rows from 3 left source rows')
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ operationId: id, fingerprint: 'exact-plan', secret: 'private-main-secret' })
  })
})

it('an interrupt must name the active job and never terminates a Windows R session', () => {
  const interrupt = mocks.handlers.get('preflight:interrupt')!
  interrupt({}, null)
  mocks.active = id
  interrupt({}, 'dq-' + 'b'.repeat(64))
  expect(mocks.interrupt).not.toHaveBeenCalled()
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
  try {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    interrupt({}, id)
    expect(mocks.interrupt).not.toHaveBeenCalled()
    Object.defineProperty(process, 'platform', { value: 'linux' })
    interrupt({}, id)
    expect(mocks.interrupt).toHaveBeenCalledTimes(1)
  } finally { Object.defineProperty(process, 'platform', descriptor) }
})
