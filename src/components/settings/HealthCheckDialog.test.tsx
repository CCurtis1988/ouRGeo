// @vitest-environment jsdom
import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HealthAPI, HealthHardware, RHealth } from '@/lib/health-types'
import { useUiStore } from '@/store/ui'
import { useAiStore } from '@/store/ai'
import { useApiKeysStore } from '@/store/apiKeys'

const mocks = vi.hoisted(() => ({ testAssistant: vi.fn(), inspect: vi.fn(), save: vi.fn() }))
vi.mock('@/lib/health-check', () => ({
  inspectConnections: mocks.inspect, testAssistant: mocks.testAssistant,
  packageResults: (r: RHealth) => [{ id: 'packages-Core', title: 'Core packages', status: r.packages.some((p) => p.reason) ? 'error' : 'pass', detail: 'Package check results' }],
}))
vi.mock('@/lib/reconnect-r', () => ({ reconnectToR: vi.fn() }))
vi.mock('@/lib/project-persistence', () => ({ saveCurrentProject: mocks.save }))
vi.mock('@/lib/r-client', () => ({ rClient: { connect: vi.fn(), health: vi.fn(async () => true) } }))
vi.mock('./LocalModelSetup', () => ({ LocalModelSetup: () => <div>Local configuration wizard</div> }))
import { HealthCheckDialog } from './HealthCheckDialog'

const r: RHealth = { path: 'Rscript', version: '4.6.1', supported: true, configuredPathBroken: false, packages: [], updatesChecked: true, library: '/R/library', libraryWritable: true, tools: { pandoc: true, latex: true } }
const hw: HealthHardware = { platform: 'linux', arch: 'x64', totalRamGB: 16, freeRamGB: 10, gpus: [], unifiedMemory: false, gpuNote: 'Unknown VRAM', storage: [{ label: 'Model storage', path: '/models', freeGB: 100, writable: true }] }
let api: HealthAPI
beforeEach(() => {
  vi.clearAllMocks()
  useUiStore.setState({ openDialog: null })
  useAiStore.setState({ provider: 'openai', modelByProvider: { openai: 'gpt-4o' }, initialized: true })
  useApiKeysStore.setState({ keys: { openai: 'test-key' }, initialized: true })
  mocks.inspect.mockResolvedValue([{ provider: 'ollama', models: ['qwen3:4b'] }])
  mocks.testAssistant.mockResolvedValue({ id: 'ai-response', title: 'AI response test', status: 'pass', detail: 'Received a reply' })
  api = {
    history: vi.fn(async () => ({ prompted: false, report: null })), acknowledge: vi.fn(async () => {}), saveReport: vi.fn(async () => {}),
    checkR: vi.fn(async () => r), checkPackages: vi.fn(async () => r), hardware: vi.fn(async () => hw),
    installPlan: vi.fn(async () => ({ command: 'winget', args: [], label: 'Install R', detail: 'Requires approval', manualUrl: 'https://cran.r-project.org/' })),
    install: vi.fn(async () => {}), repairPackages: vi.fn(async () => r), connectR: vi.fn(async () => ({ ready: true, detail: 'Ready' })),
    ollamaModels: vi.fn(async () => ({ models: [] })), startOllama: vi.fn(async () => {}), pullModel: vi.fn(async () => {}), onProgress: vi.fn(() => () => {}),
  }
  window.electronAPI = { health: api, r: { isReady: vi.fn(async () => true) } } as unknown as Window['electronAPI']
})
afterEach(() => { cleanup(); useUiStore.setState({ openDialog: null }) })
const run = async () => { render(<HealthCheckDialog />); fireEvent.click(await screen.findByRole('button', { name: 'Confirm and run health check' })) }
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
    fireEvent.click(await screen.findByRole('button', { name: 'Skip response test' }))
    await waitFor(() => expect(api.saveReport).toHaveBeenCalled())
    expect(api.install).not.toHaveBeenCalled()
    expect(api.checkPackages).not.toHaveBeenCalled()
    expect(mocks.testAssistant).not.toHaveBeenCalled()
  })
  it('repairs outdated core packages only after approval, then rechecks and reconnects R', async () => {
    vi.mocked(api.checkPackages).mockResolvedValue({ ...r, packages: [{ name: 'httpuv', group: 'Core', version: '1.6.16', available: '1.6.17', built: '4.5.0', loaded: false, reason: 'cannot load; rebuild for R 4.6; update to 1.6.17' }] })
    await run()
    await screen.findByText('Review package repairs')
    expect(api.repairPackages).not.toHaveBeenCalled()
    expect(screen.getByText(/repairs stop the current R session/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected repairs' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Approve R restart' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Skip response test' }))
    await waitFor(() => expect(api.saveReport).toHaveBeenCalled())
    expect(api.repairPackages).toHaveBeenCalledWith(['httpuv'], true)
    expect(api.connectR).toHaveBeenCalledWith(true)
    const report = vi.mocked(api.saveReport).mock.calls[0][0]
    expect(report.results.find((row) => row.id === 'package-repair')).toMatchObject({ status: 'pass', repaired: true })
    expect(mocks.testAssistant).not.toHaveBeenCalled()
  })
  it('never spends AI credits without approval and records the declined test in the summary', async () => {
    await run()
    await screen.findByText('Test the assistant with one short message?')
    expect(mocks.testAssistant).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Skip response test' }))
    await waitFor(() => expect(api.saveReport).toHaveBeenCalled())
    expect(vi.mocked(api.saveReport).mock.calls[0][0].results.find((row) => row.id === 'ai-response')?.status).toBe('skipped')
    expect(mocks.testAssistant).not.toHaveBeenCalled()
  })
  it('offers the configuration wizard when no local models exist, and allows AI to be skipped', async () => {
    mocks.inspect.mockResolvedValue([])
    await run()
    await screen.findByText('Local configuration wizard')
    fireEvent.click(screen.getByRole('button', { name: 'Skip AI setup' }))
    await waitFor(() => expect(api.saveReport).toHaveBeenCalled())
    expect(mocks.testAssistant).not.toHaveBeenCalled()
    expect(api.pullModel).not.toHaveBeenCalled()
  })
})
