// Refcounted OS idle-suspend inhibitor for long-running R requests.
//
// A multi-minute import or raster registration is exactly when the user steps
// away — the OS idle timeout suspends the machine mid-request, and on resume
// Chromium aborts every in-flight request (localhost included) with
// ERR_NETWORK_CHANGED ("Network Error" / "Failed to fetch"). Blocking
// app-suspension while R work is in flight prevents that whole failure class.
//
// Safe outside Electron (tests, storybook): the electronAPI calls are
// optional-chained no-ops.

let depth = 0

function powerApi(): Window['electronAPI']['power'] | undefined {
  return typeof window === 'undefined' ? undefined : window.electronAPI?.power
}

export async function withPowerBlock<T>(fn: () => Promise<T>): Promise<T> {
  depth++
  if (depth === 1) {
    void powerApi()?.block().catch(() => undefined)
  }
  try {
    return await fn()
  } finally {
    depth--
    if (depth === 0) {
      void powerApi()?.unblock().catch(() => undefined)
    }
  }
}
