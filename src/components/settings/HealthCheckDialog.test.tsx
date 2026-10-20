// @vitest-environment jsdom
import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HealthAPI, HealthHardware, RHealth } from '@/lib/health-types'
import { useUiStore } from '@/store/ui'
import { useAiStore } from '@/store/ai'
import { useApiKeysStore } from '@/store/apiKeys'
import { loadHealthCheckpoint } from '@/lib/health-checkpoint'

const mocks = vi.hoisted(() => ({ testAssistant: vi.fn(), inspect: vi.fn(), save: vi.fn(), drafts: { list: vi.fn(), delete: vi.fn() } }))
vi.mock('@/lib/health-check', async (original) => ({
  ...await original<typeof import('@/lib/health-check')>(),
  inspectConnections: mocks.inspect, testAssistant: mocks.testAssistant,
}))
vi.mock('@/lib/reconnect-r', () => ({ reconnectToR: vi.fn() }))
vi.mock('@/lib/project-persistence', () => ({ saveCurrentProject: mocks.save }))
vi.mock('@/lib/r-client', () => ({ rClient: { connect: vi.fn(), health: vi.fn(async () => true) } }))
vi.mock('./LocalModelSetup', () => ({ LocalModelSetup: () => <div>Local configuration wizard</div> }))
import { HealthCheckDialog } from './HealthCheckDialog'

