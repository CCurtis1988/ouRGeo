import { usePlottingStore, buildPlotPopoutState } from '@/store/plotting'

/**
 * Keeps the plot popout window in lockstep with the plot store.
 *
 * The store is the single source of truth: every change to the plot list or
 * the selected index is pushed to the popout (a no-op in the main process when
 * no popout is open), and the popout's arrows come back as an index to apply
 * here. Wired in `MainApp` rather than `PlottingPanel` so the popout keeps
 * working while the Plots panel is closed.
 */
export function setupPlotPopoutSync(): () => void {
  const unsubStore = usePlottingStore.subscribe((state, prev) => {
    if (state.plots === prev.plots && state.currentIndex === prev.currentIndex) return
    void window.electronAPI.plot.syncState(buildPlotPopoutState())
  })

  const offNavigate = window.electronAPI.plot.onNavigate((index) => {
    usePlottingStore.getState().setIndex(index)
  })

  return () => {
    unsubStore()
    offNavigate()
  }
}
