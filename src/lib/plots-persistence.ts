import { usePlottingStore, normalizePersistedPlots } from '@/store/plotting'
import { getDataPath } from '@/lib/persistence'

let saveTimer: ReturnType<typeof setTimeout> | null = null

async function getPlotsPath(): Promise<string> {
  return `${await getDataPath()}/plots.json`
}

export async function savePlots(): Promise<void> {
  try {
    const { plots, currentIndex } = usePlottingStore.getState()
    await window.electronAPI.file.write(await getPlotsPath(), JSON.stringify({ plots, currentIndex }))
  } catch (err) {
    console.warn('[Plots] Failed to save:', err)
  }
}

export function savePlotsDebounced(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(savePlots, 1000)
}

export async function loadPlots(): Promise<void> {
  const raw = await window.electronAPI.file.read(await getPlotsPath())
  const data = JSON.parse(raw) as { plots: unknown; currentIndex: number }
  const plots = normalizePersistedPlots(data.plots)
  if (plots.length) {
    usePlottingStore.setState({
      plots,
      currentIndex: Math.min(data.currentIndex, plots.length - 1),
      isOpen: true,
    })
  }
}

export function setupPlotsAutosave(): () => void {
  const unsub = usePlottingStore.subscribe((state, prev) => {
    if (state.plots !== prev.plots) {
      savePlotsDebounced()
    }
  })

  return () => {
    unsub()
    if (saveTimer) clearTimeout(saveTimer)
  }
}