const r: RHealth = { path: 'Rscript', version: '4.6.1', supported: true, configuredPathBroken: false, packages: [], duplicates: [], updatesChecked: true, library: '/R/library', libraryWritable: true, tools: { pandoc: true, latex: true } }
const hw: HealthHardware = { platform: 'linux', arch: 'x64', totalRamGB: 16, freeRamGB: 10, gpus: [], unifiedMemory: false, gpuNote: 'Unknown VRAM', storage: [{ label: 'Model storage', path: '/models', freeGB: 100, writable: true }] }
let api: HealthAPI
beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  useUiStore.setState({ openDialog: null })
  useAiStore.setState({ provider: 'openai', modelByProvider: { openai: 'gpt-4o' }, initialized: true })
  useApiKeysStore.setState({ keys: { openai: 'test-key' }, initialized: true })
  mocks.inspect.mockResolvedValue([{ provider: 'ollama', models: ['qwen3:4b'] }])
  mocks.testAssistant.mockResolvedValue({ id: 'ai-response', title: 'AI response test', status: 'pass', detail: 'Received a reply' })
  api = {
    history: vi.fn(async () => ({ prompted: false, report: null })), acknowledge: vi.fn(async () => {}), saveReport: vi.fn(async () => {}),
    activity: vi.fn(async () => ({ busy: false, progress: '', error: null, needsRRestart: false })),
    checkR: vi.fn(async () => r), checkPackages: vi.fn(async () => r), hardware: vi.fn(async () => hw),
    installPlan: vi.fn(async () => ({ command: 'winget', args: [], label: 'Install R', detail: 'Requires approval', manualUrl: 'https://cran.r-project.org/' })),
    install: vi.fn(async () => {}), repairPackages: vi.fn(async () => r), connectR: vi.fn(async () => ({ ready: true, detail: 'Ready' })),
    removePackageCopies: vi.fn(async () => r),
    ollamaModels: vi.fn(async () => ({ models: [] })), startOllama: vi.fn(async () => {}), pullModel: vi.fn(async () => {}), onProgress: vi.fn(() => () => {}),
  }
  mocks.drafts.list.mockResolvedValue([])
  mocks.drafts.delete.mockResolvedValue(0)
  window.electronAPI = { health: api, r: { isReady: vi.fn(async () => true) }, drafts: mocks.drafts } as unknown as Window['electronAPI']
})
afterEach(() => { cleanup(); useUiStore.setState({ openDialog: null }) })
const run = async () => { render(<HealthCheckDialog />); fireEvent.click(await screen.findByRole('button', { name: 'Confirm and run health check' })) }
const next = async (name: string) => fireEvent.click(await screen.findByRole('button', { name }))
const goToAi = async () => { await next('Next: R packages'); await next('Next: System'); await next('Next: Stored project changes'); await next('Next: AI assistant') }
describe('guided health check approvals', () => {
  it('shows a dismissible first-run invitation and performs no diagnostics before consent', async () => {
    render(<React.StrictMode><HealthCheckDialog /></React.StrictMode>)
    fireEvent.click(await screen.findByRole('button', { name: 'Maybe later' }))
    await waitFor(() => expect(api.acknowledge).toHaveBeenCalled())
    expect(api.checkR).not.toHaveBeenCalled()
    expect(api.hardware).not.toHaveBeenCalled()
    expect(mocks.inspect).not.toHaveBeenCalled()
    expect(api.install).not.toHaveBeenCalled()
  })
  it('does not show the invitation again after dismissal but opens from Settings', async () => {
    vi.mocked(api.history).mockResolvedValue({ prompted: true, report: null })
    render(<HealthCheckDialog />)
    await waitFor(() => expect(api.history).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).toBeNull()
    useUiStore.getState().showDialog('health-check')
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })
  it('asks before installing missing R and respects skipping it', async () => {
    vi.mocked(api.checkR).mockResolvedValue({ ...r, path: null, version: null })
    await run()
    fireEvent.click(await screen.findByRole('button', { name: 'Skip R setup' }))
    await goToAi()
    fireEvent.click(await screen.findByRole('button', { name: 'Skip response test' }))
    await next('View results')
    await waitFor(() => expect(api.saveReport).toHaveBeenCalled())
    expect(api.install).not.toHaveBeenCalled()
    expect(api.checkPackages).not.toHaveBeenCalled()
    expect(mocks.testAssistant).not.toHaveBeenCalled()
  })
  it('repairs outdated core packages only after approval, then rechecks and reconnects R', async () => {
    vi.mocked(api.checkPackages).mockResolvedValue({ ...r, packages: [{ name: 'httpuv', group: 'Core', version: '1.6.16', available: '1.6.17', built: '4.5.0', loaded: false, reason: 'cannot load; rebuild for R 4.6; update to 1.6.17' }] })
    await run()
    await next('Next: R packages')
    await screen.findByText('Review package repairs')
    expect(api.repairPackages).not.toHaveBeenCalled()
    expect(screen.getByText(/repairs stop the current R session/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected repairs' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Approve R restart' }))
    await next('Next: System'); await next('Next: Stored project changes'); await next('Next: AI assistant')
    fireEvent.click(await screen.findByRole('button', { name: 'Skip response test' }))
    await next('View results')
    await waitFor(() => expect(api.saveReport).toHaveBeenCalled())
    expect(api.repairPackages).toHaveBeenCalledWith(['httpuv'], true)
    expect(api.connectR).toHaveBeenCalledWith(true)
    const report = vi.mocked(api.saveReport).mock.calls[0][0]
    expect(report.results.find((row) => row.id === 'package-repair')).toMatchObject({ status: 'pass', repaired: true })
    expect(mocks.testAssistant).not.toHaveBeenCalled()
  })
  it('shows the OS-specific S2 repair and rechecks the engine after approval', async () => {
    const s2 = { ok: false, detail: 'Missing libabsl.so', repair: 'Linux: rebuild S2 with bundled Abseil.', library: '/custom/R' }
    vi.mocked(api.checkPackages).mockResolvedValue({ ...r, s2, packages: [{ name: 's2', group: 'Spatial', version: '1.1.13', available: '1.1.13', built: '4.6.1', loaded: false, reason: 'S2 check failed: Missing libabsl.so' }] })
    vi.mocked(api.repairPackages).mockResolvedValue({ ...r, s2: { ...s2, ok: true, detail: 'Spherical distance and buffers passed.' } })
    await run(); await next('Next: R packages')
    await screen.findByText('Review package repairs')
    expect(screen.getByText(/S2 repair library: \/custom\/R/).textContent).toContain('bundled Abseil')
    expect(api.repairPackages).not.toHaveBeenCalled()
    await next('Approve selected repairs')
    await screen.findByText('Spherical distance and buffers passed.')
    expect(api.repairPackages).toHaveBeenCalledWith(['s2'], true)
  })
  it('never spends AI credits without approval and records the declined test in the summary', async () => {
    await run()
    await goToAi()
    await screen.findByText('Test the assistant with one short message?')
    expect(mocks.testAssistant).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Skip response test' }))
    await next('View results')
    await waitFor(() => expect(api.saveReport).toHaveBeenCalled())
    expect(vi.mocked(api.saveReport).mock.calls[0][0].results.find((row) => row.id === 'ai-response')?.status).toBe('skipped')
    expect(mocks.testAssistant).not.toHaveBeenCalled()
  })
  it('offers the configuration wizard when no local models exist, and allows AI to be skipped', async () => {
    mocks.inspect.mockResolvedValue([])
    await run()
    await goToAi()
    await screen.findByText('Local configuration wizard')
    fireEvent.click(screen.getByRole('button', { name: 'Skip AI setup' }))
    await next('View results')
    await waitFor(() => expect(api.saveReport).toHaveBeenCalled())
    expect(mocks.testAssistant).not.toHaveBeenCalled()
    expect(api.pullModel).not.toHaveBeenCalled()
  })
  it('shows the time notice and pauses for forward and back navigation', async () => {
    await run()
    expect(screen.getByText(/health check may take several minutes/)).toBeTruthy()
    await screen.findByRole('button', { name: 'Next: R packages' })
    expect(api.checkPackages).not.toHaveBeenCalled()
    await next('Next: R packages')
    await screen.findByRole('button', { name: 'Next: System' })
    expect(api.hardware).not.toHaveBeenCalled()
    await next('Back')
    await screen.findByRole('button', { name: 'Next: R packages' })
    expect(api.checkR).toHaveBeenCalledTimes(2)
    await next('Back')
    await screen.findByRole('button', { name: 'Confirm and run health check' })
    expect(api.saveReport).not.toHaveBeenCalled()
    expect(api.removePackageCopies).not.toHaveBeenCalled()
  })
  it('keeps multiple selected versions and removes only the approved copy', async () => {
    const copies = [
      { name: 'sf', version: '1.0.20', library: '/user/R', built: '4.6.1', active: true, removable: true },
      { name: 'sf', version: '1.0.19', library: '/site/R', built: '4.6.1', active: false, removable: true },
      { name: 'sf', version: '1.0.18', library: '/other/R', built: '4.5.0', active: false, removable: true },
    ]
    vi.mocked(api.checkPackages).mockResolvedValue({ ...r, duplicates: copies })
    vi.mocked(api.removePackageCopies).mockResolvedValue({ ...r, duplicates: copies.slice(0, 2) })
    await run(); await next('Next: R packages')
    await screen.findByText('Choose which package copies to keep')
    expect(api.removePackageCopies).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep sf 1.0.19 in /site/R' }))
    await next('Approve removing unchecked copies')
    await next('Approve R restart')
    await next('Next: System'); await next('Next: Stored project changes'); await next('Next: AI assistant'); await next('Skip response test'); await next('View results')
    await waitFor(() => expect(api.saveReport).toHaveBeenCalled())
    expect(api.removePackageCopies).toHaveBeenCalledWith([copies[2]], true)
    const results = vi.mocked(api.saveReport).mock.calls[0][0].results
    expect(results.find((row) => row.id === 'duplicate-cleanup')).toMatchObject({ status: 'pass', repaired: true })
    expect(results.find((row) => row.id === 'package-duplicates')).toMatchObject({ status: 'warning' })
    await next('Back')
    expect(screen.getByText('Review ai assistant results')).toBeTruthy()
    await next('Next')
    expect(screen.getByText(/Health check complete/)).toBeTruthy()
    expect(api.removePackageCopies).toHaveBeenCalledOnce()
  })
  it('blocks removing every copy, protects read-only copies, and permits skipping cleanup', async () => {
    vi.mocked(api.checkPackages).mockResolvedValue({ ...r, duplicates: [
      { name: 'sf', version: '1.0.20', library: '/user/R', built: '4.6.1', active: true, removable: true },
      { name: 'sf', version: '1.0.19', library: '/site/R', built: '4.6.1', active: false, removable: true },
      { name: 'MASS', version: '7.3', library: '/user/R', built: '4.6.1', active: true, removable: true },
      { name: 'MASS', version: '7.2', library: '/system/R', built: '4.6.1', active: false, removable: false },
    ] })
    await run(); await next('Next: R packages')
    await screen.findByText('Choose which package copies to keep')
    expect((screen.getByRole('checkbox', { name: 'Keep MASS 7.2 in /system/R' }) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep sf 1.0.20 in /user/R' }))
    expect(screen.getByText('Keep at least one installation of sf.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Approve removing unchecked copies' }) as HTMLButtonElement).disabled).toBe(true)
    await next('Keep all copies and continue')
    await screen.findByRole('button', { name: 'Next: System' })
    expect(api.removePackageCopies).not.toHaveBeenCalled()
    expect(api.connectR).not.toHaveBeenCalled()
  })
  it('navigates back from a pending cleanup without applying it', async () => {
    vi.mocked(api.checkPackages).mockResolvedValue({ ...r, duplicates: [
      { name: 'sf', version: '1.0.20', library: '/user/R', built: '4.6.1', active: true, removable: true },
      { name: 'sf', version: '1.0.19', library: '/site/R', built: '4.6.1', active: false, removable: true },
    ] })
    await run(); await next('Next: R packages')
    await screen.findByText('Choose which package copies to keep')
    await next('Back')
    await screen.findByRole('button', { name: 'Next: R packages' })
    expect(api.removePackageCopies).not.toHaveBeenCalled()
  })
  it('keeps an acknowledged invitation open after a renderer reload on wake', async () => {
    const first = render(<HealthCheckDialog />)
    await screen.findByRole('button', { name: 'Confirm and run health check' })
    await waitFor(() => expect(loadHealthCheckpoint()?.step).toBe('welcome'))
    first.unmount()
    useUiStore.setState({ openDialog: null })
    vi.mocked(api.history).mockResolvedValue({ prompted: true, report: null })
    render(<HealthCheckDialog />)
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Confirm and run health check' })).toBeTruthy()
    expect(api.checkR).not.toHaveBeenCalled()
  })
  it('preserves a pending health check across ordinary blur and focus on wake', async () => {
    await run(); await next('Next: R packages')
    await screen.findByRole('button', { name: 'Next: System' })
    window.dispatchEvent(new Event('blur'))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Next: System' })).toBeTruthy()
    expect(api.checkR).toHaveBeenCalledOnce()
    expect(api.checkPackages).toHaveBeenCalledOnce()
    expect(api.repairPackages).not.toHaveBeenCalled()
  })
  it('restores a completed step and its results without rerunning prior checks', async () => {
    await run(); await next('Next: R packages')
    await screen.findByRole('button', { name: 'Next: System' })
    await waitFor(() => expect(loadHealthCheckpoint()).toMatchObject({ step: 'packages', running: true, atCheckpoint: true }))
    const previousChecks = vi.mocked(api.checkPackages).mock.calls.length
    cleanup(); useUiStore.setState({ openDialog: null })
    vi.mocked(api.history).mockResolvedValue({ prompted: true, report: null })
    render(<HealthCheckDialog />)
    await screen.findByRole('button', { name: 'Next: System' })
    expect(api.checkPackages).toHaveBeenCalledTimes(previousChecks)
    expect(api.checkR).toHaveBeenCalledOnce()
    expect(screen.getByText('R server connection')).toBeTruthy()
    await next('Next: System')
    await screen.findByRole('button', { name: 'Next: Stored project changes' })
    expect(api.hardware).toHaveBeenCalledOnce()
  })
  it('restores pending copy selections without approving or repeating cleanup', async () => {
    vi.mocked(api.checkPackages).mockResolvedValue({ ...r, duplicates: [
      { name: 'sf', version: '1.0.20', library: '/user/R', built: '4.6.1', active: true, removable: true },
      { name: 'sf', version: '1.0.19', library: '/site/R', built: '4.6.1', active: false, removable: true },
      { name: 'sf', version: '1.0.18', library: '/other/R', built: '4.5.0', active: false, removable: true },
    ] })
    await run(); await next('Next: R packages')
    await screen.findByText('Choose which package copies to keep')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep sf 1.0.19 in /site/R' }))
    await waitFor(() => expect(loadHealthCheckpoint()?.selected).toHaveLength(2))
    cleanup(); useUiStore.setState({ openDialog: null })
    vi.mocked(api.history).mockResolvedValue({ prompted: true, report: null })
    render(<HealthCheckDialog />)
    await screen.findByText('Choose which package copies to keep')
    expect(screen.getByRole('checkbox', { name: 'Keep sf 1.0.19 in /site/R' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Keep sf 1.0.18 in /other/R' })).not.toBeChecked()
    expect(api.removePackageCopies).not.toHaveBeenCalled()
    expect(api.repairPackages).not.toHaveBeenCalled()
  })
  it('waits for accepted main-process work after reload instead of starting it again', async () => {
    vi.mocked(api.checkPackages).mockResolvedValue({ ...r, packages: [{ name: 'httpuv', group: 'Core', version: '1.0', available: '2.0', built: '4.6.1', loaded: false, reason: 'cannot load' }] })
    let completeRepair!: (value: RHealth) => void
    vi.mocked(api.repairPackages).mockReturnValue(new Promise((resolve) => { completeRepair = resolve }))
    await run(); await next('Next: R packages'); await next('Approve selected repairs')
    await waitFor(() => expect(loadHealthCheckpoint()?.locked).toBe(true))
    cleanup(); useUiStore.setState({ openDialog: null })
    let busy = true
    vi.mocked(api.activity).mockImplementation(async () => ({ busy, progress: 'Installing httpuv…', error: null, needsRRestart: true }))
    vi.mocked(api.checkPackages).mockResolvedValue(r)
    vi.mocked(api.history).mockResolvedValue({ prompted: true, report: null })
    render(<HealthCheckDialog />)
    await screen.findByText('Installing httpuv…')
    expect(screen.getByRole('button', { name: 'Close health check' })).toBeDisabled()
    expect(api.checkPackages).toHaveBeenCalledOnce()
    busy = false; completeRepair(r)
    await screen.findByRole('button', { name: 'Approve R restart' })
    expect(api.repairPackages).toHaveBeenCalledOnce()
    expect(api.connectR).not.toHaveBeenCalled()
    await next('Skip for now')
    await screen.findByRole('button', { name: 'Next: System' })
  })
  it('does not reopen a health check the user explicitly closed before sleep', async () => {
    render(<HealthCheckDialog />)
    await next('Maybe later')
    expect(loadHealthCheckpoint()).toBeNull()
    cleanup(); useUiStore.setState({ openDialog: null })
    vi.mocked(api.history).mockResolvedValue({ prompted: true, report: null })
    render(<HealthCheckDialog />)
    await waitFor(() => expect(api.history).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('restores the final results when the renderer reloads after a completed health check', async () => {
    await run(); await goToAi(); await next('Skip response test'); await next('View results')
    await waitFor(() => expect(loadHealthCheckpoint()).toMatchObject({ step: 'summary', running: false }))
    cleanup(); useUiStore.setState({ openDialog: null })
    vi.mocked(api.history).mockResolvedValue({ prompted: true, report: null })
    render(<HealthCheckDialog />)
    await screen.findByRole('dialog')
    expect(screen.getByText(/Health check complete/)).toBeTruthy()
    expect(screen.getByText('AI response test')).toBeTruthy()
    expect(api.checkR).toHaveBeenCalledOnce()
    expect(mocks.testAssistant).not.toHaveBeenCalled()
  })

  it('reports stored drafts as information and deletes only what was approved', async () => {
    const day = 86_400_000
    mocks.drafts.list.mockResolvedValue([
      { key: 'a'.repeat(32), path: '/gone/one.ourgeoproj', name: 'one', updatedAt: new Date().toISOString(), changed: true, bytes: 2048, fileExists: false, open: false },
      { key: 'b'.repeat(32), path: '/here/old.ourgeoproj', name: 'old', updatedAt: new Date(Date.now() - 120 * day).toISOString(), changed: true, bytes: 1024, fileExists: true, open: false },
      { key: 'c'.repeat(32), path: '/here/open.ourgeoproj', name: 'open', updatedAt: new Date(Date.now() - 400 * day).toISOString(), changed: true, bytes: 10, fileExists: true, open: true },
    ])
    mocks.drafts.delete.mockResolvedValue(1)
    await run()
    await next('Next: R packages'); await next('Next: System'); await next('Next: Stored project changes')
    expect(await screen.findByText(/3 drafts on this computer/)).toBeTruthy()
    await next('Approve deleting 1 whose project file is gone')
    await waitFor(() => expect(mocks.drafts.delete).toHaveBeenCalledWith(['a'.repeat(32)]))
    expect(await screen.findByText(/1 draft deleted\. Project files were not touched\./)).toBeTruthy()
  })
})
