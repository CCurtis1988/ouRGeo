import { execFileSync } from 'node:child_process'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'

const mocks = vi.hoisted(() => ({ outputs: [] as string[], calls: [] as { command: string; args: string[] }[], ready: false,
  hold: false, finish: null as (() => void) | null }))
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
    const complete = () => { child.stdout.emit('data', Buffer.from(output)); child.emit('close', 0) }
    if (mocks.hold) mocks.finish = complete
    else queueMicrotask(complete)
    return child
  } }
})
import { parseRHealth, registerHealthHandlers } from './health-check'
import { rBridge } from './r-bridge'

const runtime = 'OURGEO_HEALTH\truntime\t4.6.1\t/user/R/4.6\n'
const packages = runtime + 'OURGEO_HEALTH\tupdates\tTRUE\nOURGEO_HEALTH\tpackage\thttpuv\tCore\t1.6.16\t1.6.17\t4.5.0\tFALSE\tcannot load; rebuild for R 4.6; update to 1.6.17\nOURGEO_HEALTH\tpackage\tRcpp\tCore dependency\t1.1.0\t1.1.2\t4.5.0\tFALSE\tcannot load; rebuild for R 4.6\nOURGEO_HEALTH\tlibrary\t/user/R/4.6\tTRUE\nOURGEO_HEALTH\ttools\tTRUE\tFALSE\n'
const duplicateOutput = packages + 'OURGEO_HEALTH\tduplicate\tsf\t1.0.20\t/user/R\t4.6.1\tTRUE\tTRUE\nOURGEO_HEALTH\tduplicate\tsf\t1.0.19\t/site/R\t4.5.0\tFALSE\tTRUE\nOURGEO_HEALTH\tduplicate\tsf\t1.0.18\t/system/R\t4.5.0\tFALSE\tFALSE\n'
type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
const handlers = new Map<string, Handler>()
const event = { sender: { isDestroyed: () => false, send: vi.fn() } } as unknown as IpcMainInvokeEvent
beforeEach(() => { mocks.outputs = []; mocks.calls = []; mocks.ready = false; mocks.hold = false; mocks.finish = null; vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }))); handlers.clear(); registerHealthHandlers({ handle: (name: string, fn: Handler) => handlers.set(name, fn) } as unknown as IpcMain) })
afterEach(() => vi.unstubAllGlobals())
describe('independent R health diagnostics', () => {
  it('retains the S2 engine outcome, platform repair and active library', () => {
    const result = parseRHealth(packages + 'OURGEO_HEALTH\ts2\tFALSE\tMissing libabsl.so\tLinux: rebuild\t/custom/R\n', 'Rscript')
    expect(result.s2).toEqual({ ok: false, detail: 'Missing libabsl.so', repair: 'Linux: rebuild', library: '/custom/R' })
  })
  it('parses missing/incompatible core packages without relying on jsonlite or the server', () => {
    const result = parseRHealth(packages, 'C:\\Program Files\\R\\R-4.6.1\\bin\\Rscript.exe')
    expect(result.supported).toBe(true)
    expect(result.packages[0]).toMatchObject({ name: 'httpuv', loaded: false, built: '4.5.0', available: '1.6.17' })
    expect(result.tools).toEqual({ pandoc: true, latex: false })
    expect(() => parseRHealth('profile failed', 'Rscript')).toThrow('valid diagnostic')
    expect(parseRHealth(runtime.replace('4.6.1', '4.0.5'), 'Rscript').supported).toBe(false)
  })
  it('requires explicit approval at every installation boundary', async () => {
    for (const [name, args] of [ ['install', ['r', false]], ['repairPackages', [['httpuv'], false]], ['removePackageCopies', [[], false]], ['connectR', [false]], ['pullModel', ['qwen3:8b-q4_K_M', false]], ['startOllama', [false]] ] as const) {
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
  it('reports an accepted repair’s main-process activity so a reloaded renderer can wait for it', async () => {
    mocks.outputs = [runtime, packages]
    await handlers.get('health:checkR')!(event)
    await handlers.get('health:checkPackages')!(event)
    mocks.hold = true; mocks.outputs = ['Installing httpuv…', packages]
    const repair = handlers.get('health:repairPackages')!(event, ['httpuv'], true)
    await vi.waitFor(() => expect(mocks.finish).not.toBeNull())
    expect(await handlers.get('health:activity')!(event)).toMatchObject({ busy: true, needsRRestart: true, error: null })
    await expect(handlers.get('health:repairPackages')!(event, ['httpuv'], true)).rejects.toThrow('still running')
    mocks.hold = false; mocks.finish!()
    await repair
    expect(await handlers.get('health:activity')!(event)).toMatchObject({ busy: false, progress: 'Installing httpuv…', needsRRestart: true, error: null })
    expect(mocks.calls.filter((call) => call.args.includes('repair'))).toHaveLength(1)
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
  it('parses every duplicate copy with its library, version and protection', () => {
    expect(parseRHealth(duplicateOutput, 'Rscript').duplicates).toEqual([
      { name: 'sf', version: '1.0.20', library: '/user/R', built: '4.6.1', active: true, removable: true },
      { name: 'sf', version: '1.0.19', library: '/site/R', built: '4.5.0', active: false, removable: true },
      { name: 'sf', version: '1.0.18', library: '/system/R', built: '4.5.0', active: false, removable: false },
    ])
  })
  it('rejects protected, stale, repeated and unknown copies before stopping R', async () => {
    mocks.outputs = [runtime, duplicateOutput]
    await handlers.get('health:checkR')!(event)
    const result = await handlers.get('health:checkPackages')!(event) as ReturnType<typeof parseRHealth>
    const [active, shadowed, protectedCopy] = result.duplicates
    for (const selection of [[protectedCopy], [{ ...active, version: '0.0' }], [{ ...active, library: '/arbitrary/R' }], [shadowed, shadowed], [], [null]]) {
      await expect(handlers.get('health:removePackageCopies')!(event, selection, true)).rejects.toThrow()
    }
    expect(rBridge.stop).not.toHaveBeenCalled()
  })
  it('keeps at least one copy and removes only diagnosed copies using separate arguments', async () => {
    mocks.outputs = [runtime, duplicateOutput.replace(/OURGEO_HEALTH\tduplicate\tsf\t1.0.18[^\n]*\n/, '')]
    await handlers.get('health:checkR')!(event)
    const result = await handlers.get('health:checkPackages')!(event) as ReturnType<typeof parseRHealth>
    await expect(handlers.get('health:removePackageCopies')!(event, result.duplicates, true)).rejects.toThrow('Keep at least one')
    expect(rBridge.stop).not.toHaveBeenCalled()
    mocks.outputs = ['', packages]
    const rechecked = await handlers.get('health:removePackageCopies')!(event, [result.duplicates[1]], true) as ReturnType<typeof parseRHealth>
    expect(rBridge.stop).toHaveBeenCalledOnce()
    expect(mocks.calls.at(-2)?.args).toEqual([expect.stringContaining('health-check.R'), 'remove-copies', 'sf', '/site/R', '1.0.19'])
    expect(rechecked.duplicates).toEqual([])
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
  it('finds duplicate versions and identical copies across libraries and safely removes selected copies', () => {
    const code = String.raw`source('r/lib/health-utils.R')
      root <- tempfile('ourgeo-health-')
      dir.create(root)
      libs <- file.path(root, c('user library', 'site library', 'other library'))
      invisible(lapply(libs, dir.create))
      libs <- normalizePath(libs, winslash = '/')
      fixture <- function(lib, pkg, version, priority = NULL) {
        path <- file.path(lib, pkg)
        dir.create(path)
        metadata <- c(Package = pkg, Version = version, Title = 'Health test fixture',
          Description = 'Fixture for package inventory tests.', License = 'MIT',
          Built = paste0('R ', getRversion(), '; ; 2026-01-01; unix'),
          if (!is.null(priority)) c(Priority = priority))
        write.dcf(as.data.frame(as.list(metadata)), file.path(path, 'DESCRIPTION'))
        dir.create(file.path(path, 'Meta'))
        saveRDS(list(DESCRIPTION = metadata), file.path(path, 'Meta', 'package.rds'))
      }
      fixture(libs[1], 'healthfixture', '2.0')
      fixture(libs[2], 'healthfixture', '1.0')
      fixture(libs[3], 'healthfixture', '1.0')
      fixture(libs[1], 'uniqueFixture', '1.0')
      fixture(libs[1], 'protectedFixture', '1.0', 'recommended')
      fixture(libs[2], 'protectedFixture', '1.0', 'recommended')
      copies <- health_duplicate_copies(health_package_copies(c(libs, libs[1])))
      stopifnot(nrow(copies) == 5L, sum(copies$active) == 2L)
      stopifnot(all(copies$removable[copies$name == 'healthfixture']))
      stopifnot(!any(copies$removable[copies$name == 'protectedFixture']))
      stopifnot(!'uniqueFixture' %in% copies$name)
      targets <- copies[copies$name == 'healthfixture', c('name', 'library', 'version')]
      fails <- function(plan) inherits(try(health_remove_copies(plan, libs), silent = TRUE), 'try-error')
      stopifnot(fails(targets), fails(rbind(targets[2, ], targets[2, ])))
      stale <- targets[2, ]; stale$version <- '0.0'
      stopifnot(fails(rbind(targets[3, ], stale)))
      stopifnot(dir.exists(file.path(libs[3], 'healthfixture')))
      stopifnot(fails(copies[copies$name == 'protectedFixture', c('name', 'library', 'version')]))
      health_remove_copies(targets[3, , drop = FALSE], libs)
      stopifnot(!dir.exists(file.path(libs[3], 'healthfixture')))
      stopifnot(dir.exists(file.path(libs[1], 'healthfixture')), dir.exists(file.path(libs[2], 'healthfixture')))
      remaining <- health_duplicate_copies(health_package_copies(libs))
      stopifnot(sum(remaining$name == 'healthfixture') == 2L)
      health_remove_copies(targets[1, , drop = FALSE], libs)
      remaining <- health_package_copies(libs)
      stopifnot(remaining$active[remaining$name == 'healthfixture'], remaining$version[remaining$name == 'healthfixture'] == '1.0')
      stopifnot(!'healthfixture' %in% health_duplicate_copies(remaining)$name)
      unlink(root, recursive = TRUE)`
    expect(() => execFileSync(process.platform === 'win32' ? 'Rscript.exe' : 'Rscript', ['--vanilla', '-e', code], { timeout: 15_000 })).not.toThrow()
  })
})
