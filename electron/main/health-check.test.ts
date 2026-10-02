import { execFileSync } from 'node:child_process'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'

const mocks = vi.hoisted(() => ({ outputs: [] as string[], calls: [] as { command: string; args: string[] }[], ready: false }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ourgeo-health-tests', on: vi.fn() } }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('./ipc', () => ({ detectRInstallations: () => [] }))
vi.mock('./r-bridge', () => ({ rBridge: { currentPath: 'Rscript', get isReady() { return mocks.ready }, stop: vi.fn(), restart: vi.fn(), setPath: vi.fn() } }))
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>()
  const { EventEmitter } = await import('node:events')
  return { ...actual, spawn: (command: string, args: string[]) => {
    mocks.calls.push({ command, args })
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() })
    const output = mocks.outputs.shift() ?? ''
    queueMicrotask(() => { child.stdout.emit('data', Buffer.from(output)); child.emit('close', 0) })
    return child
  } }
})
import { parseRHealth, registerHealthHandlers } from './health-check'
import { rBridge } from './r-bridge'

const runtime = 'OURGEO_HEALTH\truntime\t4.6.1\t/user/R/4.6\n'
const packages = runtime + 'OURGEO_HEALTH\tupdates\tTRUE\nOURGEO_HEALTH\tpackage\thttpuv\tCore\t1.6.16\t1.6.17\t4.5.0\tFALSE\tcannot load; rebuild for R 4.6; update to 1.6.17\nOURGEO_HEALTH\tpackage\tRcpp\tCore dependency\t1.1.0\t1.1.2\t4.5.0\tFALSE\tcannot load; rebuild for R 4.6\nOURGEO_HEALTH\tlibrary\t/user/R/4.6\tTRUE\nOURGEO_HEALTH\ttools\tTRUE\tFALSE\n'
type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
const handlers = new Map<string, Handler>()
const event = { sender: { isDestroyed: () => false, send: vi.fn() } } as unknown as IpcMainInvokeEvent
beforeEach(() => { mocks.outputs = []; mocks.calls = []; mocks.ready = false; vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }))); handlers.clear(); registerHealthHandlers({ handle: (name: string, fn: Handler) => handlers.set(name, fn) } as unknown as IpcMain) })
afterEach(() => vi.unstubAllGlobals())
describe('independent R health diagnostics', () => {
  it('parses missing/incompatible core packages without relying on jsonlite or the server', () => {
    const result = parseRHealth(packages, 'C:\\Program Files\\R\\R-4.6.1\\bin\\Rscript.exe')
    expect(result.supported).toBe(true)
    expect(result.packages[0]).toMatchObject({ name: 'httpuv', loaded: false, built: '4.5.0', available: '1.6.17' })
    expect(result.tools).toEqual({ pandoc: true, latex: false })
    expect(() => parseRHealth('profile failed', 'Rscript')).toThrow('valid diagnostic')
    expect(parseRHealth(runtime.replace('4.6.1', '4.0.5'), 'Rscript').supported).toBe(false)
  })
  it('requires explicit approval at every installation boundary', async () => {
    for (const [name, args] of [ ['install', ['r', false]], ['repairPackages', [['httpuv'], false]], ['connectR', [false]], ['pullModel', ['qwen3:8b-q4_K_M', false]], ['startOllama', [false]] ] as const) {
      await expect(handlers.get(`health:${name}`)!(event, ...args)).rejects.toThrow('Approval')
    }
    expect(mocks.calls).toEqual([])
  })
  it('allows only diagnosed repairs and stops the live server before replacing loaded DLLs', async () => {
    mocks.outputs = [runtime, packages]
    await handlers.get('health:checkR')!(event)
    await handlers.get('health:checkPackages')!(event)
    await expect(handlers.get('health:repairPackages')!(event, ['arbitrary-package'], true)).rejects.toThrow('Recheck')
    expect(rBridge.stop).not.toHaveBeenCalled()
    mocks.outputs = ['', packages]
    await handlers.get('health:repairPackages')!(event, ['httpuv', 'Rcpp'], true)
    expect(rBridge.stop).toHaveBeenCalledOnce()
    expect(mocks.calls.at(-2)?.args).toEqual([expect.stringContaining('health-check.R'), 'repair', 'httpuv', 'Rcpp'])
  })
  it('retains known outdated versions if the post-repair update index is unavailable', async () => {
    mocks.outputs = [runtime, packages]
    await handlers.get('health:checkR')!(event)
    await handlers.get('health:checkPackages')!(event)
    mocks.outputs = [packages.replace('updates\tTRUE', 'updates\tFALSE').replace('1.6.17', '').replace('cannot load; rebuild for R 4.6; update to 1.6.17', '')]
    const result = await handlers.get('health:checkPackages')!(event) as ReturnType<typeof parseRHealth>
    expect(result.packages[0].reason).toContain('update to 1.6.17')
  })
  it('detects sfarc updates from its declared GitHub version without installing it', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ encoding: 'base64', content: Buffer.from('Version: 0.6.0\n').toString('base64') }) } as Response)
    mocks.outputs = [runtime, packages + 'OURGEO_HEALTH\tpackage\tsfarc\tCurves\t0.5.0\t\t4.6.1\tTRUE\t\n']
    await handlers.get('health:checkR')!(event)
    const result = await handlers.get('health:checkPackages')!(event) as ReturnType<typeof parseRHealth>
    expect(result.githubUpdatesChecked).toBe(true)
    expect(result.packages.find((p) => p.name === 'sfarc')?.reason).toBe('update to 0.6.0')
    expect(mocks.calls.some((call) => call.args.includes('repair'))).toBe(false)
  })
})

let hasR = false
try { execFileSync(process.platform === 'win32' ? 'Rscript.exe' : 'Rscript', ['--version'], { stdio: 'ignore' }); hasR = true } catch { /* optional on CI */ }
describe.skipIf(!hasR)('R compatibility rules', () => {
  it('detects R upgrades, later-built packages, failed loads and available updates using R itself', () => {
    const code = `source('r/lib/health-utils.R');
      stopifnot(health_package_reason('1.0', 'R 4.6.0; x86_64; date; unix', '1.0', TRUE, '4.6.1') == '');
      stopifnot(grepl('rebuild for R 4.6', health_package_reason('1.0', '4.5.3', '1.0', TRUE, '4.6.1')));
      stopifnot(grepl('rebuild', health_package_reason('1.0', '4.7.0', '', TRUE, '4.6.1')));
      stopifnot(health_package_reason('', '', '1.0', FALSE, '4.6.1') == 'missing');
      stopifnot(health_package_reason('1.0', '4.6.0', '1.2', FALSE, '4.6.1') == 'cannot load; update to 1.2')`
    expect(() => execFileSync(process.platform === 'win32' ? 'Rscript.exe' : 'Rscript', ['--vanilla', '-e', code], { timeout: 10_000 })).not.toThrow()
  })
})
