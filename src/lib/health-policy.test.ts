import { describe, it, expect } from 'vitest'
import { HEALTH_MODELS, modelFits, parseNvidiaMemory } from './health-policy'
import type { HealthHardware } from './health-types'

const machine = (patch: Partial<HealthHardware> = {}): HealthHardware => ({
  platform: 'linux', arch: 'x64', totalRamGB: 16, freeRamGB: 10, unifiedMemory: false, gpuNote: '', gpus: [],
  storage: [{ label: 'Model storage', path: '/models', freeGB: 100, writable: true }], ...patch,
})
describe('local model recommendations', () => {
  it('reserves RAM for R and rejects a model beyond available memory', () => {
    expect(modelFits(HEALTH_MODELS[2], machine()).fits).toBe(true)
    expect(modelFits(HEALTH_MODELS[3], machine()).fits).toBe(false)
    expect(modelFits(HEALTH_MODELS[1], machine({ freeRamGB: 4 })).fits).toBe(false)
  })
  it('uses free VRAM on one adapter, without adding multiple GPUs together', () => {
    const gpu = (freeVramGB: number) => ({ name: 'GPU', vramGB: 16, freeVramGB })
    expect(modelFits(HEALTH_MODELS[3], machine({ gpus: [gpu(14)] })).fits).toBe(true)
    expect(modelFits(HEALTH_MODELS[3], machine({ gpus: [gpu(8), gpu(8)] })).fits).toBe(false)
  })
  it('does not double count unified memory or unknown VRAM', () => {
    expect(modelFits(HEALTH_MODELS[3], machine({ unifiedMemory: true })).fits).toBe(false)
    expect(modelFits(HEALTH_MODELS[3], machine({ gpus: [{ name: 'GPU', vramGB: 24, freeVramGB: null }] })).fits).toBe(false)
  })
  it('checks model storage separately and refuses unknown or unwritable space', () => {
    for (const disk of [{ freeGB: 3, writable: true }, { freeGB: null, writable: true }, { freeGB: 100, writable: false }]) {
      expect(modelFits(HEALTH_MODELS[1], machine({ storage: [{ label: 'Model storage', path: '/models', ...disk }] })).fits).toBe(false)
    }
  })
  it('parses multiple NVIDIA adapters and ignores unavailable capacity', () => {
    expect(parseNvidiaMemory('RTX 4090, 24564, 20480\nRTX 3060, 12288, 8192')).toEqual([
      { name: 'RTX 4090', vramGB: 24564 / 1024, freeVramGB: 20 }, { name: 'RTX 3060', vramGB: 12, freeVramGB: 8 },
    ])
    expect(parseNvidiaMemory('GPU, [N/A], [N/A]')).toEqual([])
  })
})
