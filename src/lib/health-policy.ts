import type { HealthHardware } from './health-types'

// Download sizes are from Ollama's library. Memory budgets are conservative
// estimates for a 4K context, leaving room for R and the desktop application.
export const HEALTH_MODELS = [
  { id: 'qwen3:1.7b-q4_K_M', label: 'Qwen3 1.7B', downloadGB: 1.4, memoryGB: 3, note: 'Lightweight; best for simple questions.' },
  { id: 'qwen3:4b-instruct-2507-q4_K_M', label: 'Qwen3 4B Instruct', downloadGB: 2.5, memoryGB: 5, note: 'A practical starting point for everyday assistance.' },
  { id: 'qwen3:8b-q4_K_M', label: 'Qwen3 8B', downloadGB: 5.2, memoryGB: 8, note: 'Stronger reasoning and general assistance.' },
  { id: 'qwen3:14b-q4_K_M', label: 'Qwen3 14B', downloadGB: 9.3, memoryGB: 13, note: 'More capable reasoning for larger machines.' },
  { id: 'qwen3:30b-a3b-instruct-2507-q4_K_M', label: 'Qwen3 30B A3B Instruct', downloadGB: 19, memoryGB: 24, note: 'A capable mixture-of-experts model; all weights still need memory.' },
]

export function comparePackageVersions(left: string, right: string): number {
  const a = left.split(/[.-]/).map(Number), b = right.split(/[.-]/).map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0)
    if (difference) return difference
  }
  return 0
}

export function modelFits(model: typeof HEALTH_MODELS[number], hardware: HealthHardware): { fits: boolean; mode: string } {
  const modelStorage = hardware.storage.find((s) => s.label === 'Model storage')
  const disk = modelStorage?.freeGB
  if (modelStorage && !modelStorage.writable) return { fits: false, mode: 'Model storage is not writable.' }
  if (disk == null) return { fits: false, mode: 'Model storage could not be measured. Check available space first.' }
  if (disk < model.downloadGB * 1.2 + 2) return { fits: false, mode: 'Needs more free model storage.' }
  const ramBudget = Math.max(0, Math.min(hardware.freeRamGB - 2, hardware.totalRamGB - 4))
  const gpu = hardware.gpus.some((g) => (g.freeVramGB ?? 0) >= model.memoryGB)
  if (gpu && ramBudget >= 3) return { fits: true, mode: 'Fits available GPU memory at a 4K context.' }
  if (ramBudget >= model.memoryGB) return { fits: true, mode: hardware.unifiedMemory ? 'Fits available unified memory at a 4K context.' : 'Fits in system RAM; CPU inference may be slow.' }
  return { fits: false, mode: 'Close other applications or choose a smaller model.' }
}

export function parseNvidiaMemory(output: string): HealthHardware['gpus'] {
  return output.trim().split('\n').flatMap((line) => {
    const fields = line.split(',').map((s) => s.trim())
    const total = Number(fields[fields.length - 2])
    const free = Number(fields[fields.length - 1])
    if (fields.length < 3 || !Number.isFinite(total) || total <= 0) return []
    return [{ name: fields.slice(0, -2).join(', '), vramGB: total / 1024, freeVramGB: Number.isFinite(free) ? free / 1024 : null }]
  })
}
